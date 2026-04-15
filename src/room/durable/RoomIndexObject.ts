import type { RoomIndexEntry } from "@/room/types";

export class RoomIndexObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/list") {
      return this.handleList();
    }
    if (request.method === "POST" && path === "/register") {
      return this.handleRegister(request);
    }
    if (request.method === "GET" && path.startsWith("/lookup/")) {
      const key = path.slice("/lookup/".length);
      return this.handleLookup(key);
    }
    if (request.method === "DELETE" && path.startsWith("/deregister/")) {
      const key = path.slice("/deregister/".length);
      return this.handleDeregister(key);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleList(): Promise<Response> {
    const entries = await this.state.storage.list<RoomIndexEntry>({ prefix: "room:" });
    const result: Record<string, RoomIndexEntry> = {};
    for (const [k, v] of entries) {
      const roomKey = k.slice("room:".length);
      result[roomKey] = v;
    }
    return Response.json(result);
  }

  private async handleRegister(request: Request): Promise<Response> {
    const { roomKey, doId, expiresAt } = await request.json<{
      roomKey: string;
      doId: string;
      expiresAt: number;
    }>();
    const entry: RoomIndexEntry = { doId, expiresAt };
    await this.state.storage.put(`room:${roomKey}`, entry);
    return Response.json({ ok: true });
  }

  private async handleLookup(roomKey: string): Promise<Response> {
    const entry = await this.state.storage.get<RoomIndexEntry>(`room:${roomKey}`);
    if (!entry) return new Response("Not found", { status: 404 });
    return Response.json(entry);
  }

  private async handleDeregister(roomKey: string): Promise<Response> {
    await this.state.storage.delete(`room:${roomKey}`);
    return Response.json({ ok: true });
  }
}
