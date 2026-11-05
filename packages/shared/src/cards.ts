import { z } from 'zod';

export const CARD_IDS = [
  'spark',
  'brute',
  'swarm',
  'vale',
  'wisp',
  'bolt',
  'moth',
  'turret',
  'spire',
  'lantern',
  'meteor',
  'flare',
] as const;

export type CardId = (typeof CARD_IDS)[number];

export type CardRole = 'melee' | 'ranged' | 'flying' | 'building' | 'spell';

export type CardDef = {
  id: CardId;
  name: string;
  cost: number;
  role: CardRole;
  blurb: string;
  about: string;
  hp: number;
  dmg: number;
  range: number;
  speed: number;
  paint: number;
  attackSec: number;
  count: number;
  /** Side length of the own-color square required to play this card. */
  span: number;
  lifetimeSec: number | null;
};

export const CARD_CATALOG: Record<CardId, CardDef> = {
  spark: {
    id: 'spark',
    name: 'Hoshi',
    cost: 2,
    role: 'melee',
    blurb: 'Fighter. Runs around rocks, paints a trail',
    about:
      'Runs around rocks and paints a trail. She strikes an enemy card in reach, then paints the ground while she chases.',
    hp: 100,
    dmg: 32,
    range: 0.7,
    speed: 4.5,
    paint: 0.95,
    attackSec: 0.65,
    count: 1,
    span: 1,
    lifetimeSec: null,
  },
  brute: {
    id: 'brute',
    name: 'Nana',
    cost: 5,
    role: 'melee',
    blurb: 'Fighter. Tough and slow, wide paint',
    about:
      'Tough and slow, with a wide brush. She strikes an enemy card in reach, then paints the ground as she walks.',
    hp: 480,
    dmg: 54,
    range: 0.9,
    speed: 2.1,
    paint: 1.5,
    attackSec: 1.05,
    count: 1,
    span: 2,
    lifetimeSec: null,
  },
  swarm: {
    id: 'swarm',
    name: 'Mii',
    cost: 4,
    role: 'melee',
    blurb: 'Fighter. Three runners',
    about:
      'Drops three fast runners. Each one strikes an enemy card in reach and paints the ground on the way.',
    hp: 50,
    dmg: 18,
    range: 0.55,
    speed: 4.9,
    paint: 0.6,
    attackSec: 0.55,
    count: 3,
    span: 2,
    lifetimeSec: null,
  },
  wisp: {
    id: 'wisp',
    name: 'Aoi',
    cost: 3,
    role: 'ranged',
    blurb: 'Archer. Walks and shoots',
    about:
      'Walks and shoots. An enemy card in range takes the arrow. With nobody in reach, the arrow paints the ground.',
    hp: 82,
    dmg: 26,
    range: 5.8,
    speed: 2.9,
    paint: 0.75,
    attackSec: 0.8,
    count: 1,
    span: 1,
    lifetimeSec: null,
  },
  moth: {
    id: 'moth',
    name: 'Luna',
    cost: 4,
    role: 'flying',
    blurb: "Flier. Goes over rocks. Fighters can't hit her",
    about:
      'Flies over rocks. Fighters cannot hit her. She shoots an enemy card in range, then paints open ground.',
    hp: 110,
    dmg: 28,
    range: 2.4,
    speed: 5.2,
    paint: 1.05,
    attackSec: 0.7,
    count: 1,
    span: 1,
    lifetimeSec: null,
  },
  turret: {
    id: 'turret',
    name: 'Yui',
    cost: 3,
    role: 'building',
    blurb: 'Tower. Stays put and shoots',
    about:
      'Stays where you drop her. She shoots an enemy card in range, and paints the ground when the lane is empty.',
    hp: 320,
    dmg: 36,
    range: 5.2,
    speed: 0,
    paint: 0.45,
    attackSec: 0.55,
    count: 1,
    span: 2,
    lifetimeSec: null,
  },
  spire: {
    id: 'spire',
    name: 'Sora',
    cost: 6,
    role: 'building',
    blurb: 'Tower. Stays put. Long shots, hits air',
    about:
      'Stays put and fires a long way, including at fliers. An enemy card in range is the shot. Otherwise she paints the ground.',
    hp: 420,
    dmg: 58,
    range: 11.5,
    speed: 0,
    paint: 0.5,
    attackSec: 1.15,
    count: 1,
    span: 3,
    lifetimeSec: null,
  },
  meteor: {
    id: 'meteor',
    name: 'Ember',
    cost: 5,
    role: 'spell',
    blurb: 'Spell. Paints a crater anywhere',
    about:
      'A one-shot spell. Drop her on any open ground. She paints a wide crater and hits every card caught in the blast.',
    hp: 0,
    dmg: 180,
    range: 3.1,
    speed: 0,
    paint: 3.4,
    attackSec: 0,
    count: 0,
    span: 1,
    lifetimeSec: null,
  },
  vale: {
    id: 'vale',
    name: 'Ren',
    cost: 3,
    role: 'melee',
    blurb: 'Fighter. A quick sword',
    about:
      'A duelist with a slim sword. She strikes an enemy card in reach, then paints the ground while she chases.',
    hp: 170,
    dmg: 38,
    range: 0.8,
    speed: 3.4,
    paint: 0.85,
    attackSec: 0.75,
    count: 1,
    span: 1,
    lifetimeSec: null,
  },
  bolt: {
    id: 'bolt',
    name: 'Niko',
    cost: 2,
    role: 'ranged',
    blurb: 'Archer. Light bow, quick shots',
    about:
      'Walks with a light bow. An enemy card in range takes the arrow. With nobody in reach, the arrow paints the ground.',
    hp: 70,
    dmg: 20,
    range: 4.6,
    speed: 3.3,
    paint: 0.55,
    attackSec: 0.65,
    count: 1,
    span: 1,
    lifetimeSec: null,
  },
  lantern: {
    id: 'lantern',
    name: 'Mei',
    cost: 4,
    role: 'building',
    blurb: 'Tower. Stays put and paints wide',
    about:
      'Stays where you drop her. She shoots a short lane, and paints a wide patch when that lane is empty.',
    hp: 360,
    dmg: 22,
    range: 3.8,
    speed: 0,
    paint: 0.85,
    attackSec: 0.85,
    count: 1,
    span: 2,
    lifetimeSec: null,
  },
  flare: {
    id: 'flare',
    name: 'Kiri',
    cost: 3,
    role: 'spell',
    blurb: 'Spell. A small crater anywhere',
    about:
      'A small one-shot spell. Drop her on any open ground. She paints a compact crater and hits cards caught in it.',
    hp: 0,
    dmg: 70,
    range: 2,
    speed: 0,
    paint: 1.8,
    attackSec: 0,
    count: 0,
    span: 1,
    lifetimeSec: null,
  },
};

/** The original eight. A fresh deck, and the CPU's deck. */
export const DEFAULT_DECK: readonly CardId[] = [
  'spark',
  'brute',
  'swarm',
  'wisp',
  'moth',
  'turret',
  'spire',
  'meteor',
];

export const DECK_SIZE = 8;

export type DeckGroup = 'fighter' | 'ranged' | 'tower' | 'spell';

export const DECK_GROUPS: readonly DeckGroup[] = ['fighter', 'ranged', 'tower', 'spell'];

export function deckGroup(role: CardRole): DeckGroup {
  if (role === 'melee') return 'fighter';
  if (role === 'building') return 'tower';
  if (role === 'spell') return 'spell';
  return 'ranged';
}

/** Unique known cards, capped at a deck. */
export function normalizeDeck(value: unknown): CardId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CardId[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || seen.has(item)) continue;
    if (!(item in CARD_CATALOG)) continue;
    seen.add(item);
    out.push(item as CardId);
    if (out.length === DECK_SIZE) break;
  }
  return out;
}

export function deckGaps(ids: readonly CardId[]): DeckGroup[] {
  const have = new Set(ids.map((id) => deckGroup(CARD_CATALOG[id].role)));
  return DECK_GROUPS.filter((group) => !have.has(group));
}

export function legalDeck(ids: readonly CardId[] | undefined): ids is readonly CardId[] {
  if (ids === undefined || ids.length !== DECK_SIZE) return false;
  if (new Set(ids).size !== ids.length) return false;
  return deckGaps(ids).length === 0;
}

export function acceptDeck(value: unknown): CardId[] {
  const deck = normalizeDeck(value);
  return legalDeck(deck) ? [...deck] : [...DEFAULT_DECK];
}

export function cardOf(id: string): CardDef | null {
  if (id in CARD_CATALOG) return CARD_CATALOG[id as CardId];
  return null;
}

export function isSpell(id: CardId): boolean {
  return CARD_CATALOG[id].role === 'spell';
}

export const cardTuneSchema = z.object({
  cost: z.number().min(0).max(12),
  hp: z.number().min(0).max(2400),
  dmg: z.number().min(0).max(800),
  range: z.number().min(0).max(24),
  speed: z.number().min(0).max(12),
  paint: z.number().min(0).max(8),
  attackSec: z.number().min(0).max(5),
  span: z.number().int().min(1).max(4),
  count: z.number().int().min(0).max(6),
});

export type CardTune = z.infer<typeof cardTuneSchema>;
export type CardTable = Record<CardId, CardTune>;

export const CARD_TUNE_KEYS = [
  'cost',
  'hp',
  'dmg',
  'range',
  'speed',
  'paint',
  'attackSec',
  'span',
  'count',
] as const satisfies readonly (keyof CardTune)[];

export const CARD_TUNE_META: Record<
  keyof CardTune,
  { label: string; hint: string; step: number; min: number; max: number }
> = {
  cost: { label: 'Energy', hint: 'Cost to play', step: 1, min: 0, max: 12 },
  hp: { label: 'HP', hint: 'Health of each body', step: 5, min: 0, max: 2400 },
  dmg: { label: 'Damage', hint: 'Per hit, or the whole blast', step: 2, min: 0, max: 800 },
  range: { label: 'Range', hint: 'Cells. Ember uses this as blast radius', step: 0.1, min: 0, max: 24 },
  speed: { label: 'Speed', hint: 'Cells per second. Towers stay planted', step: 0.1, min: 0, max: 12 },
  paint: { label: 'Paint', hint: 'Brush or crater radius', step: 0.05, min: 0, max: 8 },
  attackSec: { label: 'Attack', hint: 'Seconds between shots. 0 is instant', step: 0.05, min: 0, max: 5 },
  span: { label: 'Blocks', hint: 'Square of your color. Ember ignores this', step: 1, min: 1, max: 4 },
  count: { label: 'Bodies', hint: 'How many drop together', step: 1, min: 0, max: 6 },
};

export function defaultCardTable(): CardTable {
  const table = {} as CardTable;
  for (const id of CARD_IDS) {
    const card = CARD_CATALOG[id];
    table[id] = {
      cost: card.cost,
      hp: card.hp,
      dmg: card.dmg,
      range: card.range,
      speed: card.speed,
      paint: card.paint,
      attackSec: card.attackSec,
      span: card.span,
      count: card.count,
    };
  }
  return table;
}

export const cardTableSchema = z.object({
  spark: cardTuneSchema,
  brute: cardTuneSchema,
  swarm: cardTuneSchema,
  vale: cardTuneSchema,
  wisp: cardTuneSchema,
  bolt: cardTuneSchema,
  moth: cardTuneSchema,
  turret: cardTuneSchema,
  spire: cardTuneSchema,
  lantern: cardTuneSchema,
  meteor: cardTuneSchema,
  flare: cardTuneSchema,
});

export function mergeCardTable(value: unknown): CardTable {
  const table = defaultCardTable();
  if (typeof value !== 'object' || value === null) return table;
  const rec = value as Record<string, unknown>;
  for (const id of CARD_IDS) {
    const row = rec[id];
    if (typeof row !== 'object' || row === null) continue;
    const parsed = cardTuneSchema.safeParse({ ...table[id], ...row });
    if (parsed.success) table[id] = parsed.data;
  }
  return table;
}

export function tunedCard(table: CardTable | undefined, id: string): CardDef | null {
  const base = cardOf(id);
  if (base === null) return null;
  if (table === undefined) return base;
  const tune = table[base.id];
  if (tune === undefined) return base;
  return { ...base, ...tune };
}

export function cardBrief(def: CardDef): string {
  if (def.role === 'spell' || def.attackSec <= 0) {
    const per = def.cost > 0 ? def.dmg / def.cost : def.dmg;
    return `Burst ${trimNum(def.dmg)} across ${trimNum(def.range)} cells · paint ${trimNum(def.paint)} · ${trimNum(per)} damage per energy`;
  }
  const bodies = Math.max(1, def.count);
  const dps = (bodies * def.dmg) / Math.max(0.05, def.attackSec);
  const hp = bodies * def.hp;
  const per = def.cost > 0 ? dps / def.cost : dps;
  return `DPS ${trimNum(dps)} · HP ${trimNum(hp)} · ${trimNum(per)} dps per energy`;
}

function trimNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function roleLabel(role: CardRole): string {
  switch (role) {
    case 'melee':
      return 'Fighter';
    case 'ranged':
      return 'Archer';
    case 'flying':
      return 'Flier';
    case 'building':
      return 'Tower';
    case 'spell':
      return 'Spell';
  }
}
