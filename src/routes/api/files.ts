import type { Context } from "hono";
import { Hono } from "hono";
import { isValidRoomKey } from "@/lib/roomKey";
import { isExpired } from "@/lib/expiry";
import { getDefaultMaxFileSizeMb, parsePositiveInt } from "@/lib/fileSize";
import { createPresignedUpload, decodeOriginalFileName, deleteObjects, fetchObject } from "@/lib/r2";
import { getRoomStub, lookupRoom } from "@/room/store";

function param(c: Context<{ Bindings: Env }>, name: string): string {
  return c.req.param(name) ?? "";
}

const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".sh", ".cmd", ".msi", ".dll", ".scr", ".com", ".pif"]);
const MAX_OBJECT_KEY_LEN = 512;
const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

function toAsciiFileName(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  const ascii = sanitized.replace(/[^\x20-\x7E]/g, "_");
  const dot = ascii.lastIndexOf(".");
  const ext = dot > 0 ? ascii.slice(dot) : "";
  const base = dot > 0 ? ascii.slice(0, dot) : ascii;
  const normalizedBase = base.replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  if (!normalizedBase) {
    return `file${ext}`;
  }

  return `${normalizedBase}${ext}`;
}

function buildContentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiFallback = toAsciiFileName(fileName);
  const utf8Name = encodeURIComponent(sanitizeHeaderValue(fileName));
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`;
}

// POST /api/v1/rooms/:key/files
export async function createDirectUpload(c: Context<{ Bindings: Env }>): Promise<Response> {
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

  const roomStub = getRoomStub(env, entry.doId);
  const roomInfoRes = await roomStub.fetch("http://internal/info");
  if (!roomInfoRes.ok) return c.json({ error: "Room unavailable" }, 503);
  const roomInfo = await roomInfoRes.json<{ maxFileSizeMb?: unknown }>();
  const maxFileSizeMb = parsePositiveInt(roomInfo.maxFileSizeMb) ?? getDefaultMaxFileSizeMb(env);
  const maxBytes = maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return c.json({ error: `File exceeds maximum size of ${maxFileSizeMb} MB` }, 400);
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

  const ts = Date.now();
  const objectKey = `rooms/${key}/${ts}-${crypto.randomUUID()}${ext}`;

  if (objectKey.length > MAX_OBJECT_KEY_LEN) {
    return c.json({ error: "File name too long" }, 400);
  }

  const directUpload = await createPresignedUpload(env, {
    objectKey,
    mimeType,
    contentDisposition: buildContentDisposition("inline", fileName),
    originalFileName: fileName,
    expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
  });

  return c.json({
    objectKey,
    uploadUrl: directUpload.uploadUrl,
    uploadHeaders: directUpload.uploadHeaders,
  });
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

  const upstream = await fetchObject(env, objectKey, { range: c.req.header("Range") });
  if (upstream.status === 404) return c.json({ error: "File not found" }, 404);
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: "Failed to fetch file" }, 502);
  }

  const headers = new Headers();
  const passThroughHeaders = [
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ];
  for (const name of passThroughHeaders) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "private, max-age=60");
  }
  if (!headers.has("accept-ranges")) {
    headers.set("accept-ranges", "bytes");
  }
  const originalFileName = decodeOriginalFileName(upstream.headers.get("x-amz-meta-originalfilename") ?? undefined);
  if (!headers.has("content-disposition")) {
    headers.set("content-disposition", buildContentDisposition("inline", originalFileName));
  }

  return new Response(upstream.body, { status: upstream.status, headers });
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

export const fileApi = new Hono<{ Bindings: Env }>();

fileApi.post("/rooms/:key/files", createDirectUpload);
fileApi.get("/rooms/:key/files/:objectKey{.+}", downloadFile);
fileApi.delete("/rooms/:key/files/:objectKey{.+}", deleteFile);
