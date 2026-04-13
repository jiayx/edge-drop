import type { Context } from "hono";
import type { RoomIndexEntry } from "../types";

// GET /api/v1/stats — internal stats, auth-gated
export async function getStats(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const authToken = c.req.header("X-Stats-Token");
  if (authToken !== env.STATS_AUTH_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const indexStub = env.ROOM_INDEX.get(env.ROOM_INDEX.idFromName("global"));
  const res = await indexStub.fetch("http://internal/list");
  const registry = await res.json<Record<string, RoomIndexEntry>>();

  const now = Date.now();
  const entries = Object.values(registry);
  const active = entries.filter((e) => e.expiresAt > now).length;
  const expired = entries.length - active;

  return c.json({
    totalRooms: entries.length,
    activeRooms: active,
    expiredRooms: expired,
    timestamp: now,
  });
}
