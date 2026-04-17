import { AwsClient } from "aws4fetch";

function encodeObjectKey(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

export function buildR2S3ObjectUrl(env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME">, objectKey: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodeObjectKey(objectKey)}`;
}

export function buildR2S3BucketUrl(env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME">): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
}

export function createR2S3Client(env: Pick<Env, "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

export function decodeOriginalFileName(value: string | undefined): string {
  if (!value) return "file";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function createPresignedUpload(
  env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">,
  opts: {
    objectKey: string;
    mimeType: string;
    contentDisposition: string;
    originalFileName: string;
    expiresInSeconds: number;
  }
): Promise<{ uploadUrl: string; uploadHeaders: Record<string, string> }> {
  const uploadHeaders = {
    "content-type": opts.mimeType,
    "content-disposition": opts.contentDisposition,
    "x-amz-meta-originalfilename": encodeURIComponent(opts.originalFileName),
  };
  const uploadUrl = new URL(buildR2S3ObjectUrl(env, opts.objectKey));
  uploadUrl.searchParams.set("X-Amz-Expires", String(opts.expiresInSeconds));
  const signedRequest = await createR2S3Client(env).sign(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    aws: {
      signQuery: true,
      allHeaders: true,
    },
  });

  return {
    uploadUrl: signedRequest.url,
    uploadHeaders,
  };
}

export async function fetchObject(
  env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">,
  objectKey: string,
  opts?: { range?: string | null }
): Promise<Response> {
  const requestHeaders: HeadersInit = {};
  if (opts?.range) {
    requestHeaders.Range = opts.range;
  }
  return createR2S3Client(env).fetch(buildR2S3ObjectUrl(env, objectKey), {
    method: "GET",
    headers: requestHeaders,
  });
}

export async function deleteObjects(
  env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return;

  const client = createR2S3Client(env);
  await Promise.all(
    keys.map(async (key) => {
      const res = await client.fetch(buildR2S3ObjectUrl(env, key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete object ${key}: ${res.status}`);
      }
    })
  );
}

export async function listRoomObjects(
  env: Pick<Env, "R2_ACCOUNT_ID" | "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">,
  prefix: string
): Promise<string[]> {
  const client = createR2S3Client(env);
  const keys: string[] = [];
  let continuationToken: string | null = null;

  while (true) {
    const url = new URL(buildR2S3BucketUrl(env));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (continuationToken) {
      url.searchParams.set("continuation-token", continuationToken);
    }

    const res = await client.fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Failed to list objects for prefix ${prefix}: ${res.status}`);
    }

    const body = await res.text();
    const keyMatches = body.matchAll(/<Key>(.*?)<\/Key>/g);
    for (const match of keyMatches) {
      const key = match[1];
      if (key) keys.push(decodeXmlEntities(key));
    }

    const nextTokenMatch = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(body);
    if (!nextTokenMatch?.[1]) break;
    continuationToken = decodeXmlEntities(nextTokenMatch[1]);
  }

  return keys;
}
