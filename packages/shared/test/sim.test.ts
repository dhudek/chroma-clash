import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, mergeConfig } from '../src/config.ts';
import { NEUTRAL_INPUT } from '../src/protocol.ts';
import {
  countScores,
  createSim,
  countdownTicks,
  forfeit,
  phaseOf,
  step,
} from '../src/sim.ts';
import { aiInput, mulberry32 } from '../src/ai.ts';

test('createSim places players on opposite sides', () => {
  const sim = createSim(DEFAULT_CONFIG);
  assert.equal(sim.grid.length, DEFAULT_CONFIG.arenaW * DEFAULT_CONFIG.arenaH);
  assert.ok(sim.p1.x < 4);
  assert.ok(sim.p2.x > DEFAULT_CONFIG.arenaW - 4);
  assert.equal(phaseOf(0, DEFAULT_CONFIG), 'countdown');
});

test('players paint after countdown and stay in bounds', () => {
  const config = mergeConfig({ countdownSec: 0, arenaW: 24, arenaH: 16 });
  const sim = createSim(config);
  const start = { ...sim.p1 };
  for (let i = 0; i < 30; i += 1) {
    step(sim, config, { seq: i, dx: 1, dy: 0, dash: false }, NEUTRAL_INPUT);
  }
  assert.ok(sim.p1.x > start.x);
  assert.ok(sim.p1.x <= config.arenaW - 0.45);
  const scores = countScores(sim.grid);
  assert.ok(scores.p1 > 0);
});

test('dash covers more ground than walking', () => {
  const config = mergeConfig({ countdownSec: 0, dashMul: 3, dashTicks: 20 });
  const walk = createSim(config);
  const dash = createSim(config);
  for (let i = 0; i < 12; i += 1) {
    step(walk, config, { seq: i, dx: 1, dy: 0, dash: false }, NEUTRAL_INPUT);
    step(dash, config, { seq: i, dx: 1, dy: 0, dash: i === 0 }, NEUTRAL_INPUT);
  }
  assert.ok(dash.p1.x > walk.p1.x + 1);
});

test('match ends on time with a winner from scores', () => {
  const config = mergeConfig({
    countdownSec: 0,
    matchSec: 15,
    tickHz: 20,
    arenaW: 20,
    arenaH: 12,
  });
  const sim = createSim(config);
  let last = { dirty: [] as number[] };
  const total = 15 * 20 + 2;
  for (let i = 0; i < total; i += 1) {
    last = step(
      sim,
      config,
      { seq: i, dx: 1, dy: 0, dash: false },
      NEUTRAL_INPUT,
    );
  }
  assert.equal(sim.over, true);
  assert.equal(sim.reason, 'time');
  assert.equal(sim.winner, 1);
  assert.ok(last.dirty.length >= 0);
});

test('dominate win trips when a side owns enough cells', () => {
  const config = mergeConfig({
    countdownSec: 0,
    winPct: 0.2,
    paintRadius: 3.5,
    speed: 16,
    arenaW: 20,
    arenaH: 12,
  });
  const sim = createSim(config);
  for (let i = 0; i < 80 && !sim.over; i += 1) {
    const t = i / 10;
    step(
      sim,
      config,
      { seq: i, dx: Math.cos(t), dy: Math.sin(t), dash: false },
      NEUTRAL_INPUT,
    );
  }
  assert.equal(sim.over, true);
  assert.equal(sim.reason, 'dominate');
  assert.equal(sim.winner, 1);
});

test('forfeit assigns the remaining side', () => {
  const sim = createSim(DEFAULT_CONFIG);
  forfeit(sim, 2);
  assert.equal(sim.over, true);
  assert.equal(sim.winner, 2);
  assert.equal(sim.reason, 'forfeit');
});

test('countdown consumes ticks without painting', () => {
  const config = mergeConfig({ countdownSec: 1, tickHz: 10 });
  const sim = createSim(config);
  for (let i = 0; i < countdownTicks(config); i += 1) {
    step(sim, config, { seq: i, dx: 1, dy: 0, dash: false }, NEUTRAL_INPUT);
  }
  assert.equal(countScores(sim.grid).p1, 0);
  assert.equal(sim.p1.x, createSim(config).p1.x);
});

test('AI returns finite steering', () => {
  const sim = createSim(DEFAULT_CONFIG);
  const rng = mulberry32(7);
  const input = aiInput(sim, DEFAULT_CONFIG, 2, rng);
  assert.equal(Number.isFinite(input.dx), true);
  assert.equal(Number.isFinite(input.dy), true);
  assert.ok(Math.abs(input.dx) <= 1.0001);
  assert.ok(Math.abs(input.dy) <= 1.0001);
});
