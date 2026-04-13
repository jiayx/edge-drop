import type { Context } from "hono";
import { isValidRoomKey } from "../lib/roomKey";
import { isExpired } from "../lib/expiry";
import { lookupRoom, getRoomStub } from "./rooms";

// GET /api/v1/ws/:key — WebSocket upgrade
export async function upgradeWebSocket(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = c.req.param("key") ?? "";

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const stub = getRoomStub(env, entry.doId);

  // Forward the full request (including WS upgrade headers) to the DO
  const url = new URL(c.req.url);
  return stub.fetch(`http://internal/ws${url.search}`, c.req.raw);
}
