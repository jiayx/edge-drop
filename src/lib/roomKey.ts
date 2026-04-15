const KEY_LENGTH = 6;

export function generateRoomKey(): string {
  const digits = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(digits);
  return Array.from(digits)
    .map((b) => b % 10)
    .join("");
}

export function isValidRoomKey(key: string): boolean {
  return /^\d{6}$/.test(key);
}
