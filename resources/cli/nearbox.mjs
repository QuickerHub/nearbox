#!/usr/bin/env node
// The `nearbox` command an agent gets while Nearbox runs it with delegation on.
// It talks to the local Nearbox API with a token scoped to that one run, so an
// agent can hand a sub-task to another agent on this PC and read its answer.
//
// Plain JavaScript with Node built-ins only: it is executed by Nearbox's own
// Electron binary in Node mode, straight from the app's resources folder.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const AGENT_LABELS = {
  cursor: "Cursor Agent",
  codex: "Codex",
  grok: "Grok Build",
  claude: "Claude Code",
  opencode: "opencode",
};

const AGENT_ALIASES = {
  cursor: "cursor",
  cursoragent: "cursor",
  agent: "cursor",
  codex: "codex",
  grok: "grok",
  grokbuild: "grok",
  claude: "claude",
  claudecode: "claude",
  opencode: "opencode",
};

/** How long `ask` blocks by default; under the shell-tool timeouts of the CLIs. */
export const DEFAULT_WAIT_SECONDS = 90;
/** Longest single wait a caller may request. */
export const MAX_WAIT_SECONDS = 110;
/** Each server-side long poll is bounded so a dead connection is noticed. */
const POLL_SLICE_MS = 30_000;

export const USAGE = `用法：
  nearbox ask <agent> [选项] <任务说明…>    把一个子任务交给另一个 Agent，等它做完并打印它的回答
  nearbox wait [子任务 ID] [--wait <秒>]     继续等某个子任务（默认最近一个）结束
  nearbox status                             列出这次运行委派出去的子任务

agent 可以是：cursor、codex、grok、claude、opencode

ask 的选项：
  --file <路径>          从文件读取任务说明（- 表示标准输入）；说明较长或有多行时用这个
  --project <名称|路径>  在哪个项目目录里做，默认和当前运行相同
  --model <模型>         指定模型
  --full / --safe        子任务的权限，默认和当前运行一样；不能超过当前运行自己的权限
  --continue             接着上一次委派给同一个 Agent 的会话说
  --no-wait              只提交不等待，之后用 nearbox wait 取结果
  --wait <秒>            最多等多久再返回（默认 ${DEFAULT_WAIT_SECONDS}，最多 ${MAX_WAIT_SECONDS}）

退出码：0 对方成功结束并已打印回答；1 出错或对方失败；2 对方还在工作（按提示继续等）`;

/** "Claude-Code" → "claude"; unknown names give undefined. */
export function agentKindOf(value) {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return AGENT_ALIASES[key];
}

/**
 * @typedef {{ command: "help" }
 *   | { command: "error", message: string }
 *   | { command: "status" }
 *   | { command: "wait", runId?: string, wait: number }
 *   | { command: "ask", agent: string, prompt: string, file?: string, project?: string, model?: string,
 *       access?: "safe" | "full", continue: boolean, wait: number }} ParsedArgs
 */

/** @returns {ParsedArgs} */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { command: "help" };
  }
  if (command === "status") {
    return { command: "status" };
  }
  if (command !== "ask" && command !== "wait") {
    return { command: "error", message: `不认识的子命令「${command}」。` };
  }

  /** @type {Record<string, string | boolean>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  const takesValue = new Set(["file", "project", "model", "wait"]);
  const flags = new Set(["full", "safe", "continue", "no-wait", "help"]);
  // Positionals before the free text: the agent for `ask`, the id for `wait`.
  const fixedPositionals = command === "ask" ? 1 : 0;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--") {
      positional.push(...rest.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (!takesValue.has(name) && !flags.has(name) && positional.length > fixedPositionals) {
      // Inside the prompt text an unknown "--something" is just words ("--verbose 也加上").
      positional.push(arg);
      continue;
    }
    if (takesValue.has(name)) {
      const value = equals === -1 ? rest[index + 1] : arg.slice(equals + 1);
      if (value === undefined) {
        return { command: "error", message: `--${name} 后面需要一个值。` };
      }
      options[name] = value;
      if (equals === -1) {
        index += 1;
      }
    } else if (flags.has(name)) {
      options[name] = true;
    } else {
      return { command: "error", message: `不认识的选项 --${name}。` };
    }
  }
  if (options.help) {
    return { command: "help" };
  }

  let wait = DEFAULT_WAIT_SECONDS;
  if (options.wait !== undefined) {
    const seconds = Number(options.wait);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return { command: "error", message: "--wait 需要一个秒数。" };
    }
    wait = Math.min(MAX_WAIT_SECONDS, Math.round(seconds));
  }

  if (command === "wait") {
    if (positional.length > 1) {
      return { command: "error", message: "wait 最多接受一个子任务 ID。" };
    }
    return { command: "wait", runId: positional[0], wait };
  }

  const [agentArg, ...words] = positional;
  if (!agentArg) {
    return { command: "error", message: "请指定交给哪个 Agent，例如：nearbox ask grok \"…\"" };
  }
  const agent = agentKindOf(agentArg);
  if (!agent) {
    return { command: "error", message: `不认识的 Agent「${agentArg}」，可选：cursor、codex、grok、claude、opencode。` };
  }
  if (options.full && options.safe) {
    return { command: "error", message: "--full 和 --safe 只能选一个。" };
  }
  return {
    command: "ask",
    agent,
    prompt: words.join(" ").trim(),
    file: typeof options.file === "string" ? options.file : undefined,
    project: typeof options.project === "string" ? options.project : undefined,
    model: typeof options.model === "string" ? options.model : undefined,
    access: options.full ? "full" : options.safe ? "safe" : undefined,
    continue: Boolean(options.continue),
    wait: options["no-wait"] ? 0 : wait,
  };
}

/** The run this command belongs to, from the environment Nearbox gave the agent. */
export function readContext(env) {
  const url = String(env.NEARBOX_URL ?? "").replace(/\/+$/, "");
  const token = String(env.NEARBOX_TOKEN ?? "");
  const runId = String(env.NEARBOX_RUN_ID ?? "");
  if (!url || !token || !runId) {
    return null;
  }
  return { url, token, runId };
}

export function shortId(id) {
  return String(id).slice(0, 8);
}

export function formatDuration(startedAt, finishedAt) {
  const start = Date.parse(startedAt ?? "");
  if (!Number.isFinite(start)) {
    return "";
  }
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const total = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function firstLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

async function api(context, path, init) {
  let response;
  try {
    response = await fetch(`${context.url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${context.token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (error) {
    throw new Error(`连不上 Nearbox（${context.url}）：${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message ?? `请求失败（HTTP ${response.status}）`);
  }
  return body;
}

function readPrompt(parsed) {
  if (parsed.file === undefined) {
    return parsed.prompt;
  }
  try {
    return readFileSync(parsed.file === "-" ? 0 : parsed.file, "utf8").trim();
  } catch (error) {
    throw new Error(`读不到任务说明文件 ${parsed.file}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function label(run) {
  return AGENT_LABELS[run.agent] ?? run.agent;
}

/**
 * Block until the sub-run ends or `seconds` pass. Prints the answer on
 * success; on timeout says how to keep waiting. Returns the exit code.
 */
async function waitAndReport(context, runId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let run = await api(context, `/api/runs/${encodeURIComponent(runId)}`);
  let lastHeartbeat = Date.now();
  while (run.status === "queued" || run.status === "running") {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    const slice = Math.min(POLL_SLICE_MS, remaining);
    run = await api(context, `/api/runs/${encodeURIComponent(runId)}?wait=${slice}`);
    if (Date.now() - lastHeartbeat >= POLL_SLICE_MS && (run.status === "queued" || run.status === "running")) {
      lastHeartbeat = Date.now();
      process.stderr.write(`${label(run)} ${run.status === "queued" ? "还在排队" : `还在工作（${formatDuration(run.startedAt)}）`}…\n`);
    }
  }
  return report(run);
}

function report(run) {
  const name = label(run);
  const summary = String(run.summary ?? "").trim();
  switch (run.status) {
    case "succeeded":
      process.stderr.write(`${name} 已完成，用时 ${formatDuration(run.startedAt, run.finishedAt) || "不到 1s"}。\n`);
      process.stdout.write(`${summary || `（${name} 结束了，但没有返回文字总结。）`}\n`);
      return 0;
    case "failed":
      process.stderr.write(`${name} 运行失败：${run.error ?? "未知原因"}\n`);
      if (summary && summary !== run.error) {
        process.stdout.write(`${summary}\n`);
      }
      return 1;
    case "cancelled":
      process.stderr.write(`${name} 的运行被停止了${run.error && run.error !== "已取消" ? `：${run.error}` : "。"}\n`);
      return 1;
    default: {
      const state = run.status === "queued" ? "还在排队，等其他运行结束后开始" : `还在工作（已 ${formatDuration(run.startedAt)}）`;
      process.stdout.write(`${name} ${state}。运行 \`nearbox wait ${shortId(run.id)}\` 继续等待，它做完后会返回它的回答。\n`);
      return 2;
    }
  }
}

async function runAsk(context, parsed) {
  const prompt = readPrompt(parsed);
  if (!prompt) {
    throw new Error("任务说明不能为空。把要做的事写在命令后面，或用 --file 指定文件。");
  }
  const child = await api(context, `/api/runs/${encodeURIComponent(context.runId)}/delegate`, {
    method: "POST",
    body: JSON.stringify({
      agent: parsed.agent,
      prompt,
      project: parsed.project,
      model: parsed.model,
      access: parsed.access,
      continue: parsed.continue,
    }),
  });
  const name = label(child);
  if (parsed.wait === 0) {
    process.stdout.write(`已交给 ${name}，子任务 ID ${shortId(child.id)}。用 \`nearbox wait ${shortId(child.id)}\` 取结果，\`nearbox status\` 看进度。\n`);
    return 0;
  }
  process.stderr.write(`已交给 ${name}（子任务 ${shortId(child.id)}），等待结果…\n`);
  return waitAndReport(context, child.id, parsed.wait);
}

async function runWait(context, parsed) {
  let runId = parsed.runId;
  if (!runId) {
    const { runs } = await api(context, `/api/runs/${encodeURIComponent(context.runId)}/children`);
    const latest = runs.at(-1);
    if (!latest) {
      throw new Error("这次运行还没有委派过子任务。");
    }
    runId = latest.id;
  }
  return waitAndReport(context, runId, parsed.wait);
}

async function runStatus(context) {
  const { runs } = await api(context, `/api/runs/${encodeURIComponent(context.runId)}/children`);
  if (!runs.length) {
    process.stdout.write("这次运行还没有委派过子任务。\n");
    return 0;
  }
  const status = { queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已停止" };
  for (const run of runs) {
    const duration = formatDuration(run.startedAt, run.finishedAt);
    process.stdout.write(
      `${shortId(run.id)}  ${label(run).padEnd(12)} ${(status[run.status] ?? run.status).padEnd(4)} ${duration.padEnd(7)} ${firstLine(run.message ?? run.prompt).slice(0, 60)}\n`,
    );
  }
  return 0;
}

export async function main(argv, env = process.env) {
  const parsed = parseArgs(argv);
  if (parsed.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.command === "error") {
    process.stderr.write(`${parsed.message}\n\n${USAGE}\n`);
    return 1;
  }
  const context = readContext(env);
  if (!context) {
    process.stderr.write("nearbox 命令只能在 Nearbox 启动、并开启了「可委派」的 Agent 运行里使用（需要 NEARBOX_URL / NEARBOX_TOKEN / NEARBOX_RUN_ID）。\n");
    return 1;
  }
  try {
    if (parsed.command === "ask") {
      return await runAsk(context, parsed);
    }
    if (parsed.command === "wait") {
      return await runWait(context, parsed);
    }
    return await runStatus(context);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
