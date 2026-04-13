/// <reference types="@cloudflare/workers-types" />

declare module "assets:*" {
  export const onRequest: unknown;
}

interface Env {
  FILE_BUCKET: R2Bucket;
  ROOMS: DurableObjectNamespace;
  ROOM_INDEX: DurableObjectNamespace;
  ROOM_JOIN_RATE_LIMIT: RateLimit;

  MAX_FILE_SIZE_MB: string;
  ROOM_TTL_HOURS: string;
  BLOCKED_MIME_TYPES: string;
  STATS_AUTH_TOKEN: string;
}
