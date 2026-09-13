import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write `payload` to `file` via tmp + fsync + rename. A crash after rename cannot
 * leave a zero-length state.json from an unsynced tmp the way writeFile+rename can.
 */
export async function writeJsonAtomic(file: string, payload: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}
