import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { parsePositiveInt } from "@/lib/fileSize";
import type { RoomIndexEntry } from "@/room/types";
import { lookupRoom, getRoomStub } from "@/room/store";

const requireAdminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const authToken = c.req.header("X-Admin-Token");
  if (authToken !== c.env.ADMIN_AUTH_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// GET /api/v1/admin/stats — internal stats, auth-gated
export async function getStats(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
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

export async function getAdminRooms(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;

  const indexStub = env.ROOM_INDEX.get(env.ROOM_INDEX.idFromName("global"));
  const res = await indexStub.fetch("http://internal/list");
  const registry = await res.json<Record<string, RoomIndexEntry>>();

  const now = Date.now();
  const rooms = await Promise.all(
    Object.entries(registry).map(async ([key, entry]) => {
      let onlineCount = 0;
      const roomStub = getRoomStub(env, entry.doId);
      const infoRes = await roomStub.fetch("http://internal/info");
      if (infoRes.ok) {
        const roomInfo = await infoRes.json<{ onlineCount?: unknown }>();
        onlineCount = typeof roomInfo.onlineCount === "number" ? roomInfo.onlineCount : 0;
      }

      return {
        key,
        doId: entry.doId,
        expiresAt: entry.expiresAt,
        isActive: entry.expiresAt > now,
        onlineCount,
      };
    })
  );

  rooms.sort((a, b) => b.expiresAt - a.expiresAt);

  return c.json({ rooms });
}

export async function getAdminRoomDetail(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;

  const key = c.req.param("key");
  if (!key) return c.json({ error: "Room key required" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);

  const roomStub = getRoomStub(env, entry.doId);
  const infoRes = await roomStub.fetch("http://internal/info");
  if (!infoRes.ok) return c.json({ error: "Failed to get room info" }, 500);

  const roomInfo = await infoRes.json<Record<string, unknown>>();

  return c.json({
    key,
    doId: entry.doId,
    ...roomInfo,
  });
}

export async function updateAdminRoomConfig(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;

  const key = c.req.param("key");
  if (!key) return c.json({ error: "Room key required" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);

  const body = await c.req.json<{ maxFileSizeMb?: unknown }>();
  if (body.maxFileSizeMb === undefined) {
    return c.json({ error: "No config provided" }, 400);
  }
  const maxFileSizeMb = parsePositiveInt(body.maxFileSizeMb);
  if (maxFileSizeMb === null) {
    return c.json({ error: "Invalid max file size" }, 400);
  }

  const roomStub = getRoomStub(env, entry.doId);
  const res = await roomStub.fetch("http://internal/config", {
    method: "POST",
    body: JSON.stringify({ maxFileSizeMb }),
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text();
    return c.json({ error: errorText || "Failed to update config" }, res.status === 400 ? 400 : 500);
  }

  return c.json({ ok: true });
}

export const adminApi = new Hono<{ Bindings: Env }>();

adminApi.use("/admin/*", requireAdminAuth);
adminApi.get("/admin/stats", getStats);
adminApi.get("/admin/rooms", getAdminRooms);
adminApi.get("/admin/rooms/:key", getAdminRoomDetail);
adminApi.post("/admin/rooms/:key/config", updateAdminRoomConfig);
