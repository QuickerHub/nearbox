import { RUN_STATUS_LABELS, type RunStatus } from "@shared/protocol";

export function RunStatusPill({ status, small }: { status: RunStatus; small?: boolean }): JSX.Element {
  return (
    <span className={`pill pill--${status}${small ? " pill--small" : ""}`}>
      {status === "running" ? <span className="spinner" /> : null}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}
