import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Drop abandoned upload temps left behind after a crash or client abort. */
export async function removeStaleStagingParts(
  stagingDir: string,
  olderThanMs: number,
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(stagingDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  for (const name of entries) {
    if (!name.endsWith(".part")) {
      continue;
    }
    const path = join(stagingDir, name);
    try {
      const info = await stat(path);
      if (!info.isFile() || now - info.mtimeMs < olderThanMs) {
        continue;
      }
      await unlink(path);
      removed += 1;
    } catch {
      /* racing with a live upload or already gone */
    }
  }
  return removed;
}
