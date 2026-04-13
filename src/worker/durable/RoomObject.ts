import type {
  RoomMeta,
  UserRecord,
  Message,
  MessageType,
  ClientMessage,
  ServerMessage,
} from "../types";

const MSG_KEY_PAD = 10;

function seqKey(seq: number): string {
  return `msg:${String(seq).padStart(MSG_KEY_PAD, "0")}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export class RoomObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Auto-respond to ping without waking the DO
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }

    switch (path) {
      case "/init":    return this.handleInit(request);
      case "/extend":  return this.handleExtend(request);
      case "/info":    return this.handleInfo();
      case "/messages": return this.handleGetMessages(url);
      case "/expire":  return this.handleExpire();
      case "/purge":   return this.handlePurge();
      default:         return new Response("Not found", { status: 404 });
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta || Date.now() > meta.expiresAt) {
      return new Response("Room expired", { status: 410 });
    }

    const userId = url.searchParams.get("userId") ?? newId();
    const fromSeq = parseInt(url.searchParams.get("fromSeq") ?? "0", 10);
    const hadOnlineUser = this.hasOnlineUser(userId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server, [userId]);

    // Update user presence
    await this.upsertUser(userId, url.searchParams.get("displayName") ?? `User-${userId.slice(0, 4)}`);

    // Send missed messages + presence on connect
    const missedMessages = await this.loadMessages(fromSeq + 1, 100);
    const allUsers = await this.getUsers();
    const onlineUsers = await this.getOnlineUsers();
    const onlineCount = onlineUsers.length;

    const historyMsg: ServerMessage = {
      type: "history:response",
      messages: missedMessages.messages,
      hasMore: missedMessages.hasMore,
      nextSeq: missedMessages.nextSeq,
    };
    server.send(JSON.stringify(historyMsg));

    const presenceMsg: ServerMessage = {
      type: "room:presence",
      users: onlineUsers,
      onlineCount,
    };
    server.send(JSON.stringify(presenceMsg));

    // Broadcast join to others
    const user = allUsers[userId];
    if (user && !hadOnlineUser) {
      const joinMsg: ServerMessage = {
        type: "user:join",
        userId,
        displayName: user.displayName,
        onlineCount,
        onlineUsers,
      };
      this.broadcast(joinMsg, server);
    }

    // Schedule expiry warning if room expires in <60 min
    const minsLeft = Math.floor((meta.expiresAt - Date.now()) / 60000);
    if (minsLeft <= 60 && minsLeft > 0) {
      const warn: ServerMessage = { type: "room:expiring", minutesLeft: minsLeft };
      server.send(JSON.stringify(warn));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const tags = this.state.getTags(ws);
    const userId = tags[0] ?? "";

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    // Check room still active
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta || Date.now() > meta.expiresAt) {
      const expired: ServerMessage = { type: "room:expired" };
      ws.send(JSON.stringify(expired));
      ws.close(1001, "Room expired");
      return;
    }

    switch (parsed.type) {
      case "msg:text":
        await this.persistAndBroadcastMessage(userId, "text", parsed.content, parsed.tempId, ws);
        break;

      case "msg:file": {
        const mimeType = parsed.mimeType ?? "";
        const msgType: MessageType = mimeType.startsWith("image/")
          ? "image"
          : mimeType.startsWith("audio/")
          ? "audio"
          : "file";
        await this.persistAndBroadcastMessage(
          userId,
          msgType,
          parsed.objectKey,
          parsed.tempId,
          ws,
          { fileName: parsed.fileName, fileMime: mimeType, fileSizeBytes: parsed.sizeBytes }
        );
        break;
      }

      case "user:rename": {
        const users = await this.getUsers();
        const user = users[userId];
        if (user) {
          user.displayName = parsed.newName.slice(0, 32);
          await this.state.storage.put("users", users);
          const renameMsg: ServerMessage = { type: "user:rename", userId, newName: user.displayName };
          this.broadcastAll(renameMsg);
        }
        break;
      }

      case "history:request": {
        const result = await this.loadMessages(parsed.fromSeq, Math.min(parsed.limit, 100));
        const resp: ServerMessage = {
          type: "history:response",
          messages: result.messages,
          hasMore: result.hasMore,
          nextSeq: result.nextSeq,
        };
        ws.send(JSON.stringify(resp));
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const tags = this.state.getTags(ws);
    const userId = tags[0] ?? "";
    const hadOtherSocketsForUser = this.hasOnlineUser(userId, ws);

    const users = await this.getUsers();
    const user = users[userId];
    if (user) {
      user.lastSeenAt = Date.now();
      await this.state.storage.put("users", users);
    }

    const onlineSockets = this.state.getWebSockets().filter((s) => s !== ws);
    const onlineUsers = await this.getOnlineUsersFromSockets(onlineSockets);
    if (hadOtherSocketsForUser) {
      return;
    }

    const leaveMsg: ServerMessage = {
      type: "user:leave",
      userId,
      onlineCount: onlineUsers.length,
      onlineUsers,
    };
    this.broadcast(leaveMsg, ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error", error);
  }

  // ── Internal REST handlers ────────────────────────────────────────────────

  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json<{ roomKey: string; expiresAt: number; r2Prefix: string }>();
    await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get<RoomMeta>("meta");
      if (!existing) {
        const meta: RoomMeta = {
          roomKey: body.roomKey,
          createdAt: Date.now(),
          expiresAt: body.expiresAt,
          r2Prefix: body.r2Prefix,
          status: "active",
        };
        await this.state.storage.put("meta", meta);
        await this.state.storage.put("users", {} as Record<string, UserRecord>);
        await this.state.storage.put("msg:count", 0);
        // Persist a system message
        await this.appendSystemMessage(`Room ${body.roomKey} created`);
      }
    });
    return Response.json({ ok: true });
  }

  private async handleExtend(request: Request): Promise<Response> {
    const { hours } = await request.json<{ hours: number }>();
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return new Response("Room not initialized", { status: 400 });
    meta.expiresAt = Date.now() + hours * 60 * 60 * 1000;
    await this.state.storage.put("meta", meta);

    await this.appendSystemMessage(`Room extended by ${hours} hour(s)`);

    const extendMsg: ServerMessage = { type: "room:extended", expiresAt: meta.expiresAt };
    this.broadcastAll(extendMsg);

    return Response.json({ ok: true, expiresAt: meta.expiresAt });
  }

  private async handleInfo(): Promise<Response> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return new Response("Not found", { status: 404 });
    const onlineUsers = await this.getOnlineUsers();
    return Response.json({ ...meta, onlineCount: onlineUsers.length, onlineUsers });
  }

  private async handleGetMessages(url: URL): Promise<Response> {
    const fromSeq = parseInt(url.searchParams.get("fromSeq") ?? "0", 10);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
    const result = await this.loadMessages(fromSeq, limit);
    return Response.json(result);
  }

  private async handleExpire(): Promise<Response> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return Response.json({ ok: true });
    if (meta.status === "cleaning") return new Response("Already cleaning", { status: 409 });
    meta.status = "cleaning";
    await this.state.storage.put("meta", meta);

    // Notify all connected clients
    const expiredMsg: ServerMessage = { type: "room:expired" };
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(JSON.stringify(expiredMsg));
        ws.close(1001, "Room expired");
      } catch { /* ignore */ }
    }

    return Response.json({ ok: true });
  }

  private async handlePurge(): Promise<Response> {
    await this.state.storage.deleteAll();
    return Response.json({ ok: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getUsers(): Promise<Record<string, UserRecord>> {
    return (await this.state.storage.get<Record<string, UserRecord>>("users")) ?? {};
  }

  private async getOnlineUsers(): Promise<UserRecord[]> {
    return this.getOnlineUsersFromSockets(this.state.getWebSockets());
  }

  private hasOnlineUser(userId: string, exclude?: WebSocket): boolean {
    return this.state.getWebSockets().some((ws) => {
      if (ws === exclude) return false;
      return this.state.getTags(ws)[0] === userId;
    });
  }

  private async getOnlineUsersFromSockets(sockets: WebSocket[]): Promise<UserRecord[]> {
    const users = await this.getUsers();
    const seen = new Set<string>();
    const onlineUsers: UserRecord[] = [];

    for (const ws of sockets) {
      const userId = this.state.getTags(ws)[0] ?? "";
      if (!userId || seen.has(userId)) continue;
      const user = users[userId];
      if (!user) continue;
      seen.add(userId);
      onlineUsers.push(user);
    }

    return onlineUsers;
  }

  private async upsertUser(userId: string, displayName: string): Promise<UserRecord> {
    const users = await this.getUsers();
    if (!users[userId]) {
      users[userId] = { userId, displayName, joinedAt: Date.now(), lastSeenAt: Date.now() };
    } else {
      users[userId].lastSeenAt = Date.now();
    }
    await this.state.storage.put("users", users);
    return users[userId]!;
  }

  private async persistAndBroadcastMessage(
    userId: string,
    type: MessageType,
    content: string,
    tempId: string,
    senderWs: WebSocket,
    extra?: { fileName?: string; fileMime?: string; fileSizeBytes?: number }
  ): Promise<void> {
    const users = await this.getUsers();
    const user = users[userId];
    const senderName = user?.displayName ?? "Unknown";

    const count = ((await this.state.storage.get<number>("msg:count")) ?? 0) + 1;
    const msg: Message = {
      id: newId(),
      seq: count,
      type,
      senderId: userId,
      senderName,
      content,
      createdAt: Date.now(),
      ...extra,
    };

    await this.state.storage.put(seqKey(count), msg);
    await this.state.storage.put("msg:count", count);

    const ack: ServerMessage = { type: "msg:ack", tempId, seq: count, id: msg.id };
    senderWs.send(JSON.stringify(ack));

    const broadcast: ServerMessage = {
      type: type === "text" ? "msg:text" : type === "image" || type === "audio" ? "msg:file" : "msg:file",
      message: msg,
    };
    this.broadcastAll(broadcast);
  }

  private async appendSystemMessage(content: string): Promise<void> {
    const count = ((await this.state.storage.get<number>("msg:count")) ?? 0) + 1;
    const msg: Message = {
      id: newId(),
      seq: count,
      type: "system",
      senderId: "system",
      senderName: "System",
      content,
      createdAt: Date.now(),
    };
    await this.state.storage.put(seqKey(count), msg);
    await this.state.storage.put("msg:count", count);

    const broadcast: ServerMessage = { type: "msg:system", message: msg };
    this.broadcastAll(broadcast);
  }

  private async loadMessages(
    fromSeq: number,
    limit: number
  ): Promise<{ messages: Message[]; hasMore: boolean; nextSeq: number }> {
    const startKey = seqKey(fromSeq);
    const entries = await this.state.storage.list<Message>({
      prefix: "msg:",
      start: startKey,
      limit: limit + 1,
    });

    const messages: Message[] = [];
    for (const [key, v] of entries) {
      if (key === "msg:count") continue;
      if (!this.isMessage(v)) continue;
      if (messages.length < limit) messages.push(v);
    }

    const hasMore = entries.size > limit;
    const lastMsg = messages[messages.length - 1];
    const nextSeq = lastMsg ? lastMsg.seq + 1 : fromSeq;

    return { messages, hasMore, nextSeq };
  }

  private isMessage(value: unknown): value is Message {
    if (typeof value !== "object" || value === null) return false;
    const message = value as Partial<Message>;
    return typeof message.id === "string" && typeof message.seq === "number" && typeof message.type === "string";
  }

  private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
    const json = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude) {
        try { ws.send(json); } catch { /* ignore disconnected */ }
      }
    }
  }

  private broadcastAll(msg: ServerMessage): void {
    this.broadcast(msg, undefined);
  }
}
