import type { UserRecord } from "@/room/types";

import type { RoomPageContext } from "./state";
import { escHtml } from "./utils";

interface MentionMatch {
  query: string;
  start: number;
  end: number;
}

function normalizeMentionQuery(value: string): string {
  return value.replace(/^"+/, "").trimStart();
}

function getDisplayMention(displayName: string): string {
  return /\s/.test(displayName) ? `@"${displayName}"` : `@${displayName}`;
}

function createMentionMarkup(displayName: string, isOwn: boolean): string {
  const className = isOwn ? "bubble-mention own" : "bubble-mention";
  return `<span class="${className}">@${escHtml(displayName)}</span>`;
}

function isMentionBoundaryChar(char: string | undefined): boolean {
  return !char || /\s|[.,!?;:)\]}]/.test(char);
}

function isMentionPrefixChar(char: string | undefined): boolean {
  return !char || /\s|\(/.test(char);
}

function getMentionMatchLength(text: string, atIndex: number, displayName: string): number {
  if (!isMentionPrefixChar(text[atIndex - 1])) return 0;
  if (text[atIndex] !== "@") return 0;

  if (/\s/.test(displayName)) {
    const quotedMention = `@"${displayName}"`;
    if (
      text.startsWith(quotedMention, atIndex) &&
      isMentionBoundaryChar(text[atIndex + quotedMention.length])
    ) {
      return quotedMention.length;
    }
    return 0;
  }

  const plainMention = `@${displayName}`;
  if (
    text.startsWith(plainMention, atIndex) &&
    isMentionBoundaryChar(text[atIndex + plainMention.length])
  ) {
    return plainMention.length;
  }

  return 0;
}

function findActiveMention(value: string, caret: number): MentionMatch | null {
  const lineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const slice = value.slice(lineStart, caret);
  const atIndex = slice.lastIndexOf("@");
  if (atIndex < 0) return null;

  const absoluteAtIndex = lineStart + atIndex;
  const prevChar = absoluteAtIndex > 0 ? value[absoluteAtIndex - 1] : "";
  if (prevChar && !/\s|\(/.test(prevChar)) return null;

  const rawQuery = value.slice(absoluteAtIndex + 1, caret);
  if (/[\n]/.test(rawQuery)) return null;
  if (/\s$/.test(rawQuery)) return null;

  return {
    query: normalizeMentionQuery(rawQuery),
    start: absoluteAtIndex,
    end: caret,
  };
}

function getMentionCandidates(context: RoomPageContext, query: string): UserRecord[] {
  const normalized = query.trim().toLowerCase();
  return context.state.onlineUsers
    .filter((user) => {
      if (!normalized) return true;
      return user.displayName.toLowerCase().includes(normalized);
    })
    .sort((a, b) => {
      const aStarts = a.displayName.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.displayName.toLowerCase().startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, 6);
}

function setMentionMenuHidden(context: RoomPageContext): void {
  context.dom.mentionMenu?.classList.remove("visible");
  if (context.dom.mentionMenu) {
    context.dom.mentionMenu.innerHTML = "";
  }
}

function focusMessageInput(context: RoomPageContext): void {
  context.dom.messageInput?.focus();
}

export function renderTextWithMentions(
  context: RoomPageContext,
  text: string,
  senderId: string
): string {
  const isOwn = senderId === context.identity.userId;
  const mentionNames = new Set<string>([
    context.identity.displayName,
    ...Array.from(context.state.knownUsers.values()).map((user) => user.displayName),
  ]);
  const knownNames = Array.from(mentionNames).sort((a, b) => b.length - a.length);

  if (!knownNames.length) {
    return escHtml(text).replace(/\n/g, "<br>");
  }

  let html = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\n") {
      html += "<br>";
      continue;
    }

    if (
      char === "@" &&
      isMentionPrefixChar(text[index - 1])
    ) {
      if (text[index + 1] === "\"") {
        const closingQuote = text.indexOf("\"", index + 2);
        const displayName = closingQuote > index ? text.slice(index + 2, closingQuote) : "";
        if (closingQuote > index && mentionNames.has(displayName) && isMentionBoundaryChar(text[closingQuote + 1])) {
          html += createMentionMarkup(displayName, isOwn);
          index = closingQuote;
          continue;
        }
      }

      const matchedName = knownNames.find((displayName) =>
        text.startsWith(displayName, index + 1) &&
        isMentionBoundaryChar(text[index + 1 + displayName.length])
      );
      if (matchedName) {
        html += createMentionMarkup(matchedName, isOwn);
        index += matchedName.length;
        continue;
      }
    }

    html += escHtml(char);
  }

  return html;
}

export function textMentionsDisplayName(text: string, displayName: string): boolean {
  if (!displayName) return false;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    const matchLength = getMentionMatchLength(text, index, displayName);
    if (matchLength > 0) {
      return true;
    }
  }

  return false;
}

export function createMentionController(context: RoomPageContext) {
  let activeIndex = 0;
  let suppressMenuUntilInput = false;

  const closeMenu = (): void => {
    activeIndex = 0;
    setMentionMenuHidden(context);
  };

  const syncMenu = (): void => {
    const input = context.dom.messageInput;
    const menu = context.dom.mentionMenu;
    if (!input || !menu) return;
    if (suppressMenuUntilInput) {
      closeMenu();
      return;
    }

    const caret = input.selectionStart ?? input.value.length;
    const mention = findActiveMention(input.value, caret);
    if (!mention) {
      closeMenu();
      return;
    }

    const candidates = getMentionCandidates(context, mention.query);
    if (!candidates.length) {
      closeMenu();
      return;
    }

    activeIndex = Math.min(activeIndex, candidates.length - 1);
    menu.innerHTML = candidates
      .map((user, index) => {
        const isActive = index === activeIndex;
        return `<button
          type="button"
          class="mention-option${isActive ? " active" : ""}"
          data-user-id="${user.userId}"
          data-display-name="${escHtml(user.displayName)}"
          role="option"
          aria-selected="${isActive ? "true" : "false"}"
        >
          <span class="mention-option-avatar">${escHtml(user.displayName.charAt(0).toUpperCase())}</span>
          <span class="mention-option-name">${escHtml(user.displayName)}</span>
        </button>`;
      })
      .join("");
    menu.classList.add("visible");
  };

  const applyMention = (displayName: string): void => {
    const input = context.dom.messageInput;
    if (!input) return;
    const caret = input.selectionStart ?? input.value.length;
    const mention = findActiveMention(input.value, caret);
    if (!mention) return;

    const replacement = `${getDisplayMention(displayName)} `;
    input.value = `${input.value.slice(0, mention.start)}${replacement}${input.value.slice(mention.end)}`;
    const nextCaret = mention.start + replacement.length;
    input.setSelectionRange(nextCaret, nextCaret);
    suppressMenuUntilInput = true;
    closeMenu();
    focusMessageInput(context);
  };

  const handleKeydown = (event: KeyboardEvent): boolean => {
    const menu = context.dom.mentionMenu;
    if (!menu?.classList.contains("visible")) return false;

    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>(".mention-option"));
    if (!options.length) return false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % options.length;
      syncMenu();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + options.length) % options.length;
      syncMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selected = options[activeIndex];
      const displayName = selected?.dataset.displayName;
      if (displayName) applyMention(displayName);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return true;
    }

    return false;
  };

  const bind = (): void => {
    context.dom.messageInput?.addEventListener("input", () => {
      suppressMenuUntilInput = false;
      activeIndex = 0;
      syncMenu();
    });
    context.dom.messageInput?.addEventListener("click", syncMenu);
    context.dom.messageInput?.addEventListener("keyup", syncMenu);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        context.dom.composerWrap?.contains(target) ||
        context.dom.mentionMenu?.contains(target)
      ) {
        return;
      }
      closeMenu();
    });
    context.dom.mentionMenu?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    context.dom.mentionMenu?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLButtonElement>(".mention-option[data-display-name]");
      const displayName = button?.dataset.displayName;
      if (!displayName) return;
      applyMention(displayName);
    });
  };

  return {
    bind,
    closeMenu,
    handleKeydown,
    syncMenu,
  };
}
