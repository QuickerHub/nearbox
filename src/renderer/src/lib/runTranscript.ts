import { stripAnsi } from "./format.ts";
import { countChanges, refineRewriteDiff } from "../../../shared/diff.ts";
import type { RunEvent, ToolCall, ToolKind, ToolStatus } from "../../../shared/protocol";
import { describeArgs, describeCursorResult, describeRawResult, isRecord, looseJson } from "../../../shared/tools.ts";

export type TranscriptItem =
  | { type: "thinking"; text: string; seq: number }
  | { type: "text"; text: string; seq: number }
  | { type: "tool"; tool: ToolCall; seq: number }
  | { type: "status"; text: string; seq: number }
  | { type: "stderr"; text: string; seq: number }
  | { type: "raw"; text: string; seq: number };

/** Rows the UI renders inside the work fold. */
export type WorkRow =
  | { type: "thinking"; text: string; seq: number }
  | { type: "text"; text: string; seq: number }
  | { type: "tool"; tool: ToolCall; seq: number }
  /** A run of consecutive same-kind lookups (reads, searches…) folded into one line. */
  | { type: "tools"; kind: ToolKind; tools: ToolCall[]; seq: number }
  | { type: "status"; text: string; seq: number }
  | { type: "stderr"; lines: string[]; seq: number }
  | { type: "raw"; lines: string[]; seq: number };

export interface Transcript {
  /** Everything up to and including the last tool call or thought, in order. */
  work: WorkRow[];
  /** Assistant text after the last tool call: the answer for this turn. */
  answer: string;
  toolCount: number;
  /** Calls the agent has started but not finished. */
  running: ToolCall[];
}

/** Statuses the runner and CLIs emit for bookkeeping; they add nothing in a chat view. */
const NOISY_STATUS = /^(启动 |运行结束|运行失败|已停止|模型 |已连接|已收到任务|开始处理|会话已创建|step|session)/i;

/** Lookups that read a lot and say little; consecutive ones collapse into "读取了 N 个文件". */
const GROUPABLE: ReadonlySet<ToolKind> = new Set<ToolKind>(["read", "glob", "grep", "ls", "web"]);

export function isNoisyStatus(text: string): boolean {
  return NOISY_STATUS.test(text.trim());
}

/** Mutable cursor that applies only new events so a live turn does not rescan history. */
export interface TranscriptCursor {
  items: TranscriptItem[];
  toolIndex: Map<string, number>;
  /** How many events from the front of the list have already been applied. */
  count: number;
  /** `seq` of events[count - 1], used to detect a replaced history. */
  lastSeq: number;
}

export function createTranscriptCursor(): TranscriptCursor {
  return { items: [], toolIndex: new Map(), count: 0, lastSeq: 0 };
}

/**
 * Turn the raw event stream into ordered items. Tool events that share an id
 * collapse into one item that keeps the position of the first and the state
 * of the latest; text and thinking deltas merge with their neighbours.
 */
export function buildTranscript(events: readonly RunEvent[]): TranscriptItem[] {
  return advanceTranscript(createTranscriptCursor(), events).items;
}

/**
 * Apply only the suffix of `events` that this cursor has not seen. When the
 * list was replaced (shorter, or a different event at the previous tip), the
 * cursor rebuilds from scratch. Item object identity is kept for rows the
 * suffix did not touch, so memoised work rows stay mounted while the answer streams.
 */
export function advanceTranscript(cursor: TranscriptCursor, events: readonly RunEvent[]): TranscriptCursor {
  if (cursor.count > 0) {
    const tip = events[cursor.count - 1];
    if (events.length < cursor.count || !tip || tip.seq !== cursor.lastSeq) {
      cursor = createTranscriptCursor();
    }
  }
  if (events.length === cursor.count) {
    return cursor;
  }
  // Copy-on-write: only clone the list (and a mutated tip) when the suffix writes.
  const items = cursor.items.slice();
  const toolIndex = new Map(cursor.toolIndex);
  for (let index = cursor.count; index < events.length; index += 1) {
    applyEvent(items, toolIndex, events[index]!);
  }
  const last = events[events.length - 1];
  return {
    items,
    toolIndex,
    count: events.length,
    lastSeq: last?.seq ?? 0,
  };
}

function applyEvent(items: TranscriptItem[], toolIndex: Map<string, number>, event: RunEvent): void {
  switch (event.kind) {
    case "thinking":
    case "text": {
      const last = items.at(-1);
      if (last?.type === event.kind) {
        // Streamed fragments continue the previous text exactly; whole messages get a line break between them.
        const text = event.delta ? last.text + event.text : joinText(last.text, event.text);
        items[items.length - 1] = { ...last, text };
      } else {
        items.push({ type: event.kind, text: event.text, seq: event.seq });
      }
      break;
    }
    case "tool": {
      const tool = event.tool ?? legacyTool(event.text, event.seq, items);
      if (!tool) {
        break;
      }
      const existing = toolIndex.get(tool.id);
      if (existing !== undefined) {
        const item = items[existing];
        if (item?.type === "tool") {
          items[existing] = { ...item, tool: { ...item.tool, ...tool } };
        }
      } else {
        toolIndex.set(tool.id, items.length);
        items.push({ type: "tool", tool, seq: event.seq });
      }
      break;
    }
    case "status":
      if (!isNoisyStatus(event.text)) {
        items.push({ type: "status", text: event.text, seq: event.seq });
      }
      break;
    case "stderr":
    case "raw":
      items.push({ type: event.kind, text: event.text, seq: event.seq });
      break;
    case "result":
      break;
  }
}

/** Split items into the collapsible work section and the final answer, grouping rows for display. */
export function summarizeTranscript(items: readonly TranscriptItem[], previous?: Transcript | null): Transcript {
  let lastWork = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.type === "tool" || (item.type === "thinking" && item.text.trim())) {
      lastWork = index;
    }
  }
  const head = items.slice(0, lastWork + 1);
  const tail = items.slice(lastWork + 1);
  const answer = tail
    .filter((item): item is Extract<TranscriptItem, { type: "text" }> => item.type === "text")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
  // Diagnostics that arrive after the answer (stderr on exit, a late status) still belong to the work section.
  const workItems = [...head, ...tail.filter((item) => item.type !== "text")];
  const work = reuseWorkRows(groupRows(workItems), previous?.work);
  const tools = items.filter((item): item is Extract<TranscriptItem, { type: "tool" }> => item.type === "tool").map((item) => item.tool);
  return {
    work,
    answer,
    toolCount: tools.length,
    running: tools.filter((tool) => tool.status === "running"),
  };
}

function groupRows(items: readonly TranscriptItem[]): WorkRow[] {
  const rows: WorkRow[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    switch (item.type) {
      case "tool": {
        const kind = item.tool.kind;
        if (GROUPABLE.has(kind)) {
          if (last?.type === "tools" && last.kind === kind) {
            last.tools.push(item.tool);
            break;
          }
          if (last?.type === "tool" && last.tool.kind === kind) {
            rows[rows.length - 1] = { type: "tools", kind, tools: [last.tool, item.tool], seq: last.seq };
            break;
          }
        }
        rows.push({ type: "tool", tool: item.tool, seq: item.seq });
        break;
      }
      case "stderr":
      case "raw": {
        if (last?.type === item.type) {
          last.lines.push(item.text);
        } else {
          rows.push({ type: item.type, lines: [item.text], seq: item.seq });
        }
        break;
      }
      default:
        rows.push(item);
    }
  }
  return rows;
}

/** Keep prior WorkRow object identity when the grouped content did not change. */
function reuseWorkRows(next: WorkRow[], previous: WorkRow[] | undefined): WorkRow[] {
  if (!previous || previous.length !== next.length) {
    return next;
  }
  let changed = false;
  const out = next.map((row, index) => {
    const prior = previous[index]!;
    if (sameWorkRow(prior, row)) {
      return prior;
    }
    changed = true;
    return row;
  });
  return changed ? out : previous;
}

function sameWorkRow(a: WorkRow, b: WorkRow): boolean {
  if (a.type !== b.type || a.seq !== b.seq) {
    return false;
  }
  switch (a.type) {
    case "tool":
      return b.type === "tool" && a.tool === b.tool;
    case "tools":
      return b.type === "tools" && a.kind === b.kind && a.tools.length === b.tools.length && a.tools.every((tool, index) => tool === b.tools[index]);
    case "thinking":
    case "text":
    case "status":
      return b.type === a.type && a.text === b.text;
    case "stderr":
    case "raw":
      return b.type === a.type && a.lines.length === b.lines.length && a.lines.every((line, index) => line === b.lines[index]);
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the rows
// ---------------------------------------------------------------------------

const VERBS: Record<ToolKind, { running: string; done: string }> = {
  shell: { running: "运行", done: "运行了" },
  read: { running: "读取", done: "读取了" },
  edit: { running: "编辑", done: "编辑了" },
  write: { running: "写入", done: "写入了" },
  delete: { running: "删除", done: "删除了" },
  glob: { running: "查找", done: "查找了" },
  grep: { running: "搜索", done: "搜索了" },
  ls: { running: "列出", done: "列出了" },
  web: { running: "查询", done: "查询了" },
  task: { running: "子任务", done: "子任务" },
  todo: { running: "更新待办", done: "更新了待办" },
  mcp: { running: "调用", done: "调用了" },
  other: { running: "调用", done: "调用了" },
};

const GROUP_NOUNS: Record<ToolKind, string> = {
  shell: "条命令",
  read: "个文件",
  edit: "处",
  write: "个文件",
  delete: "个文件",
  glob: "次",
  grep: "次",
  ls: "个目录",
  web: "次",
  task: "个子任务",
  todo: "次",
  mcp: "次",
  other: "次",
};

export function toolVerb(tool: Pick<ToolCall, "kind" | "status">): string {
  const verbs = VERBS[tool.kind];
  return tool.status === "running" ? verbs.running : verbs.done;
}

/** "读取了 4 个文件" / "搜索了 3 次" */
export function groupLabel(kind: ToolKind, count: number, running: boolean): string {
  const verbs = VERBS[kind];
  return `${running ? verbs.running : verbs.done} ${count} ${GROUP_NOUNS[kind]}`;
}

/** Short, plain name for a tool the app does not otherwise recognise. */
export function prettyToolName(name: string): string {
  const id = name.replace(/ToolCall$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return id ? id.charAt(0).toLowerCase() + id.slice(1) : "tool";
}

export function statusLabel(tool: ToolCall): string {
  switch (tool.status) {
    case "running":
      return "进行中";
    case "rejected":
      return "被拦截";
    case "error":
      return tool.exitCode !== undefined && tool.exitCode !== 0 ? `退出码 ${tool.exitCode}` : "失败";
    default:
      return "";
  }
}

export function isFailed(status: ToolStatus): boolean {
  return status === "error" || status === "rejected";
}

/** Anything worth opening the row for. */
export function hasDetail(tool: ToolCall): boolean {
  return Boolean(tool.output || tool.diff || tool.input || tool.error || (tool.files && tool.files.length > 1));
}

/** Marker `clipHead` leaves when output was cut short, as a trailing line. */
const CLIP_NOTE = /\n?… 已省略 \d+ 个字符$/;
const CLIP_NOTE_LINE = /^… 已省略 \d+ 个字符$/;

/**
 * A call as it should be shown. Logs written before the parser knew
 * cursor-agent's result shapes kept the raw JSON — `{"content":"…"}` for a
 * read, `{"totalMatches":…}` for a search — and are unwrapped here.
 */
export function displayTool(tool: ToolCall): ToolCall {
  let next = tool;
  if (tool.kind === "shell" && tool.output) {
    const cleaned = stripAnsi(tool.output);
    if (cleaned !== tool.output) {
      next = { ...tool, output: cleaned };
    }
  }
  if (next.output?.startsWith("{")) {
    const parsed = wholeJson(next.output);
    const known = parsed ? describeRawResult(parsed) : null;
    if (known) {
      next = {
        ...next,
        output: known.output,
        error: next.error ?? known.error,
        status: known.status === "error" && next.status === "ok" ? "error" : next.status,
      };
    } else {
      const content = clippedContent(next.output);
      next = content === null ? next : { ...next, output: content };
    }
  }
  return refineDisplayedDiff(next);
}

/** Logs that stored a whole-file dump still open as the few changed lines. */
function refineDisplayedDiff(tool: ToolCall): ToolCall {
  if (!tool.diff) {
    return tool;
  }
  const refined = refineRewriteDiff(tool.diff);
  if (refined === tool.diff) {
    return tool;
  }
  const counts = countChanges(refined);
  return { ...tool, diff: refined, linesAdded: counts.added, linesRemoved: counts.removed };
}

/** Only a complete object counts here: salvaged fragments of a file's text could look like a result. */
function wholeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `{"content":"…` cut off mid-string by the output limit: decode what is there. */
function clippedContent(output: string): string | null {
  const head = /^\{\s*"content"\s*:\s*"/.exec(output);
  if (!head) {
    return null;
  }
  const note = CLIP_NOTE.exec(output);
  let body = output.slice(head[0].length, note ? note.index : undefined);
  // The cut may have landed inside an escape sequence (`\uXXXX` at worst).
  for (let attempt = 0; attempt < 6 && body; attempt += 1) {
    try {
      return `${JSON.parse(`"${body}"`) as string}${note ? `\n${note[0].trim()}` : ""}`;
    } catch {
      body = body.slice(0, -1);
    }
  }
  return null;
}

export interface DiffLine {
  tag: "add" | "del" | "ctx" | "hunk" | "meta" | "note";
  /** Content without the leading `+`/`-`/space marker. */
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Lines of a unified diff, tagged for colouring and numbered from the hunk headers. */
export function diffLines(diff: string): DiffLine[] {
  const lines = refineRewriteDiff(diff).replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const out: DiffLine[] = [];
  let oldNo: number | undefined;
  let newNo: number | undefined;
  let inBody = false;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inBody = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      out.push({ tag: "hunk", text: line });
      continue;
    }
    if (!inBody && (line.startsWith("---") || line.startsWith("+++"))) {
      // A headed diff without hunks is a whole new (or deleted) file.
      if (line.startsWith("--- /dev/null")) {
        newNo = 1;
      } else if (line.startsWith("+++ /dev/null")) {
        oldNo = 1;
      }
      out.push({ tag: "meta", text: line });
      continue;
    }
    if (CLIP_NOTE_LINE.test(line)) {
      out.push({ tag: "note", text: line });
      continue;
    }
    inBody = true;
    if (line.startsWith("+")) {
      out.push({ tag: "add", text: line.slice(1), newNo });
      newNo = newNo === undefined ? undefined : newNo + 1;
    } else if (line.startsWith("-")) {
      out.push({ tag: "del", text: line.slice(1), oldNo });
      oldNo = oldNo === undefined ? undefined : oldNo + 1;
    } else {
      out.push({ tag: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, oldNo, newNo });
      oldNo = oldNo === undefined ? undefined : oldNo + 1;
      newNo = newNo === undefined ? undefined : newNo + 1;
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// Legacy: logs written before tool events carried structured data
// ---------------------------------------------------------------------------

/**
 * Old logs only have a text line per tool event: "glob {…args…}" when a call
 * starts and "完成 glob: {…result…}" when it ends (or "$ npm test" and
 * "命令结束 (exit 0)" in the oldest ones). The JSON was often cut short and
 * the call ids were lost, so arguments are salvaged as far as they go and a
 * completion is paired with the oldest still-running call of the same name.
 */
function legacyTool(text: string, seq: number, items: readonly TranscriptItem[]): ToolCall | null {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return null;
  }
  const done = /^完成 ([A-Za-z][\w.-]*)[:：]\s*([\s\S]*)$/.exec(trimmed);
  if (done) {
    const open = oldestRunningLegacy(items, done[1]!);
    if (!open) {
      return null;
    }
    return { ...open, ...describeCursorResult(open.kind, legacyResult(done[2]!)) };
  }
  if (/^(结果:|命令结束)/.test(trimmed)) {
    const open = oldestRunningLegacy(items);
    if (!open) {
      return null;
    }
    const exit = /\(exit (-?\d+)\)/.exec(trimmed);
    const exitCode = exit ? Number(exit[1]) : undefined;
    return {
      ...open,
      status: exitCode !== undefined && exitCode !== 0 ? "error" : "ok",
      exitCode,
      output: trimmed.replace(/^(结果:\s*|命令结束[^\n]*\n?)/, "") || undefined,
    };
  }
  if (trimmed.startsWith("$ ")) {
    const [command = "", ...rest] = trimmed.slice(2).split("\n");
    return { id: `legacy-${seq}`, name: "shell", kind: "shell", status: "running", command, subject: command, output: rest.join("\n") || undefined };
  }
  const named = /^([A-Za-z][\w.-]*)\s+([\s\S]*)$/.exec(trimmed);
  const name = named?.[1] ?? "tool";
  const detail = named?.[2] ?? trimmed;
  const args = looseJson(detail);
  if (args) {
    return { id: `legacy-${seq}`, status: "running", ...describeArgs(name, args) };
  }
  return {
    id: `legacy-${seq}`,
    name,
    kind: "other",
    status: "running",
    subject: detail.replace(/\s+/g, " ").slice(0, 80),
    input: detail,
  };
}

function oldestRunningLegacy(items: readonly TranscriptItem[], name?: string): ToolCall | undefined {
  const running = items
    .filter((item): item is Extract<TranscriptItem, { type: "tool" }> => item.type === "tool" && item.tool.status === "running" && item.tool.id.startsWith("legacy-"))
    .map((item) => item.tool);
  return (name && running.find((tool) => tool.name === name)) || running[0];
}

/**
 * cursor-agent's result wrapper `{ success | rejected | error: {…} }`, rebuilt
 * from a possibly truncated line: the outcome is the first key, the body is
 * whatever complete fields survived.
 */
function legacyResult(text: string): unknown {
  const parsed = looseJson(text);
  const outcome = /^\{\s*"(success|rejected|error|failure)"/.exec(text.trim())?.[1];
  if (!outcome) {
    return parsed;
  }
  if (parsed && outcome in parsed) {
    return parsed;
  }
  return { [outcome]: parsed ?? {} };
}

function joinText(left: string, right: string): string {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (left.endsWith("\n") || right.startsWith("\n")) {
    return left + right;
  }
  return `${left}\n${right}`;
}
