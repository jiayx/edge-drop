import type { Context } from "hono";
import { isValidRoomKey } from "../lib/roomKey";
import { isExpired } from "../lib/expiry";
import { putObject, deleteObjects } from "../lib/r2";
import { lookupRoom } from "./rooms";

function param(c: Context<{ Bindings: Env }>, name: string): string {
  return c.req.param(name) ?? "";
}

const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".sh", ".cmd", ".msi", ".dll", ".scr", ".com", ".pif"]);
const MAX_OBJECT_KEY_LEN = 512;

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

  // Build an opaque object key. Keep the extension for content sniffing/debuggability,
  // but avoid embedding the original file name in storage paths or URLs.
  const ts = Date.now();
  const objectKey = `rooms/${key}/${ts}-${crypto.randomUUID()}${ext}`;

  if (objectKey.length > MAX_OBJECT_KEY_LEN) {
    return c.json({ error: "File name too long" }, 400);
  }

  await putObject(env, objectKey, c.req.raw.body, {
    contentType: mimeType,
    contentDisposition: buildContentDisposition("inline", fileName),
    customMetadata: {
      originalFileName: fileName,
    },
  });

  return c.json({ objectKey });
}

// Parse a "bytes=start-end" Range header. Returns null if absent or unparseable.
function parseRange(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!m) return null;
  const rawStart = m[1] ?? "";
  const rawEnd = m[2] ?? "";
  let start: number;
  let end: number;
  if (rawStart === "" && rawEnd !== "") {
    // suffix range: bytes=-500  →  last 500 bytes
    const suffix = parseInt(rawEnd, 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = rawStart !== "" ? parseInt(rawStart, 10) : 0;
    end = rawEnd !== "" ? parseInt(rawEnd, 10) : totalSize - 1;
  }
  if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize) return null;
  end = Math.min(end, totalSize - 1);
  if (start > end) return null;
  return { start, end };
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

  const rangeHeader = c.req.header("Range") ?? null;

  // First fetch metadata to know the total size, then fetch with range if needed.
  const head = await env.FILE_BUCKET.head(objectKey);
  if (!head) return c.json({ error: "File not found" }, 404);

  const totalSize = head.size;
  const range = parseRange(rangeHeader, totalSize);

  const fileName = head.customMetadata?.originalFileName || "file";
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("etag", head.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=60");
  headers.set("content-disposition", buildContentDisposition("inline", fileName));

  if (range) {
    const object = await env.FILE_BUCKET.get(objectKey, {
      range: {
        offset: range.start,
        length: range.end - range.start + 1,
      },
    });
    if (!object) return c.json({ error: "File not found" }, 404);
    const chunkSize = range.end - range.start + 1;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${totalSize}`);
    headers.set("content-length", String(chunkSize));
    return new Response((object as R2ObjectBody).body, { status: 206, headers });
  }

  const object = await env.FILE_BUCKET.get(objectKey);
  if (!object) return c.json({ error: "File not found" }, 404);
  headers.set("content-length", String(totalSize));
  return new Response((object as R2ObjectBody).body, { status: 200, headers });
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
