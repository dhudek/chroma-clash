import type { GameConfig, ServerMsg, Side, StatePayload } from '@clash/shared';
import { useEffect, useRef, useState } from 'react';

import { sfxCountdown, sfxDash, sfxWin, unlockAudio } from '../game/audio';
import { InputCtl } from '../game/input';
import { guestId, Net } from '../game/net';
import { ArenaRenderer } from '../game/renderer';
import type { PlayIntent } from './Lobby';

type Props = {
  name: string;
  intent: PlayIntent;
  onExit: () => void;
};

type Hud = {
  names: { p1: string; p2: string };
  side: Side;
  scores: { p1: number; p2: number; empty: number };
  timeLeft: number;
  countdownLeft: number;
  phase: StatePayload['phase'];
  dashReadyIn: number;
  tickHz: number;
  winner: 0 | 1 | 2;
  waiting: string | null;
  room: string | null;
  overReason: string | null;
};

const emptyHud: Hud = {
  names: { p1: 'YOU', p2: 'THEM' },
  side: 1,
  scores: { p1: 0, p2: 0, empty: 1 },
  timeLeft: 0,
  countdownLeft: 0,
  phase: 'countdown',
  dashReadyIn: 0,
  tickHz: 20,
  winner: 0,
  waiting: 'Connecting…',
  room: null,
  overReason: null,
};

export function Play({ name, intent, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputCtl | null>(null);
  const [hud, setHud] = useState<Hud>(emptyHud);
  const [rtt, setRtt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hudRef = useRef(hud);
  hudRef.current = hud;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    unlockAudio();
    const renderer = new ArenaRenderer(canvas);
    const input = new InputCtl();
    inputRef.current = input;
    const net = new Net();
    let config: GameConfig | null = null;
    let seq = 0;
    let playing = false;
    let lastDash = false;
    let lastCount = -1;
    let raf = 0;
    let last = performance.now();

    const unbind = input.attach(window);
    const onResize = () => renderer.resize();
    const onEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onEsc);

    const applyState = (state: StatePayload) => {
      renderer.applyState(state);
      setHud((h) => ({
        ...h,
        scores: state.scores,
        timeLeft: state.timeLeft,
        countdownLeft: state.countdownLeft,
        phase: state.phase,
        dashReadyIn: state.you.dashReadyIn,
        winner: state.winner,
        waiting: null,
      }));
      if (state.phase === 'countdown') {
        const n = Math.max(1, Math.ceil(state.countdownLeft));
        if (n !== lastCount) {
          lastCount = n;
          sfxCountdown(n === 1 ? 0 : n);
        }
      }
    };

    net.onOpen = () => {
      net.send({ type: 'hello', guestId: guestId(), name });
    };
    net.onMessage = (msg: ServerMsg) => {
      setRtt(net.rtt);
      switch (msg.type) {
        case 'welcome':
          if (intent.kind === 'cpu') net.send({ type: 'play_cpu', game: 'spray' });
          else if (intent.kind === 'queue') net.send({ type: 'queue', game: 'spray' });
          else if (intent.kind === 'create') net.send({ type: 'create_room', game: 'spray' });
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
          if (msg.game !== 'spray') break;
          config = msg.config;
          playing = true;
          renderer.startMatch(msg.config, msg.side, msg.state);
          setHud({
            names: msg.names,
            side: msg.side,
            scores: msg.state.scores,
            timeLeft: msg.state.timeLeft,
            countdownLeft: msg.state.countdownLeft,
            phase: msg.state.phase,
            dashReadyIn: msg.state.you.dashReadyIn,
            tickHz: msg.config.tickHz,
            winner: 0,
            waiting: null,
            room: null,
            overReason: null,
          });
          break;
        case 'state':
          if (msg.game !== 'spray') break;
          applyState(msg.state);
          break;
        case 'match_end':
          playing = false;
          setHud((h) => ({
            ...h,
            phase: 'over',
            winner: msg.winner,
            scores: msg.scores,
            overReason: msg.reason,
            waiting: null,
          }));
          sfxWin(msg.winner === hudRef.current.side);
          break;
        case 'error':
          setError(msg.message);
          break;
        case 'pong':
          break;
      }
    };
    net.onClose = () => {
      if (hudRef.current.phase !== 'over') setError('disconnected');
    };
    net.connect();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      seq += 1;
      const sample = input.sample(seq);
      if (playing && net.ready) {
        net.send({
          type: 'input',
          seq: sample.seq,
          dx: sample.dx,
          dy: sample.dy,
          dash: sample.dash,
        });
      }
      if (sample.dash && !lastDash) sfxDash();
      lastDash = sample.dash;
      if (playing && config !== null) {
        const dashing = sample.dash || hudRef.current.dashReadyIn > config.dashCooldownTicks - config.dashTicks;
        renderer.predict(sample.dx, sample.dy, dt, dashing);
      }
      renderer.draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const stick = stickRef.current;
    const knob = knobRef.current;
    const onPointer = (e: PointerEvent) => {
      if (stick === null || knob === null) return;
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const max = rect.width / 2 - 24;
      const mag = Math.hypot(dx, dy);
      if (mag > max && mag > 0) {
        dx = (dx / mag) * max;
        dy = (dy / mag) * max;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      input.setStick(max > 0 ? dx / max : 0, max > 0 ? dy / max : 0, true);
    };
    const endPointer = () => {
      if (knob !== null) knob.style.transform = 'translate(-50%, -50%)';
      input.setStick(0, 0, false);
    };
    stick?.addEventListener('pointerdown', (e) => {
      stick.setPointerCapture(e.pointerId);
      onPointer(e);
    });
    stick?.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) return;
      onPointer(e);
    });
    stick?.addEventListener('pointerup', endPointer);
    stick?.addEventListener('pointercancel', endPointer);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onEsc);
      unbind();
      inputRef.current = null;
      net.send({ type: 'leave' });
      net.close();
    };
  }, [intent, name]);

  const total = hud.scores.p1 + hud.scores.p2 + hud.scores.empty || 1;
  const pingClass = rtt < 50 ? 'ping-good' : rtt < 100 ? 'ping-ok' : 'ping-bad';
  const youWin = hud.winner === hud.side;
  const showCountdown =
    hud.phase === 'countdown' && hud.waiting === null && hud.countdownLeft > 0;

  return (
    <div className="stage">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div className="hud-top">
          <div className="score">
            <b>
              <span style={{ color: 'var(--magenta)' }}>{hud.names.p1}</span>
              <span style={{ color: 'var(--cyan)' }}>{hud.names.p2}</span>
            </b>
            <div className="bar">
              <span className="p1" style={{ width: `${(hud.scores.p1 / total) * 100}%` }} />
              <span className="p2" style={{ width: `${(hud.scores.p2 / total) * 100}%` }} />
            </div>
          </div>
          <div className="timer">{fmtTime(hud.timeLeft)}</div>
          <div className="meta">
            <div className={pingClass}>{Math.round(rtt)} ms</div>
            <div>
              dash{' '}
              {hud.dashReadyIn > 0
                ? (hud.dashReadyIn / hud.tickHz).toFixed(1)
                : 'ready'}
            </div>
          </div>
        </div>
        <div className="hud-bot">
          <div className="touch">
            <div className="stick" ref={stickRef}>
              <div className="knob" ref={knobRef} />
            </div>
            <button
              className="dash-btn"
              type="button"
              onPointerDown={() => inputRef.current?.queueDash()}
            >
              DASH
            </button>
          </div>
        </div>
      </div>
      {hud.waiting !== null && hud.phase !== 'over' && error === null && (
        <div className="overlay">
          <div>
            <p className="eyebrow">color clash</p>
            <h2>{hud.room ?? 'WAIT'}</h2>
            <p>{hud.waiting}</p>
            <button className="btn btn-ghost" type="button" onClick={onExit}>
              Leave
            </button>
          </div>
        </div>
      )}
      {showCountdown && (
        <div className="overlay">
          <h2>{Math.max(1, Math.ceil(hud.countdownLeft))}</h2>
          <p>paint the void</p>
        </div>
      )}
      {hud.phase === 'over' && (
        <div className="overlay">
          <div>
            <p className="eyebrow">{hud.overReason}</p>
            <h2>{hud.winner === 0 ? 'DRAW' : youWin ? 'WIN' : 'LOSS'}</h2>
            <p>
              {hud.scores.p1} — {hud.scores.p2}
            </p>
            <button className="btn btn-cyan" type="button" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      )}
      {error !== null && hud.phase !== 'over' && (
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

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
