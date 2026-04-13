// identity.ts — manages per-room anonymous identity in localStorage

const ADJECTIVES = ["Swift","Lazy","Bright","Calm","Bold","Shy","Cool","Warm","Dark","Wild"] as const;
const ANIMALS = ["Fox","Bear","Wolf","Owl","Hawk","Deer","Lynx","Seal","Crow","Hare"] as const;

export interface Identity {
  userId: string;
  displayName: string;
}

function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${animal}${num}`;
}

export function getOrCreateIdentity(roomKey: string): Identity {
  const storageKey = `edge-drop:${roomKey}:identity`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.userId && parsed.displayName) {
        return { userId: parsed.userId, displayName: parsed.displayName };
      }
    }
  } catch { /* ignore */ }

  const identity: Identity = {
    userId: crypto.randomUUID(),
    displayName: generateName(),
  };
  localStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

export function updateIdentityName(roomKey: string, newName: string): void {
  const storageKey = `edge-drop:${roomKey}:identity`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const identity = JSON.parse(raw) as Identity;
      identity.displayName = newName;
      localStorage.setItem(storageKey, JSON.stringify(identity));
    }
  } catch { /* ignore */ }
}

