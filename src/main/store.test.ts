import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "./store.ts";

function tempStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "nearbox-store-"));
}

test("Store starts empty when no state file exists", () => {
  const dir = tempStoreDir();
  try {
    const store = new Store(dir);
    assert.equal(store.state.version, 1);
    assert.deepEqual(store.state.tasks, []);
    assert.deepEqual(store.state.runs, []);
    assert.deepEqual(store.state.projects, []);
    assert.ok(store.file.endsWith("state.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Store load turns in-flight runs into failed and migrates legacy note.file", async () => {
  const dir = tempStoreDir();
  try {
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "t1",
            title: "x",
            details: null,
            status: "doing",
            priority: null,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
            notes: [
              {
                id: "n1",
                text: "pic",
                createdAt: "2026-09-01T00:00:00.000Z",
                file: { id: "f1", name: "a.png", mediaType: "image/png", byteLength: 12 },
              },
            ],
          },
        ],
        projects: [],
        runs: [
          {
            id: "r1",
            taskId: "t1",
            agent: "cursor",
            status: "running",
            createdAt: "2026-09-01T00:00:00.000Z",
            pendingPermission: { toolCallId: "tc", askId: "ask", title: "ls", options: [] },
            pendingPermissionQueued: 1,
            parentRunId: "",
          },
          {
            id: "r2",
            taskId: "t1",
            agent: "cursor",
            status: "queued",
            createdAt: "2026-09-01T00:00:01.000Z",
          },
        ],
        sessions: [],
        remoteDevices: [{ id: "d1", name: "box", host: "10.0.0.2", port: 22, user: "cea", status: "online", error: "stale" }],
        files: {},
        settings: { agents: {} },
        agentModels: {
          cursor: {
            models: [{ id: "auto", label: "Auto" }, { id: "" }, null],
            checkedAt: "2026-09-01T00:00:00.000Z",
            ideModels: [{ id: "auto", visible: true, label: " Auto " }, { id: 1 }, "x"],
          },
          skip: { models: [{ id: "x" }], checkedAt: "t" },
        },
      }),
      "utf8",
    );

    const store = new Store(dir);
    assert.equal(store.state.tasks[0]?.details, "");
    assert.equal(store.state.tasks[0]?.priority, "normal");
    assert.deepEqual(store.state.tasks[0]?.notes[0]?.files, [
      { id: "f1", name: "a.png", mediaType: "image/png", byteLength: 12 },
    ]);
    assert.equal(store.state.runs[0]?.status, "failed");
    assert.equal(store.state.runs[0]?.error, "电脑端在运行期间退出了。");
    assert.ok(store.state.runs[0]?.finishedAt);
    assert.equal("pendingPermission" in store.state.runs[0]!, false);
    assert.equal("parentRunId" in store.state.runs[0]!, false);
    assert.equal(store.state.runs[1]?.status, "failed");
    assert.equal(store.state.remoteDevices[0]?.status, "unknown");
    assert.equal(store.state.remoteDevices[0]?.error, undefined);
    assert.equal(store.state.remoteDevices[0]?.platform, "unknown");
    assert.deepEqual(store.state.agentModels.cursor?.models, [{ id: "auto", label: "Auto" }]);
    assert.deepEqual(store.state.agentModels.cursor?.ideModels, [{ id: "auto", visible: true, label: "Auto" }]);
    assert.equal(store.state.agentModels.skip, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Store load backs up corrupt JSON and returns empty state", async () => {
  const dir = tempStoreDir();
  try {
    const file = join(dir, "state.json");
    writeFileSync(file, "{not-json", "utf8");
    const store = new Store(dir);
    assert.deepEqual(store.state.tasks, []);
    // rename is fire-and-forget; give the event loop a tick.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const backups = readdirSync(dir).filter((name) => name.startsWith("state.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.equal(existsSync(file), false);
    assert.equal(readFileSync(join(dir, backups[0]!), "utf8"), "{not-json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Store flush recovers after a failed write so later saves persist", async () => {
  const dir = tempStoreDir();
  try {
    const store = new Store(dir);
    store.state.settings.closeToTray = false;
    store.save();
    await store.flush();
    assert.equal(JSON.parse(readFileSync(store.file, "utf8")).settings.closeToTray, false);

    chmodSync(dir, 0o555);
    store.state.settings.closeToTray = true;
    store.save();
    await assert.rejects(store.flush());

    chmodSync(dir, 0o755);
    // Tip #25: a rejected prior write must not permanently stop the queue.
    await store.flush();
    assert.equal(JSON.parse(readFileSync(store.file, "utf8")).settings.closeToTray, true);
  } finally {
    try {
      chmodSync(dir, 0o755);
    } catch {
      // already restored
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
