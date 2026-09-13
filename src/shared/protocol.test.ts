import assert from "node:assert/strict";
import test from "node:test";
import type { AgentInfo, HostSnapshot, Project, RemoteDevice } from "./protocol.ts";
import {
  AGENT_KINDS,
  DEFAULT_PORT,
  DEFAULT_REMOTE_QUALITY,
  FORBIDDEN_EXTENSIONS,
  IMAGE_TYPES,
  MAX_FILES_PER_MESSAGE,
  RUN_STATUS_LABELS,
  STATUS_LABELS,
  agentsForProject,
  isImageFile,
  isImageMediaType,
  newId,
  projectDisplayName,
} from "./protocol.ts";

function agent(kind: AgentInfo["kind"], available = true): AgentInfo {
  return {
    kind,
    label: kind,
    available,
    supportsResume: true,
    detail: available ? undefined : "missing",
  };
}

test("isImageMediaType accepts known types and strips parameters", () => {
  for (const type of IMAGE_TYPES) {
    assert.equal(isImageMediaType(type), true);
    assert.equal(isImageMediaType(`${type}; charset=binary`), true);
  }
  assert.equal(isImageMediaType("IMAGE/PNG"), true);
  assert.equal(isImageMediaType("text/plain"), false);
  assert.equal(isImageMediaType(undefined), false);
  assert.equal(isImageMediaType(""), false);
  assert.equal(isImageFile({ mediaType: "image/webp" }), true);
  assert.equal(isImageFile({ mediaType: "application/pdf" }), false);
});

test("newId returns unique non-empty ids", () => {
  const a = newId();
  const b = newId();
  assert.ok(a.length > 8);
  assert.ok(b.length > 8);
  assert.notEqual(a, b);
});

test("agentsForProject uses host agents locally and remote catalog remotely", () => {
  const localAgents = [agent("cursor"), agent("grok", false)];
  const remote: RemoteDevice = {
    id: "r1",
    name: "书房",
    host: "10.0.0.2",
    platform: "windows",
    status: "online",
    agents: [agent("claude"), agent("cursor", false)],
    createdAt: "t0",
  };
  const snapshot: Pick<HostSnapshot, "agents" | "remoteDevices"> = {
    agents: localAgents,
    remoteDevices: [remote],
  };

  assert.equal(agentsForProject(snapshot, undefined), localAgents);
  assert.equal(agentsForProject(snapshot, { deviceId: undefined } as Project), localAgents);
  assert.deepEqual(agentsForProject(snapshot, { deviceId: "missing" } as Project), []);

  const remoteAgents = agentsForProject(snapshot, { deviceId: "r1" } as Project);
  assert.equal(remoteAgents.length, AGENT_KINDS.length);
  assert.equal(remoteAgents.find((item) => item.kind === "claude")?.available, true);
  assert.equal(remoteAgents.find((item) => item.kind === "cursor")?.available, false);
  const missing = remoteAgents.find((item) => item.kind === "grok");
  assert.equal(missing?.available, false);
  assert.match(missing?.detail ?? "", /没有找到/);
});

test("agentsForProject detail softens when the remote device is offline", () => {
  const remote: RemoteDevice = {
    id: "r2",
    name: "客厅",
    host: "10.0.0.3",
    platform: "linux",
    status: "offline",
    agents: [],
    createdAt: "t0",
  };
  const detail = agentsForProject({ agents: [], remoteDevices: [remote] }, { deviceId: "r2" } as Project).find(
    (item) => item.kind === "cursor",
  )?.detail;
  assert.equal(detail, "设备尚未检测");
});

test("projectDisplayName prefixes remote device names", () => {
  assert.equal(projectDisplayName({ name: "nearbox" }, []), "nearbox");
  assert.equal(projectDisplayName({ name: "nearbox", deviceId: undefined }, []), "nearbox");
  assert.equal(
    projectDisplayName({ name: "nearbox", deviceId: "r1" }, [{ id: "r1", name: "书房" }]),
    "书房 / nearbox",
  );
  assert.equal(projectDisplayName({ name: "nearbox", deviceId: "gone" }, []), "远程电脑 / nearbox");
});

test("protocol constants stay stable for clients", () => {
  assert.equal(DEFAULT_PORT, 17831);
  assert.equal(MAX_FILES_PER_MESSAGE, 8);
  assert.equal(DEFAULT_REMOTE_QUALITY.fps, 12);
  assert.ok(FORBIDDEN_EXTENSIONS.includes(".exe"));
  assert.equal(STATUS_LABELS.doing, "进行中");
  assert.equal(RUN_STATUS_LABELS.cancelled, "已取消");
});
