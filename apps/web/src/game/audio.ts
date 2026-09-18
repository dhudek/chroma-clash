let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (ctx !== null) return ctx;
  const Ctor = window.AudioContext;
  if (Ctor === undefined) return null;
  ctx = new Ctor();
  return ctx;
}

export function unlockAudio(): void {
  const c = ac();
  if (c !== null && c.state === 'suspended') {
    void c.resume();
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.05): void {
  const c = ac();
  if (c === null) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + dur);
}

export function sfxCountdown(n: number): void {
  tone(n === 0 ? 880 : 420, 0.12, 'triangle', 0.06);
}

export function sfxDash(): void {
  tone(180, 0.16, 'sawtooth', 0.04);
  tone(520, 0.1, 'square', 0.02);
}

export function sfxSpell(): void {
  tone(140, 0.22, 'sawtooth', 0.05);
  tone(90, 0.28, 'sine', 0.04);
  setTimeout(() => tone(320, 0.12, 'triangle', 0.04), 40);
}

export function sfxWin(won: boolean): void {
  if (won) {
    tone(523, 0.18, 'triangle', 0.05);
    setTimeout(() => tone(784, 0.28, 'triangle', 0.05), 90);
  } else {
    tone(196, 0.3, 'sine', 0.05);
  }
}
