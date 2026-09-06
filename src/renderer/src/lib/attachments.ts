import type { FileMeta } from "../../../shared/protocol";

/** The subset of `File` the staging logic looks at, so it can be tested without a DOM. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

/** A file sitting in the composer, not yet sent. */
export interface DraftAttachment<F extends FileLike = File> {
  key: string;
  file: F;
  kind: "image" | "file";
  /** Object URL for the thumbnail; images only. Revoked when the chip goes away. */
  previewUrl: string | null;
  /** Set once the file has reached the PC, so a failed send does not upload it twice. */
  uploaded?: FileMeta;
}

export function isLikelyImage(file: Pick<FileLike, "name" | "type">): boolean {
  if (/^image\//i.test(file.type)) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name);
}

function identity(file: FileLike): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export interface StageResult<F extends FileLike> {
  next: DraftAttachment<F>[];
  added: DraftAttachment<F>[];
  /** Same name, size and mtime as something already staged. */
  duplicates: number;
  /** Would have gone over `limit`. */
  overflow: number;
}

/**
 * Add files to the draft: the same file twice is ignored, and the message
 * never carries more than `limit` files. `preview` is only asked for images.
 */
export function stageFiles<F extends FileLike>(
  current: readonly DraftAttachment<F>[],
  incoming: readonly F[],
  limit: number,
  preview: (file: F) => string | null,
): StageResult<F> {
  const seen = new Set(current.map((item) => identity(item.file)));
  const added: DraftAttachment<F>[] = [];
  let duplicates = 0;
  let overflow = 0;
  for (const file of incoming) {
    const id = identity(file);
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    if (current.length + added.length >= limit) {
      overflow += 1;
      continue;
    }
    seen.add(id);
    const image = isLikelyImage(file);
    added.push({
      key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      kind: image ? "image" : "file",
      previewUrl: image ? preview(file) : null,
    });
  }
  return { next: [...current, ...added], added, duplicates, overflow };
}

/** What the composer says when some of a paste or drop did not make it in. */
export function stageNotice(result: Pick<StageResult<FileLike>, "duplicates" | "overflow">, limit: number): string | null {
  if (result.overflow) {
    return `一条消息最多带 ${limit} 个文件，多出的 ${result.overflow} 个没有加入。`;
  }
  if (result.duplicates) {
    return result.duplicates === 1 ? "这个文件已经在附件里了。" : `${result.duplicates} 个文件已经在附件里了。`;
  }
  return null;
}

/**
 * Files in a paste or drop. Chrome fills `files` for most sources; a screenshot
 * pasted from some apps only shows up under `items`.
 */
export function extractFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) {
    return [];
  }
  const direct = Array.from(data.files ?? []);
  if (direct.length) {
    return direct;
  }
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** A task recorded from pictures alone still needs a title. */
export function titleForFiles(files: readonly Pick<FileMeta, "name" | "mediaType">[]): string {
  if (files.length === 1) {
    return files[0]!.name;
  }
  const images = files.filter((file) => /^image\//i.test(file.mediaType)).length;
  return images === files.length ? `${files.length} 张图片` : `${files.length} 个文件`;
}
