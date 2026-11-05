import {
  CARD_CATALOG,
  DEFAULT_DECK,
  legalDeck,
  defaultCardTable,
  mergeCardTable,
  tunedCard,
  type CardId,
  type CardTable,
} from './cards.ts';
import type { ArenaConfig } from './arena-config.ts';
import { countScores, paintAt } from './sim.ts';
import type { Phase, Side, Winner } from './kinds.ts';
import type { Rng } from './ai.ts';
import {
  BLOCKED,
  MAP_NAMES,
  bfsFirstStep,
  blockedAt,
  fieldScores,
  claimHalves,
  firstStep,
  rollMap,
  slide,
  type MapId,
} from './maps.ts';

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
  /** Increments once each time this unit actually swings, shoots, or casts. */
  swing: number;
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
  targetKind: 'unit' | 'tower' | 'ground';
  targetId: number;
  aimX: number;
  aimY: number;
};

export type ArenaPlayer = {
  energy: number;
  hand: CardId[];
  deck: CardId[];
};

export type ArenaSim = {
  tick: number;
  grid: Uint8Array;
  mapId: MapId;
  mapName: string;
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
  cards: CardTable;
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

export function createArena(
  config: ArenaConfig,
  rng: Rng = Math.random,
  cards: CardTable = defaultCardTable(),
  decks?: { p1?: readonly CardId[]; p2?: readonly CardId[] },
): ArenaSim {
  const grid = new Uint8Array(config.arenaW * config.arenaH);
  const mapId = rollMap(grid, config.arenaW, config.arenaH, rng);
  claimHalves(grid, config.arenaW, config.arenaH, rng);
  const p1 = makePlayer(config, rng, decks?.p1);
  const p2 = makePlayer(config, rng, decks?.p2);
  return {
    tick: 0,
    grid,
    mapId,
    mapName: MAP_NAMES[mapId],
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
    cards: mergeCardTable(cards),
  };
}

function makePlayer(
  config: ArenaConfig,
  rng: Rng,
  chosen?: readonly CardId[],
): ArenaPlayer {
  const deck: CardId[] =
    chosen !== undefined && legalDeck(chosen) ? [...chosen] : [...DEFAULT_DECK];
  shuffleInPlace(deck, rng);
  const hand = deck.splice(0, 4);
  return {
    energy: config.energyStart,
    hand,
    deck,
  };
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

/** Top-left cell and exclusive end of the square a card needs. */
export function footprintOf(
  x: number,
  y: number,
  span: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const n = Math.max(1, Math.floor(span));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  return { x0, y0, x1: x0 + n, y1: y0 + n };
}

export function canDropAt(
  grid: Uint8Array,
  config: ArenaConfig,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
  cards?: CardTable,
): boolean {
  const def = tunedCard(cards, cardId);
  if (def === null) return false;
  if (!inBounds(config, x, y)) return false;
  if (def.role === 'spell') return !blockedAt(grid, config.arenaW, config.arenaH, x, y);
  const box = footprintOf(x, y, def.span);
  const w = config.arenaW;
  const h = config.arenaH;
  if (box.x0 < 0 || box.y0 < 0 || box.x1 > w || box.y1 > h) return false;
  for (let cy = box.y0; cy < box.y1; cy += 1) {
    for (let cx = box.x0; cx < box.x1; cx += 1) {
      if (grid[cy * w + cx] !== side) return false;
    }
  }
  return true;
}

export function canPlayAt(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  cardId: CardId,
  x: number,
  y: number,
): boolean {
  return canDropAt(sim.grid, config, side, cardId, x, y, sim.cards);
}

export function tryPlay(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  cmd: PlayCommand,
): boolean {
  if (sim.over) return false;
  if (arenaPhase(sim.tick, config) !== 'play') return false;
  const def = tunedCard(sim.cards, cmd.cardId);
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
    const spot = openNear(sim, config, x + ox, y + oy);
    spawnUnit(sim, config, side, def, spot.x, spot.y);
  }
}

function openNear(
  sim: ArenaSim,
  config: ArenaConfig,
  x: number,
  y: number,
): { x: number; y: number } {
  if (!blockedAt(sim.grid, config.arenaW, config.arenaH, x, y) && inBounds(config, x, y)) {
    return { x, y };
  }
  for (let r = 1; r <= 4; r += 1) {
    for (let a = 0; a < 8; a += 1) {
      const ang = (a / 8) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r;
      const ny = y + Math.sin(ang) * r;
      if (!inBounds(config, nx, ny)) continue;
      if (!blockedAt(sim.grid, config.arenaW, config.arenaH, nx, ny)) {
        return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
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
    swing: 0,
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

const CHASE_RANGE = 9;

function tickUnits(sim: ArenaSim, config: ArenaConfig): void {
  const dt = 1 / config.tickHz;
  const w = config.arenaW;
  const h = config.arenaH;
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
      { arenaW: w, arenaH: h, paintRadius: u.paint },
      u.x,
      u.y,
      u.side,
      sim.dirty,
    );
    const engaged = targetInRange(sim, u);
    if (engaged !== null) {
      fireAt(sim, config, u, engaged);
      continue;
    }
    fireGround(sim, config, u);
    if (u.role === 'building') continue;
    const target = nearestEnemy(sim, u);
    if (target !== null) {
      const dist = Math.hypot(target.x - u.x, target.y - u.y);
      if (dist <= CHASE_RANGE) {
        const way =
          u.role === 'flying'
            ? { x: target.x, y: target.y }
            : firstStep(sim.grid, w, h, u.x, u.y, target.x, target.y);
        if (way !== null && stepToward(sim, config, u, way.x, way.y, dt)) continue;
      }
    }
    const paintWay =
      u.role === 'flying'
        ? flyPaintGoal(sim.grid, w, h, u)
        : bfsFirstStep(sim.grid, w, h, u.x, u.y, (cx, cy, dist) =>
            paintScore(sim.grid, w, h, u, cx, cy, dist),
          );
    if (paintWay !== null && stepToward(sim, config, u, paintWay.x, paintWay.y, dt)) continue;
    wander(sim, config, u, dt);
  }
}

function paintScore(
  grid: Uint8Array,
  w: number,
  h: number,
  u: ArenaUnit,
  cx: number,
  cy: number,
  dist: number,
): number | null {
  const v = grid[cy * w + cx] ?? 0;
  if (v === u.side) return null;
  const jitter = ((cx * 3 + cy + u.id) % 4) * 0.35;
  const rank = v === 0 ? dist + w * h : dist;
  return rank + jitter;
}

function flyPaintGoal(
  grid: Uint8Array,
  w: number,
  h: number,
  u: ArenaUnit,
): { x: number; y: number } | null {
  const sx = Math.floor(u.x);
  const sy = Math.floor(u.y);
  let best = Infinity;
  let bx = -1;
  let by = -1;
  for (let cy = 0; cy < h; cy += 1) {
    for (let cx = 0; cx < w; cx += 1) {
      if (cx === sx && cy === sy) continue;
      const v = grid[cy * w + cx] ?? 0;
      if (v === u.side || v === BLOCKED) continue;
      const dist = Math.abs(cx - sx) + Math.abs(cy - sy);
      const jitter = ((cx * 3 + cy + u.id) % 4) * 0.35;
      const score = (v === 0 ? dist + w * h : dist) + jitter;
      if (score >= best) continue;
      best = score;
      bx = cx;
      by = cy;
    }
  }
  if (bx < 0) return null;
  return { x: bx + 0.5, y: by + 0.5 };
}

function stepToward(
  sim: ArenaSim,
  config: ArenaConfig,
  u: ArenaUnit,
  tx: number,
  ty: number,
  dt: number,
): boolean {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.05) return true;
  const step = u.speed * dt;
  const w = config.arenaW;
  const h = config.arenaH;
  if (u.role === 'flying') {
    const scale = Math.min(1, step / dist);
    u.x = clamp(u.x + dx * scale, 0.4, w - 0.4);
    u.y = clamp(u.y + dy * scale, 0.4, h - 0.4);
    return true;
  }
  const moved = slide(sim.grid, w, h, u.x, u.y, (dx / dist) * step, (dy / dist) * step, 0.4);
  const progressed = moved.x !== u.x || moved.y !== u.y;
  u.x = moved.x;
  u.y = moved.y;
  return progressed;
}

function wander(sim: ArenaSim, config: ArenaConfig, u: ArenaUnit, dt: number): void {
  const w = config.arenaW;
  const h = config.arenaH;
  const heading = ((u.id * 17 + sim.tick) % 16) * (Math.PI / 8);
  const step = u.speed * dt;
  if (u.role === 'flying') {
    u.x = clamp(u.x + Math.cos(heading) * step, 0.4, w - 0.4);
    u.y = clamp(u.y + Math.sin(heading) * step, 0.4, h - 0.4);
    return;
  }
  let moved = slide(
    sim.grid,
    w,
    h,
    u.x,
    u.y,
    Math.cos(heading) * step,
    Math.sin(heading) * step,
    0.4,
  );
  if (moved.x === u.x && moved.y === u.y) {
    const turn = heading + Math.PI / 2;
    moved = slide(sim.grid, w, h, u.x, u.y, Math.cos(turn) * step, Math.sin(turn) * step, 0.4);
  }
  u.x = moved.x;
  u.y = moved.y;
}

function tickTowers(sim: ArenaSim, config: ArenaConfig): void {
  const w = config.arenaW;
  const h = config.arenaH;
  for (const t of sim.towers) {
    if (t.hp <= 0 || !t.active) continue;
    if (t.cooldown > 0) t.cooldown -= 1;
    if (t.cooldown > 0) continue;
    const unit = nearestEnemyUnit(sim, t.side, t.x, t.y, t.range);
    if (unit !== null) {
      t.cooldown = t.attackTicks;
      spawnProjectile(sim, t.side, t.x, t.y, unit.x, unit.y, t.dmg, 0.35, {
        kind: 'unit',
        id: unit.id,
      });
      continue;
    }
    const spot = groundAim(sim.grid, w, h, t.x, t.y, t.range, t.side, t.id + sim.tick);
    if (spot === null) continue;
    t.cooldown = t.attackTicks;
    spawnProjectile(sim, t.side, t.x, t.y, spot.x, spot.y, 0, 1.15, {
      kind: 'ground',
      id: 0,
    });
  }
}

function fireAt(sim: ArenaSim, config: ArenaConfig, u: ArenaUnit, target: Target): boolean {
  if (u.cooldown > 0 || u.hp <= 0) return false;
  u.cooldown = u.attackTicks;
  u.swing += 1;
  if (u.role === 'ranged' || u.role === 'building' || u.role === 'flying') {
    spawnProjectile(sim, u.side, u.x, u.y, target.x, target.y, u.dmg, u.paint * 0.5, target.ref);
    return true;
  }
  applyHit(sim, config, u.side, target.ref, u.dmg, u.paint, target.x, target.y);
  return true;
}

function fireGround(sim: ArenaSim, config: ArenaConfig, u: ArenaUnit): void {
  if (u.cooldown > 0 || u.hp <= 0) return;
  const reach = u.role === 'melee' ? Math.max(u.range, 1.15) : u.range;
  const spot = groundAim(
    sim.grid,
    config.arenaW,
    config.arenaH,
    u.x,
    u.y,
    reach,
    u.side,
    u.id + sim.tick,
  );
  if (spot === null) return;
  u.cooldown = u.attackTicks;
  u.swing += 1;
  if (u.role === 'ranged' || u.role === 'building' || u.role === 'flying') {
    spawnProjectile(sim, u.side, u.x, u.y, spot.x, spot.y, 0, u.paint, {
      kind: 'ground',
      id: 0,
    });
    return;
  }
  paintAt(
    sim.grid,
    { arenaW: config.arenaW, arenaH: config.arenaH, paintRadius: u.paint },
    spot.x,
    spot.y,
    u.side,
    sim.dirty,
  );
}

function groundAim(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  range: number,
  side: Side,
  salt: number,
): { x: number; y: number } | null {
  const r2 = range * range;
  const x0 = Math.max(0, Math.floor(x - range));
  const x1 = Math.min(w - 1, Math.ceil(x + range));
  const y0 = Math.max(0, Math.floor(y - range));
  const y1 = Math.min(h - 1, Math.ceil(y + range));
  let best = Infinity;
  let bx = -1;
  let by = -1;
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      const v = grid[cy * w + cx] ?? 0;
      if (v === BLOCKED || v === side) continue;
      const dx = cx + 0.5 - x;
      const dy = cy + 0.5 - y;
      if (dx * dx + dy * dy > r2) continue;
      const dist = Math.hypot(dx, dy);
      const score = (v === 0 ? dist + w * h : dist) + ((cx * 3 + cy + salt) % 4) * 0.2;
      if (score >= best) continue;
      best = score;
      bx = cx;
      by = cy;
    }
  }
  if (bx < 0) return null;
  return { x: bx + 0.5, y: by + 0.5 };
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
  target: { kind: 'unit' | 'tower' | 'ground'; id: number },
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
    aimX: tx,
    aimY: ty,
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
      if (p.targetKind === 'ground' && dest !== null) {
        paintAt(
          sim.grid,
          { arenaW: config.arenaW, arenaH: config.arenaH, paintRadius: Math.max(0.45, p.paint) },
          dest.x,
          dest.y,
          p.side,
          sim.dirty,
        );
      } else if (hit && dest !== null && p.targetKind !== 'ground') {
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
  if (p.targetKind === 'ground') return { x: p.aimX, y: p.aimY };
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

function targetInRange(sim: ArenaSim, attacker: ArenaUnit): Target | null {
  const hitsAir = attacker.role !== 'melee';
  const reach = attacker.range + 0.05;
  const r2 = reach * reach;
  let unit: Target | null = null;
  let unitD = Infinity;
  for (const other of sim.units) {
    if (other.side === attacker.side || other.hp <= 0 || other.id === attacker.id) continue;
    if (other.role === 'flying' && !hitsAir) continue;
    const d = (other.x - attacker.x) * (other.x - attacker.x) + (other.y - attacker.y) * (other.y - attacker.y);
    if (d > r2 || d >= unitD) continue;
    unitD = d;
    unit = { x: other.x, y: other.y, ref: { kind: 'unit', id: other.id } };
  }
  if (unit !== null) return unit;
  let tower: Target | null = null;
  let towerD = Infinity;
  for (const t of sim.towers) {
    if (t.side === attacker.side || t.hp <= 0) continue;
    const d = (t.x - attacker.x) * (t.x - attacker.x) + (t.y - attacker.y) * (t.y - attacker.y);
    if (d > r2 || d >= towerD) continue;
    towerD = d;
    tower = { x: t.x, y: t.y, ref: { kind: 'tower', id: t.id } };
  }
  return tower;
}

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
  const scores = fieldScores(sim.grid);
  if (scores.open > 0) return;
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
  swing: number;
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
  mapName: string;
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
      swing: u.swing,
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
    mapName: sim.mapName,
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
