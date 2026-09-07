import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { cursorStateDbPath, readCursorIdeModels } from "./cursor-ide-state.ts";

const APPLICATION_USER_KEY =
  "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

test("Cursor state db path follows the platform config dir", () => {
  const windows = cursorStateDbPath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "C:\\Users\\x");
  assert.match(windows.replaceAll("\\", "/"), /Cursor\/User\/globalStorage\/state\.vscdb$/);
});

test("readCursorIdeModels pulls the toggle list from applicationUser", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cursor-ide-"));
  const dbPath = join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    APPLICATION_USER_KEY,
    JSON.stringify({
      availableDefaultModels2: [
        { name: "grok-4.6", defaultOn: true, clientDisplayName: "Cursor Grok 4.6" },
        { name: "gpt-5.5", defaultOn: false, clientDisplayName: "GPT-5.5" },
      ],
      aiSettings: { modelOverrideEnabled: ["gpt-5.5"], modelOverrideDisabled: [] },
    }),
  );
  db.close();
  try {
    const prefs = readCursorIdeModels(dbPath);
    assert.deepEqual(
      prefs?.map((item) => [item.id, item.visible]),
      [
        ["grok-4.6", true],
        ["gpt-5.5", true],
      ],
    );
    assert.equal(readCursorIdeModels(join(dir, "missing.vscdb")), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
