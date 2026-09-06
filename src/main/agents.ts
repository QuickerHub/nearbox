import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { AGENT_KINDS, AGENT_LABELS, type AgentInfo, type AgentKind } from "@shared/protocol";
import { type ResolvedCommand, versionKey } from "./agent-output";

export {
  buildInvocation,
  createOutputParser,
  quoteForCmd,
  truncate,
  type Invocation,
  type InvocationRequest,
  type OutputParser,
  type ParseResult,
  type ResolvedCommand,
} from "./agent-output";

const IS_WINDOWS = process.platform === "win32";

/** Names each agent is installed under, in preference order. */
const COMMAND_NAMES: Record<AgentKind, string[]> = {
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

export async function resolveAgentCommand(kind: AgentKind, override?: string): Promise<ResolvedCommand | null> {
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
