import type { Context } from "hono";
import { Hono } from "hono";
import { generateRoomKey, isValidRoomKey } from "@/lib/roomKey";
import { roomTtlMs, isExpired } from "@/lib/expiry";
import type { RoomIndexEntry } from "@/room/types";
import { getRoomIndexStub, getRoomStub, lookupRoom } from "@/room/store";

function param(c: Context<{ Bindings: Env }>, name: string): string {
  return c.req.param(name) ?? "";
}

// POST /api/v1/rooms — create a new room
export async function createRoom(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const ttlHours = parseInt(env.ROOM_TTL_HOURS, 10);
  const expiresAt = Date.now() + roomTtlMs(ttlHours);

  // Generate a unique key (retry on collision)
  let roomKey: string;
  let existing: RoomIndexEntry | null;
  let attempts = 0;
  do {
    roomKey = generateRoomKey();
    existing = await lookupRoom(env, roomKey);
    attempts++;
    if (attempts > 10) return c.json({ error: "Failed to generate unique key" }, 500);
  } while (existing && !isExpired(existing.expiresAt));

  // Create the Durable Object
  const doId = env.ROOMS.newUniqueId();
  const r2Prefix = `rooms/${roomKey}/`;
  const stub = env.ROOMS.get(doId);

  await stub.fetch("http://internal/init", {
    method: "POST",
    body: JSON.stringify({ roomKey, expiresAt, r2Prefix }),
    headers: { "Content-Type": "application/json" },
  });

  // Register in the index
  const indexStub = getRoomIndexStub(env);
  await indexStub.fetch("http://internal/register", {
    method: "POST",
    body: JSON.stringify({ roomKey, doId: doId.toString(), expiresAt }),
    headers: { "Content-Type": "application/json" },
  });

  return c.json({ roomKey, expiresAt });
}

// GET /api/v1/rooms/:key — get room info
export async function getRoomInfo(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const stub = getRoomStub(env, entry.doId);
  const infoRes = await stub.fetch("http://internal/info");
  if (!infoRes.ok) return c.json({ error: "Room unavailable" }, 503);

  return new Response(infoRes.body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/v1/rooms/:key/join — join a room
export async function joinRoom(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  // Rate limit check
  const { success } = await env.ROOM_JOIN_RATE_LIMIT.limit({ key: c.req.raw.headers.get("CF-Connecting-IP") ?? "global" });
  if (!success) return c.json({ error: "Too many requests, please slow down" }, 429);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const body = await c.req.json<{ userId: string; displayName: string }>();

  // Get room info + initial messages from DO
  const stub = getRoomStub(env, entry.doId);
  const infoRes = await stub.fetch("http://internal/info");
  const info = await infoRes.json<Record<string, unknown>>();

  const msgsRes = await stub.fetch("http://internal/messages?fromSeq=0&limit=50");
  const msgs = await msgsRes.json<{ messages: unknown[]; hasMore: boolean; nextSeq: number }>();

  return c.json({
    roomKey: key,
    expiresAt: entry.expiresAt,
    onlineCount: info["onlineCount"] ?? 0,
    onlineUsers: info["onlineUsers"] ?? [],
    messages: msgs.messages,
    hasMoreMessages: msgs.hasMore,
    nextSeq: msgs.nextSeq,
    userId: body.userId,
    displayName: body.displayName,
  });
}

// POST /api/v1/rooms/:key/extend — extend room TTL
export async function extendRoom(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const hours = parseInt(env.ROOM_TTL_HOURS, 10);
  const stub = getRoomStub(env, entry.doId);
  const res = await stub.fetch("http://internal/extend", {
    method: "POST",
    body: JSON.stringify({ hours }),
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json<{ ok: boolean; expiresAt: number }>();

  // Update expiry in the index
  const newEntry: RoomIndexEntry = { doId: entry.doId, expiresAt: data.expiresAt };
  const indexStub = getRoomIndexStub(env);
  await indexStub.fetch("http://internal/register", {
    method: "POST",
    body: JSON.stringify({ roomKey: key, ...newEntry }),
    headers: { "Content-Type": "application/json" },
  });

  return c.json({ ok: true, expiresAt: data.expiresAt });
}

// GET /api/v1/rooms/:key/messages — paginated message history
export async function getRoomMessages(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const fromSeq = c.req.query("fromSeq") ?? "0";
  const limit = c.req.query("limit") ?? "50";

  const stub = getRoomStub(env, entry.doId);
  const res = await stub.fetch(`http://internal/messages?fromSeq=${fromSeq}&limit=${limit}`);
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

export const roomApi = new Hono<{ Bindings: Env }>();

roomApi.post("/rooms", createRoom);
roomApi.get("/rooms/:key", getRoomInfo);
roomApi.post("/rooms/:key/join", joinRoom);
roomApi.post("/rooms/:key/extend", extendRoom);
roomApi.get("/rooms/:key/messages", getRoomMessages);
