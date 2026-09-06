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

export interface TaskNote {
  id: string;
  kind: NoteKind;
  from: Actor;
  text?: string;
  file?: FileMeta;
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
}

export type TaskPatch = Partial<TaskInput>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultAgent?: AgentKind;
  createdAt: string;
  lastUsedAt?: string;
}

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

export interface AgentInfo {
  kind: AgentKind;
  label: string;
  available: boolean;
  command?: string;
  detail?: string;
  supportsResume: boolean;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  taskId: string;
  projectId: string;
  agent: AgentKind;
  access: AgentAccess;
  model?: string;
  prompt: string;
  cwd: string;
  status: RunStatus;
  requestedBy: Actor;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  sessionId?: string;
  resumedFromRunId?: string;
  summary?: string;
  error?: string;
  eventCount: number;
}

export type RunEventKind = "status" | "thinking" | "text" | "tool" | "stderr" | "raw" | "result";

export interface RunEvent {
  seq: number;
  at: string;
  kind: RunEventKind;
  text: string;
}

export interface DispatchInput {
  agent: AgentKind;
  projectId: string;
  prompt?: string;
  access?: AgentAccess;
  model?: string;
  resumeRunId?: string;
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
  /** LAN address the user picked for pairing; used on the next start if still present. */
  preferredHost?: string;
  agents: Partial<Record<AgentKind, AgentSettings>>;
}

export const DEFAULT_SETTINGS: HostSettings = {
  maxConcurrentRuns: 1,
  closeToTray: true,
  launchAtLogin: false,
  notifyOnRunFinish: true,
  agents: {},
};

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
  tasks: Task[];
  projects: Project[];
  runs: AgentRun[];
  agents: AgentInfo[];
  settings: HostSettings;
  limits: ShareLimits;
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
