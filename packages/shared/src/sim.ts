import { mulberry32, type Rng } from './ai.ts';
import type { GameConfig } from './config.ts';
import { BLOCKED, MAP_NAMES, rollMap, slide } from './maps.ts';
import {
  NEUTRAL_INPUT,
  clampInput,
  type Phase,
  type PlayerInput,
  type Side,
  type Winner,
} from './protocol.ts';
import type { MapId } from './maps.ts';

export type PlayerState = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  dashUntilTick: number;
  dashReadyTick: number;
};

export type SimState = {
  tick: number;
  grid: Uint8Array;
  mapId: MapId;
  mapName: string;
  p1: PlayerState;
  p2: PlayerState;
  over: boolean;
  winner: Winner;
  reason: 'time' | 'dominate' | 'forfeit' | null;
};

export type StepResult = {
  dirty: number[];
};

export function createSim(config: GameConfig, rng: Rng = mulberry32(0xc0ffee)): SimState {
  const grid = new Uint8Array(config.arenaW * config.arenaH);
  const mapId = rollMap(grid, config.arenaW, config.arenaH, rng);
  const p1: PlayerState = {
    x: 2.5,
    y: config.arenaH / 2,
    dx: 0,
    dy: 0,
    dashUntilTick: 0,
    dashReadyTick: 0,
  };
  const p2: PlayerState = {
    x: config.arenaW - 2.5,
    y: config.arenaH / 2,
    dx: 0,
    dy: 0,
    dashUntilTick: 0,
    dashReadyTick: 0,
  };
  return {
    tick: 0,
    grid,
    mapId,
    mapName: MAP_NAMES[mapId],
    p1,
    p2,
    over: false,
    winner: 0,
    reason: null,
  };
}

export function countdownTicks(config: GameConfig): number {
  return config.countdownSec * config.tickHz;
}

export function playTicks(config: GameConfig): number {
  return config.matchSec * config.tickHz;
}

export function phaseOf(tick: number, config: GameConfig): Phase {
  const start = countdownTicks(config);
  const end = start + playTicks(config);
  if (tick <= start) return 'countdown';
  if (tick > end) return 'over';
  return 'play';
}

export function timeLeftSec(tick: number, config: GameConfig): number {
  const start = countdownTicks(config);
  if (tick <= start) return config.matchSec;
  const end = start + playTicks(config);
  return Math.max(0, (end - tick) / config.tickHz);
}

export function countdownLeftSec(tick: number, config: GameConfig): number {
  const start = countdownTicks(config);
  if (tick >= start) return 0;
  return (start - tick) / config.tickHz;
}

export function countScores(grid: Uint8Array): {
  p1: number;
  p2: number;
  empty: number;
} {
  let p1 = 0;
  let p2 = 0;
  let empty = 0;
  for (const v of grid) {
    if (v === 1) p1 += 1;
    else if (v === 2) p2 += 1;
    else empty += 1;
  }
  return { p1, p2, empty };
}

export function dashReadyIn(player: PlayerState, tick: number): number {
  return Math.max(0, player.dashReadyTick - tick);
}

export function step(
  sim: SimState,
  config: GameConfig,
  raw1: PlayerInput,
  raw2: PlayerInput,
): StepResult {
  if (sim.over) return { dirty: [] };

  sim.tick += 1;
  const phase = phaseOf(sim.tick, config);
  if (phase === 'countdown') return { dirty: [] };
  if (phase === 'over') {
    const scores = countScores(sim.grid);
    const winner: Winner =
      scores.p1 === scores.p2 ? 0 : scores.p1 > scores.p2 ? 1 : 2;
    finish(sim, winner, 'time');
    return { dirty: [] };
  }

  const in1 = clampInput(raw1);
  const in2 = clampInput(raw2);
  const dirty: number[] = [];

  movePlayer(sim.p1, in1, sim.tick, config, sim.grid);
  movePlayer(sim.p2, in2, sim.tick, config, sim.grid);
  paintAt(sim.grid, config, sim.p1.x, sim.p1.y, 1, dirty);
  paintAt(sim.grid, config, sim.p2.x, sim.p2.y, 2, dirty);

  const scores = countScores(sim.grid);
  const total = config.arenaW * config.arenaH;
  if (config.winPct > 0 && total > 0) {
    if (scores.p1 / total >= config.winPct) {
      finish(sim, 1, 'dominate');
      return { dirty };
    }
    if (scores.p2 / total >= config.winPct) {
      finish(sim, 2, 'dominate');
      return { dirty };
    }
  }

  return { dirty };
}

export function forfeit(sim: SimState, winner: Side): void {
  finish(sim, winner, 'forfeit');
}

function finish(
  sim: SimState,
  winner: Winner,
  reason: 'time' | 'dominate' | 'forfeit',
): void {
  sim.over = true;
  sim.winner = winner;
  sim.reason = reason;
}

function movePlayer(
  player: PlayerState,
  input: PlayerInput,
  tick: number,
  config: GameConfig,
  grid: Uint8Array,
): void {
  player.dx = input.dx;
  player.dy = input.dy;
  if (input.dash && tick >= player.dashReadyTick) {
    player.dashUntilTick = tick + config.dashTicks;
    player.dashReadyTick = tick + config.dashCooldownTicks;
  }

  const mag = Math.hypot(input.dx, input.dy);
  if (mag < 0.04) return;

  const nx = input.dx / mag;
  const ny = input.dy / mag;
  const dashing = tick <= player.dashUntilTick;
  const cellsPerTick =
    (config.speed / config.tickHz) * (dashing ? config.dashMul : 1);
  const moved = slide(
    grid,
    config.arenaW,
    config.arenaH,
    player.x,
    player.y,
    nx * cellsPerTick,
    ny * cellsPerTick,
  );
  player.x = moved.x;
  player.y = moved.y;
}

export type PaintField = {
  arenaW: number;
  arenaH: number;
  paintRadius: number;
};

export function paintAt(
  grid: Uint8Array,
  config: PaintField,
  px: number,
  py: number,
  side: Side,
  dirty: number[],
): void {
  const { arenaW: w, arenaH: h, paintRadius: radius } = config;
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(px - radius));
  const maxX = Math.min(w - 1, Math.ceil(px + radius));
  const minY = Math.max(0, Math.floor(py - radius));
  const maxY = Math.min(h - 1, Math.ceil(py + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dx = cx - px;
      const dy = cy - py;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * w + x;
      if (grid[i] === side || grid[i] === BLOCKED) continue;
      grid[i] = side;
      dirty.push(i);
    }
  }
}

export function playerOf(sim: SimState, side: Side): PlayerState {
  return side === 1 ? sim.p1 : sim.p2;
}

export { NEUTRAL_INPUT };
