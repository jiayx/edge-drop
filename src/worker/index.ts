import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRoom, getRoomInfo, joinRoom, extendRoom, getRoomMessages } from "./routes/rooms";
import { uploadFile, downloadFile, deleteFile } from "./routes/files";
import { upgradeWebSocket } from "./routes/websocket";
import { getStats } from "./routes/stats";
import { handleScheduled } from "./cron/cleanup";

// Re-export Durable Object classes so wrangler can find them
export { RoomObject } from "./durable/RoomObject";
export { RoomIndexObject } from "./durable/RoomIndexObject";

const app = new Hono<{ Bindings: Env }>();

// CORS for API routes
app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

// ── API routes ─────────────────────────────────────────────────────────────
const api = app.basePath("/api/v1");

api.post("/rooms", createRoom);
api.get("/rooms/:key", getRoomInfo);
api.post("/rooms/:key/join", joinRoom);
api.post("/rooms/:key/extend", extendRoom);
api.get("/rooms/:key/messages", getRoomMessages);
api.post("/rooms/:key/files", uploadFile);
api.get("/rooms/:key/files/:objectKey{.+}", downloadFile);
api.delete("/rooms/:key/files/:objectKey{.+}", deleteFile);
api.get("/ws/:key", upgradeWebSocket);
api.get("/stats", getStats);

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
