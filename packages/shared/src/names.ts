const ADJ = [
  'Neon',
  'Volt',
  'Ion',
  'Nova',
  'Pulse',
  'Aether',
  'Flux',
  'Prism',
  'Chrome',
  'Vivid',
  'Solar',
  'Lucid',
] as const;

const NOUN = [
  'Viper',
  'Ghost',
  'Spark',
  'Wisp',
  'Lynx',
  'Rogue',
  'Drift',
  'Echo',
  'Flare',
  'Onyx',
  'Blade',
  'Moth',
] as const;

export function randomName(rand: () => number = Math.random): string {
  const a = ADJ[Math.floor(rand() * ADJ.length)] ?? 'Neon';
  const n = NOUN[Math.floor(rand() * NOUN.length)] ?? 'Ghost';
  return `${a}${n}`;
}

export function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : fallback;
}
