import type { AgentAccess, AgentKind, RunEventKind, ToolCall, ToolKind, ToolStatus } from "@shared/protocol";

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
  tool?: ToolCall;
}

export interface ParseResult {
  events: ParsedEvent[];
  sessionId?: string;
  /** Model name the CLI reported, when it says. */
  modelLabel?: string;
  result?: string;
  isError?: boolean;
}

export interface OutputParser {
  feed(line: string): ParseResult;
  end(): ParseResult;
}

/** Longest tool output kept per event; shell output keeps its tail, everything else its head. */
const MAX_TOOL_OUTPUT = 8_000;
const MAX_TOOL_INPUT = 1_500;
const MAX_TOOL_FILES = 200;

interface Sink {
  push(into: ParsedEvent[], kind: RunEventKind, text: string): void;
  delta(into: ParsedEvent[], kind: RunEventKind, text: string): void;
  tool(into: ParsedEvent[], call: ToolCall): void;
  flush(into: ParsedEvent[]): void;
  lastText(): string;
}

/**
 * Each CLI has its own JSONL dialect. The parser normalizes them into a small
 * set of event kinds, coalesces token deltas so the UI is not flooded, and
 * tracks tool calls by id so a start and its completion become one thing.
 */
export function createOutputParser(kind: AgentKind): OutputParser {
  let pendingKind: RunEventKind | null = null;
  let pendingText = "";
  let lastText = "";
  const tools = new Map<string, ToolCall>();

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
    tool(into, call) {
      sink.flush(into);
      into.push({ kind: "tool", text: toolLine(call), tool: call });
    },
    lastText: () => lastText,
  };

  /** Merge a start or completion into the tracked call and return the current state. */
  const track = (id: string, patch: Partial<ToolCall> & Pick<ToolCall, "name" | "kind">): ToolCall => {
    const existing = tools.get(id);
    const next: ToolCall = { ...(existing ?? { id, status: "running" }), ...compactPatch(patch), id };
    tools.set(id, next);
    return next;
  };

  const context: DialectContext = { sink, track, tools };

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
        parseStreamJson(data, out, context);
        break;
      case "codex":
        parseCodex(data, out, context);
        break;
      case "grok":
        parseGrok(data, out, context);
        break;
      case "opencode":
        parseOpencode(data, out, context);
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

interface DialectContext {
  sink: Sink;
  track(id: string, patch: Partial<ToolCall> & Pick<ToolCall, "name" | "kind">): ToolCall;
  tools: Map<string, ToolCall>;
}

/** cursor-agent and Claude Code share this dialect. */
function parseStreamJson(data: Record<string, unknown>, out: ParseResult, { sink, track, tools }: DialectContext): void {
  const type = String(data.type ?? "");
  const events = out.events;
  if (typeof data.session_id === "string" && data.session_id) {
    out.sessionId = data.session_id;
  }
  switch (type) {
    case "system": {
      if (typeof data.model === "string" && data.model) {
        out.modelLabel = data.model;
      }
      return;
    }
    case "user": {
      // Claude Code reports tool results as user messages; the initial prompt echo carries nothing new.
      const message = isRecord(data.message) ? data.message : {};
      for (const block of asArray(message.content)) {
        if (!isRecord(block) || block.type !== "tool_result") {
          continue;
        }
        const id = String(block.tool_use_id ?? "");
        const text = typeof block.content === "string" ? block.content : asArray(block.content).map(textOf).join("\n");
        const previous = tools.get(id);
        const isError = Boolean(block.is_error);
        sink.tool(
          events,
          track(id, {
            name: previous?.name ?? "tool",
            kind: previous?.kind ?? "other",
            status: isError ? "error" : "ok",
            output: previous?.kind === "shell" ? clipTail(text) : clipHead(text),
            error: isError ? firstLine(text) : undefined,
          }),
        );
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
          const name = String(block.name ?? "tool");
          const args = isRecord(block.input) ? block.input : {};
          sink.tool(events, track(String(block.id ?? `tool-${events.length}`), describeArgs(name, args)));
        }
      }
      return;
    }
    case "tool_call": {
      const subtype = String(data.subtype ?? "");
      const call = isRecord(data.tool_call) ? data.tool_call : {};
      const rawName = Object.keys(call).find((key) => key.endsWith("ToolCall")) ?? Object.keys(call)[0] ?? "tool";
      const payload = isRecord(call[rawName]) ? (call[rawName] as Record<string, unknown>) : {};
      const args = isRecord(payload.args) ? payload.args : {};
      const id = String(data.call_id ?? payload.toolCallId ?? args.toolCallId ?? `tool-${events.length}`);
      if (subtype === "started") {
        sink.tool(events, track(id, describeArgs(rawName, args, typeof payload.description === "string" ? payload.description : undefined)));
      } else if (subtype === "completed") {
        const described = describeArgs(rawName, args, typeof payload.description === "string" ? payload.description : undefined);
        sink.tool(events, track(id, { ...described, ...describeCursorResult(described.kind, payload.result) }));
      }
      return;
    }
    case "result": {
      sink.flush(events);
      const isError = Boolean(data.is_error) || data.subtype === "error";
      const reported = typeof data.result === "string" ? data.result : "";
      out.isError = isError;
      // cursor-agent's `result` glues every assistant message together; the last message is the actual answer.
      out.result = (isError ? reported : sink.lastText() || reported) || undefined;
      const duration = typeof data.duration_ms === "number" ? ` · ${formatDuration(data.duration_ms)}` : "";
      events.push({ kind: "result", text: `${isError ? "失败" : "完成"}${duration}` });
      return;
    }
    default:
      sink.push(events, "raw", compact(data));
  }
}

/** `codex exec --json` */
function parseCodex(data: Record<string, unknown>, out: ParseResult, { sink, track }: DialectContext): void {
  const type = String(data.type ?? "");
  const events = out.events;
  if (type === "thread.started") {
    if (typeof data.thread_id === "string") {
      out.sessionId = data.thread_id;
    }
    return;
  }
  if (type === "turn.started") {
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
    const id = String(item.id ?? `item-${events.length}`);
    const itemStatus = String(item.status ?? "");
    const status: ToolStatus = itemStatus === "failed" ? "error" : phase === "completed" || itemStatus === "completed" ? "ok" : "running";
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
      case "command_execution": {
        const command = String(item.command ?? "");
        const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
        const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
        sink.tool(
          events,
          track(id, {
            name: itemType,
            kind: "shell",
            command: unwrapPwsh(command),
            subject: unwrapPwsh(command),
            status: status === "ok" && exitCode !== undefined && exitCode !== 0 ? "error" : status,
            exitCode,
            output: output.trim() ? clipTail(output) : undefined,
          }),
        );
        return;
      }
      case "file_change": {
        const changes = asArray(item.changes).filter(isRecord);
        const files = changes.map((change) => String(change.path ?? "")).filter(Boolean);
        const kinds = new Set(changes.map((change) => String(change.kind ?? "update")));
        const kind: ToolKind = kinds.size === 1 && kinds.has("add") ? "write" : kinds.size === 1 && kinds.has("delete") ? "delete" : "edit";
        sink.tool(
          events,
          track(id, {
            name: itemType,
            kind,
            status,
            files,
            subject: files.length > 1 ? `${basenameOf(files[0]!)} 等 ${files.length} 个文件` : basenameOf(files[0] ?? ""),
          }),
        );
        return;
      }
      case "mcp_tool_call": {
        sink.tool(
          events,
          track(id, {
            name: itemType,
            kind: "mcp",
            status,
            subject: [item.server, item.tool].filter(Boolean).map(String).join(" · ") || undefined,
            input: item.arguments === undefined ? undefined : clipHead(compact(item.arguments), MAX_TOOL_INPUT),
            output: item.result === undefined ? undefined : clipHead(compact(item.result)),
            error: item.error === undefined ? undefined : firstLine(compact(item.error)),
          }),
        );
        return;
      }
      case "web_search":
        sink.tool(events, track(id, { name: itemType, kind: "web", status, subject: typeof item.query === "string" ? item.query : undefined }));
        return;
      case "todo_list": {
        if (phase === "updated") {
          return;
        }
        const todos = asArray(item.items)
          .filter(isRecord)
          .map((todo) => `${todo.completed ? "☑" : "☐"} ${String(todo.text ?? "")}`);
        sink.tool(events, track(id, { name: itemType, kind: "todo", status, subject: `${todos.length} 项`, output: todos.join("\n") || undefined }));
        return;
      }
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
function parseGrok(data: Record<string, unknown>, out: ParseResult, { sink, track, tools }: DialectContext): void {
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
      const id = String(data.toolCallId ?? data.id ?? `tool-${events.length}`);
      const title = String(data.title ?? data.name ?? data.tool ?? "tool");
      const rawInput = isRecord(data.rawInput) ? data.rawInput : isRecord(data.input) ? data.input : {};
      const described = describeArgs(title, rawInput, undefined, grokKind(String(data.kind ?? ""), title));
      sink.tool(
        events,
        track(id, {
          ...described,
          subject: described.subject ?? title,
          status: grokStatus(String(data.status ?? "")),
          ...describeGrokContent(asArray(data.content)),
        }),
      );
      return;
    }
    case "tool_call_update":
    case "tool_result": {
      const id = String(data.toolCallId ?? data.id ?? "");
      const previous = tools.get(id);
      const content = describeGrokContent(asArray(data.content));
      const rawOutput = data.rawOutput === undefined ? undefined : compact(data.rawOutput);
      const patch: Partial<ToolCall> & Pick<ToolCall, "name" | "kind"> = {
        name: previous?.name ?? String(data.title ?? "tool"),
        kind: previous?.kind ?? "other",
        ...content,
        status: data.status === undefined ? previous?.status ?? "running" : grokStatus(String(data.status)),
      };
      if (!content.output && rawOutput) {
        patch.output = previous?.kind === "shell" ? clipTail(rawOutput) : clipHead(rawOutput);
      }
      // Empty updates are progress ticks; only emit when there is something new to show.
      if (!content.output && !content.diff && !rawOutput && data.status === undefined) {
        return;
      }
      sink.tool(events, track(id, patch));
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

function grokKind(kind: string, title: string): ToolKind {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "delete":
      return "delete";
    case "search":
      return "grep";
    case "execute":
      return "shell";
    case "fetch":
      return "web";
    default:
      return toolKindOf(title);
  }
}

function grokStatus(status: string): ToolStatus {
  if (status === "completed") {
    return "ok";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  return "running";
}

function describeGrokContent(content: unknown[]): Partial<ToolCall> {
  const patch: Partial<ToolCall> = {};
  const outputs: string[] = [];
  const files: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type === "diff") {
      const path = String(item.path ?? "");
      if (path) {
        files.push(path);
      }
      const oldText = typeof item.oldText === "string" ? item.oldText : "";
      const newText = typeof item.newText === "string" ? item.newText : "";
      if (oldText || newText) {
        patch.diff = clipHead(simpleDiff(oldText, newText));
      }
    } else if (item.type === "content") {
      const inner = isRecord(item.content) ? item.content : item;
      if (typeof inner.text === "string" && inner.text.trim()) {
        outputs.push(inner.text);
      }
    }
  }
  if (files.length) {
    patch.files = files;
    patch.subject = files.length > 1 ? `${basenameOf(files[0]!)} 等 ${files.length} 个文件` : basenameOf(files[0]!);
  }
  if (outputs.length) {
    patch.output = clipHead(outputs.join("\n"));
  }
  return patch;
}

/** opencode `run --format json`: shape is loose, so extract text where it exists. */
function parseOpencode(data: Record<string, unknown>, out: ParseResult, { sink, track }: DialectContext): void {
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
    const name = String(part.tool ?? part.name ?? "tool");
    const input = isRecord(state.input) ? state.input : isRecord(part.input) ? part.input : {};
    const id = String(part.callID ?? part.callId ?? part.id ?? `tool-${events.length}`);
    const stateStatus = String(state.status ?? "");
    const status: ToolStatus = stateStatus === "completed" ? "ok" : stateStatus === "error" ? "error" : "running";
    const described = describeArgs(name, input);
    const metadata = isRecord(state.metadata) ? state.metadata : {};
    const output = typeof state.output === "string" ? state.output : undefined;
    sink.tool(
      events,
      track(id, {
        ...described,
        subject: described.subject ?? (typeof state.title === "string" ? state.title : undefined),
        status,
        output: output ? (described.kind === "shell" ? clipTail(output) : clipHead(output)) : undefined,
        exitCode: typeof metadata.exit === "number" ? metadata.exit : undefined,
        error: typeof state.error === "string" ? firstLine(state.error) : undefined,
      }),
    );
    return;
  }
  if (type === "error" || partType === "error") {
    out.isError = true;
    sink.push(events, "stderr", compact(part));
    return;
  }
  if (partType.startsWith("step") || partType === "session") {
    return;
  }
  sink.push(events, "raw", compact(data));
}

// ---------------------------------------------------------------------------
// Tool normalization
// ---------------------------------------------------------------------------

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
function describeArgs(
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
function describeCursorResult(kind: ToolKind, result: unknown): Partial<ToolCall> {
  if (!isRecord(result)) {
    return { status: "ok" };
  }
  const outcome = Object.keys(result)[0] ?? "success";
  const body = isRecord(result[outcome]) ? (result[outcome] as Record<string, unknown>) : {};
  const status: ToolStatus = outcome === "success" ? "ok" : outcome === "rejected" ? "rejected" : "error";
  const patch: Partial<ToolCall> = { status };
  if (status === "rejected") {
    patch.error = pickString(body, ["reason", "message"]) || "命令被拦截：安全模式下不允许执行，需要「完全放开」";
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

/** cursor-agent's glob results come back as "../.\src\App.jsx" style paths. */
function cleanGlobPath(path: string): string {
  return path.replace(/^\.\.[\\/]/, "").replace(/^\.[\\/]/, "");
}

/** codex wraps every command in an explicit pwsh call on Windows; show what the agent meant. */
function unwrapPwsh(command: string): string {
  const match = /^"?(?:[A-Za-z]:\\[^"]*\\)?(?:pwsh|powershell)(?:\.exe)?"?\s+-Command\s+'([\s\S]*)'\s*$/i.exec(command.trim());
  if (match) {
    return match[1]!.replace(/''/g, "'");
  }
  const bash = /^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+'([\s\S]*)'\s*$/.exec(command.trim());
  if (bash) {
    return bash[1]!.replace(/'\\''/g, "'");
  }
  return command;
}

function toolLine(call: ToolCall): string {
  if (call.kind === "shell") {
    return `$ ${call.command ?? call.subject ?? call.name}`;
  }
  const verb: Record<ToolKind, string> = {
    shell: "$",
    read: "读取",
    edit: "编辑",
    write: "写入",
    delete: "删除",
    glob: "查找",
    grep: "搜索",
    ls: "列出",
    web: "联网",
    task: "子任务",
    todo: "待办",
    mcp: "MCP",
    other: call.name,
  };
  return `${verb[call.kind]} ${call.subject ?? ""}`.trim();
}

function compactPatch<T extends object>(patch: T): T {
  const copy = { ...patch } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (copy[key] === undefined) {
      delete copy[key];
    }
  }
  return copy as T;
}

function simpleDiff(oldText: string, newText: string): string {
  const removed = oldText ? oldText.split("\n").map((line) => `-${line}`) : [];
  const added = newText ? newText.split("\n").map((line) => `+${line}`) : [];
  return [...removed, ...added].join("\n");
}

function prettyArgs(args: Record<string, unknown>): string {
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

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function basenameOf(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return index >= 0 ? cleaned.slice(index + 1) || cleaned : cleaned;
}

function firstLine(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim())?.trim() ?? "";
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

function clipHead(value: string, max = MAX_TOOL_OUTPUT): string {
  const text = value.replace(/\r\n/g, "\n");
  return text.length > max ? `${text.slice(0, max)}\n… 已省略 ${text.length - max} 个字符` : text;
}

function clipTail(value: string, max = MAX_TOOL_OUTPUT): string {
  const text = value.replace(/\r\n/g, "\n");
  return text.length > max ? `… 已省略前 ${text.length - max} 个字符\n${text.slice(text.length - max)}` : text;
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