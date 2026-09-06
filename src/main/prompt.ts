// Pure helpers for the text handed to an agent CLI. No Node or shared-module
// imports so this stays unit-testable under plain `node --test`.

export interface PromptAttachment {
  name: string;
  /** Where the agent will find the file: a path on this PC, or on the device the run happens on. */
  path: string;
  mediaType: string;
}

function isImageMediaType(mediaType: string): boolean {
  return /^image\//i.test(mediaType.trim());
}

/**
 * The "## 附件" section shared by task prompts and follow-up turns. Images are
 * tagged so the agent knows to look at them rather than read them as text.
 */
export function attachmentSection(attachments: readonly PromptAttachment[], remote: boolean): string[] {
  if (!attachments.length) {
    return [];
  }
  const heading = remote ? "## 附件（已复制到这台电脑上，可直接读取）" : "## 附件（本机路径，可直接读取）";
  return [heading, ...attachments.map((file) => `- ${isImageMediaType(file.mediaType) ? "图片" : "文件"}：${file.path}`), ""];
}

/**
 * A follow-up typed in the composer: the user's words, then the files they
 * sent with them. One message in the UI becomes text + paths for the agent.
 */
export function buildTurnPrompt(message: string, attachments: readonly PromptAttachment[], remote: boolean): string {
  const text = message.replace(/\r\n/g, "\n").trim();
  if (!attachments.length) {
    return text;
  }
  const lines = [text || "请查看以下附件。", "", ...attachmentSection(attachments, remote)];
  return lines.join("\n").trimEnd();
}

/** Paths of the images among `attachments`, for CLIs that take images as arguments. */
export function imagePaths(attachments: readonly PromptAttachment[]): string[] {
  return attachments.filter((file) => isImageMediaType(file.mediaType)).map((file) => file.path);
}

export interface DelegateTarget {
  /** What goes on the command line: "grok", "claude"… */
  kind: string;
  label: string;
}

/**
 * The section that tells an agent it has the `nearbox` command. `waitSeconds`
 * is how long `nearbox ask` blocks before handing back a "still working" note,
 * kept under the shell-tool timeouts of the CLIs.
 */
export function delegationSection(targets: readonly DelegateTarget[], waitSeconds: number): string[] {
  if (!targets.length) {
    return [];
  }
  const first = targets[0]!.kind;
  const second = targets[1]?.kind ?? first;
  return [
    "## 可以委派给其他 Agent",
    `这台电脑上还能调用：${targets.map((target) => `${target.label}（${target.kind}）`).join("、")}。`,
    "遇到能独立完成的子任务、需要另一个模型审查或给第二意见时，用 `nearbox` 命令交给它们；命令会等对方做完，把它的回答原样打印出来：",
    "",
    `    nearbox ask ${first} "给 src/api 里的接口补上单元测试并跑通"`,
    `    nearbox ask ${second} --file .nearbox-task.md`,
    "",
    "- 说明较长或有多行时先写进文件再用 `--file` 交；`--file -` 从标准输入读。",
    "- 子任务默认在当前项目目录里做、权限和你一样；`--project <名称或路径>` 换项目，`--model <模型>` 指定模型，`--safe` 收紧权限（不能超过你自己的权限）。",
    "- `--continue` 接着上一次委派给同一个 Agent 的会话说，它记得之前的内容。",
    `- 等待超过 ${waitSeconds} 秒命令会先返回并告诉你怎么继续等（\`nearbox wait\`）；\`nearbox status\` 列出已委派的子任务。`,
    "- 对方和你共用同一个工作目录：它做完之前不要改同一批文件。`--no-wait` 只提交不等待，适合让它在别的项目里干活。",
    "- 只在确实省时间时才委派，简单的事自己做更快。",
    "",
  ];
}

/**
 * What a delegated agent receives: the parent's words, then who is asking and
 * where to work. Follow-ups in the same conversation get the words alone.
 */
export function buildDelegatedPrompt(message: string, from: string, project: { name: string; path: string }, followUp: boolean): string {
  const text = message.replace(/\r\n/g, "\n").trim();
  if (followUp) {
    return text;
  }
  return [
    text,
    "",
    "## 说明",
    `- 这个任务由 ${from} 委派给你，它会直接读取你最后的回答：请把结论、改了哪些文件、还有什么没做完写清楚。`,
    `- 当前工作目录是项目「${project.name}」（${project.path}），只改这个项目里的文件。`,
  ].join("\n");
}
