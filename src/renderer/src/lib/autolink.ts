/**
 * Split inline markdown into text / code / bold / links. Used only to paint
 * the conversation; the stored agent output is never rewritten.
 */

export type InlinePiece =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; href: string; text: string };

/** Code, bold, angle / bare URLs. Markdown `[text](…)` is scanned separately so
 *  URLs may contain balanced parentheses and an optional title. */
const TOKEN =
  /(`[^`]+`|\*\*[^*]+\*\*|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>"'`]+)/g;

const ANGLE_LINK = /^<(https?:\/\/[^>\s]+)>$/;
const BARE_LINK = /^(https?:\/\/[^\s<>"'`]+)$/;
const TRAILING = /[),.;:!?，。；：！？)」』>]+$/;

export function safeHttpUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Pull trailing sentence punctuation off a bare URL, keeping balanced ). */
export function peelAutolink(raw: string): { href: string; trail: string } {
  let href = raw;
  let trail = "";
  while (href.length > 0) {
    const last = href[href.length - 1]!;
    if (TRAILING.test(last)) {
      if (last === ")" && count(href, "(") >= count(href, ")")) {
        break;
      }
      href = href.slice(0, -1);
      trail = last + trail;
      continue;
    }
    break;
  }
  return { href, trail };
}

export function splitInline(text: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "[") {
      const link = matchMarkdownLink(text, cursor);
      if (link) {
        const href = safeHttpUrl(link.href);
        pieces.push(href ? { type: "link", href, text: link.text } : { type: "text", text: text.slice(link.start, link.end) });
        cursor = link.end;
        continue;
      }
      pieces.push({ type: "text", text: "[" });
      cursor += 1;
      continue;
    }
    const nextBracket = text.indexOf("[", cursor);
    const sliceEnd = nextBracket < 0 ? text.length : nextBracket;
    pieces.push(...splitTokens(text.slice(cursor, sliceEnd)));
    cursor = sliceEnd;
  }
  return mergeAdjacentText(pieces);
}

/** Regex tokens only — markdown links are handled by the scanner above. */
function splitTokens(text: string): InlinePiece[] {
  if (!text) {
    return [];
  }
  const pieces: InlinePiece[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) {
      pieces.push({ type: "text", text: text.slice(last, match.index) });
    }
    pieces.push(...piecesFor(match[0]!));
    last = match.index + match[0]!.length;
  }
  if (last < text.length) {
    pieces.push({ type: "text", text: text.slice(last) });
  }
  return pieces;
}

function piecesFor(token: string): InlinePiece[] {
  if (token.startsWith("`")) {
    return [{ type: "code", text: token.slice(1, -1) }];
  }
  if (token.startsWith("**")) {
    return [{ type: "bold", text: token.slice(2, -2) }];
  }
  const angled = ANGLE_LINK.exec(token);
  if (angled) {
    const href = safeHttpUrl(angled[1]!);
    return href ? [{ type: "link", href, text: angled[1]! }] : [{ type: "text", text: token }];
  }
  if (BARE_LINK.test(token)) {
    const { href, trail } = peelAutolink(token);
    const safe = safeHttpUrl(href);
    if (safe) {
      const pieces: InlinePiece[] = [{ type: "link", href: safe, text: href }];
      if (trail) {
        pieces.push({ type: "text", text: trail });
      }
      return pieces;
    }
  }
  return [{ type: "text", text: token }];
}

/**
 * `[label](dest "title")` with balanced parentheses in `dest`, optional
 * `<angle>` destination, and optional "double" / 'single' / (paren) title.
 */
function matchMarkdownLink(
  text: string,
  from: number,
): { start: number; end: number; text: string; href: string } | null {
  if (text[from] !== "[") {
    return null;
  }
  const closeLabel = text.indexOf("]", from + 1);
  if (closeLabel < 0 || text[closeLabel + 1] !== "(") {
    return null;
  }
  const label = text.slice(from + 1, closeLabel);
  if (!label) {
    return null;
  }
  let i = closeLabel + 2;
  while (text[i] === " " || text[i] === "\t") {
    i += 1;
  }
  let href = "";
  if (text[i] === "<") {
    const end = text.indexOf(">", i + 1);
    if (end < 0) {
      return null;
    }
    href = text.slice(i + 1, end).trim();
    i = end + 1;
  } else {
    const start = i;
    let depth = 1;
    for (; i < text.length; i += 1) {
      const char = text[i]!;
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      } else if ((char === " " || char === "\t" || char === "\n") && depth === 1) {
        break;
      }
    }
    href = text.slice(start, i).trim();
  }
  if (!href) {
    return null;
  }
  while (text[i] === " " || text[i] === "\t") {
    i += 1;
  }
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i]!;
    const end = text.indexOf(quote, i + 1);
    if (end < 0) {
      return null;
    }
    i = end + 1;
  } else if (text[i] === "(") {
    const end = text.indexOf(")", i + 1);
    if (end < 0) {
      return null;
    }
    i = end + 1;
  }
  while (text[i] === " " || text[i] === "\t") {
    i += 1;
  }
  if (text[i] !== ")") {
    return null;
  }
  return { start: from, end: i + 1, text: label, href };
}

function mergeAdjacentText(pieces: InlinePiece[]): InlinePiece[] {
  if (pieces.length < 2) {
    return pieces;
  }
  const out: InlinePiece[] = [];
  for (const piece of pieces) {
    const prev = out[out.length - 1];
    if (piece.type === "text" && prev?.type === "text") {
      out[out.length - 1] = { type: "text", text: prev.text + piece.text };
    } else {
      out.push(piece);
    }
  }
  return out;
}

function count(text: string, char: string): number {
  let total = 0;
  for (const item of text) {
    if (item === char) {
      total += 1;
    }
  }
  return total;
}
