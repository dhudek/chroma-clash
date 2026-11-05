import {
  acceptDeck,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  aiInput,
  arenaAi,
  arenaView,
  countScores,
  countdownLeftSec,
  createArena,
  createSim,
  mergeCardTable,
  dashReadyIn,
  encodeGrid,
  forfeit,
  forfeitArena,
  gameOf,
  phaseOf,
  playerOf,
  randomName,
  sanitizeName,
  step,
  stepArena,
  timeLeftSec,
  tryPlay,
  type ArenaConfig,
  type ArenaSim,
  type CardId,
  type CardTable,
  type ClientMsg,
  type DirtyCell,
  type GameConfig,
  type GameKind,
  type MatchEndReason,
  type MatchMode,
  type PlayerInput,
  type ServerMsg,
  type Side,
  type SimState,
  type StatePayload,
} from '@clash/shared';
import type { WSContext } from 'hono/ws';

import {
  insertMatch,
  listMatches,
  type AppDb,
  type MatchRow,
} from './db.ts';
import {
  loadArenaSettings,
  loadCardTable,
  loadSettings,
  saveArenaSettings,
  saveCardTable,
  saveSettings,
} from './settings.ts';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRACE_MS = 100_000;

type Socket = WSContext;

type Session = {
  id: string;
  name: string;
  ws: Socket | null;
  match: LiveMatch | null;
  side: Side | null;
  input: PlayerInput;
  want: GameKind;
  deck: CardId[];
  grace: ReturnType<typeof setTimeout> | null;
};

type SprayMatch = {
  kind: 'spray';
  id: string;
  mode: MatchMode;
  config: GameConfig;
  sim: SimState;
  p1: Session;
  p2: Session | null;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  pendingDirty: number[];
  lastFullTick: number;
};

type ArenaMatch = {
  kind: 'arena';
  id: string;
  mode: MatchMode;
  config: ArenaConfig;
  sim: ArenaSim;
  p1: Session;
  p2: Session | null;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  lastFullTick: number;
};

type LiveMatch = SprayMatch | ArenaMatch;

export class GameHub {
  private readonly db: AppDb;
  private readonly graceMs: number;
  private readonly sessions = new Map<Socket, Session>();
  private readonly byGuest = new Map<string, Session>();
  private readonly sprayQueue: Session[] = [];
  private readonly arenaQueue: Session[] = [];
  private readonly rooms = new Map<string, { host: Session; game: GameKind }>();
  private settings: GameConfig;
  private arenaSettings: ArenaConfig;
  private cardTable: CardTable;

  constructor(db: AppDb, graceMs = GRACE_MS) {
    this.db = db;
    this.graceMs = graceMs;
    this.settings = loadSettings(db);
    this.arenaSettings = loadArenaSettings(db);
    this.cardTable = loadCardTable(db);
  }

  getSettings(): GameConfig {
    return this.settings;
  }

  setSettings(config: GameConfig): GameConfig {
    this.settings = saveSettings(this.db, config);
    return this.settings;
  }

  getArenaSettings(): ArenaConfig {
    return this.arenaSettings;
  }

  setArenaSettings(config: ArenaConfig): ArenaConfig {
    this.arenaSettings = saveArenaSettings(this.db, config);
    return this.arenaSettings;
  }

  getCardTable(): CardTable {
    return this.cardTable;
  }

  setCardTable(table: CardTable): CardTable {
    this.cardTable = saveCardTable(this.db, table);
    return this.cardTable;
  }

  recentMatches(): MatchRow[] {
    return listMatches(this.db);
  }

  handle(ws: Socket, msg: ClientMsg): void {
    if (msg.type === 'hello') {
      this.hello(ws, msg.guestId, msg.name);
      return;
    }
    const session = this.sessions.get(ws);
    if (session === undefined) {
      this.send(ws, { type: 'error', message: 'say hello first' });
      return;
    }
    switch (msg.type) {
      case 'play_cpu':
        session.want = gameOf(msg);
        session.deck = acceptDeck(msg.deck);
        this.playCpu(session);
        break;
      case 'queue':
        session.want = gameOf(msg);
        session.deck = acceptDeck(msg.deck);
        this.enqueue(session);
        break;
      case 'create_room':
        session.want = gameOf(msg);
        session.deck = acceptDeck(msg.deck);
        this.createRoom(session);
        break;
      case 'join_room':
        session.deck = acceptDeck(msg.deck);
        this.joinRoom(session, msg.code);
        break;
      case 'input':
        session.input = {
          seq: msg.seq,
          dx: msg.dx,
          dy: msg.dy,
          dash: msg.dash,
        };
        break;
      case 'play_card':
        this.playCard(session, msg.cardId, msg.x, msg.y);
        break;
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t, serverT: Date.now() });
        break;
      case 'leave':
        this.leave(session);
        break;
    }
  }

  disconnect(ws: Socket): void {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (session === undefined || session.ws !== ws) return;
    session.ws = null;
    if (this.held(session)) {
      this.armGrace(session);
      return;
    }
    this.byGuest.delete(session.id);
  }

  private hello(ws: Socket, guestId: string, name: string): void {
    const bound = this.sessions.get(ws);
    if (bound !== undefined) {
      this.send(ws, {
        type: 'welcome',
        guestId: bound.id,
        name: bound.name,
        protocol: PROTOCOL_VERSION,
        ...(this.held(bound) ? { resume: true } : {}),
      });
      return;
    }
    const id = guestId.length > 0 ? guestId : crypto.randomUUID();
    const parked = this.byGuest.get(id);
    if (parked !== undefined) {
      this.clearGrace(parked);
      if (parked.ws !== null) this.sessions.delete(parked.ws);
      parked.ws = ws;
      this.sessions.set(ws, parked);
      const resume = this.held(parked);
      this.send(ws, {
        type: 'welcome',
        guestId: parked.id,
        name: parked.name,
        protocol: PROTOCOL_VERSION,
        ...(resume ? { resume: true } : {}),
      });
      if (resume) this.replay(parked);
      return;
    }
    const session: Session = {
      id,
      name: sanitizeName(name, randomName()),
      ws,
      match: null,
      side: null,
      input: { ...NEUTRAL_INPUT },
      want: 'spray',
      deck: acceptDeck(undefined),
      grace: null,
    };
    this.sessions.set(ws, session);
    this.byGuest.set(session.id, session);
    this.send(ws, {
      type: 'welcome',
      guestId: session.id,
      name: session.name,
      protocol: PROTOCOL_VERSION,
    });
  }

  private playCpu(session: Session): void {
    if (session.match !== null) {
      this.send(session.ws, { type: 'error', message: 'already in a match' });
      return;
    }
    this.removeFromQueue(session);
    this.removeFromRooms(session);
    this.startMatch(session.want, 'cpu', session, null);
  }

  private enqueue(session: Session): void {
    if (session.match !== null) return;
    this.removeFromRooms(session);
    const q = session.want === 'arena' ? this.arenaQueue : this.sprayQueue;
    if (q.includes(session)) {
      this.send(session.ws, { type: 'queued' });
      return;
    }
    const partner = q.shift();
    if (partner === undefined || partner === session) {
      q.push(session);
      this.send(session.ws, { type: 'queued' });
      this.send(session.ws, {
        type: 'waiting',
        message: 'Searching the void…',
      });
      return;
    }
    this.startMatch(session.want, 'pvp', partner, session);
  }

  private createRoom(session: Session): void {
    if (session.match !== null) return;
    this.removeFromQueue(session);
    this.removeFromRooms(session);
    const code = this.freshRoomCode();
    this.rooms.set(code, { host: session, game: session.want });
    this.send(session.ws, { type: 'room', code });
    this.send(session.ws, {
      type: 'waiting',
      message: `Room ${code} · waiting for a hunter`,
    });
  }

  private joinRoom(session: Session, rawCode: string): void {
    if (session.match !== null) return;
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (room === undefined) {
      this.send(session.ws, { type: 'error', message: 'room not found' });
      return;
    }
    if (room.host === session) {
      this.send(session.ws, { type: 'error', message: 'already in this room' });
      return;
    }
    this.rooms.delete(code);
    this.removeFromQueue(session);
    this.startMatch(room.game, 'pvp', room.host, session);
  }

  private leave(session: Session): void {
    this.removeFromQueue(session);
    this.removeFromRooms(session);
    if (session.match !== null && session.side !== null) {
      const winner: Side = session.side === 1 ? 2 : 1;
      this.endMatch(session.match, winner, 'forfeit');
    }
  }

  private playCard(
    session: Session,
    cardId: Parameters<typeof tryPlay>[3]['cardId'],
    x: number,
    y: number,
  ): void {
    const match = session.match;
    if (match === null || match.kind !== 'arena' || session.side === null) {
      this.send(session.ws, { type: 'error', message: 'not in an arena' });
      return;
    }
    const ok = tryPlay(match.sim, match.config, session.side, { cardId, x, y });
    if (!ok) {
      this.send(session.ws, { type: 'error', message: 'cannot play that' });
    }
  }

  private startMatch(
    game: GameKind,
    mode: MatchMode,
    p1: Session,
    p2: Session | null,
  ): void {
    if (game === 'arena') this.startArena(mode, p1, p2);
    else this.startSpray(mode, p1, p2);
  }

  private startSpray(mode: MatchMode, p1: Session, p2: Session | null): void {
    const config: GameConfig = { ...this.settings };
    const sim = createSim(config, Math.random);
    const match = {
      kind: 'spray' as const,
      id: crypto.randomUUID(),
      mode,
      config,
      sim,
      p1,
      p2,
      startedAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      pendingDirty: [] as number[],
      lastFullTick: 0,
    } satisfies Omit<SprayMatch, 'timer'> & {
      timer: ReturnType<typeof setInterval>;
    };
    this.bindPlayers(match, p1, p2);
    const tickMs = Math.max(8, Math.round(1000 / config.tickHz));
    match.timer = setInterval(() => this.tickSpray(match), tickMs);
    const p2Name = p2?.name ?? 'VOID-CPU';
    this.send(p1.ws, {
      type: 'match_start',
      game: 'spray',
      matchId: match.id,
      mode,
      side: 1,
      names: { p1: p1.name, p2: p2Name },
      config,
      state: this.spraySnapshot(match, 1, true),
    });
    if (p2 !== null) {
      this.send(p2.ws, {
        type: 'match_start',
        game: 'spray',
        matchId: match.id,
        mode,
        side: 2,
        names: { p1: p1.name, p2: p2.name },
        config,
        state: this.spraySnapshot(match, 2, true),
      });
    }
  }

  private startArena(mode: MatchMode, p1: Session, p2: Session | null): void {
    const config: ArenaConfig = { ...this.arenaSettings };
    const cards = mergeCardTable(this.cardTable);
    const sim = createArena(config, Math.random, cards, {
      p1: p1.deck,
      p2: p2?.deck,
    });
    const match = {
      kind: 'arena' as const,
      id: crypto.randomUUID(),
      mode,
      config,
      sim,
      p1,
      p2,
      startedAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      lastFullTick: 0,
    } satisfies Omit<ArenaMatch, 'timer'> & {
      timer: ReturnType<typeof setInterval>;
    };
    this.bindPlayers(match, p1, p2);
    const tickMs = Math.max(8, Math.round(1000 / config.tickHz));
    match.timer = setInterval(() => this.tickArena(match), tickMs);
    const p2Name = p2?.name ?? 'VOID-CPU';
    this.send(p1.ws, {
      type: 'match_start',
      game: 'arena',
      matchId: match.id,
      mode,
      side: 1,
      names: { p1: p1.name, p2: p2Name },
      config,
      cards,
      state: this.arenaSnapshot(match, 1, true),
    });
    if (p2 !== null) {
      this.send(p2.ws, {
        type: 'match_start',
        game: 'arena',
        matchId: match.id,
        mode,
        side: 2,
        names: { p1: p1.name, p2: p2.name },
        config,
        cards,
        state: this.arenaSnapshot(match, 2, true),
      });
    }
  }

  private bindPlayers(match: LiveMatch, p1: Session, p2: Session | null): void {
    p1.match = match;
    p1.side = 1;
    p1.input = { ...NEUTRAL_INPUT };
    if (p2 !== null) {
      p2.match = match;
      p2.side = 2;
      p2.input = { ...NEUTRAL_INPUT };
    }
  }

  private tickSpray(match: SprayMatch): void {
    if (match.sim.over) {
      this.endMatch(match, match.sim.winner, match.sim.reason ?? 'time');
      return;
    }
    const in1 = match.p1.input;
    const in2 =
      match.p2?.input ??
      (phaseOf(match.sim.tick + 1, match.config) === 'play'
        ? aiInput(match.sim, match.config, 2)
        : NEUTRAL_INPUT);
    const { dirty } = step(match.sim, match.config, in1, in2);
    match.pendingDirty.push(...dirty);
    const full =
      match.sim.tick === 1 ||
      match.sim.tick - match.lastFullTick >= match.config.tickHz * 2;
    if (full) match.lastFullTick = match.sim.tick;
    this.send(match.p1.ws, {
      type: 'state',
      game: 'spray',
      state: this.spraySnapshot(match, 1, full),
    });
    if (match.p2 !== null) {
      this.send(match.p2.ws, {
        type: 'state',
        game: 'spray',
        state: this.spraySnapshot(match, 2, full),
      });
    }
    match.pendingDirty.length = 0;
    if (match.sim.over) {
      this.endMatch(match, match.sim.winner, match.sim.reason ?? 'time');
    }
  }

  private tickArena(match: ArenaMatch): void {
    if (match.sim.over) {
      this.endMatch(match, match.sim.winner, match.sim.reason ?? 'time');
      return;
    }
    if (match.p2 === null) {
      const cmd = arenaAi(match.sim, match.config, 2);
      if (cmd !== null) tryPlay(match.sim, match.config, 2, cmd);
    }
    stepArena(match.sim, match.config);
    const full =
      match.sim.tick === 1 ||
      match.sim.tick - match.lastFullTick >= match.config.tickHz * 2;
    if (full) match.lastFullTick = match.sim.tick;
    this.send(match.p1.ws, {
      type: 'state',
      game: 'arena',
      state: this.arenaSnapshot(match, 1, full),
    });
    if (match.p2 !== null) {
      this.send(match.p2.ws, {
        type: 'state',
        game: 'arena',
        state: this.arenaSnapshot(match, 2, full),
      });
    }
    match.sim.dirty.length = 0;
    if (match.sim.over) {
      this.endMatch(match, match.sim.winner, match.sim.reason ?? 'time');
    }
  }

  private endMatch(
    match: LiveMatch,
    winner: 0 | 1 | 2,
    reason: MatchEndReason,
  ): void {
    clearInterval(match.timer);
    if (match.p1.match !== match && match.p2?.match !== match) return;
    if (match.kind === 'spray') {
      if (!match.sim.over) {
        if (reason === 'forfeit' && (winner === 1 || winner === 2)) {
          forfeit(match.sim, winner);
        } else {
          match.sim.over = true;
          match.sim.winner = winner;
          match.sim.reason =
            reason === 'forfeit' || reason === 'dominate' || reason === 'time'
              ? reason
              : 'time';
        }
      }
      const scores = countScores(match.sim.grid);
      this.finish(match, match.sim.winner, match.sim.reason ?? reason, scores);
      return;
    }
    if (!match.sim.over) {
      if (reason === 'forfeit' && (winner === 1 || winner === 2)) {
        forfeitArena(match.sim, winner);
      } else {
        match.sim.over = true;
        match.sim.winner = winner;
        match.sim.reason =
          reason === 'king' || reason === 'paint' || reason === 'forfeit' || reason === 'time'
            ? reason
            : 'time';
      }
    }
    const scores = countScores(match.sim.grid);
    this.finish(match, match.sim.winner, match.sim.reason ?? reason, scores);
  }

  private finish(
    match: LiveMatch,
    winner: 0 | 1 | 2,
    reason: MatchEndReason,
    scores: { p1: number; p2: number; empty: number },
  ): void {
    if (match.kind === 'spray') {
      this.send(match.p1.ws, {
        type: 'state',
        game: 'spray',
        state: this.spraySnapshot(match, 1, true),
      });
      if (match.p2 !== null) {
        this.send(match.p2.ws, {
          type: 'state',
          game: 'spray',
          state: this.spraySnapshot(match, 2, true),
        });
      }
    } else {
      this.send(match.p1.ws, {
        type: 'state',
        game: 'arena',
        state: this.arenaSnapshot(match, 1, true),
      });
      if (match.p2 !== null) {
        this.send(match.p2.ws, {
          type: 'state',
          game: 'arena',
          state: this.arenaSnapshot(match, 2, true),
        });
      }
    }
    const end: ServerMsg = {
      type: 'match_end',
      winner,
      scores,
      reason,
    };
    this.send(match.p1.ws, end);
    if (match.p2 !== null) this.send(match.p2.ws, end);
    insertMatch(this.db, {
      id: match.id,
      mode: `${match.kind}-${match.mode}`,
      p1_name: match.p1.name,
      p2_name: match.p2?.name ?? 'VOID-CPU',
      p1_score: scores.p1,
      p2_score: scores.p2,
      winner,
      reason,
      duration_ms: Date.now() - match.startedAt,
      created_at: Date.now(),
    });
    this.release(match.p1);
    if (match.p2 !== null) this.release(match.p2);
  }

  private release(session: Session): void {
    session.match = null;
    session.side = null;
    session.input = { ...NEUTRAL_INPUT };
    this.clearGrace(session);
    if (session.ws === null) this.byGuest.delete(session.id);
  }

  private spraySnapshot(
    match: SprayMatch,
    side: Side,
    full: boolean,
  ): StatePayload {
    const you = playerOf(match.sim, side);
    const opp = playerOf(match.sim, side === 1 ? 2 : 1);
    const dirty: DirtyCell[] = full
      ? []
      : uniqueDirty(match.pendingDirty, match.sim.grid);
    const payload: StatePayload = {
      tick: match.sim.tick,
      phase: match.sim.over ? 'over' : phaseOf(match.sim.tick, match.config),
      timeLeft: timeLeftSec(match.sim.tick, match.config),
      countdownLeft: countdownLeftSec(match.sim.tick, match.config),
      you: {
        x: you.x,
        y: you.y,
        dashReadyIn: dashReadyIn(you, match.sim.tick),
      },
      opp: {
        x: opp.x,
        y: opp.y,
        dashReadyIn: dashReadyIn(opp, match.sim.tick),
      },
      scores: countScores(match.sim.grid),
      dirty,
      winner: match.sim.winner,
      mapName: match.sim.mapName,
    };
    if (full) payload.grid = encodeGrid(match.sim.grid);
    return payload;
  }

  private arenaSnapshot(
    match: ArenaMatch,
    side: Side,
    full: boolean,
  ): ReturnType<typeof arenaView> {
    const view = arenaView(match.sim, match.config, side, full);
    if (full) view.grid = encodeGrid(match.sim.grid);
    return view;
  }

  private removeFromQueue(session: Session): void {
    for (const q of [this.sprayQueue, this.arenaQueue]) {
      const i = q.indexOf(session);
      if (i >= 0) q.splice(i, 1);
    }
  }

  private removeFromRooms(session: Session): void {
    for (const [code, room] of this.rooms) {
      if (room.host === session) this.rooms.delete(code);
    }
  }

  private freshRoomCode(): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) {
        const idx = Math.floor(Math.random() * ROOM_ALPHABET.length);
        code += ROOM_ALPHABET[idx] ?? 'A';
      }
      if (!this.rooms.has(code)) return code;
    }
    return crypto.randomUUID().slice(0, 4).toUpperCase();
  }

  private held(session: Session): boolean {
    if (session.match !== null) return true;
    if (this.sprayQueue.includes(session) || this.arenaQueue.includes(session)) return true;
    for (const room of this.rooms.values()) {
      if (room.host === session) return true;
    }
    return false;
  }

  private armGrace(session: Session): void {
    this.clearGrace(session);
    session.grace = setTimeout(() => this.expire(session), this.graceMs);
  }

  private clearGrace(session: Session): void {
    if (session.grace === null) return;
    clearTimeout(session.grace);
    session.grace = null;
  }

  private expire(session: Session): void {
    session.grace = null;
    if (session.ws !== null) return;
    this.removeFromQueue(session);
    this.removeFromRooms(session);
    if (session.match !== null && session.side !== null) {
      const winner: Side = session.side === 1 ? 2 : 1;
      this.endMatch(session.match, winner, 'forfeit');
    }
    this.byGuest.delete(session.id);
  }

  private replay(session: Session): void {
    const match = session.match;
    if (match !== null && session.side !== null) {
      this.replayMatch(session, match);
      return;
    }
    if (this.sprayQueue.includes(session) || this.arenaQueue.includes(session)) {
      this.send(session.ws, { type: 'queued' });
      this.send(session.ws, { type: 'waiting', message: 'Searching the void…' });
      return;
    }
    for (const [code, room] of this.rooms) {
      if (room.host !== session) continue;
      this.send(session.ws, { type: 'room', code });
      this.send(session.ws, {
        type: 'waiting',
        message: `Room ${code} · waiting for a hunter`,
      });
      return;
    }
  }

  private replayMatch(session: Session, match: LiveMatch): void {
    const side = session.side;
    if (side === null) return;
    const p2Name = match.p2?.name ?? 'VOID-CPU';
    if (match.kind === 'spray') {
      this.send(session.ws, {
        type: 'match_start',
        game: 'spray',
        matchId: match.id,
        mode: match.mode,
        side,
        names: { p1: match.p1.name, p2: p2Name },
        config: match.config,
        state: this.spraySnapshot(match, side, true),
      });
      return;
    }
    this.send(session.ws, {
      type: 'match_start',
      game: 'arena',
      matchId: match.id,
      mode: match.mode,
      side,
      names: { p1: match.p1.name, p2: p2Name },
      config: match.config,
      cards: match.sim.cards,
      state: this.arenaSnapshot(match, side, true),
    });
  }

  private send(ws: Socket | null, msg: ServerMsg): void {
    if (ws === null) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }
}

function uniqueDirty(indices: readonly number[], grid: Uint8Array): DirtyCell[] {
  const seen = new Set<number>();
  const out: DirtyCell[] = [];
  for (const i of indices) {
    if (seen.has(i)) continue;
    seen.add(i);
    const v = grid[i];
    if (v === 1 || v === 2) out.push({ i, v });
    else if (v === 0) out.push({ i, v: 0 });
  }
  return out;
}
