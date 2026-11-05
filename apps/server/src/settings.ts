import {
  DEFAULT_ARENA,
  DEFAULT_CONFIG,
  arenaConfigSchema,
  cardTableSchema,
  defaultCardTable,
  gameConfigSchema,
  mergeCardTable,
  type ArenaConfig,
  type CardTable,
  type GameConfig,
} from '@clash/shared';

import type { AppDb } from './db.ts';

const SPRAY_KEY = 'game';
const ARENA_KEY = 'arena';
const CARDS_KEY = 'cards';

export function loadSettings(db: AppDb): GameConfig {
  return loadJson(db, SPRAY_KEY, DEFAULT_CONFIG, gameConfigSchema.parse);
}

export function saveSettings(db: AppDb, config: GameConfig): GameConfig {
  return saveJson(db, SPRAY_KEY, config);
}

export function loadArenaSettings(db: AppDb): ArenaConfig {
  return loadJson(db, ARENA_KEY, DEFAULT_ARENA, arenaConfigSchema.parse);
}

export function saveArenaSettings(db: AppDb, config: ArenaConfig): ArenaConfig {
  return saveJson(db, ARENA_KEY, config);
}

export function loadCardTable(db: AppDb): CardTable {
  const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const row = stmt.get(CARDS_KEY) as { value: string } | undefined;
  if (row === undefined) {
    const fresh = defaultCardTable();
    saveJson(db, CARDS_KEY, fresh);
    return fresh;
  }
  try {
    return mergeCardTable(JSON.parse(row.value) as unknown);
  } catch {
    const fresh = defaultCardTable();
    saveJson(db, CARDS_KEY, fresh);
    return fresh;
  }
}

export function saveCardTable(db: AppDb, table: CardTable): CardTable {
  const parsed = cardTableSchema.parse(table);
  return saveJson(db, CARDS_KEY, parsed);
}

function loadJson<T>(
  db: AppDb,
  key: string,
  fallback: T,
  parse: (value: unknown) => T,
): T {
  const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const row = stmt.get(key) as { value: string } | undefined;
  if (row === undefined) {
    saveJson(db, key, fallback);
    return { ...fallback };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value) as unknown;
  } catch {
    saveJson(db, key, fallback);
    return { ...fallback };
  }
  try {
    return parse({ ...fallback, ...asRecord(parsed) });
  } catch {
    saveJson(db, key, fallback);
    return { ...fallback };
  }
}

function saveJson<T>(db: AppDb, key: string, value: T): T {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}
