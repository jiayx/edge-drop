import { formatFileSize } from "@/client/file";
import type { Message } from "@/room/types";

import { renderTextWithMentions } from "./mention";
import type { RoomPageContext } from "./state";
import { escHtml } from "./utils";

function fileUrl(roomKey: string, objectKey: string): string {
  return `/api/v1/rooms/${roomKey}/files/${encodeURIComponent(objectKey)}`;
}

export function isNearBottom(context: RoomPageContext, threshold = 80): boolean {
  const { messageList } = context.dom;
  if (!messageList) return true;
  const distance = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
  return distance <= threshold;
}

export function scheduleBottomCorrection(context: RoomPageContext, passes = 1, force = false): void {
  const { messageList } = context.dom;
  const { state } = context;
  if (!messageList || (!state.stickToBottom && !force)) {
    state.bottomCorrectionPasses = 0;
    state.bottomCorrectionForced = false;
    return;
  }

  state.bottomCorrectionPasses = Math.max(state.bottomCorrectionPasses, passes);
  state.bottomCorrectionForced = state.bottomCorrectionForced || force;
  if (state.bottomCorrectionFrame) return;

  const run = (): void => {
    state.bottomCorrectionFrame = 0;
    if (!messageList || (!state.stickToBottom && !state.bottomCorrectionForced)) {
      state.bottomCorrectionPasses = 0;
      state.bottomCorrectionForced = false;
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
    state.bottomCorrectionPasses -= 1;

    if (state.bottomCorrectionPasses > 0) {
      state.bottomCorrectionFrame = requestAnimationFrame(run);
      return;
    }

    state.bottomCorrectionForced = false;
  };

  state.bottomCorrectionFrame = requestAnimationFrame(run);
}

export function scrollToBottom(context: RoomPageContext): void {
  const { messageList } = context.dom;
  if (!messageList) return;
  messageList.scrollTop = messageList.scrollHeight;
  context.state.stickToBottom = true;
  scheduleBottomCorrection(context);
}

export function watchVisualMediaLayout(
  context: RoomPageContext,
  root: HTMLElement,
  keepBottomAligned: boolean
): void {
  const images = root.querySelectorAll<HTMLImageElement>("img");
  const videos = root.querySelectorAll<HTMLVideoElement>("video");
  if (!images.length && !videos.length) return;

  const correctBottom = (): void => {
    if (!keepBottomAligned) return;
    scheduleBottomCorrection(context, 2, true);
  };

  let stableTimer: number | null = null;
  let maxLifetimeTimer: number | null = null;
  let disconnected = false;
  const disconnectObserver = (observer: ResizeObserver): void => {
    if (disconnected) return;
    disconnected = true;
    observer.disconnect();
    if (stableTimer != null) {
      window.clearTimeout(stableTimer);
      stableTimer = null;
    }
    if (maxLifetimeTimer != null) {
      window.clearTimeout(maxLifetimeTimer);
      maxLifetimeTimer = null;
    }
  };

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      correctBottom();
      if (stableTimer != null) {
        window.clearTimeout(stableTimer);
      }
      stableTimer = window.setTimeout(() => {
        stableTimer = null;
        disconnectObserver(observer);
      }, 240);
    });
    observer.observe(root);
    maxLifetimeTimer = window.setTimeout(() => disconnectObserver(observer), 2000);
  }

  images.forEach((img) => {
    img.addEventListener("load", correctBottom, { once: true });
  });

  videos.forEach((video) => {
    video.addEventListener("loadedmetadata", correctBottom, { once: true });
    video.addEventListener("loadeddata", correctBottom, { once: true });
  });
}

export function buildMessageEl(context: RoomPageContext, msg: Message): HTMLElement {
  const isOwn = msg.senderId === context.identity.userId;
  const el = document.createElement("div");
  el.className = `message${isOwn ? " own" : ""}${msg.type === "system" ? " system" : ""}`;
  el.dataset.msgId = msg.id;
  el.dataset.senderId = msg.senderId;

  if (msg.type === "system") {
    el.innerHTML = `<span class="system-text">${escHtml(msg.content)}</span>`;
    return el;
  }

  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  let contentHtml: string;
  if (msg.type === "text") {
    contentHtml = `<p class="bubble-text">${renderTextWithMentions(context, msg.content, msg.senderId)}</p>`;
  } else if (msg.type === "image") {
    const url = fileUrl(context.roomKey, msg.content);
    const size = msg.fileSizeBytes != null ? ` (${formatFileSize(msg.fileSizeBytes)})` : "";
    contentHtml = `<div class="bubble-image">
      <a href="${url}" target="_blank"><img class="bubble-img" src="${url}" alt="${escHtml(msg.fileName ?? "image")}" loading="lazy"></a>
      <a class="bubble-video-download" href="${url}" download="${escHtml(msg.fileName ?? "image")}">
        <span class="file-icon">⬇</span>
        <span class="file-name">${escHtml(msg.fileName ?? "image")}</span>
        <span class="file-size">${size}</span>
      </a>
    </div>`;
  } else if (msg.type === "audio") {
    const url = fileUrl(context.roomKey, msg.content);
    const size = msg.fileSizeBytes != null ? ` (${formatFileSize(msg.fileSizeBytes)})` : "";
    contentHtml = `<div class="bubble-audio-wrap">
      <audio class="bubble-audio" controls preload="none" src="${url}" style="width:100%;max-width:320px"></audio>
      <a class="bubble-video-download" href="${url}" download="${escHtml(msg.fileName ?? "audio")}">
        <span class="file-icon">⬇</span>
        <span class="file-name">${escHtml(msg.fileName ?? "audio")}</span>
        <span class="file-size">${size}</span>
      </a>
    </div>`;
  } else if (msg.type === "video") {
    const url = fileUrl(context.roomKey, msg.content);
    const size = msg.fileSizeBytes != null ? ` (${formatFileSize(msg.fileSizeBytes)})` : "";
    contentHtml = `<div class="bubble-video">
      <video class="bubble-video-player" src="${url}" controls preload="metadata"></video>
      <a class="bubble-video-download" href="${url}" download="${escHtml(msg.fileName ?? "video")}">
        <span class="file-icon">⬇</span>
        <span class="file-name">${escHtml(msg.fileName ?? "video")}</span>
        <span class="file-size">${size}</span>
      </a>
    </div>`;
  } else {
    const url = fileUrl(context.roomKey, msg.content);
    const size = msg.fileSizeBytes != null ? ` (${formatFileSize(msg.fileSizeBytes)})` : "";
    contentHtml = `<a class="bubble-file" href="${url}" download="${escHtml(msg.fileName ?? "file")}">
      <span class="file-icon">📎</span>
      <span class="file-name">${escHtml(msg.fileName ?? "file")}</span>
      <span class="file-size">${size}</span>
    </a>`;
  }

  el.innerHTML = `
    <div class="bubble">
      <div class="bubble-meta">
        <span class="sender-name">${escHtml(msg.senderName)}</span>
        <span class="bubble-time">${time}</span>
      </div>
      <div class="bubble-content">${contentHtml}</div>
    </div>`;

  return el;
}

export function renderMessage(context: RoomPageContext, msg: Message, keepBottomAligned = false): void {
  const el = buildMessageEl(context, msg);
  context.dom.messageList?.appendChild(el);
  if (keepBottomAligned) {
    watchVisualMediaLayout(context, el, keepBottomAligned);
  }
}

export function prependMessages(context: RoomPageContext, messages: Message[]): void {
  const { messageList, topLoader } = context.dom;
  if (!messageList) return;
  const before = messageList.scrollHeight;
  const fragment = document.createDocumentFragment();
  for (const msg of messages) {
    fragment.append(buildMessageEl(context, msg));
  }
  messageList.insertBefore(fragment, topLoader?.nextSibling ?? null);
  messageList.scrollTop += messageList.scrollHeight - before;
}

export function appendSystemNotice(context: RoomPageContext, text: string): void {
  const el = document.createElement("div");
  el.className = "message system";
  el.innerHTML = `<span class="system-text">${escHtml(text)}</span>`;
  context.dom.messageList?.appendChild(el);
  scrollToBottom(context);
}

export function bindMessageListScroll(context: RoomPageContext): void {
  context.dom.messageList?.addEventListener(
    "scroll",
    () => {
      context.state.stickToBottom = isNearBottom(context);
    },
    { passive: true }
  );
}

export function registerScrollObserver(context: RoomPageContext, onIntersect: () => void): void {
  const { topLoader } = context.dom;
  if (!topLoader) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        onIntersect();
      }
    },
    { threshold: 0.1 }
  );
  observer.observe(topLoader);
}
