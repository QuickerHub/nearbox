import type { AgentAccess, AgentKind, RunEventKind } from "@shared/protocol";

// Pure helpers: how each agent CLI is invoked and how its JSONL output is read.
// No Node/Electron imports here so the logic stays unit-testable.

export interface ResolvedCommand {
  /** What we actually spawn. */
  file: string;
  /** Arguments that must precede user arguments (e.g. the script path for node). */
  prefixArgs: string[];
  /** Display string for the settings screen. */
  display: string;
  /** True when the command goes through cmd.exe and needs a single quoted command line. */
  viaCmd: boolean;
}

// ---------------------------------------------------------------------------
// Invocation building
// ---------------------------------------------------------------------------

export interface InvocationRequest {
  prompt: string;
  cwd: string;
  access: AgentAccess;
  model?: string;
  resumeSessionId?: string;
  /** Absolute path of a file the prompt has been written to (for CLIs that prefer files). */
  promptFile: string;
}

export interface Invocation {
  file: string;
  args: string[];
  stdin?: string;
  windowsVerbatimArguments?: boolean;
}

const PROMPT_TOKEN = "\u0000PROMPT\u0000";

/**
 * Prompts are never placed on a cmd.exe command line: they go through stdin,
 * a file, or directly to an .exe/node argv, which Node quotes correctly.
 */
export function buildInvocation(kind: AgentKind, command: ResolvedCommand, request: InvocationRequest): Invocation {
  const built = agentArgs(kind, request);
  if (command.viaCmd) {
    // cmd.exe cannot carry newlines or arbitrary quoting, so the prompt stays in
    // a file and the agent is pointed at it instead.
    const pointer = `请先完整阅读文件 ${request.promptFile} ，然后按其中的任务说明执行。`;
    const userArgs = built.args.map((arg) => (arg === PROMPT_TOKEN ? pointer : arg));
    const commandLine = [command.prefixArgs[0]!, ...userArgs].map(quoteForCmd).join(" ");
    return {
      file: command.file,
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      stdin: built.stdin,
      windowsVerbatimArguments: true,
    };
  }
  const args = built.args.map((arg) => (arg === PROMPT_TOKEN ? request.prompt : arg));
  return { file: command.file, args: [...command.prefixArgs, ...args], stdin: built.stdin };
}

function agentArgs(kind: AgentKind, request: InvocationRequest): { args: string[]; stdin?: string } {
  const { cwd, access, model, resumeSessionId } = request;
  switch (kind) {
    case "cursor": {
      const args = ["-p", "--output-format", "stream-json", "--trust", "--workspace", cwd];
      if (access === "full") {
        args.push("--force");
      }
      if (model) {
        args.push("--model", model);
      }
      if (resumeSessionId) {
        args.push("--resume", resumeSessionId);
      }
      args.push(PROMPT_TOKEN);
      return { args };
    }
    case "codex": {
      const args = ["exec"];
      if (resumeSessionId) {
        args.push("resume", resumeSessionId);
      }
      args.push("--json", "--skip-git-repo-check");
      if (!resumeSessionId) {
        args.push("-C", cwd);
      }
      if (access === "full") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else if (!resumeSessionId) {
        args.push("-s", "workspace-write");
      }
      if (model) {
        args.push("-m", model);
      }
      args.push("-");
      return { args, stdin: request.prompt };
    }
    case "grok": {
      const args = ["--prompt-file", request.promptFile, "--output-format", "streaming-json", "--cwd", cwd];
      args.push("--permission-mode", access === "full" ? "bypassPermissions" : "acceptEdits");
      if (model) {
        args.push("--model", model);
      }
      if (resumeSessionId) {
        args.push("--resume", resumeSessionId);
      }
      return { args };
    }
    case "claude": {
      const args = ["-p", "--output-format", "stream-json", "--verbose"];
      if (access === "full") {
        args.push("--dangerously-skip-permissions");
      }
      if (model) {
        args.push("--model", model);
      }
      if (resumeSessionId) {
        args.push("-r", resumeSessionId);
      }
      return { args, stdin: request.prompt };
    }
    case "opencode": {
      const args = ["run", "--format", "json", "--dir", cwd];
      if (access === "full") {
        args.push("--dangerously-skip-permissions");
      }
      if (model) {
        args.push("-m", model);
      }
      if (resumeSessionId) {
        args.push("-s", resumeSessionId);
      }
      args.push(PROMPT_TOKEN);
      return { args };
    }
  }
}

/** Quote one argument for a cmd.exe command line that is passed straight through `%*`. */
export function quoteForCmd(value: string): string {
  if (value === "") {
    return '""';
  }
  if (!/[\s"&|<>^%()]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Sort key for cursor-agent's versions/<YYYY.M.D[-HH-MM-SS]-hash> folders. */
export function versionKey(name: string): number {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?/.exec(name);
  if (!match) {
    return 0;
  }
  const [, y, m, d, hh = "0", mm = "0", ss = "0"] = match;
  return Number(y) * 1e10 + Number(m) * 1e8 + Number(d) * 1e6 + Number(hh) * 1e4 + Number(mm) * 1e2 + Number(ss);
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export interface ParsedEvent {
  kind: RunEventKind;
  text: string;
}

export interface ParseResult {
  events: ParsedEvent[];
  sessionId?: string;
  result?: string;
  isError?: boolean;
}

export interface OutputParser {
  feed(line: string): ParseResult;
  end(): ParseResult;
}

const MAX_TOOL_TEXT = 600;

interface Sink {
  push(into: ParsedEvent[], kind: RunEventKind, text: string): void;
  delta(into: ParsedEvent[], kind: RunEventKind, text: string): void;
  flush(into: ParsedEvent[]): void;
}

/**
 * Each CLI has its own JSONL dialect. The parser normalizes them into a small
 * set of event kinds and coalesces token deltas so the UI is not flooded.
 */
export function createOutputParser(kind: AgentKind): OutputParser {
  let pendingKind: RunEventKind | null = null;
  let pendingText = "";
  let lastText = "";

  const sink: Sink = {
    flush(into) {
      if (pendingKind && pendingText.trim()) {
        into.push({ kind: pendingKind, text: pendingText.trimEnd() });
        if (pendingKind === "text") {
          lastText = pendingText.trim();
        }
      }
      pendingKind = null;
      pendingText = "";
    },
    delta(into, deltaKind, text) {
      if (pendingKind && pendingKind !== deltaKind) {
        sink.flush(into);
      }
      pendingKind = deltaKind;
      pendingText += text;
    },
    push(into, eventKind, text) {
      sink.flush(into);
      if (text.trim()) {
        into.push({ kind: eventKind, text: text.trimEnd() });
        if (eventKind === "text") {
          lastText = text.trim();
        }
      }
    },
  };

  const feed = (line: string): ParseResult => {
    const trimmed = line.trim();
    const out: ParseResult = { events: [] };
    if (!trimmed) {
      return out;
    }
    let data: Record<string, unknown> | null = null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        data = isRecord(parsed) ? parsed : null;
      } catch {
        data = null;
      }
    }
    if (!data) {
      sink.push(out.events, "raw", trimmed);
      return out;
    }
    switch (kind) {
      case "cursor":
      case "claude":
        parseStreamJson(data, out, sink);
        break;
      case "codex":
        parseCodex(data, out, sink);
        break;
      case "grok":
        parseGrok(data, out, sink);
        break;
      case "opencode":
        parseOpencode(data, out, sink);
        break;
    }
    return out;
  };

  const end = (): ParseResult => {
    const out: ParseResult = { events: [] };
    sink.flush(out.events);
    out.result = lastText || undefined;
    return out;
  };

  return { feed, end };
}

/** cursor-agent and Claude Code share this dialect. */
function parseStreamJson(data: Record<string, unknown>, out: ParseResult, sink: Sink): void {
  const type = String(data.type ?? "");
  const events = out.events;
  if (typeof data.session_id === "string" && data.session_id) {
    out.sessionId = data.session_id;
  }
  switch (type) {
    case "system": {
      sink.push(events, "status", data.model ? `模型 ${String(data.model)}` : "已连接");
      return;
    }
    case "user": {
      const message = isRecord(data.message) ? data.message : {};
      let sawToolResult = false;
      for (const block of asArray(message.content)) {
        if (isRecord(block) && block.type === "tool_result") {
          sawToolResult = true;
          const content = block.content;
          const text = typeof content === "string" ? content : asArray(content).map(textOf).join("\n");
          if (text.trim()) {
            sink.push(events, "tool", `结果: ${truncate(text, MAX_TOOL_TEXT)}`);
          }
        }
      }
      if (!sawToolResult) {
        sink.push(events, "status", "已收到任务");
      }
      return;
    }
    case "thinking": {
      const subtype = String(data.subtype ?? "");
      if (subtype === "delta" && typeof data.text === "string") {
        sink.delta(events, "thinking", data.text);
      } else if (subtype === "completed") {
        sink.flush(events);
      }
      return;
    }
    case "assistant": {
      const message = isRecord(data.message) ? data.message : {};
      for (const block of asArray(message.content)) {
        if (!isRecord(block)) {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          sink.push(events, "text", block.text);
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          sink.push(events, "thinking", block.thinking);
        } else if (block.type === "tool_use") {
          sink.push(events, "tool", `${String(block.name ?? "tool")} ${truncate(compact(block.input), MAX_TOOL_TEXT)}`);
        }
      }
      return;
    }
    case "tool_call": {
      const subtype = String(data.subtype ?? "");
      const call = isRecord(data.tool_call) ? data.tool_call : {};
      const name = Object.keys(call)[0] ?? "tool";
      const payload = isRecord(call[name]) ? (call[name] as Record<string, unknown>) : {};
      if (subtype === "started") {
        sink.push(events, "tool", `${prettyToolName(name)} ${truncate(compact(payload.args ?? payload), MAX_TOOL_TEXT)}`);
      } else if (subtype === "completed") {
        const result = payload.result ?? payload.output;
        if (result !== undefined) {
          sink.push(events, "tool", `完成 ${prettyToolName(name)}: ${truncate(compact(result), MAX_TOOL_TEXT)}`);
        }
      }
      return;
    }
    case "result": {
      sink.flush(events);
      const isError = Boolean(data.is_error) || data.subtype === "error";
      const text = typeof data.result === "string" ? data.result : "";
      out.isError = isError;
      out.result = text || undefined;
      const duration = typeof data.duration_ms === "number" ? ` · ${formatDuration(data.duration_ms)}` : "";
      events.push({ kind: "result", text: `${isError ? "失败" : "完成"}${duration}` });
      return;
    }
    default:
      sink.push(events, "raw", compact(data));
  }
}

function prettyToolName(name: string): string {
  return name
    .replace(/ToolCall$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/** `codex exec --json` */
function parseCodex(data: Record<string, unknown>, out: ParseResult, sink: Sink): void {
  const type = String(data.type ?? "");
  const events = out.events;
  if (type === "thread.started") {
    if (typeof data.thread_id === "string") {
      out.sessionId = data.thread_id;
    }
    sink.push(events, "status", "会话已创建");
    return;
  }
  if (type === "turn.started") {
    sink.push(events, "status", "开始处理");
    return;
  }
  if (type === "turn.completed") {
    const usage = isRecord(data.usage) ? data.usage : null;
    const tokens = usage ? ` · ${Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)} tokens` : "";
    events.push({ kind: "result", text: `完成${tokens}` });
    return;
  }
  if (type === "turn.failed") {
    const error = isRecord(data.error) ? String(data.error.message ?? compact(data.error)) : compact(data);
    out.isError = true;
    out.result = error;
    events.push({ kind: "result", text: `失败: ${error}` });
    return;
  }
  if (type === "error") {
    out.isError = true;
    sink.push(events, "stderr", typeof data.message === "string" ? data.message : compact(data));
    return;
  }
  if (type.startsWith("item.")) {
    const phase = type.slice("item.".length);
    const item = isRecord(data.item) ? data.item : {};
    const itemType = String(item.type ?? "");
    switch (itemType) {
      case "agent_message":
        if (phase === "completed" && typeof item.text === "string") {
          sink.push(events, "text", item.text);
          out.result = item.text;
        }
        return;
      case "reasoning":
        if (phase === "completed" && typeof item.text === "string") {
          sink.push(events, "thinking", item.text);
        }
        return;
      case "command_execution":
        if (phase === "started") {
          sink.push(events, "tool", `$ ${String(item.command ?? "")}`);
        } else if (phase === "completed") {
          const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
          const exit = item.exit_code === undefined ? "" : ` (exit ${String(item.exit_code)})`;
          sink.push(events, "tool", `命令结束${exit}${output.trim() ? `\n${truncate(output, MAX_TOOL_TEXT)}` : ""}`);
        }
        return;
      case "file_change":
        if (phase === "completed") {
          const changes = asArray(item.changes)
            .map((change) => (isRecord(change) ? `${String(change.kind ?? "edit")} ${String(change.path ?? "")}` : ""))
            .filter(Boolean);
          sink.push(events, "tool", `修改文件\n${changes.join("\n")}`);
        }
        return;
      case "mcp_tool_call":
      case "web_search":
      case "todo_list":
        if (phase !== "updated") {
          sink.push(events, "tool", `${itemType}: ${truncate(compact(item), MAX_TOOL_TEXT)}`);
        }
        return;
      default:
        if (phase === "completed") {
          sink.push(events, "raw", compact(item));
        }
    }
    return;
  }
  sink.push(events, "raw", compact(data));
}

/** Grok Build `--output-format streaming-json` (ACP session updates). */
function parseGrok(data: Record<string, unknown>, out: ParseResult, sink: Sink): void {
  const type = String(data.type ?? "");
  const events = out.events;
  switch (type) {
    case "available_commands":
    case "usage":
      return;
    case "thought":
      sink.delta(events, "thinking", String(data.data ?? ""));
      return;
    case "text":
      sink.delta(events, "text", String(data.data ?? ""));
      return;
    case "tool_call":
    case "tool_use": {
      const name = String(data.title ?? data.name ?? data.tool ?? type);
      const detail = data.input ?? data.rawInput ?? data.data;
      sink.push(events, "tool", `${name}${detail === undefined ? "" : ` ${truncate(compact(detail), MAX_TOOL_TEXT)}`}`);
      return;
    }
    case "tool_call_update":
    case "tool_result": {
      // Updates carry either a diff (file edited) or the tool's textual output; empty updates are progress ticks.
      const parts = asArray(data.content)
        .map((item) => {
          if (!isRecord(item)) {
            return "";
          }
          if (item.type === "diff") {
            return `修改 ${String(item.path ?? "")}`;
          }
          if (item.type === "content") {
            const inner = isRecord(item.content) ? item.content : {};
            return typeof inner.text === "string" ? `结果: ${truncate(inner.text, MAX_TOOL_TEXT)}` : "";
          }
          return compact(item);
        })
        .filter(Boolean);
      if (parts.length) {
        sink.push(events, "tool", [...new Set(parts)].join("\n"));
      }
      return;
    }
    case "end": {
      sink.flush(events);
      if (typeof data.sessionId === "string") {
        out.sessionId = data.sessionId;
      }
      const stop = String(data.stopReason ?? "end_turn");
      const isError = stop !== "end_turn" && stop !== "max_turns";
      out.isError = isError;
      const cost = typeof data.total_cost_usd === "number" ? ` · $${data.total_cost_usd.toFixed(4)}` : "";
      events.push({ kind: "result", text: `${isError ? `结束 (${stop})` : "完成"}${cost}` });
      return;
    }
    case "error":
      out.isError = true;
      sink.push(events, "stderr", String(data.message ?? data.data ?? compact(data)));
      return;
    default:
      sink.push(events, "raw", compact(data));
  }
}

/** opencode `run --format json`: shape is loose, so extract text where it exists. */
function parseOpencode(data: Record<string, unknown>, out: ParseResult, sink: Sink): void {
  const type = String(data.type ?? "");
  const events = out.events;
  const part = isRecord(data.part) ? data.part : isRecord(data.properties) ? data.properties : data;
  if (typeof data.sessionID === "string") {
    out.sessionId = data.sessionID;
  } else if (typeof part.sessionID === "string") {
    out.sessionId = part.sessionID;
  }
  const partType = String(part.type ?? type);
  if (partType === "text" && typeof part.text === "string") {
    sink.push(events, "text", part.text);
    out.result = part.text;
    return;
  }
  if (partType === "reasoning" && typeof part.text === "string") {
    sink.push(events, "thinking", part.text);
    return;
  }
  if (partType === "tool" || partType === "tool_use" || partType === "tool-invocation") {
    const state = isRecord(part.state) ? part.state : {};
    const status = String(state.status ?? "");
    sink.push(
      events,
      "tool",
      `${String(part.tool ?? part.name ?? "tool")} ${status} ${truncate(compact(state.input ?? part.input ?? ""), MAX_TOOL_TEXT)}`,
    );
    return;
  }
  if (type === "error" || partType === "error") {
    out.isError = true;
    sink.push(events, "stderr", compact(part));
    return;
  }
  if (partType.startsWith("step") || partType === "session") {
    sink.push(events, "status", partType);
    return;
  }
  sink.push(events, "raw", compact(data));
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(block: unknown): string {
  if (typeof block === "string") {
    return block;
  }
  if (isRecord(block) && typeof block.text === "string") {
    return block.text;
  }
  return "";
}

function compact(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function truncate(value: string, max: number): string {
  const text = value.replace(/\r\n/g, "\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}
