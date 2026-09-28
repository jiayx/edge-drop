export const MAX_ROOM_DURATION_HOURS = 48;

export function roomTtlMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}
