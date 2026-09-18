import {
  ARENA_CONFIG_META,
  CONFIG_META,
  DEFAULT_ARENA,
  DEFAULT_CONFIG,
  type ArenaConfig,
  type GameConfig,
} from '@clash/shared';
import { useState } from 'react';

import {
  fetchArenaSettings,
  fetchMatches,
  fetchSettings,
  putArenaSettings,
  putSettings,
  type MatchRecord,
} from '../api';
import { Ambient } from './Ambient';

type Props = {
  onBack: () => void;
};

const SPRAY_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof GameConfig)[];
const ARENA_KEYS = Object.keys(DEFAULT_ARENA) as (keyof ArenaConfig)[];

export function Admin({ onBack }: Props) {
  const [pin, setPin] = useState(sessionStorage.getItem('clash.pin') ?? '');
  const [tab, setTab] = useState<'spray' | 'arena'>('arena');
  const [spray, setSpray] = useState<GameConfig | null>(null);
  const [arena, setArena] = useState<ArenaConfig | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const unlock = async () => {
    setError(null);
    try {
      const next = await fetchSettings(pin);
      const ar = await fetchArenaSettings(pin);
      sessionStorage.setItem('clash.pin', pin);
      setSpray(next);
      setArena(ar);
      setMatches(await fetchMatches(pin));
    } catch {
      setError('Bad PIN or API is down.');
      setSpray(null);
      setArena(null);
    }
  };

  const save = async () => {
    if (spray === null || arena === null) return;
    setError(null);
    setSaved(false);
    try {
      if (tab === 'spray') setSpray(await putSettings(pin, spray));
      else setArena(await putArenaSettings(pin, arena));
      setSaved(true);
    } catch {
      setError('Could not save.');
    }
  };

  return (
    <div className="shell">
      <Ambient />
      <div className="veil" />
      <div className="admin">
        <div className="admin-wrap panel">
          <p className="eyebrow">control deck</p>
          <h1>ADMIN</h1>
          <p className="lede">
            Live variables seed the next match. Spray and Arena are stored
            separately. Default PIN is <code>clash</code>.
          </p>
          {spray === null || arena === null ? (
            <div className="row">
              <label className="field">
                Admin PIN
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void unlock();
                  }}
                />
              </label>
              <button className="btn btn-cyan" type="button" onClick={() => void unlock()}>
                Unlock
              </button>
            </div>
          ) : (
            <>
              <div className="mode">
                <button
                  type="button"
                  className={tab === 'arena' ? 'on' : ''}
                  onClick={() => setTab('arena')}
                >
                  Arena
                </button>
                <button
                  type="button"
                  className={tab === 'spray' ? 'on' : ''}
                  onClick={() => setTab('spray')}
                >
                  Spray
                </button>
              </div>
              {tab === 'spray' ? (
                <div className="grid-vars">
                  {SPRAY_KEYS.map((key) => {
                    const meta = CONFIG_META[key];
                    const shape = DEFAULT_CONFIG[key];
                    const value = spray[key];
                    return (
                      <div className="var" key={key}>
                        <header>
                          <span>{meta.label}</span>
                          <b>{formatVal(value)}</b>
                        </header>
                        <div className="hint">{meta.hint}</div>
                        <input
                          type="range"
                          min={sprayRange(key).min}
                          max={sprayRange(key).max}
                          step={meta.step}
                          value={value}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setSpray({
                              ...spray,
                              [key]: Number.isInteger(shape) ? Math.round(n) : n,
                            });
                            setSaved(false);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid-vars">
                  {ARENA_KEYS.map((key) => {
                    const meta = ARENA_CONFIG_META[key];
                    const shape = DEFAULT_ARENA[key];
                    const value = arena[key];
                    return (
                      <div className="var" key={key}>
                        <header>
                          <span>{meta.label}</span>
                          <b>{formatVal(value)}</b>
                        </header>
                        <div className="hint">{meta.hint}</div>
                        <input
                          type="range"
                          min={arenaRange(key).min}
                          max={arenaRange(key).max}
                          step={meta.step}
                          value={value}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setArena({
                              ...arena,
                              [key]: Number.isInteger(shape) ? Math.round(n) : n,
                            });
                            setSaved(false);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="row">
                <button className="btn btn-cyan" type="button" onClick={() => void save()}>
                  Save to sqlite
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    if (tab === 'spray') setSpray({ ...DEFAULT_CONFIG });
                    else setArena({ ...DEFAULT_ARENA });
                    setSaved(false);
                  }}
                >
                  Reset defaults
                </button>
                {saved ? <span className="ok">saved</span> : null}
              </div>
              <h3 style={{ marginTop: 28 }}>Recent matches</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>when</th>
                    <th>mode</th>
                    <th>p1</th>
                    <th>p2</th>
                    <th>score</th>
                    <th>end</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.created_at).toLocaleTimeString()}</td>
                      <td>{m.mode}</td>
                      <td>{m.p1_name}</td>
                      <td>{m.p2_name}</td>
                      <td>
                        {m.p1_score}–{m.p2_score}
                      </td>
                      <td>
                        {m.winner === 0 ? 'draw' : `p${m.winner}`} · {m.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {error !== null ? <p className="err">{error}</p> : null}
          <div className="foot">
            <button className="linkish" type="button" onClick={onBack}>
              ← back
            </button>
            <span>PUT /api/admin/settings · /api/admin/arena</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatVal(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function sprayRange(key: keyof GameConfig): { min: number; max: number } {
  switch (key) {
    case 'arenaW':
      return { min: 16, max: 128 };
    case 'arenaH':
      return { min: 9, max: 72 };
    case 'tickHz':
      return { min: 10, max: 60 };
    case 'matchSec':
      return { min: 15, max: 300 };
    case 'speed':
      return { min: 2, max: 24 };
    case 'paintRadius':
      return { min: 0.8, max: 4 };
    case 'dashMul':
      return { min: 1, max: 4 };
    case 'dashTicks':
      return { min: 2, max: 40 };
    case 'dashCooldownTicks':
      return { min: 8, max: 240 };
    case 'aiSkill':
      return { min: 0, max: 1 };
    case 'countdownSec':
      return { min: 0, max: 10 };
    case 'winPct':
      return { min: 0, max: 1 };
  }
}

function arenaRange(key: keyof ArenaConfig): { min: number; max: number } {
  switch (key) {
    case 'arenaW':
      return { min: 12, max: 28 };
    case 'arenaH':
      return { min: 20, max: 48 };
    case 'tickHz':
      return { min: 10, max: 40 };
    case 'matchSec':
      return { min: 30, max: 300 };
    case 'countdownSec':
      return { min: 0, max: 10 };
    case 'energyMax':
      return { min: 6, max: 16 };
    case 'energyStart':
      return { min: 0, max: 10 };
    case 'energyPerSec':
      return { min: 0.1, max: 2 };
    case 'doubleElixirSec':
      return { min: 0, max: 120 };
    case 'aiSkill':
      return { min: 0, max: 1 };
    case 'kingHp':
      return { min: 400, max: 8000 };
    case 'sideHp':
      return { min: 200, max: 5000 };
    case 'unitHpMul':
      return { min: 0.4, max: 3 };
    case 'unitDmgMul':
      return { min: 0.4, max: 3 };
    case 'towerRange':
      return { min: 4, max: 20 };
    case 'kingRange':
      return { min: 6, max: 24 };
    case 'towerDmg':
      return { min: 20, max: 200 };
  }
}
