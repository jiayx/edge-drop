import { applyThemePreference, getAppliedTheme, getStoredThemePreference } from "@/client/theme";
import { MAX_ROOM_DURATION_HOURS } from "@/lib/expiry";

import type { RoomPageContext, ThemeMode, ThemePreference } from "./state";
import { flash } from "./utils";

function buildShareUrls(roomKey: string): { roomUrl: string; qrUrl: string } {
  const roomUrl = new URL(`/room/${roomKey}`, window.location.origin).toString();
  const qrUrl = new URL("https://qr.tools.tf/image");
  qrUrl.searchParams.set("data", roomUrl);
  qrUrl.searchParams.set("size", "320");
  qrUrl.searchParams.set("margin", "10");
  qrUrl.searchParams.set("dotType", "rounded");
  qrUrl.searchParams.set("cornerSquareType", "extra-rounded");
  qrUrl.searchParams.set("cornerDotType", "dot");
  qrUrl.searchParams.set("fg", "2563eb");
  qrUrl.searchParams.set("bg", "ffffff");
  qrUrl.searchParams.set("ecl", "M");
  qrUrl.searchParams.set("gradient", "1");
  qrUrl.searchParams.set("gradientColor1", "2563eb");
  qrUrl.searchParams.set("gradientColor2", "06b6d4");
  qrUrl.searchParams.set("gradientType", "linear");
  return { roomUrl, qrUrl: qrUrl.toString() };
}

function setupRoomShare(context: RoomPageContext): void {
  const trigger = context.dom.roomKeyEl;
  const popover = context.dom.roomSharePopover;
  const qrImage = context.dom.roomShareQr;
  const copyBtn = context.dom.copyRoomLinkBtn;
  const anchor = trigger?.parentElement;

  if (!trigger || !popover || !qrImage || !(anchor instanceof HTMLElement)) return;

  const { roomUrl, qrUrl } = buildShareUrls(context.roomKey);
  qrImage.src = qrUrl;

  let touchPinnedOpen = false;
  let copyLinkTriggeredByKeyboard = false;
  let roomKeyTriggeredByKeyboard = false;

  const syncOpenState = (open: boolean): void => {
    popover.classList.toggle("visible", open);
    popover.setAttribute("aria-hidden", open ? "false" : "true");
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  };

  anchor.addEventListener("focusin", () => {
    if (!context.dom.mobileViewport.matches) {
      syncOpenState(true);
    }
  });
  anchor.addEventListener("focusout", (event) => {
    if (touchPinnedOpen || context.dom.mobileViewport.matches) return;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && anchor.contains(nextTarget)) return;
    syncOpenState(false);
  });

  anchor.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!touchPinnedOpen && !popover.classList.contains("visible")) return;
    touchPinnedOpen = false;
    syncOpenState(false);
    if (document.activeElement instanceof HTMLElement && anchor.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  });

  trigger.addEventListener("click", (event) => {
    void navigator.clipboard.writeText(context.roomKey).then(() => flash(trigger, "Copied!"));
    if (context.dom.mobileViewport.matches) {
      event.preventDefault();
      touchPinnedOpen = !touchPinnedOpen;
      syncOpenState(touchPinnedOpen);
      return;
    }
    if (!roomKeyTriggeredByKeyboard) {
      trigger.blur();
    }
    roomKeyTriggeredByKeyboard = false;
  });
  trigger.addEventListener("keydown", (event) => {
    roomKeyTriggeredByKeyboard = event.key === "Enter" || event.key === " ";
  });
  trigger.addEventListener("pointerdown", () => {
    roomKeyTriggeredByKeyboard = false;
  });

  document.addEventListener("click", (event) => {
    if (!touchPinnedOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (trigger.contains(target) || popover.contains(target)) return;
    touchPinnedOpen = false;
    syncOpenState(false);
  });

  copyBtn?.addEventListener("click", () => {
    void navigator.clipboard.writeText(roomUrl).then(() => {
      flash(copyBtn, "Copied!");
      if (!copyLinkTriggeredByKeyboard) {
        touchPinnedOpen = false;
        syncOpenState(false);
      }
      if (!context.dom.mobileViewport.matches && !copyLinkTriggeredByKeyboard) {
        copyBtn.blur();
      }
      copyLinkTriggeredByKeyboard = false;
    });
  });
  copyBtn?.addEventListener("keydown", (event) => {
    copyLinkTriggeredByKeyboard = event.key === "Enter" || event.key === " ";
  });
  copyBtn?.addEventListener("pointerdown", () => {
    copyLinkTriggeredByKeyboard = false;
  });
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

function setThemePreference(context: RoomPageContext, preference: ThemePreference): void {
  if (preference === "system") {
    localStorage.removeItem("edge-drop:theme");
  } else {
    localStorage.setItem("edge-drop:theme", preference);
  }
  syncTheme(context);
}

export function cycleThemePreference(context: RoomPageContext): ThemePreference {
  const nextTheme = getNextThemePreference(getStoredThemePreference());
  setThemePreference(context, nextTheme);
  return nextTheme;
}

function syncTheme(context: RoomPageContext): void {
  const preference = applyThemePreference(context.dom.themeViewport);
  const theme = getAppliedTheme(context.dom.themeViewport, preference);
  if (!context.dom.themeToggleBtn) return;
  context.dom.themeToggleBtn.textContent =
    preference === "system" ? "◐" : theme === "dark" ? "☾" : "☀";
  context.dom.themeToggleBtn.title = `Theme: ${
    preference === "system" ? `System (${theme})` : theme
  }. Click to switch.`;
}

export function syncMessageInputPlaceholder(context: RoomPageContext): void {
  if (!context.dom.messageInput) return;
  context.dom.messageInput.placeholder = context.dom.mobileViewport.matches
    ? "Type a message..."
    : "Type a message... (Enter to send)";
}

function updateCountdown(context: RoomPageContext): void {
  const { countdownEl } = context.dom;
  if (!context.state.expiresAt || !countdownEl) return;
  const ms = context.state.expiresAt - Date.now();
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

function startCountdown(context: RoomPageContext): void {
  if (context.state.countdownInterval) clearInterval(context.state.countdownInterval);
  updateCountdown(context);
  context.state.countdownInterval = setInterval(() => updateCountdown(context), 10_000);
}

export interface RoomHeaderController {
  cycleThemePreference: () => ThemePreference;
  getAppliedTheme: (preference: ThemePreference) => ThemeMode;
  setExpiresAt: (expiresAt: number) => void;
}

export function createRoomHeaderController(
  context: RoomPageContext,
  deps: { appendLocalSystemNotice: (text: string) => void }
): RoomHeaderController {
  const setExpiresAt = (expiresAt: number): void => {
    context.state.expiresAt = expiresAt;
    startCountdown(context);
  };

  syncTheme(context);
  syncMessageInputPlaceholder(context);

  context.dom.themeViewport.addEventListener("change", () => syncTheme(context));
  context.dom.mobileViewport.addEventListener("change", () => syncMessageInputPlaceholder(context));
  context.dom.themeToggleBtn?.addEventListener("click", () => {
    cycleThemePreference(context);
  });

  setupRoomShare(context);

  context.dom.extendBtn?.addEventListener("click", () => {
    void (async () => {
      const { extendBtn } = context.dom;
      if (extendBtn) extendBtn.disabled = true;
      try {
        const res = await fetch(`/api/v1/rooms/${context.roomKey}/extend`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to extend");
        const data = await res.json() as { ok: boolean; expiresAt: number };
        setExpiresAt(data.expiresAt);
        deps.appendLocalSystemNotice(`Room extended. Max duration: ${MAX_ROOM_DURATION_HOURS} hours.`);
      } catch (err) {
        deps.appendLocalSystemNotice(err instanceof Error ? err.message : "Failed to extend room");
      } finally {
        if (extendBtn) extendBtn.disabled = false;
      }
    })();
  });

  return {
    cycleThemePreference: () => cycleThemePreference(context),
    getAppliedTheme: (preference) =>
      getAppliedTheme(context.dom.themeViewport, preference) as ThemeMode,
    setExpiresAt,
  };
}
