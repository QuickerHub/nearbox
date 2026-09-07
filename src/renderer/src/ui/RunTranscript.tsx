import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { PendingPermission, RunEvent } from "@shared/protocol";
import { buildTranscript, summarizeTranscript, toolVerb, type WorkRow } from "../lib/runTranscript";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { PermissionAsk, ToolGroupRow, ToolRow } from "./ToolRows";

interface RunTranscriptProps {
  events: RunEvent[];
  active: boolean;
  durationLabel: string;
  /** Context used / window, when the CLI reported it. */
  usageLabel?: string;
  /** The run ended badly; diagnostics open by default. */
  failed: boolean;
  /** The user asked to see the record; start with the work section open. */
  defaultOpen?: boolean;
  pending?: PendingPermission;
  onResolve?(optionId: string): void;
}

/**
 * One agent turn: the collapsible record of what it did, then its answer.
 * While the turn is live the work section stays open and follows along; when
 * it finishes it folds down to a single line, like Cursor does.
 */
export function RunTranscript({ events, active, durationLabel, usageLabel, failed, defaultOpen, pending, onResolve }: RunTranscriptProps): JSX.Element {
  const transcript = useMemo(() => summarizeTranscript(buildTranscript(events)), [events]);
  const { work, answer, toolCount, running } = transcript;
  const busyWith = running.at(-1);
  const attached = Boolean(pending?.toolCallId && workHasTool(work, pending.toolCallId));
  const waiting = Boolean(pending);

  return (
    <div className="turn">
      {work.length || (pending && !attached) ? (
        <WorkFold live={active} waiting={waiting} toolCount={toolCount} durationLabel={durationLabel} usageLabel={usageLabel} failed={failed} defaultOpen={Boolean(defaultOpen)}>
          {pending && !attached && onResolve ? <PermissionAsk pending={pending} onResolve={onResolve} /> : null}
          {work.map((row) => (
            <WorkItem key={`${row.type}-${row.seq}`} row={row} failed={failed} pending={pending} onResolve={onResolve} />
          ))}
        </WorkFold>
      ) : null}

      {answer ? (
        <div className="turn__answer">
          <Markdown text={answer} />
        </div>
      ) : null}

      {active ? (
        <div className="turn__activity">
          <span className="turn__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            {waiting
              ? "等待你确认命令…"
              : busyWith
                ? `${toolVerb(busyWith)} ${busyWith.subject ?? busyWith.command ?? ""}`.trim()
                : answer
                  ? "还在继续…"
                  : "思考中…"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function workHasTool(work: WorkRow[], toolCallId: string): boolean {
  return work.some((row) => {
    if (row.type === "tool") {
      return row.tool.id === toolCallId;
    }
    if (row.type === "tools") {
      return row.tools.some((tool) => tool.id === toolCallId);
    }
    return false;
  });
}

function WorkItem({
  row,
  failed,
  pending,
  onResolve,
}: {
  row: WorkRow;
  failed: boolean;
  pending?: PendingPermission;
  onResolve?(optionId: string): void;
}): JSX.Element | null {
  switch (row.type) {
    case "thinking":
      return <ThinkingRow text={row.text} />;
    case "text":
      return (
        <div className="turn__aside">
          <Markdown text={row.text} />
        </div>
      );
    case "tool":
      return <ToolRow tool={row.tool} pending={pending} onResolve={onResolve} />;
    case "tools":
      return <ToolGroupRow kind={row.kind} tools={row.tools} pending={pending} onResolve={onResolve} />;
    case "status":
      return <div className="turn__status">{row.text}</div>;
    case "stderr":
      return <LinesFold label="命令行诊断输出" lines={row.lines} tone="warn" initiallyOpen={failed} />;
    case "raw":
      return <LinesFold label="未识别的输出" lines={row.lines} tone="muted" initiallyOpen={false} />;
  }
}

function WorkFold({
  live,
  waiting,
  toolCount,
  durationLabel,
  usageLabel,
  failed,
  defaultOpen,
  children,
}: {
  live: boolean;
  waiting: boolean;
  toolCount: number;
  durationLabel: string;
  usageLabel?: string;
  failed: boolean;
  defaultOpen: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(live || failed || defaultOpen);
  // Opened by request: stays put when the turn finishes instead of snapping shut.
  const [pinned, setPinned] = useState(defaultOpen);
  useEffect(() => {
    if (!pinned) {
      setOpen(live || failed);
    }
  }, [live, failed, pinned]);
  const steps = toolCount ? `${toolCount} 步` : "";
  const label = waiting
    ? ["等待确认", steps, durationLabel, usageLabel].filter(Boolean).join(" · ")
    : live
      ? ["正在工作", steps, durationLabel, usageLabel].filter(Boolean).join(" · ")
      : [durationLabel ? `工作了 ${durationLabel}` : "过程", steps, usageLabel].filter(Boolean).join(" · ");
  return (
    <div className={`fold${open ? " is-open" : ""}${live ? " fold--live" : ""}`}>
      <button
        type="button"
        className="fold__head"
        aria-expanded={open}
        onClick={() => {
          setPinned(true);
          setOpen((value) => !value);
        }}
      >
        {live ? <span className="spinner spinner--small fold__spinner" /> : <Icon name="chevron" size={12} className={`fold__chevron${open ? " is-open" : ""}`} />}
        <span className="fold__label">{label}</span>
      </button>
      {open ? <div className="fold__body">{children}</div> : null}
    </div>
  );
}

function ThinkingRow({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const preview = text.replace(/\s+/g, " ").trim();
  return (
    <div className={`trow-wrap${open ? " is-open" : ""}`}>
      <button type="button" className="trow trow--thinking" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="trow__icon">
          <Icon name="brain" size={13} />
        </span>
        <span className="trow__label">思考</span>
        {!open ? <span className="trow__peek">{preview}</span> : null}
        <Icon name="chevron" size={12} className={`trow__chevron${open ? " is-open" : ""}`} />
      </button>
      {open ? <div className="trow__thought">{text.trim() || "…"}</div> : null}
    </div>
  );
}

function LinesFold({ label, lines, tone, initiallyOpen }: { label: string; lines: string[]; tone: "warn" | "muted"; initiallyOpen: boolean }): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className={`trow-wrap${open ? " is-open" : ""}`}>
      <button type="button" className={`trow trow--${tone}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="trow__icon">
          <Icon name={tone === "warn" ? "alert" : "terminal"} size={13} />
        </span>
        <span className="trow__label">{label}</span>
        <span className="trow__peek">{lines.length} 行</span>
        <Icon name="chevron" size={12} className={`trow__chevron${open ? " is-open" : ""}`} />
      </button>
      {open ? <pre className="trow__pre trow__pre--block">{lines.join("\n")}</pre> : null}
    </div>
  );
}
