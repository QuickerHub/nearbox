/**
 * Pure tray-menu status helpers. refreshTrayMenu runs on every coalesced
 * snapshot; keep counting/labels free of Electron so they stay unit-tested.
 */

export type RunStatusLike = { status: string };

/** Count running/queued in one pass (no filter alloc). */
export function countRunStatuses(runs: readonly RunStatusLike[]): { running: number; queued: number } {
  let running = 0;
  let queued = 0;
  for (const run of runs) {
    if (run.status === "running") {
      running += 1;
    } else if (run.status === "queued") {
      queued += 1;
    }
  }
  return { running, queued };
}

/** "Agent 空闲" / "Agent：N 运行中 · M 排队" */
export function trayAgentLabel(running: number, queued: number): string {
  return running || queued ? `Agent：${running} 运行中 · ${queued} 排队` : "Agent 空闲";
}

/** "没有手机在线" / "N 台手机在线" */
export function trayPhonesLabel(phones: number): string {
  return phones ? `${phones} 台手机在线` : "没有手机在线";
}

/** Host:port row, or the empty-LAN placeholder. */
export function trayHostLabel(selectedHost: string | undefined, port: number | undefined): string {
  return selectedHost ? `${selectedHost}:${port}` : "未发现局域网地址";
}

/**
 * Compact signature of the tray status rows. When unchanged, skip
 * Menu.buildFromTemplate — snapshots fire often with identical counts.
 */
export function trayStatusSignature(
  selectedHost: string | undefined,
  port: number | undefined,
  phones: number,
  running: number,
  queued: number,
): string {
  return `${selectedHost ?? ""}|${port ?? ""}|${phones}|${running}|${queued}`;
}
