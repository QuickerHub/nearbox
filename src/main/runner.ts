import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  AGENT_LABELS,
  type AgentKind,
  type AgentRun,
  type HostSettings,
  type PermissionChoice,
  type RemoteDevice,
  type RunEvent,
  type RunEventKind,
  sessionIdAlongChain,
  type ToolCall,
  inferContextWindow,
  mergeUsage,
} from "@shared/protocol";
import {
  type AcpSession,
  type AgentHost,
  AgentHostPool,
  type PermissionOption,
  choosePermission,
  describePermission,
  mapCursorModel,
  reviewOptions,
  type PromptHandlers,
  SessionUnknownError,
} from "./acp";
import { KEEPALIVE_CONTINUE_PROMPT, KEEPALIVE_RETRIES, isTransientAgentTransportError } from "./cursor-http.ts";
import {
  buildInvocation,
  buildShellCommandLine,
  createOutputParser,
  type OutputParser,
  type ParseResult,
  quoteForCmd,
  resolveAgentCommand,
  spawnEnv,
  truncate,
} from "./agents";
import { type DelegationConfig, withDelegationPath } from "./delegation";
import { activeDescendants, nextRunnable } from "./scheduler";
import {
  buildLauncher,
  directoryExists,
  isWindowsDevice,
  killLocal,
  killRemoteRun,
  remoteRunPaths,
  SSH_FAILURE_EXIT,
  shQuote,
  sshSpawn,
  uploadFile,
} from "./ssh";

const MAX_RUN_MINUTES = 180;
const MAX_STDERR_LINES = 400;
const MAX_EVENTS_IN_MEMORY = 20_000;
const MAX_CACHED_RUNS = 30;
const SUMMARY_CHARS = 12_000;
/** How often streamed text is pushed to the UI while the agent is writing. */
const STREAM_FLUSH_MS = 120;
/** A cancelled warm turn that has not acknowledged by then takes its host process down with it. */
const CANCEL_GRACE_MS = 10_000;

interface ActiveRun {
  run: AgentRun;
  child: ChildProcess | null;
  parser: OutputParser;
  cancelled: boolean;
  stderrLines: number;
  lastStderr: string;
  sessionId?: string;
  result?: string;
  isError?: boolean;
  timer: NodeJS.Timeout | null;
  /** Set while the agent runs on another computer; `child` is then the local ssh client. */
  remote?: { device: RemoteDevice; pidFile: string };
  /** Set while the turn runs inside a warm agent host instead of its own process; `child` stays null. */
  warm?: { host: AgentHost; sessionId: string; stream: NodeJS.Timeout | null };
  /** Bearer token the agent's `nearbox` command uses; valid only while this run is active. */
  token?: string;
  /** Safe-mode shell: wait here until the user picks allow or reject. */
  permission?: { resolve(optionId: string | null): void };
}

export interface RunAttachment {
  /** Where the file is on this PC. */
  local: string;
  /** Where the prompt says it is on the device. */
  remote: string;
}

export interface RunManagerOptions {
  runsDir: string;
  getSettings(): HostSettings;
  listRuns(): AgentRun[];
  /** Look up a remote device, checking it first if it has never been reached. Throws when unusable. */
  resolveDevice(deviceId: string): Promise<RemoteDevice>;
  /** Files the run's prompt refers to that must exist on the device before the agent starts. */
  attachmentsFor(run: AgentRun): RunAttachment[];
  /** Images sent with this turn, as paths where the agent runs, for CLIs that take images as arguments. */
  imagesFor(run: AgentRun): string[];
  /**
   * What to send when a follow-up finds nothing to resume (the turn it was
   * queued behind never produced a session): the task's context plus the
   * message, so the agent does not receive a bare "and also fix X".
   */
  promptWithoutSession(run: AgentRun): string;
  /** The `nearbox` command setup for a run allowed to delegate; null when it may not. */
  delegationFor(run: AgentRun): DelegationConfig | null;
  onRunChanged(run: AgentRun): void;
  onRunFinished(run: AgentRun): void;
  onEvent(runId: string, event: RunEvent): void;
  /** Agent named the conversation; the hub may put that on the task. */
  onSessionTitle?(run: AgentRun, title: string): void;
}

/**
 * Executes agent runs one process at a time per project, streams their output
 * as RunEvents and keeps a JSONL log per run on disk.
 */
export class RunManager extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>();
  private readonly eventCache = new Map<string, RunEvent[]>();
  private readonly logs = new Map<string, WriteStream>();
  private readonly tokens = new Map<string, string>();
  /** Long-lived agent processes, one per agent kind, so a follow-up does not pay the CLI's start-up again. */
  private readonly hosts: AgentHostPool;
  /** Sessions the host cannot load that the user has already been told about. */
  private readonly legacySessionsNoticed = new Set<string>();

  constructor(private readonly options: RunManagerOptions) {
    super();
    this.hosts = new AgentHostPool({
      resolveCommand: (kind) => resolveAgentCommand(kind, this.options.getSettings().agents[kind]?.command),
      env: () => spawnEnv(),
      log: (message) => console.warn(`[agent-host] ${message}`),
    });
  }

  async init(): Promise<void> {
    await mkdir(this.options.runsDir, { recursive: true });
  }

  /**
   * Get an agent host ready ahead of a message: start the process, and when a
   * conversation is known, load its session so the next turn starts at once.
   * Failures are not the caller's problem; the turn falls back to a one-shot run.
   */
  warm(kind: AgentKind, cwd?: string, sessionId?: string): void {
    void this.hosts.warm(kind, cwd, sessionId).catch(() => undefined);
  }

  /** Called whenever a run is added or capacity may have changed. */
  pump(): void {
    const next = nextRunnable(this.options.listRuns(), this.options.getSettings().maxConcurrentRuns);
    if (!next) {
      return;
    }
    void this.start(next).finally(() => this.pump());
  }

  /** The active run a `nearbox` command's bearer token belongs to. */
  runIdForToken(token: string): string | undefined {
    return this.tokens.get(token);
  }

  cancel(runId: string, reason = "已取消"): boolean {
    // Whatever this run delegated has nobody left to read its answer; each child cancels its own children.
    for (const child of activeDescendants(this.options.listRuns(), runId).filter((item) => item.parentRunId === runId)) {
      this.cancel(child.id, "上级运行已停止");
    }
    const run = this.options.listRuns().find((item) => item.id === runId);
    if (!run) {
      return false;
    }
    if (run.status === "queued") {
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.error = reason;
      this.append(run, "status", reason);
      this.options.onRunChanged(run);
      this.options.onRunFinished(run);
      this.pump();
      return true;
    }
    const active = this.active.get(runId);
    if (!active) {
      return false;
    }
    active.cancelled = true;
    this.settlePermission(active, null);
    if (active.warm) {
      // The host serves other conversations too: ask it to stop this turn, and only kill it if it will not listen.
      const { host, sessionId } = active.warm;
      this.append(run, "status", `${reason}，正在通知 Agent 停止…`);
      host.cancel(sessionId);
      setTimeout(() => {
        if (this.active.get(runId) === active) {
          host.kill();
        }
      }, CANCEL_GRACE_MS).unref();
      return true;
    }
    this.append(run, "status", `${reason}，正在停止进程…`);
    if (active.remote) {
      // Dropping the ssh connection alone leaves the agent running on the device.
      const { device, pidFile } = active.remote;
      void killRemoteRun(device, pidFile).finally(() => killLocal(active.child));
      return true;
    }
    killLocal(active.child);
    return true;
  }

  /** Answer a safe-mode command prompt. `optionId` must be one the agent offered. */
  resolvePermission(runId: string, optionId: string): boolean {
    const state = this.active.get(runId);
    const pending = state?.run.pendingPermission;
    if (!state?.permission || !pending) {
      return false;
    }
    const picked = pending.options.find((option) => option.optionId === optionId);
    if (!picked) {
      return false;
    }
    if (picked.kind.startsWith("reject") && pending.toolCallId) {
      this.absorb(
        state,
        state.parser.push({ sessionUpdate: "tool_call_update", toolCallId: pending.toolCallId, status: "rejected", error: "你拒绝了这条命令" }),
      );
    }
    this.settlePermission(state, optionId);
    return true;
  }

  async events(runId: string, afterSeq = 0): Promise<RunEvent[]> {
    const cached = this.eventCache.get(runId);
    // Memory is authoritative as long as it still holds the first event we need.
    if (cached && cached.length > 0 && cached[0]!.seq <= afterSeq + 1) {
      return cached.filter((event) => event.seq > afterSeq);
    }
    const file = this.logPath(runId);
    if (!existsSync(file)) {
      return [];
    }
    const raw = await readFile(file, "utf8");
    const events: RunEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = JSON.parse(line) as RunEvent;
        if (event.seq > afterSeq) {
          events.push(event);
        }
      } catch {
        // skip torn line
      }
    }
    return events;
  }

  async shutdown(): Promise<void> {
    const kills: Promise<unknown>[] = [];
    for (const active of this.active.values()) {
      active.cancelled = true;
      if (active.remote) {
        kills.push(killRemoteRun(active.remote.device, active.remote.pidFile));
      }
      killLocal(active.child);
    }
    this.hosts.dispose();
    await Promise.allSettled(kills);
    for (const stream of this.logs.values()) {
      stream.end();
    }
  }

  private async start(run: AgentRun): Promise<void> {
    run.status = "running";
    run.startedAt = new Date().toISOString();
    this.options.onRunChanged(run);

    const state: ActiveRun = {
      run,
      child: null,
      parser: createOutputParser(run.agent),
      cancelled: false,
      stderrLines: 0,
      lastStderr: "",
      timer: null,
    };
    this.active.set(run.id, state);
    this.eventCache.set(run.id, this.eventCache.get(run.id) ?? []);

    if (run.deviceId) {
      await this.startRemote(state);
      return;
    }

    const settings = this.options.getSettings();
    const override = settings.agents[run.agent]?.command;
    const command = await resolveAgentCommand(run.agent, override);
    if (!command) {
      this.append(run, "stderr", `没有找到 ${AGENT_LABELS[run.agent]} 的命令行工具。请先在这台电脑上安装并登录。`);
      this.finish(state, null, "未安装对应的 CLI");
      return;
    }
    if (!existsSync(run.cwd)) {
      this.append(run, "stderr", `项目目录不存在：${run.cwd}`);
      this.finish(state, null, "项目目录不存在");
      return;
    }

    const resumeSessionId = this.resolveResume(run);
    // A delegating run needs its own environment (token, PATH), which a shared host cannot give it.
    const delegation = run.delegate ? this.options.delegationFor(run) : null;
    if (!delegation && (await this.startWarm(state, resumeSessionId))) {
      return;
    }
    if (state.cancelled) {
      this.finish(state, null, undefined);
      return;
    }

    const promptFile = join(this.options.runsDir, `${run.id}.prompt.md`);
    await writeFile(promptFile, run.prompt, "utf8");
    const invocation = buildInvocation(run.agent, command, {
      prompt: run.prompt,
      cwd: run.cwd,
      access: run.access,
      model: run.model,
      resumeSessionId,
      promptFile,
      images: this.options.imagesFor(run),
    });

    let env = spawnEnv();
    if (delegation) {
      // The token only opens the delegation endpoints for this run and dies with it.
      state.token = randomBytes(18).toString("base64url");
      this.tokens.set(state.token, run.id);
      env = withDelegationPath(env, delegation.binDir);
      env.NEARBOX_URL = delegation.url;
      env.NEARBOX_TOKEN = state.token;
      env.NEARBOX_RUN_ID = run.id;
    }

    this.append(
      run,
      "status",
      `启动 ${AGENT_LABELS[run.agent]} · ${run.access === "full" ? "完全放开" : "安全模式"}${delegation ? " · 可委派" : ""} · ${run.cwd}`,
    );

    let child: ChildProcess;
    try {
      child = spawn(invocation.file, invocation.args, {
        cwd: run.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
    } catch (error) {
      this.append(run, "stderr", `无法启动进程：${error instanceof Error ? error.message : String(error)}`);
      this.finish(state, null, "无法启动进程");
      return;
    }
    this.attach(state, child, invocation.stdin);
  }

  /**
   * Run on another computer: the prompt (and any attachments) are copied over
   * first, then the agent is started through ssh and its JSONL streams back
   * through the same connection, so parsing is identical to a local run.
   */
  private async startRemote(state: ActiveRun): Promise<void> {
    const run = state.run;
    let device: RemoteDevice;
    try {
      device = await this.options.resolveDevice(run.deviceId!);
    } catch (error) {
      this.append(run, "stderr", error instanceof Error ? error.message : String(error));
      this.finish(state, null, "连不上远程电脑");
      return;
    }
    const agent = device.agents.find((item) => item.kind === run.agent);
    if (!agent?.available || !agent.command) {
      this.append(run, "stderr", `${device.name} 上没有找到 ${AGENT_LABELS[run.agent]} 的命令行工具。请先在那台电脑上安装并登录，然后在设置里重新检测。`);
      this.finish(state, null, `${device.name} 上未安装对应的 CLI`);
      return;
    }
    if (!device.home) {
      this.append(run, "stderr", `还不知道 ${device.name} 的用户目录，请在设置里重新检测这台电脑。`);
      this.finish(state, null, "设备信息不完整");
      return;
    }

    const paths = remoteRunPaths(device, run.id);
    state.remote = { device, pidFile: paths.pidFile };
    const resumeSessionId = this.resolveResume(run);
    const quote = isWindowsDevice(device) ? quoteForCmd : shQuote;
    const built = buildShellCommandLine(
      run.agent,
      agent.command,
      {
        prompt: run.prompt,
        cwd: run.cwd,
        access: run.access,
        model: run.model,
        resumeSessionId,
        promptFile: paths.promptFile,
        images: this.options.imagesFor(run),
      },
      quote,
    );

    this.append(
      run,
      "status",
      `在 ${device.name} 上启动 ${AGENT_LABELS[run.agent]} · ${run.access === "full" ? "完全放开" : "安全模式"} · ${run.cwd}`,
    );

    try {
      if (!(await directoryExists(device, run.cwd))) {
        this.append(run, "stderr", `${device.name} 上没有这个目录：${run.cwd}`);
        this.finish(state, null, "项目目录不存在");
        return;
      }
      await uploadFile(device, paths.promptFile, run.prompt);
      // The local log keeps a copy too, like local runs do.
      await writeFile(join(this.options.runsDir, `${run.id}.prompt.md`), run.prompt, "utf8");
      for (const attachment of this.options.attachmentsFor(run)) {
        if (!existsSync(attachment.local)) {
          continue;
        }
        await uploadFile(device, attachment.remote, await readFile(attachment.local));
        this.append(run, "status", `已复制附件到 ${device.name}：${attachment.remote}`);
      }
    } catch (error) {
      if (state.cancelled) {
        this.finish(state, null, undefined);
        return;
      }
      this.append(run, "stderr", error instanceof Error ? error.message : String(error));
      this.finish(state, null, "准备远程运行失败");
      return;
    }
    if (state.cancelled) {
      this.finish(state, null, undefined);
      return;
    }

    let child: ChildProcess;
    try {
      child = sshSpawn(device, buildLauncher(device, { commandLine: built.commandLine, cwd: run.cwd, pidFile: paths.pidFile }));
    } catch (error) {
      this.append(run, "stderr", `无法启动 ssh：${error instanceof Error ? error.message : String(error)}`);
      this.finish(state, null, "无法启动 ssh");
      return;
    }
    this.attach(state, child, built.stdin);
  }

  /**
   * Run the turn inside the agent's warm host: the process is already up, the
   * conversation is loaded once and stays loaded, so the turn costs only the
   * model's time. Returns false when the host cannot take this turn (agent not
   * hostable, host failed, model only expressible as a `--model` flag), in
   * which case the caller starts a process of its own as before.
   */
  private async startWarm(state: ActiveRun, resumeSessionId: string | undefined): Promise<boolean> {
    const run = state.run;
    const host = await this.hosts.host(run.agent);
    if (!host) {
      this.append(run, "status", "常驻进程这次没起来，本轮用单独进程（结束就会退出）。");
      return false;
    }
    if (state.cancelled) {
      this.finish(state, null, undefined);
      return true;
    }
    // A picked model must exist as a preset in the host; before the first session we do not know them yet.
    let modelId: string | undefined;
    if (run.model) {
      if (!host.models && !resumeSessionId) {
        return false;
      }
      if (host.models) {
        modelId = mapCursorModel(run.model, host.models);
        if (!modelId) {
          this.append(run, "status", `常驻会话不支持模型 ${run.model}，本轮改用单独进程运行。`);
          return false;
        }
      }
    }

    let session: AcpSession;
    try {
      session = resumeSessionId ? await host.loadSession(resumeSessionId, run.cwd) : await host.newSession(run.cwd);
    } catch (error) {
      if (state.cancelled) {
        this.finish(state, null, undefined);
        return true;
      }
      if (error instanceof SessionUnknownError && resumeSessionId) {
        // Conversations begun by one-shot runs stay one-shot; say so once rather than on every turn.
        if (!this.legacySessionsNoticed.has(resumeSessionId)) {
          this.legacySessionsNoticed.add(resumeSessionId);
          this.append(run, "status", "这段会话是在单独进程模式下开始的，常驻进程接不上，回复会慢一些；想要更快的回复可以「改为新会话」。");
        }
        return false;
      }
      this.append(run, "status", `常驻会话不可用（${error instanceof Error ? error.message : String(error)}），本轮改用单独进程运行。`);
      return false;
    }
    if (state.cancelled) {
      this.finish(state, null, undefined);
      return true;
    }
    if (run.model) {
      // The model list only becomes known with the first session; a resumed turn may learn it just now.
      modelId = modelId ?? (host.models ? mapCursorModel(run.model, host.models) : undefined);
      if (!modelId) {
        this.append(run, "status", `常驻会话不支持模型 ${run.model}，本轮改用单独进程运行。`);
        return false;
      }
      if (session.currentModelId !== modelId) {
        try {
          await host.setModel(session.sessionId, modelId);
        } catch (error) {
          this.append(run, "status", `设置模型失败（${error instanceof Error ? error.message : String(error)}），本轮改用单独进程运行。`);
          return false;
        }
      }
    }

    state.sessionId = session.sessionId;
    run.sessionId = session.sessionId;
    const currentModel = modelId ?? session.currentModelId;
    const modelLabel = host.models?.find((model) => model.modelId === currentModel)?.name;
    if (modelLabel) {
      run.modelLabel = modelLabel;
    }
    this.options.onRunChanged(run);
    this.append(run, "status", `启动 ${AGENT_LABELS[run.agent]} · ${run.access === "full" ? "完全放开" : "安全模式"} · ${run.cwd} · 常驻进程`);

    // Updates arrive as ACP session updates, not as the CLI's own JSONL dialect.
    state.parser = createOutputParser("acp");
    state.warm = { host, sessionId: session.sessionId, stream: null };
    state.timer = setTimeout(() => {
      this.cancel(run.id, `超过 ${MAX_RUN_MINUTES} 分钟，自动停止`);
    }, MAX_RUN_MINUTES * 60_000);

    const handlers: PromptHandlers = {
      onUpdate: (update) => {
        this.absorb(state, state.parser.push(update));
        this.scheduleStream(state);
      },
      onPermission: (toolCall, options) => {
        const decision = choosePermission(run.access, toolCall, options);
        if (decision.action === "ask") {
          return this.askPermission(state, toolCall, options);
        }
        const id = String(toolCall.toolCallId ?? "");
        if (decision.rejected && id) {
          this.absorb(
            state,
            state.parser.push({ sessionUpdate: "tool_call_update", toolCallId: id, status: "rejected", error: "命令被拦截：Agent 没有给出可批准的选项。" }),
          );
        }
        return decision.optionId;
      },
    };
    void this.promptWarm(state, host, session.sessionId, handlers);
    return true;
  }

  /**
   * One warm turn, retrying when cursor-agent drops the HTTP/2 stream mid-reply.
   * The same process and session stay up; only the model call is repeated.
   */
  private async promptWarm(state: ActiveRun, host: AgentHost, sessionId: string, handlers: PromptHandlers): Promise<void> {
    const run = state.run;
    let text = run.prompt;
    let attempt = 0;
    const eventsBefore = run.eventCount;
    try {
      while (!state.cancelled) {
        try {
          const outcome = await host.prompt(sessionId, text, handlers);
          const failed = state.isError ? (state.result ?? state.lastStderr ?? "") : "";
          if (host.alive && isTransientAgentTransportError(failed) && attempt < KEEPALIVE_RETRIES) {
            attempt += 1;
            this.append(run, "status", `模型连接中断（HTTP/2 keepalive），正在重试第 ${attempt} 次…`);
            text = run.eventCount > eventsBefore ? KEEPALIVE_CONTINUE_PROMPT : run.prompt;
            state.isError = undefined;
            state.result = undefined;
            await delay(1_000);
            continue;
          }
          this.stopStream(state);
          this.absorb(state, state.parser.push({ sessionUpdate: "end", stopReason: outcome.stopReason, usage: outcome.usage }));
          if (state.isError && !state.lastStderr) {
            state.lastStderr = `Agent 提前结束（${outcome.stopReason}）`;
          }
          this.finish(state, 0, undefined);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (state.cancelled || !host.alive || !isTransientAgentTransportError(message) || attempt >= KEEPALIVE_RETRIES) {
            throw error;
          }
          attempt += 1;
          this.stopStream(state);
          this.append(run, "status", `模型连接中断（HTTP/2 keepalive），正在重试第 ${attempt} 次…`);
          text = run.eventCount > eventsBefore ? KEEPALIVE_CONTINUE_PROMPT : run.prompt;
          await delay(1_000);
        }
      }
      this.stopStream(state);
      this.finish(state, 0, undefined);
    } catch (error) {
      this.stopStream(state);
      const message = error instanceof Error ? error.message : String(error);
      if (!host.alive) {
        for (const line of host.recentStderr()) {
          this.append(run, "stderr", line);
        }
      }
      this.append(run, "stderr", message);
      state.lastStderr = message;
      this.finish(state, host.alive ? 1 : null, host.alive ? undefined : "Agent 进程退出了");
    }
  }

  /** Streamed text reaches the UI in small batches rather than per token. */
  private scheduleStream(state: ActiveRun): void {
    if (!state.warm || state.warm.stream) {
      return;
    }
    state.warm.stream = setTimeout(() => {
      if (state.warm) {
        state.warm.stream = null;
      }
      this.absorb(state, state.parser.flushPartial());
    }, STREAM_FLUSH_MS);
  }

  private stopStream(state: ActiveRun): void {
    if (state.warm?.stream) {
      clearTimeout(state.warm.stream);
      state.warm.stream = null;
    }
  }

  /**
   * The session this turn continues, looked up now rather than at dispatch
   * time because the previous turn may still have been running when this one
   * was queued. When the chain never produced a session the message is sent
   * as a new conversation, with the task's context put back in front of it.
   */
  private resolveResume(run: AgentRun): string | undefined {
    if (!run.resumedFromRunId) {
      return undefined;
    }
    const sessionId = sessionIdAlongChain(this.options.listRuns(), run.resumedFromRunId);
    if (sessionId) {
      return sessionId;
    }
    run.prompt = this.options.promptWithoutSession(run);
    this.options.onRunChanged(run);
    this.append(run, "status", "上一轮没有建立可继续的会话，这条消息作为新会话发送。");
    return undefined;
  }

  private attach(state: ActiveRun, child: ChildProcess, stdin: string | undefined): void {
    const run = state.run;
    state.child = child;

    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    }

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      lines.on("line", (line) => this.consume(state, line));
    }
    if (child.stderr) {
      const lines = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY });
      lines.on("line", (line) => {
        const text = line.trim();
        if (!text || (state.remote && isPowerShellNoise(text))) {
          return;
        }
        state.lastStderr = text;
        state.stderrLines += 1;
        if (state.stderrLines <= MAX_STDERR_LINES) {
          this.append(run, "stderr", text);
        } else if (state.stderrLines === MAX_STDERR_LINES + 1) {
          this.append(run, "stderr", "（stderr 输出过多，后续省略）");
        }
      });
    }

    state.timer = setTimeout(() => {
      this.cancel(run.id, `超过 ${MAX_RUN_MINUTES} 分钟，自动停止`);
    }, MAX_RUN_MINUTES * 60_000);

    child.on("error", (error) => {
      this.append(run, "stderr", `进程错误：${error.message}`);
    });
    child.on("close", (code) => {
      if (state.remote && code === SSH_FAILURE_EXIT && !state.cancelled) {
        this.append(run, "stderr", `和 ${state.remote.device.name} 的 SSH 连接断开了。`);
      }
      this.finish(state, code, undefined);
    });
  }

  private consume(state: ActiveRun, line: string): void {
    this.absorb(state, state.parser.feed(line));
  }

  /** Record what the parser made of a line or update: events, session, model, outcome. */
  private absorb(state: ActiveRun, parsed: ParseResult): void {
    for (const event of parsed.events) {
      this.append(state.run, event.kind, event.text, event.tool, event.delta);
    }
    let changed = false;
    if (parsed.sessionId) {
      state.sessionId = parsed.sessionId;
      if (state.run.sessionId !== parsed.sessionId) {
        state.run.sessionId = parsed.sessionId;
        changed = true;
      }
    }
    if (parsed.modelLabel && state.run.modelLabel !== parsed.modelLabel) {
      state.run.modelLabel = parsed.modelLabel;
      changed = true;
    }
    if (parsed.usage) {
      const usage = { ...parsed.usage };
      if (!usage.contextWindow) {
        usage.contextWindow = inferContextWindow(state.run.model, state.run.modelLabel);
      }
      const next = mergeUsage(state.run.usage, usage);
      if (JSON.stringify(state.run.usage) !== JSON.stringify(next)) {
        state.run.usage = next;
        changed = true;
      }
    }
    if (changed) {
      this.options.onRunChanged(state.run);
    }
    if (parsed.sessionTitle) {
      this.options.onSessionTitle?.(state.run, parsed.sessionTitle);
    }
    if (parsed.result !== undefined) {
      state.result = parsed.result;
    }
    if (parsed.isError !== undefined) {
      state.isError = parsed.isError;
    }
  }

  private askPermission(state: ActiveRun, toolCall: Record<string, unknown>, options: PermissionOption[]): Promise<string | null> {
    const described = describePermission(toolCall);
    const { allow, reject } = reviewOptions(options);
    const choices: PermissionChoice[] = [];
    if (allow) {
      choices.push({ optionId: allow.optionId, kind: allow.kind, label: "允许" });
    }
    if (reject) {
      choices.push({ optionId: reject.optionId, kind: reject.kind, label: "拒绝" });
    }
    if (!choices.length) {
      return Promise.resolve(null);
    }
    if (described.toolCallId) {
      this.absorb(
        state,
        state.parser.push({
          sessionUpdate: "tool_call",
          toolCallId: described.toolCallId,
          title: described.title,
          kind: "execute",
          status: "pending",
          rawInput: described.command ? { command: described.command } : undefined,
        }),
      );
    }
    return new Promise((resolve) => {
      state.permission = { resolve };
      state.run.pendingPermission = {
        toolCallId: described.toolCallId,
        title: described.title,
        command: described.command,
        options: choices,
      };
      this.options.onRunChanged(state.run);
    });
  }

  private settlePermission(state: ActiveRun, optionId: string | null): void {
    const waiter = state.permission;
    state.permission = undefined;
    if (state.run.pendingPermission) {
      delete state.run.pendingPermission;
      this.options.onRunChanged(state.run);
    }
    waiter?.resolve(optionId);
  }

  private finish(state: ActiveRun, exitCode: number | null, forcedError: string | undefined): void {
    if (!this.active.has(state.run.id)) {
      return;
    }
    this.settlePermission(state, null);
    const run = state.run;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    if (state.token) {
      this.tokens.delete(state.token);
    }
    const tail = state.parser.end();
    for (const event of tail.events) {
      this.append(run, event.kind, event.text);
    }
    const result = state.result ?? tail.result;
    run.finishedAt = new Date().toISOString();
    run.exitCode = exitCode;
    run.sessionId = state.sessionId ?? run.sessionId;
    if (state.cancelled) {
      run.status = "cancelled";
      run.error = run.error ?? "已取消";
    } else if (forcedError) {
      run.status = "failed";
      run.error = forcedError;
    } else if (exitCode === 0 && !state.isError) {
      run.status = "succeeded";
      run.error = undefined;
    } else {
      run.status = "failed";
      run.error =
        (state.isError && result) || state.lastStderr || (exitCode === null ? "进程被终止" : `退出码 ${exitCode}`);
    }
    run.summary = result ? truncate(result, SUMMARY_CHARS) : undefined;
    this.append(
      run,
      "status",
      run.status === "succeeded" ? "运行结束" : run.status === "cancelled" ? "已停止" : `运行失败：${run.error ?? ""}`,
    );
    this.active.delete(run.id);
    const log = this.logs.get(run.id);
    if (log) {
      log.end();
      this.logs.delete(run.id);
    }
    this.trimCache();
    this.options.onRunChanged(run);
    this.options.onRunFinished(run);
  }

  private append(run: AgentRun, kind: RunEventKind, text: string, tool?: ToolCall, delta?: boolean): void {
    run.eventCount += 1;
    const event: RunEvent = { seq: run.eventCount, at: new Date().toISOString(), kind, text };
    if (tool) {
      event.tool = tool;
    }
    if (delta) {
      event.delta = true;
    }
    let cached = this.eventCache.get(run.id);
    if (!cached) {
      cached = [];
      this.eventCache.set(run.id, cached);
    }
    cached.push(event);
    if (cached.length > MAX_EVENTS_IN_MEMORY) {
      cached.splice(0, cached.length - MAX_EVENTS_IN_MEMORY);
    }
    this.logFor(run.id).write(`${JSON.stringify(event)}\n`);
    this.options.onEvent(run.id, event);
  }

  private logFor(runId: string): WriteStream {
    let stream = this.logs.get(runId);
    if (!stream) {
      stream = createWriteStream(this.logPath(runId), { flags: "a" });
      stream.on("error", () => undefined);
      this.logs.set(runId, stream);
    }
    return stream;
  }

  private logPath(runId: string): string {
    return join(this.options.runsDir, `${runId}.jsonl`);
  }

  private trimCache(): void {
    const finished = [...this.eventCache.keys()].filter((id) => !this.active.has(id));
    while (finished.length > MAX_CACHED_RUNS) {
      const oldest = finished.shift();
      if (oldest) {
        this.eventCache.delete(oldest);
      }
    }
  }
}

/** When its stderr is a pipe, powershell.exe serialises progress records as CLIXML; none of it is agent output. */
function isPowerShellNoise(line: string): boolean {
  return line.startsWith("#< CLIXML") || line.startsWith("<Objs ") || line.startsWith("<Objs>");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
