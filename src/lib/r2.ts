export async function putObject(
  env: Env,
  objectKey: string,
  body: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
  options?: {
    contentType?: string;
    contentDisposition?: string;
    customMetadata?: Record<string, string>;
  }
): Promise<void> {
  await env.FILE_BUCKET.put(objectKey, body, {
    httpMetadata: {
      contentType: options?.contentType,
      contentDisposition: options?.contentDisposition,
    },
    customMetadata: options?.customMetadata,
  });
}

export async function getObject(env: Env, objectKey: string): Promise<R2ObjectBody | null> {
  return env.FILE_BUCKET.get(objectKey);
}

export async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await env.FILE_BUCKET.delete(keys);
}

export async function listRoomObjects(env: Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.FILE_BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      keys.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}
