import { CARD_CATALOG, roleLabel, type CardId, type CardTune } from '@clash/shared';
import type { CSSProperties } from 'react';

export const CARD_LOOK: Record<
  CardId,
  { accent: string; glow: string; ink: string }
> = {
  spark: { accent: '#7cf7ff', glow: '#3df0ff', ink: '#052028' },
  brute: { accent: '#ff9a4a', glow: '#ff6b2d', ink: '#1a0c04' },
  swarm: { accent: '#9dff6d', glow: '#6dffb3', ink: '#06140c' },
  wisp: { accent: '#d4b3ff', glow: '#b57cff', ink: '#160824' },
  moth: { accent: '#e8f0ff', glow: '#9ad0ff', ink: '#081018' },
  turret: { accent: '#ffd36a', glow: '#ffb020', ink: '#161004' },
  spire: { accent: '#a8c7ff', glow: '#6ea0ff', ink: '#040816' },
  meteor: { accent: '#ff5ec8', glow: '#ff3d9a', ink: '#1a0412' },
  vale: { accent: '#ff6b7a', glow: '#ff3d55', ink: '#1a060a' },
  bolt: { accent: '#5ee0c5', glow: '#2ec9a8', ink: '#041612' },
  lantern: { accent: '#c4b6ff', glow: '#8d78ff', ink: '#100a1c' },
  flare: { accent: '#ffb15a', glow: '#ff7a3c', ink: '#1a0c04' },
};

export function CardFace({
  id,
  compact = false,
  tune,
}: {
  id: CardId;
  compact?: boolean;
  tune?: CardTune;
}) {
  const def = tune === undefined ? CARD_CATALOG[id] : { ...CARD_CATALOG[id], ...tune };
  const look = CARD_LOOK[id];
  const motion =
    def.role === 'building'
      ? 'is-tower'
      : def.role === 'flying'
        ? 'is-flier'
        : def.role === 'spell'
          ? 'is-spell'
          : 'is-move';
  return (
    <div
      className={`face face-${id} ${motion} ${compact ? 'compact' : ''}`}
      style={
        {
          '--accent': look.accent,
          '--glow': look.glow,
          '--ink': look.ink,
        } as CSSProperties
      }
    >
      <div className="face-art" aria-hidden="true">
        <CardGlyph id={id} />
        <img
          src={`/cards/${id}.png`}
          alt=""
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <span className="face-sheen" />
        {def.span > 1 ? <span className="face-span">{def.span}×{def.span}</span> : null}
      </div>
      <div className="face-meta">
        <span className="cost">{def.cost}</span>
        <strong>{def.name}</strong>
        {compact ? null : <em>{def.blurb}</em>}
        <span className={`role role-${def.role}`}>{roleLabel(def.role)}</span>
      </div>
    </div>
  );
}

function CardGlyph({ id }: { id: CardId }) {
  switch (id) {
    case 'spark':
      return (
        <svg viewBox="0 0 64 64">
          <path d="M34 4 14 36h16l-4 24 26-36H36z" fill="#7cf7ff" stroke="#fff" strokeWidth="1.4" />
        </svg>
      );
    case 'brute':
      return (
        <svg viewBox="0 0 64 64">
          <rect x="14" y="18" width="36" height="32" rx="6" fill="#ff9a4a" />
          <rect x="20" y="24" width="24" height="10" rx="2" fill="#ffd2a8" />
          <rect x="24" y="8" width="16" height="12" rx="3" fill="#ff6b2d" />
        </svg>
      );
    case 'swarm':
      return (
        <svg viewBox="0 0 64 64">
          <circle cx="22" cy="28" r="9" fill="#9dff6d" />
          <circle cx="42" cy="24" r="8" fill="#6dffb3" />
          <circle cx="34" cy="42" r="10" fill="#c8ff8a" />
        </svg>
      );
    case 'wisp':
      return (
        <svg viewBox="0 0 64 64">
          <ellipse cx="32" cy="30" rx="16" ry="20" fill="#d4b3ff" opacity="0.9" />
          <rect x="46" y="14" width="12" height="3" fill="#fff" />
          <rect x="52" y="10" width="3" height="12" fill="#fff" />
        </svg>
      );
    case 'moth':
      return (
        <svg viewBox="0 0 64 64">
          <ellipse cx="20" cy="32" rx="14" ry="10" fill="#cfe8ff" />
          <ellipse cx="44" cy="32" rx="14" ry="10" fill="#9ad0ff" />
          <ellipse cx="32" cy="34" rx="6" ry="10" fill="#fff" />
        </svg>
      );
    case 'turret':
      return (
        <svg viewBox="0 0 64 64">
          <rect x="16" y="36" width="32" height="14" rx="3" fill="#ffd36a" />
          <rect x="28" y="16" width="8" height="24" fill="#ffe9a8" />
          <rect x="30" y="10" width="14" height="6" rx="2" fill="#fff" />
        </svg>
      );
    case 'spire':
      return (
        <svg viewBox="0 0 64 64">
          <path d="M32 6 44 58H20z" fill="#6ea0ff" />
          <rect x="29" y="22" width="6" height="20" fill="#fff" opacity="0.5" />
        </svg>
      );
    case 'meteor':
      return (
        <svg viewBox="0 0 64 64">
          <circle cx="38" cy="26" r="12" fill="#ff3d9a" />
          <path d="M8 52 28 34 34 40z" fill="#ff9ad4" />
          <circle cx="44" cy="20" r="4" fill="#fff" />
        </svg>
      );
    case 'vale':
      return (
        <svg viewBox="0 0 64 64">
          <path d="M30 6h4l2 40h-8z" fill="#ff6b7a" />
          <path d="M18 48h28l-4 8H22z" fill="#ffd0d6" />
        </svg>
      );
    case 'bolt':
      return (
        <svg viewBox="0 0 64 64">
          <path d="M14 46c16-22 22-22 36-4" fill="none" stroke="#5ee0c5" strokeWidth="4" />
          <path d="M44 14v28" stroke="#e8fff8" strokeWidth="3" />
        </svg>
      );
    case 'lantern':
      return (
        <svg viewBox="0 0 64 64">
          <rect x="24" y="18" width="16" height="22" rx="6" fill="#ffb15a" />
          <rect x="30" y="8" width="4" height="12" fill="#c4b6ff" />
          <path d="M22 42h20l-4 10H26z" fill="#8d78ff" />
        </svg>
      );
    case 'flare':
      return (
        <svg viewBox="0 0 64 64">
          <circle cx="32" cy="28" r="8" fill="#ffb15a" />
          <path d="M32 8v8M32 40v8M12 28h8M44 28h8" stroke="#fff" strokeWidth="3" />
        </svg>
      );
  }
}
