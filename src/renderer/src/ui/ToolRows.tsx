import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { PendingPermission, ToolCall, ToolKind } from "@shared/protocol";
import { diffLines, displayTool, groupLabel, hasDetail, isFailed, prettyToolName, statusLabel, toolVerb } from "../lib/runTranscript";
import { Icon, TOOL_ICONS } from "./Icons";

interface AskProps {
  pending?: PendingPermission;
  onResolve?(optionId: string): void;
}

/**
 * Tool calls the way Cursor shows them: one quiet line per call that opens
 * into its details, terminals as small cards, edits with a diff, and runs of
 * lookups folded into a single "读取了 4 个文件".
 */
export function ToolRow({ tool: recorded, pending, onResolve }: { tool: ToolCall } & AskProps): JSX.Element {
  const tool = useMemo(() => displayTool(recorded), [recorded]);
  if (tool.kind === "shell") {
    return <ShellCard tool={tool} pending={pending} onResolve={onResolve} />;
  }
  if (tool.kind === "edit" || tool.kind === "write" || tool.kind === "delete") {
    return <FileChangeRow tool={tool} />;
  }
  return <GenericRow tool={tool} />;
}

export function ToolGroupRow({ kind, tools, pending, onResolve }: { kind: ToolKind; tools: ToolCall[] } & AskProps): JSX.Element {
  const waiting = Boolean(pending && tools.some((tool) => tool.id === pending.toolCallId));
  const [open, setOpen] = useState(waiting);
  useEffect(() => {
    if (waiting) {
      setOpen(true);
    }
  }, [waiting]);
  const running = tools.some((tool) => tool.status === "running");
  const failed = tools.filter((tool) => isFailed(tool.status)).length;
  return (
    <div className={`trow-group${open ? " is-open" : ""}`}>
      <button type="button" className="trow" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <RowIcon kind={kind} running={running} failed={failed > 0} />
        <span className="trow__label">{waiting ? "等待确认命令" : groupLabel(kind, tools.length, running)}</span>
        {!open ? <span className="trow__peek">{tools.map((tool) => tool.subject).filter(Boolean).join("、")}</span> : null}
        {failed ? <span className="trow__status trow__status--error">{failed} 个失败</span> : null}
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="trow-group__body">
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} pending={pending} onResolve={onResolve} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PermissionAsk({ pending, onResolve }: { pending: PendingPermission; onResolve(optionId: string): void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="perm-ask">
      <div className="perm-ask__text">
        <strong>要执行这条命令吗？</strong>
        <code>{pending.command ?? pending.title}</code>
      </div>
      <div className="perm-ask__actions">
        {pending.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            className={`perm-ask__btn${option.kind.startsWith("allow") ? " perm-ask__btn--allow" : " perm-ask__btn--deny"}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onResolve(option.optionId);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GenericRow({ tool }: { tool: ToolCall }): JSX.Element {
  const [open, setOpen] = useState(false);
  const expandable = hasDetail(tool);
  const failed = isFailed(tool.status);
  // Unknown tools read as "codebase search foo"; known ones as "搜索了 foo".
  const label = tool.kind === "other" ? prettyToolName(tool.name) : toolVerb(tool);
  const subject = tool.kind === "mcp" ? tool.subject ?? prettyToolName(tool.name) : tool.subject;
  const quoted = tool.kind === "grep" || tool.kind === "glob" || tool.kind === "web";
  return (
    <div className={`trow-wrap${open ? " is-open" : ""}`}>
      <button type="button" className={`trow${expandable ? "" : " trow--static"}`} aria-expanded={open} onClick={() => expandable && setOpen((value) => !value)}>
        <RowIcon kind={tool.kind} running={tool.status === "running"} failed={failed} />
        <span className="trow__label">{label}</span>
        {subject ? <span className={`trow__subject${quoted ? " trow__subject--quoted" : ""}`}>{subject}</span> : null}
        {tool.cwd && (tool.kind === "grep" || tool.kind === "glob") ? <span className="trow__peek">{shortPath(tool.cwd)}</span> : null}
        {tool.files && tool.files.length > 1 && tool.kind !== "read" ? <span className="trow__peek">{tool.files.length} 个结果</span> : null}
        <StatusTag tool={tool} />
        {expandable ? <Chevron open={open} /> : null}
      </button>
      {open ? <Detail tool={tool} /> : null}
    </div>
  );
}

function FileChangeRow({ tool }: { tool: ToolCall }): JSX.Element {
  const [open, setOpen] = useState(false);
  const expandable = hasDetail(tool);
  const failed = isFailed(tool.status);
  const path = tool.files?.[0];
  return (
    <div className={`trow-wrap${open ? " is-open" : ""}`}>
      <button type="button" className={`trow${expandable ? "" : " trow--static"}`} aria-expanded={open} onClick={() => expandable && setOpen((value) => !value)}>
        <RowIcon kind={tool.kind} running={tool.status === "running"} failed={failed} />
        <span className="trow__label">{toolVerb(tool)}</span>
        <span className="trow__subject trow__subject--file" title={path}>
          {tool.subject ?? (path ? basename(path) : "")}
        </span>
        {tool.linesAdded || tool.linesRemoved ? (
          <span className="trow__delta">
            {tool.linesAdded ? <span className="trow__delta-add">+{tool.linesAdded}</span> : null}
            {tool.linesRemoved ? <span className="trow__delta-del">−{tool.linesRemoved}</span> : null}
          </span>
        ) : null}
        <StatusTag tool={tool} />
        {expandable ? <Chevron open={open} /> : null}
      </button>
      {open ? tool.diff ? <DiffView diff={tool.diff} /> : <Detail tool={tool} /> : null}
    </div>
  );
}

function ShellCard({ tool, pending, onResolve }: { tool: ToolCall } & AskProps): JSX.Element {
  const awaiting = Boolean(pending && pending.toolCallId === tool.id && onResolve);
  const running = tool.status === "running" && !awaiting;
  const failed = tool.status === "error";
  const rejected = tool.status === "rejected";
  // Live commands and failures start open; everything else stays a one-liner until asked.
  const [open, setOpen] = useState(running || failed || awaiting);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) {
      setOpen(running || failed || awaiting);
    }
  }, [running, failed, awaiting, pinned]);
  const outputRef = useRef<HTMLPreElement>(null);
  const output = tool.output?.replace(/\s+$/, "") ?? "";
  useEffect(() => {
    if (running && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, running]);
  const body = output || tool.error;
  const expandable = Boolean(body);
  return (
    <div className={`shell${open && body ? " is-open" : ""}${running ? " shell--live" : ""}${awaiting ? " shell--ask" : ""}${failed ? " shell--err" : ""}${rejected ? " shell--rejected" : ""}`}>
      <button
        type="button"
        className={`shell__head${expandable ? "" : " shell__head--static"}`}
        aria-expanded={open}
        onClick={() => {
          if (expandable) {
            setPinned(true);
            setOpen((value) => !value);
          }
        }}
      >
        <span className="shell__prompt" aria-hidden>
          {awaiting ? <Icon name="alert" size={12} /> : running ? <span className="spinner spinner--small" /> : rejected ? <Icon name="ban" size={12} /> : "$"}
        </span>
        <span className="shell__command">{tool.command ?? tool.subject ?? tool.name}</span>
        {awaiting ? <span className="trow__status trow__status--ask">等待确认</span> : <StatusTag tool={tool} />}
        {expandable ? <Chevron open={open} /> : null}
      </button>
      {awaiting && pending && onResolve ? <PermissionAsk pending={pending} onResolve={onResolve} /> : null}
      {open && body ? (
        <div className="shell__body">
          {output ? (
            <pre ref={outputRef} className={`shell__output${failed ? " shell__output--err" : ""}`}>
              {output}
              {running ? <span className="shell__cursor" /> : null}
            </pre>
          ) : null}
          {!output && tool.error ? <div className={`shell__note${rejected ? " shell__note--warn" : " shell__note--err"}`}>{tool.error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ tool }: { tool: ToolCall }): JSX.Element {
  const listFiles = tool.files && tool.files.length > 1 && !tool.output;
  // File contents read as code: no wrapping, scroll sideways like a code block.
  const code = tool.kind === "read";
  return (
    <div className="trow__detail">
      {tool.error ? <div className={`trow__error${tool.status === "rejected" ? " trow__error--warn" : ""}`}>{tool.error}</div> : null}
      {tool.output ? (
        <pre className={`trow__pre${code ? " trow__pre--code" : ""}`}>
          <code>{tool.output}</code>
        </pre>
      ) : null}
      {listFiles ? <pre className="trow__pre">{tool.files!.join("\n")}</pre> : null}
      {!tool.output && !listFiles && tool.input ? <pre className="trow__pre">{tool.input}</pre> : null}
    </div>
  );
}

/**
 * A unified diff as a table: old and new line numbers, the marker, the text.
 * Hunks are separated by their `@@` header; the `---/+++` file header is
 * dropped since the row above already names the file.
 */
export function DiffView({ diff }: { diff: string }): JSX.Element {
  const lines = useMemo(() => diffLines(diff).filter((line) => line.tag !== "meta"), [diff]);
  const numbered = lines.some((line) => line.oldNo !== undefined || line.newNo !== undefined);
  return (
    <div className={`diff${numbered ? " diff--numbered" : ""}`}>
      {lines.length ? null : <div className="diff__empty">内容没有变化</div>}
      {lines.map((line, index) =>
        line.tag === "hunk" || line.tag === "note" ? (
          <div key={index} className={`diff__sep diff__sep--${line.tag}`}>
            {line.text}
          </div>
        ) : (
          <div key={index} className={`diff__line diff__line--${line.tag}`}>
            {numbered ? (
              <>
                <span className="diff__no">{line.oldNo ?? ""}</span>
                <span className="diff__no">{line.newNo ?? ""}</span>
              </>
            ) : null}
            <span className="diff__sign">{line.tag === "add" ? "+" : line.tag === "del" ? "-" : ""}</span>
            <span className="diff__text">{line.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}

function RowIcon({ kind, running, failed }: { kind: ToolKind; running: boolean; failed: boolean }): JSX.Element {
  if (running) {
    return (
      <span className="trow__icon trow__icon--live">
        <span className="spinner spinner--small" />
      </span>
    );
  }
  return (
    <span className={`trow__icon${failed ? " trow__icon--err" : ""}`}>
      <Icon name={failed ? "alert" : TOOL_ICONS[kind]} size={13} />
    </span>
  );
}

function StatusTag({ tool }: { tool: ToolCall }): ReactNode {
  const label = statusLabel(tool);
  if (!label) {
    return null;
  }
  return <span className={`trow__status trow__status--${tool.status}`}>{label}</span>;
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return <Icon name="chevron" size={12} className={`trow__chevron${open ? " is-open" : ""}`} />;
}

function basename(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return index >= 0 ? cleaned.slice(index + 1) || cleaned : cleaned;
}

/** Last two path segments, enough to tell folders apart without the drive letter noise. */
function shortPath(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}
