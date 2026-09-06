import { canContinueRun } from "../../../shared/conversation.ts";
import type { AgentInfo, AgentKind, AgentRun, Task } from "../../../shared/protocol";

/**
 * What pressing "send" will do. There is exactly one composer in the app, so
 * the button label and the hint under it must always say what happens next.
 */
export type SendAction =
  /** No task open, no agent picked: drop the text into the inbox. */
  | "capture"
  /** No task open: create a task and open a conversation with the agent in one go. */
  | "create-run"
  /** Task open: save the text as a note only. */
  | "note"
  /** Task open, empty draft, no conversation yet: hand the task itself to the agent. */
  | "run"
  /** Task open: save the text as a note, then start a new conversation (the note rides along in the prompt). */
  | "note-run"
  /** Task open: continue the task's agent conversation with this text; queued while the agent is still busy. */
  | "reply";

export interface SendPlan {
  action: SendAction;
  label: string;
  hint: string;
  enabled: boolean;
  /** The run this message continues (action "reply"). */
  resumeRunId?: string;
  /** The message will wait for the turn that is running now. */
  queued?: boolean;
  /** This message continues an existing conversation (the UI offers "改为新会话"). */
  continuing?: boolean;
  /** A conversation could be continued but the user asked for a fresh one (the UI offers "接着上次会话"). */
  canContinue?: boolean;
}

export interface PlanInput {
  task?: Task;
  draft: string;
  agent: AgentKind | "";
  agentLabel: string;
  agentInfo?: AgentInfo;
  projectId: string;
  projectName: string;
  /** Every run the client knows about; needed to follow a conversation's resume chain. */
  runs: readonly AgentRun[];
  /** The task's newest run (`task.latestRunId`). */
  latestRun?: AgentRun;
  /** Start a new agent session instead of continuing the existing one. */
  fresh?: boolean;
}

export function planSend(input: PlanInput): SendPlan {
  const text = input.draft.trim();
  const { task, agent, agentLabel, projectId, projectName, runs, latestRun } = input;

  if (!task) {
    if (!agent) {
      return { action: "capture", label: "记录", hint: "记到收集箱，稍后再决定派给谁。", enabled: Boolean(text) };
    }
    if (!projectId) {
      return { action: "create-run", label: "发送", hint: "先选一个项目目录，Agent 才知道在哪干活。", enabled: false };
    }
    return {
      action: "create-run",
      label: "发送",
      hint: `新建任务，交给 ${agentLabel} 在「${projectName}」里开始一段会话。`,
      enabled: Boolean(text),
    };
  }

  if (!agent) {
    return { action: "note", label: "记录", hint: "只记为备注，不发给 Agent。选一个 Agent 才会开跑。", enabled: Boolean(text) };
  }
  if (!projectId) {
    return { action: "run", label: "发送", hint: "先选一个项目目录，Agent 才知道在哪干活。", enabled: false };
  }

  const active = runs.find((run) => run.taskId === task.id && (run.status === "queued" || run.status === "running"));
  const busy = Boolean(active);
  const conversation =
    Boolean(latestRun) &&
    latestRun!.agent === agent &&
    latestRun!.projectId === projectId &&
    input.agentInfo?.supportsResume !== false &&
    canContinueRun(runs, latestRun!);

  if (conversation && !input.fresh) {
    const hint = busy ? `${agentLabel} 正在工作；这条会排队，等这一轮结束后接着发给它。` : `接着和 ${agentLabel} 的这段会话说。`;
    return { action: "reply", label: "发送", hint, enabled: Boolean(text), resumeRunId: latestRun!.id, queued: busy, continuing: true };
  }

  const canContinue = conversation && Boolean(input.fresh);
  if (busy) {
    const activeLabel = active && active.agent !== agent ? "另一个 Agent" : agentLabel;
    return {
      action: text ? "note-run" : "run",
      label: text ? "发送" : "运行",
      hint: `${activeLabel} 正在工作；这条会排队，之后作为新会话交给 ${agentLabel}。`,
      enabled: true,
      queued: true,
      canContinue,
    };
  }
  if (text) {
    return {
      action: "note-run",
      label: "发送",
      hint: canContinue
        ? `新开一段会话：把任务和这句话一起交给 ${agentLabel}，不带之前的上下文。`
        : `把任务和这句话一起交给 ${agentLabel} 在「${projectName}」里开始一段会话。`,
      enabled: true,
      canContinue,
    };
  }
  return {
    action: "run",
    label: "运行",
    hint: canContinue
      ? `新开一段会话，把这个任务重新交给 ${agentLabel}。也可以先输入补充说明。`
      : `把这个任务交给 ${agentLabel} 在「${projectName}」里执行。也可以先输入补充说明。`,
    enabled: true,
    canContinue,
  };
}
