import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MAX_CLI_CONFIG_CHARS, ensureCursorAgentHttp1, resetCursorHttp1Ensure } from "./cursor-http.ts";
import { MAX_APPLICATION_USER_CHARS, readCursorIdeModels } from "./cursor-ide-state.ts";

const APPLICATION_USER_KEY =
  "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

test("ensureCursorAgentHttp1 refuses an oversized cli-config.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cli-config-"));
  const path = join(dir, "cli-config.json");
  writeFileSync(path, "x".repeat(MAX_CLI_CONFIG_CHARS + 1), "utf8");
  resetCursorHttp1Ensure();
  try {
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: dir }, dir), false);
  } finally {
    resetCursorHttp1Ensure();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCursorIdeModels skips an oversized applicationUser blob", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cursor-blob-"));
  const dbPath = join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(APPLICATION_USER_KEY, "x".repeat(MAX_APPLICATION_USER_CHARS + 1));
  db.close();
  try {
    assert.equal(readCursorIdeModels(dbPath), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
