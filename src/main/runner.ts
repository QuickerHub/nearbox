import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  AGENT_LABELS,
  type AgentRun,
  type HostSettings,
  type RunEvent,
  type RunEventKind,
  sessionIdAlongChain,
  type ToolCall,
} from "@shared/protocol";
import {
  buildInvocation,
  createOutputParser,
  type OutputParser,
  resolveAgentCommand,
  spawnEnv,
  truncate,
} from "./agents";

const MAX_RUN_MINUTES = 180;
const MAX_STDERR_LINES = 400;
const MAX_EVENTS_IN_MEMORY = 20_000;
const MAX_CACHED_RUNS = 30;
const SUMMARY_CHARS = 12_000;

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
}

export interface RunManagerOptions {
  runsDir: string;
  getSettings(): HostSettings;
  listRuns(): AgentRun[];
  onRunChanged(run: AgentRun): void;
  onRunFinished(run: AgentRun): void;
  onEvent(runId: string, event: RunEvent): void;
}

/**
 * Executes agent runs one process at a time per project, streams their output
 * as RunEvents and keeps a JSONL log per run on disk.
 */
export class RunManager extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>();
  private readonly eventCache = new Map<string, RunEvent[]>();
  private readonly logs = new Map<string, WriteStream>();

  constructor(private readonly options: RunManagerOptions) {
    super();
  }

  async init(): Promise<void> {
    await mkdir(this.options.runsDir, { recursive: true });
  }

  /** Called whenever a run is added or capacity may have changed. */
  pump(): void {
    const settings = this.options.getSettings();
    const runs = this.options.listRuns();
    const running = runs.filter((run) => run.status === "running");
    const limit = Math.max(1, settings.maxConcurrentRuns || 1);
    if (running.length >= limit) {
      return;
    }
    const busyProjects = new Set(running.map((run) => run.projectId));
    const next = runs.find((run) => run.status === "queued" && !busyProjects.has(run.projectId));
    if (!next) {
      return;
    }
    void this.start(next).finally(() => this.pump());
  }

  cancel(runId: string, reason = "已取消"): boolean {
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
    this.append(run, "status", `${reason}，正在停止进程…`);
    killTree(active.child);
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
    for (const active of this.active.values()) {
      active.cancelled = true;
      killTree(active.child);
    }
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

    const promptFile = join(this.options.runsDir, `${run.id}.prompt.md`);
    await writeFile(promptFile, run.prompt, "utf8");
    // Resolved now rather than at dispatch time: the previous turn may still have been running when this one was queued.
    const resumeSessionId = run.resumedFromRunId ? sessionIdAlongChain(this.options.listRuns(), run.resumedFromRunId) : undefined;
    const invocation = buildInvocation(run.agent, command, {
      prompt: run.prompt,
      cwd: run.cwd,
      access: run.access,
      model: run.model,
      resumeSessionId,
      promptFile,
    });

    this.append(run, "status", `启动 ${AGENT_LABELS[run.agent]} · ${run.access === "full" ? "完全放开" : "安全模式"} · ${run.cwd}`);
    if (run.resumedFromRunId && !resumeSessionId) {
      this.append(run, "status", "上一轮没有留下可继续的会话，这条消息将作为新会话发送。");
    }

    let child: ChildProcess;
    try {
      child = spawn(invocation.file, invocation.args, {
        cwd: run.cwd,
        env: spawnEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
    } catch (error) {
      this.append(run, "stderr", `无法启动进程：${error instanceof Error ? error.message : String(error)}`);
      this.finish(state, null, "无法启动进程");
      return;
    }
    state.child = child;

    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      if (invocation.stdin !== undefined) {
        child.stdin.write(invocation.stdin);
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
        if (!text) {
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
      this.finish(state, code, undefined);
    });
  }

  private consume(state: ActiveRun, line: string): void {
    const parsed = state.parser.feed(line);
    for (const event of parsed.events) {
      this.append(state.run, event.kind, event.text, event.tool);
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
    if (changed) {
      this.options.onRunChanged(state.run);
    }
    if (parsed.result !== undefined) {
      state.result = parsed.result;
    }
    if (parsed.isError !== undefined) {
      state.isError = parsed.isError;
    }
  }

  private finish(state: ActiveRun, exitCode: number | null, forcedError: string | undefined): void {
    if (!this.active.has(state.run.id)) {
      return;
    }
    const run = state.run;
    if (state.timer) {
      clearTimeout(state.timer);
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

  private append(run: AgentRun, kind: RunEventKind, text: string, tool?: ToolCall): void {
    run.eventCount += 1;
    const event: RunEvent = { seq: run.eventCount, at: new Date().toISOString(), kind, text };
    if (tool) {
      event.tool = tool;
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

function killTree(child: ChildProcess | null): void {
  if (!child || child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 5000).unref();
}
