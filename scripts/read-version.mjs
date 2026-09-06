import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = String(pkg.version ?? "").trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`package.json 的 version 必须是 semver，当前是 ${version}`);
  }
  return version;
}

export function versionCodeFromName(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function stripTagPrefix(tag) {
  return String(tag ?? "")
    .trim()
    .replace(/^v/i, "");
}

export { root };
