import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import {
  AGENT_KINDS,
  AGENT_LABELS,
  type Actor,
  type AgentAccess,
  type AgentInfo,
  type AgentKind,
  type AgentRun,
  type DispatchInput,
  type FileMeta,
  type HostSettings,
  isRunActive,
  newId,
  type Project,
  type RunEvent,
  splitCapture,
  type Task,
  type TaskInput,
  type TaskNote,
  type TaskPatch,
  TASK_STATUSES,
  type TaskStatus,
} from "@shared/protocol";
import { detectAgents } from "./agents";
import { RunManager } from "./runner";
import { Store, type StoredFile } from "./store";

function fail(message: string, code = "BAD_REQUEST"): never {
  throw Object.assign(new Error(message), { code });
}

/**
 * Owns all task-manager state. The LAN server and the Electron shell talk to
 * this; it talks to the store (persistence) and the runner (processes).
 */
export class TaskHub extends EventEmitter {
  readonly store: Store;
  readonly runner: RunManager;
  readonly dataDir: string;
  agents: AgentInfo[] = AGENT_KINDS.map((kind) => ({
    kind,
    label: AGENT_LABELS[kind],
    available: false,
    supportsResume: true,
  }));

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.store = new Store(dataDir);
    this.runner = new RunManager({
      runsDir: join(dataDir, "runs"),
      getSettings: () => this.store.state.settings,
      listRuns: () => this.store.state.runs,
      onRunChanged: (run) => {
        this.touchTaskForRun(run);
        this.store.save();
        this.changed();
      },
      onRunFinished: (run) => {
        this.emit("run-finished", run);
      },
      onEvent: (runId: string, event: RunEvent) => {
        this.emit("run-event", runId, event);
      },
    });
  }

  async init(): Promise<void> {
    await this.runner.init();
    await this.refreshAgents();
  }

  async shutdown(): Promise<void> {
    await this.runner.shutdown();
    await this.store.flush();
  }

  get settings(): HostSettings {
    return this.store.state.settings;
  }

  get tasks(): Task[] {
    return this.store.state.tasks;
  }

  get projects(): Project[] {
    return this.store.state.projects;
  }

  get runs(): AgentRun[] {
    return this.store.state.runs;
  }

  // ---------------------------------------------------------------- agents

  async refreshAgents(): Promise<AgentInfo[]> {
    const overrides: Partial<Record<AgentKind, string | undefined>> = {};
    for (const kind of AGENT_KINDS) {
      overrides[kind] = this.settings.agents[kind]?.command;
    }
    this.agents = await detectAgents(overrides);
    this.changed();
    return this.agents;
  }

  // ----------------------------------------------------------------- tasks

  capture(from: Actor, text: string, id = newId()): Task {
    const trimmed = text.replace(/\r\n/g, "\n").trim();
    if (!trimmed) {
      fail("内容不能为空。", "EMPTY");
    }
    const existing = this.tasks.find((task) => task.id === id);
    if (existing) {
      return existing;
    }
    const { title, details } = splitCapture(trimmed);
    return this.createTask(from, { title, details, status: "inbox" }, id);
  }

  createTask(from: Actor, input: TaskInput, id = newId()): Task {
    const title = String(input.title ?? "").trim();
    if (!title) {
      fail("标题不能为空。", "EMPTY");
    }
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: title.slice(0, 200),
      details: String(input.details ?? "").trim(),
      status: normalizeStatus(input.status) ?? "inbox",
      priority: input.priority === "high" ? "high" : "normal",
      projectId: this.projectIdOrUndefined(input.projectId),
      agent: agentOrUndefined(input.agent),
      createdBy: from,
      createdAt: now,
      updatedAt: now,
      notes: [],
    };
    this.tasks.push(task);
    this.store.save();
    this.changed();
    return task;
  }

  updateTask(from: Actor, id: string, patch: TaskPatch): Task {
    const task = this.requireTask(id);
    const before = task.status;
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) {
        fail("标题不能为空。", "EMPTY");
      }
      task.title = title.slice(0, 200);
    }
    if (patch.details !== undefined) {
      task.details = String(patch.details).trim();
    }
    if (patch.status !== undefined) {
      const status = normalizeStatus(patch.status);
      if (!status) {
        fail("未知的任务状态。");
      }
      task.status = status;
      task.completedAt = status === "done" ? new Date().toISOString() : undefined;
    }
    if (patch.priority !== undefined) {
      task.priority = patch.priority === "high" ? "high" : "normal";
    }
    if (patch.projectId !== undefined) {
      task.projectId = this.projectIdOrUndefined(patch.projectId);
    }
    if (patch.agent !== undefined) {
      task.agent = agentOrUndefined(patch.agent);
    }
    if (patch.status !== undefined && task.status !== before) {
      task.notes.push(this.note(from, "status", `${statusLabel(before)} → ${statusLabel(task.status)}`));
    }
    task.updatedAt = new Date().toISOString();
    this.store.save();
    this.changed();
    return task;
  }

  deleteTask(id: string): void {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      fail("任务不存在。", "NOT_FOUND");
    }
    for (const run of this.runs) {
      if (run.taskId === id && isRunActive(run)) {
        this.runner.cancel(run.id, "任务已删除");
      }
    }
    this.tasks.splice(index, 1);
    this.store.save();
    this.changed();
  }

  addNote(from: Actor, taskId: string, text: string): TaskNote {
    const task = this.requireTask(taskId);
    const trimmed = text.replace(/\r\n/g, "\n").trim();
    if (!trimmed) {
      fail("备注不能为空。", "EMPTY");
    }
    const note = this.note(from, "note", trimmed);
    task.notes.push(note);
    task.updatedAt = note.createdAt;
    this.store.save();
    this.changed();
    return note;
  }

  attachFile(from: Actor, taskId: string | null, file: FileMeta, stored: StoredFile): { task: Task; note: TaskNote } {
    this.store.state.files[file.id] = stored;
    const task = taskId ? this.requireTask(taskId) : this.createTask(from, { title: file.name, status: "inbox" });
    const note: TaskNote = { ...this.note(from, "note", undefined), file };
    task.notes.push(note);
    task.updatedAt = note.createdAt;
    this.store.save();
    this.changed();
    return { task, note };
  }

  fileById(fileId: string): StoredFile | undefined {
    return this.store.state.files[fileId];
  }

  // -------------------------------------------------------------- projects

  addProject(input: { path: string; name?: string; defaultAgent?: AgentKind | null }): Project {
    const path = resolvePath(String(input.path ?? "").trim());
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
      fail("目录不存在，请填写电脑上真实存在的文件夹。");
    }
    const existing = this.projects.find((project) => samePath(project.path, path));
    if (existing) {
      return existing;
    }
    const project: Project = {
      id: newId(),
      name: String(input.name ?? "").trim() || basename(path) || path,
      path,
      defaultAgent: agentOrUndefined(input.defaultAgent),
      createdAt: new Date().toISOString(),
    };
    this.projects.push(project);
    this.store.save();
    this.changed();
    return project;
  }

  updateProject(id: string, patch: { name?: string; defaultAgent?: AgentKind | null }): Project {
    const project = this.requireProject(id);
    if (patch.name !== undefined) {
      project.name = String(patch.name).trim() || project.name;
    }
    if (patch.defaultAgent !== undefined) {
      project.defaultAgent = agentOrUndefined(patch.defaultAgent);
    }
    this.store.save();
    this.changed();
    return project;
  }

  removeProject(id: string): void {
    const index = this.projects.findIndex((project) => project.id === id);
    if (index === -1) {
      fail("项目不存在。", "NOT_FOUND");
    }
    if (this.runs.some((run) => run.projectId === id && isRunActive(run))) {
      fail("这个项目还有正在运行的 Agent，先停止再移除。");
    }
    this.projects.splice(index, 1);
    for (const task of this.tasks) {
      if (task.projectId === id) {
        task.projectId = undefined;
      }
    }
    this.store.save();
    this.changed();
  }

  // ------------------------------------------------------------------ runs

  defaultPrompt(taskId: string, projectId?: string): string {
    const task = this.requireTask(taskId);
    const project = projectId ? this.projects.find((item) => item.id === projectId) : undefined;
    const lines: string[] = [`# 任务：${task.title}`, ""];
    if (task.details) {
      lines.push(task.details, "");
    }
    const notes = task.notes.filter((note) => note.kind === "note" && note.text);
    if (notes.length) {
      lines.push("## 补充说明", ...notes.map((note) => `- ${note.text}`), "");
    }
    const files = task.notes.filter((note) => note.file).map((note) => this.fileById(note.file!.id)?.path).filter(Boolean);
    if (files.length) {
      lines.push("## 附件（本机路径，可直接读取）", ...files.map((path) => `- ${path}`), "");
    }
    lines.push(
      "## 要求",
      project ? `- 当前工作目录就是项目「${project.name}」（${project.path}），只改这个项目里的文件。` : "- 只改当前工作目录里的文件。",
      "- 先理解现有代码再动手，改完自行验证（编译 / 测试 / 运行）。",
      "- 结束时用中文简要总结：做了什么、改了哪些文件、还有什么需要我确认。",
    );
    return lines.join("\n");
  }

  dispatch(from: Actor, taskId: string, input: DispatchInput): AgentRun {
    const task = this.requireTask(taskId);
    const project = this.requireProject(String(input.projectId ?? ""));
    const agent = agentOrUndefined(input.agent);
    if (!agent) {
      fail("请选择一个 Agent。");
    }
    const info = this.agents.find((item) => item.kind === agent);
    if (!info?.available) {
      fail(`${AGENT_LABELS[agent]} 还没有在这台电脑上安装，无法派发。`);
    }
    const agentSettings = this.settings.agents[agent];
    const access: AgentAccess = input.access === "full" || input.access === "safe" ? input.access : agentSettings?.access ?? "safe";
    const prompt = String(input.prompt ?? "").trim() || this.defaultPrompt(task.id, project.id);
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: newId(),
      taskId: task.id,
      projectId: project.id,
      agent,
      access,
      model: String(input.model ?? agentSettings?.model ?? "").trim() || undefined,
      prompt,
      cwd: project.path,
      status: "queued",
      requestedBy: from,
      createdAt: now,
      eventCount: 0,
    };
    if (input.resumeRunId) {
      const previous = this.runs.find((item) => item.id === input.resumeRunId);
      if (!previous || previous.taskId !== task.id) {
        fail("找不到要继续的运行。", "NOT_FOUND");
      }
      if (!previous.sessionId) {
        fail("上一次运行没有留下会话，无法继续对话。请重新派发。");
      }
      if (previous.agent !== agent) {
        fail("继续对话必须使用同一个 Agent。");
      }
      run.resumedFromRunId = previous.id;
      run.cwd = previous.cwd;
    }
    this.runs.push(run);
    task.latestRunId = run.id;
    task.projectId = project.id;
    task.agent = agent;
    if (task.status === "inbox" || task.status === "todo") {
      task.status = "doing";
    }
    task.notes.push({ ...this.note(from, "run", undefined), runId: run.id });
    task.updatedAt = now;
    project.lastUsedAt = now;
    this.store.save();
    this.changed();
    this.runner.pump();
    return run;
  }

  reply(from: Actor, runId: string, text: string): AgentRun {
    const previous = this.runs.find((item) => item.id === runId);
    if (!previous) {
      fail("运行不存在。", "NOT_FOUND");
    }
    const trimmed = text.trim();
    if (!trimmed) {
      fail("内容不能为空。", "EMPTY");
    }
    return this.dispatch(from, previous.taskId, {
      agent: previous.agent,
      projectId: previous.projectId,
      prompt: trimmed,
      access: previous.access,
      model: previous.model,
      resumeRunId: previous.id,
    });
  }

  cancelRun(runId: string): void {
    if (!this.runner.cancel(runId)) {
      fail("这个运行已经结束了。");
    }
  }

  runEvents(runId: string, afterSeq: number): Promise<RunEvent[]> {
    return this.runner.events(runId, afterSeq);
  }

  // -------------------------------------------------------------- settings

  updateSettings(patch: Partial<HostSettings>): HostSettings {
    const settings = this.settings;
    if (patch.maxConcurrentRuns !== undefined) {
      const value = Number(patch.maxConcurrentRuns);
      settings.maxConcurrentRuns = Number.isFinite(value) ? Math.min(4, Math.max(1, Math.round(value))) : 1;
    }
    if (patch.closeToTray !== undefined) {
      settings.closeToTray = Boolean(patch.closeToTray);
    }
    if (patch.launchAtLogin !== undefined) {
      settings.launchAtLogin = Boolean(patch.launchAtLogin);
    }
    if (patch.notifyOnRunFinish !== undefined) {
      settings.notifyOnRunFinish = Boolean(patch.notifyOnRunFinish);
    }
    if (patch.agents) {
      for (const kind of AGENT_KINDS) {
        const next = patch.agents[kind];
        if (!next) {
          continue;
        }
        settings.agents[kind] = {
          access: next.access === "full" ? "full" : "safe",
          model: String(next.model ?? "").trim() || undefined,
          command: String(next.command ?? "").trim() || undefined,
        };
      }
    }
    this.store.save();
    this.emit("settings", settings);
    this.changed();
    this.runner.pump();
    return settings;
  }

  // --------------------------------------------------------------- helpers

  private touchTaskForRun(run: AgentRun): void {
    const task = this.tasks.find((item) => item.id === run.taskId);
    if (task) {
      task.updatedAt = new Date().toISOString();
    }
  }

  private note(from: Actor, kind: TaskNote["kind"], text: string | undefined): TaskNote {
    return { id: newId(), kind, from, text, createdAt: new Date().toISOString() };
  }

  private requireTask(id: string): Task {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) {
      fail("任务不存在。", "NOT_FOUND");
    }
    return task;
  }

  private requireProject(id: string): Project {
    const project = this.projects.find((item) => item.id === id);
    if (!project) {
      fail("请先选择项目目录。", "NOT_FOUND");
    }
    return project;
  }

  private projectIdOrUndefined(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    return this.projects.some((project) => project.id === value) ? value : undefined;
  }

  private changed(): void {
    this.emit("changed");
  }
}

function normalizeStatus(value: unknown): TaskStatus | undefined {
  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : undefined;
}

function agentOrUndefined(value: unknown): AgentKind | undefined {
  return AGENT_KINDS.includes(value as AgentKind) ? (value as AgentKind) : undefined;
}

function statusLabel(status: TaskStatus): string {
  return { inbox: "收集箱", todo: "待办", doing: "进行中", done: "已完成" }[status];
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => resolvePath(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
