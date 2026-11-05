import type { GameKind } from '@clash/shared';

const KEY = 'clash.seat';

export type SeatKind = 'cpu' | 'queue' | 'create' | 'join' | 'resume';

export type Seat = {
  name: string;
  game: GameKind;
  kind: SeatKind;
  room?: string;
};

export function loadSeat(): Seat | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const data = JSON.parse(raw) as unknown;
    if (data === null || typeof data !== 'object') return null;
    const seat = data as { name?: unknown; game?: unknown; kind?: unknown; room?: unknown };
    if (seat.game !== 'arena' && seat.game !== 'spray') return null;
    if (typeof seat.name !== 'string') return null;
    if (
      seat.kind !== 'cpu' &&
      seat.kind !== 'queue' &&
      seat.kind !== 'create' &&
      seat.kind !== 'join' &&
      seat.kind !== 'resume'
    ) {
      return null;
    }
    const room = typeof seat.room === 'string' ? seat.room : undefined;
    return { name: seat.name, game: seat.game, kind: seat.kind, room };
  } catch {
    return null;
  }
}

export function saveSeat(seat: Seat): void {
  localStorage.setItem(KEY, JSON.stringify(seat));
}

export function rememberRoom(code: string): void {
  const seat = loadSeat();
  if (seat === null) return;
  saveSeat({ ...seat, room: code });
}

export function clearSeat(): void {
  localStorage.removeItem(KEY);
}
