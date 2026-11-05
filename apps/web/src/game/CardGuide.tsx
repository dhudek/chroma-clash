import {
  CARD_IDS,
  CARD_CATALOG,
  DECK_SIZE,
  deckGaps,
  deckGroup,
  legalDeck,
  roleLabel,
  tunedCard,
  type CardDef,
  type CardId,
  type CardTable,
  type DeckGroup,
} from '@clash/shared';
import { useState, type CSSProperties } from 'react';

import { CARD_LOOK } from './CardFace';
import { PortraitStage } from './PortraitStage';

const GROUP_COPY: Record<DeckGroup, { title: string; hint: string }> = {
  fighter: { title: 'Fighters', hint: 'Melee. They walk in and strike.' },
  ranged: { title: 'Ranged', hint: 'Archers and the flier. They shoot.' },
  tower: { title: 'Towers', hint: 'They stay on the square you drop them.' },
  spell: { title: 'Spells', hint: 'One shot, on any open ground.' },
};

const GAP_NAME: Record<DeckGroup, string> = {
  fighter: 'a fighter',
  ranged: 'a ranged card',
  tower: 'a tower',
  spell: 'a spell',
};

type Props = {
  table: CardTable;
  deck: readonly CardId[];
  onDeck: (deck: CardId[]) => void;
};

export function CardGuide({ table, deck, onDeck }: Props) {
  const [focus, setFocus] = useState<CardId>(deck[0] ?? 'spark');
  const [nonce, setNonce] = useState(0);
  const def = tunedCard(table, focus) ?? CARD_CATALOG[focus];
  const look = CARD_LOOK[focus];
  const gaps = deckGaps(deck);
  const ready = legalDeck(deck);

  const hello = (id: CardId) => {
    setFocus(id);
    setNonce((n) => n + 1);
  };

  const toggle = (id: CardId) => {
    if (deck.includes(id)) {
      onDeck(deck.filter((card) => card !== id));
      return;
    }
    if (deck.length >= DECK_SIZE) return;
    onDeck([...deck, id]);
  };

  let note = 'Eight cards. Bring a fighter, a ranged card, a tower, and a spell.';
  if (deck.length < DECK_SIZE) note = `${deck.length} of ${DECK_SIZE}. Add ${DECK_SIZE - deck.length} more.`;
  else if (!ready) note = `Add ${gaps.map((gap) => GAP_NAME[gap]).join(', ')}.`;
  else note = 'Deck ready. Click a character and she says hello.';

  return (
    <section className="roster" aria-label="Deck">
      <div className="deck-bar">
        <p className="roster-label">Your deck</p>
        <p className={ready ? 'deck-note ok' : 'deck-note'}>{note}</p>
      </div>
      <div className="deck-tray">
        {Array.from({ length: DECK_SIZE }, (_, index) => {
          const id = deck[index];
          if (id === undefined) {
            return <div key={`empty-${index}`} className="deck-slot empty" />;
          }
          const tone = CARD_LOOK[id];
          return (
            <div
              key={id}
              className="deck-slot"
              style={{ '--accent': tone.accent } as CSSProperties}
            >
              <button type="button" className="stage-hit" onClick={() => hello(id)}>
                <PortraitStage id={id} flirtNonce={id === focus ? nonce : 0} />
              </button>
              <button
                type="button"
                className="slot-x"
                aria-label={`Remove ${CARD_CATALOG[id].name}`}
                onClick={() => toggle(id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {(['fighter', 'ranged', 'tower', 'spell'] as const).map((group) => (
        <div key={group} className="deck-group">
          <header>
            <h3>{GROUP_COPY[group].title}</h3>
            <p>{GROUP_COPY[group].hint}</p>
          </header>
          <div className="roster-grid">
            {CARD_IDS.filter((id) => deckGroup(CARD_CATALOG[id].role) === group).map((id) => {
              const card = tunedCard(table, id) ?? CARD_CATALOG[id];
              const tone = CARD_LOOK[id];
              const picked = deck.includes(id);
              const full = !picked && deck.length >= DECK_SIZE;
              return (
                <div
                  key={id}
                  className={picked ? 'pick on' : 'pick'}
                  style={{ '--accent': tone.accent, '--glow': tone.glow } as CSSProperties}
                >
                  <button
                    type="button"
                    className="stage-hit"
                    aria-label={`${card.name}. Click for a hello.`}
                    onClick={() => hello(id)}
                  >
                    <PortraitStage id={id} flirtNonce={id === focus ? nonce : 0} />
                    <span className="pick-cost">{card.cost}</span>
                    <span>{card.name}</span>
                    <em>{roleLabel(card.role)}</em>
                  </button>
                  <button
                    type="button"
                    className="deck-toggle"
                    aria-pressed={picked}
                    disabled={full}
                    onClick={() => toggle(id)}
                  >
                    {picked ? 'Remove' : full ? 'Full' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <article
        className="card-sheet"
        style={
          {
            '--accent': look.accent,
            '--glow': look.glow,
            '--ink': look.ink,
          } as CSSProperties
        }
      >
        <PortraitStage id={focus} flirtNonce={nonce} />
        <div>
          <h2>{def.name}</h2>
          <p className="sheet-role">{roleLabel(def.role)}</p>
          <p className="about">{def.about}</p>
          <dl className="card-stats">
            {statLine(def).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </article>
    </section>
  );
}

function statLine(def: CardDef): { label: string; value: string }[] {
  const rows = [{ label: 'Energy', value: String(def.cost) }];
  if (def.role === 'spell') {
    rows.push(
      { label: 'Damage', value: String(def.dmg) },
      { label: 'Blast', value: String(def.range) },
      { label: 'Paint', value: String(def.paint) },
      { label: 'Lands', value: 'Anywhere' },
    );
    return rows;
  }
  rows.push(
    { label: 'HP', value: String(def.hp) },
    { label: 'Damage', value: String(def.dmg) },
    { label: 'Range', value: String(def.range) },
  );
  if (def.speed <= 0) rows.push({ label: 'Move', value: 'Stays put' });
  else rows.push({ label: 'Speed', value: String(def.speed) });
  rows.push({ label: 'Paint', value: String(def.paint) });
  rows.push({ label: 'Blocks', value: `${def.span}×${def.span}` });
  if (def.count > 1) rows.push({ label: 'Drops', value: String(def.count) });
  return rows;
}
