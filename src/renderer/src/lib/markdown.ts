/**
 * Block parser for the conversation markdown renderer. Tables, fenced code,
 * quotes and rules live here so the React layer only paints; the stored agent
 * text is never rewritten.
 */

export type MdAlign = "left" | "center" | "right";

export type MdBlock =
  | { type: "code"; lang: string; body: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; aligns: MdAlign[]; headers: string[]; rows: string[][] }
  | { type: "quote"; blocks: MdBlock[] }
  | { type: "hr" }
  | { type: "para"; text: string };

const LIST = /^\s*(?:[-*•]|\d+[.)])\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?/;
const HR = /^\s{0,3}(?:(?:-[\t ]*){3,}|(?:\*[\t ]*){3,}|(?:_[\t ]*){3,})$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;

export function parseBlocks(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = fenceOpen(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !fenceClose(lines[index] ?? "", fence)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", lang: fence.lang, body: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2] ?? "" });
      index += 1;
      continue;
    }
    if (startsTable(lines, index)) {
      const { block, next } = readTable(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }
    if (HR.test(line) && !LIST.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(QUOTE, ""));
        index += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(quoted.join("\n")) });
      continue;
    }
    if (LIST.test(line)) {
      const ordered = ORDERED.test(line);
      const items: string[] = [];
      // Ordered and unordered markers are different list types; do not swallow a `-` into a `1.` run.
      while (index < lines.length && LIST.test(lines[index] ?? "") && ORDERED.test(lines[index] ?? "") === ordered) {
        items.push((lines[index] ?? "").replace(LIST, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const para: string[] = [];
    while (index < lines.length && !startsBlock(lines, index)) {
      para.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "para", text: para.join("\n") });
  }
  return blocks;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!line.trim()) {
    return true;
  }
  return Boolean(fenceOpen(line)) || HEADING.test(line) || startsTable(lines, index) || (HR.test(line) && !LIST.test(line)) || QUOTE.test(line) || LIST.test(line);
}

function fenceOpen(line: string): { char: string; length: number; lang: string } | null {
  const match = FENCE.exec(line);
  if (!match) {
    return null;
  }
  const marker = match[2]!;
  const info = match[3] ?? "";
  if (marker[0] === "`" && info.includes("`")) {
    return null;
  }
  return { char: marker[0]!, length: marker.length, lang: info.trim().split(/\s+/, 1)[0] ?? "" };
}

function fenceClose(line: string, open: { char: string; length: number }): boolean {
  const match = FENCE.exec(line);
  if (!match) {
    return false;
  }
  const marker = match[2]!;
  const info = (match[3] ?? "").trim();
  return marker[0] === open.char && marker.length >= open.length && info === "";
}

function startsTable(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return looksLikeTableRow(line) && !isTableSeparator(line) && isTableSeparator(next);
}

function looksLikeTableRow(line: string): boolean {
  return line.trim().includes("|");
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => cell.length > 0 && SEPARATOR_CELL.test(cell.replace(/\s/g, "")));
}

function readTable(lines: string[], index: number): { block: Extract<MdBlock, { type: "table" }>; next: number } {
  const headers = splitTableRow(lines[index] ?? "");
  const aligns = splitTableRow(lines[index + 1] ?? "").map(alignOf);
  const width = Math.max(headers.length, 1);
  while (aligns.length < width) {
    aligns.push("left");
  }
  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    if (!line.trim() || !looksLikeTableRow(line) || isTableSeparator(line) || fenceOpen(line) || HEADING.test(line) || LIST.test(line) || QUOTE.test(line)) {
      break;
    }
    rows.push(padRow(splitTableRow(line), width));
    cursor += 1;
  }
  return {
    block: { type: "table", aligns: aligns.slice(0, width), headers: padRow(headers, width), rows },
    next: cursor,
  };
}

function alignOf(cell: string): MdAlign {
  const compact = cell.replace(/\s/g, "");
  const left = compact.startsWith(":");
  const right = compact.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return "left";
}

function padRow(cells: string[], width: number): string[] {
  const row = cells.slice(0, width);
  while (row.length < width) {
    row.push("");
  }
  return row;
}

function splitTableRow(line: string): string[] {
  const chars = [...line.trim()];
  if (chars[0] === "|") {
    chars.shift();
  }
  if (chars[chars.length - 1] === "|" && chars[chars.length - 2] !== "\\") {
    chars.pop();
  }
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    if (char === "\\" && chars[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Split streaming markdown so completed block boundaries stay stable while the
 * open tail keeps growing. Sealed text only changes when a blank line (or a
 * closed fence) lands; the React tree for the sealed part remounts far less
 * often than once per token.
 */
export function splitStreamingMarkdown(text: string): { sealed: string; tail: string } {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return { sealed: "", tail: "" };
  }

  const fenceOpenAt = openFenceStart(normalized);
  if (fenceOpenAt >= 0) {
    return {
      sealed: normalized.slice(0, fenceOpenAt),
      tail: normalized.slice(fenceOpenAt),
    };
  }

  const blank = normalized.lastIndexOf("\n\n");
  if (blank < 0) {
    return { sealed: "", tail: normalized };
  }
  return {
    sealed: normalized.slice(0, blank),
    tail: normalized.slice(blank + 2),
  };
}

/** Index of the opening fence line when the text ends inside an unclosed fence; else -1. */
function openFenceStart(text: string): number {
  const lines = text.split("\n");
  let open: { char: string; length: number } | null = null;
  let openAt = -1;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (open) {
      if (fenceClose(line, open)) {
        open = null;
        openAt = -1;
      }
    } else {
      const started = fenceOpen(line);
      if (started) {
        open = { char: started.char, length: started.length };
        openAt = offset;
      }
    }
    offset += line.length + 1;
  }
  return open ? openAt : -1;
}
