import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where the `nearbox` command lives and how the agent process reaches the API.
 * Runs that may delegate get `binDir` prepended to their PATH.
 */
export interface DelegationConfig {
  binDir: string;
  url: string;
}

const IS_WINDOWS = process.platform === "win32";

/**
 * Writes the `nearbox` launcher scripts into `<userData>/bin`. They start
 * Nearbox's own Electron binary in Node mode on the CLI script, so no separate
 * Node installation is needed. Rewritten on every start because the paths
 * change with updates.
 *
 * On Windows both a `.cmd` (cmd.exe / PowerShell) and an extensionless sh
 * script (Git Bash, which Claude Code uses) are written.
 */
export async function installDelegationBin(userData: string, electron: string, cliScript: string): Promise<string> {
  const binDir = join(userData, "bin");
  await mkdir(binDir, { recursive: true });
  const sh = ["#!/bin/sh", `ELECTRON_RUN_AS_NODE=1 exec "${toShellPath(electron)}" "${toShellPath(cliScript)}" "$@"`, ""].join("\n");
  await writeFile(join(binDir, "nearbox"), sh, "utf8");
  if (!IS_WINDOWS) {
    await chmod(join(binDir, "nearbox"), 0o755);
    return binDir;
  }
  const cmd = ["@echo off", "setlocal", 'set "ELECTRON_RUN_AS_NODE=1"', `"${electron}" "${cliScript}" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n");
  await writeFile(join(binDir, "nearbox.cmd"), cmd, "utf8");
  return binDir;
}

/** Git Bash accepts drive-letter paths with forward slashes; POSIX paths pass through. */
function toShellPath(path: string): string {
  return IS_WINDOWS ? path.replace(/\\/g, "/") : path;
}

/** PATH with the launcher directory in front, under both spellings Windows programs read. */
export function withDelegationPath(env: NodeJS.ProcessEnv, binDir: string): NodeJS.ProcessEnv {
  const separator = IS_WINDOWS ? ";" : ":";
  const current = env.PATH ?? env.Path ?? "";
  const next: NodeJS.ProcessEnv = { ...env, PATH: [binDir, current].filter(Boolean).join(separator) };
  if (IS_WINDOWS) {
    next.Path = next.PATH;
  }
  return next;
}
