import {
  CARD_CATALOG,
  defaultCardTable,
  tunedCard,
  type ArenaConfig,
  type ArenaView,
  type CardId,
  type CardTable,
  type ServerMsg,
  type Side,
} from '@clash/shared';
import { useEffect, useRef, useState } from 'react';

import { sfxCountdown, sfxDash, sfxSpell, sfxWin, unlockAudio } from '../game/audio';
import { CardArenaRenderer } from '../game/arena-renderer';
import { CardFace } from '../game/CardFace';
import { guestId, Net } from '../game/net';
import { clearSeat, rememberRoom } from '../game/seat';
import type { PlayIntent } from './Lobby';

type Props = {
  name: string;
  intent: PlayIntent;
  onExit: () => void;
};

type Hud = {
  names: { p1: string; p2: string };
  side: Side;
  waiting: string | null;
  room: string | null;
  overReason: string | null;
  winner: 0 | 1 | 2;
  view: ArenaView | null;
};

type Drag = {
  cardId: CardId;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  ok: boolean;
};

const emptyHud: Hud = {
  names: { p1: 'YOU', p2: 'THEM' },
  side: 1,
  waiting: 'Connecting…',
  room: null,
  overReason: null,
  winner: 0,
  view: null,
};

export function ArenaPlay({ name, intent, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CardArenaRenderer | null>(null);
  const configRef = useRef<ArenaConfig | null>(null);
  const netRef = useRef<Net | null>(null);
  const [hud, setHud] = useState<Hud>(emptyHud);
  const [table, setTable] = useState<CardTable>(defaultCardTable);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rtt, setRtt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hudRef = useRef(hud);
  hudRef.current = hud;
  const dragRef = useRef<Drag | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => endDrag.current?.(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    unlockAudio();
    const renderer = new CardArenaRenderer(canvas);
    rendererRef.current = renderer;
    const net = new Net();
    netRef.current = net;
    let playing = false;
    let lastCount = -1;
    let raf = 0;

    const onResize = () => renderer.resize();
    const onEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        clearSeat();
        net.send({ type: 'leave' });
        onExit();
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onEsc);

    net.onOpen = () => {
      net.send({ type: 'hello', guestId: guestId(), name });
    };
    net.onMessage = (msg: ServerMsg) => {
      setRtt(net.rtt);
      switch (msg.type) {
        case 'welcome': {
          if (msg.resume === true) break;
          if (intent.kind === 'resume') {
            clearSeat();
            onExit();
            break;
          }
          const deck = intent.deck;
          if (intent.kind === 'cpu') net.send({ type: 'play_cpu', game: 'arena', deck });
          else if (intent.kind === 'queue') net.send({ type: 'queue', game: 'arena', deck });
          else if (intent.kind === 'create') net.send({ type: 'create_room', game: 'arena', deck });
          else net.send({ type: 'join_room', code: intent.code, deck });
          break;
        }
        case 'queued':
          setHud((h) => ({ ...h, waiting: 'Searching the void…' }));
          break;
        case 'waiting':
          setHud((h) => ({ ...h, waiting: msg.message }));
          break;
        case 'room':
          rememberRoom(msg.code);
          setHud((h) => ({
            ...h,
            room: msg.code,
            waiting: `Room ${msg.code} · waiting for a hunter`,
          }));
          break;
        case 'match_start':
          if (msg.game !== 'arena') {
            setError('this room is spray mode');
            break;
          }
          playing = true;
          configRef.current = msg.config;
          setTable(msg.cards);
          renderer.start(msg.config, msg.side, msg.state, msg.cards);
          setHud({
            names: msg.names,
            side: msg.side,
            waiting: null,
            room: null,
            overReason: null,
            winner: 0,
            view: msg.state,
          });
          break;
        case 'state':
          if (msg.game !== 'arena') break;
          renderer.apply(msg.state);
          setHud((h) => ({
            ...h,
            view: msg.state,
            winner: msg.state.winner,
            waiting: null,
          }));
          if (msg.state.phase === 'countdown') {
            const n = Math.max(1, Math.ceil(msg.state.countdownLeft));
            if (n !== lastCount) {
              lastCount = n;
              sfxCountdown(n === 1 ? 0 : n);
            }
          }
          break;
        case 'match_end':
          playing = false;
          clearSeat();
          setHud((h) => ({
            ...h,
            overReason: msg.reason,
            winner: msg.winner,
            waiting: null,
          }));
          sfxWin(msg.winner === hudRef.current.side);
          break;
        case 'error':
          if (msg.message !== 'cannot play that') setError(msg.message);
          break;
        case 'pong':
          break;
      }
    };
    net.onClose = () => {
      void playing;
    };
    net.connect();

    const loop = (now: number) => {
      try {
        renderer.draw(now);
      } catch (err) {
        console.error(err);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onEsc);
      net.close();
    };
  }, [intent, name]);

  const placeFloat = (x: number, y: number, ok: boolean) => {
    const el = floatRef.current;
    if (el === null) return;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.toggle('ok', ok);
  };

  const syncGhost = (cardId: CardId, clientX: number, clientY: number): boolean => {
    const renderer = rendererRef.current;
    const cfg = configRef.current;
    if (renderer === null || cfg === null) return false;
    const world = renderer.pixelToWorld(clientX, clientY);
    if (world === null) {
      renderer.ghost = null;
      return false;
    }
    const ok = renderer.canDrop(cardId, world.x, world.y);
    renderer.ghost = { x: world.x, y: world.y, ok, cardId };
    return ok;
  };

  const drop = (cardId: CardId, clientX: number, clientY: number) => {
    const renderer = rendererRef.current;
    const cfg = configRef.current;
    const net = netRef.current;
    const view = hudRef.current.view;
    if (renderer === null || cfg === null || net === null || view === null) return;
    if (view.phase !== 'play') return;
    const world = renderer.pixelToWorld(clientX, clientY);
    renderer.ghost = null;
    if (world === null) return;
    if (!renderer.canDrop(cardId, world.x, world.y)) return;
    const def = tunedCard(renderer.cards, cardId);
    if (def?.role === 'spell') {
      const rgb =
        hudRef.current.side === 1
          ? { r: 255, g: 61, b: 154 }
          : { r: 61, g: 240, b: 255 };
      renderer.spellImpact(world.x, world.y, rgb, def.paint, cardId);
      sfxSpell();
    } else {
      renderer.burst(world.x, world.y, { r: 61, g: 240, b: 255 }, 22);
      sfxDash();
    }
    net.send({ type: 'play_card', cardId, x: world.x, y: world.y });
  };

  const onCardDown = (e: React.PointerEvent<HTMLButtonElement>, id: CardId, afford: boolean) => {
    if (!afford || dragRef.current !== null) return;
    if (hudRef.current.view?.phase !== 'play') return;
    e.preventDefault();
    const pointerId = e.pointerId;
    const originX = e.clientX;
    const originY = e.clientY;
    const next: Drag = {
      cardId: id,
      x: originX,
      y: originY,
      fromX: originX,
      fromY: originY,
      ok: false,
    };
    dragRef.current = next;
    setDrag(next);
    requestAnimationFrame(() => placeFloat(originX, originY, false));
    syncGhost(id, originX, originY);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || dragRef.current === null) return;
      const ok = syncGhost(id, ev.clientX, ev.clientY);
      dragRef.current.x = ev.clientX;
      dragRef.current.y = ev.clientY;
      dragRef.current.ok = ok;
      placeFloat(ev.clientX, ev.clientY, ok);
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (rendererRef.current !== null) rendererRef.current.ghost = null;
      if (current === null || ev.type === 'pointercancel') return;
      const dist = Math.hypot(ev.clientX - originX, ev.clientY - originY);
      if (dist < 14) return;
      drop(id, ev.clientX, ev.clientY);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (endDrag.current === stop) endDrag.current = null;
    };
    endDrag.current?.();
    endDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const view = hud.view;
  const pingClass = rtt < 50 ? 'ping-good' : rtt < 100 ? 'ping-ok' : 'ping-bad';
  const youWin = hud.winner === hud.side;
  const showCountdown =
    view !== null && view.phase === 'countdown' && hud.waiting === null && view.countdownLeft > 0;
  const energy = view?.energy ?? 0;
  const energyMax = view?.energyMax ?? 10;
  const wholeEnergy = Math.max(0, Math.floor(Number.isFinite(energy) ? energy : 0));
  const dragHint = hintFor(drag, energy, table);

  return (
    <div className="stage arena-stage">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div className="hud-top">
          <TowerStrip view={view} side={hud.side} you />
          <div className="timer-wrap">
            <div className="map-name">{view?.mapName ?? ''}</div>
            <div className="timer">{fmtTime(view?.timeLeft ?? 0)}</div>
            <div className="hint-banner">{dragHint}</div>
          </div>
          <div className="meta">
            <TowerStrip view={view} side={hud.side === 1 ? 2 : 1} you={false} />
            <div className={pingClass}>{Math.round(rtt)} ms</div>
            {view?.doubleElixir ? <div className="ping-ok">DOUBLE ENERGY</div> : null}
          </div>
        </div>
        <div className="card-dock">
          <div className="energy">
            <span className="energy-label">ARROWS</span>
            <b>
              {wholeEnergy}
              <small>/{Math.round(energyMax)}</small>
            </b>
            <div className="energy-pips">
              {Array.from({ length: Math.round(energyMax) }, (_, i) => (
                <i key={i} className={i < wholeEnergy ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="hand">
            {(view?.hand ?? []).map((id, i) => {
              const def = tunedCard(table, id) ?? CARD_CATALOG[id];
              const afford = energy + 1e-6 >= def.cost;
              const lifting = drag?.cardId === id;
              return (
                <button
                  key={`${id}-${i}`}
                  type="button"
                  className={`card span-${def.span} ${cardMotion(def.role)} ${afford ? '' : 'dim'} ${lifting ? 'lifting' : ''}`}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => onCardDown(e, id, afford)}
                >
                  <CardFace id={id} tune={table[id]} />
                  {afford ? null : (
                    <span className="need">need {Math.ceil(def.cost - energy)}</span>
                  )}
                </button>
              );
            })}
            {view?.next !== undefined && view.next !== null ? (
              <div className={`card next span-${(tunedCard(table, view.next) ?? CARD_CATALOG[view.next]).span} ${cardMotion(CARD_CATALOG[view.next].role)}`}>
                <CardFace id={view.next} compact tune={table[view.next]} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {drag !== null ? (
        <div ref={floatRef} className={`card-float span-${(tunedCard(table, drag.cardId) ?? CARD_CATALOG[drag.cardId]).span}`}>
          <CardFace id={drag.cardId} tune={table[drag.cardId]} />
        </div>
      ) : null}
      {hud.waiting !== null && hud.overReason === null && error === null && (
        <div className="overlay">
          <div>
            <p className="eyebrow">arena</p>
            <h2>{hud.room ?? 'WAIT'}</h2>
            <p>{hud.waiting}</p>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                clearSeat();
                netRef.current?.send({ type: 'leave' });
                onExit();
              }}
            >
              Leave
            </button>
          </div>
        </div>
      )}
      {showCountdown && view !== null && (
        <div className="overlay overlay-count">
          <h2>{Math.max(1, Math.ceil(view.countdownLeft))}</h2>
        </div>
      )}
      {hud.overReason !== null && (
        <div className="overlay">
          <div>
            <p className="eyebrow">{hud.overReason}</p>
            <h2>{hud.winner === 0 ? 'DRAW' : youWin ? 'WIN' : 'LOSS'}</h2>
            <p>paint won the map</p>
            <button
              className="btn btn-cyan"
              type="button"
              onClick={() => {
                clearSeat();
                netRef.current?.send({ type: 'leave' });
                onExit();
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
      {error !== null && hud.overReason === null && (
        <div className="overlay">
          <div>
            <h2>DROP</h2>
            <p>{error}</p>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                clearSeat();
                netRef.current?.send({ type: 'leave' });
                onExit();
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function cardMotion(role: string): string {
  if (role === 'building') return 'kind-tower';
  if (role === 'flying') return 'kind-flier';
  if (role === 'spell') return 'kind-spell';
  return 'kind-move';
}

function hintFor(drag: Drag | null, energy: number, table: CardTable): string {
  if (drag === null) return '';
  const def = tunedCard(table, drag.cardId) ?? CARD_CATALOG[drag.cardId];
  if (energy + 1e-6 < def.cost) return `Need ${def.cost}`;
  if (drag.ok) return '';
  if (def.role === 'spell') return 'Needs open ground';
  return def.span > 1 ? `Needs a ${def.span}×${def.span} of your color` : 'Needs your color';
}

function TowerStrip({
  view,
  side,
  you,
}: {
  view: ArenaView | null;
  side: Side;
  you: boolean;
}) {
  const towers = view?.towers.filter((t) => t.side === side) ?? [];
  const king = towers.find((t) => t.slot === 'king');
  const left = towers.find((t) => t.slot === 'left');
  const right = towers.find((t) => t.slot === 'right');
  if (towers.length === 0) {
    const scores = view?.scores;
    const mine = side === 1 ? (scores?.p1 ?? 0) : (scores?.p2 ?? 0);
    const other = side === 1 ? (scores?.p2 ?? 0) : (scores?.p1 ?? 0);
    const painted = mine + other;
    const pct = painted === 0 ? 0 : Math.round((mine / painted) * 100);
    return (
      <div className={`tower-strip ${you ? 'you' : 'them'} side-${side}`}>
        <span className="strip-name">{you ? 'YOU' : 'ENEMY'}</span>
        <b className="paint-pct">{pct}%</b>
      </div>
    );
  }
  return (
    <div className={`tower-strip ${you ? 'you' : 'them'} side-${side}`}>
      <span className="strip-name">{you ? 'YOU' : 'ENEMY'}</span>
      <Pip t={left} />
      <Pip t={king} king />
      <Pip t={right} />
    </div>
  );
}

function Pip({
  t,
  king = false,
}: {
  t: { hp: number; maxHp: number; active: boolean } | undefined;
  king?: boolean;
}) {
  const pct = t === undefined || t.maxHp <= 0 ? 0 : Math.max(0, t.hp / t.maxHp);
  const dead = t !== undefined && t.hp <= 0;
  const asleep = king && t !== undefined && !t.active && t.hp > 0;
  return (
    <span className={`pip ${king ? 'king' : ''} ${dead ? 'dead' : ''} ${asleep ? 'asleep' : ''}`}>
      {pct > 0 ? <i style={{ height: `${pct * 100}%` }} /> : null}
    </span>
  );
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
