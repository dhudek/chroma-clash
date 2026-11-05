import { tunedCard, type CardId } from './cards.ts';
import type { ArenaConfig } from './arena-config.ts';
import type { Rng } from './ai.ts';
import type { Side } from './kinds.ts';
import {
  arenaPhase,
  canPlayAt,
  ownerAt,
  playerOfArena,
  type ArenaSim,
  type PlayCommand,
} from './arena-sim.ts';

export function arenaAi(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  rng: Rng = Math.random,
): PlayCommand | null {
  if (arenaPhase(sim.tick, config) !== 'play') return null;
  const me = playerOfArena(sim, side);
  if (rng() > 0.32 + config.aiSkill * 0.55) return null;

  const affordable = me.hand
    .map((id) => tunedCard(sim.cards, id))
    .filter((d): d is NonNullable<typeof d> => d !== null && d.cost <= me.energy + 1e-6);

  if (affordable.length === 0) return null;

  const threat = enemyOnOurPaint(sim, config, side);
  let pick = affordable[Math.floor(rng() * affordable.length)];
  if (pick === undefined) return null;

  const meteor = affordable.find((c) => c.id === 'meteor');
  const moth = affordable.find((c) => c.id === 'moth');
  const turret = affordable.find((c) => c.id === 'turret');
  const spire = affordable.find((c) => c.id === 'spire');
  const brute = affordable.find((c) => c.id === 'brute');

  if (meteor !== undefined && rng() < 0.35 + config.aiSkill * 0.25) {
    pick = meteor;
  } else if (threat && turret !== undefined && rng() < 0.45) {
    pick = turret;
  } else if (!threat && spire !== undefined && me.energy >= 6 && rng() < 0.4) {
    pick = spire;
  } else if (moth !== undefined && rng() < 0.3) {
    pick = moth;
  } else if (brute !== undefined && me.energy >= 5 && rng() < 0.35) {
    pick = brute;
  }

  const pos = deployPoint(sim, config, side, pick.id, rng);
  if (pos === null) return null;
  if (!canPlayAt(sim, config, side, pick.id, pos.x, pos.y)) return null;
  return { cardId: pick.id, x: pos.x, y: pos.y };
}

function enemyOnOurPaint(sim: ArenaSim, config: ArenaConfig, side: Side): boolean {
  for (const u of sim.units) {
    if (u.side === side || u.hp <= 0) continue;
    if (ownerAt(sim.grid, config.arenaW, config.arenaH, u.x, u.y) === side) return true;
  }
  return false;
}

function deployPoint(
  sim: ArenaSim,
  config: ArenaConfig,
  side: Side,
  cardId: CardId,
  rng: Rng,
): { x: number; y: number } | null {
  const w = config.arenaW;
  const h = config.arenaH;
  const mid = h / 2;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!canPlayAt(sim, config, side, cardId, px, py)) continue;
      const score = Math.abs(py - mid) + rng();
      if (score >= bestScore) continue;
      bestScore = score;
      best = { x: px, y: py };
    }
  }
  return best;
}
