import type { PendingPermission, RunEvent, ToolCall, ToolStatus } from "../../../shared/protocol";
import { formatDuration, stripAnsi } from "./format.ts";

export type DockTerminalStatus = ToolStatus | "waiting";

/** One shell the dock above the composer can show. */
export interface DockTerminal {
  id: string;
  command: string;
  description?: string;
  cwd?: string;
  status: DockTerminalStatus;
  output?: string;
  error?: string;
  exitCode?: number;
  startedAt: string;
  updatedAt: string;
}

export function isLiveTerminal(terminal: Pick<DockTerminal, "status">): boolean {
  return terminal.status === "running" || terminal.status === "waiting";
}

/**
 * Collapse tool events into one row per shell. A pending permission on a
 * call that has not appeared yet still gets a row, so the dock can ask
 * before the transcript has loaded.
 */
export function collectDockTerminals(
  events: readonly RunEvent[],
  pending?: PendingPermission,
  fallbackStartedAt?: string,
): DockTerminal[] {
  const byId = new Map<string, DockTerminal>();
  for (const event of events) {
    if (event.kind !== "tool" || event.tool?.kind !== "shell") {
      continue;
    }
    const next = mergeTerminal(byId.get(event.tool.id), event.tool, event.at, pending);
    byId.set(next.id, next);
  }
  if (pending && !byId.has(pending.toolCallId)) {
    const at = fallbackStartedAt || "";
    byId.set(pending.toolCallId, {
      id: pending.toolCallId,
      command: pending.command || pending.title,
      status: "waiting",
      startedAt: at,
      updatedAt: at,
    });
  } else if (pending) {
    const current = byId.get(pending.toolCallId);
    if (current) {
      byId.set(pending.toolCallId, { ...current, status: "waiting" });
    }
  }
  return [...byId.values()];
}

export function dockStatusLabel(terminal: Pick<DockTerminal, "status" | "exitCode">): string {
  switch (terminal.status) {
    case "waiting":
      return "等待确认";
    case "running":
      return "运行中";
    case "rejected":
      return "被拦截";
    case "error":
      return terminal.exitCode !== undefined && terminal.exitCode !== 0 ? `退出码 ${terminal.exitCode}` : "失败";
    default:
      return "已完成";
  }
}

export function terminalTitle(terminal: Pick<DockTerminal, "command" | "description">): string {
  return terminal.description?.trim() || terminal.command;
}

/** Last non-empty line, so the dock can show what the command is doing. */
/** True when a scrollable shell view is already pinned near the bottom. */
export function shouldStickToBottom(scrollTop: number, scrollHeight: number, clientHeight: number, slop = 48): boolean {
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite)) {
    return true;
  }
  return scrollHeight - scrollTop - clientHeight <= slop;
}

export function lastOutputLine(output?: string): string {
  if (!output) {
    return "";
  }
  output = stripAnsi(output);
  // Scan from the end: long shell tails rebuild the dock every second while live.
  let end = output.length;
  while (end > 0) {
    const code = output.charCodeAt(end - 1);
    if (code !== 10 && code !== 13 && code !== 32 && code !== 9) {
      break;
    }
    end -= 1;
  }
  if (end === 0) {
    return "";
  }
  let start = end - 1;
  while (start >= 0) {
    const code = output.charCodeAt(start);
    if (code === 10 || code === 13) {
      break;
    }
    start -= 1;
  }
  const line = output.slice(start + 1, end);
  // Match the old split/trim behavior for leading spaces on the line itself.
  return line.trim();
}

export function formatTerminalDuration(from: string | undefined, to?: string): string {
  return formatDuration(from, to);
}

function mergeTerminal(existing: DockTerminal | undefined, tool: ToolCall, at: string, pending?: PendingPermission): DockTerminal {
  const waiting = pending?.toolCallId === tool.id;
  return {
    id: tool.id,
    command: tool.command ?? tool.subject ?? existing?.command ?? tool.name,
    description: tool.description ?? existing?.description,
    cwd: tool.cwd ?? existing?.cwd,
    status: waiting ? "waiting" : tool.status,
    output: tool.output !== undefined ? stripAnsi(tool.output) : existing?.output,
    error: tool.error ?? existing?.error,
    exitCode: tool.exitCode ?? existing?.exitCode,
    startedAt: existing?.startedAt || at,
    updatedAt: at,
  };
}
