export const CARD_IDS = [
  'spark',
  'brute',
  'swarm',
  'wisp',
  'moth',
  'turret',
  'spire',
  'meteor',
] as const;

export type CardId = (typeof CARD_IDS)[number];

export type CardRole = 'melee' | 'ranged' | 'flying' | 'building' | 'spell';

export type CardDef = {
  id: CardId;
  name: string;
  cost: number;
  role: CardRole;
  blurb: string;
  hp: number;
  dmg: number;
  range: number;
  speed: number;
  paint: number;
  attackSec: number;
  count: number;
  lifetimeSec: number | null;
};

export const CARD_CATALOG: Record<CardId, CardDef> = {
  spark: {
    id: 'spark',
    name: 'Spark',
    cost: 2,
    role: 'melee',
    blurb: 'Melee. Drops only on your color',
    hp: 100,
    dmg: 32,
    range: 0.7,
    speed: 4.5,
    paint: 0.95,
    attackSec: 0.65,
    count: 1,
    lifetimeSec: null,
  },
  brute: {
    id: 'brute',
    name: 'Brute',
    cost: 5,
    role: 'melee',
    blurb: 'Melee tank. Paints a path',
    hp: 480,
    dmg: 54,
    range: 0.9,
    speed: 2.1,
    paint: 1.5,
    attackSec: 1.05,
    count: 1,
    lifetimeSec: null,
  },
  swarm: {
    id: 'swarm',
    name: 'Swarm',
    cost: 4,
    role: 'melee',
    blurb: 'Three melee motes',
    hp: 50,
    dmg: 18,
    range: 0.55,
    speed: 4.9,
    paint: 0.6,
    attackSec: 0.55,
    count: 3,
    lifetimeSec: null,
  },
  wisp: {
    id: 'wisp',
    name: 'Wisp',
    cost: 3,
    role: 'ranged',
    blurb: 'Archer. Hits air and ground',
    hp: 82,
    dmg: 26,
    range: 5.8,
    speed: 2.9,
    paint: 0.75,
    attackSec: 0.8,
    count: 1,
    lifetimeSec: null,
  },
  moth: {
    id: 'moth',
    name: 'Moth',
    cost: 4,
    role: 'flying',
    blurb: 'Flying. Melee cannot hit it',
    hp: 110,
    dmg: 28,
    range: 2.4,
    speed: 5.2,
    paint: 1.05,
    attackSec: 0.7,
    count: 1,
    lifetimeSec: null,
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    cost: 3,
    role: 'building',
    blurb: 'Short-range defense',
    hp: 320,
    dmg: 36,
    range: 5.2,
    speed: 0,
    paint: 0.45,
    attackSec: 0.55,
    count: 1,
    lifetimeSec: 16,
  },
  spire: {
    id: 'spire',
    name: 'Spire',
    cost: 6,
    role: 'building',
    blurb: 'Long-range tower. Hits air',
    hp: 420,
    dmg: 58,
    range: 11.5,
    speed: 0,
    paint: 0.5,
    attackSec: 1.15,
    count: 1,
    lifetimeSec: 22,
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    cost: 5,
    role: 'spell',
    blurb: 'Goes anywhere. Converts a crater',
    hp: 0,
    dmg: 90,
    range: 3.1,
    speed: 0,
    paint: 3.4,
    attackSec: 0,
    count: 0,
    lifetimeSec: null,
  },
};

export const DEFAULT_DECK: readonly CardId[] = CARD_IDS;

export function cardOf(id: string): CardDef | null {
  if (id in CARD_CATALOG) return CARD_CATALOG[id as CardId];
  return null;
}

export function isSpell(id: CardId): boolean {
  return CARD_CATALOG[id].role === 'spell';
}
