import { useEffect, useRef } from 'react';

import type { CardId } from '@clash/shared';

type ClipName = 'walk' | 'attack' | 'idle' | 'flirt';

type AnimEntry = {
  walk?: number;
  attack?: number;
  idle?: number;
  flirt?: number;
  walkMs?: number;
};

type Manifest = Partial<Record<CardId, AnimEntry>>;

let manifest: Manifest | null = null;
let manifestStarted = false;
const waiters = new Set<() => void>();

function ensureManifest(): void {
  if (manifestStarted || typeof fetch !== 'function') return;
  manifestStarted = true;
  void fetch('/cards/anim/manifest.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      manifest = data !== null && typeof data === 'object' ? (data as Manifest) : {};
      for (const wake of waiters) wake();
      waiters.clear();
    })
    .catch(() => {
      manifest = {};
      for (const wake of waiters) wake();
      waiters.clear();
    });
}

const images = new Map<string, HTMLImageElement>();

function imageOf(src: string): HTMLImageElement {
  const found = images.get(src);
  if (found !== undefined) return found;
  const img = new Image();
  img.src = src;
  images.set(src, img);
  return img;
}

function frameSrc(id: CardId, clip: ClipName, index: number): string {
  return `/cards/anim/${id}/${clip}/${String(index).padStart(2, '0')}.png`;
}

type Ambient = { clip: ClipName; count: number; frameMs: number; restMs?: number };

function ambientOf(entry: AnimEntry | undefined): Ambient | null {
  if (entry === undefined) return null;
  if ((entry.walk ?? 0) > 1) {
    const count = entry.walk ?? 0;
    const cycle = typeof entry.walkMs === 'number' && entry.walkMs > 0 ? entry.walkMs : 1600;
    return { clip: 'walk', count, frameMs: Math.max(50, cycle / count) };
  }
  if ((entry.attack ?? 0) > 1) {
    return { clip: 'attack', count: entry.attack ?? 0, frameMs: 90, restMs: 700 };
  }
  if ((entry.idle ?? 0) >= 1) return { clip: 'idle', count: entry.idle ?? 1, frameMs: 240 };
  return null;
}

function frameIndex(ambient: Ambient, now: number): number {
  if (ambient.clip === 'attack') {
    const play = ambient.count * ambient.frameMs;
    const t = now % (play + (ambient.restMs ?? 0));
    if (t >= play) return 0;
    return Math.min(ambient.count - 1, Math.floor(t / ambient.frameMs));
  }
  return Math.floor(now / ambient.frameMs) % ambient.count;
}

function drawContainBottom(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, h - dh, dw, dh);
}

type Listener = (now: number) => void;
const listeners = new Set<Listener>();
let raf = 0;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) raf = requestAnimationFrame(tick);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) cancelAnimationFrame(raf);
  };
}

function tick(now: number): void {
  for (const listener of listeners) listener(now);
  if (listeners.size > 0) raf = requestAnimationFrame(tick);
}

type Props = {
  id: CardId;
  flirtNonce: number;
};

function bitmapSize(node: HTMLCanvasElement): { w: number; h: number } {
  const rect = node.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return {
    w: Math.max(1, Math.round(rect.width * dpr)),
    h: Math.max(1, Math.round(rect.height * dpr)),
  };
}

export function PortraitStage({ id, flirtNonce }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    ensureManifest();
    const canvas = ref.current;
    if (canvas === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let flirtStart: number | null = null;
    let flirtArmed = flirtNonce > 0;
    const box = bitmapSize(canvas);
    if (Math.abs(canvas.width - box.w) > 2 || Math.abs(canvas.height - box.h) > 2) {
      canvas.width = box.w;
      canvas.height = box.h;
    }

    const fit = () => {
      const node = ref.current;
      if (node === null) return;
      const next = bitmapSize(node);
      if (Math.abs(next.w - box.w) <= 2 && Math.abs(next.h - box.h) <= 2) return;
      box.w = next.w;
      box.h = next.h;
      node.width = next.w;
      node.height = next.h;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);

    const paint = (now: number) => {
      const node = ref.current;
      if (node === null) return;
      const ctx = node.getContext('2d');
      if (ctx === null) return;
      const w = box.w > 1 ? box.w : node.width;
      const h = box.h > 1 ? box.h : node.height;
      if (w < 2 || h < 2) return;
      ctx.clearRect(0, 0, w, h);
      const entry = manifest?.[id];
      let src = `/cards/${id}.png`;
      if (!reduce && entry !== undefined) {
        if (flirtArmed && (entry.flirt ?? 0) > 1) {
          flirtArmed = false;
          flirtStart = now;
        }
        const flirtCount = entry.flirt ?? 0;
        if (flirtStart !== null && flirtCount > 1) {
          const index = Math.floor((now - flirtStart) / 80);
          if (index >= flirtCount) flirtStart = null;
          else src = frameSrc(id, 'flirt', index + 1);
        }
        if (flirtStart === null) {
          const ambient = ambientOf(entry);
          if (ambient !== null) src = frameSrc(id, ambient.clip, frameIndex(ambient, now) + 1);
        }
      }
      const img = imageOf(src);
      const ready = img.complete && img.naturalWidth > 0;
      const previous = heldRef.current;
      const sameCard =
        previous !== null &&
        (previous.src.includes(`/cards/anim/${id}/`) || previous.src.endsWith(`/cards/${id}.png`));
      const draw = ready ? img : sameCard ? previous : null;
      if (draw !== null && draw.complete && draw.naturalWidth > 0) {
        drawContainBottom(ctx, draw, w, h);
        if (ready) heldRef.current = img;
      }
    };

    const stop = subscribe(paint);
    const wake = () => paint(performance.now());
    if (manifest === null) waiters.add(wake);
    else wake();
    return () => {
      observer.disconnect();
      stop();
      waiters.delete(wake);
    };
  }, [id, flirtNonce]);

  return <canvas ref={ref} className="portrait" aria-hidden="true" />;
}
