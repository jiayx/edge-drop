// upload.ts — file upload via Worker proxy with progress tracking

export interface UploadResult {
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface UploadResponse {
  objectKey: string;
}

interface UploadErrorResponse {
  error: string;
}

export async function uploadFile(opts: {
  roomKey: string;
  file: File;
  onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const { roomKey, file, onProgress } = opts;
  const mimeType = file.type || "application/octet-stream";

  const objectKey = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/rooms/${roomKey}/files`);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-File-Size", String(file.size));

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        try {
          const data = JSON.parse(xhr.responseText) as UploadResponse;
          resolve(data.objectKey);
        } catch {
          reject(new Error("Upload response was invalid"));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText) as UploadErrorResponse;
          reject(new Error(err.error || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));

    xhr.send(file);
  });

  return { objectKey, fileName: file.name, mimeType, sizeBytes: file.size };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}
