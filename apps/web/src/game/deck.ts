import { acceptDeck, normalizeDeck, type CardId } from '@clash/shared';

const KEY = 'clash.deck';

export function loadDeck(): CardId[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return acceptDeck(undefined);
    return normalizeDeck(JSON.parse(raw) as unknown);
  } catch {
    return acceptDeck(undefined);
  }
}

export function saveDeck(deck: readonly CardId[]): void {
  localStorage.setItem(KEY, JSON.stringify(deck));
}
