import { formatContextUsage, RUN_STATUS_LABELS, type RunStatus, type TokenUsage, usageDetail, usageRatio } from "@shared/protocol";

export function RunStatusPill({ status, small }: { status: RunStatus; small?: boolean }): JSX.Element {
  return (
    <span className={`pill pill--${status}${small ? " pill--small" : ""}`}>
      {status === "running" ? <span className="spinner" /> : null}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** Compact context-window chip: a thin bar plus "16.0k / 200k". */
export function ContextMeter({ usage }: { usage: TokenUsage }): JSX.Element | null {
  const label = formatContextUsage(usage);
  if (!label) {
    return null;
  }
  const ratio = usageRatio(usage);
  const tone = ratio === undefined ? "" : ratio >= 0.9 ? " ctx-meter--high" : ratio >= 0.7 ? " ctx-meter--mid" : "";
  return (
    <span className={`ctx-meter${tone}`} title={usageDetail(usage)}>
      {ratio !== undefined ? (
        <span className="ctx-meter__bar" aria-hidden>
          <i style={{ width: `${Math.max(6, Math.round(ratio * 100))}%` }} />
        </span>
      ) : null}
      <span>{label}</span>
    </span>
  );
}
