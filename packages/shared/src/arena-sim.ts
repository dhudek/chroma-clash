import { CARD_CATALOG, CARD_IDS, cardOf, type CardId } from './cards.ts';
import type { ArenaConfig } from './arena-config.ts';
import { countScores, paintAt } from './sim.ts';
import type { Phase, Side, Winner } from './kinds.ts';
import type { Rng } from './ai.ts';

export type UnitRole = 'melee' | 'ranged' | 'flying' | 'building';

export type ArenaUnit = {
  id: number;
  cardId: CardId;
  side: Side;
  role: UnitRole;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  range: number;
  dmg: number;
  attackTicks: number;
  cooldown: number;
  paint: number;
  lifetime: number | null;
};

export type ArenaTower = {
  id: number;
  side: Side;
  slot: 'king' | 'left' | 'right';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  range: number;
  dmg: number;
  cooldown: number;
  attackTicks: number;
  active: boolean;
};

export type ArenaProjectile = {
  id: number;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  paint: number;
  targetKind: 'unit' | 'tower';
  targetId: number;
};

export type ArenaPlayer = {
  energy: number;
  hand: CardId[];
  deck: CardId[];
};

export type ArenaSim = {
  tick: number;
  grid: Uint8Array;
  units: ArenaUnit[];
  towers: ArenaTower[];
  projectiles: ArenaProjectile[];
  p1: ArenaPlayer;
  p2: ArenaPlayer;
  nextId: number;
  over: boolean;
  winner: Winner;
  reason: 'time' | 'king' | 'forfeit' | 'paint' | null;
  dirty: number[];
};

export type PlayCommand = {
  cardId: CardId;
  x: number;
  y: number;
};

export function arenaCountdownTicks(config: ArenaConfig): number {
  return config.countdownSec * config.tickHz;
}

export function arenaPlayTicks(config: ArenaConfig): number {
  return config.matchSec * config.tickHz;
}

export function arenaPhase(tick: number, config: ArenaConfig): Phase {
  const start = arenaCountdownTicks(config);
  const end = start + arenaPlayTicks(config);
  if (tick <= start) return 'countdown';
  if (tick > end) return 'over';
  return 'play';
}

export function arenaTimeLeft(tick: number, config: ArenaConfig): number {
  const start = arenaCountdownTicks(config);
  if (tick <= start) return config.matchSec;
  const end = start + arenaPlayTicks(config);
  return Math.max(0, (end - tick) / config.tickHz);
}

export function arenaCountdownLeft(tick: number, config: ArenaConfig): number {
  const start = arenaCountdownTicks(config);
  if (tick >= start) return 0;
  return (start - tick) / config.tickHz;
}

export function isDoubleElixir(tick: number, config: ArenaConfig): boolean {
  if (config.doubleElixirSec <= 0) return false;
  return arenaTimeLeft(tick, config) <= config.doubleElixirSec &&
    arenaPhase(tick, config) === 'play';
}

export function shuffleInPlace<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

export function createArena(config: ArenaConfig, rng: Rng = Math.random): ArenaSim {
  const p1 = makePlayer(config, rng);
  const p2 = makePlayer(config, rng);
  const sim: ArenaSim = {
    tick: 0,
    grid: new Uint8Array(config.arenaW * config.arenaH),
    units: [],
    towers: [],
    projectiles: [],
    p1,
    p2,
    nextId: 1,
    over: false,
    winner: 0,
    reason: null,
    dirty: [],
  };
  paintTerritory(sim, config);
  placeTowers(sim, config);
  return sim;
}

function paintTerritory(sim: ArenaSim, config: ArenaConfig): void {
  const w = config.arenaW;
  const h = config.arenaH;
  const mid = Math.floor(h / 2);
  for (let y = 0; y < h; y += 1) {
    const owner: 1 | 2 = y < mid ? 1 : 2;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      sim.grid[i] = owner;
    }
  }
}

function makePlayer(config: ArenaConfig, rng: Rng): ArenaPlayer {
  const deck: CardId[] = [...CARD_IDS];
  shuffleInPlace(deck, rng);
  const hand = deck.splice(0, 4);
  return {
    energy: config.energyStart,
    hand,
    deck,
  };
}

function placeTowers(sim: ArenaSim, config: ArenaConfig): void {
  const w = config.arenaW;
  const h = config.arenaH;
  const atk = Math.max(8, Math.round(0.85 * config.tickHz));
  const mk = (
    side: Side,
    slot: ArenaTower['slot'],
    x: number,
    y: number,
    hp: number,
    active: boolean,
  ): ArenaTower => {
    const id = sim.nextId;
    sim.nextId += 1;
    return {
      id,
      side,
      slot,
      x,
      y,
      hp,
      maxHp: hp,
      range: slot === 'king' ? config.kingRange : config.towerRange,
      dmg: config.towerDmg,
      cooldown: 0,
      attackTicks: atk,
      active,
    };
  };
  sim.towers.push(
    mk(1, 'king', w * 0.5, 2.4, config.kingHp, true),
    mk(1, 'left', w * 0.28, 7.2, config.sideHp, true),
    mk(1, 'right', w * 0.72, 7.2, config.sideHp, true),
    mk(2, 'king', w * 0.5, h - 2.4, config.kingHp, true),
    mk(2, 'left', w * 0.28, h - 7.2, config.sideHp, true),
    mk(2, 'right', w * 0.72, h - 7.2, config.sideHp, true),
  );
}

export function playerOfArena(sim: ArenaSim, side: Side): ArenaPlayer {
  return side === 1 ? sim.p1 : sim.p2;
}

export function inBounds(config: ArenaConfig, x: number, y: number): boolean {
  return x >= 0.4 && y >= 0.4 && x <= config.arenaW - 0.4 && y <= config.arenaH - 0.4;
}

export function ownerAt(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): 0 | 1 | 2 {
  const cx = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const v = grid[cy * w + cx];
  if (v === 1 || v === 2) return v;
  return 0;
}

export function canDropAt(
  grid: Uint8Array,
  config: ArenaConfig,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): boolean {
  const def = cardOf(cardId);
  if (def === null) return false;
  if (!inBounds(config, x, y)) return false;
  if (def.role === 'spell') return true;
  return ownerAt(grid, config.arenaW, config.arenaH, x, y) === side;
}

export function canPlayAt(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): boolean {
  return canDropAt(sim.grid, config, side, cardId, x, y);
}

export function tryPlay(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  cmd: PlayCommand,
): boolean {
  if (sim.over) return false;
  if (arenaPhase(sim.tick, config) !== 'play') return false;
  const def = cardOf(cmd.cardId);
  if (def === null) return false;
  const player = playerOfArena(sim, side);
  const idx = player.hand.indexOf(cmd.cardId);
  if (idx < 0) return false;
  if (player.energy + 1e-6 < def.cost) return false;
  if (!canPlayAt(sim, config, side, cmd.cardId, cmd.x, cmd.y)) return false;

  player.energy -= def.cost;
  const drawn = player.deck.shift();
  player.deck.push(cmd.cardId);
  if (drawn !== undefined) player.hand[idx] = drawn;

  if (def.role === 'spell') {
    castMeteor(sim, config, side, cmd.x, cmd.y, def);
  } else {
    spawnFromCard(sim, config, side, def, cmd.x, cmd.y);
  }
  return true;
}

function spawnFromCard(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  def: (typeof CARD_CATALOG)[CardId],
  x: number,
  y: number,
): void {
  const n = Math.max(1, def.count);
  for (let i = 0; i < n; i += 1) {
    const ox = n === 1 ? 0 : (i - (n - 1) / 2) * 0.7;
    const oy = n === 1 ? 0 : (i % 2 === 0 ? -0.35 : 0.35);
    spawnUnit(sim, config, side, def, x + ox, y + oy);
  }
}

function spawnUnit(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  def: (typeof CARD_CATALOG)[CardId],
  x: number,
  y: number,
): void {
  const role: UnitRole =
    def.role === 'ranged' || def.role === 'flying' || def.role === 'building'
      ? def.role
      : 'melee';
  const hp = Math.max(1, Math.round(def.hp * config.unitHpMul));
  const id = sim.nextId;
  sim.nextId += 1;
  const lifetime =
    def.lifetimeSec === null ? null : Math.round(def.lifetimeSec * config.tickHz);
  sim.units.push({
    id,
    cardId: def.id,
    side,
    role,
    x: clamp(x, 0.5, config.arenaW - 0.5),
    y: clamp(y, 0.5, config.arenaH - 0.5),
    hp,
    maxHp: hp,
    speed: def.speed,
    range: def.range,
    dmg: def.dmg * config.unitDmgMul,
    attackTicks: Math.max(4, Math.round(def.attackSec * config.tickHz)),
    cooldown: 0,
    paint: def.paint,
    lifetime,
  });
}

function castMeteor(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  x: number,
  y: number,
  def: (typeof CARD_CATALOG)[CardId],
): void {
  paintAt(
    sim.grid,
    { arenaW: config.arenaW, arenaH: config.arenaH, paintRadius: def.paint },
    x,
    y,
    side,
    sim.dirty,
  );
  const r2 = def.range * def.range;
  const dmg = def.dmg * config.unitDmgMul;
  for (const u of sim.units) {
    if (u.side === side || u.hp <= 0) continue;
    const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
    if (d <= r2) u.hp -= dmg;
  }
  for (const t of sim.towers) {
    if (t.side === side || t.hp <= 0) continue;
    const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
    if (d <= r2) {
      t.hp -= dmg * 0.35;
      if (t.slot === 'king') t.active = true;
    }
  }
}

export function forfeitArena(sim: ArenaSim, winner: Side): void {
  sim.over = true;
  sim.winner = winner;
  sim.reason = 'forfeit';
}

export function stepArena(sim: ArenaSim, config: ArenaConfig): void {
  if (sim.over) return;
  sim.tick += 1;
  const phase = arenaPhase(sim.tick, config);
  if (phase === 'countdown') return;
  if (phase === 'over') {
    finishByScore(sim);
    return;
  }

  regenEnergy(sim, config);
  tickUnits(sim, config);
  tickTowers(sim, config);
  tickProjectiles(sim, config);
  pruneDead(sim);
  checkKing(sim);
  checkPaint(sim);
}

function regenEnergy(sim: ArenaSim, config: ArenaConfig): void {
  const mul = isDoubleElixir(sim.tick, config) ? 2 : 1;
  const add = (config.energyPerSec * mul) / config.tickHz;
  sim.p1.energy = Math.min(config.energyMax, sim.p1.energy + add);
  sim.p2.energy = Math.min(config.energyMax, sim.p2.energy + add);
}

function tickUnits(sim: ArenaSim, config: ArenaConfig): void {
  const dt = 1 / config.tickHz;
  for (const u of sim.units) {
    if (u.hp <= 0) continue;
    if (u.lifetime !== null) {
      u.lifetime -= 1;
      if (u.lifetime <= 0) {
        u.hp = 0;
        continue;
      }
    }
    if (u.cooldown > 0) u.cooldown -= 1;
    paintAt(
      sim.grid,
      { arenaW: config.arenaW, arenaH: config.arenaH, paintRadius: u.paint },
      u.x,
      u.y,
      u.side,
      sim.dirty,
    );
    if (u.role === 'building') {
      fireAt(sim, config, u);
      continue;
    }
    const target = nearestEnemy(sim, u);
    if (target === null) continue;
    const dist = Math.hypot(target.x - u.x, target.y - u.y);
    if (dist <= u.range + 0.05) {
      fireAt(sim, config, u);
      continue;
    }
    const nx = (target.x - u.x) / (dist || 1);
    const ny = (target.y - u.y) / (dist || 1);
    u.x = clamp(u.x + nx * u.speed * dt, 0.4, config.arenaW - 0.4);
    u.y = clamp(u.y + ny * u.speed * dt, 0.4, config.arenaH - 0.4);
  }
}

function tickTowers(sim: ArenaSim, config: ArenaConfig): void {
  for (const t of sim.towers) {
    if (t.hp <= 0 || !t.active) continue;
    if (t.cooldown > 0) t.cooldown -= 1;
    const unit = nearestEnemyUnit(sim, t.side, t.x, t.y, t.range);
    if (unit === null) continue;
    if (t.cooldown > 0) continue;
    t.cooldown = t.attackTicks;
    spawnProjectile(sim, t.side, t.x, t.y, unit.x, unit.y, t.dmg, 0.35, {
      kind: 'unit',
      id: unit.id,
    });
  }
}

function fireAt(sim: ArenaSim, config: ArenaConfig, u: ArenaUnit): void {
  if (u.cooldown > 0 || u.hp <= 0) return;
  const target = nearestEnemy(sim, u);
  if (target === null) return;
  const dist = Math.hypot(target.x - u.x, target.y - u.y);
  if (dist > u.range + 0.2) return;
  u.cooldown = u.attackTicks;
  if (u.role === 'ranged' || u.role === 'building' || u.role === 'flying') {
    spawnProjectile(sim, u.side, u.x, u.y, target.x, target.y, u.dmg, u.paint * 0.5, target.ref);
    return;
  }
  applyHit(sim, config, u.side, target.ref, u.dmg, u.paint, target.x, target.y);
}

function spawnProjectile(
  sim: ArenaSim,
  side: Side,
  x: number,
  y: number,
  tx: number,
  ty: number,
  dmg: number,
  paint: number,
  target: { kind: 'unit' | 'tower'; id: number },
): void {
  const dist = Math.hypot(tx - x, ty - y) || 1;
  const speed = 18;
  const id = sim.nextId;
  sim.nextId += 1;
  sim.projectiles.push({
    id,
    side,
    x,
    y,
    vx: ((tx - x) / dist) * speed,
    vy: ((ty - y) / dist) * speed,
    dmg,
    paint,
    targetKind: target.kind,
    targetId: target.id,
  });
}

function tickProjectiles(sim: ArenaSim, config: ArenaConfig): void {
  const dt = 1 / config.tickHz;
  const keep: ArenaProjectile[] = [];
  for (const p of sim.projectiles) {
    const dest = projectileDest(sim, p);
    if (dest !== null) {
      const dist = Math.hypot(dest.x - p.x, dest.y - p.y) || 1;
      const speed = Math.hypot(p.vx, p.vy) || 13;
      p.vx = ((dest.x - p.x) / dist) * speed;
      p.vy = ((dest.y - p.y) / dist) * speed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const hit = dest !== null ? Math.hypot(dest.x - p.x, dest.y - p.y) < 0.45 : false;
    const oob = !inBounds(config, p.x, p.y);
    if (hit || oob) {
      if (hit && dest !== null) {
        applyHit(sim, config, p.side, { kind: p.targetKind, id: p.targetId }, p.dmg, p.paint, p.x, p.y);
      }
      continue;
    }
    keep.push(p);
  }
  sim.projectiles = keep;
}

function projectileDest(
  sim: ArenaSim,
  p: ArenaProjectile,
): { x: number; y: number } | null {
  if (p.targetKind === 'unit') {
    const u = sim.units.find((x) => x.id === p.targetId && x.hp > 0);
    return u === undefined ? null : { x: u.x, y: u.y };
  }
  const t = sim.towers.find((x) => x.id === p.targetId && x.hp > 0);
  return t === undefined ? null : { x: t.x, y: t.y };
}

function applyHit(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  target: { kind: 'unit' | 'tower'; id: number },
  dmg: number,
  paint: number,
  x: number,
  y: number,
): void {
  paintAt(
    sim.grid,
    { arenaW: config.arenaW, arenaH: config.arenaH, paintRadius: Math.max(0.4, paint) },
    x,
    y,
    side,
    sim.dirty,
  );
  if (target.kind === 'unit') {
    const u = sim.units.find((x) => x.id === target.id);
    if (u !== undefined && u.hp > 0) u.hp -= dmg;
    return;
  }
  const t = sim.towers.find((x) => x.id === target.id);
  if (t === undefined || t.hp <= 0) return;
  t.hp -= dmg;
  if (t.slot === 'king') t.active = true;
}

type Target = {
  x: number;
  y: number;
  ref: { kind: 'unit' | 'tower'; id: number };
};

function nearestEnemy(sim: ArenaSim, attacker: ArenaUnit): Target | null {
  const hitsAir = attacker.role !== 'melee';
  const x = attacker.x;
  const y = attacker.y;
  const side = attacker.side;
  let best: Target | null = null;
  let bestD = Infinity;
  for (const u of sim.units) {
    if (u.side === side || u.hp <= 0) continue;
    if (u.role === 'flying' && !hitsAir) continue;
    const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
    if (d < bestD) {
      bestD = d;
      best = { x: u.x, y: u.y, ref: { kind: 'unit', id: u.id } };
    }
  }
  for (const t of sim.towers) {
    if (t.side === side || t.hp <= 0) continue;
    const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
    if (d < bestD) {
      bestD = d;
      best = { x: t.x, y: t.y, ref: { kind: 'tower', id: t.id } };
    }
  }
  return best;
}

function nearestEnemyUnit(
  sim: ArenaSim,
  side: Side,
  x: number,
  y: number,
  range: number,
): ArenaUnit | null {
  let best: ArenaUnit | null = null;
  let bestD = range * range;
  for (const u of sim.units) {
    if (u.side === side || u.hp <= 0) continue;
    const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

function pruneDead(sim: ArenaSim): void {
  sim.units = sim.units.filter((u) => u.hp > 0);
  for (const t of sim.towers) {
    if (t.hp < 0) t.hp = 0;
  }
}

function checkKing(sim: ArenaSim): void {
  const k1 = sim.towers.find((t) => t.side === 1 && t.slot === 'king');
  const k2 = sim.towers.find((t) => t.side === 2 && t.slot === 'king');
  if (k1 !== undefined && k1.hp <= 0) {
    sim.over = true;
    sim.winner = 2;
    sim.reason = 'king';
    return;
  }
  if (k2 !== undefined && k2.hp <= 0) {
    sim.over = true;
    sim.winner = 1;
    sim.reason = 'king';
  }
}

function checkPaint(sim: ArenaSim): void {
  if (sim.over) return;
  const scores = countScores(sim.grid);
  if (scores.p1 > 0 && scores.p2 === 0) {
    sim.over = true;
    sim.winner = 1;
    sim.reason = 'paint';
    return;
  }
  if (scores.p2 > 0 && scores.p1 === 0) {
    sim.over = true;
    sim.winner = 2;
    sim.reason = 'paint';
  }
}

function finishByScore(sim: ArenaSim): void {
  const paint = countScores(sim.grid);
  sim.winner = paint.p1 === paint.p2 ? 0 : paint.p1 > paint.p2 ? 1 : 2;
  sim.over = true;
  sim.reason = 'time';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function worldToView(
  side: Side,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  if (side === 1) return { x, y: h - y };
  return { x: w - x, y };
}

export function viewToWorld(
  side: Side,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  if (side === 1) return { x, y: h - y };
  return { x: w - x, y };
}

export type UnitView = {
  id: number;
  cardId: CardId;
  side: Side;
  role: UnitRole;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
};

export type TowerView = {
  id: number;
  side: Side;
  slot: ArenaTower['slot'];
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  active: boolean;
};

export type ArenaView = {
  tick: number;
  phase: Phase;
  timeLeft: number;
  countdownLeft: number;
  winner: Winner;
  energy: number;
  energyMax: number;
  hand: CardId[];
  next: CardId | null;
  units: UnitView[];
  towers: TowerView[];
  projectiles: { id: number; x: number; y: number; side: Side }[];
  scores: { p1: number; p2: number; empty: number };
  dirty: { i: number; v: 0 | 1 | 2 }[];
  grid?: string;
  doubleElixir: boolean;
};

export function arenaView(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  full: boolean,
): ArenaView {
  const you = playerOfArena(sim, side);
  const dirty = full
    ? []
    : uniqueDirty(sim.dirty, sim.grid);
  const view: ArenaView = {
    tick: sim.tick,
    phase: sim.over ? 'over' : arenaPhase(sim.tick, config),
    timeLeft: arenaTimeLeft(sim.tick, config),
    countdownLeft: arenaCountdownLeft(sim.tick, config),
    winner: sim.winner,
    energy: you.energy,
    energyMax: config.energyMax,
    hand: [...you.hand],
    next: you.deck[0] ?? null,
    units: sim.units.map((u) => ({
      id: u.id,
      cardId: u.cardId,
      side: u.side,
      role: u.role,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
    })),
    towers: sim.towers.map((t) => ({
      id: t.id,
      side: t.side,
      slot: t.slot,
      x: t.x,
      y: t.y,
      hp: t.hp,
      maxHp: t.maxHp,
      active: t.active,
    })),
    projectiles: sim.projectiles.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      side: p.side,
    })),
    scores: countScores(sim.grid),
    dirty,
    doubleElixir: isDoubleElixir(sim.tick, config),
  };
  return view;
}

function uniqueDirty(
  indices: readonly number[],
  grid: Uint8Array,
): { i: number; v: 0 | 1 | 2 }[] {
  const seen = new Set<number>();
  const out: { i: number; v: 0 | 1 | 2 }[] = [];
  for (const i of indices) {
    if (seen.has(i)) continue;
    seen.add(i);
    const v = grid[i];
    if (v === 0 || v === 1 || v === 2) out.push({ i, v });
  }
  return out;
}
