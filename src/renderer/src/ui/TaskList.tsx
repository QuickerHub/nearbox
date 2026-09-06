import { useMemo, useState } from "react";
import { AGENT_LABELS, type AgentRun, type HostSnapshot, isRunActive, RUN_STATUS_LABELS, type Task } from "@shared/protocol";
import { formatRelative } from "../lib/format";
import { Icon } from "./Icons";

interface TaskListProps {
  snapshot: HostSnapshot;
  selectedTaskId?: string;
  onSelect(taskId: string): void;
  /** Phone home embeds the list without its own search box. */
  compact?: boolean;
}

interface Group {
  key: "running" | "open" | "done";
  label: string;
  tasks: Task[];
}

/** Every task is a conversation; this is the list of them. */
export function TaskList({ snapshot, selectedTaskId, onSelect, compact }: TaskListProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);

  const runsById = useMemo(() => new Map(snapshot.runs.map((run) => [run.id, run])), [snapshot.runs]);
  const activeByTask = useMemo(() => {
    const map = new Map<string, AgentRun>();
    for (const run of snapshot.runs) {
      if (isRunActive(run)) {
        map.set(run.taskId, run);
      }
    }
    return map;
  }, [snapshot.runs]);

  const groups = useMemo<Group[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = snapshot.tasks.filter((task) => !needle || `${task.title}\n${task.details}`.toLowerCase().includes(needle));
    const byRecent = (a: Task, b: Task) => {
      if (a.priority !== b.priority) {
        return a.priority === "high" ? -1 : 1;
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    };
    const running = matches.filter((task) => activeByTask.has(task.id)).sort(byRecent);
    const open = matches.filter((task) => !activeByTask.has(task.id) && task.status !== "done").sort(byRecent);
    const done = matches
      .filter((task) => !activeByTask.has(task.id) && task.status === "done")
      .sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt));
    return [
      { key: "running", label: "运行中", tasks: running },
      { key: "open", label: "待处理", tasks: open },
      { key: "done", label: "已完成", tasks: done },
    ];
  }, [snapshot.tasks, activeByTask, query]);

  const total = snapshot.tasks.length;

  return (
    <div className={compact ? "task-list task-list--compact" : "task-list"}>
      {!compact ? (
        <label className="search">
          <Icon name="search" size={14} />
          <input value={query} placeholder="搜索任务" onChange={(event) => setQuery(event.target.value)} />
        </label>
      ) : null}
      <div className="task-list__scroll">
        {total === 0 ? (
          <p className="task-list__empty muted">
            还没有任务。在输入框里写一句话就会出现在这里。
          </p>
        ) : null}
        {groups.map((group) => {
          if (!group.tasks.length) {
            return null;
          }
          const collapsed = group.key === "done" && !showDone && !query;
          return (
            <section className="task-group" key={group.key}>
              <button
                type="button"
                className={`task-group__head${group.key === "done" ? " task-group__head--toggle" : ""}`}
                onClick={() => group.key === "done" && setShowDone((value) => !value)}
                disabled={group.key !== "done"}
              >
                <span>{group.label}</span>
                <span className="muted">{group.tasks.length}</span>
                {group.key === "done" ? <Icon name="chevron" size={12} className={collapsed ? "task-group__chevron" : "task-group__chevron task-group__chevron--open"} /> : null}
              </button>
              {!collapsed
                ? group.tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      projectName={snapshot.projects.find((project) => project.id === task.projectId)?.name}
                      run={activeByTask.get(task.id) ?? (task.latestRunId ? runsById.get(task.latestRunId) : undefined)}
                      selected={task.id === selectedTaskId}
                      onClick={() => onSelect(task.id)}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskItem({
  task,
  projectName,
  run,
  selected,
  onClick,
}: {
  task: Task;
  projectName?: string;
  run?: AgentRun;
  selected: boolean;
  onClick(): void;
}): JSX.Element {
  const active = run ? isRunActive(run) : false;
  const attachments = task.notes.reduce((count, note) => count + (note.files?.length ?? 0), 0);
  return (
    <button
      type="button"
      className={["task-item", selected ? "task-item--selected" : "", task.status === "done" ? "task-item--done" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span className={`task-item__mark task-item__mark--${active ? "running" : task.status}`}>{active ? <span className="spinner spinner--small" /> : null}</span>
      <span className="task-item__body">
        <span className="task-item__title">
          {task.priority === "high" ? <Icon name="flag" size={12} className="task-item__flag" /> : null}
          {task.title}
        </span>
        <span className="task-item__meta">
          {run ? (
            <span className={`task-item__run task-item__run--${run.status}`}>
              {AGENT_LABELS[run.agent]}
              {active ? ` · ${run.status === "queued" ? "排队" : "运行中"}` : run.status === "failed" ? ` · ${RUN_STATUS_LABELS[run.status]}` : ""}
            </span>
          ) : task.agent ? (
            <span>{AGENT_LABELS[task.agent]}</span>
          ) : null}
          {projectName ? <span>{projectName}</span> : null}
          {attachments ? (
            <span className="task-item__attach">
              <Icon name="attach" size={10} />
              {attachments}
            </span>
          ) : null}
          <span className="task-item__time">{formatRelative(task.updatedAt)}</span>
        </span>
      </span>
    </button>
  );
}
