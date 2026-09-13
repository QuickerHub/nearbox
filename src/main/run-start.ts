/**
 * Pure helpers for the run-start path: local preflight failures and warm-host
 * fallback reasons. Kept free of Node / Electron so unit tests can pin the
 * Chinese status strings without spinning up a runner.
 */

export type LocalPreflightFailure = {
  reason: "cli-missing" | "cwd-missing";
  /** Appended as a stderr event before finish. */
  stderr: string;
  /** Short finish reason stored on the run. */
  error: string;
};

/** Failures that abort a local start before any process is spawned. */
export function localPreflightFailure(input: {
  agentLabel: string;
  /** False when no CLI binary could be resolved. */
  hasCommand: boolean;
  cwd: string;
  cwdExists: boolean;
}): LocalPreflightFailure | null {
  if (!input.hasCommand) {
    return {
      reason: "cli-missing",
      stderr: `没有找到 ${input.agentLabel} 的命令行工具。请先在这台电脑上安装并登录。`,
      error: "未安装对应的 CLI",
    };
  }
  if (!input.cwdExists) {
    return {
      reason: "cwd-missing",
      stderr: `项目目录不存在：${input.cwd}`,
      error: "项目目录不存在",
    };
  }
  return null;
}

export type WarmAttempt =
  | { attempt: false; reason: "remote" | "delegation" }
  | { attempt: true };

/** Warm hosts are local-only and cannot carry a delegation PATH/token. */
export function shouldAttemptWarm(input: { deviceId?: string; delegate?: boolean }): WarmAttempt {
  if (input.deviceId) {
    return { attempt: false, reason: "remote" };
  }
  if (input.delegate) {
    return { attempt: false, reason: "delegation" };
  }
  return { attempt: true };
}

export type WarmFallbackKind =
  | "host-down"
  | "models-unknown"
  | "model-unsupported"
  | "legacy-session"
  | "session-error";

/** Status-line copy shown when a warm turn falls back to a one-shot process. */
export function warmFallbackStatus(kind: WarmFallbackKind, detail?: string): string {
  switch (kind) {
    case "host-down":
      return "常驻进程这次没起来，本轮用单独进程（结束就会退出）。";
    case "models-unknown":
      return "常驻会话还没学到模型列表，本轮改用单独进程运行。";
    case "model-unsupported":
      return detail
        ? `常驻会话不支持模型 ${detail}，本轮改用单独进程运行。`
        : "常驻会话不支持所选模型，本轮改用单独进程运行。";
    case "legacy-session":
      return "这段会话是在单独进程模式下开始的，常驻进程接不上，回复会慢一些；想要更快的回复可以「改为新会话」。";
    case "session-error":
      return `常驻会话不可用（${detail ?? "未知错误"}），本轮改用单独进程运行。`;
  }
}
