import type { Message } from "@/room/types";

import { textMentionsDisplayName } from "./mention";
import type { RoomPageContext } from "./state";

function isDocumentVisible(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function canUseBrowserNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function createRoomNotificationController(context: RoomPageContext) {
  let activeNotification: Notification | null = null;

  const closeActiveNotification = (): void => {
    activeNotification?.close();
    activeNotification = null;
  };

  const requestPermissionIfNeeded = async (): Promise<NotificationPermission> => {
    if (!canUseBrowserNotifications()) return "denied";
    if (Notification.permission !== "default") return Notification.permission;

    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  };

  const notifyMention = async (message: Message): Promise<void> => {
    if (message.type !== "text") return;
    if (message.senderId === context.identity.userId) return;
    if (isDocumentVisible()) return;
    if (!textMentionsDisplayName(message.content, context.identity.displayName)) return;

    const permission = await requestPermissionIfNeeded();
    if (permission !== "granted") return;

    closeActiveNotification();
    const notification = new Notification(`${message.senderName} mentioned you`, {
      body: message.content,
      tag: `room:${context.roomKey}:mention`,
    });
    notification.onclick = () => {
      window.focus();
      closeActiveNotification();
    };
    activeNotification = notification;
  };

  const bind = (): void => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        closeActiveNotification();
      }
    });
    window.addEventListener("focus", closeActiveNotification);
  };

  return {
    bind,
    notifyMention,
  };
}
