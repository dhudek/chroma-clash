import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDb = DatabaseSync;

export function openDatabase(dbPath: string): AppDb {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      p1_name TEXT NOT NULL,
      p2_name TEXT NOT NULL,
      p1_score INTEGER NOT NULL,
      p2_score INTEGER NOT NULL,
      winner INTEGER NOT NULL,
      reason TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export type MatchRow = {
  id: string;
  mode: string;
  p1_name: string;
  p2_name: string;
  p1_score: number;
  p2_score: number;
  winner: number;
  reason: string;
  duration_ms: number;
  created_at: number;
};

export function insertMatch(
  db: AppDb,
  row: MatchRow,
): void {
  const stmt = db.prepare(`
    INSERT INTO matches (
      id, mode, p1_name, p2_name, p1_score, p2_score,
      winner, reason, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    row.id,
    row.mode,
    row.p1_name,
    row.p2_name,
    row.p1_score,
    row.p2_score,
    row.winner,
    row.reason,
    row.duration_ms,
    row.created_at,
  );
}

export function listMatches(db: AppDb, limit = 40): MatchRow[] {
  const stmt = db.prepare(
    `SELECT * FROM matches ORDER BY created_at DESC LIMIT ?`,
  );
  const rows = stmt.all(limit) as MatchRow[];
  return rows;
}
