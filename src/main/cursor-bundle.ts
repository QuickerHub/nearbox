import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Same shape as ResolvedCommand, kept local so this file stays free of `@shared`. */
export interface CursorBundle {
  file: string;
  prefixArgs: string[];
  display: string;
  viaCmd: false;
}

/**
 * Bundled node.exe / index.js must be plain non-empty files. `existsSync` /
 * `statSync` follow symlinks; a versions tree (or binary) symlink could otherwise
 * point the resolver outside the shim dir, and a zero-byte placeholder would
 * look "installed" until spawn fails.
 */
export function isUsableBundleFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** `versions/` itself must be a real directory — not a symlink to an attacker tree. */
export function isPlainDirectory(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function versionKey(name: string): number {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?/.exec(name);
  if (!match) {
    return 0;
  }
  const [, y, m, d, hh = "0", mm = "0", ss = "0"] = match;
  return Number(y) * 1e10 + Number(m) * 1e8 + Number(d) * 1e6 + Number(hh) * 1e4 + Number(mm) * 1e2 + Number(ss);
}

/** cursor-agent ships its own node.exe + index.js inside versions/<date-hash>/. */
export function resolveCursorAgentBundle(shimDir: string): CursorBundle | null {
  const inPlace = join(shimDir, "index.js");
  const inPlaceNode = join(shimDir, "node.exe");
  if (isUsableBundleFile(inPlace) && isUsableBundleFile(inPlaceNode)) {
    return { file: inPlaceNode, prefixArgs: [inPlace], display: `${inPlaceNode} ${inPlace}`, viaCmd: false };
  }
  const versionsDir = join(shimDir, "versions");
  if (!existsSync(versionsDir) || !isPlainDirectory(versionsDir)) {
    return null;
  }
  let entries;
  try {
    entries = readdirSync(versionsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const versions = entries
    .filter(
      (entry) =>
        !entry.isSymbolicLink() && entry.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(entry.name),
    )
    .map((entry) => entry.name)
    .filter(
      (name) =>
        isUsableBundleFile(join(versionsDir, name, "node.exe")) &&
        isUsableBundleFile(join(versionsDir, name, "index.js")),
    )
    .sort((a, b) => versionKey(b) - versionKey(a));
  const latest = versions[0];
  if (!latest) {
    return null;
  }
  const node = join(versionsDir, latest, "node.exe");
  const script = join(versionsDir, latest, "index.js");
  return { file: node, prefixArgs: [script], display: `${node} ${script}`, viaCmd: false };
}
