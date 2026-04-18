export interface RoomDom {
  roomKeyEl: HTMLElement | null;
  countdownEl: HTMLElement | null;
  extendBtn: HTMLButtonElement | null;
  onlineCountEl: HTMLElement | null;
  userListEl: HTMLElement | null;
  mobileOnlineCountEl: HTMLElement | null;
  mobileUserListEl: HTMLElement | null;
  selfNameEl: HTMLElement | null;
  selfNameInput: HTMLInputElement | null;
  messageList: HTMLElement | null;
  messageInput: HTMLTextAreaElement | null;
  composerWrap: HTMLElement | null;
  mentionMenu: HTMLElement | null;
  sendBtn: HTMLButtonElement | null;
  attachBtn: HTMLButtonElement | null;
  filePickerInput: HTMLInputElement | null;
  fileDropOverlay: HTMLElement | null;
  pasteConfirmModal: HTMLElement | null;
  pasteConfirmBackdrop: HTMLElement | null;
  pasteConfirmPreview: HTMLElement | null;
  pasteConfirmSummary: HTMLElement | null;
  pasteConfirmCancelBtn: HTMLButtonElement | null;
  pasteConfirmSendBtn: HTMLButtonElement | null;
  reconnectBanner: HTMLElement | null;
  topLoader: HTMLElement | null;
  themeToggleBtn: HTMLButtonElement | null;
  mobileViewport: MediaQueryList;
  themeViewport: MediaQueryList;
}

export function getRoomRoot(): HTMLElement {
  const roomRoot = document.getElementById("room-page");
  if (!(roomRoot instanceof HTMLElement)) {
    throw new Error("Missing #room-page root");
  }
  return roomRoot;
}

export function getRoomKey(roomRoot: HTMLElement): string {
  const roomKey = roomRoot.dataset.roomKey ?? "";
  if (!roomKey) {
    throw new Error("Missing room key on #room-page");
  }
  return roomKey;
}

export function getRoomMaxFileSizeMb(roomRoot: HTMLElement): number {
  const rawValue = roomRoot.dataset.maxFileSizeMb ?? "";
  const maxFileSizeMb = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
    return 100;
  }
  return maxFileSizeMb;
}

export function createRoomDom(): RoomDom {
  return {
    roomKeyEl: document.getElementById("room-key"),
    countdownEl: document.getElementById("countdown"),
    extendBtn: document.getElementById("extend-btn") as HTMLButtonElement | null,
    onlineCountEl: document.getElementById("online-count"),
    userListEl: document.getElementById("user-list"),
    mobileOnlineCountEl: document.getElementById("mobile-online-count"),
    mobileUserListEl: document.getElementById("mobile-user-list"),
    selfNameEl: document.getElementById("self-name"),
    selfNameInput: document.getElementById("self-name-input") as HTMLInputElement | null,
    messageList: document.getElementById("message-list"),
    messageInput: document.getElementById("message-input") as HTMLTextAreaElement | null,
    composerWrap: document.getElementById("composer-wrap"),
    mentionMenu: document.getElementById("mention-menu"),
    sendBtn: document.getElementById("send-btn") as HTMLButtonElement | null,
    attachBtn: document.getElementById("attach-btn") as HTMLButtonElement | null,
    filePickerInput: document.getElementById("file-picker") as HTMLInputElement | null,
    fileDropOverlay: document.getElementById("file-drop-overlay"),
    pasteConfirmModal: document.getElementById("paste-confirm-modal"),
    pasteConfirmBackdrop: document.getElementById("paste-confirm-backdrop"),
    pasteConfirmPreview: document.getElementById("paste-confirm-preview"),
    pasteConfirmSummary: document.getElementById("paste-confirm-summary"),
    pasteConfirmCancelBtn: document.getElementById("paste-confirm-cancel") as HTMLButtonElement | null,
    pasteConfirmSendBtn: document.getElementById("paste-confirm-send") as HTMLButtonElement | null,
    reconnectBanner: document.getElementById("reconnect-banner"),
    topLoader: document.getElementById("top-loader"),
    themeToggleBtn: document.getElementById("theme-toggle-btn") as HTMLButtonElement | null,
    mobileViewport: window.matchMedia("(max-width: 640px)"),
    themeViewport: window.matchMedia("(prefers-color-scheme: dark)"),
  };
}
