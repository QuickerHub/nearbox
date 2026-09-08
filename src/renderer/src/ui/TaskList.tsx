import { useMemo, useState } from "react";
import { AGENT_LABELS, type AgentRun, type HostSnapshot, projectDisplayName, type Task } from "@shared/protocol";
import { formatRelative } from "../lib/format";
import {
  activeRuns,
  activityLabel,
  AGENT_SHORT_LABELS,
  ATTENTION_LABELS,
  type AttentionReason,
  attentionFor,
  buildSections,
  latestTurns,
  type ListMode,
  rowAgent,
  rowState,
} from "../lib/taskList";
import { Icon } from "./Icons";

const MODE_KEY = "nearbox.list.mode";
const COLLAPSED_KEY = "nearbox.list.collapsed";

function readMode(): ListMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "time" ? "time" : "project";
  } catch {
    return "project";
  }
}

function readCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

interface TaskListProps {
  snapshot: HostSnapshot;
  /** Per task, the marker of the newest turn seen on this device (see `seenMarker`); null until the baseline is set. */
  seen: Readonly<Record<string, string>> | null;
  selectedTaskId?: string;
  onSelect(taskId: string): void;
  /** Phone home embeds the list without its own search box, always in time order. */
  compact?: boolean;
}

/**
 * Every task is a conversation; this is the list of them. Two boards at the
 * top mirror what needs the user and what is running; below, every task keeps
 * its row in its project's section (or the inbox), so nothing jumps around
 * when a turn starts or ends.
 */
export function TaskList({ snapshot, seen, selectedTaskId, onSelect, compact }: TaskListProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [mode, setMode] = useState<ListMode>(() => readMode());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed());

  // With one project, sections would only add a header; the phone is too narrow for them.
  const canGroup = !compact && snapshot.projects.length >= 2;
  const grouped = canGroup && mode === "project";
  const searching = Boolean(query.trim());

  const active = useMemo(() => activeRuns(snapshot.runs), [snapshot.runs]);
  const latest = useMemo(() => latestTurns(snapshot.runs), [snapshot.runs]);
  const attention = useMemo(() => (seen ? attentionFor(snapshot.tasks, snapshot.runs, seen) : []), [snapshot.tasks, snapshot.runs, seen]);
  const running = useMemo(() => {
    const flagged = new Set(attention.map((item) => item.task.id));
    return snapshot.tasks
      .filter((task) => active.has(task.id) && !flagged.has(task.id))
      .sort((a, b) => {
        const runA = active.get(a.id)!;
        const runB = active.get(b.id)!;
        if (runA.status !== runB.status) {
          return runA.status === "running" ? -1 : 1;
        }
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  }, [snapshot.tasks, active, attention]);
  const sections = useMemo(
    () => buildSections({ tasks: snapshot.tasks, runs: snapshot.runs, projects: snapshot.projects, grouped, query }),
    [snapshot.tasks, snapshot.runs, snapshot.projects, grouped, query],
  );
  const doneTotal = sections.reduce((count, section) => count + section.done.length, 0);
  const revealDone = showDone || searching;

  const projectName = (projectId: string | undefined): string | undefined => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    return project ? projectDisplayName(project, snapshot.remoteDevices) : undefined;
  };

  const switchMode = () => {
    const next: ListMode = mode === "project" ? "time" : "project";
    setMode(next);
    window.localStorage.setItem(MODE_KEY, next);
  };

  const toggleSection = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  const row = (task: Task) => (
    <TaskRow key={task.id} task={task} active={active.get(task.id)} latest={latest.get(task.id)} selected={task.id === selectedTaskId} onClick={() => onSelect(task.id)} />
  );

  return (
    <div className={compact ? "task-list task-list--compact" : "task-list"}>
      {!compact ? (
        <div className="task-list__bar">
          <label className="search">
            <Icon name="search" size={14} />
            <input value={query} placeholder="搜索任务" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {canGroup ? (
            <button
              type="button"
              className={grouped ? "icon-btn icon-btn--plain task-list__mode task-list__mode--on" : "icon-btn icon-btn--plain task-list__mode"}
              onClick={switchMode}
              title={grouped ? "改为按时间排列" : "改为按项目分组"}
            >
              <Icon name="folder" size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="task-list__scroll">
        {snapshot.tasks.length === 0 ? <p className="task-list__empty muted">还没有任务。在输入框里写一句话就会出现在这里。</p> : null}

        {!searching && attention.length ? (
          <section className="task-group task-board">
            <div className="task-group__head">
              <span className="task-group__name">需要你</span>
              <span className="task-group__count muted">{attention.length}</span>
            </div>
            {attention.map((item) => (
              <BoardItem
                key={item.task.id}
                task={item.task}
                run={item.run}
                reason={item.reason}
                projectName={projectName(item.task.projectId)}
                selected={item.task.id === selectedTaskId}
                onClick={() => onSelect(item.task.id)}
              />
            ))}
          </section>
        ) : null}

        {!searching && running.length ? (
          <section className="task-group task-board">
            <div className="task-group__head">
              <span className="task-group__name">运行中</span>
              <span className="task-group__count muted">{running.length}</span>
            </div>
            {running.map((task) => (
              <BoardItem
                key={task.id}
                task={task}
                run={active.get(task.id)!}
                projectName={projectName(task.projectId)}
                selected={task.id === selectedTaskId}
                onClick={() => onSelect(task.id)}
              />
            ))}
          </section>
        ) : null}

        {searching && !sections.length ? <p className="task-list__empty muted">没有匹配的任务。</p> : null}

        {sections.map((section) => {
          const isCollapsed = section.kind !== "all" && collapsed.has(section.key);
          const activity = activityLabel(section);
          return (
            <section className="task-group" key={section.key}>
              {section.kind !== "all" ? (
                <button type="button" className="task-group__head task-group__head--toggle" onClick={() => toggleSection(section.key)} title={isCollapsed ? "展开" : "收起"}>
                  <Icon name={section.kind === "inbox" ? "inbox" : "folder"} size={12} />
                  <span className="task-group__name">{section.kind === "inbox" ? "收集箱" : projectDisplayName(section.project!, snapshot.remoteDevices)}</span>
                  {activity ? <span className="task-group__activity">{activity}</span> : null}
                  <span className="task-group__count muted">{section.open.length}</span>
                  <Icon name="chevron" size={12} className={isCollapsed ? "task-group__chevron" : "task-group__chevron task-group__chevron--open"} />
                </button>
              ) : null}
              {!isCollapsed ? section.open.map(row) : null}
              {!isCollapsed && revealDone ? section.done.map(row) : null}
            </section>
          );
        })}

        {doneTotal && !searching ? (
          <button type="button" className="task-list__done-toggle" onClick={() => setShowDone((value) => !value)}>
            <Icon name="check" size={12} />
            <span>{showDone ? "隐藏已完成" : `显示已完成 · ${doneTotal}`}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** One line: status dot, title, who is on it, when it last moved. The project is the section it sits in. */
function TaskRow({
  task,
  active,
  latest,
  selected,
  onClick,
}: {
  task: Task;
  active?: AgentRun;
  latest?: AgentRun;
  selected: boolean;
  onClick(): void;
}): JSX.Element {
  const state = rowState(task, active, latest);
  const agent = rowAgent(task, active, latest);
  return (
    <button
      type="button"
      className={["task-row", selected ? "task-row--selected" : "", task.status === "done" ? "task-row--done" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      title={task.title}
    >
      <span className={`task-row__mark task-row__mark--${state}`}>{state === "running" ? <span className="spinner spinner--small" /> : null}</span>
      {task.priority === "high" ? <Icon name="flag" size={12} className="task-row__flag" /> : null}
      <span className="task-row__title">{task.title}</span>
      {agent ? <span className="task-row__agent">{AGENT_SHORT_LABELS[agent]}</span> : null}
      <span className="task-row__time">{formatRelative(task.updatedAt)}</span>
    </button>
  );
}

/** A row on the 需要你 / 运行中 boards: two lines, because these cross projects and say why they are here. */
function BoardItem({
  task,
  run,
  reason,
  projectName,
  selected,
  onClick,
}: {
  task: Task;
  run: AgentRun;
  /** Why the task is on the 需要你 board; undefined on the 运行中 board. */
  reason?: AttentionReason;
  projectName?: string;
  selected: boolean;
  onClick(): void;
}): JSX.Element {
  const mark = reason ?? run.status;
  const when = reason === "failed" || reason === "finished" ? run.finishedAt ?? task.updatedAt : task.updatedAt;
  return (
    <button type="button" className={selected ? "task-item task-item--selected" : "task-item"} onClick={onClick}>
      <span className={`task-item__mark task-item__mark--${mark}`}>{mark === "running" ? <span className="spinner spinner--small" /> : null}</span>
      <span className="task-item__body">
        <span className="task-item__title">
          {task.priority === "high" ? <Icon name="flag" size={12} className="task-item__flag" /> : null}
          {task.title}
        </span>
        <span className="task-item__meta">
          {reason ? <span className={`task-item__reason task-item__reason--${reason}`}>{ATTENTION_LABELS[reason]}</span> : null}
          <span>
            {AGENT_LABELS[run.agent]}
            {!reason ? ` · ${run.status === "queued" ? "排队" : "运行中"}` : ""}
          </span>
          {projectName ? <span>{projectName}</span> : null}
          <span className="task-item__time">{formatRelative(when)}</span>
        </span>
      </span>
    </button>
  );
}
