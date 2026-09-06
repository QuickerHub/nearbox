import { useEffect, useMemo, useState } from "react";
import {
  AGENT_LABELS,
  type AgentAccess,
  type AgentKind,
  type HostSnapshot,
  type Task,
} from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { Icon } from "./Icons";

interface DispatchSheetProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  task: Task;
  onClose(): void;
  onDispatched(runId: string): void;
  onManageProjects(): void;
}

/**
 * Bottom sheet (phone) / modal (desktop) that turns a task into an agent run:
 * pick the agent, the project folder, how much freedom it gets, and review
 * the prompt that will be sent.
 */
export function DispatchSheet({ snapshot, client, task, onClose, onDispatched, onManageProjects }: DispatchSheetProps): JSX.Element {
  const available = snapshot.agents.filter((agent) => agent.available);
  const initialProject =
    task.projectId ??
    [...snapshot.projects].sort((a, b) => Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt))[0]?.id ??
    "";
  const [projectId, setProjectId] = useState(initialProject);
  const project = snapshot.projects.find((item) => item.id === projectId);
  const initialAgent: AgentKind | "" =
    task.agent && available.some((a) => a.kind === task.agent)
      ? task.agent
      : project?.defaultAgent && available.some((a) => a.kind === project.defaultAgent)
        ? project.defaultAgent
        : available[0]?.kind ?? "";
  const [agent, setAgent] = useState<AgentKind | "">(initialAgent);
  const [access, setAccess] = useState<AgentAccess>(agent ? snapshot.settings.agents[agent]?.access ?? "safe" : "safe");
  const [model, setModel] = useState(agent ? snapshot.settings.agents[agent]?.model ?? "" : "");
  const [prompt, setPrompt] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(client.surface === "desktop");

  useEffect(() => {
    if (promptDirty) {
      return;
    }
    let cancelled = false;
    void client.defaultPrompt(task.id, projectId || undefined).then((text) => {
      if (!cancelled) {
        setPrompt(text);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, task.id, projectId, promptDirty]);

  useEffect(() => {
    if (agent) {
      setAccess(snapshot.settings.agents[agent]?.access ?? "safe");
      setModel(snapshot.settings.agents[agent]?.model ?? "");
    }
  }, [agent, snapshot.settings.agents]);

  const busyProject = useMemo(
    () => snapshot.runs.some((run) => run.projectId === projectId && (run.status === "running" || run.status === "queued")),
    [snapshot.runs, projectId],
  );

  const submit = async () => {
    if (!agent || !projectId) {
      setError(!agent ? "请选择一个 Agent。" : "请选择项目目录。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const run = await client.dispatch(task.id, {
        agent,
        projectId,
        access,
        model: model.trim() || undefined,
        prompt: promptDirty ? prompt : undefined,
      });
      onDispatched(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="sheet__head">
          <div>
            <p className="eyebrow">派给 Agent</p>
            <h2>{task.title}</h2>
          </div>
          <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} title="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="sheet__body">
          <div className="field">
            <span className="label">Agent</span>
            {available.length === 0 ? (
              <p className="alert">
                这台电脑上还没检测到任何 Agent CLI。请先安装并登录 cursor-agent / codex / grok 之一，然后到「设置」里点「重新检测」。
              </p>
            ) : (
              <div className="choice-row">
                {snapshot.agents.map((info) => (
                  <button
                    key={info.kind}
                    type="button"
                    className={info.kind === agent ? "choice choice--on" : "choice"}
                    disabled={!info.available}
                    title={info.available ? info.command : info.detail}
                    onClick={() => setAgent(info.kind)}
                  >
                    <Icon name="bolt" size={13} />
                    {AGENT_LABELS[info.kind]}
                    {!info.available ? <span className="choice__sub">未安装</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <div className="field__row">
              <span className="label">项目目录</span>
              <button type="button" className="link-btn" onClick={onManageProjects}>
                管理项目
              </button>
            </div>
            {snapshot.projects.length === 0 ? (
              <p className="alert">还没有登记项目目录。到「项目」里添加电脑上的代码文件夹后再派发。</p>
            ) : (
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">选择项目…</option>
                {snapshot.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.path}
                  </option>
                ))}
              </select>
            )}
            {busyProject ? <p className="muted small">这个项目已经有 Agent 在跑，新任务会排队等它结束。</p> : null}
          </div>

          <div className="field">
            <span className="label">权限</span>
            <div className="choice-row">
              <button type="button" className={access === "safe" ? "choice choice--on" : "choice"} onClick={() => setAccess("safe")}>
                安全模式
                <span className="choice__sub">只改项目内文件，危险命令会被拦</span>
              </button>
              <button type="button" className={access === "full" ? "choice choice--on choice--warn" : "choice"} onClick={() => setAccess("full")}>
                完全放开
                <span className="choice__sub">任何命令都直接执行</span>
              </button>
            </div>
          </div>

          <details className="field field--details" open={showPrompt} onToggle={(event) => setShowPrompt((event.target as HTMLDetailsElement).open)}>
            <summary className="label">发给 Agent 的完整提示{promptDirty ? "（已手动修改）" : ""}</summary>
            <textarea
              className="prompt-editor"
              rows={10}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setPromptDirty(true);
              }}
            />
            <div className="field__row">
              <input value={model} placeholder="模型（留空用默认）" onChange={(event) => setModel(event.target.value)} />
              {promptDirty ? (
                <button type="button" className="link-btn" onClick={() => setPromptDirty(false)}>
                  恢复自动生成
                </button>
              ) : null}
            </div>
          </details>
        </div>

        {error ? <p className="alert sheet__error">{error}</p> : null}
        <footer className="sheet__foot">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" disabled={busy || !agent || !projectId} onClick={() => void submit()}>
            <Icon name="play" size={14} />
            {busy ? "派发中…" : busyProject ? "加入队列" : "开始运行"}
          </button>
        </footer>
      </div>
    </div>
  );
}
