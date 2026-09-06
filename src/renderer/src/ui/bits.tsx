import type { ReactNode } from "react";
import {
  AGENT_LABELS,
  type AgentKind,
  type AgentRun,
  isRunActive,
  type Project,
  RUN_STATUS_LABELS,
  type RunStatus,
  STATUS_LABELS,
  type Task,
} from "@shared/protocol";
import { formatRelative } from "../lib/format";
import { Icon } from "./Icons";

export function RunStatusPill({ status, small }: { status: RunStatus; small?: boolean }): JSX.Element {
  return (
    <span className={`pill pill--${status}${small ? " pill--small" : ""}`}>
      {status === "running" ? <span className="spinner" /> : null}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

export function AgentBadge({ agent, small }: { agent: AgentKind; small?: boolean }): JSX.Element {
  return (
    <span className={`agent-badge agent-badge--${agent}${small ? " agent-badge--small" : ""}`}>
      <Icon name="bolt" size={small ? 11 : 13} />
      {AGENT_LABELS[agent]}
    </span>
  );
}

export function StatusDot({ status }: { status: Task["status"] }): JSX.Element {
  return <span className={`status-dot status-dot--${status}`} title={STATUS_LABELS[status]} />;
}

interface TaskRowProps {
  task: Task;
  project?: Project;
  run?: AgentRun;
  selected?: boolean;
  onClick(): void;
  actions?: ReactNode;
}

export function TaskRow({ task, project, run, selected, onClick, actions }: TaskRowProps): JSX.Element {
  const attachments = task.notes.filter((note) => note.file).length;
  return (
    <div className={["task-row", selected ? "task-row--selected" : "", task.status === "done" ? "task-row--done" : ""].filter(Boolean).join(" ")}>
      <button type="button" className="task-row__main" onClick={onClick}>
        <StatusDot status={task.status} />
        <div className="task-row__body">
          <div className="task-row__title">
            {task.priority === "high" ? <Icon name="flag" size={13} className="task-row__flag" /> : null}
            <span>{task.title}</span>
          </div>
          <div className="task-row__meta">
            {project ? <span className="chip chip--project">{project.name}</span> : null}
            {run ? (
              <span className={`chip chip--run chip--${run.status}`}>
                {isRunActive(run) ? <span className="spinner spinner--small" /> : null}
                {AGENT_LABELS[run.agent]} · {RUN_STATUS_LABELS[run.status]}
              </span>
            ) : task.agent ? (
              <span className="chip">{AGENT_LABELS[task.agent]}</span>
            ) : null}
            {attachments ? (
              <span className="chip chip--plain">
                <Icon name="attach" size={11} /> {attachments}
              </span>
            ) : null}
            <span className="task-row__time">{formatRelative(task.updatedAt)}</span>
          </div>
        </div>
      </button>
      {actions ? <div className="task-row__actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange(value: T): void;
}): JSX.Element {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "segmented__item segmented__item--on" : "segmented__item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && option.count > 0 ? <span className="segmented__count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="screen-head">
      {onBack ? (
        <button type="button" className="icon-btn icon-btn--plain" onClick={onBack} title="返回">
          <Icon name="back" />
        </button>
      ) : null}
      <div className="screen-head__text">
        <h2>{title}</h2>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="screen-head__actions">{actions}</div> : null}
    </header>
  );
}
