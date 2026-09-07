import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import {
  adoptSessionTitle,
  AGENT_KINDS,
  AGENT_LABELS,
  type Actor,
  type AgentAccess,
  type AgentInfo,
  type AgentKind,
  type AgentRun,
  agentsForProject,
  canContinueRun,
  type DelegateInput,
  type DeviceCandidate,
  type DispatchInput,
  type FileMeta,
  type HostSettings,
  isRunActive,
  MAX_FILES_PER_MESSAGE,
  newId,
  canListModels,
  normalizeModelId,
  type NoteInput,
  type Project,
  type RemoteDevice,
  type RemoteDeviceInput,
  type RemoteDevicePatch,
  type RemoteDirListing,
  type RunEvent,
  splitCapture,
  type Task,
  type TaskInput,
  type TaskNote,
  sessionIdAlongChain,
  type TaskPatch,
  TASK_STATUSES,
  type TaskStatus,
} from "@shared/protocol";
import { detectAgents, listAgentModels } from "./agents";
import { ensureCursorAgentHttp1 } from "./cursor-http.ts";
import { readCursorIdeModels } from "./cursor-ide-state.ts";
import type { DelegationConfig } from "./delegation";
import { discoverDevices } from "./lan-discover";
import { buildDelegatedPrompt, buildTurnPrompt, delegationSection, imagePaths, type PromptAttachment } from "./prompt";
import { type RunAttachment, RunManager } from "./runner";
import { assertSafeRemotePath, directoryExists, listDirectory, probeDevice, remoteAttachmentPath } from "./ssh";
import { Store, type StoredFile } from "./store";

function fail(message: string, code = "BAD_REQUEST"): never {
  throw Object.assign(new Error(message), { code });
}

/** How long `nearbox ask` blocks before telling the agent to come back with `nearbox wait`; the prompt quotes it. */
const DELEGATE_WAIT_SECONDS = 90;
/** Longest single long-poll the API honours. */
const MAX_WAIT_MS = 120_000;
/** Model catalogs are re-fetched this often while the app runs, and at most this often on demand. */
const MODEL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MODEL_RETRY_MS = 60_000;
/** Agent hosts are started this long after launch, so they do not compete with the app coming up. */
const WARM_AT_STARTUP_DELAY_MS = 8_000;

/**
 * Owns all task-manager state. The LAN server and the Electron shell talk to
 * this; it talks to the store (persistence) and the runner (processes).
 */
export class TaskHub extends EventEmitter {
  readonly store: Store;
  readonly runner: RunManager;
  readonly dataDir: string;
  private readonly deviceChecks = new Map<string, Promise<RemoteDevice>>();
  private readonly modelFetches = new Map<AgentKind, Promise<void>>();
  /** When each CLI was last asked for its catalog, successful or not; keeps a broken CLI from being hammered. */
  private readonly modelAttempts = new Map<AgentKind, number>();
  private modelTimer: NodeJS.Timeout | null = null;
  /** Unset when the `nearbox` launcher could not be installed; runs then cannot delegate. */
  private readonly delegation: DelegationConfig | null;
  agents: AgentInfo[] = AGENT_KINDS.map((kind) => ({
    kind,
    label: AGENT_LABELS[kind],
    available: false,
    supportsResume: true,
  }));

  constructor(dataDir: string, options: { delegation?: DelegationConfig | null } = {}) {
    super();
    // Several `nearbox wait` calls may be parked on run-finished at once.
    this.setMaxListeners(100);
    this.dataDir = dataDir;
    this.delegation = options.delegation ?? null;
    this.store = new Store(dataDir);
    // Last session's catalogs make the picker complete before any CLI has answered (or when offline).
    for (const info of this.agents) {
      const cached = this.store.state.agentModels[info.kind];
      if (cached) {
        info.models = cached.models;
        info.modelsCheckedAt = cached.checkedAt;
        if (cached.ideModels) {
          info.ideModels = cached.ideModels;
        }
      }
    }
    this.runner = new RunManager({
      runsDir: join(dataDir, "runs"),
      getSettings: () => this.store.state.settings,
      listRuns: () => this.store.state.runs,
      resolveDevice: (deviceId) => this.resolveDevice(deviceId),
      attachmentsFor: (run) => this.attachmentsFor(run),
      imagesFor: (run) => imagePaths(this.promptAttachments(run.attachments ?? [], run.deviceId)),
      promptWithoutSession: (run) => this.promptWithoutSession(run),
      delegationFor: (run) => (run.delegate && !run.deviceId ? this.delegation : null),
      onRunChanged: (run) => {
        this.touchTaskForRun(run);
        this.store.save();
        this.changed();
      },
      onSessionTitle: (run, title) => {
        this.applySessionTitle(run.taskId, title);
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
    // Before any cursor-agent process starts: HTTP/2 keepalive pings time out on long turns.
    ensureCursorAgentHttp1();
    await this.runner.init();
    await this.refreshAgents();
    // The app lives in the tray for days; catalogs gain and lose models meanwhile.
    this.modelTimer = setInterval(() => void this.refreshModels(undefined, true), MODEL_REFRESH_INTERVAL_MS);
    this.modelTimer.unref();
    // Once the app has settled, bring the agent up with the newest conversation loaded: its start-up
    // (mostly MCP servers) is then paid while nobody is waiting, and the first message of the day is
    // as quick as any follow-up.
    setTimeout(() => this.warmRecentConversations(), WARM_AT_STARTUP_DELAY_MS).unref();
  }

  private warmRecentConversations(): void {
    for (const kind of AGENT_KINDS) {
      if (!this.agents.find((item) => item.kind === kind)?.available) {
        continue;
      }
      const recent = [...this.runs].reverse().find((run) => run.agent === kind && !run.deviceId && run.sessionId && existsSync(run.cwd));
      this.runner.warm(kind, recent?.cwd, recent?.sessionId);
    }
  }

  async shutdown(): Promise<void> {
    if (this.modelTimer) {
      clearInterval(this.modelTimer);
      this.modelTimer = null;
    }
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

  get remoteDevices(): RemoteDevice[] {
    return this.store.state.remoteDevices;
  }

  // ---------------------------------------------------------------- agents

  async refreshAgents(): Promise<AgentInfo[]> {
    const overrides: Partial<Record<AgentKind, string | undefined>> = {};
    for (const kind of AGENT_KINDS) {
      overrides[kind] = this.settings.agents[kind]?.command;
    }
    const detected = await detectAgents(overrides);
    // Catalogs take a few seconds to fetch; keep the last one until the new one arrives.
    this.agents = detected.map((info) => {
      const previous = this.agents.find((item) => item.kind === info.kind);
      return previous?.models
        ? { ...info, models: previous.models, modelsCheckedAt: previous.modelsCheckedAt, modelsError: previous.modelsError, ideModels: previous.ideModels }
        : info;
    });
    this.changed();
    void this.refreshModels(undefined, true);
    return this.agents;
  }

  /**
   * Ask each installed CLI (or just `kind`) for its model catalog; results land
   * on `agents[].models` and are persisted. Without `force`, a CLI asked less
   * than a minute ago is left alone, so clients may call this whenever a
   * catalog looks stale without turning a broken CLI into a busy loop.
   */
  async refreshModels(kind?: AgentKind, force = false): Promise<AgentInfo[]> {
    const kinds = kind ? [kind] : AGENT_KINDS;
    await Promise.all(kinds.map((item) => this.fetchModels(item, force)));
    return this.agents;
  }

  private fetchModels(kind: AgentKind, force: boolean): Promise<void> {
    const pending = this.modelFetches.get(kind);
    if (pending) {
      return pending;
    }
    const info = this.agents.find((item) => item.kind === kind);
    if (!info?.available || !canListModels(kind)) {
      return Promise.resolve();
    }
    const lastAttempt = this.modelAttempts.get(kind) ?? 0;
    if (!force && Date.now() - lastAttempt < MODEL_RETRY_MS) {
      return Promise.resolve();
    }
    this.modelAttempts.set(kind, Date.now());
    const job = (async () => {
      try {
        const models = await listAgentModels(kind, this.settings.agents[kind]?.command);
        const checkedAt = new Date().toISOString();
        const ideModels = kind === "cursor" ? readCursorIdeModels() ?? this.store.state.agentModels.cursor?.ideModels : undefined;
        this.patchAgent(kind, { models, modelsCheckedAt: checkedAt, modelsError: undefined, ideModels });
        this.store.state.agentModels[kind] = { models, checkedAt, ideModels };
        this.store.save();
      } catch (error) {
        // The previous list stays; the picker shows it together with why it could not be refreshed.
        const ideModels = kind === "cursor" ? readCursorIdeModels() : undefined;
        this.patchAgent(kind, { modelsError: error instanceof Error ? error.message : String(error), ...(ideModels ? { ideModels } : {}) });
      } finally {
        this.modelFetches.delete(kind);
        this.changed();
      }
    })();
    this.modelFetches.set(kind, job);
    return job;
  }

  private patchAgent(kind: AgentKind, patch: Partial<AgentInfo>): void {
    // The agent may have been re-detected meanwhile; apply to whatever entry is current.
    const current = this.agents.find((item) => item.kind === kind);
    if (current) {
      Object.assign(current, patch);
    }
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
    const files = this.resolveFiles(input.fileIds);
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
    if (files.length) {
      // The screenshots that came with the words: the title/details carry the text, this first message carries the files.
      task.notes.push({ ...this.note(from, "note", undefined), files });
    }
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

  /** One message: words, files, or both. */
  addNote(from: Actor, taskId: string, input: NoteInput): TaskNote {
    const task = this.requireTask(taskId);
    const text = String(input.text ?? "").replace(/\r\n/g, "\n").trim();
    const files = this.resolveFiles(input.fileIds);
    if (!text && !files.length) {
      fail("备注不能为空。", "EMPTY");
    }
    const note = this.note(from, "note", text || undefined);
    if (files.length) {
      note.files = files;
    }
    task.notes.push(note);
    task.updatedAt = note.createdAt;
    this.store.save();
    this.changed();
    return note;
  }

  /**
   * Make an uploaded file addressable. It is not shown anywhere until a task,
   * note or run refers to it by id, which the client does right after the
   * upload finishes.
   */
  registerFile(file: FileMeta, stored: StoredFile): FileMeta {
    this.store.state.files[file.id] = { ...stored, byteLength: file.byteLength };
    this.store.save();
    return file;
  }

  /** A file dropped straight onto a task (or onto nothing, which makes a task out of it). */
  attachFile(from: Actor, taskId: string | null, file: FileMeta, stored: StoredFile): { task: Task; note: TaskNote } {
    this.registerFile(file, stored);
    if (taskId) {
      const task = this.requireTask(taskId);
      return { task, note: this.addNote(from, taskId, { fileIds: [file.id] }) };
    }
    const task = this.createTask(from, { title: file.name, status: "inbox", fileIds: [file.id] });
    return { task, note: task.notes[0]! };
  }

  fileById(fileId: string): StoredFile | undefined {
    return this.store.state.files[fileId];
  }

  /** Ids from a client request back to the metadata the thread shows; unknown ids are a client bug, not silently dropped. */
  private resolveFiles(fileIds: readonly string[] | undefined): FileMeta[] {
    if (!fileIds?.length) {
      return [];
    }
    const unique = [...new Set(fileIds.map((id) => String(id)))];
    if (unique.length > MAX_FILES_PER_MESSAGE) {
      fail(`一条消息最多带 ${MAX_FILES_PER_MESSAGE} 个文件。`);
    }
    return unique.map((id) => {
      const stored = this.fileById(id);
      if (!stored) {
        fail("附件不存在或已过期，请重新添加。", "NOT_FOUND");
      }
      return { id, name: stored.name, mediaType: stored.mediaType, byteLength: stored.byteLength ?? 0 };
    });
  }

  /** Where the agent will find each file: on this PC, or on the device the run happens on. */
  private promptAttachments(files: readonly FileMeta[], deviceId: string | undefined): PromptAttachment[] {
    const device = deviceId ? this.remoteDevices.find((item) => item.id === deviceId) : undefined;
    const out: PromptAttachment[] = [];
    for (const file of files) {
      const stored = this.fileById(file.id);
      if (!stored) {
        continue;
      }
      out.push({
        name: file.name,
        mediaType: file.mediaType,
        path: device ? remoteAttachmentPath(device, file.id, file.name) : stored.path,
      });
    }
    return out;
  }

  // -------------------------------------------------------------- projects

  async addProject(input: { path: string; name?: string; defaultAgent?: AgentKind | null; deviceId?: string | null }): Promise<Project> {
    const rawPath = String(input.path ?? "").trim();
    const device = input.deviceId ? this.requireDevice(input.deviceId) : undefined;
    let path: string;
    if (device) {
      assertSafeRemotePath(rawPath);
      path = rawPath.replace(/[\\/]+$/, "") || rawPath;
      const online = await this.resolveDevice(device.id);
      if (!(await directoryExists(online, path))) {
        fail(`${device.name} 上没有这个目录，请填写那台电脑上真实存在的文件夹。`);
      }
    } else {
      path = resolvePath(rawPath);
      if (!rawPath || !existsSync(path) || !statSync(path).isDirectory()) {
        fail("目录不存在，请填写电脑上真实存在的文件夹。");
      }
    }
    const existing = this.projects.find((project) => (project.deviceId ?? "") === (device?.id ?? "") && samePath(project.path, path));
    if (existing) {
      return existing;
    }
    const project: Project = {
      id: newId(),
      name: String(input.name ?? "").trim() || remoteBasename(path) || path,
      path,
      deviceId: device?.id,
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

  // -------------------------------------------------------- remote devices

  async addDevice(input: RemoteDeviceInput): Promise<RemoteDevice> {
    const host = String(input.host ?? "").trim();
    if (!host || !/^[A-Za-z0-9._:%-]+$/.test(host)) {
      fail("请填写主机名、IP 地址，或 ~/.ssh/config 里的别名。");
    }
    const user = String(input.user ?? "").trim() || undefined;
    const port = normalizePort(input.port);
    const identityFile = String(input.identityFile ?? "").trim() || undefined;
    const existing = this.remoteDevices.find(
      (device) => device.host.toLowerCase() === host.toLowerCase() && (device.user ?? "") === (user ?? "") && (device.port ?? 22) === (port ?? 22),
    );
    if (existing) {
      void this.checkDevice(existing.id);
      return existing;
    }
    const device: RemoteDevice = {
      id: newId(),
      name: String(input.name ?? "").trim() || host,
      host,
      user,
      port,
      identityFile,
      platform: "unknown",
      status: "unknown",
      agents: [],
      createdAt: new Date().toISOString(),
    };
    this.remoteDevices.push(device);
    this.store.save();
    this.changed();
    return this.checkDevice(device.id);
  }

  updateDevice(id: string, patch: RemoteDevicePatch): RemoteDevice {
    const device = this.requireDevice(id);
    let reconnect = false;
    if (patch.name !== undefined) {
      device.name = String(patch.name).trim() || device.name;
    }
    if (patch.host !== undefined) {
      const host = String(patch.host).trim();
      if (!host || !/^[A-Za-z0-9._:%-]+$/.test(host)) {
        fail("主机地址不合法。");
      }
      reconnect = reconnect || host !== device.host;
      device.host = host;
    }
    if (patch.user !== undefined) {
      const user = String(patch.user ?? "").trim() || undefined;
      reconnect = reconnect || user !== device.user;
      device.user = user;
    }
    if (patch.port !== undefined) {
      const port = normalizePort(patch.port);
      reconnect = reconnect || port !== device.port;
      device.port = port;
    }
    if (patch.identityFile !== undefined) {
      const identityFile = String(patch.identityFile ?? "").trim() || undefined;
      reconnect = reconnect || identityFile !== device.identityFile;
      device.identityFile = identityFile;
    }
    this.store.save();
    this.changed();
    if (reconnect) {
      void this.checkDevice(device.id);
    }
    return device;
  }

  removeDevice(id: string): void {
    const index = this.remoteDevices.findIndex((device) => device.id === id);
    if (index === -1) {
      fail("设备不存在。", "NOT_FOUND");
    }
    if (this.runs.some((run) => run.deviceId === id && isRunActive(run))) {
      fail("这台电脑上还有正在运行的 Agent，先停止再移除。");
    }
    this.remoteDevices.splice(index, 1);
    // Its projects cannot be reached anymore; tasks keep everything else.
    const orphaned = new Set(this.projects.filter((project) => project.deviceId === id).map((project) => project.id));
    this.store.state.projects = this.projects.filter((project) => !orphaned.has(project.id));
    for (const task of this.tasks) {
      if (task.projectId && orphaned.has(task.projectId)) {
        task.projectId = undefined;
      }
    }
    this.store.save();
    this.changed();
  }

  /** Connect, identify the OS and list agent CLIs; the result is kept on the device record. */
  async checkDevice(id: string): Promise<RemoteDevice> {
    const device = this.requireDevice(id);
    const pending = this.deviceChecks.get(id);
    if (pending) {
      return pending;
    }
    device.status = "checking";
    device.error = undefined;
    this.changed();
    const check = (async () => {
      try {
        const probe = await probeDevice(device);
        device.platform = probe.platform;
        device.hostName = probe.hostName || undefined;
        device.home = probe.home || device.home;
        device.agents = probe.agents;
        device.status = "online";
        device.error = undefined;
        if (!device.user && probe.user) {
          device.user = probe.user;
        }
      } catch (error) {
        device.status = "offline";
        device.error = error instanceof Error ? error.message : String(error);
      } finally {
        device.lastCheckedAt = new Date().toISOString();
        this.deviceChecks.delete(id);
        this.store.save();
        this.changed();
      }
      return device;
    })();
    this.deviceChecks.set(id, check);
    return check;
  }

  /** A device ready to run on; checks it first when it has never been reached or last looked offline. */
  async resolveDevice(id: string): Promise<RemoteDevice> {
    const device = this.requireDevice(id);
    if (device.status === "online" && device.home) {
      return device;
    }
    const checked = await this.checkDevice(id);
    if (checked.status !== "online") {
      fail(checked.error ?? `连不上 ${checked.name}。`);
    }
    return checked;
  }

  async listRemoteDirectory(id: string, path: string): Promise<RemoteDirListing> {
    const device = await this.resolveDevice(id);
    return listDirectory(device, String(path ?? "").trim());
  }

  /** ssh config aliases and LAN hosts with sshd, flagged when already added. */
  async discoverDevices(): Promise<DeviceCandidate[]> {
    const candidates = await discoverDevices();
    return candidates.map((candidate) => {
      const match = this.remoteDevices.find((device) => {
        const target = device.host.toLowerCase();
        return target === candidate.host.toLowerCase() || (candidate.address && target === candidate.address.toLowerCase());
      });
      return match ? { ...candidate, deviceId: match.id } : candidate;
    });
  }

  private attachmentsFor(run: AgentRun): RunAttachment[] {
    const device = run.deviceId ? this.remoteDevices.find((item) => item.id === run.deviceId) : undefined;
    const task = this.tasks.find((item) => item.id === run.taskId);
    if (!device || !task) {
      return [];
    }
    const out: RunAttachment[] = [];
    const seen = new Set<string>();
    for (const file of [...task.notes.flatMap((note) => note.files ?? []), ...(run.attachments ?? [])]) {
      const stored = this.fileById(file.id);
      if (stored && !seen.has(file.id)) {
        seen.add(file.id);
        out.push({ local: stored.path, remote: remoteAttachmentPath(device, file.id, file.name) });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ runs

  defaultPrompt(taskId: string, projectId?: string, latestMessage?: string): string {
    const task = this.requireTask(taskId);
    const project = projectId ? this.projects.find((item) => item.id === projectId) : undefined;
    const parts = [task.title.trim(), (task.details ?? "").trim(), (latestMessage ?? "").trim()].filter(Boolean);
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    const files = task.notes.flatMap((note) => note.files ?? []);
    return buildTurnPrompt(unique.join("\n\n"), this.promptAttachments(files, project?.deviceId), Boolean(project?.deviceId));
  }

  dispatch(from: Actor, taskId: string, input: DispatchInput): AgentRun {
    const task = this.requireTask(taskId);
    const project = this.requireProject(String(input.projectId ?? ""));
    const agent = agentOrUndefined(input.agent);
    if (!agent) {
      fail("请选择一个 Agent。");
    }
    const device = this.deviceForAgent(project, agent);
    const agentSettings = this.settings.agents[agent];
    const access: AgentAccess = input.access === "full" || input.access === "safe" ? input.access : agentSettings?.access ?? "safe";
    if (String(input.model ?? "").trim() && !normalizeModelId(input.model)) {
      fail("模型名不合法。");
    }
    const message = String(input.prompt ?? "").replace(/\r\n/g, "\n").trim();
    const attachments = this.resolveFiles(input.fileIds);
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: newId(),
      taskId: task.id,
      projectId: project.id,
      agent,
      access,
      model: normalizeModelId(input.model) ?? agentSettings?.model,
      prompt: "",
      cwd: project.path,
      deviceId: device?.id,
      status: "queued",
      requestedBy: from,
      createdAt: now,
      eventCount: 0,
    };
    // The `nearbox` launcher only exists on this PC, so runs on other computers cannot delegate.
    if (input.delegate && !device && this.delegation) {
      run.delegate = true;
    }
    if (input.resumeRunId) {
      const previous = this.runs.find((item) => item.id === input.resumeRunId);
      if (!previous || previous.taskId !== task.id) {
        fail("找不到要继续的运行。", "NOT_FOUND");
      }
      if (previous.agent !== agent) {
        fail("继续对话必须使用同一个 Agent。");
      }
      // A follow-up may be queued while the previous turn is still running; the
      // session id is resolved along the chain when this run actually starts.
      if (!canContinueRun(this.runs, previous)) {
        fail("上一轮没有留下可继续的会话，请开始新会话。");
      }
      run.resumedFromRunId = previous.id;
      run.cwd = previous.cwd;
      // The session being continued lives wherever the previous turn ran.
      run.deviceId = previous.deviceId;
    }
    if (message || attachments.length) {
      // What the user typed (and attached) is this turn. The thread shows `message` with the
      // thumbnails; the agent gets the words plus where the files are.
      run.message = message;
      if (attachments.length) {
        run.attachments = attachments;
      }
      run.prompt = buildTurnPrompt(message, this.promptAttachments(attachments, run.deviceId), Boolean(run.deviceId));
    } else {
      run.prompt = this.defaultPrompt(task.id, project.id);
    }
    run.prompt = this.withDelegationNotes(run, run.prompt);
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

  /** A follow-up whose conversation turned out not to exist: send the user's words as a new conversation. */
  private promptWithoutSession(run: AgentRun): string {
    const turn = buildTurnPrompt(run.message ?? "", this.promptAttachments(run.attachments ?? [], run.deviceId), Boolean(run.deviceId));
    return this.withDelegationNotes(run, turn || run.prompt);
  }

  /** The prompt plus, for runs that may delegate, the section explaining the `nearbox` command. */
  private withDelegationNotes(run: AgentRun, prompt: string): string {
    if (!run.delegate) {
      return prompt;
    }
    const targets = this.agents.filter((info) => info.available).map((info) => ({ kind: info.kind, label: info.label }));
    const section = delegationSection(targets, DELEGATE_WAIT_SECONDS);
    return section.length ? `${prompt.trimEnd()}\n\n${section.join("\n")}`.trimEnd() : prompt;
  }

  /** The device `project` lives on (undefined for this PC), after checking `agent` is usable there. */
  private deviceForAgent(project: Project, agent: AgentKind): RemoteDevice | undefined {
    const device = project.deviceId ? this.remoteDevices.find((item) => item.id === project.deviceId) : undefined;
    if (project.deviceId && !device) {
      fail("这个项目所在的电脑已经被移除了。");
    }
    const info = agentsForProject({ agents: this.agents, remoteDevices: this.remoteDevices }, project).find((item) => item.kind === agent);
    // A device that has never been checked gets the benefit of the doubt; the run itself will check it.
    if (!info?.available && !(device && device.status !== "online" && device.agents.length === 0)) {
      fail(device ? `${device.name} 上没有检测到 ${AGENT_LABELS[agent]}，无法派发。` : `${AGENT_LABELS[agent]} 还没有在这台电脑上安装，无法派发。`);
    }
    return device;
  }

  // ------------------------------------------------------------ delegation

  /**
   * A running agent hands a sub-task to another agent (`nearbox ask`). The
   * child joins the parent's task and thread but not the task's own
   * conversation, and never gets more access than the parent has.
   */
  delegate(parentRunId: string, input: DelegateInput): AgentRun {
    const parent = this.runs.find((item) => item.id === parentRunId);
    if (!parent || parent.status !== "running" || !parent.delegate) {
      fail("只有正在运行、并开启了委派的 Agent 才能委派子任务。", "NOT_FOUND");
    }
    const task = this.requireTask(parent.taskId);
    const agent = agentOrUndefined(input.agent);
    if (!agent) {
      fail("请指定交给哪个 Agent：cursor、codex、grok、claude 或 opencode。");
    }
    const wanted = String(input.project ?? "").trim();
    const project = wanted ? this.findProject(wanted) : this.projects.find((item) => item.id === parent.projectId);
    if (!project) {
      fail(wanted ? `没有叫「${wanted}」的项目。用 Nearbox 里登记过的项目名或它的目录路径。` : "找不到当前运行所在的项目。", "NOT_FOUND");
    }
    const device = this.deviceForAgent(project, agent);
    const message = String(input.prompt ?? "").replace(/\r\n/g, "\n").trim();
    if (!message) {
      fail("任务说明不能为空。", "EMPTY");
    }
    if (String(input.model ?? "").trim() && !normalizeModelId(input.model)) {
      fail("模型名不合法。");
    }
    const agentSettings = this.settings.agents[agent];
    // The sub-task works at the parent's level unless the parent narrows it; it can never widen it.
    const requested: AgentAccess = input.access === "full" || input.access === "safe" ? input.access : parent.access;
    const from: Actor = { id: `agent:${parent.id}`, name: AGENT_LABELS[parent.agent], role: "desktop" };
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: newId(),
      taskId: task.id,
      projectId: project.id,
      agent,
      access: parent.access === "full" ? requested : "safe",
      model: normalizeModelId(input.model) ?? agentSettings?.model,
      prompt: "",
      message,
      cwd: project.path,
      deviceId: device?.id,
      status: "queued",
      requestedBy: from,
      createdAt: now,
      eventCount: 0,
      parentRunId: parent.id,
    };
    if (input.continue) {
      // "Same conversation" for a parent means the newest sub-run it gave this agent in this project.
      const previous = [...this.runs].reverse().find((item) => item.parentRunId === parent.id && item.agent === agent && item.projectId === project.id);
      if (previous && canContinueRun(this.runs, previous)) {
        run.resumedFromRunId = previous.id;
        run.cwd = previous.cwd;
        run.deviceId = previous.deviceId;
      }
    }
    run.prompt = buildDelegatedPrompt(message, AGENT_LABELS[parent.agent], project, Boolean(run.resumedFromRunId));
    this.runs.push(run);
    task.notes.push({ ...this.note(from, "run", undefined), runId: run.id });
    task.updatedAt = now;
    project.lastUsedAt = now;
    this.store.save();
    this.changed();
    this.runner.pump();
    return run;
  }

  /** Runs started by `parentRunId` through `nearbox ask`, oldest first. */
  childRuns(parentRunId: string): AgentRun[] {
    return this.runs.filter((run) => run.parentRunId === parentRunId);
  }

  /**
   * A run by id. With `scopeRunId` (a `nearbox` token) only that run and its
   * sub-runs are visible, and a unique id prefix of at least 6 characters is
   * accepted, since that is what the command shows the agent.
   */
  findRun(idOrPrefix: string, scopeRunId?: string): AgentRun | undefined {
    const wanted = idOrPrefix.trim();
    if (!wanted) {
      return undefined;
    }
    if (scopeRunId === undefined) {
      return this.runs.find((run) => run.id === wanted);
    }
    const visible = this.runs.filter((run) => run.id === scopeRunId || run.parentRunId === scopeRunId);
    const exact = visible.find((run) => run.id === wanted);
    if (exact || wanted.length < 6) {
      return exact;
    }
    const matches = visible.filter((run) => run.id.startsWith(wanted));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Resolves when `run` has finished or `timeoutMs` has passed, whichever comes first. */
  waitForRun(run: AgentRun, timeoutMs: number): Promise<AgentRun> {
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, timeoutMs));
    if (!isRunActive(run) || wait === 0) {
      return Promise.resolve(run);
    }
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        this.off("run-finished", done);
        resolve(run);
      };
      const done = (finished: AgentRun) => {
        if (finished.id === run.id) {
          settle();
        }
      };
      const timer = setTimeout(settle, wait);
      this.on("run-finished", done);
    });
  }

  private findProject(text: string): Project | undefined {
    const lower = text.toLowerCase();
    return (
      this.projects.find((project) => project.id === text) ??
      this.projects.find((project) => samePath(project.path, text)) ??
      this.projects.find((project) => project.name.toLowerCase() === lower)
    );
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

  resolvePermission(runId: string, optionId: string): void {
    if (!this.runner.resolvePermission(runId, optionId)) {
      fail("现在没有需要确认的命令。");
    }
  }

  runEvents(runId: string, afterSeq: number): Promise<RunEvent[]> {
    return this.runner.events(runId, afterSeq);
  }

  /**
   * The composer is pointed at an agent: get its process up now, and if the
   * message would continue a conversation, have that session loaded, so the
   * reply starts the moment the user hits send. Remote projects run over ssh
   * and have nothing to warm.
   */
  warmAgent(input: { agent?: unknown; projectId?: unknown; resumeRunId?: unknown }): void {
    const agent = agentOrUndefined(input.agent);
    if (!agent) {
      return;
    }
    const project = this.projects.find((item) => item.id === String(input.projectId ?? ""));
    if (project?.deviceId) {
      return;
    }
    const resumeRunId = typeof input.resumeRunId === "string" ? input.resumeRunId : undefined;
    const previous = resumeRunId ? this.runs.find((run) => run.id === resumeRunId) : undefined;
    const sessionId = previous && !previous.deviceId ? sessionIdAlongChain(this.runs, previous.id) : undefined;
    this.runner.warm(agent, previous?.cwd ?? project?.path, sessionId);
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
    if (patch.remoteControlEnabled !== undefined) {
      settings.remoteControlEnabled = Boolean(patch.remoteControlEnabled);
    }
    if (patch.agents) {
      for (const kind of AGENT_KINDS) {
        const next = patch.agents[kind];
        if (!next) {
          continue;
        }
        settings.agents[kind] = {
          access: next.access === "full" ? "full" : "safe",
          model: normalizeModelId(next.model),
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

  /** Replace a long first-line dump with the name the agent gave the conversation. */
  private applySessionTitle(taskId: string, incoming: string): void {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    const next = adoptSessionTitle(task.title, incoming);
    if (!next) {
      return;
    }
    task.title = next;
    task.updatedAt = new Date().toISOString();
    this.store.save();
    this.changed();
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

  private requireDevice(id: string): RemoteDevice {
    const device = this.remoteDevices.find((item) => item.id === id);
    if (!device) {
      fail("设备不存在。", "NOT_FOUND");
    }
    return device;
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
  const normalize = (value: string) => value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return normalize(a) === normalize(b);
}

/** Last segment of a path in either separator style; remote paths must not go through node:path. */
function remoteBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function normalizePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("端口不合法。");
  }
  return port === 22 ? undefined : port;
}
