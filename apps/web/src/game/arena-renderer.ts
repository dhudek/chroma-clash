import {
  CARD_CATALOG,
  canDropAt,
  decodeGrid,
  defaultCardTable,
  footprintOf,
  tunedCard,
  viewToWorld,
  worldToView,
  type ArenaConfig,
  type ArenaView,
  type CardId,
  type CardTable,
  type Side,
  type TowerView,
  type UnitView,
} from '@clash/shared';

const MAGENTA = { r: 255, g: 61, b: 154 };
const CYAN = { r: 61, g: 240, b: 255 };

function figureHeight(cardId: CardId, role: string, cell: number): number {
  if (role === 'building') return cell * (cardId === 'spire' ? 3.15 : 2.85);
  if (cardId === 'brute') return cell * 3.2;
  if (cardId === 'swarm') return cell * 1.9;
  if (role === 'flying') return cell * 2.65;
  return cell * 2.55;
}

type Rgb = { r: number; g: number; b: number };

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  rgb: Rgb;
  size: number;
};

type SmoothUnit = {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
  t0: number;
  span: number;
  faceSign: number;
  pendingFace: number;
  faceStreak: number;
  born: number;
};

export class CardArenaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private paint: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private grid: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  cards: CardTable = defaultCardTable();
  private config: ArenaConfig | null = null;
  private side: Side = 1;
  private view: ArenaView | null = null;
  ghost: { x: number; y: number; ok: boolean; cardId: CardId } | null = null;
  private layout = { ox: 0, oy: 0, cell: 16, dw: 0, dh: 0 };
  private sparks: Spark[] = [];
  private rings: { x: number; y: number; born: number; rgb: Rgb; max: number }[] = [];
  private flashes = new Map<number, number>();
  private smooth = new Map<number, SmoothUnit>();
  private knownUnits = new Set<number>();
  private knownShots = new Set<number>();
  private shotPrev = new Map<number, { x: number; y: number }>();
  private swings = new Map<number, { swing: number; t0: number }>();
  private casts: { x: number; y: number; born: number; cardId: CardId }[] = [];
  private stars: { x: number; y: number; z: number; s: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('canvas');
    this.canvas = canvas;
    this.ctx = ctx;
    this.paint = document.createElement('canvas');
    const pctx = this.paint.getContext('2d');
    if (pctx === null) throw new Error('paint');
    this.pctx = pctx;
    for (let i = 0; i < 60; i += 1) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        z: 0.3 + Math.random() * 0.7,
        s: 0.4 + Math.random() * 1.4,
      });
    }
    loadAnim();
  }

  start(config: ArenaConfig, side: Side, view: ArenaView, cards?: CardTable): void {
    this.cards = cards ?? defaultCardTable();
    this.config = config;
    this.side = side;
    this.grid = new Uint8Array(config.arenaW * config.arenaH);
    if (view.grid !== undefined) {
      this.grid = decodeGrid(view.grid, this.grid.length);
    }
    this.view = view;
    this.smooth.clear();
    this.knownUnits.clear();
    this.knownShots.clear();
    this.sparks = [];
    this.rings = [];
    this.casts = [];
    this.swings.clear();
    this.flashes.clear();
    this.resize();
    this.rebuildPaint();
    this.ingest(view, true);
  }

  apply(view: ArenaView): void {
    const cfg = this.config;
    if (cfg === null) return;
    if (view.grid !== undefined) {
      this.grid = decodeGrid(view.grid, cfg.arenaW * cfg.arenaH);
      this.rebuildPaint();
    } else {
      this.applyDirty(view);
    }
    this.view = view;
    this.ingest(view, false);
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
    const padX = 22;
    const padY = 22;
    const cell = Math.max(
      6,
      Math.min((w - padX * 2) / cfg.arenaW, (h - padY * 2) / cfg.arenaH),
    );
    this.layout.cell = cell;
    this.layout.ox = (w - cell * cfg.arenaW) / 2;
    this.layout.oy = (h - cell * cfg.arenaH) / 2;
    const scale = Math.ceil(cell);
    this.paint.width = cfg.arenaW * scale;
    this.paint.height = cfg.arenaH * scale;
    this.rebuildPaint();
  }

  pixelToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const cfg = this.config;
    if (cfg === null) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const vx = (px - this.layout.ox) / this.layout.cell;
    const vy = (py - this.layout.oy) / this.layout.cell;
    if (vx < 0 || vy < 0 || vx > cfg.arenaW || vy > cfg.arenaH) return null;
    return viewToWorld(this.side, vx, vy, cfg.arenaW, cfg.arenaH);
  }

  canDrop(cardId: CardId, x: number, y: number): boolean {
    const cfg = this.config;
    if (cfg === null) return false;
    return canDropAt(this.grid, cfg, this.side, cardId, x, y, this.cards);
  }

  spellImpact(x: number, y: number, rgb: Rgb, radius = 3.4, cardId: CardId = 'meteor'): void {
    // born is anchored on the next draw. performance.now() can sit ahead of the
    // rAF timestamp and produce a negative radius, which makes arc() throw.
    this.rings.push({ x, y, born: -1, rgb, max: radius });
    this.casts.push({ x, y, born: -1, cardId });
    this.burst(x, y, rgb, 28);
  }

  burst(x: number, y: number, rgb: Rgb, n = 14): void {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 3.4;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        max: 0.35 + Math.random() * 0.45,
        rgb,
        size: 1.2 + Math.random() * 2.4,
      });
    }
  }

  draw(now: number): void {
    const { ctx, layout } = this;
    ctx.clearRect(0, 0, layout.dw, layout.dh);
    this.drawVoid(now);
    const cfg = this.config;
    const view = this.view;
    if (cfg === null || view === null) return;

    ctx.save();
    ctx.translate(layout.ox, layout.oy);
    this.drawFloor(cfg, now);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.paint, 0, 0, cfg.arenaW * layout.cell, cfg.arenaH * layout.cell);
    ctx.globalAlpha = 1;
    if (this.ghost !== null) this.drawDeployZone(cfg, now);
    this.advanceSmooth(now);
    if (this.ghost !== null) this.drawGhost(cfg, this.ghost, now);
    for (const t of view.towers) this.drawTower(cfg, t, now);
    for (const u of view.units) this.drawUnit(cfg, u, now);
    this.drawCasts(cfg, now);
    for (const p of view.projectiles) this.drawShot(p, now);
    this.drawRings(now);
    this.drawSparks(now);
    ctx.restore();
    this.vignette();
  }

  private ingest(view: ArenaView, first: boolean): void {
    const seen = new Set<number>();
    for (const u of view.units) {
      seen.add(u.id);
      const prev = this.smooth.get(u.id);
      if (prev === undefined) {
        const now = performance.now();
        this.smooth.set(u.id, {
          id: u.id,
          x: u.x,
          y: u.y,
          px: u.x,
          py: u.y,
          tx: u.x,
          ty: u.y,
          t0: now,
          span: 50,
          faceSign: 1,
          pendingFace: 1,
          faceStreak: 0,
          born: now,
        });
        if (!first) this.burst(u.x, u.y, u.side === 1 ? MAGENTA : CYAN, 18);
      } else {
        const now = performance.now();
        const along = prev.span <= 0 ? 1 : Math.min(1, (now - prev.t0) / prev.span);
        const rx = prev.px + (prev.tx - prev.px) * along;
        const ry = prev.py + (prev.ty - prev.py) * along;
        const cfg = this.config;
        if (cfg !== null) {
          const from = worldToView(this.side, prev.tx, prev.ty, cfg.arenaW, cfg.arenaH);
          const to = worldToView(this.side, u.x, u.y, cfg.arenaW, cfg.arenaH);
          const sdx = to.x - from.x;
          const sdy = to.y - from.y;
          if (Math.abs(sdx) > 0.05 && Math.abs(sdx) > Math.abs(sdy) * 0.45) {
            const want = sdx < 0 ? -1 : 1;
            if (want === prev.pendingFace) prev.faceStreak += 1;
            else {
              prev.pendingFace = want;
              prev.faceStreak = 1;
            }
            if (prev.faceStreak >= 2) prev.faceSign = want;
          }
        }
        const measured = now - prev.t0;
        prev.px = rx;
        prev.py = ry;
        prev.tx = u.x;
        prev.ty = u.y;
        prev.t0 = now;
        prev.span = measured >= 16 && measured <= 200 ? measured : 50;
      }
    }
    for (const [id, s] of this.smooth) {
      if (!seen.has(id)) {
        this.burst(s.x, s.y, MAGENTA, 10);
        this.smooth.delete(id);
      }
    }
    const shots = new Set<number>();
    for (const p of view.projectiles) {
      shots.add(p.id);
      if (!this.knownShots.has(p.id) && !first) {
        this.burst(p.x, p.y, p.side === 1 ? MAGENTA : CYAN, 4);
        let best: TowerView | null = null;
        let bestD = 9;
        for (const t of view.towers) {
          if (t.side !== p.side || t.hp <= 0) continue;
          const d = (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        }
        if (best !== null) this.flashes.set(best.id, performance.now() + 90);
      }
    }
    this.knownShots = shots;
    for (const id of this.shotPrev.keys()) {
      if (!shots.has(id)) this.shotPrev.delete(id);
    }
    this.knownUnits = seen;
  }

  private advanceSmooth(now: number): void {
    for (const s of this.smooth.values()) {
      const t = s.span <= 0 ? 1 : Math.min(1, (now - s.t0) / s.span);
      s.x = s.px + (s.tx - s.px) * t;
      s.y = s.py + (s.ty - s.py) * t;
    }
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const cfg = this.config;
    if (cfg === null) return { x: 0, y: 0 };
    const v = worldToView(this.side, x, y, cfg.arenaW, cfg.arenaH);
    return { x: v.x * this.layout.cell, y: v.y * this.layout.cell };
  }

  private drawVoid(now: number): void {
    const { ctx, layout } = this;
    const g = ctx.createRadialGradient(
      layout.dw * 0.5,
      layout.dh * 0.5,
      20,
      layout.dw * 0.5,
      layout.dh * 0.5,
      Math.max(layout.dw, layout.dh) * 0.7,
    );
    g.addColorStop(0, '#0c1020');
    g.addColorStop(0.55, '#070712');
    g.addColorStop(1, '#030308');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.dw, layout.dh);
    const t = now / 1000;
    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      const tw = 0.35 + Math.sin(t * (1.4 + s.z) + s.x * 12) * 0.25;
      ctx.globalAlpha = tw * s.z;
      ctx.fillRect(s.x * layout.dw, s.y * layout.dh, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    const nebA = ctx.createRadialGradient(
      layout.dw * 0.2,
      layout.dh * 0.85,
      10,
      layout.dw * 0.2,
      layout.dh * 0.85,
      layout.dw * 0.55,
    );
    nebA.addColorStop(0, 'rgba(255,61,154,0.16)');
    nebA.addColorStop(1, 'rgba(255,61,154,0)');
    ctx.fillStyle = nebA;
    ctx.fillRect(0, 0, layout.dw, layout.dh);
    const nebB = ctx.createRadialGradient(
      layout.dw * 0.8,
      layout.dh * 0.12,
      10,
      layout.dw * 0.8,
      layout.dh * 0.12,
      layout.dw * 0.5,
    );
    nebB.addColorStop(0, 'rgba(61,240,255,0.14)');
    nebB.addColorStop(1, 'rgba(61,240,255,0)');
    ctx.fillStyle = nebB;
    ctx.fillRect(0, 0, layout.dw, layout.dh);
  }

  private drawFloor(cfg: ArenaConfig, now: number): void {
    const { ctx, layout } = this;
    const w = cfg.arenaW * layout.cell;
    const h = cfg.arenaH * layout.cell;
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.beginPath();
    ctx.roundRect(-6, -6, w + 12, h + 12, 18);
    ctx.fill();
    void now;
  }

  private drawDeployZone(cfg: ArenaConfig, now: number): void {
    if (this.ghost === null) return;
    const { ctx, layout } = this;
    const cell = layout.cell;
    ctx.save();
    ctx.globalAlpha = 0.18 + Math.sin(now / 180) * 0.05;
    ctx.fillStyle = this.side === 1 ? '#ff3d9a' : '#3df0ff';
    for (let i = 0; i < this.grid.length; i += 1) {
      if (this.grid[i] !== this.side) continue;
      const gx = i % cfg.arenaW;
      const gy = Math.floor(i / cfg.arenaW);
      const v = worldToView(this.side, gx + 0.5, gy + 0.5, cfg.arenaW, cfg.arenaH);
      ctx.fillRect((v.x - 0.5) * cell, (v.y - 0.5) * cell, cell, cell);
    }
    ctx.restore();
  }

  private drawFootprint(
    cfg: ArenaConfig,
    x: number,
    y: number,
    span: number,
    ok: boolean,
    now: number,
  ): void {
    const { ctx, layout } = this;
    const box = footprintOf(x, y, span);
    const a = worldToView(this.side, box.x0, box.y0, cfg.arenaW, cfg.arenaH);
    const b = worldToView(this.side, box.x1, box.y1, cfg.arenaW, cfg.arenaH);
    const left = Math.min(a.x, b.x) * layout.cell;
    const top = Math.min(a.y, b.y) * layout.cell;
    const rw = Math.abs(b.x - a.x) * layout.cell;
    const rh = Math.abs(b.y - a.y) * layout.cell;
    const col = ok ? '61,240,255' : '255,80,110';
    ctx.save();
    ctx.fillStyle = `rgba(${col},0.22)`;
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -now / 30;
    ctx.fillRect(left, top, rw, rh);
    ctx.strokeRect(left, top, rw, rh);
    ctx.restore();
  }

  private drawGhost(
    cfg: ArenaConfig,
    ghost: { x: number; y: number; ok: boolean; cardId: CardId },
    now: number,
  ): void {
    const { ctx, layout } = this;
    const c = this.toScreen(ghost.x, ghost.y);
    const def = tunedCard(this.cards, ghost.cardId) ?? CARD_CATALOG[ghost.cardId];
    const ok = ghost.ok;
    const col = ok ? '61,240,255' : '255,80,110';
    if (def.role !== 'spell') this.drawFootprint(cfg, ghost.x, ghost.y, def.span, ok, now);
    if (def.role === 'spell') {
      const paintR = def.paint * layout.cell * (1 + Math.sin(now / 110) * 0.06);
      const dmgR = def.range * layout.cell;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${col},0.16)`;
      ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -now / 25;
      if (fillCircle(ctx, c.x, c.y, paintR)) ctx.fill();
      if (fillCircle(ctx, c.x, c.y, paintR)) ctx.stroke();
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1.5;
      if (fillCircle(ctx, c.x, c.y, dmgR)) ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(c.x - 10, c.y);
      ctx.lineTo(c.x + 10, c.y);
      ctx.moveTo(c.x, c.y - 10);
      ctx.lineTo(c.x, c.y + 10);
      ctx.stroke();
      ctx.restore();
    }
    const planted = def.role === 'building';
    const flying = def.role === 'flying';
    const bob =
      planted || def.role === 'spell'
        ? 0
        : Math.sin(now / 280) * layout.cell * (flying ? 0.08 : 0.04);
    const casting =
      def.role === 'spell' ? blendClip(ghost.cardId, 'attack', now / 90, true) : null;
    const portrait = casting?.front ?? cardPortrait(ghost.cardId);
    if (portrait.complete && portrait.naturalWidth > 0) {
      const fill = casting === null ? 1 : bodyFill(ghost.cardId);
      const bodyH = figureHeight(ghost.cardId, def.role, layout.cell) / fill;
      const bodyW = bodyH * (portrait.naturalWidth / portrait.naturalHeight);
      ctx.save();
      ctx.globalAlpha = ok ? 0.94 : 0.5;
      ctx.translate(c.x, c.y + layout.cell * 0.08 - bob);
      this.drawSprite(portrait, casting?.back ?? null, casting?.mix ?? 0, bodyW, bodyH);
      ctx.restore();
    }
    void cfg;
  }

  private drawTower(cfg: ArenaConfig, t: TowerView, now: number): void {
    const { ctx, layout } = this;
    const c = this.toScreen(t.x, t.y);
    const rgb = t.side === 1 ? MAGENTA : CYAN;
    const king = t.slot === 'king';
    const dead = t.hp <= 0;
    const cell = layout.cell;
    const flash = (this.flashes.get(t.id) ?? 0) > now;
    const towardEnemy = c.y > (cfg.arenaH * cell) / 2 ? -1 : 1;
    ctx.save();
    if (!dead) {
      const glow = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, cell * (king ? 3.4 : 2.4));
      glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${flash ? 0.7 : 0.35})`);
      glow.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c.x, c.y, cell * (king ? 3.4 : 2.4), 0, Math.PI * 2);
      ctx.fill();
      if (t.active) {
        const range = (king ? cfg.kingRange : cfg.towerRange) * cell;
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (king) this.drawKeep(c.x, c.y, cell, rgb, dead, t.active, flash);
    else this.drawCannon(c.x, c.y, cell, rgb, dead, towardEnemy, flash);
    ctx.restore();
    this.hpRing(c.x, c.y, cell * (king ? 1.7 : 1.25), t.hp / t.maxHp, rgb);
  }

  private drawKeep(
    x: number,
    y: number,
    cell: number,
    rgb: Rgb,
    dead: boolean,
    awake: boolean,
    flash: boolean,
  ): void {
    const { ctx } = this;
    const w = cell * 2.1;
    const h = cell * 2.4;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.42, w * 0.7, cell * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = dead ? 'rgba(50,48,58,0.9)' : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h * 0.35, w, h * 0.7, 6);
    ctx.fill();
    ctx.fillStyle = dead ? 'rgba(30,30,38,0.9)' : `rgba(255,255,255,${flash ? 0.7 : 0.22})`;
    const merl = w / 5;
    for (let i = 0; i < 5; i += 1) {
      if (i % 2 === 1) continue;
      ctx.fillRect(x - w / 2 + i * merl, y - h * 0.5, merl * 0.92, h * 0.18);
    }
    ctx.fillStyle = dead ? 'rgba(20,20,28,0.95)' : '#0b0b14';
    ctx.beginPath();
    ctx.roundRect(x - w * 0.16, y - h * 0.02, w * 0.32, h * 0.32, 4);
    ctx.fill();
    if (!dead) {
      ctx.fillStyle = awake ? '#fff6c8' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x - w * 0.22, y - h * 0.18, cell * 0.12, 0, Math.PI * 2);
      ctx.arc(x + w * 0.22, y - h * 0.18, cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.62);
      ctx.lineTo(x - cell * 0.28, y - h * 0.38);
      ctx.lineTo(x + cell * 0.28, y - h * 0.38);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawCannon(
    x: number,
    y: number,
    cell: number,
    rgb: Rgb,
    dead: boolean,
    toward: number,
    flash: boolean,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + cell * 0.7, cell * 0.7, cell * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dead ? 'rgba(48,48,56,0.9)' : `rgb(${Math.max(0, rgb.r - 40)},${Math.max(0, rgb.g - 40)},${Math.max(0, rgb.b - 40)})`;
    ctx.beginPath();
    ctx.roundRect(x - cell * 0.7, y - cell * 0.15, cell * 1.4, cell * 0.85, 8);
    ctx.fill();
    ctx.fillStyle = dead ? 'rgba(70,70,80,0.9)' : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dead ? 'rgba(20,20,28,0.9)' : flash ? '#fff' : '#0b0b14';
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.28, 0, Math.PI * 2);
    ctx.fill();
    if (!dead) {
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.95)`;
      ctx.lineWidth = cell * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + toward * cell * 0.95);
      ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
      ctx.beginPath();
      ctx.arc(x, y + toward * cell * 0.95, cell * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRings(now: number): void {
    const { ctx, layout } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i];
      if (r === undefined) continue;
      if (r.born < 0) r.born = now;
      const t = (now - r.born) / 420;
      if (!(t >= 0)) continue;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const c = this.toScreen(r.x, r.y);
      const rad = r.max * layout.cell * t;
      const width = 4 * (1 - t);
      if (!(rad > 0) || !(width > 0)) continue;
      ctx.strokeStyle = `rgba(${r.rgb.r},${r.rgb.g},${r.rgb.b},${Math.max(0, 1 - t)})`;
      ctx.lineWidth = width;
      if (fillCircle(ctx, c.x, c.y, rad)) ctx.stroke();
    }
    ctx.restore();
  }

  private drawCasts(cfg: ArenaConfig, now: number): void {
    const { ctx, layout } = this;
    for (let i = this.casts.length - 1; i >= 0; i -= 1) {
      const cast = this.casts[i];
      if (cast === undefined) continue;
      if (cast.born < 0) cast.born = now;
      const frames = clipFrames(cast.cardId, 'attack');
      const frameMs = 90;
      const dur = Math.max(frameMs, Math.max(0, frames.length - 1) * frameMs);
      const elapsed = now - cast.born;
      if (elapsed >= dur) {
        this.casts.splice(i, 1);
        continue;
      }
      const pose = blendAt(frames, elapsed / frameMs, false);
      const front = pose?.front ?? cardPortrait(cast.cardId);
      if (!front.complete || front.naturalWidth <= 0) continue;
      const c = this.toScreen(cast.x, cast.y);
      const fill = pose === null ? 1 : bodyFill(cast.cardId);
      const bodyH = figureHeight(cast.cardId, 'spell', layout.cell) / fill;
      const bodyW = bodyH * (front.naturalWidth / front.naturalHeight);
      const alpha = elapsed > dur * 0.72 ? Math.max(0, 1 - (elapsed - dur * 0.72) / (dur * 0.28)) : 0.96;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(c.x, c.y + layout.cell * 0.08);
      this.drawSprite(front, pose?.back ?? null, pose?.mix ?? 0, bodyW, bodyH);
      ctx.restore();
    }
    void cfg;
  }

  private drawUnit(cfg: ArenaConfig, u: UnitView, now: number): void {
    void cfg;
    const { ctx, layout } = this;
    const sm = this.smooth.get(u.id);
    const x = sm?.x ?? u.x;
    const y = sm?.y ?? u.y;
    const c = this.toScreen(x, y);
    const rgb = u.side === 1 ? MAGENTA : CYAN;
    const born = sm?.born ?? now;
    const pop = Math.min(1, (now - born) / 220);
    const planted = u.role === 'building';
    const flying = u.role === 'flying';
    const leg = sm === undefined ? 0 : Math.hypot(sm.tx - sm.px, sm.ty - sm.py);
    const moving = !planted && leg > 0.02;
    const pose = this.unitPose(u, now, moving, flying, planted);
    const portrait = pose.front;
    const posed = portrait !== cardPortrait(u.cardId);
    const phase = now / (moving ? 160 : flying ? 420 : 700) + u.id;
    const stride = Math.sin(phase);
    const bob =
      posed || planted
        ? 0
        : flying
          ? stride * layout.cell * 0.1
          : moving
            ? Math.abs(stride) * layout.cell * 0.06
            : stride * layout.cell * 0.02;
    const air = flying && !posed ? layout.cell * 0.42 : flying ? layout.cell * 0.16 : 0;
    const ground = c.y + layout.cell * 0.08;
    const fill = posed ? bodyFill(u.cardId) : 1;
    const bodyH =
      (portrait.complete && portrait.naturalWidth > 0
        ? figureHeight(u.cardId, u.role, layout.cell) / fill
        : layout.cell * 1.4) *
      (0.78 + 0.22 * pop);
    const bodyW =
      portrait.complete && portrait.naturalHeight > 0
        ? bodyH * (portrait.naturalWidth / portrait.naturalHeight)
        : bodyH * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(
      c.x,
      ground,
      bodyW * (flying ? 0.28 : 0.34),
      layout.cell * (flying ? 0.12 : 0.16),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (planted) {
      const s = bodyW * 0.72;
      const pulse = 0.55 + Math.sin(now / 520 + u.id) * 0.2;
      ctx.fillStyle = '#141a28';
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.55 + pulse * 0.45})`;
      ctx.lineWidth = Math.max(2, layout.cell * 0.08);
      ctx.beginPath();
      ctx.roundRect(c.x - s / 2, ground - layout.cell * 0.22, s, layout.cell * 0.36, 3);
      ctx.fill();
      ctx.stroke();
    }
    const feet = ground - air - bob;
    ctx.save();
    ctx.translate(c.x, feet);
    if ((sm?.faceSign ?? 1) < 0) ctx.scale(-1, 1);
    if (portrait.complete && portrait.naturalWidth > 0) {
      this.drawSprite(portrait, pose.back, pose.mix, bodyW, bodyH);
    } else {
      ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
      ctx.translate(0, -bodyH * 0.45);
      this.unitBody(u, bodyH * 0.28);
    }
    ctx.restore();
    this.hpBar(c.x, feet - bodyH - 6, Math.max(16, bodyW * 0.72), u.hp / u.maxHp, rgb);
  }

  private unitPose(
    u: UnitView,
    now: number,
    moving: boolean,
    flying: boolean,
    planted: boolean,
  ): SpritePose {
    const still = cardPortrait(u.cardId);
    const held: SpritePose = { front: still, back: null, mix: 0 };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return held;
    const prev = this.swings.get(u.id);
    if (prev === undefined) {
      this.swings.set(u.id, { swing: u.swing, t0: now - 10_000 });
    } else if (prev.swing !== u.swing) {
      this.swings.set(u.id, { swing: u.swing, t0: now });
    }
    const rec = this.swings.get(u.id);
    const attack = clipFrames(u.cardId, 'attack');
    if (rec !== undefined && u.swing > 0 && attack.length > 1) {
      const frameMs = 80;
      const dur = (attack.length - 1) * frameMs;
      const elapsed = now - rec.t0;
      if (elapsed >= 0 && elapsed < dur) {
        const hit = blendAt(attack, elapsed / frameMs, false);
        if (hit !== null) return hit;
      }
    }
    if (flying || (moving && !planted)) {
      const walk = clipFrames(u.cardId, 'walk');
      if (walk.length > 1) {
        const cycle = manifest?.[u.cardId]?.walkMs;
        const frameMs =
          typeof cycle === 'number' && cycle > 0
            ? Math.max(20, cycle / walk.length)
            : flying
              ? 130
              : 100;
        const step = blendAt(walk, now / frameMs + u.id * 0.37, true);
        if (step !== null) return step;
      }
    }
    const idle = frameAt(clipFrames(u.cardId, 'idle'), 0);
    return idle === null ? held : { front: idle, back: null, mix: 0 };
  }

  private drawSprite(
    front: HTMLImageElement,
    back: HTMLImageElement | null,
    mix: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const { ctx } = this;
    const base = ctx.globalAlpha;
    const fade = Math.min(1, Math.max(0, mix));
    ctx.globalAlpha = base * (back === null ? 1 : 1 - fade);
    ctx.drawImage(front, -bodyW / 2, -bodyH, bodyW, bodyH);
    if (back !== null && fade > 0.02 && back.complete && back.naturalWidth > 0) {
      ctx.globalAlpha = base * fade;
      ctx.drawImage(back, -bodyW / 2, -bodyH, bodyW, bodyH);
    }
    ctx.globalAlpha = base;
  }

  private paintFigure(
    img: HTMLImageElement,
    feetX: number,
    feetY: number,
    boxW: number,
    boxH: number,
    flip: boolean,
    alpha: number,
  ): void {
    if (!img.complete || img.naturalWidth <= 0 || !(boxW > 0) || !(boxH > 0)) return;
    const aspect = img.naturalWidth / img.naturalHeight;
    let w = boxW;
    let h = w / aspect;
    if (h > boxH) {
      h = boxH;
      w = h * aspect;
    }
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(feetX, feetY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  private unitBody(u: UnitView, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    if (u.cardId === 'spire') {
      ctx.moveTo(0, -r * 1.6);
      ctx.lineTo(r * 0.7, r);
      ctx.lineTo(-r * 0.7, r);
      ctx.closePath();
    } else if (u.role === 'building') {
      ctx.roundRect(-r, -r, r * 2, r * 2, 4);
    } else if (u.role === 'flying') {
      ctx.ellipse(-r * 0.75, 0, r * 0.75, r * 0.38, -0.35, 0, Math.PI * 2);
      ctx.ellipse(r * 0.75, 0, r * 0.75, r * 0.38, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.28, r * 0.48, 0, 0, Math.PI * 2);
    } else if (u.cardId === 'wisp' || u.role === 'ranged') {
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.7, r * 0.7);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(-r * 0.7, -r * 0.7);
      ctx.closePath();
    } else if (u.cardId === 'brute') {
      hex(ctx, 0, 0, r, ctx.fillStyle as string);
      return;
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private drawShot(p: { id: number; x: number; y: number; side: Side }, now: number): void {
    const { ctx, layout } = this;
    const c = this.toScreen(p.x, p.y);
    const prev = this.shotPrev.get(p.id);
    let ang = p.side === 1 ? -Math.PI / 2 : Math.PI / 2;
    if (prev !== undefined) {
      const a = this.toScreen(prev.x, prev.y);
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      if (dx * dx + dy * dy > 0.25) ang = Math.atan2(dy, dx);
    }
    this.shotPrev.set(p.id, { x: p.x, y: p.y });
    const rgb = p.side === 1 ? MAGENTA : CYAN;
    const len = layout.cell * 0.95;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(ang);
    ctx.strokeStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.lineWidth = Math.max(2, layout.cell * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len * 0.55, 0);
    ctx.lineTo(len * 0.15, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(len * 0.55, 0);
    ctx.lineTo(len * 0.05, -len * 0.22);
    ctx.lineTo(len * 0.05, len * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-len * 0.55, 0);
    ctx.lineTo(-len * 0.28, -len * 0.18);
    ctx.moveTo(-len * 0.55, 0);
    ctx.lineTo(-len * 0.28, len * 0.18);
    ctx.stroke();
    ctx.restore();
    void now;
  }

  private drawSparks(now: number): void {
    void now;
    const { ctx, layout } = this;
    const dt = 0.016;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const s = this.sparks[i];
      if (s === undefined) continue;
      s.life -= dt / s.max;
      s.x += s.vx * dt * 6;
      s.y += s.vy * dt * 6;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      const c = this.toScreen(s.x, s.y);
      ctx.fillStyle = `rgba(${s.rgb.r},${s.rgb.g},${s.rgb.b},${s.life})`;
      if (fillCircle(ctx, c.x, c.y, s.size * s.life * (layout.cell / 16))) ctx.fill();
    }
    ctx.restore();
  }

  private hpBar(x: number, y: number, w: number, pct: number, rgb: Rgb): void {
    const { ctx } = this;
    const p = Math.max(0, Math.min(1, pct));
    const h = 4;
    const left = x - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(left - 1, y - 1, w + 2, h + 2);
    if (p <= 0) return;
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.fillRect(left, y, w * p, h);
  }

  private hpRing(x: number, y: number, r: number, pct: number, rgb: Rgb): void {
    const { ctx } = this;
    const p = Math.max(0, Math.min(1, pct));
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }

  private vignette(): void {
    const { ctx, layout } = this;
    const g = ctx.createRadialGradient(
      layout.dw / 2,
      layout.dh / 2,
      Math.min(layout.dw, layout.dh) * 0.25,
      layout.dw / 2,
      layout.dh / 2,
      Math.max(layout.dw, layout.dh) * 0.72,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.dw, layout.dh);
  }

  private applyDirty(view: ArenaView): void {
    const cfg = this.config;
    if (cfg === null) return;
    const scale = this.paint.width / cfg.arenaW;
    for (const cell of view.dirty) {
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
      this.stamp(i % cfg.arenaW, Math.floor(i / cfg.arenaW), v, scale);
    }
  }

  private stamp(x: number, y: number, owner: number, scale: number): void {
    const cfg = this.config;
    if (cfg === null) return;
    const v = worldToView(this.side, x + 0.5, y + 0.5, cfg.arenaW, cfg.arenaH);
    const gx = Math.floor(v.x);
    const gy = Math.floor(v.y);
    const gap = scale * 0.1;
    const s = scale - gap;
    const px = gx * scale + gap / 2;
    const py = gy * scale + gap / 2;
    if (owner === 3) {
      this.pctx.fillStyle = '#1b2438';
      this.pctx.beginPath();
      this.pctx.roundRect(px, py, s, s, 3);
      this.pctx.fill();
      this.pctx.fillStyle = 'rgba(186, 206, 240, 0.28)';
      this.pctx.beginPath();
      this.pctx.roundRect(px, py, s, s * 0.35, 3);
      this.pctx.fill();
      return;
    }
    const rgb = owner === 1 ? MAGENTA : owner === 2 ? CYAN : null;
    if (rgb === null) {
      this.pctx.clearRect(gx * scale, gy * scale, scale, scale);
      return;
    }
    this.pctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.28)`;
    this.pctx.beginPath();
    this.pctx.roundRect(px - 1.5, py - 1.5, s + 3, s + 3, 3);
    this.pctx.fill();
    this.pctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.88)`;
    this.pctx.beginPath();
    this.pctx.roundRect(px, py, s, s, 3);
    this.pctx.fill();
    this.pctx.fillStyle = 'rgba(255,255,255,0.22)';
    this.pctx.beginPath();
    this.pctx.roundRect(px, py, s, s * 0.38, 3);
    this.pctx.fill();
  }
}

const portraits = new Map<CardId, HTMLImageElement>();

type ClipName = 'walk' | 'attack' | 'idle';

type AnimManifest = Partial<
  Record<CardId, Partial<Record<ClipName, number>> & { body?: number; walkMs?: number }>
>;

type SpritePose = {
  front: HTMLImageElement;
  back: HTMLImageElement | null;
  mix: number;
};

let manifest: AnimManifest | null = null;
let manifestStarted = false;
const clips = new Map<string, HTMLImageElement[]>();

function loadAnim(): void {
  if (manifestStarted || typeof fetch !== 'function') return;
  manifestStarted = true;
  void fetch('/cards/anim/manifest.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data === null || typeof data !== 'object') return;
      manifest = data as AnimManifest;
      clips.clear();
    })
    .catch(() => undefined);
}

function clipFrames(id: CardId, clip: ClipName): HTMLImageElement[] {
  const key = `${id}:${clip}`;
  const found = clips.get(key);
  if (found !== undefined) return found;
  const n = manifest?.[id]?.[clip] ?? 0;
  const frames: HTMLImageElement[] = [];
  for (let i = 1; i <= n; i += 1) {
    const img = new Image();
    img.src = `/cards/anim/${id}/${clip}/${String(i).padStart(2, '0')}.png`;
    frames.push(img);
  }
  clips.set(key, frames);
  return frames;
}

function frameAt(frames: HTMLImageElement[], index: number): HTMLImageElement | null {
  if (frames.length === 0) return null;
  const img = frames[((index % frames.length) + frames.length) % frames.length];
  if (img === undefined || !img.complete || img.naturalWidth <= 0) return null;
  return img;
}

function blendAt(frames: HTMLImageElement[], pos: number, loop: boolean): SpritePose | null {
  const n = frames.length;
  if (n === 0 || !Number.isFinite(pos)) return null;
  if (!loop && pos >= n - 1) {
    const last = frameAt(frames, n - 1);
    return last === null ? null : { front: last, back: null, mix: 0 };
  }
  const span = loop ? ((pos % n) + n) % n : Math.max(0, pos);
  const i = Math.floor(span);
  // Hold each drawing. Crossfading two full-body frames doubles the limbs and reads as jitter.
  const front = frameAt(frames, i);
  if (front === null) return null;
  return { front, back: null, mix: 0 };
}

function blendClip(id: CardId, clip: ClipName, pos: number, loop: boolean): SpritePose | null {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return blendAt(clipFrames(id, clip), pos, loop);
}

function bodyFill(id: CardId): number {
  const n = manifest?.[id]?.body;
  return typeof n === 'number' && n > 0.35 && n <= 1 ? n : 1;
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(r > 0)) return false;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  return true;
}

function cardPortrait(id: CardId): HTMLImageElement {
  const found = portraits.get(id);
  if (found !== undefined) return found;
  const img = new Image();
  img.src = `/cards/${id}.png`;
  portraits.set(id, img);
  return img;
}

function hex(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
