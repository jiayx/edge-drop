import { isValidRoomKey } from "@/lib/roomKey";
import type { RoomIndexEntry } from "@/room/types";
import { logUnexpected } from "@/lib/errors";

export class RoomIndexObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "POST" && path.startsWith("/probe/")) {
        return this.handleProbe(path.slice("/probe/".length));
      }
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
    } catch (err) {
      logUnexpected("room index durable object unexpected error", err, {
        method: request.method,
        path,
      });
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // These records live in per-IP objects, separate from the global room index.
  // Persist and serialize admission so parallel requests or object restarts cannot
  // reset the budget. Repeated activity in an admitted room does not consume it.
  private async handleProbe(roomKey: string): Promise<Response> {
    if (!isValidRoomKey(roomKey)) return new Response("Invalid room key", { status: 400 });
    return this.state.storage.transaction(async (storage) => {
      const now = Date.now();
      const stored = await storage.get<Array<{ key: string; expiresAt: number }>>("probes") ?? [];
      const probes = stored.filter((probe) => probe.expiresAt > now);
      if (probes.some((probe) => probe.key === roomKey)) return new Response(null, { status: 204 });
      if (probes.length >= 10) {
        const retryAfter = Math.max(1, Math.ceil((Math.min(...probes.map((p) => p.expiresAt)) - now) / 1000));
        return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter) } });
      }
      probes.push({ key: roomKey, expiresAt: now + 60_000 });
      await storage.put("probes", probes);
      await storage.setAlarm(Math.min(...probes.map((probe) => probe.expiresAt)));
      return new Response(null, { status: 204 });
    });
  }

  async alarm(): Promise<void> {
    await this.state.storage.transaction(async (storage) => {
      const probes = (await storage.get<Array<{ key: string; expiresAt: number }>>("probes") ?? [])
        .filter((probe) => probe.expiresAt > Date.now());
      if (probes.length) {
        await storage.put("probes", probes);
        await storage.setAlarm(Math.min(...probes.map((probe) => probe.expiresAt)));
      } else {
        await storage.delete("probes");
      }
    });
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
