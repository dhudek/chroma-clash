import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ServerMsg } from '@clash/shared';
import type { WSContext } from 'hono/ws';

import { openDatabase } from '../src/db.ts';
import { GameHub } from '../src/hub.ts';

function fakeWs(): { ws: WSContext; messages: ServerMsg[] } {
  const messages: ServerMsg[] = [];
  const ws = {
    send(data: string) {
      messages.push(JSON.parse(data) as ServerMsg);
    },
  } as unknown as WSContext;
  return { ws, messages };
}

function hello(guestId: string) {
  return { type: 'hello' as const, guestId, name: 'Nova' };
}

function matchId(messages: ServerMsg[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg !== undefined && msg.type === 'match_start') return msg.matchId;
  }
  return null;
}

function welcome(messages: ServerMsg[]): Extract<ServerMsg, { type: 'welcome' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg !== undefined && msg.type === 'welcome') return msg;
  }
  return undefined;
}

function roomCode(messages: ServerMsg[]): string | null {
  for (const msg of messages) {
    if (msg.type === 'room') return msg.code;
  }
  return null;
}

function settle(hub: GameHub, guestId: string): void {
  const sock = fakeWs();
  hub.handle(sock.ws, hello(guestId));
  hub.handle(sock.ws, { type: 'leave' });
  hub.disconnect(sock.ws);
}

test('a refresh rejoins the same arena match', () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const first = fakeWs();
  const guestId = 'guest-arena';
  try {
    hub.handle(first.ws, hello(guestId));
    hub.handle(first.ws, { type: 'play_cpu', game: 'arena' });
    const id = matchId(first.messages);
    assert.ok(id);
    hub.disconnect(first.ws);
    const second = fakeWs();
    hub.handle(second.ws, hello(guestId));
    assert.equal(welcome(second.messages)?.resume, true);
    assert.equal(matchId(second.messages), id);
    hub.handle(second.ws, { type: 'leave' });
  } finally {
    settle(hub, guestId);
    db.close();
  }
});

test('a new tab takes the seat and the old socket cannot forfeit it', () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const guestId = 'guest-takeover';
  const first = fakeWs();
  const second = fakeWs();
  const third = fakeWs();
  try {
    hub.handle(first.ws, hello(guestId));
    hub.handle(first.ws, { type: 'play_cpu', game: 'arena' });
    const id = matchId(first.messages);
    hub.handle(second.ws, hello(guestId));
    assert.equal(matchId(second.messages), id);
    hub.disconnect(first.ws);
    hub.handle(third.ws, hello(guestId));
    assert.equal(welcome(third.messages)?.resume, true);
    assert.equal(matchId(third.messages), id);
    assert.equal(hub.recentMatches().length, 0);
    hub.handle(third.ws, { type: 'leave' });
    assert.equal(hub.recentMatches().length, 1);
  } finally {
    settle(hub, guestId);
    db.close();
  }
});

test('an explicit leave does not come back on the next hello', () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const guestId = 'guest-leave';
  const first = fakeWs();
  try {
    hub.handle(first.ws, hello(guestId));
    hub.handle(first.ws, { type: 'play_cpu', game: 'spray' });
    hub.handle(first.ws, { type: 'leave' });
    hub.disconnect(first.ws);
    const second = fakeWs();
    hub.handle(second.ws, hello(guestId));
    assert.equal(welcome(second.messages)?.resume, undefined);
    assert.equal(matchId(second.messages), null);
    hub.disconnect(second.ws);
  } finally {
    settle(hub, guestId);
    db.close();
  }
});

test('a parked room and queue survive a dropped socket', () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const guestId = 'guest-room';
  const first = fakeWs();
  try {
    hub.handle(first.ws, hello(guestId));
    hub.handle(first.ws, { type: 'create_room', game: 'arena' });
    const code = roomCode(first.messages);
    assert.ok(code);
    hub.disconnect(first.ws);
    const second = fakeWs();
    hub.handle(second.ws, hello(guestId));
    assert.equal(welcome(second.messages)?.resume, true);
    assert.equal(roomCode(second.messages), code);
    hub.handle(second.ws, { type: 'leave' });

    const queued = fakeWs();
    hub.handle(queued.ws, hello('guest-queue'));
    hub.handle(queued.ws, { type: 'queue', game: 'spray' });
    hub.disconnect(queued.ws);
    const back = fakeWs();
    hub.handle(back.ws, hello('guest-queue'));
    assert.equal(welcome(back.messages)?.resume, true);
    assert.ok(back.messages.some((msg) => msg.type === 'queued'));
    hub.handle(back.ws, { type: 'leave' });
  } finally {
    settle(hub, guestId);
    settle(hub, 'guest-queue');
    db.close();
  }
});

test('a parked match is forfeited after the grace window', async () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db, 30);
  const guestId = 'guest-grace';
  const first = fakeWs();
  try {
    hub.handle(first.ws, hello(guestId));
    hub.handle(first.ws, { type: 'play_cpu', game: 'arena' });
    hub.disconnect(first.ws);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = fakeWs();
    hub.handle(second.ws, hello(guestId));
    assert.equal(welcome(second.messages)?.resume, undefined);
    assert.equal(matchId(second.messages), null);
    assert.equal(hub.recentMatches().length, 1);
    hub.disconnect(second.ws);
  } finally {
    settle(hub, guestId);
    db.close();
  }
});
