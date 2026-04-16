import type { Context } from "hono";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function logUnexpected(label: string, err: unknown, extra?: Record<string, unknown>): void {
  console.error(`[edge-drop] ${label}`, {
    message: errorMessage(err),
    ...(extra ?? {}),
    err,
  });
}

export function errorResponse(c: Context<{ Bindings: Env }>): Response {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Internal server error" }, 500);
  }
  return c.text("Internal Server Error", 500);
}
