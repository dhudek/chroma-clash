import { cardOf, isSpell, type CardId } from './cards.ts';
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
    .map((id) => cardOf(id))
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
  if (isSpell(cardId)) {
    const enemy: Side = side === 1 ? 2 : 1;
    for (let i = 0; i < 24; i += 1) {
      const x = rng() * config.arenaW;
      const y = rng() * config.arenaH;
      if (ownerAt(sim.grid, config.arenaW, config.arenaH, x, y) === enemy) {
        return { x, y };
      }
    }
    return { x: config.arenaW * 0.5, y: config.arenaH * 0.5 };
  }
  const front = side === 1 ? config.arenaH * 0.42 : config.arenaH * 0.58;
  for (let i = 0; i < 40; i += 1) {
    const x = 1 + rng() * (config.arenaW - 2);
    const y = front + (rng() - 0.5) * 8;
    if (ownerAt(sim.grid, config.arenaW, config.arenaH, x, y) === side) {
      return { x, y };
    }
  }
  for (let i = 0; i < 40; i += 1) {
    const x = 1 + rng() * (config.arenaW - 2);
    const y = 1 + rng() * (config.arenaH - 2);
    if (ownerAt(sim.grid, config.arenaW, config.arenaH, x, y) === side) {
      return { x, y };
    }
  }
  return null;
}
