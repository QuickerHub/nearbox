import {
  type AgentInfo,
  type AgentKind,
  type AgentRun,
  type AppUpdateStatus,
  type DeviceCandidate,
  type DeviceInfo,
  type DispatchInput,
  type FileMeta,
  type HostSettings,
  type HostSnapshot,
  type HostToClient,
  newId,
  type NoteInput,
  type Project,
  type RemoteDevice,
  type RemoteDeviceInput,
  type RemoteDevicePatch,
  type RemoteDirListing,
  type RunEvent,
  type Task,
  type TaskInput,
  type TaskNote,
  type TaskPatch,
} from "@shared/protocol";

const SESSION_KEY = "nearbox.session";

export type Surface = "desktop" | "phone";

export interface ClientHandle {
  surface: Surface;
  self: DeviceInfo;
  token: string;
  origin: string;
  snapshot: HostSnapshot;
  dispose(): void;
  subscribeRun(runId: string, listener: (event: RunEvent) => void): () => void;

  capture(text: string): Promise<Task>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  addNote(taskId: string, input: NoteInput): Promise<TaskNote>;
  /** Put a file on the PC and get its id; the message that names the id comes in a second request. */
  uploadFile(file: File): Promise<FileMeta>;
  defaultPrompt(taskId: string, projectId?: string): Promise<string>;
  dispatch(taskId: string, input: DispatchInput): Promise<AgentRun>;
  runEvents(runId: string, after?: number): Promise<RunEvent[]>;
  cancelRun(runId: string): Promise<void>;
  resolvePermission(runId: string, optionId: string): Promise<void>;
  replyRun(runId: string, text: string): Promise<AgentRun>;
  addProject(input: { path: string; name?: string; defaultAgent?: AgentKind | null; deviceId?: string | null }): Promise<Project>;
  updateProject(id: string, patch: { name?: string; defaultAgent?: AgentKind | null }): Promise<Project>;
  removeProject(id: string): Promise<void>;
  addRemoteDevice(input: RemoteDeviceInput): Promise<RemoteDevice>;
  updateRemoteDevice(id: string, patch: RemoteDevicePatch): Promise<RemoteDevice>;
  removeRemoteDevice(id: string): Promise<void>;
  checkRemoteDevice(id: string): Promise<RemoteDevice>;
  discoverRemoteDevices(): Promise<DeviceCandidate[]>;
  listRemoteDirectory(id: string, path: string): Promise<RemoteDirListing>;
  refreshAgents(): Promise<AgentInfo[]>;
  /** Tell the PC which agent (and conversation) the next message goes to, so it can have the process ready. */
  warmAgent(input: { agent: AgentKind; projectId: string; resumeRunId?: string }): Promise<void>;
  /**
   * Re-ask the CLI (one agent, or every installed one) which models it offers.
   * The host skips CLIs asked within the last minute unless `force` is set.
   */
  refreshModels(agent?: AgentKind, force?: boolean): Promise<AgentInfo[]>;
  updateSettings(patch: Partial<HostSettings>): Promise<HostSettings>;
  refreshInvite(): Promise<void>;
  setHost(host: string): Promise<void>;
  forgetDevice(deviceId: string): Promise<void>;
  fileUrl(fileId: string): string;
  checkUpdate(force?: boolean): Promise<AppUpdateStatus>;
  updateStatus(): Promise<AppUpdateStatus>;
  installUpdate(): Promise<AppUpdateStatus>;
}

interface Credentials {
  surface: Surface;
  origin: string;
  /** Tokens to try in order; the first one the host accepts wins. */
  candidates: string[];
}

type StateResponse = HostSnapshot & { sessionToken?: string; self?: DeviceInfo };

async function resolveCredentials(): Promise<Credentials> {
  const desktop = window.nearboxDesktop;
  if (desktop) {
    const boot = await desktop.bootstrap();
    return { surface: "desktop", origin: `http://127.0.0.1:${boot.port}`, candidates: [boot.desktopSecret] };
  }
  const params = new URLSearchParams(window.location.search);
  const stored = window.localStorage.getItem(SESSION_KEY) ?? "";
  const invite = params.get("t") ?? "";
  const pin = params.get("pin") ?? "";
  // The remembered session keeps this phone's identity; the invite/PIN in the URL is the fallback
  // for a first pairing or after the PC forgot this device.
  const candidates = [stored, invite, pin].filter(Boolean);
  if (!candidates.length) {
    throw Object.assign(new Error("缺少邀请。请用电脑上的二维码打开，或输入 6 位验证码。"), { code: "NO_INVITE" });
  }
  return { surface: "phone", origin: window.location.origin, candidates };
}

async function authenticate(credentials: Credentials): Promise<{ state: StateResponse; token: string }> {
  let lastError: unknown = null;
  for (const candidate of credentials.candidates) {
    try {
      const state = await fetchJson<StateResponse>(`${credentials.origin}/api/state?token=${encodeURIComponent(candidate)}`);
      return { state, token: state.sessionToken || candidate };
    } catch (error) {
      lastError = error;
      if (credentials.surface === "phone" && candidate === window.localStorage.getItem(SESSION_KEY)) {
        window.localStorage.removeItem(SESSION_KEY);
      }
      // A network failure (not a 401) will fail for every candidate; stop early.
      if (error instanceof TypeError) {
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("无法连接电脑。");
}

export async function connectClient(
  onSnapshot: (snapshot: HostSnapshot) => void,
  onStatus: (message: string | null) => void,
): Promise<ClientHandle> {
  const credentials = await resolveCredentials();
  const { origin, surface } = credentials;
  const { state, token } = await authenticate(credentials);
  if (surface === "phone") {
    window.localStorage.setItem(SESSION_KEY, token);
    if (window.location.search) {
      // Drop the one-time invite from the address bar so reloads use the stored session.
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    }
  }
  const self: DeviceInfo = state.self ?? {
    id: surface === "desktop" ? "desktop" : "phone",
    name: surface === "desktop" ? state.hostName : "手机",
    role: surface,
    online: true,
  };
  onSnapshot(state);

  const runListeners = new Map<string, Set<(event: RunEvent) => void>>();
  let socket: WebSocket | null = null;
  let disposed = false;
  let retry = 0;

  const send = (payload: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  };

  const openSocket = () => {
    if (disposed) {
      return;
    }
    const next = new WebSocket(wsUrl(origin, token));
    socket = next;
    next.addEventListener("open", () => {
      retry = 0;
      onStatus(null);
      for (const runId of runListeners.keys()) {
        send({ type: "subscribe-run", runId });
      }
    });
    next.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as HostToClient;
      if (payload.type === "snapshot" || payload.type === "ready") {
        onSnapshot(payload.snapshot);
      } else if (payload.type === "run-event") {
        for (const listener of runListeners.get(payload.runId) ?? []) {
          listener(payload.event);
        }
      } else if (payload.type === "error") {
        onStatus(payload.message);
      }
    });
    next.addEventListener("close", () => {
      if (disposed) {
        return;
      }
      retry += 1;
      onStatus(surface === "desktop" ? "正在重新连接本机服务…" : "和电脑的连接断开了，正在重试…");
      window.setTimeout(openSocket, Math.min(8000, 1000 * retry));
    });
  };
  openSocket();

  const authHeaders = { Authorization: `Bearer ${token}` };
  const json = <T>(path: string, init?: RequestInit) =>
    fetchJson<T>(`${origin}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...authHeaders, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
  const post = <T>(path: string, body?: unknown) =>
    json<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const patch = <T>(path: string, body: unknown) => json<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  const remove = (path: string) => json<{ ok: true }>(path, { method: "DELETE" }).then(() => undefined);

  return {
    surface,
    self,
    token,
    origin,
    snapshot: state,
    dispose: () => {
      disposed = true;
      socket?.close();
    },
    subscribeRun: (runId, listener) => {
      let set = runListeners.get(runId);
      if (!set) {
        set = new Set();
        runListeners.set(runId, set);
        send({ type: "subscribe-run", runId });
      }
      set.add(listener);
      return () => {
        const current = runListeners.get(runId);
        current?.delete(listener);
        if (current && current.size === 0) {
          runListeners.delete(runId);
          send({ type: "unsubscribe-run", runId });
        }
      };
    },
    capture: (text) => post("/api/capture", { id: newId(), text }),
    createTask: (input) => post("/api/tasks", input),
    updateTask: (id, body) => patch(`/api/tasks/${encodeURIComponent(id)}`, body),
    deleteTask: (id) => remove(`/api/tasks/${encodeURIComponent(id)}`),
    addNote: (taskId, input) => post(`/api/tasks/${encodeURIComponent(taskId)}/notes`, input),
    uploadFile: (file) => uploadFile(origin, token, file),
    defaultPrompt: async (taskId, projectId) => {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const result = await json<{ prompt: string }>(`/api/tasks/${encodeURIComponent(taskId)}/prompt${query}`);
      return result.prompt;
    },
    dispatch: (taskId, input) => post(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, input),
    runEvents: async (runId, after = 0) => {
      const result = await json<{ events: RunEvent[] }>(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`);
      return result.events;
    },
    cancelRun: (runId) => post(`/api/runs/${encodeURIComponent(runId)}/cancel`).then(() => undefined),
    resolvePermission: (runId, optionId) => post(`/api/runs/${encodeURIComponent(runId)}/permission`, { optionId }).then(() => undefined),
    replyRun: (runId, text) => post(`/api/runs/${encodeURIComponent(runId)}/reply`, { text }),
    addProject: (input) => post("/api/projects", input),
    updateProject: (id, body) => patch(`/api/projects/${encodeURIComponent(id)}`, body),
    removeProject: (id) => remove(`/api/projects/${encodeURIComponent(id)}`),
    addRemoteDevice: (input) => post("/api/remote-devices", input),
    updateRemoteDevice: (id, body) => patch(`/api/remote-devices/${encodeURIComponent(id)}`, body),
    removeRemoteDevice: (id) => remove(`/api/remote-devices/${encodeURIComponent(id)}`),
    checkRemoteDevice: (id) => post(`/api/remote-devices/${encodeURIComponent(id)}/check`),
    discoverRemoteDevices: async () => (await post<{ candidates: DeviceCandidate[] }>("/api/remote-devices/discover")).candidates,
    listRemoteDirectory: (id, path) => post(`/api/remote-devices/${encodeURIComponent(id)}/ls`, { path }),
    refreshAgents: async () => (await post<{ agents: AgentInfo[] }>("/api/agents/refresh")).agents,
    warmAgent: (input) => post<{ ok: true }>("/api/agents/warm", input).then(() => undefined),
    refreshModels: async (agent, force) => (await post<{ agents: AgentInfo[] }>("/api/agents/models/refresh", { agent, force })).agents,
    updateSettings: (body) => post("/api/settings", body),
    refreshInvite: () => post("/api/invite").then(() => undefined),
    setHost: (host) => post("/api/host", { host }).then(() => undefined),
    forgetDevice: (deviceId) => post("/api/devices/forget", { deviceId }).then(() => undefined),
    fileUrl: (fileId) => `${origin}/api/files/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`,
    checkUpdate: (force = true) => post("/api/update/check", { force }),
    updateStatus: () => json("/api/update"),
    installUpdate: () => post("/api/update/install"),
  };
}

export function pairWithPin(pin: string): void {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("pin", pin.replace(/\s/g, ""));
  window.location.replace(url.toString());
}

const IMAGE_EXTENSIONS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** A pasted screenshot arrives as a File named "image.png" or "" with a possibly empty type; give it a real name. */
function uploadName(file: File): string {
  if (file.name && file.name !== "image.png") {
    return file.name;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const ext = Object.entries(IMAGE_EXTENSIONS).find(([, type]) => type === file.type)?.[0] ?? "png";
  return `截图-${stamp}.${ext}`;
}

function uploadType(file: File, name: string): string {
  if (file.type) {
    return file.type;
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS[ext] ?? "application/octet-stream";
}

async function uploadFile(origin: string, token: string, file: File): Promise<FileMeta> {
  const name = uploadName(file);
  const params = new URLSearchParams({ name, token });
  const response = await fetch(`${origin}/api/files?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": uploadType(file, name),
    },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as (FileMeta & { message?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.message ?? "上传失败。");
  }
  return body;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.message ?? `请求失败（${response.status}）`);
  }
  return body as T;
}

function wsUrl(origin: string, token: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
