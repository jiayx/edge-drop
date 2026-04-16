import { Hono } from "hono";
import { handleScheduled } from "@/cron/cleanup";
import { errorResponse, logUnexpected } from "@/lib/errors";
import { fileApi } from "@/routes/api/files";
import { roomApi } from "@/routes/api/rooms";
import { statsApi } from "@/routes/api/stats";
import { websocketApi } from "@/routes/api/websocket";
import { pageRoutes } from "@/routes/pages";

// Re-export Durable Object classes so wrangler can find them
export { RoomObject } from "@/room/durable/RoomObject";
export { RoomIndexObject } from "@/room/durable/RoomIndexObject";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  logUnexpected("http unexpected error", err, {
    method: c.req.method,
    path: c.req.path,
  });
  return errorResponse(c);
});

app.route("/", pageRoutes);
app.route("/api/v1", roomApi);
app.route("/api/v1", fileApi);
app.route("/api/v1", websocketApi);
app.route("/api/v1", statsApi);

app.notFound((c) => c.text("Not Found", 404));

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
