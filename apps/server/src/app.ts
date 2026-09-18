import { parseClientMsg } from '@clash/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { upgradeWebSocket } from '@hono/node-server';
import { Hono } from 'hono';

import { createApi } from './api.ts';
import type { GameHub } from './hub.ts';

export type AppOptions = {
  hub: GameHub;
  adminPin: string;
  webRoot: string | null;
};

function textFrom(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  return '';
}

export function createApp(opts: AppOptions) {
  const api = createApi(opts.hub, opts.adminPin);
  const app = new Hono()
    .route('/api', api)
    .get(
      '/ws',
      upgradeWebSocket(() => ({
        onMessage(event, ws) {
          const msg = parseClientMsg(textFrom(event.data));
          if (msg === null) {
            ws.send(JSON.stringify({ type: 'error', message: 'bad message' }));
            return;
          }
          opts.hub.handle(ws, msg);
        },
        onClose(_event, ws) {
          opts.hub.disconnect(ws);
        },
      })),
    );

  if (opts.webRoot !== null) {
    const root = opts.webRoot;
    app.get('/assets/*', serveStatic({ root }));
    app.get('/favicon.svg', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
