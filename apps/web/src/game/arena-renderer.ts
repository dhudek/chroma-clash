import {
  CARD_CATALOG,
  canDropAt,
  decodeGrid,
  viewToWorld,
  worldToView,
  type ArenaConfig,
  type ArenaView,
  type CardId,
  type Side,
  type TowerView,
  type UnitView,
} from '@clash/shared';

const MAGENTA = { r: 255, g: 61, b: 154 };
const CYAN = { r: 61, g: 240, b: 255 };

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
  tx: number;
  ty: number;
  facing: number;
  born: number;
};

export class CardArenaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private paint: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private grid: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
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
  }

  start(config: ArenaConfig, side: Side, view: ArenaView): void {
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
    return canDropAt(this.grid, cfg, this.side, cardId, x, y);
  }

  spellImpact(x: number, y: number, rgb: Rgb): void {
    this.rings.push({ x, y, born: performance.now(), rgb, max: 3.4 });
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
    this.drawRiver(cfg, now);
    this.drawLaneLabels(cfg, now);
    if (this.ghost !== null) this.drawDeployZone(cfg, now);
    this.stepSmooth(0.22);
    if (this.ghost !== null) this.drawGhost(cfg, this.ghost, now);
    for (const t of view.towers) this.drawTower(cfg, t, now);
    for (const u of view.units) this.drawUnit(cfg, u, now);
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
        this.smooth.set(u.id, {
          id: u.id,
          x: u.x,
          y: u.y,
          tx: u.x,
          ty: u.y,
          facing: u.side === 1 ? -Math.PI / 2 : Math.PI / 2,
          born: performance.now(),
        });
        if (!first) this.burst(u.x, u.y, u.side === 1 ? MAGENTA : CYAN, 18);
      } else {
        const dx = u.x - prev.tx;
        const dy = u.y - prev.ty;
        if (dx * dx + dy * dy > 0.0004) prev.facing = Math.atan2(dy, dx);
        prev.tx = u.x;
        prev.ty = u.y;
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
    this.knownUnits = seen;
  }

  private stepSmooth(k: number): void {
    for (const s of this.smooth.values()) {
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cfg.arenaW; x += 1) {
      ctx.moveTo(x * layout.cell, 0);
      ctx.lineTo(x * layout.cell, h);
    }
    for (let y = 0; y <= cfg.arenaH; y += 1) {
      ctx.moveTo(0, y * layout.cell);
      ctx.lineTo(w, y * layout.cell);
    }
    ctx.stroke();
    const pulse = 0.04 + Math.sin(now / 700) * 0.02;
    ctx.fillStyle = `rgba(255,61,154,${pulse})`;
    const ownTop = this.side === 1;
    ctx.fillRect(0, ownTop ? h / 2 : 0, w, h / 2);
    ctx.fillStyle = `rgba(61,240,255,${pulse})`;
    ctx.fillRect(0, ownTop ? 0 : h / 2, w, h / 2);
  }

  private drawRiver(cfg: ArenaConfig, now: number): void {
    const { ctx, layout } = this;
    const y = worldToView(this.side, 0, cfg.arenaH / 2, cfg.arenaW, cfg.arenaH).y * layout.cell;
    const w = cfg.arenaW * layout.cell;
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(180,220,255,${0.22 + Math.sin(now / 400) * 0.08})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 10, w, 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([10, 12]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawLaneLabels(cfg: ArenaConfig, now: number): void {
    const { ctx, layout } = this;
    const w = cfg.arenaW * layout.cell;
    const h = cfg.arenaH * layout.cell;
    const pulse = 0.45 + Math.sin(now / 500) * 0.12;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.max(18, layout.cell * 0.95)}px Syne, sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${0.18 + pulse * 0.12})`;
    ctx.fillText('THEM', w / 2, h * 0.16);
    ctx.fillStyle = `rgba(255,255,255,${0.28 + pulse * 0.2})`;
    ctx.fillText('YOU', w / 2, h * 0.86);
    ctx.font = `600 ${Math.max(11, layout.cell * 0.42)}px Outfit, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText('drop on YOUR color · Meteor anywhere · paint the map', w / 2, h * 0.9);
    ctx.restore();
  }

  private drawDeployZone(cfg: ArenaConfig, now: number): void {
    if (this.ghost === null) return;
    const { ctx, layout } = this;
    const w = cfg.arenaW * layout.cell;
    const h = cfg.arenaH * layout.cell;
    const spell = CARD_CATALOG[this.ghost.cardId].role === 'spell';
    ctx.save();
    if (spell) {
      ctx.globalAlpha = 0.1 + Math.sin(now / 160) * 0.04;
      ctx.fillStyle = this.ghost.ok ? '#ff3d9a' : '#ff4d6d';
      ctx.fillRect(0, 0, w, h);
    } else {
      const cell = layout.cell;
      ctx.globalAlpha = 0.18 + Math.sin(now / 180) * 0.05;
      ctx.fillStyle = '#3df0ff';
      for (let i = 0; i < this.grid.length; i += 1) {
        if (this.grid[i] !== this.side) continue;
        const gx = i % cfg.arenaW;
        const gy = Math.floor(i / cfg.arenaW);
        const v = worldToView(this.side, gx + 0.5, gy + 0.5, cfg.arenaW, cfg.arenaH);
        ctx.fillRect((v.x - 0.5) * cell, (v.y - 0.5) * cell, cell, cell);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.max(14, layout.cell * 0.7)}px Outfit, sans-serif`;
    ctx.fillStyle = this.ghost.ok ? 'rgba(232,255,255,0.9)' : 'rgba(255,200,210,0.9)';
    const label = spell
      ? this.ghost.ok
        ? 'RELEASE METEOR'
        : 'AIM METEOR'
      : this.ghost.ok
        ? 'RELEASE ON YOUR COLOR'
        : 'ONLY ON YOUR COLOR';
    ctx.fillText(label, w / 2, h * 0.5);
    ctx.restore();
  }

  private drawGhost(
    cfg: ArenaConfig,
    ghost: { x: number; y: number; ok: boolean; cardId: CardId },
    now: number,
  ): void {
    const { ctx, layout } = this;
    const c = this.toScreen(ghost.x, ghost.y);
    const def = CARD_CATALOG[ghost.cardId];
    const ok = ghost.ok;
    const col = ok ? '61,240,255' : '255,80,110';
    if (def.role === 'spell') {
      const paintR = def.paint * layout.cell;
      const dmgR = def.range * layout.cell;
      const beat = 1 + Math.sin(now / 110) * 0.06;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${col},0.16)`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, paintR * beat, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -now / 25;
      ctx.beginPath();
      ctx.arc(c.x, c.y, paintR * beat, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, dmgR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(c.x - 10, c.y);
      ctx.lineTo(c.x + 10, c.y);
      ctx.moveTo(c.x, c.y - 10);
      ctx.lineTo(c.x, c.y + 10);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = ok ? '#ffe6f6' : '#ffd0d8';
      ctx.font = `800 ${Math.max(13, layout.cell * 0.62)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('METEOR', c.x, c.y - paintR - 12);
      ctx.font = `600 ${Math.max(10, layout.cell * 0.42)}px Outfit, sans-serif`;
      ctx.fillText('converts this crater', c.x, c.y - paintR + 6);
      return;
    }
    const beat = 1 + Math.sin(now / 120) * 0.08;
    const r = layout.cell * (def.role === 'building' ? 1.45 : 1.05) * beat;
    ctx.save();
    ctx.fillStyle = `rgba(${col},0.18)`;
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -now / 30;
    ctx.beginPath();
    if (def.role === 'building') ctx.roundRect(c.x - r, c.y - r, r * 2, r * 2, 6);
    else ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = ok ? '#e8ffff' : '#ffd0d8';
    ctx.font = `700 ${Math.max(12, layout.cell * 0.55)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(def.name, c.x, c.y - r - 10);
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
    const hp = Math.max(0, t.hp);
    ctx.font = `700 ${Math.max(10, cell * 0.42)}px IBM Plex Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = dead ? 'rgba(255,255,255,0.35)' : '#fff';
    const tag = king ? 'KEEP' : 'CANNON';
    ctx.fillText(dead ? 'RUIN' : tag, c.x, c.y + cell * (king ? 1.85 : 1.55));
    ctx.fillText(`${Math.ceil(hp)}`, c.x, c.y + cell * (king ? 2.25 : 1.95));
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
      const t = (now - r.born) / 420;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const c = this.toScreen(r.x, r.y);
      const rad = r.max * layout.cell * t;
      ctx.strokeStyle = `rgba(${r.rgb.r},${r.rgb.g},${r.rgb.b},${1 - t})`;
      ctx.lineWidth = 4 * (1 - t);
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawUnit(cfg: ArenaConfig, u: UnitView, now: number): void {
    const { ctx, layout } = this;
    const sm = this.smooth.get(u.id);
    const x = sm?.x ?? u.x;
    const y = sm?.y ?? u.y;
    const c = this.toScreen(x, y);
    const rgb = u.side === 1 ? MAGENTA : CYAN;
    const born = sm?.born ?? now;
    const pop = Math.min(1, (now - born) / 220);
    const walk = Math.sin(now / 90 + u.id) * layout.cell * 0.06;
    const facing = sm?.facing ?? 0;
    const flying = u.role === 'flying';
    const air = flying ? layout.cell * 0.9 : 0;
    const base =
      layout.cell *
      (u.role === 'building'
        ? u.cardId === 'spire'
          ? 0.7
          : 0.78
        : u.cardId === 'brute'
          ? 0.7
          : u.cardId === 'swarm'
            ? 0.32
            : flying
              ? 0.5
              : 0.46);
    const r = base * (0.7 + 0.3 * pop);
    if (flying) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + layout.cell * 0.35, r * 0.9, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(c.x, c.y + walk - air);
    ctx.rotate(facing);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 3);
    glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
    glow.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    this.unitBody(u, r);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.35, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.hpRing(c.x, c.y - r - 6, Math.max(8, r + 3), u.hp / u.maxHp, rgb);
    void cfg;
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

  private drawShot(p: { x: number; y: number; side: Side }, now: number): void {
    const { ctx, layout } = this;
    const c = this.toScreen(p.x, p.y);
    const rgb = p.side === 1 ? MAGENTA : CYAN;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, layout.cell * 0.55);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.35, `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)`);
    g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, layout.cell * 0.55, 0, Math.PI * 2);
    ctx.fill();
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
      ctx.beginPath();
      ctx.arc(c.x, c.y, s.size * s.life * (layout.cell / 16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
