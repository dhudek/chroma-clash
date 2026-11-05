import type { Rng } from './ai.ts';
import type { Side } from './kinds.ts';

/** Terrain. Not paintable and not walkable. */
export const BLOCKED = 3;

export const MAP_IDS = [
  'meadow',
  'lanes',
  'islands',
  'bridges',
  'courtyard',
  'scatter',
] as const;

export type MapId = (typeof MAP_IDS)[number];

export const MAP_NAMES: Record<MapId, string> = {
  meadow: 'Meadow',
  lanes: 'Lanes',
  islands: 'Islands',
  bridges: 'Bridges',
  courtyard: 'Courtyard',
  scatter: 'Scatter',
};

export function rollMap(
  grid: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
): MapId {
  grid.fill(0);
  const pick = Math.floor(rng() * MAP_IDS.length);
  const id = MAP_IDS[pick] ?? 'meadow';
  if (id === 'meadow') paintMeadow(grid, w, h, rng);
  else if (id === 'lanes') paintLanes(grid, w, h);
  else if (id === 'islands') paintIslands(grid, w, h, rng);
  else if (id === 'bridges') paintBridges(grid, w, h);
  else if (id === 'courtyard') paintCourtyard(grid, w, h);
  else paintScatter(grid, w, h, rng);
  return id;
}

/**
 * Paint every open cell, split as evenly as a cell count allows.
 * The pattern is horizontal stripes, vertical stripes, or jagged 3×3 blocks.
 * Stripes are at least 3 cells thick so a large card still has a place to land.
 * Rocks stay rocks.
 */
export function claimHalves(grid: Uint8Array, w: number, h: number, rng: Rng = Math.random): void {
  const open: number[] = [];
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] !== BLOCKED) open.push(i);
  }
  const roll = rng();
  const band = 3 + Math.floor(rng() * 3);
  const flip = rng() < 0.5;
  if (roll < 1 / 3) assignStripes(grid, w, open, 'y', band, flip);
  else if (roll < 2 / 3) assignStripes(grid, w, open, 'x', band, flip);
  else assignBlocks(grid, w, open, rng);
  balanceOwners(grid, open);
}

function assignStripes(
  grid: Uint8Array,
  w: number,
  open: number[],
  axis: 'x' | 'y',
  band: number,
  flip: boolean,
): void {
  const width = Math.max(3, band);
  for (const i of open) {
    const x = i % w;
    const y = Math.floor(i / w);
    const along = axis === 'y' ? y : x;
    const stripe = Math.floor(along / width) % 2;
    const side = (stripe === 0) !== flip ? 1 : 2;
    grid[i] = side;
  }
}

function assignBlocks(grid: Uint8Array, w: number, open: number[], rng: Rng): void {
  const size = 3;
  const chunks = new Map<number, number[]>();
  for (const i of open) {
    const x = i % w;
    const y = Math.floor(i / w);
    const key = Math.floor(y / size) * (w + 1) + Math.floor(x / size);
    const list = chunks.get(key);
    if (list === undefined) chunks.set(key, [i]);
    else list.push(i);
  }
  const keys = [...chunks.keys()];
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = keys[i];
    const b = keys[j];
    if (a === undefined || b === undefined) continue;
    keys[i] = b;
    keys[j] = a;
  }
  let c1 = 0;
  let c2 = 0;
  for (const key of keys) {
    const cells = chunks.get(key);
    if (cells === undefined) continue;
    const side = c1 <= c2 ? 1 : 2;
    for (const i of cells) grid[i] = side;
    if (side === 1) c1 += cells.length;
    else c2 += cells.length;
  }
}

function balanceOwners(grid: Uint8Array, open: number[]): void {
  const side1: number[] = [];
  const side2: number[] = [];
  for (const i of open) {
    if (grid[i] === 1) side1.push(i);
    else side2.push(i);
  }
  while (side1.length > side2.length + 1) {
    const i = side1.pop();
    if (i === undefined) break;
    grid[i] = 2;
    side2.push(i);
  }
  while (side2.length > side1.length + 1) {
    const i = side2.pop();
    if (i === undefined) break;
    grid[i] = 1;
    side1.push(i);
  }
}

export function blockedAt(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return true;
  return grid[cy * w + cx] === BLOCKED;
}

export function homeHalf(side: Side, y: number, h: number): boolean {
  return side === 1 ? y < h / 2 : y >= h / 2;
}

export function fieldScores(grid: Uint8Array): {
  p1: number;
  p2: number;
  open: number;
  blocked: number;
} {
  let p1 = 0;
  let p2 = 0;
  let open = 0;
  let blocked = 0;
  for (const v of grid) {
    if (v === BLOCKED) blocked += 1;
    else if (v === 1) p1 += 1;
    else if (v === 2) p2 += 1;
    else open += 1;
  }
  return { p1, p2, open, blocked };
}

export function slide(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  pad = 0.45,
): { x: number; y: number } {
  const nx = clamp(x + dx, pad, w - pad);
  const ny = clamp(y + dy, pad, h - pad);
  if (!blockedAt(grid, w, h, nx, ny)) return { x: nx, y: ny };
  if (!blockedAt(grid, w, h, nx, y)) return { x: nx, y };
  if (!blockedAt(grid, w, h, x, ny)) return { x, y: ny };
  return { x, y };
}

const STEP_X = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_Y = [0, 0, 1, -1, 1, -1, 1, -1];

function cellOpen(grid: Uint8Array, w: number, h: number, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
  return grid[cy * w + cx] !== BLOCKED;
}

function floodFrom(
  grid: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
): { prev: Int32Array; dist: Int32Array; start: number } | null {
  if (!cellOpen(grid, w, h, sx, sy)) return null;
  const n = w * h;
  const prev = new Int32Array(n);
  prev.fill(-1);
  const dist = new Int32Array(n);
  const start = sy * w + sx;
  prev[start] = start;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;
  while (head < tail) {
    const cur = queue[head] ?? start;
    head += 1;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const base = dist[cur] ?? 0;
    for (let i = 0; i < 8; i += 1) {
      const dx = STEP_X[i] ?? 0;
      const dy = STEP_Y[i] ?? 0;
      const nx = cx + dx;
      const ny = cy + dy;
      if (!cellOpen(grid, w, h, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!cellOpen(grid, w, h, cx + dx, cy)) continue;
        if (!cellOpen(grid, w, h, cx, cy + dy)) continue;
      }
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      dist[ni] = base + 1;
      queue[tail] = ni;
      tail += 1;
    }
  }
  return { prev, dist, start };
}

function firstCell(
  prev: Int32Array,
  start: number,
  w: number,
  cell: number,
): { x: number; y: number } | null {
  let step = cell;
  let guard = prev.length;
  while (prev[step] !== start) {
    const parent = prev[step] ?? -1;
    if (parent < 0 || guard <= 0) return null;
    guard -= 1;
    step = parent;
  }
  return { x: (step % w) + 0.5, y: Math.floor(step / w) + 0.5 };
}

/** Next cell center along an 8-connected path that does not cut blocked corners. */
export function firstStep(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  tx: number,
  ty: number,
): { x: number; y: number } | null {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const gx = Math.floor(tx);
  const gy = Math.floor(ty);
  if (!cellOpen(grid, w, h, sx, sy) || !cellOpen(grid, w, h, gx, gy)) return null;
  if (sx === gx && sy === gy) return { x: tx, y: ty };
  const reached = floodFrom(grid, w, h, sx, sy);
  if (reached === null) return null;
  const goal = gy * w + gx;
  if (reached.prev[goal] === -1) return null;
  return firstCell(reached.prev, reached.start, w, goal);
}

/**
 * Flood every reachable cell once and step toward the lowest score.
 * `scoreAt` returns null to ignore a cell. Lower scores win.
 */
export function bfsFirstStep(
  grid: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  scoreAt: (cx: number, cy: number, dist: number) => number | null,
): { x: number; y: number } | null {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const reached = floodFrom(grid, w, h, sx, sy);
  if (reached === null) return null;
  let bestScore = Infinity;
  let best = -1;
  for (let i = 0; i < w * h; i += 1) {
    if (reached.prev[i] === -1 || i === reached.start) continue;
    const score = scoreAt(i % w, Math.floor(i / w), reached.dist[i] ?? 0);
    if (score === null || score >= bestScore) continue;
    bestScore = score;
    best = i;
  }
  if (best < 0) return null;
  return firstCell(reached.prev, reached.start, w, best);
}

function paintMeadow(grid: Uint8Array, w: number, h: number, rng: Rng): void {
  const n = 4 + Math.floor(rng() * 3);
  const band = Math.max(1, Math.floor(h / 2) - 10);
  for (let i = 0; i < n; i += 1) {
    const cx = 2 + Math.floor(rng() * Math.max(1, w - 4));
    const cy = 7 + Math.floor(rng() * band);
    disk(grid, w, h, cx + 0.5, cy + 0.5, 1.55);
  }
}

function paintLanes(grid: Uint8Array, w: number, h: number): void {
  const cols = [Math.floor(w * 0.28), Math.floor(w * 0.68)];
  const gap = Math.floor(h * 0.22);
  const limit = Math.floor(h / 2);
  for (const x of cols) {
    for (let y = 6; y < limit; y += 1) {
      if (Math.abs(y - gap) <= 1) continue;
      block(grid, w, h, x, y);
      block(grid, w, h, x + 1, y);
    }
  }
}

function paintIslands(grid: Uint8Array, w: number, h: number, rng: Rng): void {
  const n = 3 + Math.floor(rng() * 2);
  const band = Math.max(1, Math.floor(h / 2) - 10);
  for (let i = 0; i < n; i += 1) {
    const cx = 3 + rng() * Math.max(1, w - 6);
    const cy = 8 + rng() * band;
    disk(grid, w, h, cx, cy, 2.1);
  }
}

function paintBridges(grid: Uint8Array, w: number, h: number): void {
  const y = Math.floor(h / 2) - 1;
  const gaps = [Math.floor(w * 0.22), Math.floor(w * 0.5), Math.floor(w * 0.78)];
  for (let x = 1; x < w - 1; x += 1) {
    if (gaps.some((g) => Math.abs(x - g) <= 1)) continue;
    block(grid, w, h, x, y);
  }
}

function paintCourtyard(grid: Uint8Array, w: number, h: number): void {
  const inset = Math.max(2, Math.floor(w * 0.16));
  const top = 7;
  const bot = Math.floor(h / 2) - 2;
  for (let x = inset; x < w - inset; x += 1) block(grid, w, h, x, top);
  for (let y = top; y <= bot; y += 1) {
    block(grid, w, h, inset, y);
    block(grid, w, h, w - 1 - inset, y);
  }
}

function paintScatter(grid: Uint8Array, w: number, h: number, rng: Rng): void {
  const limit = Math.floor(h / 2) - 1;
  for (let y = 6; y < limit; y += 1) {
    for (let x = 2; x < w - 2; x += 1) {
      if (rng() < 0.075) block(grid, w, h, x, y);
    }
  }
}

function disk(
  grid: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
): void {
  const r2 = r * r;
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) block(grid, w, h, x, y);
    }
  }
}

function block(grid: Uint8Array, w: number, h: number, x: number, y: number): void {
  stamp(grid, w, h, x, y);
  stamp(grid, w, h, x, h - 1 - y);
}

function stamp(grid: Uint8Array, w: number, h: number, x: number, y: number): void {
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return;
  if (reserved(x, y, w, h)) return;
  grid[y * w + x] = BLOCKED;
}

function reserved(x: number, y: number, w: number, h: number): boolean {
  const midX = Math.floor(w / 2);
  const axis = (h - 1) / 2;
  if ((y <= 5 || y >= h - 6) && Math.abs(x - midX) <= 3) return true;
  if (Math.abs(x - midX) <= 1) return true;
  if ((x <= 3 || x >= w - 4) && Math.abs(y - axis) <= 2) return true;
  return false;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
