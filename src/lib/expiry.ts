export const MAX_ROOM_DURATION_HOURS = 48;

export function roomTtlMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

export function minutesUntilExpiry(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 60000));
}
