// room.ts — room page: WebSocket, messages, upload, presence

import { getOrCreateIdentity, updateIdentityName, type Identity } from "./identity";
import { RoomWebSocket } from "./ws";
import { uploadFile, formatFileSize } from "./upload";
import { createAudioPlayer } from "./audio";
import type { ServerMessage, Message, UserRecord } from "../../worker/types";
import { lobbyPath, parseAppRoute } from "../../router";

// ── Init ──────────────────────────────────────────────────────────────────
const route = parseAppRoute(location.pathname);
if (route?.name !== "room") {
  window.location.replace("/");
}
const roomKey = route?.name === "room" ? route.roomKey : "";

const identity: Identity = getOrCreateIdentity(roomKey);
let lastSeq = 0;
let hasMore = true;
let loadingHistory = false;
let ws: RoomWebSocket | null = null;
let expiresAt = 0;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let stickToBottom = true;
let bottomCorrectionFrame = 0;
let bottomCorrectionPasses = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────
const roomKeyEl = document.getElementById("room-key");
const countdownEl = document.getElementById("countdown");
const extendBtn = document.getElementById("extend-btn") as HTMLButtonElement | null;
const onlineCountEl = document.getElementById("online-count");
const userListEl = document.getElementById("user-list");
const selfNameEl = document.getElementById("self-name");
const selfNameInput = document.getElementById("self-name-input") as HTMLInputElement | null;
const messageList = document.getElementById("message-list");
const messageInput = document.getElementById("message-input") as HTMLTextAreaElement | null;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement | null;
const attachBtn = document.getElementById("attach-btn") as HTMLButtonElement | null;
const filePickerInput = document.getElementById("file-picker") as HTMLInputElement | null;
const uploadProgressEl = document.getElementById("upload-progress");
const reconnectBanner = document.getElementById("reconnect-banner");
const topLoader = document.getElementById("top-loader");

messageList?.addEventListener(
  "scroll",
  () => {
    stickToBottom = isNearBottom();
  },
  { passive: true }
);

// ── API types ─────────────────────────────────────────────────────────────
interface JoinResponse {
  roomKey: string;
  expiresAt: number;
  onlineCount: number;
  onlineUsers: UserRecord[];
  messages: Message[];
  hasMoreMessages: boolean;
  nextSeq: number;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
void (async () => {
  if (roomKeyEl) {
    roomKeyEl.textContent = roomKey;
    roomKeyEl.addEventListener("click", () => {
      void navigator.clipboard.writeText(roomKey).then(() => flash(roomKeyEl, "Copied!"));
    });
  }

  const res = await fetch(`/api/v1/rooms/${roomKey}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: identity.userId, displayName: identity.displayName }),
  });

  if (res.status === 404 || res.status === 410) {
    window.location.replace(lobbyPath("expired=1"));
    return;
  }

  const data = await res.json() as JoinResponse;
  expiresAt = data.expiresAt;
  lastSeq = data.nextSeq ?? 0;
  hasMore = data.hasMoreMessages;
  startCountdown();
  updatePresence(data.onlineCount, data.onlineUsers);

  data.messages.forEach((msg) => { renderMessage(msg, true); });
  scrollToBottom();
  registerScrollObserver();

  connectWebSocket();
})();

// ── WebSocket ─────────────────────────────────────────────────────────────
function connectWebSocket(): void {
  ws = new RoomWebSocket({
    roomKey,
    userId: identity.userId,
    displayName: identity.displayName,
    fromSeq: Math.max(0, lastSeq - 1),
    onOpen: () => { if (reconnectBanner) reconnectBanner.style.display = "none"; },
    onClose: () => { if (reconnectBanner) reconnectBanner.style.display = "block"; },
    onMessage: handleServerMessage,
  });
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "msg:text":
    case "msg:file":
    case "msg:system": {
      const m = msg.message;
      if (!document.querySelector(`[data-msg-id="${m.id}"]`)) {
        const keepBottomAligned = stickToBottom;
        renderMessage(m, keepBottomAligned);
        if (keepBottomAligned) {
          scrollToBottom();
        }
        if (m.seq > lastSeq) lastSeq = m.seq;
      }
      break;
    }

    case "msg:ack": {
      const temp = document.querySelector<HTMLElement>(`[data-temp-id="${msg.tempId}"]`);
      if (temp) temp.dataset.msgId = msg.id;
      if (msg.seq > lastSeq) {
        lastSeq = msg.seq;
        ws?.updateFromSeq(lastSeq);
      }
      break;
    }

    case "user:join":
    case "user:leave":
      updatePresence(msg.onlineCount, msg.onlineUsers ?? []);
      break;

    case "user:rename": {
      const nameEl = document.querySelector<HTMLElement>(
        `[data-user-id="${msg.userId}"] .user-name`
      );
      if (nameEl) {
        nameEl.textContent = formatUserListName(msg.userId, msg.newName);
      }
      document
        .querySelectorAll<HTMLElement>(`[data-sender-id="${msg.userId}"] .sender-name`)
        .forEach((el) => { el.textContent = msg.newName; });
      break;
    }

    case "room:presence":
      updatePresence(msg.onlineCount, msg.users);
      break;

    case "room:extended":
      expiresAt = msg.expiresAt;
      startCountdown();
      break;

    case "room:expiring":
      appendSystemNotice(`Room expires in ${msg.minutesLeft} minute(s)`);
      break;

    case "room:expired":
      appendSystemNotice("Room has expired");
      ws?.close();
      setTimeout(() => { window.location.replace(lobbyPath("expired=1")); }, 3000);
      break;

    case "history:response":
      if (msg.messages.length) prependMessages(msg.messages);
      if (msg.nextSeq > lastSeq) lastSeq = msg.nextSeq;
      hasMore = msg.hasMore;
      requestAnimationFrame(() => { loadingHistory = false; });
      break;
  }
}

// ── Message rendering ─────────────────────────────────────────────────────
function buildMessageEl(msg: Message): HTMLElement {
  const isOwn = msg.senderId === identity.userId;
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
    contentHtml = `<p class="bubble-text">${escHtml(msg.content).replace(/\n/g, "<br>")}</p>`;
  } else if (msg.type === "image") {
    const url = fileUrl(msg.content);
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
    const url = fileUrl(msg.content);
    const size = msg.fileSizeBytes != null ? ` (${formatFileSize(msg.fileSizeBytes)})` : "";
    contentHtml = `<div class="bubble-audio-wrap">
      <div class="bubble-audio" data-src="${url}"></div>
      <a class="bubble-video-download" href="${url}" download="${escHtml(msg.fileName ?? "audio")}">
        <span class="file-icon">⬇</span>
        <span class="file-name">${escHtml(msg.fileName ?? "audio")}</span>
        <span class="file-size">${size}</span>
      </a>
    </div>`;
  } else if (msg.type === "video") {
    const url = fileUrl(msg.content);
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
    const url = fileUrl(msg.content);
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

  el.querySelectorAll<HTMLElement>(".bubble-audio[data-src]").forEach((container) => {
    const src = container.dataset.src ?? "";
    createAudioPlayer(src, container);
    delete container.dataset.src;
  });

  return el;
}

function renderMessage(msg: Message, keepBottomAligned = false): void {
  const el = buildMessageEl(msg);
  messageList?.appendChild(el);
  if (keepBottomAligned) {
    watchVisualMediaLayout(el);
  }
}

function prependMessages(messages: Message[]): void {
  if (!messageList) return;
  const before = messageList.scrollHeight;
  const fragment = document.createDocumentFragment();
  for (const msg of messages) {
    fragment.prepend(buildMessageEl(msg));
  }
  messageList.insertBefore(fragment, messageList.firstChild);
  messageList.scrollTop += messageList.scrollHeight - before;
}

// ── History loading ───────────────────────────────────────────────────────
async function loadMoreHistory(): Promise<void> {
  if (!hasMore || loadingHistory) return;
  loadingHistory = true;

  const sent = ws?.send({ type: "history:request", fromSeq: 0, limit: 50 });
  if (!sent) {
    try {
      const res = await fetch(`/api/v1/rooms/${roomKey}/messages?fromSeq=0&limit=50`);
      const data = await res.json() as { messages: Message[]; hasMore: boolean; nextSeq: number };
      if (data.messages.length) prependMessages(data.messages);
      hasMore = data.hasMore;
    } finally {
      loadingHistory = false;
    }
  } else {
    setTimeout(() => { loadingHistory = false; }, 5000);
  }
}

// ── Send text ─────────────────────────────────────────────────────────────
function sendText(): void {
  const text = messageInput?.value.trim();
  if (!text) return;
  const tempId = crypto.randomUUID();

  const optimistic: Message = {
    id: tempId,
    seq: -1,
    type: "text",
    senderId: identity.userId,
    senderName: identity.displayName,
    content: text,
    createdAt: Date.now(),
  };
  const el = buildMessageEl(optimistic);
  el.dataset.tempId = tempId;
  messageList?.appendChild(el);
  scrollToBottom();

  ws?.send({ type: "msg:text", content: text, tempId });
  if (messageInput) messageInput.value = "";
}

sendBtn?.addEventListener("click", sendText);
messageInput?.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

// ── File upload ───────────────────────────────────────────────────────────
attachBtn?.addEventListener("click", () => filePickerInput?.click());

filePickerInput?.addEventListener("change", () => {
  const files = Array.from(filePickerInput?.files ?? []);
  if (!files.length) return;
  if (filePickerInput) filePickerInput.value = "";
  void handleFileUploads(files);
});

async function handleFileUploads(files: File[]): Promise<void> {
  for (const file of files) {
    if (file.size > 100 * 1024 * 1024) {
      alert(`"${file.name}" exceeds the 100 MB limit`);
      continue;
    }
    const progressItem = createProgressItem(file.name);
    uploadProgressEl?.appendChild(progressItem.el);
    try {
      const result = await uploadFile({ roomKey, file, onProgress: (pct) => progressItem.update(pct) });
      ws?.send({
        type: "msg:file",
        objectKey: result.objectKey,
        fileName: result.fileName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        tempId: crypto.randomUUID(),
      });
      progressItem.el.remove();
    } catch (err) {
      progressItem.setError(err instanceof Error ? err.message : "Upload failed");
      setTimeout(() => progressItem.el.remove(), 5000);
    }
  }
}

interface ProgressItem {
  el: HTMLElement;
  update: (pct: number) => void;
  setError: (msg: string) => void;
}

function createProgressItem(fileName: string): ProgressItem {
  const el = document.createElement("div");
  el.className = "upload-item";
  el.innerHTML = `<span class="upload-name">${escHtml(fileName)}</span><span class="upload-pct">0%</span>`;
  const pctEl = el.querySelector<HTMLElement>(".upload-pct")!;
  return {
    el,
    update(pct) { pctEl.textContent = `${pct}%`; },
    setError(msg) { pctEl.textContent = `Error: ${msg}`; el.classList.add("upload-error"); },
  };
}

// ── Presence ──────────────────────────────────────────────────────────────
function updatePresence(count: number, users: UserRecord[]): void {
  if (onlineCountEl) onlineCountEl.textContent = String(count);
  if (userListEl) {
    userListEl.innerHTML = users
      .map(
        (u) => `<div class="user-item" data-user-id="${u.userId}">
        <span class="user-avatar">${u.displayName.charAt(0).toUpperCase()}</span>
        <span class="user-name">${escHtml(formatUserListName(u.userId, u.displayName))}</span>
      </div>`
      )
      .join("");
  }
}

function formatUserListName(userId: string, displayName: string): string {
  return `${displayName}${userId === identity.userId ? " (you)" : ""}`;
}

// ── Self rename ───────────────────────────────────────────────────────────
if (selfNameEl) {
  selfNameEl.textContent = identity.displayName;
  selfNameEl.addEventListener("click", () => {
    if (selfNameInput) {
      selfNameInput.value = identity.displayName;
      selfNameInput.style.display = "inline";
      selfNameEl.style.display = "none";
      selfNameInput.focus();
    }
  });
}

selfNameInput?.addEventListener("blur", commitRename);
selfNameInput?.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") commitRename();
  if (e.key === "Escape") cancelRename();
});

function commitRename(): void {
  const newName = selfNameInput?.value.trim().slice(0, 32);
  if (newName && newName !== identity.displayName) {
    identity.displayName = newName;
    updateIdentityName(roomKey, newName);
    if (selfNameEl) selfNameEl.textContent = newName;
    ws?.send({ type: "user:rename", newName });
  }
  cancelRename();
}

function cancelRename(): void {
  if (selfNameEl) selfNameEl.style.display = "inline";
  if (selfNameInput) selfNameInput.style.display = "none";
}

// ── Extend room ───────────────────────────────────────────────────────────
extendBtn?.addEventListener("click", () => {
  void (async () => {
    if (extendBtn) extendBtn.disabled = true;
    try {
      const res = await fetch(`/api/v1/rooms/${roomKey}/extend`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to extend");
      const data = await res.json() as { ok: boolean; expiresAt: number };
      expiresAt = data.expiresAt;
      startCountdown();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to extend room");
    } finally {
      if (extendBtn) extendBtn.disabled = false;
    }
  })();
});

// ── Countdown ─────────────────────────────────────────────────────────────
function startCountdown(): void {
  if (countdownInterval) clearInterval(countdownInterval);
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 10_000);
}

function updateCountdown(): void {
  if (!expiresAt || !countdownEl) return;
  const ms = expiresAt - Date.now();
  if (ms <= 0) {
    countdownEl.textContent = "Expired";
    countdownEl.className = "countdown expired";
    return;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  countdownEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
  countdownEl.className = `countdown${ms < 1_800_000 ? " warning" : ""}`;
}

// ── Utilities ─────────────────────────────────────────────────────────────
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileUrl(objectKey: string): string {
  return `/api/v1/rooms/${roomKey}/files/${encodeURIComponent(objectKey)}`;
}

function scrollToBottom(): void {
  if (!messageList) return;
  messageList.scrollTop = messageList.scrollHeight;
  stickToBottom = true;
  scheduleBottomCorrection();
}

function scheduleBottomCorrection(passes = 1): void {
  if (!messageList || !stickToBottom) {
    bottomCorrectionPasses = 0;
    return;
  }

  bottomCorrectionPasses = Math.max(bottomCorrectionPasses, passes);
  if (bottomCorrectionFrame) return;

  const run = (): void => {
    bottomCorrectionFrame = 0;
    if (!messageList || !stickToBottom) {
      bottomCorrectionPasses = 0;
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
    bottomCorrectionPasses -= 1;

    if (bottomCorrectionPasses > 0) {
      bottomCorrectionFrame = requestAnimationFrame(run);
    }
  };

  bottomCorrectionFrame = requestAnimationFrame(run);
}

function isNearBottom(threshold = 80): boolean {
  if (!messageList) return true;
  const distance = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
  return distance <= threshold;
}

function flash(el: HTMLElement, text: string): void {
  const orig = el.textContent ?? "";
  el.textContent = text;
  setTimeout(() => { el.textContent = orig; }, 1500);
}

function appendSystemNotice(text: string): void {
  const el = document.createElement("div");
  el.className = "message system";
  el.innerHTML = `<span class="system-text">${escHtml(text)}</span>`;
  messageList?.appendChild(el);
  scrollToBottom();
}

function watchVisualMediaLayout(root: HTMLElement): void {
  const images = root.querySelectorAll<HTMLImageElement>("img");
  const videos = root.querySelectorAll<HTMLVideoElement>("video");
  if (!images.length && !videos.length) return;

  const correctBottom = (): void => {
    if (!stickToBottom) return;
    scheduleBottomCorrection(2);
  };

  images.forEach((img) => {
    img.addEventListener("load", correctBottom, { once: true });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(correctBottom);
      observer.observe(img);
      setTimeout(() => observer.disconnect(), 5000);
    }
  });

  videos.forEach((video) => {
    video.addEventListener("loadedmetadata", correctBottom, { once: true });
    video.addEventListener("loadeddata", correctBottom, { once: true });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(correctBottom);
      observer.observe(video);
      setTimeout(() => observer.disconnect(), 5000);
    }
  });
}

function registerScrollObserver(): void {
  if (!topLoader) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loadingHistory) {
        void loadMoreHistory();
      }
    },
    { threshold: 0.1 }
  );
  observer.observe(topLoader);
}
