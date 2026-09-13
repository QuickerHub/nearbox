import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AGENT_KINDS,
  type AgentKind,
  type AgentModel,
  type AgentRun,
  DEFAULT_SETTINGS,
  type DeviceInfo,
  type FileMeta,
  type HostSettings,
  type IdeModelPref,
  type Project,
  type RemoteDevice,
  type Task,
  type TaskNote,
} from "@shared/protocol";
import { stripEmptyParentRunId, stripTransientPermissionState } from "./run-normalize";
import {
  MAX_FILES,
  MAX_PROJECTS,
  MAX_REMOTE_DEVICES,
  MAX_SESSIONS,
  MAX_TASKS,
  capArrayTail,
  capCatalogString,
  capRecordKeys,
} from "./store-collections";
import { enqueueWrite } from "./write-chain";

export interface PairedSession {
  token: string;
  device: DeviceInfo;
}

export interface StoredFile {
  path: string;
  name: string;
  mediaType: string;
  /** Missing on files stored before uploads were separated from messages. */
  byteLength?: number;
}

/** The model list a CLI reported, kept so the picker is complete right after launch and when offline. */
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

const MAX_RUNS_KEPT = 300;

function emptyState(): PersistedState {
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

/**
 * Single-file JSON store. Writes are debounced and atomic (tmp + rename) so a
 * crash mid-write never leaves a truncated file behind.
 */
export class Store {
  readonly file: string;
  state: PersistedState;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(dataDir: string) {
    this.file = join(dataDir, "state.json");
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!existsSync(this.file)) {
      return emptyState();
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<PersistedState>;
      const base = emptyState();
      const filesRaw = raw.files && typeof raw.files === "object" && !Array.isArray(raw.files) ? (raw.files as Record<string, StoredFile>) : base.files;
      return {
        version: 1,
        tasks: Array.isArray(raw.tasks) ? capArrayTail(raw.tasks.map(normalizeTask), MAX_TASKS) : base.tasks,
        projects: Array.isArray(raw.projects) ? capArrayTail(raw.projects, MAX_PROJECTS) : base.projects,
        runs: Array.isArray(raw.runs) ? raw.runs.map(normalizeRun) : base.runs,
        sessions: Array.isArray(raw.sessions) ? capArrayTail(raw.sessions, MAX_SESSIONS) : base.sessions,
        remoteDevices: Array.isArray(raw.remoteDevices)
          ? capArrayTail(raw.remoteDevices.map(normalizeDevice), MAX_REMOTE_DEVICES)
          : base.remoteDevices,
        files: capRecordKeys(filesRaw, MAX_FILES),
        settings: {
          ...base.settings,
          ...(raw.settings ?? {}),
          agents: { ...(raw.settings?.agents ?? {}) },
        },
        agentModels: normalizeCatalogs(raw.agentModels),
      };
    } catch {
      // Keep the broken file around for inspection instead of silently replacing it.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      void rename(this.file, backup).catch(() => undefined);
      return emptyState();
    }
  }

  /** Schedule a write; multiple calls within the window collapse into one. */
  save(): void {
    this.dirty = true;
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, 150);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) {
      return this.writing;
    }
    this.dirty = false;
    if (this.state.runs.length > MAX_RUNS_KEPT) {
      this.state.runs = this.state.runs.slice(-MAX_RUNS_KEPT);
    }
    const payload = JSON.stringify(this.state, null, 2);
    // A prior failed write leaves `writing` rejected; `.then(write)` would never run
    // again, so one disk blip would permanently stop persistence until restart.
    this.writing = enqueueWrite(this.writing, async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, payload, "utf8");
        await rename(tmp, this.file);
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
    return this.writing;
  }
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    details: task.details ?? "",
    priority: task.priority ?? "normal",
    notes: Array.isArray(task.notes) ? task.notes.map(normalizeNote) : [],
  };
}

/** Notes written before messages could carry several files had a single `file`. */
function normalizeNote(note: TaskNote & { file?: FileMeta }): TaskNote {
  const { file, ...rest } = note;
  if (!file) {
    return rest;
  }
  return { ...rest, files: Array.isArray(rest.files) && rest.files.length ? rest.files : [file] };
}

/** Only well-formed catalogs survive a reload; anything odd is simply fetched again. */
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
    const id = capCatalogString(record.id);
    if (!id) {
      continue;
    }
    const pref: IdeModelPref = { id, visible: record.visible === true };
    const label = capCatalogString(record.label);
    if (label) {
      pref.label = label;
    }
    out.push(pref);
  }
  return out.length ? out : undefined;
}

function normalizeCatalogs(value: unknown): Partial<Record<AgentKind, ModelCatalog>> {
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
    const checked = capCatalogString(checkedAt);
    if (!Array.isArray(models) || !checked) {
      continue;
    }
    const clean: AgentModel[] = [];
    for (const model of models) {
      if (!model || typeof model !== "object") {
        continue;
      }
      const row = model as AgentModel;
      const id = capCatalogString(row.id);
      if (!id) {
        continue;
      }
      const next: AgentModel = { ...row, id };
      if (typeof row.label === "string") {
        const label = capCatalogString(row.label);
        if (label) {
          next.label = label;
        } else {
          delete (next as { label?: string }).label;
        }
      }
      clean.push(next);
    }
    if (clean.length) {
      const catalog: ModelCatalog = { models: clean, checkedAt: checked };
      const prefs = normalizeIdeModels(ideModels);
      if (prefs) {
        catalog.ideModels = prefs;
      }
      out[kind] = catalog;
    }
  }
  return out;
}

function normalizeDevice(device: RemoteDevice): RemoteDevice {
  // Whether it is reachable is re-established on demand; what it reported last time is still useful.
  return {
    ...device,
    platform: device.platform ?? "unknown",
    status: "unknown",
    error: undefined,
    agents: Array.isArray(device.agents) ? device.agents : [],
  };
}

function normalizeRun(run: AgentRun): AgentRun {
  const rest = stripEmptyParentRunId(stripTransientPermissionState(run));
  // Anything that was still in flight when the host died can never finish.
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
