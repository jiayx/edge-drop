// lobby.ts — lobby page: create or join a room
export {};

import { roomPath } from "../../router";

interface CreateRoomResponse {
  roomKey: string;
  expiresAt: number;
}

const digitInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>(".digit-input")
);
const joinBtn = document.getElementById("join-btn") as HTMLButtonElement | null;
const createBtn = document.getElementById("create-btn") as HTMLButtonElement | null;
const errorBanner = document.getElementById("error-banner") as HTMLDivElement | null;

// Auto-advance focus between digit inputs
digitInputs.forEach((input, i) => {
  input.addEventListener("input", () => {
    const val = input.value.replace(/\D/g, "");
    input.value = val.slice(-1);
    if (val && i < digitInputs.length - 1) {
      digitInputs[i + 1]?.focus();
    }
    const key = getRoomKey();
    if (key.length === 6) void joinRoom(key);
  });

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Backspace" && !input.value && i > 0) {
      digitInputs[i - 1]?.focus();
    }
  });

  input.addEventListener("paste", (e: ClipboardEvent) => {
    e.preventDefault();
    const clipData = e.clipboardData ?? (window as Window & { clipboardData?: DataTransfer }).clipboardData;
    const text = (clipData?.getData("text") ?? "").replace(/\D/g, "");
    [...text].slice(0, 6).forEach((ch, j) => {
      const target = digitInputs[j];
      if (target) target.value = ch;
    });
    const filled = text.slice(0, 6);
    if (filled.length === 6) {
      void joinRoom(filled);
    } else {
      digitInputs[Math.min(filled.length, 5)]?.focus();
    }
  });
});

joinBtn?.addEventListener("click", () => {
  const key = getRoomKey();
  if (key.length === 6) void joinRoom(key);
  else showError("Please enter a 6-digit room key");
});

createBtn?.addEventListener("click", () => {
  void (async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/rooms", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create room");
      const { roomKey } = await res.json() as CreateRoomResponse;
      window.location.assign(roomPath(roomKey));
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  })();
});

function getRoomKey(): string {
  return digitInputs.map((i) => i.value).join("");
}

async function joinRoom(key: string): Promise<void> {
  setLoading(true);
  try {
    const res = await fetch(`/api/v1/rooms/${key}`);
    if (res.status === 404) throw new Error("Room not found");
    if (res.status === 410) throw new Error("Room has expired");
    if (!res.ok) throw new Error("Failed to join room");
    window.location.assign(roomPath(key));
  } catch (err) {
    showError(err instanceof Error ? err.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

function showError(msg: string): void {
  if (errorBanner) {
    errorBanner.textContent = msg;
    errorBanner.style.display = "block";
    setTimeout(() => { errorBanner.style.display = "none"; }, 4000);
  }
}

function setLoading(on: boolean): void {
  if (joinBtn) joinBtn.disabled = on;
  if (createBtn) createBtn.disabled = on;
}

digitInputs[0]?.focus();
