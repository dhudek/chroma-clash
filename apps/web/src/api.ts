import type { ArenaConfig, GameConfig } from '@clash/shared';

export type Health = {
  ok: true;
  service: string;
  protocol: number;
  node: string;
  sqlite: string;
  uptime: number;
};

export type MatchRecord = {
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

async function readJson<T>(res: Response, fail: string): Promise<T> {
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(fail);
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  return readJson<Health>(res, 'health');
}

export async function fetchSettings(pin: string): Promise<GameConfig> {
  const res = await fetch('/api/admin/settings', {
    headers: { 'x-admin-pin': pin },
  });
  const body = await readJson<{ settings: GameConfig }>(res, 'settings');
  return body.settings;
}

export async function putSettings(
  pin: string,
  settings: GameConfig,
): Promise<GameConfig> {
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-admin-pin': pin,
    },
    body: JSON.stringify(settings),
  });
  const body = await readJson<{ settings: GameConfig }>(res, 'save');
  return body.settings;
}

export async function fetchArenaSettings(pin: string): Promise<ArenaConfig> {
  const res = await fetch('/api/admin/arena', {
    headers: { 'x-admin-pin': pin },
  });
  const body = await readJson<{ settings: ArenaConfig }>(res, 'arena');
  return body.settings;
}

export async function putArenaSettings(
  pin: string,
  settings: ArenaConfig,
): Promise<ArenaConfig> {
  const res = await fetch('/api/admin/arena', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-admin-pin': pin,
    },
    body: JSON.stringify(settings),
  });
  const body = await readJson<{ settings: ArenaConfig }>(res, 'save');
  return body.settings;
}

export async function fetchMatches(pin: string): Promise<MatchRecord[]> {
  const res = await fetch('/api/admin/matches', {
    headers: { 'x-admin-pin': pin },
  });
  const body = await readJson<{ matches: MatchRecord[] }>(res, 'matches');
  return body.matches;
}
