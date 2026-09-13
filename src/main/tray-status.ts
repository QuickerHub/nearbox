import { phonesOnlineLabel } from "../shared/devices.ts";

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
  return phonesOnlineLabel(phones);
}

/**
 * LAN picker is host/IP only. Unicode format/bidi marks (ZWSP, RTL override,
 * BOM) can spoof the tray row without matching C0 controls or /\s/.
 */
export function sanitizeTrayHostLabel(host: string | undefined): string | undefined {
  if (typeof host !== "string") {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(host)) {
    return undefined;
  }
  const cleaned = host.trim().slice(0, 64);
  return cleaned || undefined;
}

/** Host:port row, or the empty-LAN placeholder. */
export function trayHostLabel(selectedHost: string | undefined, port: number | undefined): string {
  const host = sanitizeTrayHostLabel(selectedHost);
  return host ? `${host}:${port}` : "未发现局域网地址";
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
  return `${sanitizeTrayHostLabel(selectedHost) ?? ""}|${port ?? ""}|${phones}|${running}|${queued}`;
}

/** Hover tooltip: compact Chinese status next to the app name. */
export function trayTooltip(running: number, queued: number, phones: number): string {
  return `Nearbox · ${trayAgentLabel(running, queued)} · ${phonesOnlineLabel(phones)}`;
}

