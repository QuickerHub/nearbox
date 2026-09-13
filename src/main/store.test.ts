import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parsePersistedState } from "./store-normalize.ts";
import { enqueueWrite } from "./write-chain.ts";

test("parsePersistedState skips malformed rows instead of throwing", () => {
  const state = parsePersistedState({
    version: 1,
    tasks: [
      null as unknown as never,
      {
        id: "t1",
        title: "ok",
        createdBy: { id: "d", name: "n", role: "phone" },
        createdAt: "a",
        updatedAt: "a",
        status: "open",
      } as never,
    ],
    projects: [
      { id: "p1", name: "P", path: "/tmp/p", createdAt: "a" } as never,
      { id: "bad" } as never,
    ],
    runs: [
      null as unknown as never,
      {
        id: "r1",
        taskId: "t1",
        projectId: "p1",
        agent: "cursor",
        access: "safe",
        prompt: "hi",
        cwd: "/tmp",
        status: "succeeded",
        requestedBy: { id: "d", name: "n", role: "phone" },
        createdAt: "a",
      } as never,
    ],
    sessions: [
      { token: "tok", device: { id: "phone-1", name: "Phone", role: "phone", online: true } },
      { token: "", device: { id: "x", name: "x", role: "phone", online: false } },
      { token: "no-device" } as never,
    ],
    remoteDevices: [
      { id: "dev", name: "Box", host: " 10.0.0.2 ", platform: "linux", status: "online", agents: [] } as never,
      { id: "x" } as never,
    ],
    files: {},
    settings: {},
    agentModels: {},
  });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0]?.id, "t1");
  assert.equal(state.projects.length, 1);
  assert.equal(state.runs.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.token, "tok");
  assert.equal(state.sessions[0]?.device.online, false);
  assert.equal(state.remoteDevices.length, 1);
  assert.equal(state.remoteDevices[0]?.host, "10.0.0.2");
});

test("await flush drains mutations that arrived during the write", async () => {
  // Mirrors Store.flush's drain contract without importing Store (protocol graph).
  const dir = mkdtempSync(join(tmpdir(), "nearbox-store-flush-"));
  const file = join(dir, "state.json");
  try {
    let dirty = false;
    let writing: Promise<void> = Promise.resolve();
    let payload = { n: 0 };

    const flush = async (): Promise<void> => {
      if (!dirty) {
        return writing;
      }
      writing = enqueueWrite(writing, async () => {
        while (dirty) {
          dirty = false;
          const snap = JSON.stringify(payload);
          await mkdir(dirname(file), { recursive: true });
          const tmp = `${file}.tmp`;
          await writeFile(tmp, snap, "utf8");
          await rename(tmp, file);
        }
      });
      return writing;
    };

    payload = { n: 1 };
    dirty = true;
    const flushing = flush();
    // Mutate while the first write is queued/in flight — same as save() mid-flush.
    payload = { n: 2 };
    dirty = true;
    await flushing;
    assert.equal(JSON.parse(readFileSync(file, "utf8")).n, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
