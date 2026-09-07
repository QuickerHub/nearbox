import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import {
  collectDockTerminals,
  type DockTerminal,
  dockStatusLabel,
  formatTerminalDuration,
  isLiveTerminal,
  lastOutputLine,
  terminalTitle,
} from "../lib/liveTerminals";
import { useRunEvents } from "../lib/useRunEvents";
import { Icon } from "./Icons";
import { PermissionAsk } from "./ToolRows";

interface TerminalDockProps {
  client: ClientHandle;
  run: AgentRun;
  onStop?(): void;
}

/**
 * Live shells parked above the composer, the way Cursor / Quicker keep the
 * current terminal in sight. The bar always says what is going on (运行中 /
 * 等待确认 / 已完成); open a row to read the tail.
 */
export function TerminalDock({ client, run, onStop }: TerminalDockProps): JSX.Element | null {
  const events = useRunEvents(client, run.id, run.status !== "queued");
  const terminals = useMemo(
    () => collectDockTerminals(events ?? [], run.pendingPermission, run.startedAt),
    [events, run.pendingPermission, run.startedAt],
  );
  const live = terminals.filter(isLiveTerminal);
  const visible = run.status === "running" || live.length > 0 ? terminals : [];
  const waiting = Boolean(run.pendingPermission);
  const [expanded, setExpanded] = useState(waiting);
  const [openId, setOpenId] = useState<string | null>(run.pendingPermission?.toolCallId ?? null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (waiting) {
      setExpanded(true);
      setOpenId(run.pendingPermission?.toolCallId ?? null);
    }
  }, [waiting, run.pendingPermission?.toolCallId]);

  useEffect(() => {
    if (!live.length) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [live.length]);

  if (visible.length === 0) {
    return null;
  }

  const lead = live[0] ?? visible[0]!;
  const countLabel = live.length ? `${live.length} 个终端` : `${visible.length} 个终端`;
  const leadStatus = dockStatusLabel(lead);
  const leadDuration = durationOf(lead);

  return (
    <section className={`term-dock${expanded ? " is-expanded" : ""}`} aria-label={`终端 ${countLabel}`}>
      <div className="term-dock__bar">
        <button type="button" className="term-dock__header" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <Icon name="chevron" size={12} className={`term-dock__chevron${expanded ? " is-open" : ""}`} />
          <span className={`term-dock__dot term-dock__dot--${lead.status}`} aria-hidden />
          <span className="term-dock__count">{countLabel}</span>
          <span className={`term-dock__status term-dock__status--${lead.status}`}>{leadStatus}</span>
          {leadDuration ? <span className="term-dock__duration">{leadDuration}</span> : null}
          <span className="term-dock__lead" title={lead.command}>
            {terminalTitle(lead)}
            {live.length > 1 ? ` +${live.length - 1}` : ""}
          </span>
        </button>
        {live.length && onStop ? (
          <button type="button" className="term-dock__stop" onClick={onStop} title="停止当前运行">
            停止
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="term-dock__list">
          {visible.map((terminal) => (
            <TerminalRow
              key={terminal.id}
              terminal={terminal}
              open={openId === terminal.id}
              pending={run.pendingPermission?.toolCallId === terminal.id ? run.pendingPermission : undefined}
              onToggle={() => setOpenId((current) => (current === terminal.id ? null : terminal.id))}
              onResolve={(optionId) => void client.resolvePermission(run.id, optionId)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TerminalRow({
  terminal,
  open,
  pending,
  onToggle,
  onResolve,
}: {
  terminal: DockTerminal;
  open: boolean;
  pending?: AgentRun["pendingPermission"];
  onToggle(): void;
  onResolve(optionId: string): void;
}): JSX.Element {
  const outputRef = useRef<HTMLPreElement>(null);
  const output = terminal.output?.replace(/\s+$/, "") ?? "";
  const body = output || terminal.error;
  const preview = lastOutputLine(output) || terminal.error;
  const duration = durationOf(terminal);
  const running = terminal.status === "running";

  useEffect(() => {
    if (open && running && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [open, output, running]);

  return (
    <li className={`term-dock__item term-dock__item--${terminal.status}${open ? " is-open" : ""}`}>
      <div className="term-dock__row">
        <button type="button" className="term-dock__summary" aria-expanded={open} onClick={onToggle} title={terminal.command}>
          <span className={`term-dock__dot term-dock__dot--${terminal.status}`} aria-hidden />
          <span className="term-dock__name">{terminalTitle(terminal)}</span>
          {!open && preview ? <span className="term-dock__preview">{preview}</span> : null}
          <span className="term-dock__meta">
            <span className={`term-dock__status term-dock__status--${terminal.status}`}>{dockStatusLabel(terminal)}</span>
            {duration ? <span className="term-dock__duration">{duration}</span> : null}
          </span>
        </button>
      </div>
      {pending ? <PermissionAsk pending={pending} onResolve={onResolve} /> : null}
      {open && body ? (
        <div className="term-dock__body">
          {output ? (
            <pre ref={outputRef} className={`term-dock__output${terminal.status === "error" ? " term-dock__output--err" : ""}`}>
              {output}
              {running ? <span className="shell__cursor" /> : null}
            </pre>
          ) : null}
          {!output && terminal.error ? <div className={`shell__note${terminal.status === "rejected" ? " shell__note--warn" : " shell__note--err"}`}>{terminal.error}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

function durationOf(terminal: DockTerminal): string {
  if (isLiveTerminal(terminal)) {
    return formatTerminalDuration(terminal.startedAt);
  }
  return formatTerminalDuration(terminal.startedAt, terminal.updatedAt);
}
