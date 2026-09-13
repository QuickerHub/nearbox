/**
 * Pure helpers for the remote run-start path: device/agent/cwd checks before
 * ssh launches the agent. Mirrors local `run-start` taxonomy so unit tests can
 * pin the Chinese status strings without an SSH session.
 */

export type RemotePreflightFailure = {
  reason: "agent-missing" | "home-missing" | "cwd-missing";
  /** Appended as a stderr event before finish. */
  stderr: string;
  /** Short finish reason stored on the run. */
  error: string;
};

/** Failures known from the probed device record, before any upload/cwd check. */
export function remoteDevicePreflight(input: {
  deviceName: string;
  agentLabel: string;
  /** False when the probed device has no usable CLI for this agent. */
  agentAvailable: boolean;
  /** False when the probe never learned the remote home directory. */
  hasHome: boolean;
}): RemotePreflightFailure | null {
  if (!input.agentAvailable) {
    return {
      reason: "agent-missing",
      stderr: `${input.deviceName} 上没有找到 ${input.agentLabel} 的命令行工具。请先在那台电脑上安装并登录，然后在设置里重新检测。`,
      error: `${input.deviceName} 上未安装对应的 CLI`,
    };
  }
  if (!input.hasHome) {
    return {
      reason: "home-missing",
      stderr: `还不知道 ${input.deviceName} 的用户目录，请在设置里重新检测这台电脑。`,
      error: "设备信息不完整",
    };
  }
  return null;
}

/** Failures after a remote directoryExists probe. */
export function remoteCwdPreflight(input: {
  deviceName: string;
  cwd: string;
  cwdExists: boolean;
}): RemotePreflightFailure | null {
  if (!input.cwdExists) {
    return {
      reason: "cwd-missing",
      stderr: `${input.deviceName} 上没有这个目录：${input.cwd}`,
      error: "项目目录不存在",
    };
  }
  return null;
}
