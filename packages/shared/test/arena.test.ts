import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mulberry32 } from '../src/ai.ts';
import { mergeArena } from '../src/arena-config.ts';
import { arenaAi } from '../src/arena-ai.ts';
import {
  arenaPhase,
  createArena,
  forfeitArena,
  ownerAt,
  stepArena,
  tryPlay,
} from '../src/arena-sim.ts';
import { parseClientMsg } from '../src/protocol.ts';
import { countScores as countGrid } from '../src/sim.ts';

test('arena starts with six towers, a hand, and a split board', () => {
  const config = mergeArena({ countdownSec: 0 });
  const sim = createArena(config, mulberry32(3));
  assert.equal(sim.towers.length, 6);
  assert.equal(sim.p1.hand.length, 4);
  const scores = countGrid(sim.grid);
  assert.equal(scores.empty, 0);
  assert.equal(scores.p1, scores.p2);
  assert.equal(ownerAt(sim.grid, config.arenaW, config.arenaH, 9, 4), 1);
  assert.equal(ownerAt(sim.grid, config.arenaW, config.arenaH, 9, 28), 2);
});

test('playing a spark on your color spends energy', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const sim = createArena(config, mulberry32(1));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  const before = sim.p1.energy;
  const ok = tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: 8 });
  assert.equal(ok, true);
  assert.ok(sim.p1.energy < before);
  assert.ok(sim.units.length >= 1);
});

test('cannot deploy a unit on enemy color', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const sim = createArena(config, mulberry32(9));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  const ok = tryPlay(sim, config, 1, {
    cardId: 'spark',
    x: 9,
    y: config.arenaH - 3,
  });
  assert.equal(ok, false);
});

test('meteor can strike enemy color', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const sim = createArena(config, mulberry32(5));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('meteor')) sim.p1.hand[0] = 'meteor';
  const ok = tryPlay(sim, config, 1, {
    cardId: 'meteor',
    x: 9,
    y: config.arenaH - 4,
  });
  assert.equal(ok, true);
  assert.equal(ownerAt(sim.grid, config.arenaW, config.arenaH, 9, config.arenaH - 4), 1);
});

test('units convert enemy color as they walk', () => {
  const config = mergeArena({
    countdownSec: 0,
    energyStart: 10,
    matchSec: 60,
  });
  const sim = createArena(config, mulberry32(4));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  const before = countGrid(sim.grid).p1;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: 12 }), true);
  for (let i = 0; i < 80; i += 1) stepArena(sim, config);
  assert.ok(countGrid(sim.grid).p1 > before);
});

test('wiping enemy paint wins', () => {
  const config = mergeArena({ countdownSec: 0 });
  const sim = createArena(config, mulberry32(2));
  sim.grid.fill(1);
  stepArena(sim, config);
  stepArena(sim, config);
  assert.equal(sim.over, true);
  assert.equal(sim.winner, 1);
  assert.equal(sim.reason, 'paint');
});

test('forfeit and AI produce a legal play or skip', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, aiSkill: 1 });
  const sim = createArena(config, mulberry32(11));
  stepArena(sim, config);
  const cmd = arenaAi(sim, config, 2, mulberry32(12));
  if (cmd !== null) {
    assert.equal(tryPlay(sim, config, 2, cmd), true);
  }
  forfeitArena(sim, 1);
  assert.equal(sim.reason, 'forfeit');
  assert.equal(arenaPhase(0, config), 'countdown');
});

test('parseClientMsg accepts meteor', () => {
  const card = parseClientMsg(
    JSON.stringify({ type: 'play_card', cardId: 'meteor', x: 4, y: 6 }),
  );
  assert.equal(card?.type, 'play_card');
  assert.equal(
    parseClientMsg(JSON.stringify({ type: 'play_card', cardId: 'splatter', x: 1, y: 1 })),
    null,
  );
});
