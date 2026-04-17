const FALLBACK_MAX_FILE_SIZE_MB = 100;

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function getDefaultMaxFileSizeMb(env: Pick<Env, "MAX_FILE_SIZE_MB">): number {
  return parsePositiveInt(env.MAX_FILE_SIZE_MB) ?? FALLBACK_MAX_FILE_SIZE_MB;
}
