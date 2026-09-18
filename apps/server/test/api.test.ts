import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '@clash/shared';

import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import { GameHub } from '../src/hub.ts';

test('REST health and config for mobile clients', async () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const app = createApp({ hub, adminPin: 'clash', webRoot: null });
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  const body = (await health.json()) as { ok: boolean; sqlite: string };
  assert.equal(body.ok, true);
  assert.equal(body.sqlite, 'node:sqlite');

  const cfg = await app.request('/api/config');
  const cfgBody = (await cfg.json()) as { ws: string; settings: { tickHz: number } };
  assert.equal(cfgBody.ws, '/ws');
  assert.equal(cfgBody.settings.tickHz, DEFAULT_CONFIG.tickHz);
  db.close();
});

test('admin PIN gates settings writes', async () => {
  const db = openDatabase(':memory:');
  const hub = new GameHub(db);
  const app = createApp({ hub, adminPin: 'secret', webRoot: null });
  const denied = await app.request('/api/admin/settings');
  assert.equal(denied.status, 401);

  const ok = await app.request('/api/admin/settings', {
    headers: { 'x-admin-pin': 'secret' },
  });
  assert.equal(ok.status, 200);

  const put = await app.request('/api/admin/settings', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-admin-pin': 'secret',
    },
    body: JSON.stringify({ ...DEFAULT_CONFIG, tickHz: 30 }),
  });
  assert.equal(put.status, 200);
  const saved = (await put.json()) as { settings: { tickHz: number } };
  assert.equal(saved.settings.tickHz, 30);
  db.close();
});
