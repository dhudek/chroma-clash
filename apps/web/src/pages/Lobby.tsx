import { useEffect, useState } from 'react';

import {
  deckGaps,
  defaultCardTable,
  legalDeck,
  type CardId,
  type CardTable,
  type GameKind,
} from '@clash/shared';

import { fetchHealth, fetchPublicCards, type Health } from '../api';
import { CardGuide } from '../game/CardGuide';
import { loadDeck, saveDeck } from '../game/deck';
import { loadName, saveName } from '../game/net';
import { saveSeat } from '../game/seat';
import { Ambient } from './Ambient';

export type PlayIntent =
  | { kind: 'cpu'; game: GameKind; deck?: CardId[] }
  | { kind: 'queue'; game: GameKind; deck?: CardId[] }
  | { kind: 'create'; game: GameKind; deck?: CardId[] }
  | { kind: 'join'; code: string; game: GameKind; deck?: CardId[] }
  | { kind: 'resume'; game: GameKind };

type Props = {
  onPlay: (name: string, intent: PlayIntent) => void;
  onAdmin: () => void;
};

export function Lobby({ onPlay, onAdmin }: Props) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [cards, setCards] = useState<CardTable>(defaultCardTable);
  const [game, setGame] = useState<GameKind>('arena');
  const [deck, setDeck] = useState<CardId[]>(() => loadDeck());
  const [cardsOpen, setCardsOpen] = useState(false);
  const deckReady = game !== 'arena' || legalDeck(deck);

  useEffect(() => {
    void fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    void fetchPublicCards()
      .then(setCards)
      .catch(() => setCards(defaultCardTable()));
  }, []);

  useEffect(() => {
    if (!cardsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCardsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardsOpen]);

  const setDeckAndSave = (next: CardId[]) => {
    setDeck(next);
    saveDeck(next);
  };

  const go = (intent: PlayIntent) => {
    if (game === 'arena' && !legalDeck(deck)) return;
    if (intent.kind === 'resume') return;
    const trimmed = name.trim();
    saveName(trimmed);
    saveSeat({
      name: trimmed,
      game,
      kind: intent.kind,
      ...(intent.kind === 'join' ? { room: intent.code } : {}),
    });
    onPlay(trimmed, { ...intent, deck });
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
              ? 'A new map every match. The field opens half pink, half blue.'
              : 'A new map every match. Sprayers step in when the countdown ends. WASD to move, Space to dash.'}
          </p>
          {game === 'arena' ? (
            <div className="deck-status">
              <p className={deckReady ? 'deck-note ok' : 'deck-note'}>{deckLine(deck)}</p>
              <button className="btn btn-ghost" type="button" onClick={() => setCardsOpen(true)}>
                Cards
              </button>
            </div>
          ) : null}
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
              onClick={() => {
                setGame('spray');
                setCardsOpen(false);
              }}
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
              disabled={!deckReady}
              onClick={() => go({ kind: 'cpu', game })}
            >
              Hunt the CPU
            </button>
            <button
              className="btn btn-magenta"
              type="button"
              disabled={!deckReady}
              onClick={() => go({ kind: 'queue', game })}
            >
              Find a hunter
            </button>
            <div className="split">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={!deckReady}
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
                  disabled={!deckReady || code.trim().length < 4}
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
      {cardsOpen && game === 'arena' ? (
        <div className="modal-back" onClick={() => setCardsOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cards"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <p className="eyebrow">deck</p>
              <button className="btn btn-ghost" type="button" onClick={() => setCardsOpen(false)}>
                Close
              </button>
            </div>
            <CardGuide table={cards} deck={deck} onDeck={setDeckAndSave} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function deckLine(deck: readonly CardId[]): string {
  if (deck.length < 8) return `${deck.length} of 8 cards.`;
  const gaps = deckGaps(deck);
  if (gaps.length === 0) return 'Deck ready.';
  const names = gaps.map((gap) => {
    if (gap === 'fighter') return 'a fighter';
    if (gap === 'ranged') return 'a ranged card';
    if (gap === 'tower') return 'a tower';
    return 'a spell';
  });
  return `Still need ${names.join(', ')}.`;
}
