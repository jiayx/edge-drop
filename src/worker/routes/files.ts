import type { Context } from "hono";
import { isValidRoomKey } from "../lib/roomKey";
import { isExpired } from "../lib/expiry";
import { putObject, getObject, deleteObjects } from "../lib/r2";
import { lookupRoom } from "./rooms";

function param(c: Context<{ Bindings: Env }>, name: string): string {
  return c.req.param(name) ?? "";
}

const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".sh", ".cmd", ".msi", ".dll", ".scr", ".com", ".pif"]);
const MAX_OBJECT_KEY_LEN = 512;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\s]/g, "_").slice(0, 200);
}

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

function buildDownloadFileName(objectKey: string): string {
  const raw = objectKey.split("/").pop() ?? "file";
  const dash = raw.indexOf("-");
  return dash >= 0 ? raw.slice(dash + 1) : raw;
}

// POST /api/v1/rooms/:key/files
export async function uploadFile(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  const fileNameHeader = c.req.header("X-File-Name");
  const sizeHeader = c.req.header("X-File-Size");
  const mimeType = c.req.header("Content-Type") || "application/octet-stream";

  if (!fileNameHeader || !sizeHeader) {
    return c.json({ error: "Missing upload metadata" }, 400);
  }

  const fileName = decodeURIComponent(fileNameHeader);
  const sizeBytes = Number(sizeHeader);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return c.json({ error: "Invalid file size" }, 400);
  }

  // Validate size
  const maxBytes = parseInt(env.MAX_FILE_SIZE_MB, 10) * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return c.json({ error: `File exceeds maximum size of ${env.MAX_FILE_SIZE_MB} MB` }, 400);
  }

  // Validate MIME type
  const blocked = env.BLOCKED_MIME_TYPES.split(",");
  if (blocked.some((b) => mimeType.startsWith(b.trim()))) {
    return c.json({ error: "File type not allowed" }, 400);
  }

  // Validate extension as extra safeguard
  const ext = getExtension(fileName);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return c.json({ error: "File extension not allowed" }, 400);
  }

  // Build object key using timestamp for ordering
  const ts = Date.now();
  const safe = sanitizeFileName(fileName);
  const objectKey = `rooms/${key}/${ts}-${safe}`;

  if (objectKey.length > MAX_OBJECT_KEY_LEN) {
    return c.json({ error: "File name too long" }, 400);
  }

  await putObject(env, objectKey, c.req.raw.body, {
    contentType: mimeType,
    contentDisposition: `inline; filename="${sanitizeHeaderValue(safe)}"`,
    customMetadata: {
      originalFileName: fileName,
    },
  });

  return c.json({ objectKey });
}

// GET /api/v1/rooms/:key/files/:objectKey — stream file from R2 through Worker
export async function downloadFile(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");
  const rawObjectKey = param(c, "objectKey");

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);
  if (isExpired(entry.expiresAt)) return c.json({ error: "Room expired" }, 410);

  // The objectKey path segment is URL-encoded; decode it
  const objectKey = decodeURIComponent(rawObjectKey);

  // Ensure the object belongs to this room
  if (!objectKey.startsWith(`rooms/${key}/`)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const object = await getObject(env, objectKey);
  if (!object) {
    return c.json({ error: "File not found" }, 404);
  }

  const fileName = object.customMetadata?.originalFileName || buildDownloadFileName(objectKey);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  headers.set("cache-control", "private, max-age=60");
  headers.set("content-disposition", `inline; filename="${sanitizeHeaderValue(fileName)}"`);

  return new Response(object.body, { status: 200, headers });
}

// DELETE /api/v1/rooms/:key/files/:objectKey
export async function deleteFile(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const key = param(c, "key");
  const objectKey = decodeURIComponent(param(c, "objectKey"));

  if (!isValidRoomKey(key)) return c.json({ error: "Invalid room key" }, 400);

  const entry = await lookupRoom(env, key);
  if (!entry) return c.json({ error: "Room not found" }, 404);

  if (!objectKey.startsWith(`rooms/${key}/`)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await deleteObjects(env, [objectKey]);
  return c.json({ ok: true });
}
