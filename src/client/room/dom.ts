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
  sendBtn: HTMLButtonElement | null;
  attachBtn: HTMLButtonElement | null;
  filePickerInput: HTMLInputElement | null;
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
    sendBtn: document.getElementById("send-btn") as HTMLButtonElement | null,
    attachBtn: document.getElementById("attach-btn") as HTMLButtonElement | null,
    filePickerInput: document.getElementById("file-picker") as HTMLInputElement | null,
    reconnectBanner: document.getElementById("reconnect-banner"),
    topLoader: document.getElementById("top-loader"),
    themeToggleBtn: document.getElementById("theme-toggle-btn") as HTMLButtonElement | null,
    mobileViewport: window.matchMedia("(max-width: 640px)"),
    themeViewport: window.matchMedia("(prefers-color-scheme: dark)"),
  };
}
