import type { ToolCall, ToolKind, ToolStatus } from "./protocol";

// How a tool call's arguments and result become a ToolCall, independent of the
// CLI that produced them. Used by the main-process parsers as the JSONL
// streams in, and by the renderer to make sense of logs written before tool
// events carried structured data. Only type imports so `node --test` can load
// it without a bundler.

/** Longest tool output kept per event; shell output keeps its tail, everything else its head. */
export const MAX_TOOL_OUTPUT = 8_000;
export const MAX_TOOL_INPUT = 1_500;
export const MAX_TOOL_FILES = 200;

/** Map whatever a CLI calls a tool onto our small set of kinds. */
export function toolKindOf(rawName: string): ToolKind {
  const id = rawName
    .trim()
    .replace(/ToolCall$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  if (/^(shell|bash|run_command|run_terminal_cmd|command_execution|execute|terminal|powershell|cmd|exec)$/.test(id)) {
    return "shell";
  }
  if (/^(read|read_file|readfile|view|cat|view_file|read_files)$/.test(id)) {
    return "read";
  }
  if (/^(write|write_file|writefile|create_file|create|save_file)$/.test(id)) {
    return "write";
  }
  if (/^(edit|edit_file|editfile|str_replace|strreplace|str_replace_editor|apply_patch|multi_edit|multiedit|search_replace|patch|notebook_edit)$/.test(id)) {
    return "edit";
  }
  if (/^(delete|delete_file|deletefile|remove|rm)$/.test(id)) {
    return "delete";
  }
  if (/^(glob|find_files|file_search|find)$/.test(id)) {
    return "glob";
  }
  if (/^(grep|search|codebase_search|sem_search|semsearch|ripgrep|grep_search|search_files|search_code)$/.test(id)) {
    return "grep";
  }
  if (/^(ls|list_dir|list|list_directory|listdir|tree)$/.test(id)) {
    return "ls";
  }
  if (/^(web_search|websearch|search_web|fetch|web_fetch|webfetch|fetch_url|browse|read_url|http)$/.test(id)) {
    return "web";
  }
  if (/^(task|agent|subagent|sub_agent|spawn_agent)$/.test(id)) {
    return "task";
  }
  if (/^(todo|todo_write|todowrite|todo_list|update_todos|todo_read|todoread|update_plan|plan)$/.test(id)) {
    return "todo";
  }
  if (/^(mcp|mcp_tool_call|mcp_tool)$/.test(id) || id.startsWith("mcp_")) {
    return "mcp";
  }
  return "other";
}

const PATH_KEYS = ["path", "file_path", "filePath", "target_file", "targetFile", "relativeWorkspacePath", "relative_workspace_path", "file", "filename", "notebook_path"];
const DIR_KEYS = ["targetDirectory", "target_directory", "workingDirectory", "working_directory", "cwd", "dir", "directory", "path"];
const PATTERN_KEYS = ["globPattern", "glob_pattern", "pattern", "query", "regex", "search"];
const WEB_KEYS = ["query", "url", "search_term", "searchTerm", "q"];

/** Turn a call's arguments into subject/command/input, independent of which CLI produced them. */
export function describeArgs(
  rawName: string,
  args: Record<string, unknown>,
  description?: string,
  kindOverride?: ToolKind,
): Partial<ToolCall> & Pick<ToolCall, "name" | "kind"> {
  const kind = kindOverride && kindOverride !== "other" ? kindOverride : toolKindOf(rawName);
  const call: Partial<ToolCall> & Pick<ToolCall, "name" | "kind"> = { name: rawName, kind };
  const desc = description ?? pickString(args, ["description", "explanation"]);
  if (desc) {
    call.description = desc;
  }
  switch (kind) {
    case "shell": {
      const command = pickString(args, ["command", "cmd", "script"]);
      call.command = command || undefined;
      call.subject = command || undefined;
      call.cwd = pickString(args, DIR_KEYS.filter((key) => key !== "path")) || undefined;
      break;
    }
    case "read":
    case "write":
    case "edit":
    case "delete": {
      const path = pickString(args, PATH_KEYS);
      call.subject = path ? basenameOf(path) : undefined;
      call.files = path ? [path] : undefined;
      break;
    }
    case "ls": {
      const path = pickString(args, DIR_KEYS);
      call.subject = path || undefined;
      call.cwd = path || undefined;
      break;
    }
    case "glob":
    case "grep": {
      call.subject = pickString(args, PATTERN_KEYS) || undefined;
      call.cwd = pickString(args, DIR_KEYS) || undefined;
      break;
    }
    case "web":
      call.subject = pickString(args, WEB_KEYS) || undefined;
      break;
    case "task":
      call.subject = pickString(args, ["description", "title"]) || firstLine(pickString(args, ["prompt", "task"])) || undefined;
      break;
    case "todo": {
      const todos = asArray(args.todos ?? args.items ?? args.plan)
        .filter(isRecord)
        .map((todo) => {
          const status = String(todo.status ?? "");
          const mark = status === "completed" || todo.completed === true ? "☑" : status === "in_progress" ? "◐" : "☐";
          return `${mark} ${String(todo.content ?? todo.text ?? todo.step ?? todo.title ?? "")}`;
        });
      call.subject = todos.length ? `${todos.length} 项` : undefined;
      call.output = todos.join("\n") || undefined;
      break;
    }
    case "mcp":
      call.subject = pickString(args, ["tool", "name", "toolName", "tool_name"]) || undefined;
      break;
    default: {
      const hint = pickString(args, [...PATH_KEYS, ...PATTERN_KEYS, ...WEB_KEYS, "command", "name", "title"]);
      call.subject = hint || undefined;
    }
  }
  if (!call.subject && !call.command && Object.keys(args).length) {
    call.input = clipHead(prettyArgs(args), MAX_TOOL_INPUT);
  }
  return call;
}

/** cursor-agent wraps results as { success | failure | error | rejected: {...} }. */
export function describeCursorResult(kind: ToolKind, result: unknown): Partial<ToolCall> {
  if (!isRecord(result)) {
    return { status: "ok" };
  }
  const outcome = Object.keys(result)[0] ?? "success";
  const body = isRecord(result[outcome]) ? (result[outcome] as Record<string, unknown>) : {};
  const status: ToolStatus = outcome === "success" ? "ok" : outcome === "rejected" ? "rejected" : "error";
  const patch: Partial<ToolCall> = { status };
  if (status === "rejected") {
    patch.error = pickString(body, ["reason", "message"]) || "命令被拒绝";
    return patch;
  }
  switch (kind) {
    case "shell": {
      const stdout = pickString(body, ["interleavedOutput", "stdout", "output"]);
      const stderr = pickString(body, ["stderr"]);
      const combined = stdout && stderr && !stdout.includes(stderr) ? `${stdout}\n${stderr}` : stdout || stderr;
      patch.output = combined.trim() ? clipTail(combined) : undefined;
      patch.exitCode = typeof body.exitCode === "number" ? body.exitCode : undefined;
      if (status === "ok" && patch.exitCode !== undefined && patch.exitCode !== 0) {
        patch.status = "error";
      }
      if (body.aborted === true) {
        patch.error = "命令被中止";
      }
      break;
    }
    case "edit":
    case "write": {
      patch.diff = typeof body.diffString === "string" && body.diffString.trim() ? clipHead(body.diffString) : undefined;
      patch.linesAdded = typeof body.linesAdded === "number" ? body.linesAdded : undefined;
      patch.linesRemoved = typeof body.linesRemoved === "number" ? body.linesRemoved : undefined;
      if (typeof body.path === "string" && body.path) {
        patch.files = [body.path];
      }
      break;
    }
    case "read": {
      patch.output = typeof body.content === "string" ? clipHead(body.content) : undefined;
      break;
    }
    case "glob":
    case "ls": {
      const files = asArray(body.files ?? body.entries ?? body.results)
        .map((item) => (typeof item === "string" ? cleanGlobPath(item) : isRecord(item) ? String(item.path ?? item.name ?? "") : ""))
        .filter(Boolean);
      if (files.length) {
        patch.files = files.slice(0, MAX_TOOL_FILES);
        const total = typeof body.totalFiles === "number" ? body.totalFiles : files.length;
        patch.output = `${files.slice(0, MAX_TOOL_FILES).join("\n")}${total > MAX_TOOL_FILES ? `\n… 共 ${total} 个` : ""}`;
      } else if (typeof body.content === "string") {
        patch.output = clipHead(body.content);
      }
      break;
    }
    case "task": {
      const steps = asArray(body.conversationSteps).filter(isRecord);
      const answer = [...steps].reverse().find((step) => isRecord(step.assistantMessage) && typeof step.assistantMessage.text === "string");
      const text = answer && isRecord(answer.assistantMessage) ? String(answer.assistantMessage.text) : pickString(body, ["result", "text", "output"]);
      patch.output = text ? clipHead(text) : undefined;
      break;
    }
    default: {
      const text = pickString(body, ["content", "text", "output", "result", "message"]);
      patch.output = text ? clipHead(text) : Object.keys(body).length ? clipHead(prettyArgs(body)) : undefined;
    }
  }
  if (status === "error") {
    const nested = isRecord(body.error) ? pickString(body.error, ["error", "message"]) : "";
    patch.error = nested || pickString(body, ["error", "message", "reason", "stderr"]) || `${outcome}`;
    if (kind === "shell" && !patch.output && patch.error) {
      patch.output = clipTail(patch.error);
    }
  }
  return patch;
}

/**
 * The result objects cursor-agent's built-in tools hand back over ACP as
 * `rawOutput`: a read is `{ content }`, grep `{ totalMatches, truncated }`,
 * find `{ totalFiles, truncated }`, and a tool that failed on its own
 * `{ error }`. Null for any other shape, so the caller can fall back to
 * showing the JSON.
 */
export function describeRawResult(result: Record<string, unknown>): Partial<ToolCall> | null {
  const values = Object.values(result);
  if (typeof result.content === "string" && values.every((value) => !isRecord(value) && !Array.isArray(value))) {
    return { output: clipHead(result.content) };
  }
  if (typeof result.totalMatches === "number") {
    return { output: `${result.totalMatches} 处匹配${result.truncated === true ? "（结果已截断）" : ""}` };
  }
  if (typeof result.totalFiles === "number") {
    return { output: `${result.totalFiles} 个文件${result.truncated === true ? "（结果已截断）" : ""}` };
  }
  if (typeof result.error === "string" && result.error.trim() && values.length === 1) {
    return { status: "error", error: result.error };
  }
  return null;
}

/** cursor-agent's glob results come back as "../.\src\App.jsx" style paths. */
export function cleanGlobPath(path: string): string {
  return path.replace(/^\.\.[\\/]/, "").replace(/^\.[\\/]/, "");
}

/**
 * Best-effort object from JSON that may have been cut short: old logs kept
 * only the first few hundred characters of a call's arguments. Whole JSON
 * parses as-is; otherwise every complete `"key":"string"` pair is recovered.
 */
export function looseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    // fall through to the salvage path
  }
  const out: Record<string, unknown> = {};
  const pair = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of trimmed.matchAll(pair)) {
    const key = match[1]!;
    if (key in out) {
      continue;
    }
    try {
      out[key] = JSON.parse(`"${match[2]!}"`);
    } catch {
      out[key] = match[2]!;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function prettyArgs(args: Record<string, unknown>): string {
  const shallow: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    shallow[key] = value;
  }
  try {
    return JSON.stringify(shallow, null, 2);
  } catch {
    return String(args);
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function basenameOf(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return index >= 0 ? cleaned.slice(index + 1) || cleaned : cleaned;
}

export function firstLine(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim())?.trim() ?? "";
}

export function compact(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function clipHead(value: string, max = MAX_TOOL_OUTPUT): string {
  const text = value.replace(/\r\n/g, "\n");
  return text.length > max ? `${text.slice(0, max)}\n… 已省略 ${text.length - max} 个字符` : text;
}

export function clipTail(value: string, max = MAX_TOOL_OUTPUT): string {
  const text = value.replace(/\r\n/g, "\n");
  return text.length > max ? `… 已省略前 ${text.length - max} 个字符\n${text.slice(text.length - max)}` : text;
}
