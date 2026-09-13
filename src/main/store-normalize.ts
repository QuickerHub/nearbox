/**
 * Load-time cleanup for state.json rows. Kept free of `@shared` path aliases so
 * node --test can import it; one bad array element must not wipe the whole file.
 */
import type {
  AgentKind,
  AgentModel,
  AgentRun,
  DeviceInfo,
  FileMeta,
  HostSettings,
  IdeModelPref,
  Project,
  RemoteDevice,
  Task,
  TaskNote,
} from "../shared/protocol.ts";
import { stripEmptyParentRunId, stripTransientPermissionState } from "./run-normalize.ts";

export interface PairedSession {
  token: string;
  device: DeviceInfo;
}

export interface StoredFile {
  path: string;
  name: string;
  mediaType: string;
  byteLength?: number;
}

export interface ModelCatalog {
  models: AgentModel[];
  checkedAt: string;
  ideModels?: IdeModelPref[];
}

export interface PersistedState {
  version: 1;
  tasks: Task[];
  projects: Project[];
  runs: AgentRun[];
  sessions: PairedSession[];
  remoteDevices: RemoteDevice[];
  files: Record<string, StoredFile>;
  settings: HostSettings;
  agentModels: Partial<Record<AgentKind, ModelCatalog>>;
}

const AGENT_KINDS: AgentKind[] = ["cursor", "codex", "grok", "claude", "opencode"];

const DEFAULT_SETTINGS: HostSettings = {
  maxConcurrentRuns: 1,
  closeToTray: true,
  launchAtLogin: false,
  notifyOnRunFinish: true,
  remoteControlEnabled: true,
  agents: {},
};

export function emptyState(): PersistedState {
  return {
    version: 1,
    tasks: [],
    projects: [],
    runs: [],
    sessions: [],
    remoteDevices: [],
    files: {},
    settings: { ...DEFAULT_SETTINGS, agents: {} },
    agentModels: {},
  };
}

/** Map and drop nulls so one bad row cannot throw the whole load into emptyState. */
export function mapKeep<T, U>(items: T[], map: (item: T) => U | null): U[] {
  const out: U[] = [];
  for (const item of items) {
    try {
      const next = map(item);
      if (next) {
        out.push(next);
      }
    } catch {
      /* skip malformed row */
    }
  }
  return out;
}

export function parsePersistedState(raw: Partial<PersistedState>): PersistedState {
  const base = emptyState();
  return {
    version: 1,
    tasks: Array.isArray(raw.tasks) ? mapKeep(raw.tasks, normalizeTask) : base.tasks,
    projects: Array.isArray(raw.projects) ? mapKeep(raw.projects, normalizeProject) : base.projects,
    runs: Array.isArray(raw.runs) ? mapKeep(raw.runs, normalizeRun) : base.runs,
    sessions: Array.isArray(raw.sessions) ? mapKeep(raw.sessions, normalizeSession) : base.sessions,
    remoteDevices: Array.isArray(raw.remoteDevices) ? mapKeep(raw.remoteDevices, normalizeDevice) : base.remoteDevices,
    files: raw.files && typeof raw.files === "object" && !Array.isArray(raw.files) ? raw.files : base.files,
    settings: {
      ...base.settings,
      ...(raw.settings ?? {}),
      agents: { ...(raw.settings?.agents ?? {}) },
    },
    agentModels: normalizeCatalogs(raw.agentModels),
  };
}

export function normalizeTask(task: Task): Task | null {
  if (!task || typeof task !== "object" || typeof task.id !== "string" || !task.id) {
    return null;
  }
  return {
    ...task,
    details: task.details ?? "",
    priority: task.priority ?? "normal",
    notes: Array.isArray(task.notes)
      ? task.notes.filter((note): note is TaskNote & { file?: FileMeta } => Boolean(note) && typeof note === "object").map(normalizeNote)
      : [],
  };
}

export function normalizeProject(project: Project): Project | null {
  if (!project || typeof project !== "object") {
    return null;
  }
  if (typeof project.id !== "string" || !project.id || typeof project.path !== "string" || !project.path) {
    return null;
  }
  const name = typeof project.name === "string" && project.name.trim() ? project.name.trim() : project.id;
  return { ...project, name };
}

export function normalizeSession(session: PairedSession): PairedSession | null {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (typeof session.token !== "string" || !session.token) {
    return null;
  }
  const device = session.device;
  if (!device || typeof device !== "object" || typeof device.id !== "string" || !device.id) {
    return null;
  }
  return {
    token: session.token,
    device: {
      id: device.id,
      name: typeof device.name === "string" && device.name.trim() ? device.name.trim() : device.id,
      role: device.role === "desktop" ? "desktop" : "phone",
      online: false,
      ...(typeof device.lastSeenAt === "string" ? { lastSeenAt: device.lastSeenAt } : {}),
    },
  };
}

function normalizeNote(note: TaskNote & { file?: FileMeta }): TaskNote {
  const { file, ...rest } = note;
  if (!file) {
    return rest;
  }
  return { ...rest, files: Array.isArray(rest.files) && rest.files.length ? rest.files : [file] };
}

function normalizeIdeModels(value: unknown): IdeModelPref[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: IdeModelPref[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) {
      continue;
    }
    const pref: IdeModelPref = { id: record.id, visible: record.visible === true };
    if (typeof record.label === "string" && record.label.trim()) {
      pref.label = record.label.trim();
    }
    out.push(pref);
  }
  return out.length ? out : undefined;
}

export function normalizeCatalogs(value: unknown): Partial<Record<AgentKind, ModelCatalog>> {
  const out: Partial<Record<AgentKind, ModelCatalog>> = {};
  if (!value || typeof value !== "object") {
    return out;
  }
  for (const kind of AGENT_KINDS) {
    const entry = (value as Record<string, unknown>)[kind];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { models, checkedAt, ideModels } = entry as { models?: unknown; checkedAt?: unknown; ideModels?: unknown };
    if (!Array.isArray(models) || typeof checkedAt !== "string") {
      continue;
    }
    const clean = models.filter(
      (model): model is AgentModel => Boolean(model) && typeof (model as AgentModel).id === "string" && (model as AgentModel).id.length > 0,
    );
    if (clean.length) {
      const catalog: ModelCatalog = { models: clean, checkedAt };
      const prefs = normalizeIdeModels(ideModels);
      if (prefs) {
        catalog.ideModels = prefs;
      }
      out[kind] = catalog;
    }
  }
  return out;
}

export function normalizeDevice(device: RemoteDevice): RemoteDevice | null {
  if (!device || typeof device !== "object") {
    return null;
  }
  if (typeof device.id !== "string" || !device.id || typeof device.host !== "string" || !device.host.trim()) {
    return null;
  }
  return {
    ...device,
    host: device.host.trim(),
    name: typeof device.name === "string" && device.name.trim() ? device.name.trim() : device.host.trim(),
    platform: device.platform ?? "unknown",
    status: "unknown",
    error: undefined,
    agents: Array.isArray(device.agents) ? device.agents : [],
  };
}

export function normalizeRun(run: AgentRun): AgentRun | null {
  if (!run || typeof run !== "object" || typeof run.id !== "string" || !run.id) {
    return null;
  }
  const rest = stripEmptyParentRunId(stripTransientPermissionState(run));
  if (rest.status === "running" || rest.status === "queued") {
    return {
      ...rest,
      status: "failed",
      error: rest.error ?? "电脑端在运行期间退出了。",
      finishedAt: rest.finishedAt ?? new Date().toISOString(),
    };
  }
  return { ...rest, eventCount: rest.eventCount ?? 0 };
}
