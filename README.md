# edge-drop

Anonymous temporary room chat and file drop built with Vite, Cloudflare Workers, Durable Objects, and R2.

## Features

- 6-digit temporary rooms
- Real-time room presence and chat over WebSocket
- File upload and download through the Worker
- Image, audio, and video previews
- Room expiry and room extension
- Desktop and mobile room presence UI
- Dark, light, and system theme support
- Local slash commands:
  - `/name <new name>`
  - `/theme`
  - `/help`

## Stack

- Vite
- TypeScript
- Hono
- Cloudflare Workers
- Durable Objects
- R2

## Project Structure

- `src/views/*`: page HTML rendering
- `src/client/*`: frontend behavior
- `src/app.css`: app styles
- `src/index.ts`: Worker entry
- `src/routes/*`: HTTP and page routes
- `src/room/durable/*`: room state Durable Objects

## Requirements

- Node.js 20+
- pnpm
- Wrangler 4
- A Cloudflare account with:
  - one R2 bucket
  - Durable Objects enabled
  - a Rate Limiting binding

## Install

```bash
pnpm install
```

## Local Development

```bash
pnpm dev
```

The app runs on `http://localhost:5173`.

## Build

```bash
pnpm build
```

## Deploy

```bash
pnpm run deploy
```

## Configuration

Main config lives in [`wrangler.toml`](./wrangler.toml).

Current bindings and vars:

- Durable Objects:
  - `ROOMS`
  - `ROOM_INDEX`
- R2:
  - `FILE_BUCKET`
- Rate limit:
  - `ROOM_JOIN_RATE_LIMIT`
- Vars:
  - `MAX_FILE_SIZE_MB`
  - `ROOM_TTL_HOURS`
  - `BLOCKED_MIME_TYPES`
- Secret/auth var:
  - `STATS_AUTH_TOKEN`

You should update at least:

- R2 bucket names
- rate limit namespace
- `STATS_AUTH_TOKEN`

## Stats Endpoint

Internal stats endpoint:

```text
GET /api/v1/stats
X-Stats-Token: <token>
```

Example:

```bash
curl -s http://127.0.0.1:5173/api/v1/stats \
  -H 'X-Stats-Token: your_token'
```

## Room Flow

1. Create a room with `POST /api/v1/rooms`
2. Open `/room/<roomKey>`
3. Join via `POST /api/v1/rooms/:key/join`
4. Chat and upload files
5. Extend room lifetime with `POST /api/v1/rooms/:key/extend`

## Notes

- Files are stored in R2 under `rooms/<roomKey>/...`
- Downloads are proxied by the Worker instead of exposing R2 directly
- Room metadata and presence are stored in Durable Objects
- Expired rooms are cleaned up by the scheduled cleanup job
