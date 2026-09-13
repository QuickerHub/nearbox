/**
 * Filename sanitization and upload allow-list. Runtime-import free of the
 * protocol barrel so `node --test` can cover the edges without path aliases.
 */

import { basename, extname, isAbsolute, relative, resolve } from "node:path";

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

/**
 * Inbox folder leaf for a paired device. Windows reserved device names
 * (`NUL`, `CON`, …) would alias to the console if used as a folder; trailing
 * dots/spaces are stripped because NTFS ignores them (`foo.` → `foo`).
 */
export function inboxFolderSegment(raw: string): string {
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "phone";
  let leaf = cleaned.slice(0, 60);
  // All-dot names are left for the caller; stripping them would hide `..`.
  if (/[^. ]/.test(leaf)) {
    leaf = leaf.replace(/[. ]+$/g, "") || "phone";
  }
  const key = leaf.split(".")[0]!.toUpperCase();
  if (WINDOWS_RESERVED.has(leaf.toUpperCase()) || WINDOWS_RESERVED.has(key)) {
    return `${leaf}_phone`.slice(0, 60);
  }
  return leaf;
}

/** True when `filePath` is `inboxDir` or a file/dir under it (not a prefix sibling). */
export function isInboxPath(inboxDir: string, filePath: string): boolean {
  const base = resolve(inboxDir);
  const resolved = resolve(filePath);
  const rel = relative(base, resolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
