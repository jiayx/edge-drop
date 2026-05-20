import { isMentionBoundaryChar, isMentionPrefixChar } from "./mentionRules";
import type { RoomPageContext } from "./state";
import { escHtml } from "./utils";

function createMentionMarkup(displayName: string, isOwn: boolean): string {
  const className = isOwn ? "bubble-mention own" : "bubble-mention";
  return `<span class="${className}">@${escHtml(displayName)}</span>`;
}

function createLinkMarkup(urlText: string): string {
  const href = urlText.startsWith("www.") ? `https://${urlText}` : urlText;
  return `<a class="bubble-link" href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${escHtml(urlText)}</a>`;
}

function getLinkMatch(text: string, index: number): string | null {
  const slice = text.slice(index);
  const match = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i.exec(slice);
  if (!match) return null;

  const rawUrl = match[0] ?? "";
  const trimmedUrl = rawUrl.replace(/[.,!?;:)\]}]+$/, "");
  return trimmedUrl || null;
}

export function renderMessageText(
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

  let html = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\n") {
      html += "<br>";
      continue;
    }

    const linkMatch = getLinkMatch(text, index);
    if (linkMatch) {
      html += createLinkMarkup(linkMatch);
      index += linkMatch.length - 1;
      continue;
    }

    if (
      knownNames.length &&
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
