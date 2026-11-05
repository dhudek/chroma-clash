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
import { CARD_CATALOG, defaultCardTable, roleLabel } from '../src/cards.ts';
import { BLOCKED, claimHalves, fieldScores, firstStep } from '../src/maps.ts';
import { parseClientMsg } from '../src/protocol.ts';
import { countScores as countGrid } from '../src/sim.ts';

test('arena starts split evenly, with mirrored rocks, on a random map', () => {
  const config = mergeArena({ countdownSec: 0 });
  const ids = new Set<string>();
  for (let seed = 1; seed <= 30; seed += 1) {
    const sim = createArena(config, mulberry32(seed));
    ids.add(sim.mapId);
    assert.equal(sim.towers.length, 0);
    assert.equal(sim.units.length, 0);
    assert.equal(sim.p1.hand.length, 4);
    const scores = fieldScores(sim.grid);
    assert.equal(scores.open, 0);
    assert.ok(Math.abs(scores.p1 - scores.p2) <= 1);
    assert.ok(scores.p1 > 0);
    assert.ok(sim.mapName.length > 0);
    const w = config.arenaW;
    const h = config.arenaH;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const a = sim.grid[y * w + x] ?? 0;
        const b = sim.grid[(h - 1 - y) * w + x] ?? 0;
        if (a === BLOCKED) assert.equal(b, BLOCKED);
      }
    }
  }
  assert.ok(ids.size >= 3);
});

test('territory split is stripes or blocks, and the counts match', () => {
  const w = 18;
  const h = 32;
  const empty = new Uint8Array(w * h);
  const horizontal = new Uint8Array(empty);
  claimHalves(horizontal, w, h, () => 0);
  assert.equal(lineMix(horizontal, w, h, 'y'), 0);
  assert.equal(isBand(horizontal, w, h, 'y'), false);
  const across = fieldScores(horizontal);
  assert.equal(across.open, 0);
  assert.ok(Math.abs(across.p1 - across.p2) <= 1);
  assert.ok(across.p1 > 0 && across.p2 > 0);

  const vertical = new Uint8Array(empty);
  claimHalves(vertical, w, h, () => 0.5);
  assert.ok(lineMix(vertical, w, h, 'x') <= 8);
  assert.equal(isBand(vertical, w, h, 'x'), false);

  const rocky = new Uint8Array(empty);
  rocky[2 * w + 1] = BLOCKED;
  rocky[(h - 1 - 2) * w + 1] = BLOCKED;
  let call = 0;
  claimHalves(rocky, w, h, () => {
    call += 1;
    return call === 1 ? 0.9 : ((call * 17) % 100) / 100;
  });
  const scores = fieldScores(rocky);
  assert.equal(scores.open, 0);
  assert.equal(scores.blocked, 2);
  assert.ok(Math.abs(scores.p1 - scores.p2) <= 1);
  assert.equal(isBand(rocky, w, h, 'x') || isBand(rocky, w, h, 'y'), false);
  assert.ok(lineMix(rocky, w, h, 'y') > 0);
  assert.equal(rocky[2 * w + 1], BLOCKED);
});

function isBand(grid: Uint8Array, w: number, h: number, axis: 'x' | 'y'): boolean {
  let max1 = -1;
  let min2 = Infinity;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = grid[y * w + x] ?? 0;
      if (v !== 1 && v !== 2) continue;
      const p = axis === 'y' ? y : x;
      if (v === 1) max1 = Math.max(max1, p);
      else min2 = Math.min(min2, p);
    }
  }
  return max1 < min2;
}

function lineMix(grid: Uint8Array, w: number, h: number, axis: 'x' | 'y'): number {
  const lines = axis === 'y' ? h : w;
  const across = axis === 'y' ? w : h;
  let worst = 0;
  for (let line = 0; line < lines; line += 1) {
    let c1 = 0;
    let c2 = 0;
    for (let i = 0; i < across; i += 1) {
      const x = axis === 'y' ? i : line;
      const y = axis === 'y' ? line : i;
      const v = grid[y * w + x] ?? 0;
      if (v === 1) c1 += 1;
      else if (v === 2) c2 += 1;
    }
    worst = Math.max(worst, Math.min(c1, c2));
  }
  return worst;
}

function ownAllBut(grid: Uint8Array, w: number, x: number, y: number): void {
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] !== BLOCKED) grid[i] = 1;
  }
  grid[y * w + x] = 2;
  for (let i = grid.length - 1; i >= 0; i -= 1) {
    if (grid[i] === BLOCKED || i === y * w + x) continue;
    const cx = i % w;
    const cy = Math.floor(i / w);
    if (Math.abs(cx - x) + Math.abs(cy - y) < 16) continue;
    grid[i] = 2;
    break;
  }
}

function paintCells(
  grid: Uint8Array,
  w: number,
  x: number,
  y: number,
  span: number,
  side: number,
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  for (let cy = y0; cy < y0 + span; cy += 1) {
    for (let cx = x0; cx < x0 + span; cx += 1) {
      const i = cy * w + cx;
      if (grid[i] === BLOCKED) continue;
      grid[i] = side;
    }
  }
}

test('playing a spark on your color spends energy', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const sim = createArena(config, mulberry32(1));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  paintCells(sim.grid, config.arenaW, 9, 3, 1, 1);
  const before = sim.p1.energy;
  const ok = tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: 3 });
  assert.equal(ok, true);
  assert.ok(sim.p1.energy < before);
  assert.ok(sim.units.length >= 1);
});

test('cards deploy on your color anywhere, and bigger cards need the whole block', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const sim = createArena(config, mulberry32(9));
  stepArena(sim, config);
  const w = config.arenaW;
  const h = config.arenaH;
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  sim.grid[(h - 3) * w + 9] = 2;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: h - 3 }), false);
  sim.grid[(h - 4) * w + 4] = 1;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 4.5, y: h - 3.5 }), true);
  assert.ok(sim.units.some((u) => u.cardId === 'spark'));

  sim.units = [];
  if (!sim.p1.hand.includes('brute')) sim.p1.hand[0] = 'brute';
  sim.p1.energy = 10;
  const y0 = h - 6;
  const x0 = 2;
  for (let y = y0; y < y0 + 2; y += 1) {
    for (let x = x0; x < x0 + 2; x += 1) sim.grid[y * w + x] = 1;
  }
  sim.grid[(y0 + 1) * w + (x0 + 1)] = 2;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'brute', x: x0 + 0.2, y: y0 + 0.2 }), false);
  sim.grid[(y0 + 1) * w + (x0 + 1)] = 1;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'brute', x: x0 + 0.2, y: y0 + 0.2 }), true);
});

test('meteor lands on any open cell and tuned damage hits', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10 });
  const cards = defaultCardTable();
  cards.meteor.dmg = 250;
  const sim = createArena(config, mulberry32(5), cards);
  stepArena(sim, config);
  const w = config.arenaW;
  const y = config.arenaH - 4;
  sim.grid[y * w + 9] = 2;
  const foeId = sim.nextId;
  sim.units.push({
    id: foeId,
    cardId: 'spark',
    side: 2,
    role: 'melee',
    x: 9.4,
    y: y + 0.4,
    hp: 400,
    maxHp: 400,
    speed: 0,
    range: 0.7,
    dmg: 1,
    attackTicks: 40,
    cooldown: 40,
    paint: 0.2,
    swing: 0,
    lifetime: null,
  });
  sim.nextId += 1;
  if (!sim.p1.hand.includes('meteor')) sim.p1.hand[0] = 'meteor';
  assert.equal(tryPlay(sim, config, 1, { cardId: 'meteor', x: 9.2, y: y + 0.2 }), true);
  const foe = sim.units.find((u) => u.id === foeId);
  assert.ok(foe !== undefined);
  assert.ok(foe.hp <= 150);
  sim.p1.energy = 10;
  if (!sim.p1.hand.includes('meteor')) sim.p1.hand[0] = 'meteor';
  sim.grid[4 * w + 3] = BLOCKED;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'meteor', x: 3.2, y: 4.2 }), false);
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
  paintCells(sim.grid, config.arenaW, 9, 4, 1, 1);
  const before = countGrid(sim.grid).p1;
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: 4 }), true);
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

test('firstStep routes through the gap beside a wall', () => {
  const w = 8;
  const h = 5;
  const grid = new Uint8Array(w * h);
  for (let x = 1; x < w; x += 1) grid[2 * w + x] = BLOCKED;
  let x = 6.5;
  let y = 0.5;
  let sawGap = false;
  for (let guard = 0; guard < 40; guard += 1) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    assert.notEqual(grid[cy * w + cx], BLOCKED);
    if (cx === 0 && cy === 2) sawGap = true;
    if (cx === 6 && cy === 4) break;
    const step = firstStep(grid, w, h, x, y, 6.5, 4.5);
    assert.ok(step !== null);
    x = step.x;
    y = step.y;
  }
  assert.equal(Math.floor(x), 6);
  assert.equal(Math.floor(y), 4);
  assert.equal(sawGap, true);
  assert.equal(firstStep(grid, w, h, 6.5, 0.5, 3.5, 2.5), null);
});

test('fighters walk the gap toward enemy paint and never stand on rock', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(3));
  stepArena(sim, config);
  const w = config.arenaW;
  const h = config.arenaH;
  sim.grid.fill(0);
  for (let x = 0; x < w; x += 1) {
    if (x === 2 || x === 3) continue;
    sim.grid[10 * w + x] = BLOCKED;
  }
  for (let y = 14; y <= 17; y += 1) {
    for (let x = 0; x < w; x += 1) sim.grid[y * w + x] = 2;
  }
  sim.grid[4 * w + 4] = 1;
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 4, y: 4 }), true);
  let crossed = false;
  for (let i = 0; i < 200; i += 1) {
    stepArena(sim, config);
    for (const u of sim.units) {
      if (u.cardId !== 'spark' || u.hp <= 0) continue;
      const cx = Math.floor(u.x);
      const cy = Math.floor(u.y);
      assert.notEqual(sim.grid[cy * w + cx], BLOCKED);
      if (u.y > 10) crossed = true;
    }
  }
  assert.equal(crossed, true);
});

test('fliers cross a solid wall toward enemy paint', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(6));
  stepArena(sim, config);
  const w = config.arenaW;
  sim.grid.fill(0);
  for (let x = 0; x < w; x += 1) sim.grid[10 * w + x] = BLOCKED;
  for (let y = 14; y <= 17; y += 1) {
    for (let x = 0; x < w; x += 1) sim.grid[y * w + x] = 2;
  }
  sim.grid[4 * w + 4] = 1;
  if (!sim.p1.hand.includes('moth')) sim.p1.hand[0] = 'moth';
  assert.equal(tryPlay(sim, config, 1, { cardId: 'moth', x: 4, y: 4 }), true);
  let crossed = false;
  for (let i = 0; i < 200; i += 1) {
    stepArena(sim, config);
    for (const u of sim.units) {
      if (u.cardId === 'moth' && u.y > 10) crossed = true;
    }
  }
  assert.equal(crossed, true);
});

test('a boxed fighter wanders inside the pocket', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(8));
  stepArena(sim, config);
  const w = config.arenaW;
  if (!sim.p1.hand.includes('spark')) sim.p1.hand[0] = 'spark';
  paintCells(sim.grid, w, 9, 4, 1, 1);
  assert.equal(tryPlay(sim, config, 1, { cardId: 'spark', x: 9, y: 4 }), true);
  const spark = sim.units.find((u) => u.cardId === 'spark');
  assert.ok(spark !== undefined);
  spark.x = 5.5;
  spark.y = 8.5;
  sim.grid.fill(BLOCKED);
  for (const x of [4, 5, 6]) sim.grid[8 * w + x] = 0;
  let minX = spark.x;
  let maxX = spark.x;
  for (let i = 0; i < 40; i += 1) {
    stepArena(sim, config);
    const u = sim.units.find((unit) => unit.id === spark.id);
    assert.ok(u !== undefined);
    assert.ok(u.x >= 4 && u.x < 7);
    assert.ok(u.y >= 8 && u.y < 9);
    assert.notEqual(sim.grid[Math.floor(u.y) * w + Math.floor(u.x)], BLOCKED);
    minX = Math.min(minX, u.x);
    maxX = Math.max(maxX, u.x);
  }
  assert.ok(maxX - minX > 0.2);
});

test('towers stay planted and cards name their job', () => {
  assert.equal(CARD_CATALOG.turret.lifetimeSec, null);
  assert.equal(CARD_CATALOG.spire.lifetimeSec, null);
  assert.equal(CARD_CATALOG.turret.speed, 0);
  assert.equal(CARD_CATALOG.spire.speed, 0);
  assert.equal(roleLabel('melee'), 'Fighter');
  assert.equal(roleLabel('ranged'), 'Archer');
  assert.equal(roleLabel('flying'), 'Flier');
  assert.equal(roleLabel('building'), 'Tower');
  assert.equal(roleLabel('spell'), 'Spell');
  assert.match(CARD_CATALOG.turret.blurb, /Stays put/);
  assert.match(CARD_CATALOG.spire.blurb, /Stays put/);
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(7));
  stepArena(sim, config);
  if (!sim.p1.hand.includes('turret')) sim.p1.hand[0] = 'turret';
  paintCells(sim.grid, config.arenaW, 9, 4, CARD_CATALOG.turret.span, 1);
  assert.equal(tryPlay(sim, config, 1, { cardId: 'turret', x: 9, y: 4 }), true);
  const turret = sim.units.find((u) => u.cardId === 'turret');
  assert.ok(turret !== undefined);
  assert.equal(turret.lifetime, null);
  const x = turret.x;
  const y = turret.y;
  for (let i = 0; i < 400; i += 1) stepArena(sim, config);
  const still = sim.units.find((u) => u.id === turret.id);
  assert.ok(still !== undefined);
  assert.equal(still.x, x);
  assert.equal(still.y, y);
  assert.ok(still.hp > 0);
});

test('cards and living towers shoot the ground when nothing is in range', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(21));
  stepArena(sim, config);
  const w = config.arenaW;
  ownAllBut(sim.grid, w, 9, 8);
  if (!sim.p1.hand.includes('wisp')) sim.p1.hand[0] = 'wisp';
  assert.equal(tryPlay(sim, config, 1, { cardId: 'wisp', x: 9, y: 4 }), true);
  const wisp = sim.units.find((u) => u.cardId === 'wisp');
  assert.ok(wisp !== undefined);
  wisp.speed = 0;
  wisp.x = 9.5;
  wisp.y = 4.5;
  for (let i = 0; i < 30; i += 1) stepArena(sim, config);
  assert.equal(sim.grid[8 * w + 9], 1);

  sim.units = [];
  sim.projectiles = [];
  ownAllBut(sim.grid, w, 9, 8);
  if (!sim.p1.hand.includes('turret')) sim.p1.hand[0] = 'turret';
  sim.p1.energy = 10;
  paintCells(sim.grid, w, 9, 4, CARD_CATALOG.turret.span, 1);
  assert.equal(tryPlay(sim, config, 1, { cardId: 'turret', x: 9, y: 4 }), true);
  const turret = sim.units.find((u) => u.cardId === 'turret');
  assert.ok(turret !== undefined);
  const plantedX = turret.x;
  const plantedY = turret.y;
  for (let i = 0; i < 30; i += 1) stepArena(sim, config);
  assert.equal(sim.grid[8 * w + 9], 1);
  assert.equal(turret.x, plantedX);
  assert.equal(turret.y, plantedY);

  sim.units = [];
  sim.projectiles = [];
  for (let y = 10; y <= 20; y += 1) {
    for (let x = 4; x <= 14; x += 1) {
      if (sim.grid[y * w + x] === BLOCKED) continue;
      sim.grid[y * w + x] = 1;
    }
  }
  sim.grid[12 * w + 9] = 2;
  sim.towers.push({
    id: sim.nextId,
    side: 1,
    slot: 'left',
    x: 9.5,
    y: 16.5,
    hp: 200,
    maxHp: 200,
    range: 8,
    dmg: 20,
    cooldown: 0,
    attackTicks: 6,
    active: true,
  });
  sim.nextId += 1;
  for (let i = 0; i < 20; i += 1) stepArena(sim, config);
  assert.equal(sim.grid[12 * w + 9], 1);
  assert.equal(sim.towers[0]?.hp, 200);
});

test('an enemy card in range is shot before the ground or a closer tower', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(22));
  stepArena(sim, config);
  const w = config.arenaW;
  sim.grid[8 * w + 9] = 2;
  const wisp = CARD_CATALOG.wisp;
  sim.units.push({
    id: sim.nextId,
    cardId: 'wisp',
    side: 1,
    role: 'ranged',
    x: 9.5,
    y: 4.5,
    hp: wisp.hp,
    maxHp: wisp.hp,
    speed: 0,
    range: wisp.range,
    dmg: wisp.dmg,
    attackTicks: Math.max(4, Math.round(wisp.attackSec * config.tickHz)),
    cooldown: 0,
    paint: wisp.paint,
    swing: 0,
    lifetime: null,
  });
  sim.nextId += 1;
  const foeId = sim.nextId;
  sim.units.push({
    id: foeId,
    cardId: 'spark',
    side: 2,
    role: 'melee',
    x: 14.2,
    y: 4.5,
    hp: 200,
    maxHp: 200,
    speed: 0,
    range: 0.7,
    dmg: 32,
    attackTicks: 20,
    cooldown: 0,
    paint: 0.2,
    swing: 0,
    lifetime: null,
  });
  sim.nextId += 1;
  sim.towers.push({
    id: sim.nextId,
    side: 2,
    slot: 'left',
    x: 9.5,
    y: 6.5,
    hp: 500,
    maxHp: 500,
    range: 1,
    dmg: 40,
    cooldown: 99,
    attackTicks: 99,
    active: true,
  });
  sim.nextId += 1;
  for (let i = 0; i < 24; i += 1) stepArena(sim, config);
  const foe = sim.units.find((u) => u.id === foeId);
  assert.ok(foe !== undefined);
  assert.ok(foe.hp < 200);
  const shooter = sim.units.find((u) => u.cardId === 'wisp');
  assert.ok(shooter !== undefined && shooter.swing > 0);
  assert.equal(sim.towers[0]?.hp, 500);
  assert.equal(sim.grid[8 * w + 9], 2);
});

test('a living tower shoots a card in range before the ground', () => {
  const config = mergeArena({ countdownSec: 0, energyStart: 10, matchSec: 180 });
  const sim = createArena(config, mulberry32(23));
  stepArena(sim, config);
  const w = config.arenaW;
  sim.grid[12 * w + 9] = 2;
  const foeId = sim.nextId;
  sim.units.push({
    id: foeId,
    cardId: 'spark',
    side: 2,
    role: 'melee',
    x: 9.5,
    y: 14.5,
    hp: 80,
    maxHp: 80,
    speed: 0,
    range: 0.7,
    dmg: 32,
    attackTicks: 20,
    cooldown: 0,
    paint: 0.2,
    swing: 0,
    lifetime: null,
  });
  sim.nextId += 1;
  sim.towers.push({
    id: sim.nextId,
    side: 1,
    slot: 'left',
    x: 9.5,
    y: 16.5,
    hp: 200,
    maxHp: 200,
    range: 8,
    dmg: 20,
    cooldown: 0,
    attackTicks: 6,
    active: true,
  });
  sim.nextId += 1;
  for (let i = 0; i < 15; i += 1) stepArena(sim, config);
  const foe = sim.units.find((u) => u.id === foeId);
  assert.ok(foe !== undefined);
  assert.ok(foe.hp < 80);
  assert.equal(sim.grid[12 * w + 9], 2);
  assert.equal(sim.towers[0]?.hp, 200);
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
