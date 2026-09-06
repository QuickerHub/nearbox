import { useEffect, useState } from "react";
import { AGENT_LABELS, type AgentRun, isRunActive, type RunEvent } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatDuration, formatRelative } from "../lib/format";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { RunTranscript } from "./RunTranscript";
import { RunStatusPill } from "./bits";

interface RunBlockProps {
  run: AgentRun;
  client: ClientHandle;
  onStop(runId: string): void;
  /** Show the full transcript right away (used for the newest run). */
  initiallyOpen?: boolean;
}

/**
 * One agent run inside a task thread. While it runs, events stream in live;
 * afterwards it folds down to the agent's final answer with a toggle to see
 * everything it did.
 */
export function RunBlock({ run, client, onStop, initiallyOpen }: RunBlockProps): JSX.Element {
  const active = isRunActive(run);
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
    if (!open) {
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
  }, [client, run.id, open]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const duration = run.startedAt ? formatDuration(run.startedAt, run.finishedAt) : "";
  const summary = run.status === "succeeded" ? run.summary : run.error ?? run.summary;

  return (
    <article className={`run-block run-block--${run.status}`}>
      {run.resumedFromRunId ? (
        <div className="bubble bubble--user">
          <div className="bubble__head">
            <span>{run.requestedBy.name}</span>
            <span className="muted">{formatRelative(run.createdAt)}</span>
          </div>
          <Markdown text={run.prompt} className="bubble__text" />
        </div>
      ) : null}

      <div className="run-block__head">
        <span className="run-block__agent">
          <Icon name="bolt" size={13} />
          {AGENT_LABELS[run.agent]}
        </span>
        <RunStatusPill status={run.status} small />
        <span className="muted small run-block__meta">
          {run.resumedFromRunId ? "继续对话" : `${run.requestedBy.name} 派发`} · {formatRelative(run.createdAt)}
          {duration ? ` · ${duration}` : ""}
          {run.access === "full" ? " · 完全放开" : ""}
        </span>
        <span className="run-block__spacer" />
        {!run.resumedFromRunId ? (
          <button type="button" className="link-btn link-btn--muted" onClick={() => setShowPrompt((value) => !value)}>
            {showPrompt ? "收起提示" : "看提示"}
          </button>
        ) : null}
        {active ? (
          <button type="button" className="link-btn link-btn--danger" onClick={() => onStop(run.id)}>
            <Icon name="stop" size={11} />
            停止
          </button>
        ) : (
          <button type="button" className="link-btn link-btn--muted" onClick={() => setOpen((value) => !value)}>
            {open ? "收起过程" : "看过程"}
          </button>
        )}
      </div>

      {showPrompt ? <pre className="run-block__prompt">{run.prompt}</pre> : null}

      {open ? (
        events === null ? (
          <p className="muted small run-block__loading">正在读取记录…</p>
        ) : (
          <RunTranscript events={events} prompt="" active={active} durationLabel={duration} error={run.status === "failed" ? run.error : undefined} />
        )
      ) : summary ? (
        <div className={`run-block__summary${run.status === "succeeded" ? "" : " run-block__summary--err"}`}>
          <Markdown text={summary} />
        </div>
      ) : (
        <p className="muted small run-block__loading">{run.status === "cancelled" ? "已停止，没有输出。" : "没有记录到输出。"}</p>
      )}
    </article>
  );
}
