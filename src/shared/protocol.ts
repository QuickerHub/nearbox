export { PROTOCOL_VERSION } from "./version";
export const DEFAULT_PORT = 17831;

export type ClientRole = "desktop" | "phone";

export interface DeviceInfo {
  id: string;
  name: string;
  role: ClientRole;
  online: boolean;
  lastSeenAt?: string;
}

export type Actor = Pick<DeviceInfo, "id" | "name" | "role">;

export interface FileMeta {
  id: string;
  name: string;
  mediaType: string;
  byteLength: number;
}

export interface ShareLimits {
  maxTextChars: number;
  maxImageBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: ShareLimits = {
  maxTextChars: 20_000,
  maxImageBytes: 32 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
};

export interface InviteInfo {
  url: string;
  token: string;
  pin: string;
  expiresAt: string;
  host: string;
  port: number;
  qrDataUrl?: string;
  apkUrl?: string;
  apkQrDataUrl?: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus = "inbox" | "todo" | "doing" | "done";
export const TASK_STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "done"];

export type TaskPriority = "normal" | "high";

export type NoteKind = "note" | "status" | "run";

/**
 * One message in a task's thread. A note carries text, files, or both: what
 * the user sent together stays together, so the thread shows a screenshot and
 * the sentence about it as one bubble.
 */
export interface TaskNote {
  id: string;
  kind: NoteKind;
  from: Actor;
  text?: string;
  /** Images and other files sent with this message, in the order they were attached. */
  files?: FileMeta[];
  runId?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  details: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId?: string;
  agent?: AgentKind;
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  notes: TaskNote[];
  latestRunId?: string;
}

export interface TaskInput {
  title: string;
  details?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string | null;
  agent?: AgentKind | null;
  /** Files uploaded beforehand (`POST /api/files`) that become the task's first message. */
  fileIds?: string[];
}

export type TaskPatch = Partial<Omit<TaskInput, "fileIds">>;

export interface NoteInput {
  text?: string;
  /** Files uploaded beforehand (`POST /api/files`) to send with this message. */
  fileIds?: string[];
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  /** Absolute path on the device the project lives on (this PC when `deviceId` is unset). */
  path: string;
  /** Remote computer the directory is on; undefined means this PC. */
  deviceId?: string;
  defaultAgent?: AgentKind;
  createdAt: string;
  lastUsedAt?: string;
}

// ---------------------------------------------------------------------------
// Remote devices (other computers reached over SSH)
// ---------------------------------------------------------------------------

export type DevicePlatform = "windows" | "linux" | "macos" | "unknown";

export type RemoteDeviceStatus = "unknown" | "checking" | "online" | "offline";

/**
 * Another computer on the LAN that agents can run on. Nearbox reaches it with
 * the local `ssh` client, so whatever works for `ssh <host>` in a terminal
 * (config aliases, keys, agents) works here too.
 */
export interface RemoteDevice {
  id: string;
  /** What the user sees; defaults to the ssh alias or the hostname the device reports. */
  name: string;
  /** ssh destination: an alias from ~/.ssh/config, a hostname or an IP. */
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  platform: DevicePlatform;
  /** Hostname the device reported about itself. */
  hostName?: string;
  /** Home directory on the device; prompt files and pid files go under <home>/.nearbox. */
  home?: string;
  status: RemoteDeviceStatus;
  /** Why the last check failed (ssh stderr, first line). */
  error?: string;
  lastCheckedAt?: string;
  /** Agent CLIs found on the device during the last check. */
  agents: AgentInfo[];
  createdAt: string;
}

export interface RemoteDeviceInput {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  name?: string;
}

export type RemoteDevicePatch = Partial<RemoteDeviceInput>;

/** Something on the network that looks like it could be added as a device. */
export interface DeviceCandidate {
  /** What to put in the `host` field. */
  host: string;
  /** Resolved address when `host` is an alias. */
  address?: string;
  user?: string;
  port?: number;
  /** Hostname learned from DNS or the ssh config comment. */
  label?: string;
  /** Guess from the SSH banner ("OpenSSH_for_Windows"). */
  platform?: DevicePlatform;
  source: "ssh-config" | "lan-scan";
  /** Port 22 answered during discovery. */
  reachable?: boolean;
  /** Already added as a device. */
  deviceId?: string;
}

export interface RemoteDirListing {
  path: string;
  parent?: string;
  entries: { name: string; path: string }[];
  /** Windows drive roots, only when listing the top level. */
  roots?: string[];
  /** The user's home directory, offered as a shortcut at the top level. */
  home?: string;
}

export const PLATFORM_LABELS: Record<DevicePlatform, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  unknown: "未知系统",
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentKind = "cursor" | "codex" | "grok" | "claude" | "opencode";
export const AGENT_KINDS: AgentKind[] = ["cursor", "codex", "grok", "claude", "opencode"];

export const AGENT_LABELS: Record<AgentKind, string> = {
  cursor: "Cursor Agent",
  codex: "Codex",
  grok: "Grok Build",
  claude: "Claude Code",
  opencode: "opencode",
};

/** safe: agent may edit the workspace but asks/denies dangerous commands. full: run everything. */
export type AgentAccess = "safe" | "full";

/** One model a CLI can be pointed at with its `--model` flag. */
export interface AgentModel {
  /** What goes on the command line, e.g. "gpt-5.5-high", "sonnet", "opencode/claude-sonnet-5". */
  id: string;
  /** Human name the CLI reported; the id itself when it has none. */
  label?: string;
  /** The CLI picks this one when no model is given. */
  isDefault?: boolean;
}

export interface AgentInfo {
  kind: AgentKind;
  label: string;
  available: boolean;
  command?: string;
  detail?: string;
  supportsResume: boolean;
  /**
   * Models the CLI said this account can use. Missing until the list has been
   * fetched (or when the CLI has no way to list them); the UI then falls back
   * to the built-in list and free text. Kept across restarts, so this may be
   * the list from a previous session until the next fetch replaces it.
   */
  models?: AgentModel[];
  /** When `models` was last fetched successfully. */
  modelsCheckedAt?: string;
  /** Why the most recent fetch failed (not logged in, offline, timeout…); `models` then holds the previous list. */
  modelsError?: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  taskId: string;
  projectId: string;
  agent: AgentKind;
  access: AgentAccess;
  /** Model requested on the command line, if any. */
  model?: string;
  /** Model the CLI reported it actually used. */
  modelLabel?: string;
  /** Exactly what the agent was given. For a follow-up this is `message` plus a section listing `attachments`. */
  prompt: string;
  /** The user's own words for this turn, when the turn was typed in the composer rather than generated from the task. */
  message?: string;
  /** Files sent with this turn; the prompt names their paths and CLIs that take images natively get them directly. */
  attachments?: FileMeta[];
  cwd: string;
  /** Remote computer the agent ran on; undefined means this PC. */
  deviceId?: string;
  status: RunStatus;
  requestedBy: Actor;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  sessionId?: string;
  /**
   * The turn this one continues. Runs chained through this field form one
   * agent conversation; the session id to resume is looked up along the chain
   * when the run actually starts, so follow-ups can be queued while the
   * previous turn is still working.
   */
  resumedFromRunId?: string;
  /**
   * The agent may hand sub-tasks to other agents on this PC: it gets a
   * `nearbox` command on its PATH and a section in its prompt explaining it.
   */
  delegate?: boolean;
  /**
   * Set on a run another agent started with `nearbox ask`. Such a run belongs
   * to its parent's task and thread but is not part of the task's own
   * conversation; while it is active the parent is treated as idle.
   */
  parentRunId?: string;
  summary?: string;
  error?: string;
  eventCount: number;
}

export type RunEventKind = "status" | "thinking" | "text" | "tool" | "stderr" | "raw" | "result";

/** What kind of thing a tool call is, normalized across CLIs so the UI can pick an icon and a verb. */
export type ToolKind = "shell" | "read" | "edit" | "write" | "delete" | "glob" | "grep" | "ls" | "web" | "task" | "todo" | "mcp" | "other";

export type ToolStatus = "running" | "ok" | "error" | "rejected";

/**
 * One tool invocation by the agent. The parser emits it once when the call
 * starts and again (same id, more fields) when it finishes; the UI keeps the
 * latest state per id.
 */
export interface ToolCall {
  id: string;
  /** Name as the CLI reported it, e.g. "shellToolCall", "Bash", "command_execution". */
  name: string;
  kind: ToolKind;
  status: ToolStatus;
  /** One-line subject: a path, a search pattern, a URL, a subtask title. */
  subject?: string;
  /** Shell: the command line. */
  command?: string;
  /** Shell: working directory, glob/grep: search root. */
  cwd?: string;
  /** Short description the agent attached to the call, when the CLI provides one. */
  description?: string;
  exitCode?: number;
  /** Shell output, file content, search hits, subtask answer… bounded in length. */
  output?: string;
  /** Edits: unified diff when the CLI provides one. */
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
  /** Files touched or found. */
  files?: string[];
  /** Pretty-printed arguments, only kept when nothing more specific was extracted. */
  input?: string;
  /** Why the call failed or was rejected. */
  error?: string;
}

export interface RunEvent {
  seq: number;
  at: string;
  kind: RunEventKind;
  /** Plain-text rendering of the event; for tools this is a short one-liner fallback. */
  text: string;
  /** Present when kind === "tool". */
  tool?: ToolCall;
  /**
   * A streamed fragment: `text` continues the previous event of the same kind
   * verbatim (no separator, no trimming), so the UI can show the answer as it
   * is being written.
   */
  delta?: boolean;
}

export interface DispatchInput {
  agent: AgentKind;
  projectId: string;
  prompt?: string;
  /** Files uploaded beforehand (`POST /api/files`) to send with `prompt`. */
  fileIds?: string[];
  access?: AgentAccess;
  model?: string;
  /** Continue the conversation of this earlier run (same task, same agent). */
  resumeRunId?: string;
  /** Let this run hand sub-tasks to other agents (local runs only). */
  delegate?: boolean;
}

/** What a running agent sends through `nearbox ask` to start a sub-task. */
export interface DelegateInput {
  agent: AgentKind;
  prompt: string;
  /** Project id, name or path to work in; the parent's project when omitted. */
  project?: string;
  model?: string;
  /** Defaults to the parent's own access level and can never exceed it. */
  access?: AgentAccess;
  /** Continue the parent's latest conversation with `agent` instead of starting a new one. */
  continue?: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AgentSettings {
  access: AgentAccess;
  model?: string;
  command?: string;
}

export interface HostSettings {
  maxConcurrentRuns: number;
  closeToTray: boolean;
  launchAtLogin: boolean;
  notifyOnRunFinish: boolean;
  /** Let a paired phone see this screen and drive the mouse/keyboard. */
  remoteControlEnabled: boolean;
  /** LAN address the user picked for pairing; used on the next start if still present. */
  preferredHost?: string;
  agents: Partial<Record<AgentKind, AgentSettings>>;
}

export const DEFAULT_SETTINGS: HostSettings = {
  maxConcurrentRuns: 1,
  closeToTray: true,
  launchAtLogin: false,
  notifyOnRunFinish: true,
  remoteControlEnabled: true,
  agents: {},
};

// ---------------------------------------------------------------------------
// Remote control (screen mirroring + input injection)
// ---------------------------------------------------------------------------

export interface RemoteDisplay {
  /** Logical size of the primary display, used only as an aspect-ratio hint. */
  width: number;
  height: number;
}

export interface RemoteStatus {
  /** This host's OS can actually inject mouse/keyboard input. */
  supported: boolean;
  /** The user has left remote control turned on. */
  enabled: boolean;
  /** How many clients are watching/controlling right now. */
  controllers: number;
  display: RemoteDisplay | null;
}

export type RemoteButton = "left" | "right" | "middle";

export interface RemoteQuality {
  /** JPEG quality, 20-95. */
  quality: number;
  /** Target frames per second, 1-30. */
  fps: number;
  /** Longest edge of the streamed frame in pixels. */
  maxWidth: number;
}

export const DEFAULT_REMOTE_QUALITY: RemoteQuality = { quality: 55, fps: 12, maxWidth: 1440 };

/**
 * Control-channel messages a viewer sends up to the host. Screen frames come
 * back the other way as raw binary WebSocket messages (JPEG), never as JSON.
 * Pointer coordinates are normalized to [0,1] over the streamed frame.
 */
export type RemoteControlToHost =
  | { t: "move"; x: number; y: number }
  | { t: "down"; button: RemoteButton; x?: number; y?: number }
  | { t: "up"; button: RemoteButton; x?: number; y?: number }
  | { t: "click"; button: RemoteButton; x?: number; y?: number; double?: boolean }
  | { t: "scroll"; x?: number; y?: number; dx?: number; dy?: number }
  | { t: "key"; code: string; down: boolean }
  | { t: "combo"; codes: string[] }
  | { t: "text"; value: string }
  | { t: "config"; quality?: number; fps?: number; maxWidth?: number }
  | { t: "ping"; ts?: number };

export type RemoteControlToClient =
  | {
      t: "hello";
      display: RemoteDisplay;
      supportsInput: boolean;
      quality: RemoteQuality;
      controllerName: string;
    }
  | { t: "config"; quality: RemoteQuality }
  | { t: "peers"; controllers: number }
  | { t: "pong"; ts?: number }
  | { t: "error"; message: string };

// ---------------------------------------------------------------------------
// Snapshot & realtime events
// ---------------------------------------------------------------------------

export interface HostSnapshot {
  running: boolean;
  hostName: string;
  hostAddresses: string[];
  selectedHost: string;
  port: number;
  invite: InviteInfo | null;
  devices: DeviceInfo[];
  remoteDevices: RemoteDevice[];
  tasks: Task[];
  projects: Project[];
  runs: AgentRun[];
  agents: AgentInfo[];
  settings: HostSettings;
  limits: ShareLimits;
  remote: RemoteStatus;
  inboxDir: string;
  dataDir: string;
  appVersion: string;
  protocolVersion: number;
  apkAvailable: boolean;
  listenError?: string;
}

export type ClientToHost =
  | { type: "capture"; id: string; text: string }
  | { type: "subscribe-run"; runId: string }
  | { type: "unsubscribe-run"; runId: string };

export type HostToClient =
  | { type: "ready"; self: DeviceInfo; snapshot: HostSnapshot }
  | { type: "snapshot"; snapshot: HostSnapshot }
  | { type: "run-event"; runId: string; event: RunEvent }
  | { type: "error"; code: string; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export const FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".msi",
  ".msp",
  ".scr",
  ".js",
  ".jse",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".hta",
  ".lnk",
  ".reg",
  ".url",
  ".apk",
];

export function isImageMediaType(mediaType: string | undefined): boolean {
  const value = (mediaType ?? "").split(";")[0]?.trim().toLowerCase();
  return IMAGE_TYPES.includes(value as (typeof IMAGE_TYPES)[number]);
}

export function isImageFile(file: Pick<FileMeta, "mediaType">): boolean {
  return isImageMediaType(file.mediaType);
}

/** How many files one message may carry. */
export const MAX_FILES_PER_MESSAGE = 8;

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** First line becomes the title; the rest becomes details. */
export function splitCapture(text: string): { title: string; details: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const newline = normalized.indexOf("\n");
  if (newline === -1) {
    return { title: clampTitle(normalized), details: normalized.length > 120 ? normalized : "" };
  }
  const title = normalized.slice(0, newline).trim();
  const rest = normalized.slice(newline + 1).trim();
  if (!title) {
    return { title: clampTitle(rest), details: rest };
  }
  return { title: clampTitle(title), details: rest };
}

function clampTitle(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 120 ? `${single.slice(0, 117)}…` : single;
}

export function isRunActive(run: Pick<AgentRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

export { canContinueRun, sessionIdAlongChain } from "./conversation";
export { BUILTIN_MODELS, canListModels, filterModels, modelLabel, modelsForAgent, modelsNeedRefresh, normalizeModelId } from "./models";

/**
 * Agents that can run in `project`: the ones installed on the device the
 * project lives on. A remote device that has never been checked (or is
 * offline) contributes whatever it reported last time, so the user can still
 * queue work for it.
 */
export function agentsForProject(
  snapshot: Pick<HostSnapshot, "agents" | "remoteDevices">,
  project: Pick<Project, "deviceId"> | undefined,
): AgentInfo[] {
  if (!project?.deviceId) {
    return snapshot.agents;
  }
  const device = snapshot.remoteDevices.find((item) => item.id === project.deviceId);
  if (!device) {
    return [];
  }
  return AGENT_KINDS.map(
    (kind) =>
      device.agents.find((item) => item.kind === kind) ?? {
        kind,
        label: AGENT_LABELS[kind],
        available: false,
        detail: device.status === "online" ? `${device.name} 上没有找到` : "设备尚未检测",
        supportsResume: true,
      },
  );
}

/** "laptop-2 / nearbox" for a remote project, just the name for a local one. */
export function projectDisplayName(
  project: Pick<Project, "name" | "deviceId">,
  remoteDevices: readonly Pick<RemoteDevice, "id" | "name">[],
): string {
  if (!project.deviceId) {
    return project.name;
  }
  const device = remoteDevices.find((item) => item.id === project.deviceId);
  return `${device?.name ?? "远程电脑"} / ${project.name}`;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "收集箱",
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
