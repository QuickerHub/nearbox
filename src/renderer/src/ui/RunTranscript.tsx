import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { RunEvent } from "@shared/protocol";
import { buildTranscript, summarizeTranscript, toolVerb, type WorkRow } from "../lib/runTranscript";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { ToolGroupRow, ToolRow } from "./ToolRows";

interface RunTranscriptProps {
  events: RunEvent[];
  active: boolean;
  durationLabel: string;
  /** The run ended badly; diagnostics open by default. */
  failed: boolean;
  /** The user asked to see the record; start with the work section open. */
  defaultOpen?: boolean;
}

/**
 * One agent turn: the collapsible record of what it did, then its answer.
 * While the turn is live the work section stays open and follows along; when
 * it finishes it folds down to a single line, like Cursor does.
 */
export function RunTranscript({ events, active, durationLabel, failed, defaultOpen }: RunTranscriptProps): JSX.Element {
  const transcript = useMemo(() => summarizeTranscript(buildTranscript(events)), [events]);
  const { work, answer, toolCount, running } = transcript;
  const busyWith = running.at(-1);

  return (
    <div className="turn">
      {work.length ? (
        <WorkFold live={active} toolCount={toolCount} durationLabel={durationLabel} failed={failed} defaultOpen={Boolean(defaultOpen)}>
          {work.map((row) => (
            <WorkItem key={`${row.type}-${row.seq}`} row={row} failed={failed} />
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
          <span>{busyWith ? `${toolVerb(busyWith)} ${busyWith.subject ?? busyWith.command ?? ""}`.trim() : answer ? "还在继续…" : "思考中…"}</span>
        </div>
      ) : null}
    </div>
  );
}

function WorkItem({ row, failed }: { row: WorkRow; failed: boolean }): JSX.Element | null {
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
      return <ToolRow tool={row.tool} />;
    case "tools":
      return <ToolGroupRow kind={row.kind} tools={row.tools} />;
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
  toolCount,
  durationLabel,
  failed,
  defaultOpen,
  children,
}: {
  live: boolean;
  toolCount: number;
  durationLabel: string;
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
  const label = live ? ["正在工作", steps, durationLabel].filter(Boolean).join(" · ") : [durationLabel ? `工作了 ${durationLabel}` : "过程", steps].filter(Boolean).join(" · ");
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
