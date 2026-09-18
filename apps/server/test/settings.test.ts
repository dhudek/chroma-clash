import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DEFAULT_CONFIG, mergeConfig } from '@clash/shared';

import { openDatabase } from '../src/db.ts';
import { loadSettings, saveSettings } from '../src/settings.ts';

test('node:sqlite in-memory settings roundtrip', () => {
  const db = openDatabase(':memory:');
  const loaded = loadSettings(db);
  assert.deepEqual(loaded, DEFAULT_CONFIG);
  const next = mergeConfig({ tickHz: 30, matchSec: 45, aiSkill: 0.9 });
  saveSettings(db, next);
  assert.deepEqual(loadSettings(db), next);
  db.close();
});

test('corrupt settings fall back to defaults', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
    'game',
    '{not json',
  );
  const loaded = loadSettings(db);
  assert.deepEqual(loaded, DEFAULT_CONFIG);
  db.close();
});

test('node:sqlite timeout option constructs a database', () => {
  const db = new DatabaseSync(':memory:', { timeout: 5000 });
  db.exec('CREATE TABLE t (id INTEGER)');
  db.prepare('INSERT INTO t VALUES (?)').run(1);
  const row = db.prepare('SELECT id FROM t').get() as { id: number };
  assert.equal(row.id, 1);
  db.close();
});
