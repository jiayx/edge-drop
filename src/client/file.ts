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

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}
