import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mulberry32 } from '../src/ai.ts';
import { DEFAULT_ARENA } from '../src/arena-config.ts';
import { createArena } from '../src/arena-sim.ts';
import {
  DEFAULT_DECK,
  acceptDeck,
  legalDeck,
  type CardId,
} from '../src/cards.ts';
import { parseClientMsg } from '../src/protocol.ts';

const CUSTOM: CardId[] = [
  'vale',
  'bolt',
  'moth',
  'lantern',
  'flare',
  'spark',
  'turret',
  'wisp',
];

test('a deck is eight cards with a fighter, a ranged card, a tower, and a spell', () => {
  assert.equal(legalDeck(DEFAULT_DECK), true);
  assert.equal(legalDeck(['spark', 'brute', 'swarm', 'wisp', 'moth', 'turret', 'spire']), false);
  assert.equal(
    legalDeck(['spark', 'brute', 'swarm', 'wisp', 'moth', 'turret', 'spire', 'spark']),
    false,
  );
  const noSpell = DEFAULT_DECK.map((id) => (id === 'meteor' ? 'vale' : id));
  assert.equal(legalDeck(noSpell), false);
  assert.equal(legalDeck(CUSTOM), true);
  assert.deepEqual(acceptDeck(['nope', 'spark']), [...DEFAULT_DECK]);
});

test('each player is dealt only from their own deck', () => {
  const sim = createArena(DEFAULT_ARENA, mulberry32(4), undefined, {
    p1: CUSTOM,
    p2: DEFAULT_DECK,
  });
  const mine = new Set([...sim.p1.hand, ...sim.p1.deck]);
  const cpu = new Set([...sim.p2.hand, ...sim.p2.deck]);
  assert.equal(sim.p1.hand.length, 4);
  assert.equal(mine.size, 8);
  assert.equal(cpu.has('vale'), false);
  assert.equal(mine.has('flare'), true);
  assert.equal(mine.has('brute'), false);
});

test('parseClientMsg accepts a deck on the way into a match', () => {
  const msg = parseClientMsg(
    JSON.stringify({ type: 'play_cpu', game: 'arena', deck: CUSTOM }),
  );
  assert.equal(msg?.type, 'play_cpu');
  if (msg?.type === 'play_cpu') assert.deepEqual(msg.deck, CUSTOM);
});
