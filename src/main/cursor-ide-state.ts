import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseCursorIdeModels } from "../shared/cursor-ide-models.ts";
import type { IdeModelPref } from "../shared/protocol.ts";

const APPLICATION_USER_KEY =
  "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

/** Cursor IDE's global state DB (VS Code-style). Missing when Cursor is not installed. */
export function cursorStateDbPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (process.platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "Cursor", "User", "globalStorage", "state.vscdb");
}

/**
 * Read Settings → Models from the local Cursor IDE. Read-only; a locked or
 * missing DB just means we keep the CLI catalog and the version heuristic.
 */
export function readCursorIdeModels(dbPath = cursorStateDbPath()): IdeModelPref[] | undefined {
  if (!existsSync(dbPath)) {
    return undefined;
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(APPLICATION_USER_KEY) as { value?: unknown } | undefined;
      const raw = row?.value;
      const text = typeof raw === "string" ? raw : raw instanceof Uint8Array ? Buffer.from(raw).toString("utf8") : undefined;
      if (!text) {
        return undefined;
      }
      return parseCursorIdeModels(JSON.parse(text));
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
