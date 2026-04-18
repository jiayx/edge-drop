import { formatFileSize, isAudioMime, isImageMime, isVideoMime } from "@/client/file";
import { uploadFile } from "@/client/upload";
import type { Message } from "@/room/types";

import { buildMessageEl, scrollToBottom, watchVisualMediaLayout } from "./messages";
import type { PendingOutgoingMessage, RoomPageContext } from "./state";
import { escHtml } from "./utils";

const MAX_AUTO_RETRY_COUNT = 3;

interface OutboxDeps {
  appendLocalSystemNotice: (text: string) => void;
  cycleThemePreference: () => import("./state").ThemePreference;
  getAppliedTheme: (preference: import("./state").ThemePreference) => import("./state").ThemeMode;
  applyRename: (name: string) => boolean;
  handleMentionKeydown: (event: KeyboardEvent) => boolean;
  syncMentionMenu: () => void;
}

function getFileMessageType(mimeType: string): Message["type"] {
  if (isImageMime(mimeType)) return "image";
  if (isAudioMime(mimeType)) return "audio";
  if (isVideoMime(mimeType)) return "video";
  return "file";
}

function createOptimisticTextMessage(context: RoomPageContext, text: string, tempId: string): Message {
  return {
    id: tempId,
    seq: -1,
    type: "text",
    senderId: context.identity.userId,
    senderName: context.identity.displayName,
    content: text,
    createdAt: Date.now(),
  };
}

function createUploadingFileMessage(
  context: RoomPageContext,
  file: File,
  tempId: string
): PendingOutgoingMessage {
  const mimeType = file.type || "application/octet-stream";
  return {
    tempId,
    kind: "file",
    optimisticMessage: {
      id: tempId,
      seq: -1,
      type: getFileMessageType(mimeType),
      senderId: context.identity.userId,
      senderName: context.identity.displayName,
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
  context: RoomPageContext,
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
    senderId: context.identity.userId,
    senderName: context.identity.displayName,
    content: objectKey,
    fileName,
    fileMime: mimeType,
    fileSizeBytes: sizeBytes,
    createdAt: Date.now(),
  };
}

function shouldShowRetryButton(pending: PendingOutgoingMessage): boolean {
  if (pending.status === "upload-failed") return true;
  if (pending.status !== "pending") return false;
  return pending.autoRetryCount >= MAX_AUTO_RETRY_COUNT;
}

function buildPendingFileTransferEl(context: RoomPageContext, pending: PendingOutgoingMessage): HTMLElement {
  const progress = Math.max(0, Math.min(100, pending.uploadProgress ?? 0));
  const fileName = pending.file?.name ?? pending.optimisticMessage.fileName ?? "file";
  const fileSizeBytes = pending.file?.size ?? pending.optimisticMessage.fileSizeBytes ?? 0;
  const statusLabel = pending.status === "upload-failed"
    ? pending.errorMessage || "Upload failed"
    : `Uploading ${progress}%`;

  const el = document.createElement("div");
  el.className = "message own";
  el.dataset.msgId = pending.tempId;
  el.dataset.senderId = context.identity.userId;
  el.innerHTML = `
    <div class="bubble">
      <div class="bubble-meta">
        <span class="sender-name">${escHtml(context.identity.displayName)}</span>
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

function buildPendingOutgoingMessageEl(
  context: RoomPageContext,
  pending: PendingOutgoingMessage
): HTMLElement {
  const el = pending.kind === "file" && pending.status !== "pending"
    ? buildPendingFileTransferEl(context, pending)
    : buildMessageEl(context, pending.optimisticMessage);

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

export function createOutbox(context: RoomPageContext, deps: OutboxDeps) {
  let pastedFiles: File[] = [];
  let pastedPreviewUrl: string | null = null;
  let dragDepth = 0;

  const syncPendingOutgoingMessageEl = (tempId: string): void => {
    const pending = context.state.pendingOutgoingMessages.get(tempId);
    if (!pending) return;

    const nextEl = buildPendingOutgoingMessageEl(context, pending);
    const currentEl = document.querySelector<HTMLElement>(`[data-temp-id="${tempId}"]`);
    if (currentEl) {
      currentEl.replaceWith(nextEl);
    } else {
      context.dom.messageList?.appendChild(nextEl);
    }

    if (pending.status === "pending") {
      watchVisualMediaLayout(context, nextEl);
      if (context.state.stickToBottom) {
        scrollToBottom(context);
      }
    }
  };

  const sendPendingOutgoingMessage = (tempId: string): void => {
    const pending = context.state.pendingOutgoingMessages.get(tempId);
    if (!pending || pending.status !== "pending" || !pending.payload) return;
    context.state.ws?.send(pending.payload);
    syncPendingOutgoingMessageEl(tempId);
  };

  const uploadPendingFileMessage = async (tempId: string): Promise<void> => {
    const pending = context.state.pendingOutgoingMessages.get(tempId);
    if (!pending || pending.kind !== "file" || !pending.file) return;
    const uploadAbortController = new AbortController();
    context.state.pendingOutgoingMessages.set(tempId, { ...pending, uploadAbortController });
    syncPendingOutgoingMessageEl(tempId);

    try {
      const result = await uploadFile({
        roomKey: context.roomKey,
        file: pending.file,
        signal: uploadAbortController.signal,
        onProgress: (pct) => {
          const current = context.state.pendingOutgoingMessages.get(tempId);
          if (!current || current.status !== "uploading") return;
          context.state.pendingOutgoingMessages.set(tempId, { ...current, uploadProgress: pct });
          syncPendingOutgoingMessageEl(tempId);
        },
      });

      const current = context.state.pendingOutgoingMessages.get(tempId);
      if (!current || current.status !== "uploading") return;
      const nextPending: PendingOutgoingMessage = {
        ...current,
        optimisticMessage: createOptimisticFileMessage(
          context,
          result.objectKey,
          result.fileName,
          result.mimeType,
          result.sizeBytes,
          tempId
        ),
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
      context.state.pendingOutgoingMessages.set(tempId, nextPending);
      syncPendingOutgoingMessageEl(tempId);
      sendPendingOutgoingMessage(tempId);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : "Upload failed";
      const current = context.state.pendingOutgoingMessages.get(tempId);
      if (!current) return;
      context.state.pendingOutgoingMessages.set(tempId, {
        ...current,
        status: "upload-failed",
        errorMessage: message,
        uploadAbortController: undefined,
      });
      syncPendingOutgoingMessageEl(tempId);
    }
  };

  const queuePendingOutgoingMessage = (pending: PendingOutgoingMessage): void => {
    const tempId = pending.tempId;
    context.state.pendingOutgoingMessages.set(tempId, pending);
    syncPendingOutgoingMessageEl(tempId);
    scrollToBottom(context);
    if (pending.status === "pending") {
      sendPendingOutgoingMessage(tempId);
      return;
    }
    if (pending.status === "uploading") {
      void uploadPendingFileMessage(tempId);
    }
  };

  const cancelPendingOutgoingMessage = (tempId: string): void => {
    const pending = context.state.pendingOutgoingMessages.get(tempId);
    if (!pending || pending.status !== "uploading") return;
    pending.uploadAbortController?.abort();
    context.state.pendingOutgoingMessages.set(tempId, {
      ...pending,
      status: "upload-failed",
      uploadAbortController: undefined,
      errorMessage: "Upload canceled",
    });
    syncPendingOutgoingMessageEl(tempId);
  };

  const retryPendingOutgoingMessage = (tempId: string): void => {
    const pending = context.state.pendingOutgoingMessages.get(tempId);
    if (!pending) return;
    if (pending.status === "uploading") return;
    if (pending.status === "upload-failed") {
      context.state.pendingOutgoingMessages.set(tempId, {
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
    context.state.pendingOutgoingMessages.set(tempId, { ...pending, autoRetryCount: 0 });
    syncPendingOutgoingMessageEl(tempId);
    sendPendingOutgoingMessage(tempId);
  };

  const flushPendingOutgoingMessages = (): void => {
    if (!context.state.isWsConnected || context.state.pendingOutgoingMessages.size === 0) return;
    for (const [tempId, pending] of context.state.pendingOutgoingMessages) {
      if (pending.status !== "pending" || !pending.payload) continue;
      if (pending.autoRetryCount >= MAX_AUTO_RETRY_COUNT) {
        syncPendingOutgoingMessageEl(tempId);
        continue;
      }
      context.state.ws?.send(pending.payload);
      context.state.pendingOutgoingMessages.set(tempId, {
        ...pending,
        autoRetryCount: pending.autoRetryCount + 1,
      });
      syncPendingOutgoingMessageEl(tempId);
    }
  };

  const runInputCommand = (text: string): boolean => {
    if (!text.startsWith("/")) return false;

    const [rawCommand = "", ...rest] = text.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(" ").trim();

    switch (command) {
      case "/help":
        deps.appendLocalSystemNotice("Available commands: /name <new name>, /theme, /help");
        return true;
      case "/theme": {
        const nextTheme = deps.cycleThemePreference();
        const appliedTheme = deps.getAppliedTheme(nextTheme);
        deps.appendLocalSystemNotice(
          nextTheme === "system"
            ? `Theme set to system (${appliedTheme})`
            : `Theme set to ${appliedTheme}`
        );
        return true;
      }
      case "/name":
        if (!deps.applyRename(arg)) {
          deps.appendLocalSystemNotice("Usage: /name <new name>");
        }
        return true;
      default:
        deps.appendLocalSystemNotice(`Unknown command: ${rawCommand}`);
        return true;
    }
  };

  const sendText = (): void => {
    const text = context.dom.messageInput?.value.trim();
    if (!text) return;
    if (runInputCommand(text)) {
      if (context.dom.messageInput) context.dom.messageInput.value = "";
      return;
    }
    const tempId = crypto.randomUUID();
    queuePendingOutgoingMessage({
      tempId,
      kind: "text",
      optimisticMessage: createOptimisticTextMessage(context, text, tempId),
      payload: { type: "msg:text", content: text, tempId },
      autoRetryCount: 0,
      status: "pending",
    });
    if (context.dom.messageInput) context.dom.messageInput.value = "";
  };

  const handleFileUploads = async (files: File[]): Promise<void> => {
    for (const file of files) {
      if (file.size > context.maxFileSizeBytes) {
        deps.appendLocalSystemNotice(`"${file.name}" exceeds the ${context.maxFileSizeLabel} limit`);
        continue;
      }
      const tempId = crypto.randomUUID();
      queuePendingOutgoingMessage(createUploadingFileMessage(context, file, tempId));
    }
  };

  const clearPastePreview = (): void => {
    if (pastedPreviewUrl) {
      URL.revokeObjectURL(pastedPreviewUrl);
      pastedPreviewUrl = null;
    }
    pastedFiles = [];
    if (context.dom.pasteConfirmPreview) {
      context.dom.pasteConfirmPreview.innerHTML = "";
      context.dom.pasteConfirmPreview.style.display = "none";
    }
    if (context.dom.pasteConfirmSummary) {
      context.dom.pasteConfirmSummary.textContent = "";
    }
  };

  const isPasteConfirmOpen = (): boolean => context.dom.pasteConfirmModal?.style.display === "flex";
  const hasDraggedFiles = (dataTransfer: DataTransfer | null | undefined): boolean =>
    Array.from(dataTransfer?.types ?? []).includes("Files");

  const setFileDropOverlayVisible = (visible: boolean): void => {
    context.dom.fileDropOverlay?.classList.toggle("visible", visible);
  };

  const closePasteConfirm = (): void => {
    context.dom.pasteConfirmModal?.setAttribute("style", "display:none");
    clearPastePreview();
    context.dom.messageInput?.focus();
  };

  const openPasteConfirm = (files: File[]): void => {
    pastedFiles = files;
    const [firstFile] = files;
    if (!firstFile) return;
    if (context.dom.pasteConfirmSummary) {
      const extra = files.length > 1 ? ` and ${files.length - 1} more file(s)` : "";
      context.dom.pasteConfirmSummary.textContent = `Send ${firstFile.name}${extra}?`;
    }
    if (context.dom.pasteConfirmPreview) {
      context.dom.pasteConfirmPreview.innerHTML = "";
      if (firstFile && isImageMime(firstFile.type)) {
        pastedPreviewUrl = URL.createObjectURL(firstFile);
        const img = document.createElement("img");
        img.src = pastedPreviewUrl;
        img.alt = firstFile.name;
        img.className = "paste-confirm-image";
        context.dom.pasteConfirmPreview.appendChild(img);
        context.dom.pasteConfirmPreview.style.display = "block";
      } else {
        context.dom.pasteConfirmPreview.style.display = "none";
      }
    }
    context.dom.pasteConfirmModal?.setAttribute("style", "display:flex");
    context.dom.pasteConfirmCancelBtn?.focus();
  };

  const bindFileDrop = (): void => {
    document.addEventListener("dragenter", (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer) || isPasteConfirmOpen()) return;
      dragDepth += 1;
      setFileDropOverlayVisible(true);
    });

    document.addEventListener("dragover", (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer) || isPasteConfirmOpen()) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setFileDropOverlayVisible(true);
    });

    document.addEventListener("dragleave", (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer) || isPasteConfirmOpen()) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 || event.relatedTarget === null) {
        dragDepth = 0;
        setFileDropOverlayVisible(false);
      }
    });

    document.addEventListener("drop", (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer) || isPasteConfirmOpen()) return;
      event.preventDefault();
      dragDepth = 0;
      setFileDropOverlayVisible(false);
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.size > 0);
      if (!files.length) return;
      void handleFileUploads(files);
    });
  };

  const bindComposer = (): void => {
    context.dom.sendBtn?.addEventListener("click", sendText);
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isPasteConfirmOpen()) return;
      e.preventDefault();
      closePasteConfirm();
    });
    context.dom.messageInput?.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.isComposing || e.key === "Process") && e.key !== "Escape") return;
      if (deps.handleMentionKeydown(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    });
    context.dom.messageInput?.addEventListener("focus", deps.syncMentionMenu);
    context.dom.messageInput?.addEventListener("paste", (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((file) => file.size > 0);
      if (!files.length) return;
      e.preventDefault();
      openPasteConfirm(files);
    });

    context.dom.attachBtn?.addEventListener("click", () => context.dom.filePickerInput?.click());
    context.dom.filePickerInput?.addEventListener("change", () => {
      const files = Array.from(context.dom.filePickerInput?.files ?? []);
      if (!files.length) return;
      if (context.dom.filePickerInput) context.dom.filePickerInput.value = "";
      void handleFileUploads(files);
    });
    context.dom.pasteConfirmBackdrop?.addEventListener("click", closePasteConfirm);
    context.dom.pasteConfirmCancelBtn?.addEventListener("click", closePasteConfirm);
    context.dom.pasteConfirmSendBtn?.addEventListener("click", () => {
      const files = pastedFiles;
      closePasteConfirm();
      void handleFileUploads(files);
    });
    bindFileDrop();

    context.dom.messageList?.addEventListener("click", (event) => {
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
  };

  const handleAck = (tempId: string, id: string): void => {
    const temp = document.querySelector<HTMLElement>(`[data-temp-id="${tempId}"]`);
    if (temp) {
      temp.dataset.msgId = id;
      temp.classList.remove("pending");
      temp.classList.remove("uploading", "upload-failed");
      temp.querySelector(".pending-retry-btn")?.remove();
      delete temp.dataset.tempId;
    }
    context.state.pendingOutgoingMessages.delete(tempId);
  };

  return {
    bindComposer,
    flushPendingOutgoingMessages,
    handleAck,
  };
}
