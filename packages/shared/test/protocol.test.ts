import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, gameConfigSchema } from '../src/config.ts';
import {
  clampInput,
  decodeGrid,
  encodeGrid,
  parseClientMsg,
} from '../src/protocol.ts';
import { sanitizeName } from '../src/names.ts';

test('parseClientMsg accepts hello and rejects junk', () => {
  const ok = parseClientMsg(
    JSON.stringify({ type: 'hello', guestId: '', name: 'Nova' }),
  );
  assert.deepEqual(ok, { type: 'hello', guestId: '', name: 'Nova' });
  assert.equal(parseClientMsg('{'), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'nope' })), null);
  assert.equal(parseClientMsg('x'.repeat(5000)), null);
});

test('parseClientMsg accepts input and ping', () => {
  const input = parseClientMsg(
    JSON.stringify({ type: 'input', seq: 3, dx: 0.5, dy: -1, dash: true }),
  );
  assert.equal(input?.type, 'input');
  const ping = parseClientMsg(JSON.stringify({ type: 'ping', t: 1.2 }));
  assert.equal(ping?.type, 'ping');
});

test('encode/decode grid roundtrips', () => {
  const grid = new Uint8Array([0, 1, 2, 1, 0, 2]);
  const again = decodeGrid(encodeGrid(grid), grid.length);
  assert.deepEqual([...again], [...grid]);
});

test('clampInput bounds stick and dash', () => {
  const clamped = clampInput({ seq: 1, dx: 8, dy: -4, dash: true });
  assert.equal(clamped.dx, 1);
  assert.equal(clamped.dy, -1);
  assert.equal(clamped.dash, true);
});

test('gameConfigSchema rejects out of range admin values', () => {
  assert.equal(
    gameConfigSchema.safeParse({ ...DEFAULT_CONFIG, tickHz: 2 }).success,
    false,
  );
  assert.equal(gameConfigSchema.safeParse(DEFAULT_CONFIG).success, true);
});

test('sanitizeName strips junk and caps length', () => {
  assert.equal(sanitizeName('  Volt-Lynx!! ', 'x'), 'Volt-Lynx');
  assert.equal(sanitizeName('', 'NeonGhost'), 'NeonGhost');
  assert.equal(sanitizeName('a'.repeat(40), 'x').length, 16);
});
