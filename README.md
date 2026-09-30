# edge-drop

Temporary, anonymous chat rooms and file sharing built with TypeScript, Hono,
Vite, Cloudflare Workers, Durable Objects, and R2.

## Features

- Create or join a room with a 6-digit key; share its link or QR code.
- Real-time chat, online users, renaming, mentions, and browser mention notifications.
- Message history, automatic reconnection, pending-message retries, clickable links,
  and message copying.
- File picker, drag-and-drop, and paste uploads with progress, cancellation, and retry.
- Image, audio, and video previews with download links.
- Rooms expire after 24 hours by default. Extensions are capped at 48 hours from
  the time of extension; an hourly job removes expired rooms and their files.
- Light, dark, and system themes in the room; `/name <new name>`, `/theme`, and `/help` commands.
- `/admin` provides room statistics, room details, online users, and per-room file size limits.
- GA4 (`G-K8QNWFNXLL`) runs on the lobby and room pages in production builds.

## Run locally

Requires Node.js 20.19+ or 22.12+, pnpm, and a Cloudflare account with an R2 bucket,
Durable Objects, and a Rate Limiting binding.

```bash
pnpm install
pnpm dev
```

The development server runs at `http://localhost:5173`. Put local environment
values in `.env`.

```bash
pnpm test # tests require Node.js 22.15+ (or Node.js 24+)
pnpm run test:runtime # builds and tests local Durable Objects and WebSocket upgrade
pnpm exec tsc --noEmit
pnpm build
pnpm preview
```

## Room discovery limits

All public room routes share a per-IP allowance of 10 distinct room codes in a
rolling 60-second window, including pages, joins, history, WebSocket upgrades,
and file endpoints. Reusing the same code during that window does not consume
additional slots for joining, reconnecting, and loading media. Once an admission
expires, the next request needs a free slot; busy shared IPs can therefore still
hit the allowance. Existing open WebSocket connections are not interrupted.
The six-digit codes and share links are unchanged. Clients behind the same
public IP share this allowance. A blocked new code returns HTTP 429 with
`Retry-After`; admitted codes continue working.

Admissions are serialized and persisted in separate per-IP objects using the
existing `ROOM_INDEX` namespace. Each record holds at most 10 codes and expires
via a Durable Object alarm. Only the platform's `CF-Connecting-IP` is trusted;
missing addresses share a fallback bucket. This is a discovery limit, not a
full flood limit for repeated requests, messages, or uploads to an admitted room.
Room creation separately uses `ROOM_JOIN_RATE_LIMIT` (10/minute per IP).
No new binding or migration is required.

## Configuration

[`wrangler.toml`](./wrangler.toml) defines the Worker, static assets, `ROOMS` and
`ROOM_INDEX` Durable Objects, `ROOM_JOIN_RATE_LIMIT`, and the hourly cleanup schedule.

| Variable | Purpose / default |
| --- | --- |
| `MAX_FILE_SIZE_MB` | Default per-file limit: `100` MB |
| `ROOM_TTL_HOURS` | Initial lifetime and extension increment: `24` hours |
| `BLOCKED_MIME_TYPES` | Comma-separated MIME prefixes blocked for uploads |
| `ADMIN_AUTH_TOKEN` | Admin dashboard and API authentication |
| `R2_ACCOUNT_ID` | Cloudflare account containing the bucket |
| `R2_BUCKET_NAME` | File storage bucket |
| `R2_ACCESS_KEY_ID` | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret key |

The Worker issues presigned PUT URLs for browser uploads directly to R2.
Downloads and media range requests stream through the Worker. Files use the
`rooms/<roomKey>/` prefix; messages and room metadata live in Durable Objects.

The R2 bucket must allow CORS from the site origin for `PUT` requests with
`content-type`, `content-disposition`, and `x-amz-meta-originalfilename` headers.
Uploads are checked against the room's file size limit, blocked MIME prefixes,
and executable file extensions.

Admin API requests use `X-Admin-Token`. The dashboard stores the token in browser
session storage. Available endpoints include `/api/v1/admin/stats`,
`/api/v1/admin/rooms`, `/api/v1/admin/rooms/:key`, and
`POST /api/v1/admin/rooms/:key/config`.

Admin APIs fail closed with HTTP 503 if `ADMIN_AUTH_TOKEN` is missing, empty,
or whitespace-only. With a valid configuration, missing or incorrect request
tokens receive HTTP 401. Tokens are compared exactly; use a token without leading
or trailing whitespace (HTTP headers and the dashboard normalize those spaces).
The deployment script rejects missing, empty, and whitespace-only required values.

## Deploy

Set the five admin/R2 variables above in `.env.prod`, and configure the rate limit
namespace in `wrangler.toml`.

```bash
pnpm run deploy
```

This builds the app, merges `.env.prod` values into the generated Wrangler config,
and deploys the Worker. Environment file values override `wrangler.toml` defaults.
To use another environment file:

```bash
pnpm run deploy .env.staging
```

`pnpm run deploy:raw` runs Wrangler directly without the build or environment-file merge.
Environment files are gitignored.

## Source layout

- `src/views`: server-rendered pages and shared layout
- `src/client`: lobby, room, and admin browser behavior
- `src/routes`: page and API handlers
- `src/room`: room types, lookup helpers, and Durable Objects
- `src/lib`: shared helpers, icons, and R2 S3 operations
- `src/cron`: expired-room cleanup
- `src/app.css`, `src/admin.css`: public and admin styles
- `scripts/deploy-worker.mjs`: build configuration merge and deployment
