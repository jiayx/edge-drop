// room.ts — room page: WebSocket, messages, upload, presence

import { getOrCreateIdentity, updateIdentityName, type Identity } from "./identity";
import { RoomWebSocket } from "./ws";
import { uploadFile, formatFileSize, isAudioMime, isImageMime, isVideoMime } from "./upload";
import { createAudioPlayer } from "./audio";
import type { ServerMessage, Message, UserRecord, ClientMessage } from "../../worker/types";
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
let isWsConnected = false;
const MAX_AUTO_RETRY_COUNT = 3;
type SendableClientMessage = Extract<ClientMessage, { type: "msg:text" | "msg:file" }>;
type LocalOutgoingStatus = "uploading" | "upload-failed" | "pending";
type PendingOutgoingMessage = {
  tempId: string;
  kind: "text" | "file";
  optimisticMessage: Message;
  payload?: SendableClientMessage;
  autoRetryCount: number;
  status: LocalOutgoingStatus;
  file?: File;
  uploadProgress?: number;
  errorMessage?: string;
  uploadAbortController?: AbortController;
};
const pendingOutgoingMessages = new Map<string, PendingOutgoingMessage>();

// ── DOM refs ──────────────────────────────────────────────────────────────
const roomKeyEl = document.getElementById("room-key");
const countdownEl = document.getElementById("countdown");
const extendBtn = document.getElementById("extend-btn") as HTMLButtonElement | null;
const onlineCountEl = document.getElementById("online-count");
const userListEl = document.getElementById("user-list");
const mobileOnlineCountEl = document.getElementById("mobile-online-count");
const mobileUserListEl = document.getElementById("mobile-user-list");
const selfNameEl = document.getElementById("self-name");
const selfNameInput = document.getElementById("self-name-input") as HTMLInputElement | null;
const messageList = document.getElementById("message-list");
const messageInput = document.getElementById("message-input") as HTMLTextAreaElement | null;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement | null;
const attachBtn = document.getElementById("attach-btn") as HTMLButtonElement | null;
const filePickerInput = document.getElementById("file-picker") as HTMLInputElement | null;
const reconnectBanner = document.getElementById("reconnect-banner");
const topLoader = document.getElementById("top-loader");
const mobileViewport = window.matchMedia("(max-width: 640px)");
const themeToggleBtn = document.getElementById("theme-toggle-btn") as HTMLButtonElement | null;
const themeViewport = window.matchMedia("(prefers-color-scheme: dark)");

const THEME_STORAGE_KEY = "edge-drop:theme";
type ThemeMode = "light" | "dark";
type ThemePreference = "system" | ThemeMode;

messageList?.addEventListener(
  "scroll",
  () => {
    stickToBottom = isNearBottom();
  },
  { passive: true }
);

messageList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const cancelBtn = target.closest<HTMLButtonElement>(".pending-cancel-btn[data-temp-id]");
  const cancelTempId = cancelBtn?.dataset.tempId;
  if (cancelBtn && cancelTempId) {
    cancelPendingOutgoingMessage(cancelTempId);
    return;
  }
  const retryBtn = target.closest<HTMLButtonElement>(".pending-retry-btn[data-temp-id]");
  const tempId = retryBtn?.dataset.tempId;
  if (!retryBtn || !tempId) return;
  retryPendingOutgoingMessage(tempId);
});

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
  syncTheme();
  syncMessageInputPlaceholder();

  themeViewport.addEventListener("change", syncTheme);
  mobileViewport.addEventListener("change", syncMessageInputPlaceholder);

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

themeToggleBtn?.addEventListener("click", () => {
  cycleThemePreference();
});

function getStoredThemePreference(): ThemePreference {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return "system";
}

function getAppliedTheme(preference: ThemePreference): ThemeMode {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return themeViewport.matches ? "dark" : "light";
}

function getNextThemePreference(preference: ThemePreference): ThemePreference {
  switch (preference) {
    case "system":
      return "dark";
    case "dark":
      return "light";
    default:
      return "system";
  }
}

function setThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  }
  syncTheme();
}

function cycleThemePreference(): ThemePreference {
  const nextTheme = getNextThemePreference(getStoredThemePreference());
  setThemePreference(nextTheme);
  return nextTheme;
}

function syncTheme(): void {
  const preference = getStoredThemePreference();
  const theme = getAppliedTheme(preference);
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  if (!themeToggleBtn) return;
  themeToggleBtn.textContent =
    preference === "system" ? "◐" : theme === "dark" ? "☾" : "☀";
  themeToggleBtn.title = `Theme: ${
    preference === "system" ? `System (${theme})` : theme
  }. Click to switch.`;
}

function syncMessageInputPlaceholder(): void {
  if (!messageInput) return;
  messageInput.placeholder = mobileViewport.matches
    ? "Type a message..."
    : "Type a message... (Enter to send)";
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function connectWebSocket(): void {
  ws = new RoomWebSocket({
    roomKey,
    userId: identity.userId,
    displayName: identity.displayName,
    fromSeq: Math.max(0, lastSeq - 1),
    onOpen: () => {
      isWsConnected = true;
      flushPendingOutgoingMessages();
      if (reconnectBanner) reconnectBanner.style.display = "none";
    },
    onClose: () => {
      isWsConnected = false;
      if (reconnectBanner) reconnectBanner.style.display = "block";
    },
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
      if (temp) {
        temp.dataset.msgId = msg.id;
        temp.classList.remove("pending");
        temp.classList.remove("uploading", "upload-failed");
        temp.querySelector(".pending-retry-btn")?.remove();
        delete temp.dataset.tempId;
      }
      pendingOutgoingMessages.delete(msg.tempId);
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
      document
        .querySelectorAll<HTMLElement>(`[data-user-id="${msg.userId}"] .user-name`)
        .forEach((el) => { el.textContent = formatUserListName(msg.userId, msg.newName); });
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
  messageList.insertBefore(fragment, topLoader?.nextSibling ?? null);
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
  if (runInputCommand(text)) {
    if (messageInput) messageInput.value = "";
    return;
  }
  const tempId = crypto.randomUUID();
  queuePendingOutgoingMessage({
    tempId,
    kind: "text",
    optimisticMessage: createOptimisticTextMessage(text, tempId),
    payload: { type: "msg:text", content: text, tempId },
    autoRetryCount: 0,
    status: "pending",
  });
  if (messageInput) messageInput.value = "";
}

function queuePendingOutgoingMessage(pending: PendingOutgoingMessage): void {
  const tempId = pending.tempId;
  pendingOutgoingMessages.set(tempId, pending);
  syncPendingOutgoingMessageEl(tempId);
  scrollToBottom();
  if (pending.status === "pending") {
    sendPendingOutgoingMessage(tempId);
    return;
  }
  if (pending.status === "uploading") {
    void uploadPendingFileMessage(tempId);
  }
}

function cancelPendingOutgoingMessage(tempId: string): void {
  const pending = pendingOutgoingMessages.get(tempId);
  if (!pending || pending.status !== "uploading") return;
  pending.uploadAbortController?.abort();
  pendingOutgoingMessages.set(tempId, {
    ...pending,
    status: "upload-failed",
    uploadAbortController: undefined,
    errorMessage: "Upload canceled",
  });
  syncPendingOutgoingMessageEl(tempId);
}

function sendPendingOutgoingMessage(tempId: string): void {
  const pending = pendingOutgoingMessages.get(tempId);
  if (!pending || pending.status !== "pending" || !pending.payload) return;
  ws?.send(pending.payload);
  syncPendingOutgoingMessageEl(tempId);
}

function flushPendingOutgoingMessages(): void {
  if (!isWsConnected || pendingOutgoingMessages.size === 0) return;
  for (const [tempId, pending] of pendingOutgoingMessages) {
    if (pending.status !== "pending" || !pending.payload) continue;
    if (pending.autoRetryCount >= MAX_AUTO_RETRY_COUNT) {
      syncPendingOutgoingMessageEl(tempId);
      continue;
    }
    ws?.send(pending.payload);
    const autoRetryCount = pending.autoRetryCount + 1;
    pendingOutgoingMessages.set(tempId, { ...pending, autoRetryCount });
    syncPendingOutgoingMessageEl(tempId);
  }
}

function retryPendingOutgoingMessage(tempId: string): void {
  const pending = pendingOutgoingMessages.get(tempId);
  if (!pending) return;
  if (pending.status === "uploading") return;
  if (pending.status === "upload-failed") {
    pendingOutgoingMessages.set(tempId, {
      ...pending,
      autoRetryCount: 0,
      status: "uploading",
      uploadProgress: 0,
      errorMessage: undefined,
    });
    syncPendingOutgoingMessageEl(tempId);
    void uploadPendingFileMessage(tempId);
    return;
  }
  pendingOutgoingMessages.set(tempId, { ...pending, autoRetryCount: 0 });
  syncPendingOutgoingMessageEl(tempId);
  sendPendingOutgoingMessage(tempId);
}

function syncPendingOutgoingMessageEl(tempId: string): void {
  const pending = pendingOutgoingMessages.get(tempId);
  if (!pending) return;

  const nextEl = buildPendingOutgoingMessageEl(pending);
  const currentEl = document.querySelector<HTMLElement>(`[data-temp-id="${tempId}"]`);
  if (currentEl) {
    currentEl.replaceWith(nextEl);
  } else {
    messageList?.appendChild(nextEl);
  }

  if (pending.status === "pending") {
    watchVisualMediaLayout(nextEl);
    if (stickToBottom) {
      scrollToBottom();
    }
  }
}

function buildPendingOutgoingMessageEl(pending: PendingOutgoingMessage): HTMLElement {
  const el = pending.kind === "file" && pending.status !== "pending"
    ? buildPendingFileTransferEl(pending)
    : buildMessageEl(pending.optimisticMessage);

  el.dataset.tempId = pending.tempId;
  el.classList.add("pending");
  el.classList.toggle("uploading", pending.status === "uploading");
  el.classList.toggle("upload-failed", pending.status === "upload-failed");

  if (shouldShowRetryButton(pending)) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "pending-retry-btn";
    retryBtn.dataset.tempId = pending.tempId;
    retryBtn.textContent = "Retry";
    el.insertBefore(retryBtn, el.firstChild);
  }

  return el;
}

function buildPendingFileTransferEl(pending: PendingOutgoingMessage): HTMLElement {
  const progress = Math.max(0, Math.min(100, pending.uploadProgress ?? 0));
  const fileName = pending.file?.name ?? pending.optimisticMessage.fileName ?? "file";
  const fileSizeBytes = pending.file?.size ?? pending.optimisticMessage.fileSizeBytes ?? 0;
  const statusLabel = pending.status === "upload-failed"
    ? pending.errorMessage || "Upload failed"
    : `Uploading ${progress}%`;

  const el = document.createElement("div");
  el.className = "message own";
  el.dataset.msgId = pending.tempId;
  el.dataset.senderId = identity.userId;
  el.innerHTML = `
    <div class="bubble">
      <div class="bubble-meta">
        <span class="sender-name">${escHtml(identity.displayName)}</span>
        <span class="bubble-time">${new Date(pending.optimisticMessage.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}</span>
      </div>
      <div class="bubble-content">
        <div class="bubble-file pending-file-transfer">
          <span class="file-icon">⬆</span>
          <span class="file-name">${escHtml(fileName)}</span>
          <span class="file-size">(${formatFileSize(fileSizeBytes)})</span>
        </div>
        <div class="pending-upload-status">
          <div class="pending-upload-body">
            <div class="pending-upload-header">
              <span class="pending-upload-label">${escHtml(statusLabel)}</span>
            </div>
            <div class="pending-upload-track" aria-hidden="true">
              <span class="pending-upload-bar" style="width: ${progress}%"></span>
            </div>
          </div>
          ${pending.status === "uploading" ? `<button type="button" class="pending-cancel-btn" data-temp-id="${pending.tempId}">Cancel</button>` : ""}
        </div>
      </div>
    </div>`;
  return el;
}

function shouldShowRetryButton(pending: PendingOutgoingMessage): boolean {
  if (pending.status === "upload-failed") return true;
  if (pending.status !== "pending") return false;
  return pending.autoRetryCount >= MAX_AUTO_RETRY_COUNT;
}

async function uploadPendingFileMessage(tempId: string): Promise<void> {
  const pending = pendingOutgoingMessages.get(tempId);
  if (!pending || pending.kind !== "file" || !pending.file) return;
  const uploadAbortController = new AbortController();
  pendingOutgoingMessages.set(tempId, { ...pending, uploadAbortController });
  syncPendingOutgoingMessageEl(tempId);

  try {
    const result = await uploadFile({
      roomKey,
      file: pending.file,
      signal: uploadAbortController.signal,
      onProgress: (pct) => {
        const current = pendingOutgoingMessages.get(tempId);
        if (!current || current.status !== "uploading") return;
        pendingOutgoingMessages.set(tempId, { ...current, uploadProgress: pct });
        syncPendingOutgoingMessageEl(tempId);
      },
    });

    const current = pendingOutgoingMessages.get(tempId);
    if (!current || current.status !== "uploading") return;
    const nextPending: PendingOutgoingMessage = {
      ...current,
      optimisticMessage: createOptimisticFileMessage(result.objectKey, result.fileName, result.mimeType, result.sizeBytes, tempId),
      payload: {
        type: "msg:file",
        objectKey: result.objectKey,
        fileName: result.fileName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        tempId,
      },
      autoRetryCount: 0,
      status: "pending",
      uploadProgress: 100,
      errorMessage: undefined,
      uploadAbortController: undefined,
    };
    pendingOutgoingMessages.set(tempId, nextPending);
    syncPendingOutgoingMessageEl(tempId);
    sendPendingOutgoingMessage(tempId);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    const current = pendingOutgoingMessages.get(tempId);
    if (!current) return;
    pendingOutgoingMessages.set(tempId, {
      ...current,
      status: "upload-failed",
      errorMessage: message,
      uploadAbortController: undefined,
    });
    syncPendingOutgoingMessageEl(tempId);
  }
}

function runInputCommand(text: string): boolean {
  if (!text.startsWith("/")) return false;

  const [rawCommand = "", ...rest] = text.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/help":
      appendLocalSystemNotice("Available commands: /name <new name>, /theme, /help");
      return true;
    case "/theme": {
      const nextTheme = cycleThemePreference();
      const appliedTheme = getAppliedTheme(nextTheme);
      appendLocalSystemNotice(
        nextTheme === "system"
          ? `Theme set to system (${appliedTheme})`
          : `Theme set to ${appliedTheme}`
      );
      return true;
    }
    case "/name":
      if (!applyRename(arg)) {
        appendLocalSystemNotice("Usage: /name <new name>");
      }
      return true;
    default:
      appendLocalSystemNotice(`Unknown command: ${rawCommand}`);
      return true;
  }
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
    const tempId = crypto.randomUUID();
    queuePendingOutgoingMessage(createUploadingFileMessage(file, tempId));
  }
}

function createOptimisticTextMessage(text: string, tempId: string): Message {
  return {
    id: tempId,
    seq: -1,
    type: "text",
    senderId: identity.userId,
    senderName: identity.displayName,
    content: text,
    createdAt: Date.now(),
  };
}

function createUploadingFileMessage(file: File, tempId: string): PendingOutgoingMessage {
  const mimeType = file.type || "application/octet-stream";
  return {
    tempId,
    kind: "file",
    optimisticMessage: {
      id: tempId,
      seq: -1,
      type: getFileMessageType(mimeType),
      senderId: identity.userId,
      senderName: identity.displayName,
      content: "",
      fileName: file.name,
      fileMime: mimeType,
      fileSizeBytes: file.size,
      createdAt: Date.now(),
    },
    autoRetryCount: 0,
    status: "uploading",
    file,
    uploadProgress: 0,
  };
}

function createOptimisticFileMessage(
  objectKey: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  tempId: string
): Message {
  return {
    id: tempId,
    seq: -1,
    type: getFileMessageType(mimeType),
    senderId: identity.userId,
    senderName: identity.displayName,
    content: objectKey,
    fileName,
    fileMime: mimeType,
    fileSizeBytes: sizeBytes,
    createdAt: Date.now(),
  };
}

function getFileMessageType(mimeType: string): Message["type"] {
  if (isImageMime(mimeType)) return "image";
  if (isAudioMime(mimeType)) return "audio";
  if (isVideoMime(mimeType)) return "video";
  return "file";
}

// ── Presence ──────────────────────────────────────────────────────────────
function updatePresence(count: number, users: UserRecord[]): void {
  if (onlineCountEl) onlineCountEl.textContent = String(count);
  if (mobileOnlineCountEl) mobileOnlineCountEl.textContent = String(count);
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
  if (mobileUserListEl) {
    mobileUserListEl.innerHTML = users
      .map(
        (u) => `<div class="mobile-user-item" data-user-id="${u.userId}">
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
  applyRename(selfNameInput?.value ?? "");
  cancelRename();
}

function applyRename(name: string): boolean {
  const newName = name.trim().slice(0, 32);
  if (!newName || newName === identity.displayName) return false;
  identity.displayName = newName;
  updateIdentityName(roomKey, newName);
  if (selfNameEl) selfNameEl.textContent = newName;
  ws?.send({ type: "user:rename", newName });
  appendLocalSystemNotice(`Name changed to ${newName}`);
  return true;
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

function appendLocalSystemNotice(text: string): void {
  appendSystemNotice(text);
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
