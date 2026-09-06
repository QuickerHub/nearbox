import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type AgentRun, type HostSnapshot, STATUS_LABELS, type Task, type TaskNote } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatBytes, formatRelative } from "../lib/format";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { RunBlock } from "./RunBlock";

interface ThreadProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  task: Task;
  onDeleted(): void;
  /** The composer, docked under the conversation. */
  children: ReactNode;
}

/** A task as a conversation: description, notes, and every agent run in order. */
export function Thread({ snapshot, client, task, onDeleted, children }: ThreadProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [details, setDetails] = useState(task.details);
  const [editingDetails, setEditingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setTitle(task.title);
    setEditingTitle(false);
  }, [task.id, task.title]);

  useEffect(() => {
    setDetails(task.details);
    setEditingDetails(false);
  }, [task.id, task.details]);

  useEffect(() => {
    stick.current = true;
    const node = scroller.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [task.id]);

  useEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stick.current) {
        node.scrollTop = node.scrollHeight;
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const project = snapshot.projects.find((item) => item.id === task.projectId);
  const runsById = useMemo(() => new Map(snapshot.runs.map((run) => [run.id, run])), [snapshot.runs]);
  const lastRunNoteId = [...task.notes].reverse().find((note) => note.kind === "run")?.id;

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

  const commitDetails = () => {
    setEditingDetails(false);
    if (details.trim() !== task.details) {
      void save({ details });
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除「${task.title}」？运行记录会保留在磁盘上。`)) {
      return;
    }
    try {
      await client.deleteTask(task.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const done = task.status === "done";

  return (
    <section className="thread">
      <header className="thread__head">
        <div className="thread__title-row">
          {editingTitle ? (
            <input
              className="thread__title-input"
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
            <button type="button" className={`thread__title${done ? " thread__title--done" : ""}`} onClick={() => setEditingTitle(true)} title="点击修改标题">
              {task.priority === "high" ? <Icon name="flag" size={14} className="thread__flag" /> : null}
              <span>{task.title}</span>
            </button>
          )}
          <div className="thread__actions">
            <button
              type="button"
              className={done ? "ghost ghost--small ghost--on" : "ghost ghost--small"}
              title={done ? "重新打开" : "标记完成"}
              onClick={() => void save({ status: done ? "todo" : "done" })}
            >
              <Icon name="check" size={14} />
              <span>{done ? "已完成" : "完成"}</span>
            </button>
            <button
              type="button"
              className={task.priority === "high" ? "icon-btn icon-btn--plain icon-btn--on" : "icon-btn icon-btn--plain"}
              title={task.priority === "high" ? "取消重要标记" : "标记为重要"}
              onClick={() => void save({ priority: task.priority === "high" ? "normal" : "high" })}
            >
              <Icon name="flag" size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn--plain icon-btn--danger" title="删除任务" onClick={() => void remove()}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>
        <p className="thread__meta muted small">
          {task.createdBy.name} · {formatRelative(task.createdAt)} 创建 · {STATUS_LABELS[task.status]}
          {project ? (
            <>
              {" · "}
              {client.surface === "desktop" ? (
                <button type="button" className="link-btn link-btn--muted" onClick={() => void window.nearboxDesktop?.openPath(project.path)} title={project.path}>
                  <Icon name="folder" size={11} />
                  {project.name}
                </button>
              ) : (
                <span title={project.path}>{project.name}</span>
              )}
            </>
          ) : null}
        </p>
        {error ? <p className="alert">{error}</p> : null}
      </header>

      <div
        className="thread__scroll"
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}
      >
        <div className="thread__content" ref={content}>
          {editingDetails ? (
            <textarea
              className="thread__details-input"
              autoFocus
              rows={4}
              value={details}
              placeholder="任务描述、验收标准、参考链接…"
              onChange={(event) => setDetails(event.target.value)}
              onBlur={commitDetails}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDetails(task.details);
                  setEditingDetails(false);
                }
              }}
            />
          ) : task.details ? (
            <button type="button" className="bubble bubble--user bubble--details" onClick={() => setEditingDetails(true)} title="点击编辑描述">
              <div className="bubble__head">
                <span>任务描述</span>
                <span className="muted">点击编辑</span>
              </div>
              <Markdown text={task.details} className="bubble__text" />
            </button>
          ) : (
            <button type="button" className="thread__add-details link-btn link-btn--muted" onClick={() => setEditingDetails(true)}>
              <Icon name="plus" size={12} />
              添加任务描述
            </button>
          )}

          {task.notes.map((note) => (
            <ThreadItem
              key={note.id}
              note={note}
              run={note.runId ? runsById.get(note.runId) : undefined}
              client={client}
              mine={note.from.id === client.self.id}
              newest={note.id === lastRunNoteId}
            />
          ))}
        </div>
      </div>

      {children}
    </section>
  );
}

function ThreadItem({
  note,
  run,
  client,
  mine,
  newest,
}: {
  note: TaskNote;
  run?: AgentRun;
  client: ClientHandle;
  mine: boolean;
  newest: boolean;
}): JSX.Element {
  if (note.kind === "status") {
    return (
      <div className="thread__system">
        <span>{note.text}</span>
        <span className="muted">
          {note.from.name} · {formatRelative(note.createdAt)}
        </span>
      </div>
    );
  }
  if (note.kind === "run") {
    if (!run) {
      return (
        <div className="thread__system">
          <span>派发过一次运行（记录已清理）</span>
          <span className="muted">{formatRelative(note.createdAt)}</span>
        </div>
      );
    }
    return <RunBlock run={run} client={client} onStop={(runId) => void client.cancelRun(runId)} initiallyOpen={newest && run.status !== "succeeded"} />;
  }
  const fileUrl = note.file ? client.fileUrl(note.file.id) : undefined;
  const image = note.file && /^image\//.test(note.file.mediaType) && fileUrl;
  return (
    <article className={mine ? "bubble bubble--user" : "bubble bubble--user bubble--other"}>
      <div className="bubble__head">
        <span>{note.from.name}</span>
        <span className="muted">{formatRelative(note.createdAt)}</span>
      </div>
      {note.text ? <Markdown text={note.text} className="bubble__text" /> : null}
      {image ? (
        <a className="bubble__image" href={fileUrl} target="_blank" rel="noreferrer">
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
