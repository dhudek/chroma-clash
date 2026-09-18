import type { ClientMsg, ServerMsg } from '@clash/shared';

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function guestId(): string {
  const key = 'clash.guest';
  const existing = localStorage.getItem(key);
  if (existing !== null && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export function loadName(): string {
  return localStorage.getItem('clash.name') ?? '';
}

export function saveName(name: string): void {
  localStorage.setItem('clash.name', name);
}

export class Net {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  rtt = 0;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  onOpen: (() => void) | null = null;

  connect(): void {
    this.close();
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.onOpen?.();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data) as unknown;
      } catch {
        return;
      }
      const msg = parsed as ServerMsg;
      if (msg.type === 'pong') {
        this.rtt = Math.max(0, performance.now() - msg.t);
      }
      this.onMessage?.(msg);
    });
    ws.addEventListener('close', () => {
      this.onClose?.();
    });
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', t: performance.now() });
    }, 2000);
  }

  send(msg: ClientMsg): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws !== null) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
