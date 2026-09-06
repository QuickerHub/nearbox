import type { RunEvent } from "../../../shared/protocol";

export type ToolKind = "shell" | "file" | "search" | "generic";
export type ToolStatus = "running" | "done" | "error";

export interface ParsedTool {
  kind: ToolKind;
  name: string;
  rawName: string;
  status: ToolStatus;
  meta: string;
  command?: string;
  output?: string;
  detail?: string;
  exitCode?: number;
}

export type TranscriptItem =
  | { type: "status"; text: string; seq: number }
  | { type: "thinking"; text: string; seq: number }
  | { type: "tool"; tool: ParsedTool; seq: number }
  | { type: "text"; text: string; seq: number }
  | { type: "stderr"; text: string; seq: number }
  | { type: "raw"; text: string; seq: number }
  | { type: "result"; text: string; error: boolean; seq: number };

const TOOL_LABELS: Record<string, { label: string; kind: ToolKind }> = {
  read: { label: "读取文件", kind: "file" },
  read_file: { label: "读取文件", kind: "file" },
  readfile: { label: "读取文件", kind: "file" },
  write: { label: "写入文件", kind: "file" },
  write_file: { label: "写入文件", kind: "file" },
  writefile: { label: "写入文件", kind: "file" },
  edit: { label: "编辑文件", kind: "file" },
  edit_file: { label: "编辑文件", kind: "file" },
  strreplace: { label: "编辑文件", kind: "file" },
  apply_patch: { label: "应用补丁", kind: "file" },
  delete: { label: "删除文件", kind: "file" },
  delete_file: { label: "删除文件", kind: "file" },
  glob: { label: "查找文件", kind: "file" },
  find_files: { label: "查找文件", kind: "file" },
  ls: { label: "列出目录", kind: "file" },
  list_dir: { label: "列出目录", kind: "file" },
  grep: { label: "搜索内容", kind: "search" },
  search: { label: "搜索内容", kind: "search" },
  codebase_search: { label: "搜索内容", kind: "search" },
  web_search: { label: "网页搜索", kind: "search" },
  websearch: { label: "网页搜索", kind: "search" },
  shell: { label: "终端", kind: "shell" },
  bash: { label: "终端", kind: "shell" },
  run_command: { label: "终端", kind: "shell" },
  command_execution: { label: "终端", kind: "shell" },
  todo_list: { label: "待办", kind: "generic" },
  mcp_tool_call: { label: "MCP", kind: "generic" },
};

const NOISY_STATUS = /^(已连接|已收到任务|开始处理|会话已创建|step|session)/i;

interface ToolParse {
  phase: "start" | "complete" | "result";
  kind?: ToolKind;
  rawName?: string;
  status?: ToolStatus;
  meta?: string;
  command?: string;
  output?: string;
  detail?: string;
  exitCode?: number;
}

export function normalizeToolId(name: string): string {
  return name
    .trim()
    .replace(/ToolCall$/i, "")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function toolLabel(rawName: string): string {
  const id = normalizeToolId(rawName);
  return TOOL_LABELS[id]?.label ?? rawName.replace(/_/g, " ");
}

export function toolKind(rawName: string, fallback?: ToolKind): ToolKind {
  const id = normalizeToolId(rawName);
  return TOOL_LABELS[id]?.kind ?? fallback ?? "generic";
}

export function fileActionLabel(rawName: string, status: ToolStatus): string {
  const id = normalizeToolId(rawName);
  const writing = /write/.test(id);
  const editing = /edit|strreplace|patch|delete/.test(id);
  const listing = /glob|find|ls|list/.test(id);
  if (status === "running") {
    if (writing) return "写入";
    if (editing) return "编辑";
    if (listing) return "查找";
    return "读取";
  }
  if (writing) return "已写入";
  if (editing) return "已编辑";
  if (listing) return "已查找";
  return "已读取";
}

export function parseToolLine(text: string): ToolParse {
  const trimmed = text.replace(/\r\n/g, "\n").trimEnd();
  if (trimmed.startsWith("$ ")) {
    const [command, ...rest] = trimmed.slice(2).split("\n");
    return {
      phase: "start",
      kind: "shell",
      rawName: "run_command",
      status: "running",
      command,
      output: rest.join("\n") || undefined,
      meta: clip(command ?? "", 72),
    };
  }

  const ended = /^命令结束(?: \(exit (-?\d+)\))?(?:\n([\s\S]*))?$/.exec(trimmed);
  if (ended) {
    const exitCode = ended[1] === undefined ? undefined : Number(ended[1]);
    const failed = exitCode !== undefined && exitCode !== 0;
    return {
      phase: "complete",
      kind: "shell",
      rawName: "run_command",
      status: failed ? "error" : "done",
      exitCode,
      output: ended[2] || undefined,
      meta: failed ? `exit ${exitCode}` : exitCode === undefined ? "完成" : "成功",
    };
  }

  const done = /^完成\s+([^:：]+)[:：]\s*([\s\S]*)$/.exec(trimmed);
  if (done) {
    const rawName = done[1]!.trim();
    const detail = done[2] ?? "";
    return {
      phase: "complete",
      rawName,
      kind: toolKind(rawName),
      status: "done",
      detail,
      meta: peekMeta(rawName, detail),
    };
  }

  if (trimmed.startsWith("结果:")) {
    return { phase: "result", output: trimmed.slice(3).trim(), status: "done" };
  }

  if (trimmed.startsWith("修改文件")) {
    const body = trimmed.replace(/^修改文件\s*\n?/, "").trim();
    return {
      phase: "complete",
      kind: "file",
      rawName: "edit_file",
      status: "done",
      meta: firstPath(body) || clip(body, 72),
      detail: body,
    };
  }

  if (trimmed.startsWith("修改 ")) {
    const body = trimmed.slice(3).trim();
    return {
      phase: "complete",
      kind: "file",
      rawName: "edit_file",
      status: "done",
      meta: clip(body, 72),
      detail: body,
    };
  }

  const started = /^([A-Za-z][\w./-]*)(?:\s+(running|completed|pending|error))?\s+([\s\S]+)$/.exec(trimmed);
  if (started) {
    const rawName = started[1]!;
    const word = started[2];
    const rest = started[3] ?? "";
    const status: ToolStatus = word === "error" ? "error" : word === "completed" ? "done" : "running";
    return {
      phase: word === "completed" || word === "error" ? "complete" : "start",
      rawName,
      kind: toolKind(rawName),
      status,
      detail: rest,
      meta: peekMeta(rawName, rest),
    };
  }

  return { phase: "start", rawName: "tool", status: "running", meta: clip(trimmed, 72), detail: trimmed };
}

export function buildTranscript(events: readonly RunEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const event of events) {
    if (event.kind === "thinking") {
      const last = items.at(-1);
      if (last?.type === "thinking") {
        last.text += last.text && !last.text.endsWith("\n") && !event.text.startsWith("\n") ? event.text : event.text;
      } else {
        items.push({ type: "thinking", text: event.text, seq: event.seq });
      }
      continue;
    }
    if (event.kind === "text") {
      const last = items.at(-1);
      if (last?.type === "text") {
        last.text = joinText(last.text, event.text);
      } else {
        items.push({ type: "text", text: event.text, seq: event.seq });
      }
      continue;
    }
    if (event.kind === "tool") {
      const parsed = parseToolLine(event.text);
      const last = items.at(-1);
      if (last?.type === "tool" && canMerge(last.tool, parsed)) {
        mergeTool(last.tool, parsed);
        last.seq = event.seq;
      } else {
        if (last?.type === "tool" && last.tool.status === "running") {
          last.tool.status = "done";
        }
        items.push({ type: "tool", tool: toTool(parsed), seq: event.seq });
      }
      continue;
    }
    if (event.kind === "status") {
      items.push({ type: "status", text: event.text, seq: event.seq });
      continue;
    }
    if (event.kind === "stderr") {
      items.push({ type: "stderr", text: event.text, seq: event.seq });
      continue;
    }
    if (event.kind === "raw") {
      items.push({ type: "raw", text: event.text, seq: event.seq });
      continue;
    }
    if (event.kind === "result") {
      items.push({ type: "result", text: event.text, error: /失败|错误|error/i.test(event.text), seq: event.seq });
    }
  }
  return items;
}

export function splitWork(items: readonly TranscriptItem[]): {
  work: TranscriptItem[];
  summary: TranscriptItem[];
  trailing: TranscriptItem[];
  toolCount: number;
} {
  const body: TranscriptItem[] = [];
  const trailing: TranscriptItem[] = [];
  for (const item of items) {
    if (item.type === "result") {
      trailing.push(item);
    } else {
      body.push(item);
    }
  }

  let lastWork = -1;
  let toolCount = 0;
  for (let i = 0; i < body.length; i += 1) {
    const item = body[i]!;
    if (item.type === "tool") {
      toolCount += 1;
      lastWork = i;
    } else if (item.type === "thinking" && item.text.trim()) {
      lastWork = i;
    }
  }

  if (lastWork < 0 || toolCount === 0) {
    return { work: [], summary: body, trailing, toolCount };
  }

  return {
    work: body.slice(0, lastWork + 1).filter(visibleInWork),
    summary: body.slice(lastWork + 1),
    trailing,
    toolCount,
  };
}

export function isNoisyStatus(text: string): boolean {
  return NOISY_STATUS.test(text.trim());
}

function visibleInWork(item: TranscriptItem): boolean {
  return item.type !== "status" || !isNoisyStatus(item.text);
}

function canMerge(tool: ParsedTool, next: ToolParse): boolean {
  if (next.phase === "result") {
    return true;
  }
  if (next.phase !== "complete") {
    return false;
  }
  if (tool.status !== "running" && next.rawName && normalizeToolId(next.rawName) !== normalizeToolId(tool.rawName)) {
    return false;
  }
  if (next.kind && tool.kind !== "generic" && next.kind !== tool.kind) {
    return tool.kind === "shell" && next.kind === "shell";
  }
  return true;
}

function mergeTool(tool: ParsedTool, next: ToolParse): void {
  if (next.command && !tool.command) {
    tool.command = next.command;
  }
  if (next.output) {
    tool.output = tool.output ? `${tool.output}\n${next.output}` : next.output;
  }
  if (next.detail) {
    tool.detail = tool.detail && tool.detail !== next.detail ? `${tool.detail}\n${next.detail}` : next.detail;
  }
  if (next.exitCode !== undefined) {
    tool.exitCode = next.exitCode;
  }
  if (next.kind && tool.kind === "generic") {
    tool.kind = next.kind;
  }
  if (next.rawName && tool.rawName === "tool") {
    tool.rawName = next.rawName;
    tool.name = toolLabel(next.rawName);
  }
  if (next.meta && (next.phase === "complete" || !tool.meta || tool.meta === "…")) {
    if (tool.kind === "file" && tool.meta && next.phase === "complete") {
      // keep the path from the start event
    } else if (tool.command) {
      tool.meta = next.meta;
    } else if (!looksLikeJsonBlob(next.meta) || !tool.meta) {
      tool.meta = next.meta;
    }
  }
  if (next.status) {
    tool.status = next.status;
  } else if (next.phase === "complete" || next.phase === "result") {
    tool.status = tool.status === "error" ? "error" : "done";
  }
}

function toTool(parsed: ToolParse): ParsedTool {
  const rawName = parsed.rawName ?? "tool";
  return {
    kind: parsed.kind ?? toolKind(rawName),
    name: toolLabel(rawName),
    rawName,
    status: parsed.status ?? (parsed.phase === "complete" ? "done" : "running"),
    meta: parsed.meta ?? parsed.command ?? "",
    command: parsed.command,
    output: parsed.output,
    detail: parsed.detail,
    exitCode: parsed.exitCode,
  };
}

function peekMeta(rawName: string, rest: string): string {
  const json = tryJson(rest);
  if (json) {
    const hit = firstPathish(json);
    if (hit) {
      return clip(hit, 72);
    }
  }
  const path = firstPath(rest);
  if (path) {
    return clip(path, 72);
  }
  if (toolKind(rawName) === "shell") {
    const command = json && typeof json.command === "string" ? json.command : rest;
    return clip(command, 72);
  }
  return clip(stripJsonNoise(rest), 72);
}

function firstPathish(value: Record<string, unknown>): string {
  for (const key of ["path", "file", "filename", "target_file", "target", "query", "pattern", "command", "cmd", "url"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  for (const item of Object.values(value)) {
    if (typeof item === "string" && /[\\/]/.test(item) && item.length < 160) {
      return item;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = firstPathish(item as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function firstPath(text: string): string {
  const match = /(?:^|[\s"'=])((?:[A-Za-z]:)?(?:[\\/][\w.\-@]+)+\.[A-Za-z0-9]+|[\w.\-]+(?:[\\/][\w.\-]+)+\.[A-Za-z0-9]+)/.exec(text);
  return match?.[1] ?? "";
}

function tryJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function looksLikeJsonBlob(text: string): boolean {
  return text.trim().startsWith("{") || text.trim().startsWith("[");
}

function stripJsonNoise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
