import { Context, Hono } from "hono";
import { Script } from "vite-ssr-components/hono";
import { Layout } from "@/views/Layout";
import { LobbyPage } from "@/views/LobbyPage";
import { RoomPage } from "@/views/RoomPage";
import { lookupRoom } from "@/room/store";
import { isExpired } from "@/lib/expiry";

export function renderLobby(c: Context<{ Bindings: Env }>): Response | Promise<Response> {
  const error = c.req.query("error");
  return c.html(<LobbyDocument error={error === "expired" || error === "not-found" ? error : undefined} />);
}

export async function renderRoom(c: Context<{ Bindings: Env }>): Promise<Response> {
  const roomKey = c.req.param("key");
  if (!roomKey || !/^\d{6}$/.test(roomKey)) {
    return c.redirect("/?error=not-found");
  }

  const entry = await lookupRoom(c.env, roomKey);
  if (!entry) {
    return c.redirect("/?error=not-found");
  }
  if (isExpired(entry.expiresAt)) {
    return c.redirect("/?error=expired");
  }

  return c.html(<RoomDocument roomKey={roomKey} />);
}

function LobbyDocument(props: { error?: "expired" | "not-found" }) {
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

function RoomDocument(props: { roomKey: string }) {
  return (
    <Layout
      title={`Room ${props.roomKey} — Edge Drop`}
      description={`Join room ${props.roomKey} on Edge Drop for temporary file sharing and simple chat.`}
    >
      <div id="app">
        <RoomPage roomKey={props.roomKey} />
      </div>
      <Script src="/src/client/room.ts" />
    </Layout>
  );
}

export const pageRoutes = new Hono<{ Bindings: Env }>();

pageRoutes.get("/", renderLobby);
pageRoutes.get("/room/:key", renderRoom);
