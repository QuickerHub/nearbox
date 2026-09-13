import { join } from "node:path";

const DEFAULT_WINDOWS_ROOT = "C:\\Windows";

/**
 * True for POSIX absolutes and Windows drive / UNC paths. `path.isAbsolute`
 * is platform-specific, so a Windows SystemRoot would look relative on Linux
 * test hosts.
 */
export function isWindowsStyleAbsolute(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("\\")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * SystemRoot / windir must be absolute. A relative value would make
 * powershell.exe resolve under the process cwd (same class of bug as relative
 * APPDATA / CURSOR_CONFIG_DIR on the Cursor config path).
 */
export function resolveWindowsRoot(env: { SystemRoot?: string; windir?: string } = process.env): string {
  for (const key of ["SystemRoot", "windir"] as const) {
    const trimmed = env[key]?.trim();
    if (trimmed && isWindowsStyleAbsolute(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_WINDOWS_ROOT;
}

export function resolvePowershellPath(env: { SystemRoot?: string; windir?: string } = process.env): string {
  return join(resolveWindowsRoot(env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
