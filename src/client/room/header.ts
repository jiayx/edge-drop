import { applyThemePreference, getAppliedTheme, getStoredThemePreference } from "@/client/theme";
import { MAX_ROOM_DURATION_HOURS } from "@/lib/expiry";

import type { RoomPageContext, ThemeMode, ThemePreference } from "./state";
import { flash } from "./utils";

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

  if (context.dom.roomKeyEl) {
    context.dom.roomKeyEl.textContent = context.roomKey;
    context.dom.roomKeyEl.addEventListener("click", () => {
      void navigator.clipboard.writeText(context.roomKey).then(() => flash(context.dom.roomKeyEl!, "Copied!"));
    });
  }

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
