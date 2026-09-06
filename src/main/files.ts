import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { FORBIDDEN_EXTENSIONS, isImageMediaType } from "@shared/protocol";

const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function sanitizeFileName(raw: string | undefined, fallback: string): string {
  const leaf = basename((raw ?? "").replaceAll("\\", "/")).trim();
  const cleaned = leaf.replace(/[<>:"/|?*\u0000-\u001f]/g, "_").replace(/\.+$/g, "").trim();
  const stem = cleaned || fallback;
  const ext = extname(stem);
  const name = stem.slice(0, stem.length - ext.length) || fallback;
  const upper = name.toUpperCase();
  if (WINDOWS_RESERVED.has(upper)) {
    return `${name}_${fallback}${ext}`;
  }
  return `${name}${ext}`.slice(0, 180);
}

export function assertAllowedFile(fileName: string, mediaType: string): void {
  const ext = extname(fileName).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.includes(ext)) {
    throw Object.assign(new Error("出于安全考虑，不接收可执行文件或脚本。"), { code: "FILE_FORBIDDEN" });
  }
  const type = mediaType.split(";")[0]?.trim().toLowerCase();
  if (
    type === "application/x-msdownload" ||
    type === "application/x-dosexec" ||
    type === "application/x-msdos-program"
  ) {
    throw Object.assign(new Error("出于安全考虑，不接收可执行文件。"), { code: "FILE_FORBIDDEN" });
  }
}

export async function uniquePath(directory: string, fileName: string): Promise<string> {
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = join(directory, fileName);
  for (let index = 1; index < 1000; index += 1) {
    try {
      await mkdir(directory, { recursive: true });
      const handle = await import("node:fs/promises").then((fs) =>
        fs.open(candidate, "wx"),
      );
      await handle.close();
      await unlink(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      candidate = join(directory, `${stem} (${index})${ext}`);
    }
  }
  throw new Error("无法生成不冲突的文件名。");
}

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

    const target = await uniquePath(options.inboxDir, fileName);
    await rename(tempPath, target);
    return {
      storedName: basename(target),
      byteLength: received,
      mediaType: options.mediaType.split(";")[0]?.trim() || "application/octet-stream",
    };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
