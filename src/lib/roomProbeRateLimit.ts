import type { Context } from "hono";

// Trust only Cloudflare's platform-provided client address. Never use forwarded
// headers or a client-supplied user ID; absent addresses share a fallback bucket.
export async function enforceRoomProbeRateLimit(
  c: Context<{ Bindings: Env }>,
  roomKey: string,
  page = false,
): Promise<Response | null> {
  const ip = c.req.header("CF-Connecting-IP") || "global";
  const id = c.env.ROOM_INDEX.idFromName(`room-probes:${ip}`);
  const res = await c.env.ROOM_INDEX.get(id).fetch(`http://internal/probe/${roomKey}`, { method: "POST" });
  if (res.status === 204) return null;
  if (res.status !== 429) {
    return c.json({ error: "Room unavailable, please try again" }, 503);
  }
  const retryAfter = res.headers.get("Retry-After") ?? "60";
  const message = `Too many room attempts. Please try again in ${retryAfter} seconds.`;
  const headers = { "Retry-After": retryAfter, "Cache-Control": "no-store" };
  return page ? c.text(message, 429, headers) : c.json({ error: message }, 429, headers);
}
