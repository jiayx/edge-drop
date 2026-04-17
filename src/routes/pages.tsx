import { Context, Hono } from "hono";
import { Script } from "vite-ssr-components/hono";
import { Layout } from "@/views/Layout";
import { AdminLayout } from "@/views/AdminLayout";
import { LobbyPage } from "@/views/LobbyPage";
import { RoomPage } from "@/views/RoomPage";
import { AdminPage } from "@/views/AdminPage";
import { getDefaultMaxFileSizeMb, parsePositiveInt } from "@/lib/fileSize";
import { getRoomStub, lookupRoom } from "@/room/store";
import { isExpired } from "@/lib/expiry";

export function renderLobby(c: Context<{ Bindings: Env }>): Response | Promise<Response> {
  const error = c.req.query("error");
  return c.html(<LobbyDocument error={error === "unavailable" ? error : undefined} />);
}

export async function renderRoom(c: Context<{ Bindings: Env }>): Promise<Response> {
  const roomKey = c.req.param("key");
  if (!roomKey || !/^\d{6}$/.test(roomKey)) {
    return c.redirect("/?error=unavailable");
  }

  const entry = await lookupRoom(c.env, roomKey);
  if (!entry) {
    return c.redirect("/?error=unavailable");
  }
  if (isExpired(entry.expiresAt)) {
    return c.redirect("/?error=unavailable");
  }

  const roomStub = getRoomStub(c.env, entry.doId);
  const roomInfoRes = await roomStub.fetch("http://internal/info");
  if (!roomInfoRes.ok) {
    return c.redirect("/?error=unavailable");
  }
  const roomInfo = await roomInfoRes.json<{ maxFileSizeMb?: unknown }>();
  const maxFileSizeMb = parsePositiveInt(roomInfo.maxFileSizeMb) ?? getDefaultMaxFileSizeMb(c.env);

  return c.html(<RoomDocument roomKey={roomKey} maxFileSizeMb={maxFileSizeMb} />);
}

function LobbyDocument(props: { error?: "unavailable" }) {
  return (
    <Layout
      title="Edge Drop"
      description="Edge Drop is a temporary room for fast file sharing and simple chat. No registration required."
    >
      <div id="app">
        <LobbyPage error={props.error} />
      </div>
      <Script src="/src/client/lobby.ts" />
    </Layout>
  );
}

function RoomDocument(props: { roomKey: string; maxFileSizeMb: number }) {
  return (
    <Layout
      title={`Room ${props.roomKey} — Edge Drop`}
      description={`Join room ${props.roomKey} on Edge Drop for temporary file sharing and simple chat.`}
    >
      <div id="app">
        <RoomPage roomKey={props.roomKey} maxFileSizeMb={props.maxFileSizeMb} />
      </div>
      <Script src="/src/client/room.ts" />
    </Layout>
  );
}

function AdminDocument() {
  return (
    <AdminLayout
      title="Admin Dashboard — Edge Drop"
      description="Edge Drop admin dashboard for managing rooms and monitoring system status."
    >
      <div id="app">
        <AdminPage />
      </div>
      <Script src="/src/client/admin.ts" />
    </AdminLayout>
  );
}

export function renderAdmin(c: Context<{ Bindings: Env }>): Response | Promise<Response> {
  return c.html(<AdminDocument />);
}

export const pageRoutes = new Hono<{ Bindings: Env }>();

pageRoutes.get("/", renderLobby);
pageRoutes.get("/room/:key", renderRoom);
pageRoutes.get("/admin", renderAdmin);
