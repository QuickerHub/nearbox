import type { RunEvent, ToolCall, ToolKind, ToolStatus } from "../../../shared/protocol";
import { describeArgs, describeCursorResult, looseJson } from "../../../shared/tools.ts";

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

/**
 * Turn the raw event stream into ordered items. Tool events that share an id
 * collapse into one item that keeps the position of the first and the state
 * of the latest; text and thinking deltas merge with their neighbours.
 */
export function buildTranscript(events: readonly RunEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolIndex = new Map<string, number>();
  for (const event of events) {
    switch (event.kind) {
      case "thinking":
      case "text": {
        const last = items.at(-1);
        if (last?.type === event.kind) {
          last.text = joinText(last.text, event.text);
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
            item.tool = { ...item.tool, ...tool };
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
  return items;
}

/** Split items into the collapsible work section and the final answer, grouping rows for display. */
export function summarizeTranscript(items: readonly TranscriptItem[]): Transcript {
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
  const work = groupRows([...head, ...tail.filter((item) => item.type !== "text")]);
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

/** Lines of a unified diff, tagged for colouring. */
export function diffLines(diff: string): { tag: "add" | "del" | "hunk" | "meta" | "ctx"; text: string }[] {
  return diff
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line, index, all) => !(index === all.length - 1 && line === ""))
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) {
        return { tag: "meta" as const, text: line };
      }
      if (line.startsWith("@@")) {
        return { tag: "hunk" as const, text: line };
      }
      if (line.startsWith("+")) {
        return { tag: "add" as const, text: line };
      }
      if (line.startsWith("-")) {
        return { tag: "del" as const, text: line };
      }
      return { tag: "ctx" as const, text: line };
    });
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
