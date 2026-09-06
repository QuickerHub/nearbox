export function formatTime(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const today = new Date();
  if (sameDay(date, today)) {
    return "今天";
  }
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return "昨天";
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
}

/** "刚刚 / 5 分钟前 / 昨天 14:02 / 9月3日" */
export function formatRelative(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) {
    return "";
  }
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  const day = formatDay(value);
  if (day === "今天") {
    return formatTime(value);
  }
  if (day === "昨天") {
    return `昨天 ${formatTime(value)}`;
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function formatDuration(from: string | undefined, to: string | undefined): string {
  if (!from) {
    return "";
  }
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
