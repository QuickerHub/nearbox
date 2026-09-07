// Line-level diff between two versions of a text, written out as the body of
// a unified diff (`@@ -a,b +c,d @@` hunks with context lines). Agents that
// speak ACP describe an edit as the whole file before and after; this turns
// that pair into the few changed lines a person wants to see. Only type
// imports so `node --test` can load it without a bundler.

const DEFAULT_CONTEXT = 3;
/**
 * Myers' algorithm costs O((N+M)·D) time and O(D²) memory for D changed
 * lines. Past these bounds the edit is effectively a rewrite, and showing it as
 * one is both honest and cheap.
 */
const MAX_EDIT_DISTANCE = 2_000;
const MAX_WORK = 24_000_000;

export type DiffOp = { tag: "eq" | "add" | "del"; text: string };

export interface DiffCounts {
  added: number;
  removed: number;
}

/** Unified-diff body of `oldText` → `newText`; empty when the two are the same. */
export function unifiedDiff(oldText: string, newText: string, context = DEFAULT_CONTEXT): string {
  if (oldText === newText) {
    return "";
  }
  return formatHunks(diffLines(splitLines(oldText, newText), splitLines(newText, oldText)), context);
}

/** Added and removed line counts of a unified diff (headers and hunk markers excluded). */
export function countChanges(diff: string): DiffCounts {
  const counts: DiffCounts = { added: 0, removed: 0 };
  let inBody = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inBody = true;
      continue;
    }
    if (!inBody && (line.startsWith("+++") || line.startsWith("---"))) {
      continue;
    }
    if (line.startsWith("+")) {
      counts.added += 1;
    } else if (line.startsWith("-")) {
      counts.removed += 1;
    }
  }
  return counts;
}

/** Edit script turning `a` into `b`: common prefix/suffix peeled off, Myers on what is left. */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ tag: "eq", text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ tag: "eq", text }));
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const middle = myers(middleA, middleB) ?? [...middleA.map((text): DiffOp => ({ tag: "del", text })), ...middleB.map((text): DiffOp => ({ tag: "add", text }))];
  return [...head, ...middle, ...tail];
}

/**
 * Text as lines. A trailing newline is what both files usually share, so it
 * is dropped when `other` ends the same way; when only one side has it, the
 * extra empty line stays and shows up as the difference it is.
 */
function splitLines(text: string, other: string): string[] {
  if (!text) {
    return [];
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (text.endsWith("\n") && (other.endsWith("\n") || !other)) {
    lines.pop();
  }
  return lines;
}

/**
 * Greedy forward Myers with a per-step snapshot for backtracking (after
 * Coglan's exposition). Returns null when the budget runs out.
 */
function myers(a: readonly string[], b: readonly string[]): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return b.map((text) => ({ tag: "add", text }));
  }
  if (m === 0) {
    return a.map((text) => ({ tag: "del", text }));
  }
  const max = n + m;
  const offset = max + 1;
  // v[offset + k] is the furthest x reached on diagonal k = x - y.
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDIT_DISTANCE || (d + 1) * max > MAX_WORK) {
      return null;
    }
    // Only diagonals -d-1..d+1 are read while backtracking step d.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b);
      }
    }
  }
  return null;
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const snapshot = trace[d]!;
    const at = (k: number): number => snapshot[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ tag: "eq", text: a[x]! });
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ tag: "add", text: b[prevY]! });
      } else {
        ops.push({ tag: "del", text: a[prevX]! });
      }
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function formatHunks(ops: readonly DiffOp[], context: number): string {
  const changed: number[] = [];
  ops.forEach((op, index) => {
    if (op.tag !== "eq") {
      changed.push(index);
    }
  });
  if (!changed.length) {
    return "";
  }
  // Changes closer than two contexts apart share a hunk.
  const ranges: [number, number][] = [];
  let from = changed[0]!;
  let to = from;
  for (const index of changed.slice(1)) {
    if (index - to > context * 2) {
      ranges.push([from, to]);
      from = index;
    }
    to = index;
  }
  ranges.push([from, to]);

  const out: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let cursor = 0;
  for (const [first, last] of ranges) {
    const begin = Math.max(cursor, first - context);
    const end = Math.min(ops.length, last + context + 1);
    for (; cursor < begin; cursor += 1) {
      oldLine += 1;
      newLine += 1;
    }
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let index = begin; index < end; index += 1) {
      const op = ops[index]!;
      if (op.tag === "eq") {
        oldCount += 1;
        newCount += 1;
        body.push(` ${op.text}`);
      } else if (op.tag === "del") {
        oldCount += 1;
        body.push(`-${op.text}`);
      } else {
        newCount += 1;
        body.push(`+${op.text}`);
      }
    }
    const oldStart = oldCount ? oldLine + 1 : oldLine;
    const newStart = newCount ? newLine + 1 : newLine;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    oldLine += oldCount;
    newLine += newCount;
    cursor = end;
  }
  return out.join("\n");
}
