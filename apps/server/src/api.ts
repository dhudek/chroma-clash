import {
  arenaConfigSchema,
  gameConfigSchema,
  PROTOCOL_VERSION,
} from '@clash/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';

import type { GameHub } from './hub.ts';

export function createApi(hub: GameHub, adminPin: string) {
  const admin = createMiddleware(async (c, next) => {
    const pin = c.req.header('x-admin-pin') ?? '';
    if (pin !== adminPin) {
      return c.json({ error: 'unauthorized' as const }, 401);
    }
    await next();
  });

  return new Hono()
    .use('/*', cors({ origin: process.env.CORS_ORIGIN ?? '*' }))
    .get('/health', (c) =>
      c.json({
        ok: true as const,
        service: 'color-clash',
        protocol: PROTOCOL_VERSION,
        node: process.version,
        sqlite: 'node:sqlite',
        uptime: process.uptime(),
      }),
    )
    .get('/config', (c) =>
      c.json({
        protocol: PROTOCOL_VERSION,
        ws: '/ws',
        settings: hub.getSettings(),
        arena: hub.getArenaSettings(),
      }),
    )
    .get('/admin/settings', admin, (c) =>
      c.json({ settings: hub.getSettings() }),
    )
    .put(
      '/admin/settings',
      admin,
      zValidator('json', gameConfigSchema),
      (c) => {
        const settings = hub.setSettings(c.req.valid('json'));
        return c.json({ settings });
      },
    )
    .get('/admin/arena', admin, (c) =>
      c.json({ settings: hub.getArenaSettings() }),
    )
    .put(
      '/admin/arena',
      admin,
      zValidator('json', arenaConfigSchema),
      (c) => {
        const settings = hub.setArenaSettings(c.req.valid('json'));
        return c.json({ settings });
      },
    )
    .get('/admin/matches', admin, (c) =>
      c.json({ matches: hub.recentMatches() }),
    );
}

export type ApiType = ReturnType<typeof createApi>;
