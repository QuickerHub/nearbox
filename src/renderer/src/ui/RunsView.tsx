import { useMemo } from "react";
import { AGENT_LABELS, type HostSnapshot, isRunActive } from "@shared/protocol";
import { formatDuration, formatRelative } from "../lib/format";
import { Icon } from "./Icons";
import { EmptyState, RunStatusPill } from "./bits";

interface RunsViewProps {
  snapshot: HostSnapshot;
  selectedRunId?: string;
  onOpenRun(runId: string): void;
}

export function RunsView({ snapshot, selectedRunId, onOpenRun }: RunsViewProps): JSX.Element {
  const runs = useMemo(
    () =>
      [...snapshot.runs].sort((a, b) => {
        const activeDelta = Number(isRunActive(b)) - Number(isRunActive(a));
        return activeDelta || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }),
    [snapshot.runs],
  );
  const active = runs.filter(isRunActive).length;

  return (
    <section className="screen runs">
      <div className="screen__scroll">
        <div className="inbox__intro">
          <h2>Agent 运行</h2>
          <p className="muted">
            {active ? `${active} 个正在运行或排队。` : "当前没有运行中的 Agent。"}
            同一个项目一次只跑一个，其余排队；电脑最多同时跑 {snapshot.settings.maxConcurrentRuns} 个。
          </p>
        </div>
        {runs.length === 0 ? (
          <EmptyState title="还没有运行记录" body="打开一个任务，点「派给 Agent」。" />
        ) : (
          <div className="run-list">
            {runs.map((run) => {
              const task = snapshot.tasks.find((item) => item.id === run.taskId);
              const project = snapshot.projects.find((item) => item.id === run.projectId);
              return (
                <button
                  key={run.id}
                  type="button"
                  className={run.id === selectedRunId ? "run-row run-row--selected" : "run-row"}
                  onClick={() => onOpenRun(run.id)}
                >
                  <div className="run-row__top">
                    <span className="run-card__agent">
                      <Icon name="bolt" size={13} />
                      {AGENT_LABELS[run.agent]}
                    </span>
                    <RunStatusPill status={run.status} small />
                    <span className="muted small run-row__time">{formatRelative(run.createdAt)}</span>
                  </div>
                  <div className="run-row__title">{task?.title ?? "（任务已删除）"}</div>
                  <div className="run-row__meta muted small">
                    {project ? <span>{project.name}</span> : null}
                    {run.startedAt ? <span>{formatDuration(run.startedAt, run.finishedAt)}</span> : null}
                    {run.resumedFromRunId ? <span>继续对话</span> : null}
                    {run.access === "full" ? <span className="warn-text">完全放开</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
