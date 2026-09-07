import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { parseModelAlias } from "../shared/model-variants.ts";
import type { AgentAccess, AgentKind } from "../shared/protocol";
import type { ResolvedCommand } from "./agent-output";
import { resolveCursorAgentBundle } from "./cursor-bundle.ts";
import { killTree } from "./kill.ts";

// A warm agent process speaking ACP (Agent Client Protocol: JSON-RPC 2.0, one
// message per line over stdio). Starting an agent CLI costs 10-15 s on a
// typical machine — mostly its MCP servers — and a one-shot `-p` run pays that
// on every message. One host per agent kind stays up while Nearbox runs and
// carries any number of sessions, so a follow-up costs only the model's time.
//
// Only Node built-ins and type imports here: the JSON-RPC layer and the model
// mapping are unit-tested with `node --test`, which cannot resolve `@shared`.

/** Idle hosts are released after this long; the next message simply starts a new one. */
export const HOST_IDLE_MINUTES = 120;
/** After a host fails to start, one-shot runs are used for this long before trying again. */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const INITIALIZE_TIMEOUT_MS = 30_000;
/** Creating or loading a session starts the MCP servers, which can take a while the first time. */
const SESSION_TIMEOUT_MS = 180_000;
const SET_MODEL_TIMEOUT_MS = 30_000;
const STDERR_TAIL_LINES = 20;

export interface HostLaunch {
  file: string;
  args: string[];
}

/** Agents that can run as an ACP server, and how to start them from their resolved command. */
export const ACP_LAUNCH: Partial<Record<AgentKind, (command: ResolvedCommand) => HostLaunch | null>> = {
  cursor: (command) => {
    const direct = command.viaCmd ? null : { file: command.file, args: [...command.prefixArgs, "acp"] };
    if (direct) {
      return direct;
    }
    // Packaged Nearbox sometimes only finds the .cmd shim; the real node+index.js still sit next to it.
    const shim = command.prefixArgs[0] ?? command.file;
    const bundle = resolveCursorAgentBundle(dirname(shim));
    return bundle ? { file: bundle.file, args: [...bundle.prefixArgs, "acp"] } : null;
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC over line-delimited stdio
// ---------------------------------------------------------------------------

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export interface RpcIncomingRequest {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | null;
}

/**
 * The wire layer: requests we send, notifications and requests the agent
 * sends. Emits `notification` (method, params), `request` (RpcIncomingRequest)
 * and `closed` (error | undefined).
 */
export class AcpConnection extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private readonly input: Writable;

  constructor(input: Writable, output: Readable) {
    super();
    this.input = input;
    const lines = createInterface({ input: output, crlfDelay: Number.POSITIVE_INFINITY });
    lines.on("line", (line) => this.receive(line));
    lines.on("close", () => this.close());
    input.on("error", () => undefined);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("连接已关闭"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer: timeoutMs
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`${method} 在 ${Math.round(timeoutMs / 1000)} 秒内没有响应`));
            }, timeoutMs)
          : null,
      };
      this.pending.set(id, entry);
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, error: JsonRpcError): void {
    this.write({ jsonrpc: "2.0", id, error });
  }

  /** Fail every outstanding request; used when the process goes away. */
  close(error?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      entry.reject(error ?? new Error(`${entry.method} 没有得到回应：Agent 进程已退出`));
    }
    this.emit("closed", error);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private write(message: unknown): void {
    if (this.closed) {
      return;
    }
    try {
      this.input.write(`${JSON.stringify(message)}\n`);
    } catch {
      // The process is gone; the close handler reports it.
    }
  }

  private receive(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      if (trimmed) {
        this.emit("noise", trimmed);
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      message = parsed as Record<string, unknown>;
    } catch {
      this.emit("noise", trimmed);
      return;
    }
    const hasId = typeof message.id === "number" || typeof message.id === "string";
    if (typeof message.method === "string") {
      const params = message.params && typeof message.params === "object" ? (message.params as Record<string, unknown>) : {};
      if (hasId) {
        this.emit("request", { id: message.id as number | string, method: message.method, params } satisfies RpcIncomingRequest);
      } else {
        this.emit("notification", message.method, params);
      }
      return;
    }
    if (hasId && typeof message.id === "number") {
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }
      this.pending.delete(message.id);
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      if (message.error && typeof message.error === "object") {
        const error = message.error as Partial<JsonRpcError>;
        const detail = error.data && typeof error.data === "object" && typeof (error.data as { message?: unknown }).message === "string" ? (error.data as { message: string }).message : undefined;
        entry.reject(new RpcError(Number(error.code ?? -1), detail ?? String(error.message ?? "请求失败"), error.data));
      } else {
        entry.resolve(message.result);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sessions and prompts on one warm process
// ---------------------------------------------------------------------------

export interface AcpModel {
  modelId: string;
  name: string;
}

export interface AcpSession {
  sessionId: string;
  cwd: string;
  /** The model id the agent will use next, in its own parameterised form. */
  currentModelId?: string;
}

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind: string;
}

export interface PromptHandlers {
  onUpdate(update: Record<string, unknown>): void;
  /** Pick an option for a permission request, or null to cancel the call. May wait for the user. */
  onPermission(toolCall: Record<string, unknown>, options: PermissionOption[]): string | null | Promise<string | null>;
}

export interface PromptOutcome {
  stopReason: string;
}

export interface ListedSession {
  sessionId: string;
  cwd: string;
  updatedAt?: string;
}

/** The agent has no record of this session: it was started by a one-shot run and cannot be loaded. */
export class SessionUnknownError extends Error {
  constructor(sessionId: string) {
    super(`Agent 不认识会话 ${sessionId}`);
    this.name = "SessionUnknownError";
  }
}

export interface HostOptions {
  kind: AgentKind;
  launch: HostLaunch;
  env: NodeJS.ProcessEnv;
  /** Working directory of the process itself; sessions carry their own. */
  cwd?: string;
  log?(message: string): void;
}

interface ActivePrompt {
  handlers: PromptHandlers;
}

/**
 * One agent process. `ready` resolves once the ACP handshake is done; after
 * that sessions can be created or loaded and prompted, several at a time.
 * Emits `exit` (code) when the process goes away for any reason.
 */
export class AgentHost extends EventEmitter {
  readonly kind: AgentKind;
  readonly ready: Promise<void>;
  /** Models the agent offered, learned from the first session; undefined until then. */
  models: AcpModel[] | undefined;
  readonly startedAt = Date.now();
  lastUsedAt = Date.now();

  private readonly child: ChildProcess;
  private readonly connection: AcpConnection;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly loading = new Map<string, Promise<AcpSession>>();
  private readonly prompts = new Map<string, ActivePrompt>();
  private readonly stderrTail: string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private exited = false;
  private readonly log: (message: string) => void;

  constructor(options: HostOptions) {
    super();
    this.kind = options.kind;
    this.log = options.log ?? (() => undefined);
    this.child = spawn(options.launch.file, options.launch.args, {
      cwd: options.cwd ?? homedir(),
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const child = this.child;
    this.connection = new AcpConnection(child.stdin!, child.stdout!);
    if (child.stderr) {
      const lines = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY });
      lines.on("line", (line) => {
        const text = line.trim();
        if (!text) {
          return;
        }
        this.stderrTail.push(text);
        if (this.stderrTail.length > STDERR_TAIL_LINES) {
          this.stderrTail.shift();
        }
      });
    }
    this.connection.on("noise", (line: string) => this.log(`[${this.kind}] ${line}`));
    this.connection.on("notification", (method: string, params: Record<string, unknown>) => this.onNotification(method, params));
    this.connection.on("request", (request: RpcIncomingRequest) => this.onRequest(request));

    const spawnFailure = new Promise<never>((_, reject) => {
      child.on("error", (error) => reject(new Error(`无法启动 Agent 进程：${error.message}`)));
    });
    child.on("close", (code) => {
      this.exited = true;
      this.clearIdle();
      this.connection.close(new Error(`Agent 进程已退出（${code === null ? "被终止" : `退出码 ${code}`}）`));
      this.sessions.clear();
      this.loading.clear();
      this.prompts.clear();
      this.emit("exit", code);
    });
    this.ready = Promise.race([
      spawnFailure,
      this.connection.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "nearbox", version: "1" },
        },
        INITIALIZE_TIMEOUT_MS,
      ),
    ]).then(() => {
      this.touch();
    });
    // Callers that never look at `ready` must not turn a start failure into an unhandled rejection.
    this.ready.catch(() => undefined);
  }

  get alive(): boolean {
    return !this.exited && !this.connection.isClosed;
  }

  get busy(): boolean {
    return this.prompts.size > 0 || this.loading.size > 0;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** The last lines the process wrote to stderr, for the run that was going when it died. */
  recentStderr(): string[] {
    return [...this.stderrTail];
  }

  async newSession(cwd: string): Promise<AcpSession> {
    await this.ready;
    this.touch();
    const result = await this.connection.request<Record<string, unknown>>("session/new", { cwd, mcpServers: [] }, SESSION_TIMEOUT_MS);
    const session = this.remember(String(result.sessionId ?? ""), cwd, result);
    if (!session.sessionId) {
      throw new Error("Agent 没有返回会话 id");
    }
    return session;
  }

  /**
   * Sessions the agent can load, newest first. Conversations started by
   * one-shot `-p` runs are not among them, so this is checked before a load.
   */
  async listSessions(): Promise<ListedSession[]> {
    await this.ready;
    const result = await this.connection.request<Record<string, unknown>>("session/list", {}, SET_MODEL_TIMEOUT_MS);
    const out: ListedSession[] = [];
    for (const item of Array.isArray(result?.sessions) ? result.sessions : []) {
      if (item && typeof item === "object" && typeof (item as { sessionId?: unknown }).sessionId === "string") {
        const record = item as { sessionId: string; cwd?: unknown; updatedAt?: unknown };
        out.push({
          sessionId: record.sessionId,
          cwd: typeof record.cwd === "string" ? record.cwd : "",
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
        });
      }
    }
    return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  /**
   * Bring an existing conversation into this process. The agent replays its
   * history as updates while loading; those are swallowed, only what happens
   * after the next prompt is recorded. Throws SessionUnknownError without
   * trying (a load attempt is slow) when the agent has no record of the id.
   */
  loadSession(sessionId: string, cwd: string): Promise<AcpSession> {
    const known = this.sessions.get(sessionId);
    if (known) {
      return Promise.resolve(known);
    }
    const inFlight = this.loading.get(sessionId);
    if (inFlight) {
      return inFlight;
    }
    const job = (async () => {
      await this.ready;
      this.touch();
      if (!(await this.listSessions()).some((item) => item.sessionId === sessionId)) {
        throw new SessionUnknownError(sessionId);
      }
      const result = await this.connection.request<Record<string, unknown>>("session/load", { sessionId, cwd, mcpServers: [] }, SESSION_TIMEOUT_MS);
      return this.remember(sessionId, cwd, result);
    })().finally(() => {
      this.loading.delete(sessionId);
      this.touch();
    });
    this.loading.set(sessionId, job);
    return job;
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.connection.request("session/set_model", { sessionId, modelId }, SET_MODEL_TIMEOUT_MS);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentModelId = modelId;
    }
  }

  /** One turn. Updates stream to the handlers until the agent reports why it stopped. */
  async prompt(sessionId: string, text: string, handlers: PromptHandlers): Promise<PromptOutcome> {
    if (this.prompts.has(sessionId)) {
      throw new Error("这个会话已经有一轮在进行中");
    }
    this.prompts.set(sessionId, { handlers });
    this.clearIdle();
    try {
      const result = await this.connection.request<Record<string, unknown>>("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      return { stopReason: String(result?.stopReason ?? "end_turn") };
    } finally {
      this.prompts.delete(sessionId);
      this.touch();
    }
  }

  /** Ask the agent to stop the turn; `prompt` then resolves with stopReason "cancelled". */
  cancel(sessionId: string): void {
    if (this.prompts.has(sessionId)) {
      this.connection.notify("session/cancel", { sessionId });
    }
  }

  kill(): void {
    this.clearIdle();
    killTree(this.child);
  }

  private remember(sessionId: string, cwd: string, result: Record<string, unknown>): AcpSession {
    const models = result.models && typeof result.models === "object" ? (result.models as Record<string, unknown>) : undefined;
    if (models) {
      const available = Array.isArray(models.availableModels) ? models.availableModels : [];
      const list: AcpModel[] = [];
      for (const item of available) {
        if (item && typeof item === "object" && typeof (item as { modelId?: unknown }).modelId === "string") {
          const record = item as { modelId: string; name?: unknown };
          list.push({ modelId: record.modelId, name: typeof record.name === "string" ? record.name : record.modelId });
        }
      }
      if (list.length) {
        this.models = list;
      }
    }
    const session: AcpSession = {
      sessionId,
      cwd,
      currentModelId: models && typeof models.currentModelId === "string" ? models.currentModelId : undefined,
    };
    if (sessionId) {
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method !== "session/update") {
      return;
    }
    const sessionId = String(params.sessionId ?? "");
    // History replayed by session/load is not part of any turn.
    if (this.loading.has(sessionId)) {
      return;
    }
    const update = params.update && typeof params.update === "object" ? (params.update as Record<string, unknown>) : null;
    const active = this.prompts.get(sessionId);
    if (active && update) {
      active.handlers.onUpdate(update);
    }
  }

  private onRequest(request: RpcIncomingRequest): void {
    if (request.method === "session/request_permission") {
      void this.answerPermission(request);
      return;
    }
    // We advertised no fs/terminal capabilities, so the agent should never ask; refuse politely if it does.
    this.connection.respondError(request.id, { code: -32601, message: `Method not supported: ${request.method}` });
  }

  private async answerPermission(request: RpcIncomingRequest): Promise<void> {
    const sessionId = String(request.params.sessionId ?? "");
    const active = this.prompts.get(sessionId);
    const toolCall = request.params.toolCall && typeof request.params.toolCall === "object" ? (request.params.toolCall as Record<string, unknown>) : {};
    const options = Array.isArray(request.params.options)
      ? request.params.options.filter((item): item is PermissionOption => Boolean(item) && typeof item === "object" && typeof (item as PermissionOption).optionId === "string")
      : [];
    let optionId: string | null = null;
    try {
      optionId = active ? await active.handlers.onPermission(toolCall, options) : null;
    } catch {
      optionId = null;
    }
    this.connection.respond(request.id, optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
  }

  private touch(): void {
    this.lastUsedAt = Date.now();
    this.clearIdle();
    if (this.exited || this.busy) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      if (!this.busy) {
        this.log(`[${this.kind}] host idle for ${HOST_IDLE_MINUTES} min, stopping`);
        this.kill();
      }
    }, HOST_IDLE_MINUTES * 60_000);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Pool: one host per agent kind
// ---------------------------------------------------------------------------

export interface PoolOptions {
  resolveCommand(kind: AgentKind): Promise<ResolvedCommand | null>;
  env(): NodeJS.ProcessEnv;
  log?(message: string): void;
}

export class AgentHostPool {
  private readonly hosts = new Map<AgentKind, AgentHost>();
  private readonly starting = new Map<AgentKind, Promise<AgentHost | null>>();
  private readonly failedAt = new Map<AgentKind, number>();
  private disposed = false;
  private readonly options: PoolOptions;

  constructor(options: PoolOptions) {
    this.options = options;
  }

  /** Whether this agent can be hosted at all. Recent start failures do not block a real run. */
  supports(kind: AgentKind): boolean {
    return !this.disposed && Boolean(ACP_LAUNCH[kind]);
  }

  /** The live host for `kind`, started if needed; null when hosting is unavailable. */
  host(kind: AgentKind): Promise<AgentHost | null> {
    if (!this.supports(kind)) {
      return Promise.resolve(null);
    }
    const existing = this.hosts.get(kind);
    if (existing?.alive) {
      return Promise.resolve(existing);
    }
    const pending = this.starting.get(kind);
    if (pending) {
      return pending;
    }
    const job = this.startHost(kind).finally(() => this.starting.delete(kind));
    this.starting.set(kind, job);
    return job;
  }

  /**
   * Start the host now, and get a session loaded into it so the next message
   * finds everything ready: `sessionId` when the agent knows it, otherwise the
   * newest conversation it does know, which still brings the MCP servers up.
   */
  async warm(kind: AgentKind, cwd?: string, sessionId?: string): Promise<void> {
    const failed = this.failedAt.get(kind);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_FAILURE_MS) {
      return;
    }
    const host = await this.host(kind);
    if (!host || (sessionId && host.hasSession(sessionId))) {
      return;
    }
    const listed = await host.listSessions();
    const wanted = sessionId && cwd && listed.some((item) => item.sessionId === sessionId) ? { sessionId, cwd } : listed.find((item) => item.cwd && existsSync(item.cwd));
    if (wanted && !host.hasSession(wanted.sessionId)) {
      await host.loadSession(wanted.sessionId, wanted.cwd);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const host of this.hosts.values()) {
      host.kill();
    }
    this.hosts.clear();
  }

  private async startHost(kind: AgentKind): Promise<AgentHost | null> {
    const log = this.options.log ?? (() => undefined);
    let host: AgentHost;
    try {
      const command = await this.options.resolveCommand(kind);
      const launch = command ? ACP_LAUNCH[kind]?.(command) ?? null : null;
      if (!launch) {
        return null;
      }
      host = new AgentHost({ kind, launch, env: this.options.env(), log });
    } catch (error) {
      this.failedAt.set(kind, Date.now());
      log(`[${kind}] host spawn failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    host.on("exit", (code) => {
      if (this.hosts.get(kind) === host) {
        this.hosts.delete(kind);
      }
      log(`[${kind}] host exited (${code})`);
    });
    try {
      await host.ready;
    } catch (error) {
      this.failedAt.set(kind, Date.now());
      log(`[${kind}] host handshake failed: ${error instanceof Error ? error.message : String(error)}`);
      host.kill();
      return null;
    }
    if (this.disposed) {
      host.kill();
      return null;
    }
    this.failedAt.delete(kind);
    this.hosts.set(kind, host);
    return host;
  }
}

// ---------------------------------------------------------------------------
// Policy and model helpers (pure)
// ---------------------------------------------------------------------------

export type PermissionDecision = { action: "select"; optionId: string | null; rejected: boolean } | { action: "ask" };

/** Allow/deny pair the UI can show; prefers once over always. */
export function reviewOptions(options: PermissionOption[]): { allow?: PermissionOption; reject?: PermissionOption } {
  const kinds = new Map(options.map((option) => [option.kind, option]));
  return {
    allow: kinds.get("allow_once") ?? kinds.get("allow_always"),
    reject: kinds.get("reject_once") ?? kinds.get("reject_always"),
  };
}

export function isExecuteTool(toolCall: Record<string, unknown>): boolean {
  const kind = String(toolCall.kind ?? "");
  return kind === "execute" || kind === "shell";
}

/**
 * Full access auto-allows. Safe mode auto-allows file work and asks the user
 * before a terminal command — that is the "review" part of safe mode.
 */
export function choosePermission(access: AgentAccess, toolCall: Record<string, unknown>, options: PermissionOption[]): PermissionDecision {
  const { allow, reject } = reviewOptions(options);
  if (access === "safe" && isExecuteTool(toolCall)) {
    return allow || reject ? { action: "ask" } : { action: "select", optionId: null, rejected: true };
  }
  if (allow) {
    return { action: "select", optionId: allow.optionId, rejected: false };
  }
  return { action: "select", optionId: reject?.optionId ?? null, rejected: true };
}

export function describePermission(toolCall: Record<string, unknown>): { toolCallId: string; title: string; command?: string } {
  const raw = toolCall.rawInput && typeof toolCall.rawInput === "object" ? (toolCall.rawInput as Record<string, unknown>) : {};
  const command = [raw.command, toolCall.command, raw.commandLine].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  const title = [toolCall.title, command, toolCall.kind].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "命令";
  return { toolCallId: String(toolCall.toolCallId ?? ""), title, command };
}

/**
 * `cursor-agent --list-models` names models with aliases such as
 * `cursor-grok-4.6-high-fast` or `claude-opus-5-thinking-high`, while an ACP
 * session only accepts one preset per model, e.g. `grok-4.6[effort=high,fast=true]`.
 * Returns the preset when it is exactly what the alias asks for; undefined
 * when no preset matches, so the caller can fall back to a one-shot run with
 * `--model` rather than silently run a different configuration.
 */
export function mapCursorModel(alias: string, models: readonly AcpModel[]): string | undefined {
  const wanted = alias.trim();
  if (!wanted) {
    return undefined;
  }
  const exact = models.find((model) => model.modelId === wanted);
  if (exact) {
    return exact.modelId;
  }
  if (wanted === "auto" || wanted === "default") {
    return models.find((model) => model.name.toLowerCase() === "auto" || model.modelId === "default[]")?.modelId;
  }
  const parsed = parseModelAlias(wanted);
  if (!parsed) {
    return undefined;
  }
  const base = nameTokens(parsed.base.replace(/^cursor-/, ""));
  const candidates = models.filter((model) => sameTokens(nameTokens(model.name), base));
  const matching = candidates.filter((model) => {
    const params = presetParams(model.modelId);
    if ((params.get("fast") === "true") !== parsed.fast) {
      return false;
    }
    if ((params.get("thinking") === "true") !== parsed.thinking) {
      return false;
    }
    const presetLevel = params.get("effort") ?? params.get("reasoning") ?? params.get("reasoning_effort");
    return parsed.effort === undefined || presetLevel === undefined || presetLevel === parsed.effort;
  });
  return matching.length === 1 ? matching[0]!.modelId : undefined;
}

/** "claude-4.6-sonnet" and "claude-sonnet-4-6" name the same model: compare as bags of tokens. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\[.*$/, "")
    .split(/[-.]/)
    .filter(Boolean)
    .sort();
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function presetParams(modelId: string): Map<string, string> {
  const inside = /\[(.*)\]$/.exec(modelId)?.[1] ?? "";
  const params = new Map<string, string>();
  for (const pair of inside.split(",")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      params.set(key.trim(), value.trim());
    }
  }
  return params;
}
