import path from 'node:path';
import { existsSync } from 'node:fs';
import { serve, type ServerType } from '@hono/node-server';
import { WebSocketServer } from 'ws';

import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { GameHub } from './hub.ts';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const adminPin = process.env.ADMIN_PIN ?? 'clash';
const dbPath =
  process.env.DATABASE_PATH ??
  path.join(import.meta.dirname, '../data/clash.db');

const distCandidate = path.resolve(import.meta.dirname, '../../web/dist');
const webRoot =
  process.env.NODE_ENV === 'production' && existsSync(distCandidate)
    ? path.relative(process.cwd(), distCandidate) || '.'
    : null;

const db = openDatabase(dbPath);
const hub = new GameHub(db);
const app = createApp({ hub, adminPin, webRoot });

const wss = new WebSocketServer({ noServer: true });

const server: ServerType = serve(
  {
    fetch: app.fetch,
    port,
    hostname: process.env.HOST ?? '0.0.0.0',
    websocket: { server: wss },
  },
  (info) => {
    const shown =
      info.address === '0.0.0.0' || info.address === '::'
        ? 'localhost'
        : info.address;
    console.log(`color-clash api  http://${shown}:${info.port}`);
    console.log(`websocket         ws://${shown}:${info.port}/ws`);
    if (webRoot !== null) console.log(`web               ${webRoot}`);
  },
);

function shutdown(): void {
  server.close();
  wss.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
