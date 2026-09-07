import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Same shape as ResolvedCommand, kept local so this file stays free of `@shared`. */
export interface CursorBundle {
  file: string;
  prefixArgs: string[];
  display: string;
  viaCmd: false;
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
  if (existsSync(inPlace) && existsSync(inPlaceNode)) {
    return { file: inPlaceNode, prefixArgs: [inPlace], display: `${inPlaceNode} ${inPlace}`, viaCmd: false };
  }
  const versionsDir = join(shimDir, "versions");
  if (!existsSync(versionsDir)) {
    return null;
  }
  const versions = readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(versionsDir, name, "node.exe")) && existsSync(join(versionsDir, name, "index.js")))
    .sort((a, b) => versionKey(b) - versionKey(a));
  const latest = versions[0];
  if (!latest) {
    return null;
  }
  const node = join(versionsDir, latest, "node.exe");
  const script = join(versionsDir, latest, "index.js");
  return { file: node, prefixArgs: [script], display: `${node} ${script}`, viaCmd: false };
}
