import { useEffect, useRef, useState } from "react";
import {
  AGENT_LABELS,
  type AgentRun,
  type HostSnapshot,
  isRunActive,
  type RunEvent,
} from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatDuration, formatTime } from "../lib/format";
import { Composer } from "./Composer";
import { Icon } from "./Icons";
import { RunTranscript } from "./RunTranscript";
import { RunStatusPill, ScreenHeader } from "./bits";

interface RunViewProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  run: AgentRun;
  onBack(): void;
  onOpenTask(taskId: string): void;
  onOpenRun(runId: string): void;
  embedded?: boolean;
}

/** Live log of one agent run. Events arrive over the WebSocket after an initial catch-up fetch. */
export function RunView({ snapshot, client, run, onBack, onOpenTask, onOpenRun, embedded }: RunViewProps): JSX.Element {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [, setTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const task = snapshot.tasks.find((item) => item.id === run.taskId);
  const project = snapshot.projects.find((item) => item.id === run.projectId);
  const active = isRunActive(run);
  const agentInfo = snapshot.agents.find((item) => item.kind === run.agent);
  const followUps = snapshot.runs.filter((item) => item.resumedFromRunId === run.id);

  useEffect(() => {
    let disposed = false;
    let lastSeq = 0;
    let buffered: RunEvent[] = [];
    let caughtUp = false;
    setEvents([]);

    const unsubscribe = client.subscribeRun(run.id, (event) => {
      if (disposed) {
        return;
      }
      if (!caughtUp) {
        buffered.push(event);
        return;
      }
      if (event.seq > lastSeq) {
        lastSeq = event.seq;
        setEvents((current) => [...current, event]);
      }
    });
    void client
      .runEvents(run.id, 0)
      .then((history) => {
        if (disposed) {
          return;
        }
        lastSeq = history[history.length - 1]?.seq ?? 0;
        const merged = [...history, ...buffered.filter((event) => event.seq > lastSeq)];
        lastSeq = merged[merged.length - 1]?.seq ?? lastSeq;
        buffered = [];
        caughtUp = true;
        setEvents(merged);
      })
      .catch(() => {
        caughtUp = true;
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, run.id]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (autoScroll && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  const durationLabel = run.startedAt ? formatDuration(run.startedAt, run.finishedAt) : "";

  return (
    <section className={embedded ? "screen run-view detail--embedded" : "screen run-view"}>
      <ScreenHeader
        onBack={embedded ? undefined : onBack}
        title={
          <span className="run-view__title">
            <Icon name="bolt" size={15} />
            {AGENT_LABELS[run.agent]}
            <RunStatusPill status={run.status} small />
          </span>
        }
        subtitle={
          <>
            <button type="button" className="link-btn" onClick={() => onOpenTask(run.taskId)}>
              {task?.title ?? "（任务已删除）"}
            </button>
            {project ? ` · ${project.name}` : ""}
            {run.startedAt ? ` · ${formatDuration(run.startedAt, run.finishedAt)}` : " · 等待开始"}
            {run.access === "full" ? " · 完全放开" : ""}
          </>
        }
        actions={
          active ? (
            <button type="button" className="ghost ghost--danger" onClick={() => void client.cancelRun(run.id)}>
              <Icon name="stop" size={13} />
              停止
            </button>
          ) : null
        }
      />

      <div className="run-view__tools">
        <button type="button" className={autoScroll ? "toggle toggle--on" : "toggle"} onClick={() => setAutoScroll((value) => !value)}>
          自动滚动
        </button>
        {run.sessionId ? <span className="muted small run-view__session">会话 {run.sessionId.slice(0, 8)}</span> : null}
      </div>

      <div
        className="screen__scroll run-scroll"
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          if (atBottom !== autoScroll) {
            setAutoScroll(atBottom);
          }
        }}
      >
        <RunTranscript
          events={events}
          prompt={run.prompt}
          active={active}
          durationLabel={durationLabel}
          error={run.status === "failed" ? run.error : undefined}
        />
        {followUps.length ? (
          <div className="log__followups">
            {followUps.map((item) => (
              <button key={item.id} type="button" className="link-btn" onClick={() => onOpenRun(item.id)}>
                <Icon name="reply" size={13} /> 继续对话 · {formatTime(item.createdAt)} · <RunStatusPill status={item.status} small />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!active && run.sessionId && agentInfo?.supportsResume ? (
        <Composer
          surface={client.surface}
          compact
          placeholder={`继续和 ${AGENT_LABELS[run.agent]} 对话，比如「再补一下测试」…`}
          onSubmit={async (text) => {
            const next = await client.replyRun(run.id, text);
            onOpenRun(next.id);
          }}
        />
      ) : null}
    </section>
  );
}
