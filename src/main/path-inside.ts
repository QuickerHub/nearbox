import { isAbsolute, relative, resolve } from "node:path";

/**
 * True when `target` is `root` or a file/dir under it. Uses path.relative so a
 * sibling that only shares a string prefix (e.g. `renderer` vs `renderer2`)
 * cannot sneak past a `startsWith(root)` check.
 */
export function isPathInside(root: string, target: string): boolean {
  const base = resolve(root);
  const resolved = resolve(target);
  const rel = relative(base, resolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
