import { useEffect, useState } from "react";
import { AGENT_LABELS, type AgentRun, isRunActive, type RunEvent } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatDuration, formatRelative } from "../lib/format";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { RunTranscript } from "./RunTranscript";

interface RunBlockProps {
  run: AgentRun;
  client: ClientHandle;
  /** This run starts a new agent conversation rather than continuing the previous one. */
  opensConversation: boolean;
  projectName?: string;
  onStop(runId: string): void;
  /** Load and show the full record right away (used for the newest run). */
  initiallyOpen?: boolean;
}

/**
 * One turn of the conversation: the message that started it (or the hand-off
 * line when a new conversation opens), then the agent's work and answer.
 */
export function RunBlock({ run, client, opensConversation, projectName, onStop, initiallyOpen }: RunBlockProps): JSX.Element {
  const active = isRunActive(run);
  const queued = run.status === "queued";
  const [open, setOpen] = useState(active || Boolean(initiallyOpen));
  const [showPrompt, setShowPrompt] = useState(false);
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (active) {
      setOpen(true);
    }
  }, [active]);

  useEffect(() => {
    if (!open || queued) {
      return;
    }
    let disposed = false;
    let lastSeq = 0;
    let buffered: RunEvent[] = [];
    let caughtUp = false;
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
        setEvents((current) => [...(current ?? []), event]);
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
        setEvents((current) => current ?? []);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, run.id, open, queued]);

  useEffect(() => {
    if (run.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [run.status]);

  const duration = run.startedAt ? formatDuration(run.startedAt, run.finishedAt) : "";
  const failed = run.status === "failed";
  // A failure whose "answer" is the error text is shown once, in the outcome line.
  const answer = run.summary && run.summary !== run.error ? run.summary : undefined;

  return (
    <article className={`run run--${run.status}`}>
      {opensConversation ? (
        <div className="handoff">
          <span className="handoff__line" />
          <span className="handoff__text">
            <Icon name="bolt" size={12} />
            <strong>{AGENT_LABELS[run.agent]}</strong>
            {run.modelLabel ? <span className="handoff__dim">{run.modelLabel}</span> : null}
            {projectName ? <span>{projectName}</span> : null}
            <span>{run.access === "full" ? "完全放开" : "安全模式"}</span>
            <span className="handoff__dim">{formatRelative(run.createdAt)}</span>
            <button type="button" className="handoff__btn" onClick={() => setShowPrompt((value) => !value)}>
              {showPrompt ? "收起提示词" : "提示词"}
            </button>
          </span>
          <span className="handoff__line" />
        </div>
      ) : (
        <div className="bubble bubble--user">
          <div className="bubble__head">
            <span>{run.requestedBy.name}</span>
            <span className="muted">{formatRelative(run.createdAt)}</span>
          </div>
          <Markdown text={run.prompt} className="bubble__text" />
        </div>
      )}

      {showPrompt ? <pre className="run__prompt">{run.prompt}</pre> : null}

      {queued ? (
        <div className="run__queued">
          <span className="spinner spinner--small" />
          <span>排队中，等上一轮结束后发送</span>
          <button type="button" className="link-btn link-btn--muted" onClick={() => onStop(run.id)}>
            撤回
          </button>
        </div>
      ) : open ? (
        events === null ? (
          <p className="muted small run__loading">正在读取记录…</p>
        ) : (
          <RunTranscript events={events} active={active} durationLabel={duration} failed={failed} />
        )
      ) : (
        <>
          {run.startedAt ? (
            <button type="button" className="fold__head fold__head--lazy" onClick={() => setOpen(true)}>
              <Icon name="chevron" size={12} className="fold__chevron" />
              <span className="fold__label">{duration ? `工作了 ${duration}` : "过程"}</span>
            </button>
          ) : null}
          {answer ? (
            <div className="turn__answer">
              <Markdown text={answer} />
            </div>
          ) : null}
        </>
      )}

      {failed ? (
        <div className="run__outcome run__outcome--err">
          <Icon name="alert" size={13} />
          <span>{run.error ?? "运行失败"}</span>
        </div>
      ) : run.status === "cancelled" ? (
        <div className="run__outcome muted">
          <Icon name="stop" size={11} />
          <span>{run.error && run.error !== "已取消" ? run.error : "已停止"}</span>
        </div>
      ) : null}

      {run.status === "running" ? (
        <div className="run__tools">
          <button type="button" className="link-btn link-btn--danger" onClick={() => onStop(run.id)}>
            <Icon name="stop" size={11} />
            停止
          </button>
        </div>
      ) : null}
    </article>
  );
}
