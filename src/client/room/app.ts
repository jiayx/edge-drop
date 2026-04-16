import type { Message, ServerMessage } from "@/room/types";

import { createRoomDom, getRoomKey, getRoomRoot } from "./dom";
import { createRoomHeaderController } from "./header";
import { getOrCreateIdentity } from "./identity";
import {
  appendSystemNotice,
  bindMessageListScroll,
  prependMessages,
  registerScrollObserver,
  renderMessage,
  scrollToBottom,
} from "./messages";
import { createOutbox } from "./outbox";
import { setupRename, updatePresence, updateRenderedUserName } from "./presence";
import { createRoomPageState, type JoinResponse, type RoomPageContext } from "./state";
import { RoomWebSocket } from "./ws";

function lobbyUrl(params?: URLSearchParams | string): string {
  if (!params) return "/";
  const search = typeof params === "string" ? params : params.toString();
  return search ? `/?${search}` : "/";
}

async function loadMoreHistory(context: RoomPageContext): Promise<void> {
  if (!context.state.hasMore || context.state.loadingHistory) return;
  context.state.loadingHistory = true;

  const sent = context.state.ws?.send({ type: "history:request", fromSeq: 0, limit: 50 });
  if (!sent) {
    try {
      const res = await fetch(`/api/v1/rooms/${context.roomKey}/messages?fromSeq=0&limit=50`);
      const data = await res.json() as { messages: Message[]; hasMore: boolean; nextSeq: number };
      if (data.messages.length) prependMessages(context, data.messages);
      context.state.hasMore = data.hasMore;
    } finally {
      context.state.loadingHistory = false;
    }
  } else {
    setTimeout(() => {
      context.state.loadingHistory = false;
    }, 5000);
  }
}

export async function bootstrapRoomPage(): Promise<void> {
  const roomRoot = getRoomRoot();
  const roomKey = getRoomKey(roomRoot);
  const identity = getOrCreateIdentity(roomKey);
  const dom = createRoomDom();
  const state = createRoomPageState();
  const context: RoomPageContext = { roomKey, identity, dom, state };

  const header = createRoomHeaderController(context);
  bindMessageListScroll(context);

  const appendLocalSystemNotice = (text: string): void => appendSystemNotice(context, text);
  const { applyRename } = setupRename(context, appendLocalSystemNotice);
  const outbox = createOutbox(context, {
    appendLocalSystemNotice,
    cycleThemePreference: () => header.cycleThemePreference(),
    getAppliedTheme: (preference) => header.getAppliedTheme(preference),
    applyRename,
  });
  outbox.bindComposer();

  const handleServerMessage = (msg: ServerMessage): void => {
    switch (msg.type) {
      case "msg:text":
      case "msg:file":
      case "msg:system": {
        const message = msg.message;
        if (!document.querySelector(`[data-msg-id="${message.id}"]`)) {
          const keepBottomAligned = context.state.stickToBottom;
          renderMessage(context, message, keepBottomAligned);
          if (keepBottomAligned) {
            scrollToBottom(context);
          }
          if (message.seq > context.state.lastSeq) context.state.lastSeq = message.seq;
        }
        break;
      }

      case "msg:ack":
        outbox.handleAck(msg.tempId, msg.id);
        if (msg.seq > context.state.lastSeq) {
          context.state.lastSeq = msg.seq;
          context.state.ws?.updateFromSeq(context.state.lastSeq);
        }
        break;

      case "user:join":
      case "user:leave":
        updatePresence(context, msg.onlineCount, msg.onlineUsers ?? []);
        break;

      case "user:rename":
        updateRenderedUserName(context, msg.userId, msg.newName);
        break;

      case "room:presence":
        updatePresence(context, msg.onlineCount, msg.users);
        break;

      case "room:extended":
        header.setExpiresAt(msg.expiresAt);
        break;

      case "room:expiring":
        appendSystemNotice(context, `Room expires in ${msg.minutesLeft} minute(s)`);
        break;

      case "room:expired":
        appendSystemNotice(context, "Room has expired");
        context.state.ws?.close();
        setTimeout(() => {
          window.location.replace(lobbyUrl("error=expired"));
        }, 3000);
        break;

      case "history:response":
        if (msg.messages.length) prependMessages(context, msg.messages);
        if (msg.nextSeq > context.state.lastSeq) context.state.lastSeq = msg.nextSeq;
        context.state.hasMore = msg.hasMore;
        requestAnimationFrame(() => {
          context.state.loadingHistory = false;
        });
        break;

      case "error":
        appendLocalSystemNotice(msg.message);
        break;
    }
  };

  const connectWebSocket = (): void => {
    context.state.ws = new RoomWebSocket({
      roomKey: context.roomKey,
      userId: context.identity.userId,
      displayName: context.identity.displayName,
      fromSeq: Math.max(0, context.state.lastSeq - 1),
      onOpen: () => {
        context.state.isWsConnected = true;
        outbox.flushPendingOutgoingMessages();
        if (context.dom.reconnectBanner) context.dom.reconnectBanner.style.display = "none";
      },
      onClose: () => {
        context.state.isWsConnected = false;
        if (context.dom.reconnectBanner) context.dom.reconnectBanner.style.display = "block";
      },
      onMessage: handleServerMessage,
    });
  };

  const res = await fetch(`/api/v1/rooms/${context.roomKey}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: identity.userId, displayName: identity.displayName }),
  });

  if (res.status === 404) {
    window.location.replace(lobbyUrl("error=not-found"));
    return;
  }

  if (res.status === 410) {
    window.location.replace(lobbyUrl("error=expired"));
    return;
  }

  const data = await res.json() as JoinResponse;
  header.setExpiresAt(data.expiresAt);
  context.state.lastSeq = data.nextSeq ?? 0;
  context.state.hasMore = data.hasMoreMessages;
  updatePresence(context, data.onlineCount, data.onlineUsers);

  data.messages.forEach((msg) => {
    renderMessage(context, msg, true);
  });
  scrollToBottom(context);
  registerScrollObserver(context, () => {
    if (context.state.hasMore && !context.state.loadingHistory) {
      void loadMoreHistory(context);
    }
  });

  connectWebSocket();
}
