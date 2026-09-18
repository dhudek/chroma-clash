import {
  DEFAULT_CONFIG,
  aiInput,
  countScores,
  countdownLeftSec,
  createSim,
  dashReadyIn,
  encodeGrid,
  phaseOf,
  step,
  timeLeftSec,
  type DirtyCell,
  type GameConfig,
  type SimState,
  type StatePayload,
} from '@clash/shared';
import { useEffect, useRef } from 'react';

import { ArenaRenderer } from '../game/renderer';

export function Ambient() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const config: GameConfig = {
      ...DEFAULT_CONFIG,
      countdownSec: 0,
      matchSec: 40,
      aiSkill: 0.8,
    };
    const renderer = new ArenaRenderer(canvas);
    let sim = createSim(config);
    renderer.startMatch(config, 1, payloadFrom(sim, config, true, []));

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    let raf = 0;
    let acc = 0;
    let last = performance.now();
    const stepMs = 1000 / config.tickHz;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      acc += now - last;
      last = now;
      while (acc >= stepMs) {
        acc -= stepMs;
        const { dirty } = step(
          sim,
          config,
          aiInput(sim, config, 1),
          aiInput(sim, config, 2),
        );
        if (sim.over) {
          sim = createSim(config);
          renderer.startMatch(config, 1, payloadFrom(sim, config, true, []));
        } else {
          renderer.applyState(
            payloadFrom(sim, config, dirty.length > 120, dirty),
          );
        }
      }
      renderer.draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="ambient">
      <canvas ref={ref} />
    </div>
  );
}

function payloadFrom(
  sim: SimState,
  config: GameConfig,
  full: boolean,
  dirtyIdx: readonly number[],
): StatePayload {
  const dirty: DirtyCell[] = [];
  if (!full) {
    for (const i of dirtyIdx) {
      const v = sim.grid[i];
      if (v === 0 || v === 1 || v === 2) dirty.push({ i, v });
    }
  }
  const state: StatePayload = {
    tick: sim.tick,
    phase: sim.over ? 'over' : phaseOf(sim.tick, config),
    timeLeft: timeLeftSec(sim.tick, config),
    countdownLeft: countdownLeftSec(sim.tick, config),
    you: {
      x: sim.p1.x,
      y: sim.p1.y,
      dashReadyIn: dashReadyIn(sim.p1, sim.tick),
    },
    opp: {
      x: sim.p2.x,
      y: sim.p2.y,
      dashReadyIn: dashReadyIn(sim.p2, sim.tick),
    },
    scores: countScores(sim.grid),
    dirty,
    winner: sim.winner,
  };
  if (full) state.grid = encodeGrid(sim.grid);
  return state;
}
