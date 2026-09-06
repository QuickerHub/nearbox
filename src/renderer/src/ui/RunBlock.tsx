import { useEffect, useState } from "react";
import { AGENT_LABELS, type AgentKind, type AgentRun, isRunActive, type RunEvent } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatDuration, formatRelative } from "../lib/format";
import { FileStrip } from "./Attachments";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { RunTranscript } from "./RunTranscript";

interface RunBlockProps {
  run: AgentRun;
  client: ClientHandle;
  /** This run starts a new agent conversation rather than continuing the previous one. */
  opensConversation: boolean;
  /** Set for a sub-run: the agent that handed this work over with `nearbox ask`. */
  delegatedFrom?: AgentKind;
  projectName?: string;
  onStop(runId: string): void;
  /** Load and show the full record right away (used for the newest run). */
  initiallyOpen?: boolean;
}

/**
 * One turn of the conversation: the message that started it (or the hand-off
 * line when a new conversation opens), then the agent's work and answer.
 */
export function RunBlock({ run, client, opensConversation, delegatedFrom, projectName, onStop, initiallyOpen }: RunBlockProps): JSX.Element {
  const active = isRunActive(run);
  const queued = run.status === "queued";
  const [open, setOpen] = useState(active || Boolean(initiallyOpen));
  // Set when the user asked to see the record, so the fold opens as soon as it loads instead of needing a second click.
  const [expanded, setExpanded] = useState(false);
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
  // A generated prompt hides behind "提示词"; what the user typed (or attached) is always a bubble.
  const typed = run.message !== undefined || Boolean(run.attachments?.length);

  const delegated = run.parentRunId !== undefined;

  return (
    <article className={`run run--${run.status}${delegated ? " run--delegated" : ""}`}>
      {opensConversation ? (
        <div className="handoff">
          <span className="handoff__line" />
          <span className="handoff__text">
            <Icon name={delegated ? "bot" : "bolt"} size={12} />
            {delegated ? (
              <strong title="这一段是上面的 Agent 用 nearbox ask 委派出去的子任务，回答会直接交还给它">
                {delegatedFrom ? AGENT_LABELS[delegatedFrom] : "上级 Agent"} 委派给 {AGENT_LABELS[run.agent]}
              </strong>
            ) : (
              <strong>{AGENT_LABELS[run.agent]}</strong>
            )}
            {run.modelLabel || run.model ? (
              <span className="handoff__dim" title={run.model ? `--model ${run.model}` : undefined}>
                {run.modelLabel ?? run.model}
              </span>
            ) : null}
            {projectName ? <span>{projectName}</span> : null}
            <span>{run.access === "full" ? "完全放开" : "安全模式"}</span>
            <span className="handoff__dim">{formatRelative(run.createdAt)}</span>
            <button type="button" className="handoff__btn" onClick={() => setShowPrompt((value) => !value)}>
              {showPrompt ? "收起提示词" : "提示词"}
            </button>
          </span>
          <span className="handoff__line" />
        </div>
      ) : null}
      {!opensConversation || typed ? (
        <div className="bubble bubble--user">
          <div className="bubble__head">
            <span>{run.requestedBy.name}</span>
            <span className="muted">{formatRelative(run.createdAt)}</span>
          </div>
          {run.attachments?.length ? <FileStrip files={run.attachments} client={client} /> : null}
          {/* The user's words; `prompt` additionally lists the file paths for the agent. */}
          {(run.message ?? run.prompt) ? <Markdown text={run.message ?? run.prompt} className="bubble__text" /> : null}
        </div>
      ) : null}

      {showPrompt ? <pre className="run__prompt">{run.prompt}</pre> : null}

      {queued ? (
        <div className="run__queued">
          <span className="spinner spinner--small" />
          <span>{delegated ? "排队中，等其他运行让出位置" : "排队中，等上一轮结束后发送"}</span>
          <button type="button" className="link-btn link-btn--muted" onClick={() => onStop(run.id)}>
            撤回
          </button>
        </div>
      ) : open ? (
        events === null ? (
          <button type="button" className="fold__head fold__head--lazy" disabled>
            <span className="spinner spinner--small fold__spinner" />
            <span className="fold__label">正在读取记录…</span>
          </button>
        ) : (
          <RunTranscript events={events} active={active} durationLabel={duration} failed={failed} defaultOpen={expanded} />
        )
      ) : (
        <>
          {run.startedAt ? (
            <button
              type="button"
              className="fold__head fold__head--lazy"
              onClick={() => {
                setExpanded(true);
                setOpen(true);
              }}
            >
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
    </article>
  );
}
