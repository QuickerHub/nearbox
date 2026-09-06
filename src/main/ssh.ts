import { spawn, type ChildProcess } from "node:child_process";
import { AGENT_KINDS, AGENT_LABELS, type AgentInfo, type DevicePlatform, type RemoteDevice, type RemoteDirListing } from "@shared/protocol";
import { COMMAND_NAMES } from "./agents";
import { killTree as killLocal } from "./kill";

/**
 * Everything Nearbox does on another computer goes through the local `ssh`
 * client, so a device works here exactly when `ssh <host>` works in a terminal.
 *
 * Windows targets are driven with PowerShell scripts passed as -EncodedCommand:
 * base64 survives cmd.exe untouched, so paths and Chinese text never meet
 * shell quoting. POSIX targets get `sh -c` with single-quoted arguments.
 */

export type SshTarget = Pick<RemoteDevice, "host" | "user" | "port" | "identityFile">;

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProbeResult {
  platform: DevicePlatform;
  hostName: string;
  user: string;
  home: string;
  agents: AgentInfo[];
}

export interface RemoteRunPaths {
  dir: string;
  promptFile: string;
  pidFile: string;
}

const CONNECT_TIMEOUT_S = 12;
const PROBE_TIMEOUT_MS = 40_000;
const HELPER_TIMEOUT_MS = 30_000;

/** ssh exits 255 for its own failures (connect, auth); anything else came from the remote command. */
export const SSH_FAILURE_EXIT = 255;

export function sshArgs(target: SshTarget, command: string): string[] {
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-o",
    "LogLevel=ERROR",
  ];
  if (target.port) {
    args.push("-p", String(target.port));
  }
  if (target.identityFile) {
    args.push("-i", target.identityFile);
  }
  if (target.user) {
    args.push("-l", target.user);
  }
  args.push(target.host, command);
  return args;
}

export function sshSpawn(target: SshTarget, command: string): ChildProcess {
  return spawn("ssh", sshArgs(target, command), {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, LANG: process.env.LANG ?? "C.UTF-8" },
  });
}

export function sshExec(
  target: SshTarget,
  command: string,
  options: { stdin?: string | Buffer; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = sshSpawn(target, command);
    } catch (error) {
      reject(error);
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        killLocal(child);
        reject(new Error(`连接 ${describeTarget(target)} 超时。`));
      }
    }, options.timeoutMs ?? HELPER_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(describeSpawnError(error)));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      }
    });
    if (child.stdin) {
      child.stdin.on("error", () => undefined);
      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    }
  });
}

export { killLocal };

export function describeTarget(target: SshTarget): string {
  const hostPort = target.port ? `${target.host}:${target.port}` : target.host;
  return target.user ? `${target.user}@${hostPort}` : hostPort;
}

/** Turn ssh's stderr into one sentence the user can act on. */
export function explainSshFailure(target: SshTarget, stderr: string): string {
  const text = stderr.trim();
  const line = text.split(/\r?\n/).find((item) => item.trim() && !item.startsWith("Warning:")) ?? text;
  const where = describeTarget(target);
  if (/Permission denied|Too many authentication failures|No supported authentication/i.test(text)) {
    return `SSH 免密登录 ${where} 失败（${line}）。请先配置公钥登录，让本机在终端里执行 ssh ${target.host} 时不需要输入密码。`;
  }
  if (/Could not resolve hostname|Name or service not known|getaddrinfo/i.test(text)) {
    return `找不到主机 ${target.host}，请检查地址或 ~/.ssh/config 里的别名。`;
  }
  if (/Connection timed out|Connection refused|No route to host|Network is unreachable|Operation timed out|Host is down/i.test(text)) {
    return `连不上 ${where}（${line}）。请确认那台电脑已开机、和本机在同一网络，并已开启 OpenSSH 服务器。`;
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `${where} 的主机密钥和以前不一样，ssh 拒绝连接。确认是同一台电脑后，删除 ~/.ssh/known_hosts 里的旧记录再试。`;
  }
  return line ? `连接 ${where} 失败：${line}` : `连接 ${where} 失败。`;
}

function describeSpawnError(error: Error): string {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return process.platform === "win32"
      ? "本机没有 ssh 命令。请在 Windows「设置 → 系统 → 可选功能」里安装「OpenSSH 客户端」。"
      : "本机没有 ssh 命令，请先安装 OpenSSH 客户端。";
  }
  return `无法启动 ssh：${error.message}`;
}

// ---------------------------------------------------------------------------
// Script builders
// ---------------------------------------------------------------------------

/** PowerShell single-quoted literal: only the quote itself needs doubling. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** POSIX sh single-quoted literal. */
export function shQuote(value: string): string {
  if (value === "") {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The whole script travels as base64 UTF-16LE, so nothing in it is ever seen by cmd.exe. */
export function powershellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

export function shCommand(script: string): string {
  return `sh -c ${shQuote(script)}`;
}

const PS_HEADER = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)";

const AGENT_NAMES = [...new Set(AGENT_KINDS.flatMap((kind) => COMMAND_NAMES[kind]))];

const WINDOWS_PROBE = `${PS_HEADER}
$f=@{}
foreach($n in @(${AGENT_NAMES.map(psQuote).join(",")})){$c=Get-Command $n -CommandType Application,ExternalScript -ErrorAction SilentlyContinue|Select-Object -First 1;if($c){$f[$n]=[string]$c.Source}}
[pscustomobject]@{nearbox=1;platform='windows';hostName=[string]$env:COMPUTERNAME;user=[string]$env:USERNAME;home=[string]$HOME;agents=$f}|ConvertTo-Json -Compress -Depth 3`;

// Extra dirs the supported CLIs install into; login shells usually add them, non-interactive ssh does not.
const POSIX_PATH = 'PATH="$HOME/.local/bin:$HOME/.cursor/bin:$HOME/.codex/bin:$HOME/.grok/bin:$HOME/.opencode/bin:$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"';

const POSIX_PROBE = `${POSIX_PATH}; printf "{\\"nearbox\\":1,\\"uname\\":\\"%s\\",\\"hostName\\":\\"%s\\",\\"user\\":\\"%s\\",\\"home\\":\\"%s\\",\\"agents\\":{" "$(uname -s 2>/dev/null)" "$(hostname 2>/dev/null)" "$(id -un 2>/dev/null)" "$HOME"; s=""; for n in ${AGENT_NAMES.join(" ")}; do p=$(command -v "$n" 2>/dev/null); if [ -n "$p" ]; then printf "%s\\"%s\\":\\"%s\\"" "$s" "$n" "$p"; s=","; fi; done; printf "}}\\n"`;

function agentsFromMap(found: Record<string, string>): AgentInfo[] {
  return AGENT_KINDS.map((kind) => {
    const name = COMMAND_NAMES[kind].find((candidate) => typeof found[candidate] === "string" && found[candidate]);
    return {
      kind,
      label: AGENT_LABELS[kind],
      available: Boolean(name),
      command: name ? found[name] : undefined,
      detail: name ? undefined : `没有找到 ${COMMAND_NAMES[kind][0]}`,
      supportsResume: true,
    };
  });
}

function extractJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).nearbox === 1) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Find out what the device is and which agent CLIs it has. Windows is tried
 * first because `powershell` on a POSIX box fails instantly, whereas `sh` on a
 * Windows box may not exist at all.
 */
export async function probeDevice(target: SshTarget): Promise<ProbeResult> {
  const windows = await sshExec(target, powershellCommand(WINDOWS_PROBE), { timeoutMs: PROBE_TIMEOUT_MS });
  if (windows.code === SSH_FAILURE_EXIT) {
    throw new Error(explainSshFailure(target, windows.stderr));
  }
  const winJson = extractJson(windows.stdout);
  if (winJson) {
    return {
      platform: "windows",
      hostName: String(winJson.hostName ?? ""),
      user: String(winJson.user ?? ""),
      home: String(winJson.home ?? ""),
      agents: agentsFromMap(asStringMap(winJson.agents)),
    };
  }
  const posix = await sshExec(target, shCommand(POSIX_PROBE), { timeoutMs: PROBE_TIMEOUT_MS });
  if (posix.code === SSH_FAILURE_EXIT) {
    throw new Error(explainSshFailure(target, posix.stderr));
  }
  const posixJson = extractJson(posix.stdout);
  if (posixJson) {
    const uname = String(posixJson.uname ?? "").toLowerCase();
    return {
      platform: uname.includes("darwin") ? "macos" : uname.includes("linux") ? "linux" : "unknown",
      hostName: String(posixJson.hostName ?? ""),
      user: String(posixJson.user ?? ""),
      home: String(posixJson.home ?? ""),
      agents: agentsFromMap(asStringMap(posixJson.agents)),
    };
  }
  const hint = firstLine(windows.stderr) || firstLine(posix.stderr) || firstLine(windows.stdout) || firstLine(posix.stdout);
  throw new Error(`连上了 ${describeTarget(target)}，但没认出它的系统${hint ? `：${hint}` : "。"}`);
}

function asStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string") {
        out[key] = item;
      }
    }
  }
  return out;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#< CLIXML") && !line.startsWith("<Objs")) ?? ""
  );
}

// ---------------------------------------------------------------------------
// Paths on the device
// ---------------------------------------------------------------------------

export function isWindowsDevice(device: Pick<RemoteDevice, "platform">): boolean {
  return device.platform === "windows";
}

export function remoteJoin(device: Pick<RemoteDevice, "platform">, ...parts: string[]): string {
  const separator = isWindowsDevice(device) ? "\\" : "/";
  return parts
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(separator);
}

export function remoteRunPaths(device: Pick<RemoteDevice, "platform" | "home">, runId: string): RemoteRunPaths {
  const dir = remoteJoin(device, device.home ?? "", ".nearbox", "runs");
  return {
    dir,
    promptFile: remoteJoin(device, dir, `${runId}.prompt.md`),
    pidFile: remoteJoin(device, dir, `${runId}.pid`),
  };
}

export function remoteAttachmentPath(device: Pick<RemoteDevice, "platform" | "home">, fileId: string, name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "file";
  return remoteJoin(device, device.home ?? "", ".nearbox", "files", `${fileId.slice(0, 8)}-${safe}`);
}

/** Reject anything that could not be a single path: control chars break every shell we talk to. */
export function assertSafeRemotePath(path: string): void {
  if (!path.trim() || /[\r\n\u0000]/.test(path)) {
    throw new Error("路径不合法。");
  }
}

// ---------------------------------------------------------------------------
// Helpers executed on the device
// ---------------------------------------------------------------------------

/** Write `content` to `path` on the device, creating parent directories. */
export async function uploadFile(device: RemoteDevice, path: string, content: string | Buffer): Promise<void> {
  assertSafeRemotePath(path);
  const command = isWindowsDevice(device)
    ? powershellCommand(
        `${PS_HEADER}
$f=${psQuote(path)}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($f))|Out-Null
$i=[Console]::OpenStandardInput();$m=New-Object IO.MemoryStream;$i.CopyTo($m)
[IO.File]::WriteAllBytes($f,$m.ToArray())
'ok '+$m.Length`,
      )
    : shCommand(`f=${shQuote(path)}; mkdir -p "$(dirname "$f")" && cat > "$f" && echo ok`);
  const result = await sshExec(device, command, { stdin: content, timeoutMs: 120_000 });
  if (result.code === SSH_FAILURE_EXIT) {
    throw new Error(explainSshFailure(device, result.stderr));
  }
  if (result.code !== 0 || !/^ok/m.test(result.stdout)) {
    throw new Error(`写入 ${path} 失败：${firstLine(result.stderr) || firstLine(result.stdout) || `退出码 ${result.code}`}`);
  }
}

export async function directoryExists(device: RemoteDevice, path: string): Promise<boolean> {
  assertSafeRemotePath(path);
  const command = isWindowsDevice(device)
    ? powershellCommand(`${PS_HEADER}
if(Test-Path -LiteralPath ${psQuote(path)} -PathType Container){'yes'}else{'no'}`)
    : shCommand(`if [ -d ${shQuote(path)} ]; then echo yes; else echo no; fi`);
  const result = await sshExec(device, command);
  if (result.code === SSH_FAILURE_EXIT) {
    throw new Error(explainSshFailure(device, result.stderr));
  }
  return /^yes/m.test(result.stdout);
}

const WINDOWS_LIST = (path: string) => `${PS_HEADER}
$p=${psQuote(path)}
if(-not $p){$r=@(Get-PSDrive -PSProvider FileSystem|Where-Object{$_.Root -and (Test-Path -LiteralPath $_.Root)}|ForEach-Object{[string]$_.Root});[pscustomobject]@{nearbox=1;path='';roots=$r;home=[string]$HOME;entries=@()}|ConvertTo-Json -Compress -Depth 4;exit 0}
$full=(Resolve-Path -LiteralPath $p).ProviderPath
$e=@(Get-ChildItem -LiteralPath $full -Directory -ErrorAction SilentlyContinue|Sort-Object Name|ForEach-Object{@{name=[string]$_.Name;path=[string]$_.FullName}})
$parent=[IO.Path]::GetDirectoryName($full)
[pscustomobject]@{nearbox=1;path=[string]$full;parent=$(if($parent){[string]$parent}else{''});entries=$e}|ConvertTo-Json -Compress -Depth 4`;

// sh has no JSON; names with quotes or backslashes are escaped by hand and control characters dropped.
const POSIX_LIST = (path: string) => `p=${shQuote(path)}; [ -z "$p" ] && p="$HOME"; cd "$p" 2>/dev/null || { echo '{"nearbox":1,"error":"missing"}'; exit 0; }; full=$(pwd); esc() { printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' | tr -d '\\000-\\037'; }; printf '{"nearbox":1,"path":"%s","parent":"%s","entries":[' "$(esc "$full")" "$(esc "$(dirname "$full")")"; s=""; for d in */; do [ -d "$d" ] || continue; n=\${d%/}; printf '%s{"name":"%s","path":"%s"}' "$s" "$(esc "$n")" "$(esc "$full/$n")"; s=","; done; printf ']}\\n'`;

/** Subdirectories of `path`; an empty path lists drive roots (Windows) or the home directory (POSIX). */
export async function listDirectory(device: RemoteDevice, path: string): Promise<RemoteDirListing> {
  if (path) {
    assertSafeRemotePath(path);
  }
  const command = isWindowsDevice(device) ? powershellCommand(WINDOWS_LIST(path)) : shCommand(POSIX_LIST(path));
  const result = await sshExec(device, command);
  if (result.code === SSH_FAILURE_EXIT) {
    throw new Error(explainSshFailure(device, result.stderr));
  }
  const json = extractJson(result.stdout);
  if (!json) {
    throw new Error(`读取目录失败：${firstLine(result.stderr) || firstLine(result.stdout) || "没有返回内容"}`);
  }
  if (json.error === "missing") {
    throw new Error(`目录不存在：${path}`);
  }
  const entries = Array.isArray(json.entries)
    ? json.entries
        .filter((item): item is { name: string; path: string } => Boolean(item) && typeof (item as { name?: unknown }).name === "string")
        .map((item) => ({ name: item.name, path: String(item.path) }))
    : [];
  const roots = Array.isArray(json.roots) ? json.roots.filter((item): item is string => typeof item === "string") : undefined;
  return {
    path: String(json.path ?? ""),
    parent: typeof json.parent === "string" && json.parent ? json.parent : undefined,
    entries,
    roots: roots && roots.length ? roots : undefined,
    home: typeof json.home === "string" && json.home ? json.home : device.home,
  };
}

/**
 * Kill the process tree an earlier launcher recorded in `pidFile`. Windows
 * sshd leaves silent processes running when the connection drops, so this is
 * the only reliable way to stop a remote agent.
 */
export async function killRemoteRun(device: RemoteDevice, pidFile: string): Promise<void> {
  const command = isWindowsDevice(device)
    ? powershellCommand(`$ProgressPreference='SilentlyContinue'
$f=${psQuote(pidFile)}
if(Test-Path -LiteralPath $f){$id=[int](Get-Content -LiteralPath $f);& taskkill /pid $id /t /f 2>&1|Out-Null;'killed'}else{'nopid'}`)
    : shCommand(
        `f=${shQuote(pidFile)}; if [ -f "$f" ]; then id=$(cat "$f"); pkill -TERM -P "$id" 2>/dev/null; kill -TERM "$id" 2>/dev/null; sleep 2; pkill -KILL -P "$id" 2>/dev/null; kill -KILL "$id" 2>/dev/null; echo killed; else echo nopid; fi`,
      );
  await sshExec(device, command, { timeoutMs: 20_000 }).catch(() => undefined);
}

export interface LauncherRequest {
  /** Complete agent command line, already quoted for the device's shell. */
  commandLine: string;
  cwd: string;
  pidFile: string;
}

/**
 * The command handed to ssh for an agent run. It records the agent's pid for
 * later cancellation, forces plain output, and passes the agent's exit code
 * back. stdin and stdout are inherited, so prompts and JSONL flow through.
 */
export function buildLauncher(device: RemoteDevice, request: LauncherRequest): string {
  if (isWindowsDevice(device)) {
    // /d /s /c "<line>": cmd strips the outer pair of quotes and runs the line verbatim.
    return powershellCommand(`$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop'
$env:NO_COLOR='1';$env:FORCE_COLOR='0';$env:TERM='dumb'
$c=$env:ComSpec;if(-not $c){$c='cmd.exe'}
$s=New-Object Diagnostics.ProcessStartInfo
$s.FileName=$c
$s.Arguments='/d /s /c "'+${psQuote(request.commandLine)}+'"'
$s.UseShellExecute=$false
$s.WorkingDirectory=${psQuote(request.cwd)}
$p=[Diagnostics.Process]::Start($s)
[IO.File]::WriteAllText(${psQuote(request.pidFile)},[string]$p.Id)
$p.WaitForExit()
exit $p.ExitCode`);
  }
  return shCommand(
    `${POSIX_PATH}; export PATH NO_COLOR=1 FORCE_COLOR=0 TERM=dumb; cd ${shQuote(request.cwd)} || exit 97; echo $$ > ${shQuote(request.pidFile)}; exec ${request.commandLine}`,
  );
}
