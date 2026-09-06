import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AgentRun,
  DEFAULT_SETTINGS,
  type DeviceInfo,
  type HostSettings,
  type Project,
  type Task,
} from "@shared/protocol";

export interface PairedSession {
  token: string;
  device: DeviceInfo;
}

export interface StoredFile {
  path: string;
  name: string;
  mediaType: string;
}

export interface PersistedState {
  version: 1;
  tasks: Task[];
  projects: Project[];
  runs: AgentRun[];
  sessions: PairedSession[];
  files: Record<string, StoredFile>;
  settings: HostSettings;
}

const MAX_RUNS_KEPT = 300;

function emptyState(): PersistedState {
  return {
    version: 1,
    tasks: [],
    projects: [],
    runs: [],
    sessions: [],
    files: {},
    settings: { ...DEFAULT_SETTINGS, agents: {} },
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
      return {
        version: 1,
        tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : base.tasks,
        projects: Array.isArray(raw.projects) ? raw.projects : base.projects,
        runs: Array.isArray(raw.runs) ? raw.runs.map(normalizeRun) : base.runs,
        sessions: Array.isArray(raw.sessions) ? raw.sessions : base.sessions,
        files: raw.files && typeof raw.files === "object" ? raw.files : base.files,
        settings: {
          ...base.settings,
          ...(raw.settings ?? {}),
          agents: { ...(raw.settings?.agents ?? {}) },
        },
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
      void this.flush();
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
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    details: task.details ?? "",
    priority: task.priority ?? "normal",
    notes: Array.isArray(task.notes) ? task.notes : [],
  };
}

function normalizeRun(run: AgentRun): AgentRun {
  // Anything that was still in flight when the host died can never finish.
  if (run.status === "running" || run.status === "queued") {
    return {
      ...run,
      status: "failed",
      error: run.error ?? "电脑端在运行期间退出了。",
      finishedAt: run.finishedAt ?? new Date().toISOString(),
    };
  }
  return { ...run, eventCount: run.eventCount ?? 0 };
}
