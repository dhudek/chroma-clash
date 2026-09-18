import type { GameConfig } from './config.ts';
import type { PlayerInput, Side } from './protocol.ts';
import type { SimState } from './sim.ts';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function aiInput(
  sim: SimState,
  config: GameConfig,
  side: Side,
  rng: Rng = Math.random,
): PlayerInput {
  const me = side === 1 ? sim.p1 : sim.p2;
  const opp = side === 1 ? sim.p2 : sim.p1;
  const skill = config.aiSkill;
  const samples = 10 + Math.floor(skill * 22);

  let bestX = me.x;
  let bestY = me.y;
  let best = Number.NEGATIVE_INFINITY;

  for (let s = 0; s < samples; s += 1) {
    const cx = Math.floor(rng() * config.arenaW);
    const cy = Math.floor(rng() * config.arenaH);
    const i = cy * config.arenaW + cx;
    const owner = sim.grid[i] ?? 0;
    let value = 0;
    if (owner === 0) value = 1;
    else if (owner !== side) value = 2.4;
    else value = -0.45;
    const dist = Math.hypot(cx + 0.5 - me.x, cy + 0.5 - me.y);
    value -= dist * (0.09 - skill * 0.05);
    const od = Math.hypot(cx + 0.5 - opp.x, cy + 0.5 - opp.y);
    if (od < 9) value += 0.55 * skill;
    if (value > best) {
      best = value;
      bestX = cx + 0.5;
      bestY = cy + 0.5;
    }
  }

  let dx = bestX - me.x;
  let dy = bestY - me.y;
  const mag = Math.hypot(dx, dy);
  if (mag > 0.0001) {
    dx /= mag;
    dy /= mag;
  }
  const jitter = (1 - skill) * 0.35;
  dx += (rng() - 0.5) * jitter;
  dy += (rng() - 0.5) * jitter;
  const jm = Math.hypot(dx, dy);
  if (jm > 0.0001) {
    dx /= jm;
    dy /= jm;
  }

  const dash =
    mag > 11 &&
    sim.tick >= me.dashReadyTick &&
    rng() < 0.08 + skill * 0.12;

  return { seq: sim.tick, dx, dy, dash };
}
