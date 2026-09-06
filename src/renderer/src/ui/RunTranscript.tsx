import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RunEvent } from "@shared/protocol";
import {
  buildTranscript,
  fileActionLabel,
  isNoisyStatus,
  splitWork,
  type ParsedTool,
  type TranscriptItem,
} from "../lib/runTranscript";
import { Markdown } from "./Markdown";

interface RunTranscriptProps {
  events: RunEvent[];
  prompt: string;
  active: boolean;
  durationLabel: string;
  error?: string;
}

export function RunTranscript({ events, prompt, active, durationLabel, error }: RunTranscriptProps): JSX.Element {
  const items = useMemo(() => buildTranscript(events), [events]);
  const { work, summary, trailing, toolCount } = useMemo(() => splitWork(items), [items]);
  const runningTool = [...items].reverse().find((item) => item.type === "tool" && item.tool.status === "running");

  return (
    <div className="run-chat">
      {prompt.trim() ? <UserBubble text={prompt} /> : null}

      {work.length ? (
        <WorkFold streaming={active} toolCount={toolCount} durationLabel={durationLabel}>
          {work.map((item) => (
            <TranscriptPart key={`${item.type}-${item.seq}`} item={item} />
          ))}
        </WorkFold>
      ) : null}

      {summary.map((item) => (
        <TranscriptPart key={`${item.type}-${item.seq}`} item={item} />
      ))}

      {trailing.map((item) => (
        <TranscriptPart key={`${item.type}-${item.seq}`} item={item} />
      ))}

      {error ? <div className="run-stderr">{error}</div> : null}

      {active ? (
        <div className="run-activity">
          <span className="run-activity__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>{runningTool && runningTool.type === "tool" ? `${runningTool.tool.name}…` : "思考中…"}</span>
        </div>
      ) : null}

      {!events.length && !active ? <p className="muted run-chat__empty">没有记录到输出。</p> : null}
    </div>
  );
}

function TranscriptPart({ item }: { item: TranscriptItem }): JSX.Element | null {
  switch (item.type) {
    case "thinking":
      return <ReasoningRow text={item.text} />;
    case "tool":
      return item.tool.kind === "shell" ? <ShellToolRow tool={item.tool} /> : <ToolCallRow tool={item.tool} />;
    case "text":
      return (
        <div className="run-msg run-msg--assistant">
          <Markdown text={item.text} />
        </div>
      );
    case "status":
      return isNoisyStatus(item.text) ? null : <div className="run-status">{item.text}</div>;
    case "stderr":
      return <div className="run-stderr">{item.text}</div>;
    case "raw":
      return <RawRow text={item.text} />;
    case "result":
      return <div className={item.error ? "run-result run-result--err" : "run-result"}>{item.text}</div>;
  }
}

function UserBubble({ text }: { text: string }): JSX.Element {
  const long = text.length > 220 || text.split("\n").length > 4;
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={`run-msg run-msg--user${long && !open ? " run-msg--clamp" : ""}`} onClick={() => long && setOpen((value) => !value)}>
      <span>{text}</span>
    </button>
  );
}

function WorkFold({
  streaming,
  toolCount,
  durationLabel,
  children,
}: {
  streaming: boolean;
  toolCount: number;
  durationLabel: string;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);
  const label = streaming
    ? `工作中${durationLabel ? ` ${durationLabel}` : ""} · ${toolCount} 个工具`
    : `工作了${durationLabel ? ` ${durationLabel}` : ""} · ${toolCount} 个工具`;
  return (
    <div className={`work-fold${open ? " work-fold--open" : ""}${streaming ? " work-fold--live" : ""}`}>
      <button type="button" className="work-fold__summary" aria-expanded={open} onClick={() => !streaming && setOpen((value) => !value)}>
        <span className="work-fold__chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="work-fold__label">{label}</span>
      </button>
      {open ? <div className="work-fold__body">{children}</div> : null}
    </div>
  );
}

function ReasoningRow({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-card reasoning-card${open ? " is-open" : ""}`}>
      <div className="tool-header">
        <button type="button" className="tool-header__main" onClick={() => setOpen((value) => !value)}>
          <span className="tool-title">
            <span className="tool-name">思考</span>
          </span>
        </button>
        <span className={`tool-chevron${open ? " is-open" : ""}`} aria-hidden />
      </div>
      {open ? <pre className="reasoning-body">{text.trim() || "…"}</pre> : null}
    </div>
  );
}

function ToolCallRow({ tool }: { tool: ParsedTool }): JSX.Element {
  const [open, setOpen] = useState(tool.status === "error");
  const expandable = Boolean(tool.detail || tool.output);
  const file = tool.kind === "file" && tool.meta;
  return (
    <div className={`tool-card tool-${tool.status}${open ? " is-open" : ""}`}>
      <div className="tool-header">
        <button type="button" className="tool-header__main" onClick={() => expandable && setOpen((value) => !value)} disabled={!expandable}>
          {file ? (
            <span className="tool-title tool-title--file">
              <span className="tool-file-action">{fileActionLabel(tool.rawName, tool.status)}</span>
              <span className="tool-file-path">{tool.meta}</span>
            </span>
          ) : (
            <span className="tool-title">
              <span className="tool-name">{tool.name}</span>
              {tool.meta ? <span className={`tool-meta${tool.status === "error" ? " tool-meta--err" : ""}`}>{tool.meta}</span> : null}
            </span>
          )}
        </button>
        <span className={`tool-badge tool-badge--${tool.status}`}>{statusLabel(tool)}</span>
        {expandable ? <span className={`tool-chevron${open ? " is-open" : ""}`} aria-hidden /> : null}
      </div>
      {open && expandable ? <pre className="tool-detail">{tool.output || tool.detail}</pre> : null}
    </div>
  );
}

function ShellToolRow({ tool }: { tool: ParsedTool }): JSX.Element {
  const failed = tool.status === "error";
  const [open, setOpen] = useState(failed || tool.status === "running");
  const output = tool.output?.replace(/\s+$/, "") ?? "";
  const lines = output ? output.split("\n") : [];
  const preview = lines.length > 8 ? lines.slice(-8).join("\n") : output;
  const truncated = lines.length > 8 && !open;
  return (
    <div className={`tool-card tool-card--shell tool-${tool.status}${open ? " is-open" : ""}`}>
      <button type="button" className={`shell-terminal${failed ? " shell-terminal--err" : ""}${tool.status === "running" ? " shell-terminal--live" : ""}`} onClick={() => setOpen((value) => !value)}>
        <div className="shell-terminal__title">
          <span className="shell-terminal__glyph">{">_"}</span>
          <span className="shell-terminal__label">{tool.command || tool.name}</span>
          <span className={`tool-badge tool-badge--${tool.status}`}>{statusLabel(tool)}</span>
        </div>
        {(open || tool.status === "running") && (tool.command || output) ? (
          <div className="shell-terminal__pane">
            {tool.command ? (
              <div className="shell-terminal__command">
                <span className="shell-terminal__prompt">$</span>
                <span className="shell-terminal__command-text">{tool.command}</span>
              </div>
            ) : null}
            {output ? <pre className={`shell-terminal__output${failed ? " shell-terminal__output--err" : ""}`}>{truncated ? preview : output}</pre> : null}
            {tool.status === "running" ? <div className="shell-terminal__cursor" /> : null}
          </div>
        ) : null}
      </button>
    </div>
  );
}

function RawRow({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-card${open ? " is-open" : ""}`}>
      <div className="tool-header">
        <button type="button" className="tool-header__main" onClick={() => setOpen((value) => !value)}>
          <span className="tool-title">
            <span className="tool-name">原始输出</span>
            {!open ? <span className="tool-meta">{text.slice(0, 48)}</span> : null}
          </span>
        </button>
        <span className={`tool-chevron${open ? " is-open" : ""}`} aria-hidden />
      </div>
      {open ? <pre className="tool-detail">{text}</pre> : null}
    </div>
  );
}

function statusLabel(tool: ParsedTool): string {
  if (tool.status === "running") {
    return "进行中";
  }
  if (tool.status === "error") {
    return tool.exitCode !== undefined ? `失败 ${tool.exitCode}` : "失败";
  }
  if (tool.kind === "shell") {
    return tool.exitCode === 0 ? "成功" : "完成";
  }
  return "完成";
}
