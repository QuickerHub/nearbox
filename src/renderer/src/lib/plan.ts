import type { AgentInfo, AgentKind, AgentRun, Task } from "../../../shared/protocol";

/**
 * What pressing "send" will do. There is exactly one composer in the app, so
 * the button label and the hint under it must always say what happens next.
 */
export type SendAction =
  /** No task open, no agent picked: drop the text into the inbox. */
  | "capture"
  /** No task open: create a task and dispatch it in one go. */
  | "create-run"
  /** Task open: save the text as a note only. */
  | "note"
  /** Task open, empty draft: dispatch the task as-is. */
  | "run"
  /** Task open: save the text as a note, then dispatch (the note rides along in the prompt). */
  | "note-run"
  /** Task open: continue the previous agent session with this text. */
  | "reply";

export interface SendPlan {
  action: SendAction;
  label: string;
  hint: string;
  enabled: boolean;
}

export interface PlanInput {
  task?: Task;
  draft: string;
  agent: AgentKind | "";
  agentLabel: string;
  agentInfo?: AgentInfo;
  projectId: string;
  projectName: string;
  latestRun?: AgentRun;
  activeRun?: AgentRun;
  activeAgentLabel?: string;
}

export function planSend(input: PlanInput): SendPlan {
  const text = input.draft.trim();
  const { task, agent, agentLabel, projectId, projectName } = input;

  if (!task) {
    if (!agent) {
      return { action: "capture", label: "记录", hint: "记到收集箱，稍后再决定派给谁。", enabled: Boolean(text) };
    }
    if (!projectId) {
      return { action: "create-run", label: "发送并运行", hint: "先选一个项目目录，Agent 才知道在哪干活。", enabled: false };
    }
    return {
      action: "create-run",
      label: "发送并运行",
      hint: `新建任务，立刻交给 ${agentLabel} 在「${projectName}」里执行。`,
      enabled: Boolean(text),
    };
  }

  if (input.activeRun) {
    return {
      action: "note",
      label: "记录",
      hint: `${input.activeAgentLabel ?? "Agent"} 正在工作；现在发送只会记为备注，下次运行会带上。`,
      enabled: Boolean(text),
    };
  }
  if (!agent) {
    return { action: "note", label: "记录", hint: "只记为备注，不运行。选一个 Agent 才会开跑。", enabled: Boolean(text) };
  }
  if (!projectId) {
    return { action: "run", label: "运行", hint: "先选一个项目目录，Agent 才知道在哪干活。", enabled: false };
  }

  const previous = input.latestRun;
  const canReply =
    Boolean(previous) &&
    !isActive(previous!) &&
    Boolean(previous!.sessionId) &&
    previous!.agent === agent &&
    previous!.projectId === projectId &&
    input.agentInfo?.supportsResume !== false;

  if (text) {
    if (canReply) {
      return { action: "reply", label: "继续对话", hint: `接着上一次 ${agentLabel} 的会话继续说。`, enabled: true };
    }
    return {
      action: "note-run",
      label: "发送并运行",
      hint: `记为备注，并把整个任务交给 ${agentLabel} 在「${projectName}」里执行。`,
      enabled: true,
    };
  }
  return {
    action: "run",
    label: previous ? "重新运行" : "运行",
    hint: `把这个任务交给 ${agentLabel} 在「${projectName}」里执行。也可以先输入补充说明。`,
    enabled: true,
  };
}

function isActive(run: Pick<AgentRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}
