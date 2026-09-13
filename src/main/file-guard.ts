/**
 * Filename sanitization and upload allow-list. Runtime-import free of the
 * protocol barrel so `node --test` can cover the edges without path aliases.
 */

import { basename, extname } from "node:path";

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

/** Bidirectional / zero-width marks that can hide a real `.exe` from extname. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

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
  const leaf = basename((raw ?? "").replaceAll("\\", "/").replace(INVISIBLE, "")).trim();
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
  const ext = extname(fileName.replace(INVISIBLE, "")).toLowerCase();
  if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(ext)) {
    throw Object.assign(new Error("出于安全考虑，不接收可执行文件或脚本。"), { code: "FILE_FORBIDDEN" });
  }
  const type = normalizeMediaType(mediaType);
  if (
    type === "application/x-msdownload" ||
    type === "application/x-dosexec" ||
    type === "application/x-msdos-program"
  ) {
    throw Object.assign(new Error("出于安全考虑，不接收可执行文件。"), { code: "FILE_FORBIDDEN" });
  }
}

const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;

/**
 * Content-Type from an upload request. Arrays, parameters, CR/LF and junk
 * become `application/octet-stream` so we never store or reflect them.
 */
export function normalizeMediaType(raw: unknown, fallback = "application/octet-stream"): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") {
    return fallback;
  }
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return MEDIA_TYPE_RE.test(type) ? type : fallback;
}
