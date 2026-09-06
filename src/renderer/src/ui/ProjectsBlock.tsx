import { useState } from "react";
import { AGENT_KINDS, AGENT_LABELS, type AgentKind, type HostSnapshot, isRunActive } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatRelative } from "../lib/format";
import { Icon } from "./Icons";

interface ProjectsBlockProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
}

/** Settings section: the folders agents are allowed to work in. */
export function ProjectsBlock({ snapshot, client }: ProjectsBlockProps): JSX.Element {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = window.nearboxDesktop;

  const add = async (candidate: string) => {
    const value = candidate.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.addProject({ path: value });
      setPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const projects = [...snapshot.projects].sort(
    (a, b) => Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt),
  );

  return (
    <section className="settings__block">
      <div className="settings__block-head">
        <h2>项目目录</h2>
        <p className="muted">Agent 只会在这里登记过的目录里工作。输入框下方的「项目」芯片也能直接添加。</p>
      </div>

      <div className="card add-project">
        {desktop ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              void desktop.pickFolder().then((chosen) => (chosen ? add(chosen) : undefined));
            }}
          >
            <Icon name="folder" size={15} />
            选择文件夹…
          </button>
        ) : null}
        <form
          className="add-project__form"
          onSubmit={(event) => {
            event.preventDefault();
            void add(path);
          }}
        >
          <input
            value={path}
            placeholder={desktop ? "或直接粘贴路径，如 D:\\source\\my-app" : "电脑上的目录路径，如 D:\\source\\my-app"}
            onChange={(event) => setPath(event.target.value)}
          />
          <button type="submit" className="ghost" disabled={busy || !path.trim()}>
            添加
          </button>
        </form>
        {error ? <p className="alert">{error}</p> : null}
      </div>

      {projects.length === 0 ? (
        <p className="muted small">还没有项目。添加一个代码目录后，就能把任务派给 Agent 去做。</p>
      ) : (
        <div className="project-list">
          {projects.map((project) => {
            const running = snapshot.runs.filter((run) => run.projectId === project.id && isRunActive(run)).length;
            const total = snapshot.runs.filter((run) => run.projectId === project.id).length;
            return (
              <article className="project-card" key={project.id}>
                <div className="project-card__head">
                  <div className="project-card__title">
                    <Icon name="folder" size={16} />
                    <input
                      className="inline-input"
                      defaultValue={project.name}
                      key={`${project.id}-${project.name}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== project.name) {
                          void client.updateProject(project.id, { name: next });
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn--plain icon-btn--danger"
                    title="移除项目（不会删除文件）"
                    onClick={() => {
                      if (window.confirm(`从 Nearbox 移除「${project.name}」？磁盘上的文件不受影响。`)) {
                        void client.removeProject(project.id).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
                      }
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <p className="project-card__path muted">{project.path}</p>
                <div className="project-card__foot">
                  <label className="inline-field">
                    <span className="muted small">默认 Agent</span>
                    <select
                      value={project.defaultAgent ?? ""}
                      onChange={(event) => void client.updateProject(project.id, { defaultAgent: (event.target.value || null) as AgentKind | null })}
                    >
                      <option value="">不指定</option>
                      {AGENT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {AGENT_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="muted small">
                    {running ? `${running} 个在跑 · ` : ""}
                    {total ? `${total} 次运行` : "还没运行过"}
                    {project.lastUsedAt ? ` · 最近 ${formatRelative(project.lastUsedAt)}` : ""}
                  </span>
                  {desktop ? (
                    <span className="project-card__links">
                      <button type="button" className="link-btn" onClick={() => void desktop.openPath(project.path)}>
                        打开目录
                      </button>
                      <button type="button" className="link-btn" onClick={() => void desktop.openInEditor(project.path)}>
                        用 Cursor 打开
                      </button>
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
