import type { UserRecord } from "@/room/types";

import { updateIdentityName } from "./identity";
import type { RoomPageContext } from "./state";
import { escHtml } from "./utils";

function formatUserListName(context: RoomPageContext, userId: string, displayName: string): string {
  return `${displayName}${userId === context.identity.userId ? " (you)" : ""}`;
}

export function updatePresence(context: RoomPageContext, count: number, users: UserRecord[]): void {
  context.state.onlineUsers = users;
  for (const user of users) {
    context.state.knownUsers.set(user.userId, user);
  }

  const { onlineCountEl, mobileOnlineCountEl, userListEl, mobileUserListEl } = context.dom;

  if (onlineCountEl) onlineCountEl.textContent = String(count);
  if (mobileOnlineCountEl) mobileOnlineCountEl.textContent = String(count);
  if (userListEl) {
    userListEl.innerHTML = users
      .map(
        (u) => `<div class="user-item" data-user-id="${u.userId}">
        <span class="user-avatar">${u.displayName.charAt(0).toUpperCase()}</span>
        <span class="user-name">${escHtml(formatUserListName(context, u.userId, u.displayName))}</span>
      </div>`
      )
      .join("");
  }
  if (mobileUserListEl) {
    mobileUserListEl.innerHTML = users
      .map(
        (u) => `<div class="mobile-user-item" data-user-id="${u.userId}">
        <span class="user-avatar">${u.displayName.charAt(0).toUpperCase()}</span>
        <span class="user-name">${escHtml(formatUserListName(context, u.userId, u.displayName))}</span>
      </div>`
      )
      .join("");
  }
}

export function updateRenderedUserName(
  context: RoomPageContext,
  userId: string,
  displayName: string
): void {
  const knownUser = context.state.knownUsers.get(userId);
  if (knownUser) {
    context.state.knownUsers.set(userId, { ...knownUser, displayName });
  }
  context.state.onlineUsers = context.state.onlineUsers.map((user) =>
    user.userId === userId ? { ...user, displayName } : user
  );

  document
    .querySelectorAll<HTMLElement>(`[data-user-id="${userId}"] .user-name`)
    .forEach((el) => {
      el.textContent = formatUserListName(context, userId, displayName);
    });
}

export function setupRename(
  context: RoomPageContext,
  appendLocalSystemNotice: (text: string) => void
): { applyRename: (name: string) => boolean } {
  const { selfNameEl, selfNameInput } = context.dom;

  if (selfNameEl) {
    selfNameEl.textContent = context.identity.displayName;
    selfNameEl.addEventListener("click", () => {
      if (selfNameInput) {
        selfNameInput.value = context.identity.displayName;
        selfNameInput.style.display = "inline";
        selfNameEl.style.display = "none";
        selfNameInput.focus();
      }
    });
  }

  const cancelRename = (): void => {
    if (selfNameEl) selfNameEl.style.display = "inline";
    if (selfNameInput) selfNameInput.style.display = "none";
  };

  const applyRename = (name: string): boolean => {
    const newName = name.trim().slice(0, 32);
    if (!newName || newName === context.identity.displayName) return false;
    context.identity.displayName = newName;
    updateIdentityName(context.roomKey, newName);
    if (selfNameEl) selfNameEl.textContent = newName;
    context.state.ws?.send({ type: "user:rename", newName });
    appendLocalSystemNotice(`Name changed to ${newName}`);
    return true;
  };

  const commitRename = (): void => {
    applyRename(selfNameInput?.value ?? "");
    cancelRename();
  };

  selfNameInput?.addEventListener("blur", commitRename);
  selfNameInput?.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.isComposing || e.key === "Process") && e.key !== "Escape") return;
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") cancelRename();
  });

  return { applyRename };
}
