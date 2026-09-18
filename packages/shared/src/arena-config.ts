import { z } from 'zod';

export const arenaConfigSchema = z.object({
  arenaW: z.number().int().min(12).max(28),
  arenaH: z.number().int().min(20).max(48),
  tickHz: z.number().int().min(10).max(40),
  matchSec: z.number().int().min(30).max(300),
  countdownSec: z.number().int().min(0).max(10),
  energyMax: z.number().min(6).max(16),
  energyStart: z.number().min(0).max(10),
  energyPerSec: z.number().min(0.1).max(2),
  doubleElixirSec: z.number().int().min(0).max(120),
  aiSkill: z.number().min(0).max(1),
  kingHp: z.number().int().min(400).max(8000),
  sideHp: z.number().int().min(200).max(5000),
  unitHpMul: z.number().min(0.4).max(3),
  unitDmgMul: z.number().min(0.4).max(3),
  towerRange: z.number().min(4).max(20),
  kingRange: z.number().min(6).max(24),
  towerDmg: z.number().int().min(20).max(200),
});

export type ArenaConfig = z.infer<typeof arenaConfigSchema>;

export const DEFAULT_ARENA: ArenaConfig = {
  arenaW: 18,
  arenaH: 32,
  tickHz: 20,
  matchSec: 180,
  countdownSec: 3,
  energyMax: 10,
  energyStart: 5,
  energyPerSec: 0.38,
  doubleElixirSec: 30,
  aiSkill: 0.64,
  kingHp: 2400,
  sideHp: 1400,
  unitHpMul: 1,
  unitDmgMul: 1,
  towerRange: 12,
  kingRange: 16,
  towerDmg: 52,
};

export const ARENA_CONFIG_META: {
  readonly [K in keyof ArenaConfig]: {
    readonly label: string;
    readonly hint: string;
    readonly step: number;
  };
} = {
  arenaW: { label: 'Arena width', hint: 'Cells across', step: 1 },
  arenaH: { label: 'Arena height', hint: 'Cells down', step: 1 },
  tickHz: { label: 'Tick rate', hint: 'Server Hz', step: 1 },
  matchSec: { label: 'Match length', hint: 'Seconds after countdown', step: 5 },
  countdownSec: { label: 'Countdown', hint: 'Seconds', step: 1 },
  energyMax: { label: 'Energy cap', hint: 'Pips', step: 1 },
  energyStart: { label: 'Start energy', hint: 'Pips at whistle', step: 0.5 },
  energyPerSec: { label: 'Energy / sec', hint: 'Before double time', step: 0.02 },
  doubleElixirSec: { label: 'Double energy', hint: 'Last N seconds', step: 5 },
  aiSkill: { label: 'AI skill', hint: '0 sleepy · 1 sweaty', step: 0.01 },
  kingHp: { label: 'Keep HP', hint: 'Long-range keep', step: 50 },
  sideHp: { label: 'Cannon HP', hint: 'Side guns', step: 50 },
  unitHpMul: { label: 'Unit HP mul', hint: 'Global health', step: 0.05 },
  unitDmgMul: { label: 'Unit DMG mul', hint: 'Global damage', step: 0.05 },
  towerRange: { label: 'Cannon range', hint: 'Side tower cells', step: 0.2 },
  kingRange: { label: 'Keep range', hint: 'King cells', step: 0.2 },
  towerDmg: { label: 'Tower damage', hint: 'Per shot', step: 2 },
};

export function mergeArena(partial: Partial<ArenaConfig>): ArenaConfig {
  return arenaConfigSchema.parse({ ...DEFAULT_ARENA, ...partial });
}
