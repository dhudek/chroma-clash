import { z } from 'zod';

export const gameConfigSchema = z.object({
  arenaW: z.number().int().min(16).max(128),
  arenaH: z.number().int().min(9).max(72),
  tickHz: z.number().int().min(10).max(60),
  matchSec: z.number().int().min(15).max(300),
  speed: z.number().min(2).max(24),
  paintRadius: z.number().min(0.8).max(4),
  dashMul: z.number().min(1).max(4),
  dashTicks: z.number().int().min(2).max(40),
  dashCooldownTicks: z.number().int().min(8).max(240),
  aiSkill: z.number().min(0).max(1),
  countdownSec: z.number().int().min(0).max(10),
  winPct: z.number().min(0).max(1),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const DEFAULT_CONFIG: GameConfig = {
  arenaW: 64,
  arenaH: 36,
  tickHz: 20,
  matchSec: 90,
  speed: 9.5,
  paintRadius: 1.7,
  dashMul: 2.35,
  dashTicks: 8,
  dashCooldownTicks: 42,
  aiSkill: 0.68,
  countdownSec: 3,
  winPct: 0,
};

export const CONFIG_META: {
  readonly [K in keyof GameConfig]: {
    readonly label: string;
    readonly hint: string;
    readonly step: number;
  };
} = {
  arenaW: { label: 'Arena width', hint: 'Cells across', step: 1 },
  arenaH: { label: 'Arena height', hint: 'Cells down', step: 1 },
  tickHz: { label: 'Tick rate', hint: 'Server simulation Hz', step: 1 },
  matchSec: { label: 'Match length', hint: 'Seconds after countdown', step: 5 },
  speed: { label: 'Move speed', hint: 'Cells per second', step: 0.1 },
  paintRadius: { label: 'Paint radius', hint: 'Cells', step: 0.05 },
  dashMul: { label: 'Dash multiplier', hint: 'Speed while dashing', step: 0.05 },
  dashTicks: { label: 'Dash duration', hint: 'Ticks', step: 1 },
  dashCooldownTicks: { label: 'Dash cooldown', hint: 'Ticks', step: 1 },
  aiSkill: { label: 'AI skill', hint: '0 timid · 1 ruthless', step: 0.01 },
  countdownSec: { label: 'Countdown', hint: 'Seconds before paint', step: 1 },
  winPct: { label: 'Domination win', hint: '0 = time only, 0.7 = 70% auto-win', step: 0.05 },
};

export function mergeConfig(partial: Partial<GameConfig>): GameConfig {
  return gameConfigSchema.parse({ ...DEFAULT_CONFIG, ...partial });
}
