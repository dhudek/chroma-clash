import { z } from 'zod';

import type { ArenaConfig } from './arena-config.ts';
import type { ArenaView } from './arena-sim.ts';
import { CARD_IDS } from './cards.ts';
import type { GameConfig } from './config.ts';
import type {
  GameKind,
  MatchEndReason,
  MatchMode,
  Phase,
  Side,
  Winner,
} from './kinds.ts';

export const PROTOCOL_VERSION = 2 as const;

export type {
  GameKind,
  MatchEndReason,
  MatchMode,
  Phase,
  Side,
  Winner,
} from './kinds.ts';

export const gameKindSchema = z.enum(['spray', 'arena']);
export const cardIdSchema = z.enum(CARD_IDS);

export const playerInputSchema = z.object({
  seq: z.number().finite(),
  dx: z.number().finite(),
  dy: z.number().finite(),
  dash: z.boolean(),
});

export type PlayerInput = z.infer<typeof playerInputSchema>;

export const NEUTRAL_INPUT: PlayerInput = {
  seq: 0,
  dx: 0,
  dy: 0,
  dash: false,
};

export const clientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    guestId: z.string().max(64),
    name: z.string().max(16),
  }),
  z.object({
    type: z.literal('play_cpu'),
    game: gameKindSchema.optional(),
  }),
  z.object({
    type: z.literal('queue'),
    game: gameKindSchema.optional(),
  }),
  z.object({
    type: z.literal('create_room'),
    game: gameKindSchema.optional(),
  }),
  z.object({
    type: z.literal('join_room'),
    code: z.string().min(4).max(8),
  }),
  z.object({
    type: z.literal('input'),
    seq: z.number().finite(),
    dx: z.number().finite(),
    dy: z.number().finite(),
    dash: z.boolean(),
  }),
  z.object({
    type: z.literal('play_card'),
    cardId: cardIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    type: z.literal('ping'),
    t: z.number().finite(),
  }),
  z.object({ type: z.literal('leave') }),
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;

export function gameOf(
  msg: { game?: GameKind | undefined },
): GameKind {
  return msg.game ?? 'spray';
}

export type DirtyCell = {
  i: number;
  v: 0 | 1 | 2;
};

export type PlayerView = {
  x: number;
  y: number;
  dashReadyIn: number;
};

export type StatePayload = {
  tick: number;
  phase: Phase;
  timeLeft: number;
  countdownLeft: number;
  you: PlayerView;
  opp: PlayerView;
  scores: { p1: number; p2: number; empty: number };
  dirty: readonly DirtyCell[];
  grid?: string;
  winner: Winner;
};

export type ServerMsg =
  | { type: 'welcome'; guestId: string; name: string; protocol: typeof PROTOCOL_VERSION }
  | { type: 'queued' }
  | { type: 'room'; code: string }
  | { type: 'waiting'; message: string }
  | {
      type: 'match_start';
      game: 'spray';
      matchId: string;
      mode: MatchMode;
      side: Side;
      names: { p1: string; p2: string };
      config: GameConfig;
      state: StatePayload;
    }
  | {
      type: 'match_start';
      game: 'arena';
      matchId: string;
      mode: MatchMode;
      side: Side;
      names: { p1: string; p2: string };
      config: ArenaConfig;
      state: ArenaView;
    }
  | { type: 'state'; game: 'spray'; state: StatePayload }
  | { type: 'state'; game: 'arena'; state: ArenaView }
  | {
      type: 'match_end';
      winner: Winner;
      scores: { p1: number; p2: number; empty: number };
      reason: MatchEndReason;
    }
  | { type: 'pong'; t: number; serverT: number }
  | { type: 'error'; message: string };

const MAX_MSG_BYTES = 4096;

export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MSG_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = clientMsgSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function encodeGrid(grid: Uint8Array): string {
  let bin = '';
  for (const byte of grid) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function decodeGrid(b64: string, expected: number): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(expected);
  const n = Math.min(bin.length, expected);
  for (let i = 0; i < n; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function clampInput(raw: PlayerInput): PlayerInput {
  const dx = clamp(raw.dx, -1, 1);
  const dy = clamp(raw.dy, -1, 1);
  return {
    seq: raw.seq,
    dx: Number.isFinite(dx) ? dx : 0,
    dy: Number.isFinite(dy) ? dy : 0,
    dash: raw.dash,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
