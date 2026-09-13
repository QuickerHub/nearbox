import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_RUNS_KEPT, Store } from "./store.ts";

function tempStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "nearbox-store-cap-"));
}

function finishedRun(id: string, createdAt: string) {
  return {
    id,
    taskId: "t1",
    agent: "cursor",
    status: "succeeded",
    createdAt,
    finishedAt: createdAt,
  };
}

test("Store flush keeps only the newest MAX_RUNS_KEPT runs", async () => {
  const dir = tempStoreDir();
  try {
    const store = new Store(dir);
    const total = MAX_RUNS_KEPT + 5;
    store.state.runs = Array.from({ length: total }, (_, index) =>
      finishedRun(`r${index}`, `2026-09-13T12:00:${String(index % 60).padStart(2, "0")}.000Z`),
    );
    store.save();
    await store.flush();
    assert.equal(store.state.runs.length, MAX_RUNS_KEPT);
    assert.equal(store.state.runs[0]?.id, "r5");
    assert.equal(store.state.runs.at(-1)?.id, `r${total - 1}`);
    const persisted = JSON.parse(readFileSync(store.file, "utf8"));
    assert.equal(persisted.runs.length, MAX_RUNS_KEPT);
    assert.equal(persisted.runs[0].id, "r5");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Store load defaults missing eventCount and keeps existing note.files", () => {
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
            status: "todo",
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
            notes: [
              {
                id: "n1",
                text: "keep",
                createdAt: "2026-09-01T00:00:00.000Z",
                files: [{ id: "f2", name: "b.png", mediaType: "image/png", byteLength: 3 }],
                file: { id: "f1", name: "a.png", mediaType: "image/png", byteLength: 1 },
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
            status: "succeeded",
            createdAt: "2026-09-01T00:00:00.000Z",
            finishedAt: "2026-09-01T00:01:00.000Z",
          },
        ],
        sessions: [],
        remoteDevices: [],
        files: {},
        settings: { agents: {} },
        agentModels: {},
      }),
      "utf8",
    );
    const store = new Store(dir);
    assert.equal(store.state.runs[0]?.eventCount, 0);
    assert.deepEqual(store.state.tasks[0]?.notes[0]?.files, [
      { id: "f2", name: "b.png", mediaType: "image/png", byteLength: 3 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
