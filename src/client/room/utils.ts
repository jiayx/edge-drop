export function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function flash(el: HTMLElement, text: string): void {
  const orig = el.textContent ?? "";
  el.textContent = text;
  setTimeout(() => {
    el.textContent = orig;
  }, 1500);
}
