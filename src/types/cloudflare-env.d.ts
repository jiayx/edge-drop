/// <reference types="@cloudflare/workers-types" />

declare module "assets:*" {
  export const onRequest: unknown;
}

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  ROOM_INDEX: DurableObjectNamespace;
  ROOM_JOIN_RATE_LIMIT: RateLimit;

  MAX_FILE_SIZE_MB: string;
  ROOM_TTL_HOURS: string;
  BLOCKED_MIME_TYPES: string;
  ADMIN_AUTH_TOKEN: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
