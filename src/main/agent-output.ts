import type { AgentAccess, AgentKind, RunEventKind, ToolCall, ToolKind, ToolStatus } from "@shared/protocol";
import {
  asArray,
  basenameOf,
  clipHead,
  clipTail,
  compact,
  describeArgs,
  describeCursorResult,
  firstLine,
  isRecord,
  MAX_TOOL_INPUT,
  toolKindOf,
} from "../shared/tools.ts";

export { toolKindOf } from "../shared/tools.ts";

// Pure helpers: how each agent CLI is invoked and how its JSONL output is read.
// No Node/Electron imports here so the logic stays unit-testable; the tool
// normalization lives in shared/tools.ts because the renderer needs it too.

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
  /**
   * Images sent with this turn, as paths on the machine the agent runs on. The
   * prompt already names them; CLIs that accept images as arguments also get
   * them here so the model sees the pixels, not just a path.
   */
  images?: string[];
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
  if (command.viaCmd) {
    const built = buildShellCommandLine(kind, command.prefixArgs[0]!, request, quoteForCmd);
    return {
      file: command.file,
      args: ["/d", "/s", "/c", `"${built.commandLine}"`],
      stdin: built.stdin,
      windowsVerbatimArguments: true,
    };
  }
  const built = agentArgs(kind, request);
  const args = built.args.map((arg) => (arg === PROMPT_TOKEN ? request.prompt : arg));
  return { file: command.file, args: [...command.prefixArgs, ...args], stdin: built.stdin };
}

export interface ShellCommandLine {
  commandLine: string;
  stdin?: string;
}

/**
 * One line for a shell (cmd.exe locally or on a remote Windows box, sh on a
 * remote POSIX box). Shells cannot carry newlines or arbitrary quoting, so the
 * prompt never appears here: it stays in `request.promptFile` and the agent is
 * pointed at it, or it goes over stdin for CLIs that read it there.
 */
export function buildShellCommandLine(
  kind: AgentKind,
  executable: string,
  request: InvocationRequest,
  quote: (value: string) => string,
): ShellCommandLine {
  const built = agentArgs(kind, request);
  const pointer = `请先完整阅读文件 ${request.promptFile} ，然后按其中的任务说明执行。`;
  const userArgs = built.args.map((arg) => (arg === PROMPT_TOKEN ? pointer : arg));
  return { commandLine: [executable, ...userArgs].map(quote).join(" "), stdin: built.stdin };
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
      // One `-i` per image: `exec` takes a variadic list, `exec resume` a single value, and this form suits both.
      for (const image of request.images ?? []) {
        args.push("-i", image);
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
  /** Continues the previous event of the same kind verbatim (streamed text). */
  delta?: boolean;
}

export interface ParseResult {
  events: ParsedEvent[];
  sessionId?: string;
  /** Model name the CLI reported, when it says. */
  modelLabel?: string;
  result?: string;
  isError?: boolean;
}

/** The output dialects: one per CLI, plus raw ACP session updates from a warm agent host. */
export type OutputDialect = AgentKind | "acp";

export interface OutputParser {
  /** One line of the CLI's stdout. */
  feed(line: string): ParseResult;
  /** One already-decoded message (a session update from an ACP connection). */
  push(data: Record<string, unknown>): ParseResult;
  /**
   * Emit whatever text has streamed in since the last flush as a `delta`
   * event, so the UI can show an answer while it is still being written.
   * Whitespace-only fragments stay buffered until more text arrives.
   */
  flushPartial(): ParseResult;
  end(): ParseResult;
}

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
export function createOutputParser(kind: OutputDialect): OutputParser {
  let pendingKind: RunEventKind | null = null;
  let pendingText = "";
  // Once part of a block has gone out as a delta, the rest must follow verbatim.
  let streaming = false;
  // The whole of the current text block, so a streamed answer is still summarised in full.
  let blockText = "";
  let lastText = "";
  const tools = new Map<string, ToolCall>();

  const sink: Sink = {
    flush(into) {
      if (pendingKind && (pendingText.trim() || streaming)) {
        if (streaming) {
          if (pendingText) {
            into.push({ kind: pendingKind, text: pendingText, delta: true });
          }
        } else {
          into.push({ kind: pendingKind, text: pendingText.trimEnd() });
        }
        if (pendingKind === "text") {
          lastText = blockText.trim();
        }
      }
      pendingKind = null;
      pendingText = "";
      streaming = false;
      blockText = "";
    },
    delta(into, deltaKind, text) {
      if (pendingKind && pendingKind !== deltaKind) {
        sink.flush(into);
      }
      pendingKind = deltaKind;
      pendingText += text;
      blockText += text;
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

  const push = (data: Record<string, unknown>): ParseResult => {
    const out: ParseResult = { events: [] };
    switch (kind) {
      case "cursor":
      case "claude":
        parseStreamJson(data, out, context);
        break;
      case "codex":
        parseCodex(data, out, context);
        break;
      case "grok":
      case "acp":
        parseAcp(data, out, context);
        break;
      case "opencode":
        parseOpencode(data, out, context);
        break;
    }
    return out;
  };

  const feed = (line: string): ParseResult => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { events: [] };
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
      const out: ParseResult = { events: [] };
      sink.push(out.events, "raw", trimmed);
      return out;
    }
    return push(data);
  };

  const flushPartial = (): ParseResult => {
    const out: ParseResult = { events: [] };
    if (pendingKind && pendingText.trim()) {
      out.events.push({ kind: pendingKind, text: pendingText, delta: true });
      if (pendingKind === "text") {
        lastText = blockText.trim();
      }
      pendingText = "";
      streaming = true;
    }
    return out;
  };

  const end = (): ParseResult => {
    const out: ParseResult = { events: [] };
    sink.flush(out.events);
    out.result = lastText || undefined;
    return out;
  };

  return { feed, push, flushPartial, end };
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

/**
 * ACP (Agent Client Protocol) session updates. Grok Build's
 * `--output-format streaming-json` prints them flattened one per line with a
 * `type` field and text in `data`; a warm agent host hands us the raw
 * `update` objects with `sessionUpdate` and `content`. The runner adds a
 * synthetic `end` when a prompt returns.
 */
function parseAcp(data: Record<string, unknown>, out: ParseResult, { sink, track, tools }: DialectContext): void {
  const type = String(data.type ?? data.sessionUpdate ?? "");
  const events = out.events;
  switch (type) {
    case "available_commands":
    case "available_commands_update":
    case "current_mode_update":
    case "session_info_update":
    case "config_option_update":
    case "user_message_chunk":
    case "usage":
      return;
    case "thought":
    case "agent_thought_chunk":
      sink.delta(events, "thinking", chunkText(data));
      return;
    case "text":
    case "agent_message_chunk":
      sink.delta(events, "text", chunkText(data));
      return;
    case "plan": {
      const entries = asArray(data.entries).filter(isRecord);
      if (!entries.length) {
        return;
      }
      const lines = entries.map((entry) => {
        const status = String(entry.status ?? "");
        const mark = status === "completed" ? "☑" : status === "in_progress" ? "◐" : "☐";
        return `${mark} ${String(entry.content ?? "")}`;
      });
      sink.tool(events, track("plan", { name: "plan", kind: "todo", status: "ok", subject: `${lines.length} 项`, output: lines.join("\n") }));
      return;
    }
    case "tool_call":
    case "tool_use": {
      const id = String(data.toolCallId ?? data.id ?? `tool-${events.length}`);
      const title = String(data.title ?? data.name ?? data.tool ?? "tool").replace(/^`(.*)`$/s, "$1");
      const rawInput = isRecord(data.rawInput) ? data.rawInput : isRecord(data.input) ? data.input : {};
      const described = describeArgs(title, rawInput, undefined, acpKind(String(data.kind ?? ""), title));
      const files = acpLocations(data);
      sink.tool(
        events,
        track(id, {
          ...described,
          files: described.files ?? files,
          subject: described.subject ?? (files?.length === 1 ? basenameOf(files[0]!) : undefined) ?? title,
          status: acpStatus(String(data.status ?? "")),
          ...describeAcpContent(asArray(data.content)),
          ...describeRawOutput(described.kind, data.rawOutput),
        }),
      );
      return;
    }
    case "tool_call_update":
    case "tool_result": {
      const id = String(data.toolCallId ?? data.id ?? "");
      const previous = tools.get(id);
      // cursor-agent announces a call first and fills in what it is about (title, arguments, files) a moment later.
      const rawInput = isRecord(data.rawInput) && Object.keys(data.rawInput).length ? data.rawInput : undefined;
      const title = typeof data.title === "string" ? data.title.replace(/^`(.*)`$/s, "$1") : undefined;
      const files = acpLocations(data);
      const kindHint = typeof data.kind === "string" ? acpKind(data.kind, title ?? "") : previous?.kind ?? acpKind("", title ?? "");
      const redescribed = rawInput || title ? describeArgs(title ?? previous?.name ?? "tool", rawInput ?? {}, undefined, kindHint) : undefined;
      const content = describeAcpContent(asArray(data.content));
      const output = describeRawOutput(redescribed?.kind ?? previous?.kind ?? "other", data.rawOutput);
      const hasNews = Boolean(content.output || content.diff || output.output || output.exitCode !== undefined || redescribed || files);
      // Empty updates are progress ticks; only emit when there is something new to show.
      if (!hasNews && (data.status === undefined || (previous && acpStatus(String(data.status)) === previous.status))) {
        return;
      }
      // The client refused this call; the agent still reports it as completed afterwards.
      if (previous?.status === "rejected" && !hasNews) {
        return;
      }
      const patch: Partial<ToolCall> & Pick<ToolCall, "name" | "kind"> = {
        name: previous?.name ?? title ?? "tool",
        kind: previous?.kind && previous.kind !== "other" ? previous.kind : redescribed?.kind ?? "other",
        ...(redescribed ? compactPatch({ ...redescribed, name: undefined, kind: undefined }) : {}),
        ...(files ? { files, subject: files.length === 1 ? basenameOf(files[0]!) : `${basenameOf(files[0]!)} 等 ${files.length} 个文件` } : {}),
        ...output,
        ...content,
        status: data.status === undefined ? previous?.status ?? "running" : acpStatus(String(data.status)),
        error: typeof data.error === "string" && data.error ? data.error : undefined,
      };
      if (redescribed?.subject) {
        patch.subject = redescribed.subject;
      }
      if (patch.status === "ok" && patch.exitCode !== undefined && patch.exitCode !== 0) {
        patch.status = "error";
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
      const isError = stop !== "end_turn" && stop !== "max_turns" && stop !== "cancelled";
      out.isError = isError;
      const cost = typeof data.total_cost_usd === "number" ? ` · $${data.total_cost_usd.toFixed(4)}` : "";
      events.push({ kind: "result", text: `${stop === "cancelled" ? "已取消" : isError ? `结束 (${stop})` : "完成"}${cost}` });
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

/** Grok puts a chunk's text in `data`; raw ACP wraps it as a content block. */
function chunkText(data: Record<string, unknown>): string {
  const content = isRecord(data.content) ? data.content : {};
  const text = typeof data.data === "string" ? data.data : typeof content.text === "string" ? content.text : "";
  // Some models let their end-of-sequence marker through as text; it is never part of the answer.
  return text.replace(/<\|(?:eos|endoftext|end_of_text|eot_id)\|>/g, "");
}

function acpKind(kind: string, title: string): ToolKind {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
    case "move":
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

/** ACP statuses, plus "rejected" which the runner adds when it refuses a permission request. */
function acpStatus(status: string): ToolStatus {
  if (status === "completed") {
    return "ok";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (status === "rejected") {
    return "rejected";
  }
  return "running";
}

function acpLocations(data: Record<string, unknown>): string[] | undefined {
  const files = asArray(data.locations)
    .filter(isRecord)
    .map((location) => String(location.path ?? ""))
    .filter(Boolean);
  return files.length ? files : undefined;
}

/** cursor-agent reports a finished command as `{ exitCode, stdout, stderr }`; anything else is shown as JSON. */
function describeRawOutput(kind: ToolKind, rawOutput: unknown): Partial<ToolCall> {
  if (rawOutput === undefined || rawOutput === null) {
    return {};
  }
  if (isRecord(rawOutput) && ("stdout" in rawOutput || "stderr" in rawOutput || "exitCode" in rawOutput)) {
    const stdout = typeof rawOutput.stdout === "string" ? rawOutput.stdout : "";
    const stderr = typeof rawOutput.stderr === "string" ? rawOutput.stderr : "";
    const combined = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;
    const patch: Partial<ToolCall> = {};
    if (combined.trim()) {
      patch.output = clipTail(combined);
    }
    if (typeof rawOutput.exitCode === "number") {
      patch.exitCode = rawOutput.exitCode;
    }
    return patch;
  }
  const text = compact(rawOutput);
  return text ? { output: kind === "shell" ? clipTail(text) : clipHead(text) } : {};
}

function describeAcpContent(content: unknown[]): Partial<ToolCall> {
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
// Parser-side helpers (tool normalization itself lives in shared/tools.ts)
// ---------------------------------------------------------------------------

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

function textOf(block: unknown): string {
  if (typeof block === "string") {
    return block;
  }
  if (isRecord(block) && typeof block.text === "string") {
    return block.text;
  }
  return "";
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
