# Color Clash

Neon 1vCPU / 1v1. Two modes on the same server:

- **Arena** (default) — Color Clash-style: energy, cycling cards, king + side towers, units that paint as they fight. Destroy the king to win.
- **Spray** — the original painter. WASD, dash, most paint when the clock dies.

Authoritative Node 24 server, Hono REST + WebSocket, Vite + React 19.

## Stack

| Piece | Choice |
| --- | --- |
| Runtime | Node 24 — native `.ts` type stripping, `node:sqlite`, `node:test` |
| API | Hono on `@hono/node-server` (WebSocket helper is built-in; `@hono/node-ws` is deprecated) |
| Sim | Shared TypeScript in `packages/shared` — server is source of truth |
| Web | Vite 8 + React 19, canvas renderer (not the DOM) |
| Mobile | Same REST + `/ws` protocol as the web client |

## Run

Node 24+.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000
- Admin PIN: `clash` (override with `ADMIN_PIN`)

Production (serves the Vite build from Hono):

```bash
npm run build
NODE_ENV=production npm start
```

## Protocol (web + mobile)

REST (CORS open, set `CORS_ORIGIN` to lock it):

- `GET /api/health`
- `GET /api/config` — current tunables + `ws: "/ws"`
- `GET /api/admin/settings` · `PUT /api/admin/settings` — spray tunables (`x-admin-pin`)
- `GET /api/admin/arena` · `PUT /api/admin/arena` — arena tunables
- `GET /api/admin/matches`

WebSocket ` /ws ` — JSON messages typed in `packages/shared/src/protocol.ts`.

Client → server: `hello`, `play_cpu`, `queue`, `create_room`, `join_room`, `input`, `ping`, `leave`.

Server → client: `welcome`, `queued`, `room`, `waiting`, `match_start`, `state`, `match_end`, `pong`, `error`.

Positions are **never** sent by the client. Inputs only. The server simulates at `tickHz` (default 20).

## Layout

```
packages/shared   protocol, config, sim, AI
apps/server       Hono, sqlite, match hub
apps/web          lobby, canvas, admin
```
