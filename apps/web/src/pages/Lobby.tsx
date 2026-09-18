import { useEffect, useState } from 'react';

import type { GameKind } from '@clash/shared';

import { fetchHealth, type Health } from '../api';
import { loadName, saveName } from '../game/net';
import { Ambient } from './Ambient';

export type PlayIntent =
  | { kind: 'cpu'; game: GameKind }
  | { kind: 'queue'; game: GameKind }
  | { kind: 'create'; game: GameKind }
  | { kind: 'join'; code: string; game: GameKind };

type Props = {
  onPlay: (name: string, intent: PlayIntent) => void;
  onAdmin: () => void;
};

export function Lobby({ onPlay, onAdmin }: Props) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [game, setGame] = useState<GameKind>('arena');

  useEffect(() => {
    void fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const go = (intent: PlayIntent) => {
    const trimmed = name.trim();
    saveName(trimmed);
    onPlay(trimmed, intent);
  };

  return (
    <div className="shell">
      <Ambient />
      <div className="veil" />
      <div className="grain" />
      <div className="lobby">
        <div className="panel">
          <div className="brand">
            <div className="orbs" aria-hidden="true">
              <i />
              <i />
            </div>
            <p className="eyebrow">latency-first arena</p>
          </div>
          <h1>COLOR CLASH</h1>
          <p className="lede">
            {game === 'arena'
              ? 'The board starts split. Drop units on YOUR color. Meteor can hit anywhere. Convert every square.'
              : 'Spray the void. Magenta versus cyan. WASD to move, Space to dash.'}
          </p>
          <div className="mode">
            <button
              type="button"
              className={game === 'arena' ? 'on' : ''}
              onClick={() => setGame('arena')}
            >
              Arena
            </button>
            <button
              type="button"
              className={game === 'spray' ? 'on' : ''}
              onClick={() => setGame('spray')}
            >
              Spray
            </button>
          </div>
          <label className="field">
            Callsign
            <input
              type="text"
              maxLength={16}
              placeholder="NeonViper"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="cta">
            <button
              className="btn btn-cyan"
              type="button"
              onClick={() => go({ kind: 'cpu', game })}
            >
              Hunt the CPU
            </button>
            <button
              className="btn btn-magenta"
              type="button"
              onClick={() => go({ kind: 'queue', game })}
            >
              Find a hunter
            </button>
            <div className="split">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => go({ kind: 'create', game })}
              >
                Private room
              </button>
              <div className="row" style={{ flex: 1, minWidth: 180 }}>
                <input
                  type="text"
                  maxLength={8}
                  placeholder="CODE"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={code.trim().length < 4}
                  onClick={() => go({ kind: 'join', code: code.trim(), game })}
                >
                  Join
                </button>
              </div>
            </div>
          </div>
          <div className="foot">
            <span>
              {health !== null
                ? `api live · ${health.node} · ${health.sqlite}`
                : 'api offline — start the server'}
            </span>
            <button className="linkish" type="button" onClick={onAdmin}>
              admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
