import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { isImageMediaType } from "@shared/protocol";
import { assertAllowedFile, sanitizeFileName, uniquePath } from "./file-guard";

export { assertAllowedFile, sanitizeFileName, uniquePath } from "./file-guard";

export async function receiveToInbox(options: {
  request: IncomingMessage;
  inboxDir: string;
  stagingDir: string;
  fileName: string;
  mediaType: string;
  maxBytes: number;
}): Promise<{ storedName: string; byteLength: number; mediaType: string }> {
  const fileName = sanitizeFileName(options.fileName, isImageMediaType(options.mediaType) ? "image" : "file");
  assertAllowedFile(fileName, options.mediaType);
  await mkdir(options.stagingDir, { recursive: true });
  await mkdir(options.inboxDir, { recursive: true });

  const tempPath = join(options.stagingDir, `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}.part`);
  let received = 0;
  let target: string | undefined;
  try {
    await pipeline(
      options.request,
      async function* (source) {
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > options.maxBytes) {
            throw Object.assign(new Error("文件超过允许的大小。"), { code: "FILE_TOO_LARGE" });
          }
          yield buffer;
        }
      },
      createWriteStream(tempPath, { flags: "wx" }),
    );

    target = await uniquePath(options.inboxDir, fileName);
    await rename(tempPath, target);
    return {
      storedName: basename(target),
      byteLength: received,
      mediaType: options.mediaType.split(";")[0]?.trim() || "application/octet-stream",
    };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    if (target) {
      await unlink(target).catch(() => undefined);
    }
    throw error;
  }
}
