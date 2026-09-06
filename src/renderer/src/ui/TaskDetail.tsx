import { useEffect, useMemo, useState } from "react";
import {
  AGENT_LABELS,
  type AgentRun,
  type HostSnapshot,
  isRunActive,
  STATUS_LABELS,
  type Task,
  type TaskNote,
  TASK_STATUSES,
  type TaskStatus,
} from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatBytes, formatDuration, formatRelative } from "../lib/format";
import { Composer } from "./Composer";
import { DispatchSheet } from "./DispatchSheet";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { RunStatusPill, ScreenHeader, Segmented } from "./bits";

interface TaskDetailProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  task: Task;
  onBack(): void;
  onOpenRun(runId: string): void;
  onManageProjects(): void;
  embedded?: boolean;
}

export function TaskDetail({ snapshot, client, task, onBack, onOpenRun, onManageProjects, embedded }: TaskDetailProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [details, setDetails] = useState(task.details);
  const [editingTitle, setEditingTitle] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setDetails(task.details);
    setEditingTitle(false);
  }, [task.id, task.title, task.details]);

  const project = snapshot.projects.find((item) => item.id === task.projectId);
  const runsById = useMemo(() => new Map(snapshot.runs.map((run) => [run.id, run])), [snapshot.runs]);
  const activeRun = snapshot.runs.find((run) => run.taskId === task.id && isRunActive(run));

  const save = async (patch: Parameters<ClientHandle["updateTask"]>[1]) => {
    setError(null);
    try {
      await client.updateTask(task.id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const next = title.trim();
    if (next && next !== task.title) {
      void save({ title: next });
    } else {
      setTitle(task.title);
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除「${task.title}」？相关运行记录会保留。`)) {
      return;
    }
    await client.deleteTask(task.id);
    onBack();
  };

  return (
    <section className={embedded ? "screen detail detail--embedded" : "screen detail"}>
      <ScreenHeader
        onBack={embedded ? undefined : onBack}
        title={
          editingTitle ? (
            <input
              className="title-input"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                }
                if (event.key === "Escape") {
                  setTitle(task.title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <button type="button" className="title-btn" onClick={() => setEditingTitle(true)} title="点击修改标题">
              {task.priority === "high" ? <Icon name="flag" size={15} className="task-row__flag" /> : null}
              {task.title}
            </button>
          )
        }
        subtitle={`${task.createdBy.name} · ${formatRelative(task.createdAt)} 创建`}
        actions={
          <>
            <button
              type="button"
              className={task.priority === "high" ? "icon-btn icon-btn--on" : "icon-btn"}
              title={task.priority === "high" ? "取消重要标记" : "标记为重要"}
              onClick={() => void save({ priority: task.priority === "high" ? "normal" : "high" })}
            >
              <Icon name="flag" size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--danger" title="删除任务" onClick={() => void remove()}>
              <Icon name="trash" size={16} />
            </button>
          </>
        }
      />

      <div className="screen__scroll detail__scroll">
        <div className="detail__controls">
          <Segmented<TaskStatus>
            value={task.status}
            onChange={(status) => void save({ status })}
            options={TASK_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
          />
          <div className="detail__meta">
            <label className="inline-field">
              <Icon name="folder" size={14} />
              <select value={task.projectId ?? ""} onChange={(event) => void save({ projectId: event.target.value || null })}>
                <option value="">未指定项目</option>
                {snapshot.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {project && client.surface === "desktop" ? (
              <button type="button" className="link-btn" onClick={() => void window.nearboxDesktop?.openPath(project.path)}>
                打开目录
              </button>
            ) : null}
          </div>
        </div>

        <textarea
          className="detail__details"
          placeholder="详情、验收标准、参考链接…（自动保存）"
          value={details}
          rows={3}
          onChange={(event) => setDetails(event.target.value)}
          onBlur={() => {
            if (details.trim() !== task.details) {
              void save({ details });
            }
          }}
        />

        <div className="detail__dispatch">
          {activeRun ? (
            <button type="button" className="primary primary--running" onClick={() => onOpenRun(activeRun.id)}>
              <span className="spinner spinner--light" />
              {AGENT_LABELS[activeRun.agent]} {activeRun.status === "queued" ? "排队中" : "正在运行"} · 查看
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => setDispatching(true)}>
              <Icon name="bolt" size={15} />
              派给 Agent
            </button>
          )}
          {task.latestRunId && !activeRun ? (
            <button type="button" className="ghost" onClick={() => onOpenRun(task.latestRunId!)}>
              <Icon name="terminal" size={15} />
              最近一次运行
            </button>
          ) : null}
        </div>

        {error ? <p className="alert">{error}</p> : null}

        <div className="timeline">
          {task.notes.length === 0 ? <p className="muted timeline__empty">还没有备注。可以补充说明、粘贴截图，Agent 会一并看到。</p> : null}
          {task.notes.map((note) => (
            <TimelineItem
              key={note.id}
              note={note}
              run={note.runId ? runsById.get(note.runId) : undefined}
              fileUrl={note.file ? client.fileUrl(note.file.id) : undefined}
              mine={note.from.id === client.self.id}
              onOpenRun={onOpenRun}
              onCancelRun={(runId) => void client.cancelRun(runId)}
            />
          ))}
        </div>
      </div>

      <Composer
        surface={client.surface}
        compact
        placeholder="补充说明，或贴截图 / 文件…"
        onSubmit={async (text) => {
          await client.addNote(task.id, text);
        }}
        onFiles={async (files) => {
          for (const file of Array.from(files)) {
            await client.upload(file, task.id);
          }
        }}
      />

      {dispatching ? (
        <DispatchSheet
          snapshot={snapshot}
          client={client}
          task={task}
          onClose={() => setDispatching(false)}
          onDispatched={(runId) => {
            setDispatching(false);
            onOpenRun(runId);
          }}
          onManageProjects={() => {
            setDispatching(false);
            onManageProjects();
          }}
        />
      ) : null}
    </section>
  );
}

function TimelineItem({
  note,
  run,
  fileUrl,
  mine,
  onOpenRun,
  onCancelRun,
}: {
  note: TaskNote;
  run?: AgentRun;
  fileUrl?: string;
  mine: boolean;
  onOpenRun(runId: string): void;
  onCancelRun(runId: string): void;
}): JSX.Element {
  if (note.kind === "status") {
    return (
      <div className="timeline__status">
        <span>{note.text}</span>
        <span className="muted">
          {note.from.name} · {formatRelative(note.createdAt)}
        </span>
      </div>
    );
  }
  if (note.kind === "run") {
    return <RunCard run={run} note={note} onOpen={onOpenRun} onCancel={onCancelRun} />;
  }
  const image = note.file && /^image\//.test(note.file.mediaType) && fileUrl;
  return (
    <article className={mine ? "note note--mine" : "note"}>
      <div className="note__head">
        <span>{note.from.name}</span>
        <span className="muted">{formatRelative(note.createdAt)}</span>
      </div>
      {note.text ? <Markdown text={note.text} className="note__text" /> : null}
      {image ? (
        <a className="note__image" href={fileUrl} target="_blank" rel="noreferrer">
          <img src={fileUrl} alt={note.file?.name ?? "图片"} loading="lazy" />
        </a>
      ) : null}
      {note.file && !image ? (
        <a className="file-card" href={fileUrl} target="_blank" rel="noreferrer">
          <span className="file-card__icon">
            <Icon name="file" size={18} />
          </span>
          <span>
            <strong>{note.file.name}</strong>
            <span>{formatBytes(note.file.byteLength)}</span>
          </span>
        </a>
      ) : null}
    </article>
  );
}

function RunCard({
  run,
  note,
  onOpen,
  onCancel,
}: {
  run?: AgentRun;
  note: TaskNote;
  onOpen(runId: string): void;
  onCancel(runId: string): void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  if (!run) {
    return (
      <div className="timeline__status">
        <span>派发了一次运行（记录已清理）</span>
        <span className="muted">{formatRelative(note.createdAt)}</span>
      </div>
    );
  }
  const summary = run.status === "succeeded" ? run.summary : run.error ?? run.summary;
  const long = (summary?.length ?? 0) > 600;
  return (
    <article className={`run-card run-card--${run.status}`}>
      <div className="run-card__head">
        <span className="run-card__agent">
          <Icon name="bolt" size={13} />
          {AGENT_LABELS[run.agent]}
        </span>
        <RunStatusPill status={run.status} small />
        <span className="muted small">
          {run.requestedBy.name} · {formatRelative(run.createdAt)}
          {run.startedAt ? ` · ${formatDuration(run.startedAt, run.finishedAt)}` : ""}
        </span>
      </div>
      {summary ? (
        <div className={long && !expanded ? "run-card__summary run-card__summary--clamp" : "run-card__summary"}>
          <Markdown text={summary} />
        </div>
      ) : isRunActive(run) ? (
        <p className="muted small">{run.status === "queued" ? "等待前面的运行结束…" : "正在工作，点「查看日志」看实时输出。"}</p>
      ) : null}
      <div className="run-card__actions">
        {long ? (
          <button type="button" className="link-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "展开全文"}
          </button>
        ) : null}
        <button type="button" className="link-btn" onClick={() => onOpen(run.id)}>
          查看日志
        </button>
        {isRunActive(run) ? (
          <button type="button" className="link-btn link-btn--danger" onClick={() => onCancel(run.id)}>
            停止
          </button>
        ) : null}
      </div>
    </article>
  );
}
