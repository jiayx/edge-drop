import type { Message, ServerMessage } from "@/room/types";

import { createRoomDom, getRoomKey, getRoomMaxFileSizeMb, getRoomRoot } from "./dom";
import { createRoomHeaderController } from "./header";
import { getOrCreateIdentity } from "./identity";
import { createMentionController } from "./mention";
import {
  appendSystemNotice,
  bindMessageListScroll,
  prependMessages,
  registerScrollObserver,
  renderMessage,
  scrollToBottom,
} from "./messages";
import { createRoomNotificationController } from "./notifications";
import { createOutbox } from "./outbox";
import { setupRename, updatePresence, updateRenderedUserName } from "./presence";
import { createRoomPageState, type JoinResponse, type RoomPageContext } from "./state";
import { RoomWebSocket } from "./ws";

function lobbyUrl(params?: URLSearchParams | string): string {
  if (!params) return "/";
  const search = typeof params === "string" ? params : params.toString();
  return search ? `/?${search}` : "/";
}

function syncLastSeq(context: RoomPageContext, seq: number): void {
  if (seq <= context.state.lastSeq) return;
  context.state.lastSeq = seq;
  context.state.ws?.updateFromSeq(seq);
}

function syncOldestSeq(context: RoomPageContext, seq: number): void {
  if (seq <= 0) return;
  if (context.state.oldestSeq === 0 || seq < context.state.oldestSeq) {
    context.state.oldestSeq = seq;
  }
}

function setTopLoaderState(context: RoomPageContext, text = "", visible = false): void {
  if (!context.dom.topLoader) return;
  context.dom.topLoader.dataset.label = text;
  context.dom.topLoader.classList.toggle("visible", visible);
}

function clearTopLoaderHideTimer(context: RoomPageContext): void {
  if (context.state.topLoaderHideTimer == null) return;
  window.clearTimeout(context.state.topLoaderHideTimer);
  context.state.topLoaderHideTimer = null;
}

function resetTopLoaderState(context: RoomPageContext): void {
  clearTopLoaderHideTimer(context);
  setTopLoaderState(context);
}

function showTopLoaderMessage(context: RoomPageContext, text: string, durationMs = 1600): void {
  clearTopLoaderHideTimer(context);
  setTopLoaderState(context, text, true);
  context.state.topLoaderHideTimer = window.setTimeout(() => {
    context.state.topLoaderHideTimer = null;
    if (!context.state.loadingHistory) {
      setTopLoaderState(context);
    }
  }, durationMs);
}

async function loadMoreHistory(context: RoomPageContext): Promise<void> {
  if (context.state.loadingHistory) return;
  if (!context.state.hasMore) {
    showTopLoaderMessage(context, "No earlier messages");
    return;
  }
  if (context.state.oldestSeq <= 1) {
    context.state.hasMore = false;
    showTopLoaderMessage(context, "No earlier messages");
    return;
  }
  context.state.loadingHistory = true;
  resetTopLoaderState(context);
  setTopLoaderState(context, "Loading earlier messages...", true);

  const sent = context.state.ws?.send({
    type: "history:request",
    beforeSeq: context.state.oldestSeq,
    limit: 50,
  });
  if (!sent) {
    let hasMore = true;
    try {
      const res = await fetch(
        `/api/v1/rooms/${context.roomKey}/messages?beforeSeq=${context.state.oldestSeq}&limit=50`
      );
      const data = await res.json() as { messages: Message[]; hasMore: boolean; nextSeq: number };
      const unseen = data.messages.filter((message) => !document.querySelector(`[data-msg-id="${message.id}"]`));
      if (unseen.length) {
        prependMessages(context, unseen);
        syncOldestSeq(context, unseen[0]?.seq ?? 0);
      }
      context.state.hasMore = data.hasMore;
      hasMore = data.hasMore;
    } finally {
      context.state.loadingHistory = false;
      if (hasMore) {
        resetTopLoaderState(context);
      } else {
        showTopLoaderMessage(context, "No earlier messages");
      }
    }
  } else {
    setTimeout(() => {
      context.state.loadingHistory = false;
      resetTopLoaderState(context);
    }, 5000);
  }
}

export async function bootstrapRoomPage(): Promise<void> {
  const roomRoot = getRoomRoot();
  const roomKey = getRoomKey(roomRoot);
  const maxFileSizeMb = getRoomMaxFileSizeMb(roomRoot);
  const identity = getOrCreateIdentity(roomKey);
  const dom = createRoomDom();
  const state = createRoomPageState();
  const context: RoomPageContext = {
    roomKey,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxFileSizeLabel: `${maxFileSizeMb} MB`,
    identity,
    dom,
    state,
  };

  const appendLocalSystemNotice = (text: string): void => appendSystemNotice(context, text);
  const header = createRoomHeaderController(context, { appendLocalSystemNotice });
  bindMessageListScroll(context);

  const { applyRename } = setupRename(context, appendLocalSystemNotice);
  const mentionController = createMentionController(context);
  const notificationController = createRoomNotificationController(context);
  const outbox = createOutbox(context, {
    appendLocalSystemNotice,
    cycleThemePreference: () => header.cycleThemePreference(),
    getAppliedTheme: (preference) => header.getAppliedTheme(preference),
    applyRename,
    handleMentionKeydown: (event) => mentionController.handleKeydown(event),
    syncMentionMenu: () => mentionController.syncMenu(),
  });
  outbox.bindComposer();
  mentionController.bind();
  notificationController.bind();

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
          syncLastSeq(context, message.seq);
          void notificationController.notifyMention(message);
        }
        break;
      }

      case "msg:ack":
        outbox.handleAck(msg.tempId, msg.id);
        syncLastSeq(context, msg.seq);
        break;

      case "user:join":
      case "user:leave":
        updatePresence(context, msg.onlineCount, msg.onlineUsers ?? []);
        mentionController.syncMenu();
        break;

      case "user:rename":
        updateRenderedUserName(context, msg.userId, msg.newName);
        mentionController.syncMenu();
        break;

      case "room:presence":
        updatePresence(context, msg.onlineCount, msg.users);
        mentionController.syncMenu();
        break;

      case "room:extended":
        header.setExpiresAt(msg.expiresAt);
        break;

      case "room:config-updated":
        context.maxFileSizeBytes = msg.maxFileSizeMb * 1024 * 1024;
        context.maxFileSizeLabel = `${msg.maxFileSizeMb} MB`;
        appendLocalSystemNotice(`File size limit updated to ${context.maxFileSizeLabel}`);
        break;

      case "room:expiring":
        appendSystemNotice(context, `Room expires in ${msg.minutesLeft} minute(s)`);
        break;

      case "room:expired":
        appendSystemNotice(context, "Room has expired");
        context.state.ws?.close();
        setTimeout(() => {
          window.location.replace(lobbyUrl("error=unavailable"));
        }, 3000);
        break;

      case "history:response":
        if (context.state.loadingHistory) {
          const unseen = msg.messages.filter((message) => !document.querySelector(`[data-msg-id="${message.id}"]`));
          if (unseen.length) {
            prependMessages(context, unseen);
            syncOldestSeq(context, unseen[0]?.seq ?? 0);
          }
          context.state.hasMore = msg.hasMore;
        }
        context.state.loadingHistory = false;
        if (msg.hasMore) {
          resetTopLoaderState(context);
        } else {
          showTopLoaderMessage(context, "No earlier messages");
        }
        break;

      case "missed:response": {
        const keepBottomAligned = context.state.stickToBottom;
        for (const missedMessage of msg.messages) {
          if (document.querySelector(`[data-msg-id="${missedMessage.id}"]`)) continue;
          renderMessage(context, missedMessage, keepBottomAligned);
        }
        if (keepBottomAligned && msg.messages.length) {
          scrollToBottom(context);
        }
        const lastMissedSeq = msg.messages[msg.messages.length - 1]?.seq ?? 0;
        if (lastMissedSeq > 0) {
          syncLastSeq(context, lastMissedSeq);
        }
        break;
      }

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
      fromSeq: Math.max(0, context.state.lastSeq),
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
    window.location.replace(lobbyUrl("error=unavailable"));
    return;
  }

  const data = await res.json() as JoinResponse;
  header.setExpiresAt(data.expiresAt);
  context.state.lastSeq = data.messages[data.messages.length - 1]?.seq ?? 0;
  context.state.ws?.updateFromSeq(context.state.lastSeq);
  context.state.oldestSeq = data.messages[0]?.seq ?? 0;
  context.state.hasMore = data.hasMoreMessages;
  updatePresence(context, data.onlineCount, data.onlineUsers);

  data.messages.forEach((msg) => {
    renderMessage(context, msg, true);
  });
  scrollToBottom(context);
  registerScrollObserver(context, () => {
    if (!context.state.loadingHistory) {
      void loadMoreHistory(context);
    }
  });

  connectWebSocket();
}
