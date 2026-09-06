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
