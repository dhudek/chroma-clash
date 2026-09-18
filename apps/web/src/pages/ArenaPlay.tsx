import {
  CARD_CATALOG,
  type ArenaConfig,
  type ArenaView,
  type CardId,
  type ServerMsg,
  type Side,
} from '@clash/shared';
import { useEffect, useRef, useState } from 'react';

import { sfxCountdown, sfxDash, sfxSpell, sfxWin, unlockAudio } from '../game/audio';
import { CardArenaRenderer } from '../game/arena-renderer';
import { CardFace } from '../game/CardFace';
import { guestId, Net } from '../game/net';
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
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rtt, setRtt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hudRef = useRef(hud);
  hudRef.current = hud;
  const dragRef = useRef<Drag | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);

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
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onEsc);

    net.onOpen = () => {
      net.send({ type: 'hello', guestId: guestId(), name });
    };
    net.onMessage = (msg: ServerMsg) => {
      setRtt(net.rtt);
      switch (msg.type) {
        case 'welcome':
          if (intent.kind === 'cpu') net.send({ type: 'play_cpu', game: 'arena' });
          else if (intent.kind === 'queue') net.send({ type: 'queue', game: 'arena' });
          else if (intent.kind === 'create') net.send({ type: 'create_room', game: 'arena' });
          else net.send({ type: 'join_room', code: intent.code });
          break;
        case 'queued':
          setHud((h) => ({ ...h, waiting: 'Searching the void…' }));
          break;
        case 'waiting':
          setHud((h) => ({ ...h, waiting: msg.message }));
          break;
        case 'room':
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
          renderer.start(msg.config, msg.side, msg.state);
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
      renderer.draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onEsc);
      net.send({ type: 'leave' });
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
    const def = CARD_CATALOG[cardId];
    if (def.role === 'spell') {
      const rgb =
        hudRef.current.side === 1
          ? { r: 255, g: 61, b: 154 }
          : { r: 61, g: 240, b: 255 };
      renderer.spellImpact(world.x, world.y, rgb);
      sfxSpell();
    } else {
      renderer.burst(world.x, world.y, { r: 61, g: 240, b: 255 }, 22);
      sfxDash();
    }
    net.send({ type: 'play_card', cardId, x: world.x, y: world.y });
  };

  const onCardDown = (e: React.PointerEvent<HTMLButtonElement>, id: CardId, afford: boolean) => {
    if (!afford) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const next: Drag = {
      cardId: id,
      x: e.clientX,
      y: e.clientY,
      fromX: e.clientX,
      fromY: e.clientY,
      ok: false,
    };
    dragRef.current = next;
    setDrag(next);
    requestAnimationFrame(() => placeFloat(e.clientX, e.clientY, false));
    syncGhost(id, e.clientX, e.clientY);
  };

  const onCardMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (current === null) return;
    const ok = syncGhost(current.cardId, e.clientX, e.clientY);
    current.x = e.clientX;
    current.y = e.clientY;
    current.ok = ok;
    placeFloat(e.clientX, e.clientY, ok);
  };

  const onCardUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (rendererRef.current !== null) rendererRef.current.ghost = null;
    if (current === null) return;
    const dist = Math.hypot(e.clientX - current.fromX, e.clientY - current.fromY);
    if (dist < 14) return;
    drop(current.cardId, e.clientX, e.clientY);
  };

  const view = hud.view;
  const pingClass = rtt < 50 ? 'ping-good' : rtt < 100 ? 'ping-ok' : 'ping-bad';
  const youWin = hud.winner === hud.side;
  const showCountdown =
    view !== null && view.phase === 'countdown' && hud.waiting === null && view.countdownLeft > 0;
  const energy = view?.energy ?? 0;
  const energyMax = view?.energyMax ?? 10;
  const dragHint = hintFor(drag, energy);

  return (
    <div className="stage arena-stage">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div className="hud-top">
          <TowerStrip view={view} side={hud.side} you />
          <div className="timer-wrap">
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
            <span className="energy-label">ENERGY</span>
            <b>
              {Math.floor(energy)}
              <small>/{Math.round(energyMax)}</small>
            </b>
            <div className="energy-pips">
              {Array.from({ length: Math.round(energyMax) }, (_, i) => (
                <i key={i} className={i < energy ? 'on' : ''} />
              ))}
            </div>
          </div>
          <div className="hand">
            {(view?.hand ?? []).map((id, i) => {
              const def = CARD_CATALOG[id];
              const afford = energy + 1e-6 >= def.cost;
              const lifting = drag?.cardId === id;
              return (
                <button
                  key={`${id}-${i}`}
                  type="button"
                  className={`card ${afford ? '' : 'dim'} ${lifting ? 'lifting' : ''} ${def.role === 'spell' ? 'spell' : ''}`}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => onCardDown(e, id, afford)}
                  onPointerMove={onCardMove}
                  onPointerUp={onCardUp}
                  onPointerCancel={onCardUp}
                >
                  <CardFace id={id} />
                  {afford ? null : (
                    <span className="need">need {Math.ceil(def.cost - energy)}</span>
                  )}
                </button>
              );
            })}
            {view?.next !== undefined && view.next !== null ? (
              <div className="card next">
                <CardFace id={view.next} compact />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {drag !== null ? (
        <div ref={floatRef} className="card-float">
          <CardFace id={drag.cardId} />
        </div>
      ) : null}
      {hud.waiting !== null && hud.overReason === null && error === null && (
        <div className="overlay">
          <div>
            <p className="eyebrow">arena</p>
            <h2>{hud.room ?? 'WAIT'}</h2>
            <p>{hud.waiting}</p>
            <button className="btn btn-ghost" type="button" onClick={onExit}>
              Leave
            </button>
          </div>
        </div>
      )}
      {showCountdown && view !== null && (
        <div className="overlay overlay-count">
          <h2>{Math.max(1, Math.ceil(view.countdownLeft))}</h2>
          <p>paint the whole map your color · drop on YOUR squares</p>
        </div>
      )}
      {hud.overReason !== null && (
        <div className="overlay">
          <div>
            <p className="eyebrow">{hud.overReason}</p>
            <h2>{hud.winner === 0 ? 'DRAW' : youWin ? 'WIN' : 'LOSS'}</h2>
            <p>paint won the map</p>
            <button className="btn btn-cyan" type="button" onClick={onExit}>
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
            <button className="btn btn-ghost" type="button" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function hintFor(drag: Drag | null, energy: number): string {
  if (drag === null) return 'Drag onto YOUR color · Meteor anywhere';
  const def = CARD_CATALOG[drag.cardId];
  if (energy + 1e-6 < def.cost) return `Need ${def.cost} energy`;
  if (def.role === 'spell') {
    return drag.ok ? 'Release Meteor — converts anywhere' : 'Aim Meteor on the field';
  }
  return drag.ok ? `Release — deploy ${def.name} on your color` : 'Only on YOUR color';
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
  const pct = t === undefined ? 0 : Math.max(0, t.hp / t.maxHp);
  const dead = t !== undefined && t.hp <= 0;
  const asleep = king && t !== undefined && !t.active && t.hp > 0;
  return (
    <span className={`pip ${king ? 'king' : ''} ${dead ? 'dead' : ''} ${asleep ? 'asleep' : ''}`}>
      <i style={{ height: `${pct * 100}%` }} />
    </span>
  );
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
