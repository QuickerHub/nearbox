/**
 * Filename sanitization and upload allow-list. Runtime-import free of the
 * protocol barrel so `node --test` can cover the edges without path aliases.
 */

import { mkdir, open } from "node:fs/promises";
import { basename, extname, join } from "node:path";

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

/** Keep in sync with `FORBIDDEN_EXTENSIONS` in `src/shared/protocol.ts`. */
const FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".msi",
  ".msp",
  ".scr",
  ".js",
  ".jse",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".hta",
  ".lnk",
  ".reg",
  ".url",
  ".apk",
];

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
  if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(ext)) {
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

/**
 * Reserve `fileName` in `directory` with O_EXCL and leave the empty file in
 * place so a concurrent caller cannot claim the same name before rename.
 */
export async function uniquePath(directory: string, fileName: string): Promise<string> {
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  await mkdir(directory, { recursive: true });
  let candidate = join(directory, fileName);
  for (let index = 1; index < 1000; index += 1) {
    try {
      const handle = await open(candidate, "wx");
      await handle.close();
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
