import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { AGENT_KINDS, AGENT_LABELS, type AgentInfo, type AgentKind, type AgentModel } from "@shared/protocol";
import { MODEL_LIST_ARGS, parseModelList } from "./agent-models";
import { quoteForCmd, type ResolvedCommand, versionKey } from "./agent-output";

export {
  buildInvocation,
  buildShellCommandLine,
  createOutputParser,
  quoteForCmd,
  truncate,
  type Invocation,
  type InvocationRequest,
  type OutputParser,
  type ParseResult,
  type ResolvedCommand,
  type ShellCommandLine,
} from "./agent-output";

const IS_WINDOWS = process.platform === "win32";

/** Names each agent is installed under, in preference order. */
export const COMMAND_NAMES: Record<AgentKind, string[]> = {
  cursor: ["cursor-agent", "agent"],
  codex: ["codex"],
  grok: ["grok"],
  claude: ["claude"],
  opencode: ["opencode"],
};

/** Directories where the supported CLIs install themselves. */
export function extraPathEntries(): string[] {
  const home = homedir();
  const entries = [
    join(home, ".grok", "bin"),
    join(home, ".local", "bin"),
    join(home, ".cursor", "bin"),
    join(home, ".codex", "bin"),
    join(home, ".opencode", "bin"),
  ];
  if (IS_WINDOWS) {
    const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const roaming = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    entries.push(
      join(local, "cursor-agent"),
      join(roaming, "npm"),
      join(local, "Programs", "cursor", "resources", "app", "bin"),
    );
  } else {
    entries.push("/usr/local/bin", "/opt/homebrew/bin", join(home, ".npm-global", "bin"));
  }
  return entries.filter((entry) => existsSync(entry));
}

/** Environment for child CLIs: extended PATH, no colors, no TTY assumptions. */
export function spawnEnv(): NodeJS.ProcessEnv {
  const separator = IS_WINDOWS ? ";" : ":";
  const current = process.env.PATH ?? process.env.Path ?? "";
  const currentSet = new Set(current.split(separator).map((item) => item.toLowerCase()));
  const additions = extraPathEntries().filter((entry) => !currentSet.has(entry.toLowerCase()));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [current, ...additions].filter(Boolean).join(separator),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TERM: "dumb",
  };
  if (IS_WINDOWS) {
    env.Path = env.PATH;
  }
  // The Node-based CLIs are bundles of several megabytes; Node's compile cache saves close to a
  // second on every cold start. Their own launchers set this, which Nearbox bypasses to avoid cmd.exe.
  if (!env.NODE_COMPILE_CACHE) {
    env.NODE_COMPILE_CACHE = join(tmpdir(), "nearbox-node-compile-cache");
  }
  return env;
}

async function whichAll(name: string): Promise<string[]> {
  const env = spawnEnv();
  const tool = IS_WINDOWS ? "where.exe" : "which";
  const args = IS_WINDOWS ? [name] : ["-a", name];
  return new Promise((resolve) => {
    execFile(tool, args, { env, windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(
        String(stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
  });
}

function rankCandidate(path: string): number {
  if (!IS_WINDOWS) {
    return 0;
  }
  const ext = extname(path).toLowerCase();
  return ext === ".exe" ? 0 : ext === ".cmd" ? 1 : ext === ".bat" ? 2 : ext === ".ps1" ? 4 : 3;
}

/**
 * Turn whatever `where` found into something Node can spawn without a shell.
 * Node refuses to spawn .cmd/.bat directly, so we look through the common
 * shim shapes (npm, cursor-agent) and call their real target instead.
 */
export function unwrapShim(path: string): ResolvedCommand {
  const ext = extname(path).toLowerCase();
  if (!IS_WINDOWS || ext === ".exe" || ext === "") {
    return { file: path, prefixArgs: [], display: path, viaCmd: false };
  }
  if (ext === ".cmd" || ext === ".bat") {
    const shimDir = dirname(path);
    let body = "";
    try {
      body = readFileSync(path, "utf8");
    } catch {
      body = "";
    }
    const exe = /"%dp0%\\([^"]+\.exe)"/i.exec(body);
    if (exe) {
      const target = join(shimDir, exe[1]!);
      if (existsSync(target)) {
        return { file: target, prefixArgs: [], display: target, viaCmd: false };
      }
    }
    const script = /"%dp0%\\([^"]+\.(?:c|m)?js)"/i.exec(body);
    if (script) {
      const target = join(shimDir, script[1]!);
      const node = findNode(shimDir);
      if (existsSync(target) && node) {
        return { file: node, prefixArgs: [target], display: `${node} ${target}`, viaCmd: false };
      }
    }
    if (/\.ps1"/i.test(body)) {
      const direct = resolveCursorAgentBundle(shimDir);
      if (direct) {
        return direct;
      }
    }
  }
  if (ext === ".ps1") {
    const direct = resolveCursorAgentBundle(dirname(path));
    if (direct) {
      return direct;
    }
  }
  const comspec = process.env.ComSpec || "cmd.exe";
  return { file: comspec, prefixArgs: [path], display: path, viaCmd: true };
}

function findNode(shimDir: string): string | null {
  const local = join(shimDir, "node.exe");
  if (existsSync(local)) {
    return local;
  }
  const candidates = [
    join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs", "node.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const candidate = join(entry, "node.exe");
    if (entry && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** cursor-agent ships its own node.exe + index.js inside versions/<date-hash>/. */
function resolveCursorAgentBundle(shimDir: string): ResolvedCommand | null {
  const inPlace = join(shimDir, "index.js");
  const inPlaceNode = join(shimDir, "node.exe");
  if (existsSync(inPlace) && existsSync(inPlaceNode)) {
    return { file: inPlaceNode, prefixArgs: [inPlace], display: `${inPlaceNode} ${inPlace}`, viaCmd: false };
  }
  const versionsDir = join(shimDir, "versions");
  if (!existsSync(versionsDir)) {
    return null;
  }
  const versions = readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(entry.name))
    .map((entry) => entry.name)
    .filter(
      (name) => existsSync(join(versionsDir, name, "node.exe")) && existsSync(join(versionsDir, name, "index.js")),
    )
    .sort((a, b) => versionKey(b) - versionKey(a));
  const latest = versions[0];
  if (!latest) {
    return null;
  }
  const node = join(versionsDir, latest, "node.exe");
  const script = join(versionsDir, latest, "index.js");
  return { file: node, prefixArgs: [script], display: `${node} ${script}`, viaCmd: false };
}

/**
 * Looking a command up means spawning `where`/`which`, a few hundred
 * milliseconds on every run. Found commands are remembered until the next
 * detection pass or until the file they point at is gone (CLI updated).
 */
const resolvedCommands = new Map<string, ResolvedCommand>();

export async function resolveAgentCommand(kind: AgentKind, override?: string): Promise<ResolvedCommand | null> {
  const key = `${kind}|${override?.trim() ?? ""}`;
  const cached = resolvedCommands.get(key);
  if (cached && existsSync(cached.file) && (cached.prefixArgs.length === 0 || existsSync(cached.prefixArgs[0]!))) {
    return cached;
  }
  resolvedCommands.delete(key);
  const resolved = await lookupAgentCommand(kind, override);
  if (resolved) {
    resolvedCommands.set(key, resolved);
  }
  return resolved;
}

async function lookupAgentCommand(kind: AgentKind, override?: string): Promise<ResolvedCommand | null> {
  if (override && override.trim()) {
    const trimmed = override.trim();
    if (existsSync(trimmed)) {
      return unwrapShim(trimmed);
    }
    const found = await whichAll(trimmed);
    return found.length ? unwrapShim(pickBest(found)) : null;
  }
  for (const name of COMMAND_NAMES[kind]) {
    const found = await whichAll(name);
    if (found.length) {
      return unwrapShim(pickBest(found));
    }
  }
  return null;
}

function pickBest(candidates: string[]): string {
  return [...candidates].sort((a, b) => rankCandidate(a) - rankCandidate(b))[0]!;
}

export async function detectAgents(
  overrides: Partial<Record<AgentKind, string | undefined>>,
): Promise<AgentInfo[]> {
  // A detection pass is the user's way of saying "look again".
  resolvedCommands.clear();
  return Promise.all(
    AGENT_KINDS.map(async (kind): Promise<AgentInfo> => {
      const resolved = await resolveAgentCommand(kind, overrides[kind]);
      return {
        kind,
        label: AGENT_LABELS[kind],
        available: resolved !== null,
        command: resolved?.display,
        detail: resolved ? undefined : `没有在 PATH 里找到 ${COMMAND_NAMES[kind][0]}`,
        supportsResume: true,
      };
    }),
  );
}

const MODEL_LIST_TIMEOUT_MS = 45_000;
const MODEL_LIST_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Ask the installed CLI which models it can use. Rejects with a sentence for
 * the UI when the CLI is missing, not logged in, or does not answer in time.
 */
export async function listAgentModels(kind: AgentKind, override?: string): Promise<AgentModel[]> {
  const listArgs = MODEL_LIST_ARGS[kind];
  if (!listArgs) {
    throw new Error(`${AGENT_LABELS[kind]} 没有列出模型的命令，请直接输入模型名。`);
  }
  const command = await resolveAgentCommand(kind, override);
  if (!command) {
    throw new Error(`没有找到 ${AGENT_LABELS[kind]} 的命令行工具。`);
  }
  // cmd.exe shims need one quoted line; direct executables take argv as-is.
  const invocation = command.viaCmd
    ? { file: command.file, args: ["/d", "/s", "/c", `"${[command.prefixArgs[0]!, ...listArgs].map(quoteForCmd).join(" ")}"`], verbatim: true }
    : { file: command.file, args: [...command.prefixArgs, ...listArgs], verbatim: false };
  const result = await capture(invocation.file, invocation.args, invocation.verbatim);
  const models = parseModelList(kind, result.stdout);
  if (!models.length) {
    const reason = firstLine(result.stderr) || firstLine(result.stdout) || (result.code === null ? "命令没有在限定时间内结束" : `退出码 ${result.code}`);
    throw new Error(`${AGENT_LABELS[kind]} 没有返回模型列表：${reason}`);
  }
  return models;
}

function capture(file: string, args: string[], windowsVerbatimArguments: boolean): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(file, args, { env: spawnEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill();
      }
    }, MODEL_LIST_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= MODEL_LIST_MAX_BYTES) {
        stdout.push(chunk);
      } else {
        child.kill();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`无法启动命令：${error.message}`));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      }
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end();
  });
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim())
      .find(Boolean) ?? ""
  );
}
