import { hasParentRunId, isRunActive } from "../../../shared/conversation.ts";
import type { AgentKind, AgentRun, Project, Task, TaskStatus } from "../../../shared/protocol";

// How the task list is organised: what needs the user, what is running, and
// the sections the rest falls into. Runtime-import free so it can be
// unit-tested under plain `node --test`.

export type ListMode = "project" | "time";

/** One or two words for the right edge of a one-line row. */
export const AGENT_SHORT_LABELS: Record<AgentKind, string> = {
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok",
  claude: "Claude",
  opencode: "opencode",
};

/** Newest first, important ones before the rest. */
function byRecent(a: Task, b: Task): number {
  if (a.priority !== b.priority) {
    return a.priority === "high" ? -1 : 1;
  }
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function byCompleted(a: Task, b: Task): number {
  return Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt);
}

/**
 * Each task's newest turn of its own conversation. Sub-runs another agent
 * delegated belong to the thread but are not turns of the task.
 */
export function latestTurns(runs: readonly AgentRun[]): Map<string, AgentRun> {
  const map = new Map<string, AgentRun>();
  for (const run of runs) {
    if (!hasParentRunId(run)) {
      map.set(run.taskId, run);
    }
  }
  return map;
}

/**
 * The run that best says what a task is doing right now: a running one over a
 * queued one, the task's own turn over a delegated sub-run.
 */
export function activeRuns(runs: readonly AgentRun[]): Map<string, AgentRun> {
  const map = new Map<string, AgentRun>();
  const score = (run: AgentRun) => (run.status === "running" ? 2 : 0) + (hasParentRunId(run) ? 0 : 1);
  for (const run of runs) {
    if (!isRunActive(run)) {
      continue;
    }
    const current = map.get(run.taskId);
    if (!current || score(run) > score(current)) {
      map.set(run.taskId, run);
    }
  }
  return map;
}

// ---------------------------------------------------------------- attention

export type AttentionReason = "permission" | "failed" | "finished";

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  permission: "等待允许",
  failed: "运行失败",
  finished: "新回复",
};

export interface AttentionItem {
  task: Task;
  run: AgentRun;
  reason: AttentionReason;
}

/**
 * What "seen" means for a task: the id and status of its newest turn when the
 * task was last open. A turn that finishes afterwards changes the marker, so
 * the task shows up under 需要你 until it is opened again.
 */
export function seenMarker(run: AgentRun | undefined): string {
  return run ? `${run.id}|${run.status}` : "";
}

const ATTENTION_RANK: Record<AttentionReason, number> = { permission: 0, failed: 1, finished: 2 };

/** First active run waiting on permission, per task (matches `.find` order). */
function pendingPermissionByTask(runs: readonly AgentRun[]): Map<string, AgentRun> {
  const map = new Map<string, AgentRun>();
  for (const run of runs) {
    if (isRunActive(run) && run.pendingPermission && !map.has(run.taskId)) {
      map.set(run.taskId, run);
    }
  }
  return map;
}

/**
 * Tasks the user has to act on or look at: a turn waiting for permission
 * (live, on any run of the task), or a turn that ended since the task was
 * last opened on this device. Cancelled turns and tasks already marked done
 * are not news.
 */
export function attentionFor(tasks: readonly Task[], runs: readonly AgentRun[], seen: Readonly<Record<string, string>>): AttentionItem[] {
  const latest = latestTurns(runs);
  const waitingByTask = pendingPermissionByTask(runs);
  const items: AttentionItem[] = [];
  for (const task of tasks) {
    const waiting = waitingByTask.get(task.id);
    if (waiting) {
      items.push({ task, run: waiting, reason: "permission" });
      continue;
    }
    if (task.status === "done") {
      continue;
    }
    const turn = latest.get(task.id);
    if (!turn || isRunActive(turn) || turn.status === "cancelled" || seen[task.id] === seenMarker(turn)) {
      continue;
    }
    items.push({ task, run: turn, reason: turn.status === "failed" ? "failed" : "finished" });
  }
  const when = (item: AttentionItem) => Date.parse(item.run.finishedAt ?? item.task.updatedAt);
  return items.sort((a, b) => ATTENTION_RANK[a.reason] - ATTENTION_RANK[b.reason] || when(b) - when(a));
}

/**
 * The seen markers after a snapshot: the first time through, everything that
 * exists counts as seen (an upgrade must not flag months of old turns); after
 * that, only the open task is marked, and tasks that no longer exist are
 * dropped. Returns `current` itself when nothing changed.
 */
export function updateSeen(
  current: Readonly<Record<string, string>> | null,
  tasks: readonly Task[],
  runs: readonly AgentRun[],
  openTaskId: string | undefined,
): Record<string, string> {
  const latest = latestTurns(runs);
  if (!current) {
    return Object.fromEntries(tasks.map((task) => [task.id, seenMarker(latest.get(task.id))]));
  }
  let next: Record<string, string> = current;
  const ids = new Set(tasks.map((task) => task.id));
  if (Object.keys(current).some((id) => !ids.has(id))) {
    next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
  }
  if (openTaskId && ids.has(openTaskId)) {
    const marker = seenMarker(latest.get(openTaskId));
    if (next[openTaskId] !== marker) {
      next = { ...next, [openTaskId]: marker };
    }
  }
  return next;
}

// ----------------------------------------------------------------- sections

export interface TaskSection {
  /** "all" for the flat list, "inbox" for tasks without a project, else the project id. */
  key: string;
  kind: "all" | "inbox" | "project";
  project?: Project;
  /** Not done, newest first. */
  open: Task[];
  /** Done, most recently completed first. */
  done: Task[];
  /** Tasks in this section with a running turn. */
  running: number;
  /** Tasks in this section waiting in the queue. */
  queued: number;
}

export interface SectionInput {
  tasks: readonly Task[];
  runs: readonly AgentRun[];
  /** Registration order is the section order: it does not shuffle while agents work. */
  projects: readonly Project[];
  /** One section per project (plus the inbox) instead of a single list. */
  grouped: boolean;
  query?: string;
}

function matchesQuery(task: Task, needle: string): boolean {
  return !needle || `${task.title}\n${task.details}`.toLowerCase().includes(needle);
}

function section(key: string, kind: TaskSection["kind"], tasks: Task[], active: ReadonlyMap<string, AgentRun>, project?: Project): TaskSection {
  let running = 0;
  let queued = 0;
  for (const task of tasks) {
    const run = active.get(task.id);
    if (run?.status === "running") {
      running += 1;
    } else if (run) {
      queued += 1;
    }
  }
  const open: Task[] = [];
  const done: Task[] = [];
  for (const task of tasks) {
    if (task.status === "done") {
      done.push(task);
    } else {
      open.push(task);
    }
  }
  open.sort(byRecent);
  done.sort(byCompleted);
  return {
    key,
    kind,
    project,
    open,
    done,
    running,
    queued,
  };
}

/**
 * The main list. Grouped: the inbox (tasks with no project, or whose project
 * was removed) first, then one section per registered project that has tasks.
 * Flat: everything in one section. Sections without tasks are left out.
 */
export function buildSections({ tasks, runs, projects, grouped, query }: SectionInput): TaskSection[] {
  const needle = (query ?? "").trim().toLowerCase();
  const matches = needle ? tasks.filter((task) => matchesQuery(task, needle)) : (tasks as Task[]);
  const active = activeRuns(runs);
  if (!grouped) {
    return matches.length ? [section("all", "all", matches, active)] : [];
  }
  const known = new Set(projects.map((project) => project.id));
  const inbox: Task[] = [];
  const byProject = new Map<string, Task[]>();
  for (const task of matches) {
    const projectId = task.projectId;
    if (!projectId || !known.has(projectId)) {
      inbox.push(task);
      continue;
    }
    const bucket = byProject.get(projectId);
    if (bucket) {
      bucket.push(task);
    } else {
      byProject.set(projectId, [task]);
    }
  }
  const sections: TaskSection[] = inbox.length ? [section("inbox", "inbox", inbox, active)] : [];
  for (const project of projects) {
    const own = byProject.get(project.id);
    if (own?.length) {
      sections.push(section(project.id, "project", own, active, project));
    }
  }
  return sections;
}

/** "1 运行 · 2 排队", either half alone, or "" when the section is idle. */
export function activityLabel(section: Pick<TaskSection, "running" | "queued">): string {
  const parts: string[] = [];
  if (section.running) {
    parts.push(`${section.running} 运行`);
  }
  if (section.queued) {
    parts.push(`${section.queued} 排队`);
  }
  return parts.join(" · ");
}

// --------------------------------------------------------------------- rows

export type RowState = "running" | "queued" | "failed" | TaskStatus;

/** What the dot at the start of a row shows: live activity beats history beats the task's own status. */
export function rowState(task: Task, active: AgentRun | undefined, latest: AgentRun | undefined): RowState {
  if (active) {
    return active.status === "running" ? "running" : "queued";
  }
  if (latest?.status === "failed" && task.status !== "done") {
    return "failed";
  }
  return task.status;
}

/** The agent a row is about: the one working now, else the one that took the last turn, else the chip's pick. */
export function rowAgent(task: Task, active: AgentRun | undefined, latest: AgentRun | undefined): AgentKind | undefined {
  return active?.agent ?? latest?.agent ?? task.agent;
}
