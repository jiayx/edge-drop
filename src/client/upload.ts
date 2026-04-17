// upload.ts — file upload via Worker proxy with progress tracking

export interface UploadResult {
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface UploadResponse {
  objectKey: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
}

interface UploadErrorResponse {
  error: string;
}

export async function uploadFile(opts: {
  roomKey: string;
  file: File;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { roomKey, file, onProgress, signal } = opts;
  const mimeType = file.type || "application/octet-stream";
  const metadataRes = await fetch(`/api/v1/rooms/${roomKey}/files`, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Size": String(file.size),
    },
    signal,
  });

  if (!metadataRes.ok) {
    try {
      const err = await metadataRes.json() as UploadErrorResponse;
      throw new Error(err.error || `Upload failed with status ${metadataRes.status}`);
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`Upload failed with status ${metadataRes.status}`);
    }
  }

  const { objectKey, uploadUrl, uploadHeaders } = await metadataRes.json() as UploadResponse;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abortUpload = (): void => {
      xhr.abort();
      reject(new DOMException("Upload canceled", "AbortError"));
    };

    if (signal?.aborted) {
      abortUpload();
      return;
    }

    signal?.addEventListener("abort", abortUpload, { once: true });

    xhr.open("PUT", uploadUrl);
    Object.entries(uploadHeaders).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value);
    });

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new DOMException("Upload canceled", "AbortError"));

    xhr.send(file);
  });

  return { objectKey, fileName: file.name, mimeType, sizeBytes: file.size };
}
