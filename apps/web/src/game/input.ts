import type { PlayerInput } from '@clash/shared';

export class InputCtl {
  dx = 0;
  dy = 0;
  private dashQueued = false;
  private readonly keys = new Set<string>();
  private stickX = 0;
  private stickY = 0;
  private stickOn = false;

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        this.dashQueued = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }

  setStick(nx: number, ny: number, active: boolean): void {
    this.stickOn = active;
    this.stickX = nx;
    this.stickY = ny;
  }

  queueDash(): void {
    this.dashQueued = true;
  }

  sample(seq: number): PlayerInput {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (this.stickOn) {
      dx += this.stickX;
      dy += this.stickY;
    }
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    const dash = this.dashQueued;
    this.dashQueued = false;
    this.dx = dx;
    this.dy = dy;
    return { seq, dx, dy, dash };
  }
}
