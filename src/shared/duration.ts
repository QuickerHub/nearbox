/**
 * Chinese duration labels shared by the renderer (RunBlock / dock) and the
 * main-process CLI result rows. Keep units identical across surfaces.
 */

/** Whole seconds → "N 秒" / "M 分 S 秒" / "H 小时 M 分". */
export function formatSecondsDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) {
    return `${safe} 秒`;
  }
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${safe % 60} 秒`;
  }
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** CLI result duration_ms → Chinese units (includes sub-second 毫秒). */
export function formatMsDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} 毫秒`;
  }
  return formatSecondsDuration(ms / 1000);
}
