/**
 * Soft / force / abandon controls for an in-flight `session/prompt`.
 * Shared by AgentHost and Electron-free hung-prompt smoke tests.
 */

export type ControllablePrompt = {
  /** JSON-RPC id of the outstanding `session/prompt` request. */
  requestId: number;
};

/** Structural map so `Map<string, ActivePrompt>` stays compatible (Map is invariant). */
export type PromptSlotMap = {
  has(sessionId: string): boolean;
  get(sessionId: string): ControllablePrompt | undefined;
  delete(sessionId: string): boolean;
};

/** Subset of AcpConnection used to stop a hung turn. */
export type PromptControlConnection = {
  notify(method: string, params: unknown): void;
  cancelRequest(id: number): void;
  rejectPending(id: number, error: Error): boolean;
};

/** Ask the agent to stop the turn (`session/cancel`). No-op when idle. */
export function softCancelSessionPrompt(
  connection: PromptControlConnection,
  prompts: PromptSlotMap,
  sessionId: string,
): void {
  if (prompts.has(sessionId)) {
    connection.notify("session/cancel", { sessionId });
  }
}

/**
 * Escalate with `$/cancel_request` when soft cancel was ignored.
 * Keeps the host process up for other sessions.
 */
export function forceCancelSessionPrompt(
  connection: PromptControlConnection,
  prompts: PromptSlotMap,
  sessionId: string,
): void {
  const prompt = prompts.get(sessionId);
  if (!prompt) {
    return;
  }
  connection.cancelRequest(prompt.requestId);
}

/**
 * Reject the in-flight `session/prompt` locally so the turn can finish even when
 * the agent ignores soft cancel and `$/cancel_request`. Removes the slot.
 */
export function abandonSessionPrompt(
  connection: PromptControlConnection,
  prompts: PromptSlotMap,
  sessionId: string,
  reason = "本轮已取消",
): boolean {
  const prompt = prompts.get(sessionId);
  if (!prompt) {
    return false;
  }
  const rejected = connection.rejectPending(prompt.requestId, new Error(reason));
  prompts.delete(sessionId);
  return rejected;
}
