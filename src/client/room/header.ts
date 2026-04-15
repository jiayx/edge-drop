import type { RoomPageContext, ThemeMode, ThemePreference } from "./state";
import { flash } from "./utils";

const THEME_STORAGE_KEY = "edge-drop:theme";

function getStoredThemePreference(): ThemePreference {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return "system";
}

export function getAppliedTheme(context: RoomPageContext, preference: ThemePreference): ThemeMode {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return context.dom.themeViewport.matches ? "dark" : "light";
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
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  }
  syncTheme(context);
}

export function cycleThemePreference(context: RoomPageContext): ThemePreference {
  const nextTheme = getNextThemePreference(getStoredThemePreference());
  setThemePreference(context, nextTheme);
  return nextTheme;
}

export function syncTheme(context: RoomPageContext): void {
  const preference = getStoredThemePreference();
  const theme = getAppliedTheme(context, preference);
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
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

export function startCountdown(context: RoomPageContext): void {
  if (context.state.countdownInterval) clearInterval(context.state.countdownInterval);
  updateCountdown(context);
  context.state.countdownInterval = setInterval(() => updateCountdown(context), 10_000);
}

export function setupHeader(context: RoomPageContext): void {
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
        context.state.expiresAt = data.expiresAt;
        startCountdown(context);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to extend room");
      } finally {
        if (extendBtn) extendBtn.disabled = false;
      }
    })();
  });
}
