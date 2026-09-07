import type { PendingPermission, RunEvent, ToolCall, ToolStatus } from "../../../shared/protocol";

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
export function lastOutputLine(output?: string): string {
  if (!output) {
    return "";
  }
  const lines = output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export function formatTerminalDuration(from: string | undefined, to?: string): string {
  if (!from) {
    return "";
  }
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) {
    return "";
  }
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(end)) {
    return "";
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${seconds % 60} 秒`;
  }
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function mergeTerminal(existing: DockTerminal | undefined, tool: ToolCall, at: string, pending?: PendingPermission): DockTerminal {
  const waiting = pending?.toolCallId === tool.id;
  return {
    id: tool.id,
    command: tool.command ?? tool.subject ?? existing?.command ?? tool.name,
    description: tool.description ?? existing?.description,
    cwd: tool.cwd ?? existing?.cwd,
    status: waiting ? "waiting" : tool.status,
    output: tool.output ?? existing?.output,
    error: tool.error ?? existing?.error,
    exitCode: tool.exitCode ?? existing?.exitCode,
    startedAt: existing?.startedAt || at,
    updatedAt: at,
  };
}
