import {
  decodeGrid,
  type DirtyCell,
  type GameConfig,
  type Side,
  type StatePayload,
} from '@clash/shared';

const MAGENTA = { r: 255, g: 61, b: 154 };
const CYAN = { r: 61, g: 240, b: 255 };

type Rgb = { r: number; g: number; b: number };

type Trail = { x: number; y: number; a: number };

export class ArenaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private paint: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private grid: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private config: GameConfig | null = null;
  private side: Side = 1;
  private you = { x: 0, y: 0 };
  private opp = { x: 0, y: 0 };
  private prevOpp = { x: 0, y: 0, t: 0 };
  private currOpp = { x: 0, y: 0, t: 0 };
  private youTrail: Trail[] = [];
  private oppTrail: Trail[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; life: number; color: Rgb }[] =
    [];
  private lastTick = 0;
  private tickMs = 50;
  private layout = { ox: 0, oy: 0, cell: 16, dw: 0, dh: 0 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('canvas');
    this.canvas = canvas;
    this.ctx = ctx;
    this.paint = document.createElement('canvas');
    const pctx = this.paint.getContext('2d');
    if (pctx === null) throw new Error('paint');
    this.pctx = pctx;
  }

  startMatch(config: GameConfig, side: Side, state: StatePayload): void {
    this.config = config;
    this.side = side;
    this.tickMs = 1000 / config.tickHz;
    this.grid = new Uint8Array(config.arenaW * config.arenaH);
    if (state.grid !== undefined) {
      this.grid = decodeGrid(state.grid, this.grid.length);
    }
    this.you = { x: state.you.x, y: state.you.y };
    this.opp = { x: state.opp.x, y: state.opp.y };
    const now = performance.now();
    this.prevOpp = { ...this.opp, t: now };
    this.currOpp = { ...this.opp, t: now };
    this.youTrail = [];
    this.oppTrail = [];
    this.resize();
    this.rebuildPaint();
  }

  applyState(state: StatePayload): void {
    const cfg = this.config;
    if (cfg === null) return;
    if (state.grid !== undefined) {
      this.grid = decodeGrid(state.grid, cfg.arenaW * cfg.arenaH);
      this.rebuildPaint();
    } else {
      this.applyDirty(state.dirty);
    }
    this.you.x += (state.you.x - this.you.x) * 0.45;
    this.you.y += (state.you.y - this.you.y) * 0.45;
    const now = performance.now();
    this.prevOpp = { ...this.currOpp, t: this.currOpp.t };
    this.currOpp = { x: state.opp.x, y: state.opp.y, t: now };
    if (state.tick !== this.lastTick) {
      this.lastTick = state.tick;
      this.burst(state.you.x, state.you.y, this.side === 1 ? MAGENTA : CYAN);
    }
  }

  predict(dx: number, dy: number, dt: number, dashing: boolean): void {
    const cfg = this.config;
    if (cfg === null) return;
    const mag = Math.hypot(dx, dy);
    if (mag < 0.04) return;
    const speed = cfg.speed * (dashing ? cfg.dashMul : 1);
    this.you.x += (dx / mag) * speed * dt;
    this.you.y += (dy / mag) * speed * dt;
    const pad = 0.45;
    this.you.x = clamp(this.you.x, pad, cfg.arenaW - pad);
    this.you.y = clamp(this.you.y, pad, cfg.arenaH - pad);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout.dw = w;
    this.layout.dh = h;
    const cfg = this.config;
    if (cfg === null) return;
    const pad = 28;
    const cell = Math.max(
      4,
      Math.min((w - pad * 2) / cfg.arenaW, (h - pad * 2) / cfg.arenaH),
    );
    this.layout.cell = cell;
    this.layout.ox = (w - cell * cfg.arenaW) / 2;
    this.layout.oy = (h - cell * cfg.arenaH) / 2;
    const scale = Math.ceil(cell);
    this.paint.width = cfg.arenaW * scale;
    this.paint.height = cfg.arenaH * scale;
    this.rebuildPaint();
  }

  draw(now: number, dt: number): void {
    const { ctx } = this;
    const { dw, dh, ox, oy, cell } = this.layout;
    ctx.clearRect(0, 0, dw, dh);
    this.bg(now);
    const cfg = this.config;
    if (cfg === null) return;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.drawImage(this.paint, 0, 0, cfg.arenaW * cell, cfg.arenaH * cell);

    const u = clamp((now - this.currOpp.t) / this.tickMs, 0, 1);
    this.opp.x = lerp(this.prevOpp.x, this.currOpp.x, u);
    this.opp.y = lerp(this.prevOpp.y, this.currOpp.y, u);

    this.pushTrail(this.youTrail, this.you.x, this.you.y);
    this.pushTrail(this.oppTrail, this.opp.x, this.opp.y);
    this.drawTrail(this.youTrail, this.side === 1 ? MAGENTA : CYAN);
    this.drawTrail(this.oppTrail, this.side === 1 ? CYAN : MAGENTA);
    this.drawPlayer(this.opp.x, this.opp.y, this.side === 1 ? CYAN : MAGENTA, false);
    this.drawPlayer(this.you.x, this.you.y, this.side === 1 ? MAGENTA : CYAN, true);
    this.drawSparks(dt);
    ctx.restore();
    this.vignette();
  }

  private applyDirty(dirty: readonly DirtyCell[]): void {
    const cfg = this.config;
    if (cfg === null || dirty.length === 0) return;
    const scale = this.paint.width / cfg.arenaW;
    for (const cell of dirty) {
      if (cell.i < 0 || cell.i >= this.grid.length) continue;
      this.grid[cell.i] = cell.v;
      const x = cell.i % cfg.arenaW;
      const y = Math.floor(cell.i / cfg.arenaW);
      this.stamp(x, y, cell.v, scale);
    }
  }

  private rebuildPaint(): void {
    const cfg = this.config;
    if (cfg === null) return;
    this.pctx.clearRect(0, 0, this.paint.width, this.paint.height);
    const scale = this.paint.width / cfg.arenaW;
    for (let i = 0; i < this.grid.length; i += 1) {
      const v = this.grid[i] ?? 0;
      if (v === 0) continue;
      const x = i % cfg.arenaW;
      const y = Math.floor(i / cfg.arenaW);
      this.stamp(x, y, v, scale);
    }
  }

  private stamp(x: number, y: number, owner: number, scale: number): void {
    const gap = scale * 0.12;
    const s = scale - gap;
    const px = x * scale + gap / 2;
    const py = y * scale + gap / 2;
    const rgb = owner === 1 ? MAGENTA : owner === 2 ? CYAN : null;
    if (rgb === null) {
      this.pctx.clearRect(x * scale, y * scale, scale, scale);
      return;
    }
    this.pctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.22)`;
    round(this.pctx, px - 2, py - 2, s + 4, s + 4, 4);
    this.pctx.fill();
    this.pctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)`;
    round(this.pctx, px, py, s, s, 3);
    this.pctx.fill();
    this.pctx.fillStyle = 'rgba(255,255,255,0.22)';
    round(this.pctx, px, py, s, s * 0.38, 3);
    this.pctx.fill();
  }

  private bg(now: number): void {
    const { ctx, layout } = this;
    ctx.fillStyle = '#070712';
    ctx.fillRect(0, 0, layout.dw, layout.dh);
    ctx.save();
    ctx.translate(layout.ox, layout.oy);
    const cfg = this.config;
    if (cfg === null) {
      ctx.restore();
      return;
    }
    const { cell } = layout;
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cfg.arenaW; x += 1) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, cfg.arenaH * cell);
    }
    for (let y = 0; y <= cfg.arenaH; y += 1) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(cfg.arenaW * cell, y * cell);
    }
    ctx.stroke();
    const t = now / 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 18; i += 1) {
      const px = ((i * 47 + t * 12) % (cfg.arenaW * cell + 40)) - 20;
      const py = ((i * 29 + t * 8) % (cfg.arenaH * cell + 40)) - 20;
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlayer(x: number, y: number, rgb: Rgb, you: boolean): void {
    const { ctx, layout } = this;
    const cx = x * layout.cell;
    const cy = y * layout.cell;
    const r = layout.cell * (you ? 0.72 : 0.62);
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 3.2);
    g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)`);
    g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.95)`;
    ctx.lineWidth = you ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  private pushTrail(trail: Trail[], x: number, y: number): void {
    trail.push({ x, y, a: 1 });
    if (trail.length > 14) trail.shift();
    for (const p of trail) p.a *= 0.84;
  }

  private drawTrail(trail: readonly Trail[], rgb: Rgb): void {
    const { ctx, layout } = this;
    for (const p of trail) {
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.18 * p.a})`;
      ctx.beginPath();
      ctx.arc(p.x * layout.cell, p.y * layout.cell, layout.cell * 0.35 * p.a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private burst(x: number, y: number, color: Rgb): void {
    if (this.sparks.length > 80) return;
    this.sparks.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      life: 1,
      color,
    });
  }

  private drawSparks(dt: number): void {
    const { ctx, layout } = this;
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const s = this.sparks[i];
      if (s === undefined) continue;
      s.life -= dt * 1.8;
      s.x += s.vx;
      s.y += s.vy;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      ctx.fillStyle = `rgba(${s.color.r},${s.color.g},${s.color.b},${s.life})`;
      ctx.beginPath();
      ctx.arc(s.x * layout.cell, s.y * layout.cell, 2.2 * s.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private vignette(): void {
    const { ctx, layout } = this;
    const g = ctx.createRadialGradient(
      layout.dw / 2,
      layout.dh / 2,
      Math.min(layout.dw, layout.dh) * 0.2,
      layout.dw / 2,
      layout.dh / 2,
      Math.max(layout.dw, layout.dh) * 0.72,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.dw, layout.dh);
  }
}

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
