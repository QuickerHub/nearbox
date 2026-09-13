/**
 * Split inline markdown into text / code / bold / italic / links. Used only to
 * paint the conversation; the stored agent output is never rewritten.
 */

export type InlinePiece =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; href: string; text: string };

/**
 * Non-code tokens. Backtick spans are scanned separately so `` `a`b` `` keeps
 * the inner backtick (matched fence length), matching CommonMark code spans.
 */
const TOKEN =
  /\*\*[^*]+\*\*|__[^_\n]+__|(?<![\w_])_(?!_)([^_\n]+)_(?![\w_])|\[[^\]]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>"'`]+/g;

const MARKDOWN_LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
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
    if (text[cursor] === "`") {
      const span = matchCodeSpan(text, cursor);
      if (span) {
        pieces.push({ type: "code", text: span.text });
        cursor = span.end;
        continue;
      }
      pieces.push({ type: "text", text: "`" });
      cursor += 1;
      continue;
    }
    const nextTick = text.indexOf("`", cursor);
    const sliceEnd = nextTick < 0 ? text.length : nextTick;
    pieces.push(...splitTokens(text.slice(cursor, sliceEnd)));
    cursor = sliceEnd;
  }
  return mergeAdjacentText(pieces);
}

/** CommonMark-style code span: opening run of N backticks closes with N. */
function matchCodeSpan(text: string, start: number): { text: string; end: number } | null {
  let open = 0;
  while (start + open < text.length && text[start + open] === "`") {
    open += 1;
  }
  if (open === 0) {
    return null;
  }
  let index = start + open;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let close = 0;
    while (index + close < text.length && text[index + close] === "`") {
      close += 1;
    }
    if (close === open) {
      return { text: text.slice(start + open, index), end: index + close };
    }
    index += close;
  }
  return null;
}

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
  if (token.startsWith("**") && token.endsWith("**")) {
    return [{ type: "bold", text: token.slice(2, -2) }];
  }
  if (token.startsWith("__") && token.endsWith("__")) {
    return [{ type: "bold", text: token.slice(2, -2) }];
  }
  if (token.startsWith("_") && token.endsWith("_") && token.length >= 3) {
    return [{ type: "italic", text: token.slice(1, -1) }];
  }
  const markdown = MARKDOWN_LINK.exec(token);
  if (markdown) {
    const href = safeHttpUrl(markdown[2]!);
    return href ? [{ type: "link", href, text: markdown[1]! }] : [{ type: "text", text: token }];
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

function mergeAdjacentText(pieces: InlinePiece[]): InlinePiece[] {
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
