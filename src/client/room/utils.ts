export function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const flashState = new WeakMap<HTMLElement, { originalText: string; timeoutId: number }>();

export function flash(el: HTMLElement, text: string): void {
  const existingState = flashState.get(el);
  const originalText = existingState?.originalText ?? el.textContent ?? "";
  if (existingState) {
    window.clearTimeout(existingState.timeoutId);
  }
  el.textContent = text;
  const timeoutId = window.setTimeout(() => {
    el.textContent = originalText;
    flashState.delete(el);
  }, 1500);
  flashState.set(el, { originalText, timeoutId });
}
