import type { ChatMessage, HostSnapshot, HostToClient } from "@shared/protocol";

const SESSION_KEY = "nearbox.session";

export interface ClientHandle {
  surface: "desktop" | "phone";
  token: string;
  origin: string;
  snapshot: HostSnapshot;
  dispose(): void;
  sendText(text: string): Promise<void>;
  upload(file: File): Promise<void>;
  refreshInvite(): Promise<void>;
  setHost(host: string): Promise<void>;
  openInbox(): Promise<void>;
  fileUrl(fileId: string): string;
}

export async function connectClient(
  onSnapshot: (snapshot: HostSnapshot) => void,
  onError: (message: string) => void,
): Promise<ClientHandle> {
  const desktop = window.nearboxDesktop;
  if (desktop) {
    const boot = await desktop.bootstrap();
    onSnapshot(boot.snapshot);
    const stop = desktop.onSnapshot(onSnapshot);
    const origin = `http://127.0.0.1:${boot.port}`;
    return {
      surface: "desktop",
      token: boot.desktopSecret,
      origin,
      snapshot: boot.snapshot,
      dispose: stop,
      sendText: async (text) => {
        await desktop.sendText(text);
      },
      upload: async (file) => {
        await uploadFile(origin, boot.desktopSecret, file);
      },
      refreshInvite: async () => {
        await desktop.refreshInvite();
      },
      setHost: async (host) => {
        await desktop.setHost(host);
      },
      openInbox: () => desktop.openInbox(),
      fileUrl: (fileId) => `${origin}/api/files/${fileId}?token=${encodeURIComponent(boot.desktopSecret)}`,
    };
  }

  const origin = window.location.origin;
  const stored = window.sessionStorage.getItem(SESSION_KEY) ?? "";
  const invite = new URLSearchParams(window.location.search).get("t") ?? "";
  const pin = new URLSearchParams(window.location.search).get("pin") ?? "";
  const firstToken = stored || invite || pin;
  if (!firstToken) {
    throw new Error("缺少邀请。请用电脑上的二维码打开，或输入 6 位验证码。");
  }

  const state = await fetchJson<HostSnapshot & { sessionToken?: string }>(
    `${origin}/api/state?token=${encodeURIComponent(firstToken)}`,
  );
  const token = state.sessionToken || firstToken;
  window.sessionStorage.setItem(SESSION_KEY, token);
  onSnapshot(state);

  let socket: WebSocket | null = null;
  let disposed = false;
  const openSocket = () => {
    if (disposed) {
      return;
    }
    const next = new WebSocket(wsUrl(origin, token));
    socket = next;
    next.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as HostToClient;
      if (payload.type === "snapshot" || payload.type === "ready") {
        onSnapshot(payload.snapshot);
        onError("");
      } else if (payload.type === "error") {
        onError(payload.message);
      }
    });
    next.addEventListener("close", () => {
      if (disposed) {
        return;
      }
      onError("和电脑的连接断开了，正在重试…");
      window.setTimeout(openSocket, 1500);
    });
  };
  openSocket();

  return {
    surface: "phone",
    token,
    origin,
    snapshot: state,
    dispose: () => {
      disposed = true;
      socket?.close();
    },
    sendText: async (text) => {
      const message = { type: "send-text", id: crypto.randomUUID(), text };
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }
      await fetchJson<ChatMessage>(`${origin}/api/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text }),
      });
    },
    upload: async (file) => {
      await uploadFile(origin, token, file);
    },
    refreshInvite: async () => undefined,
    setHost: async () => undefined,
    openInbox: async () => undefined,
    fileUrl: (fileId) => `${origin}/api/files/${fileId}?token=${encodeURIComponent(token)}`,
  };
}

export async function pairWithPin(pin: string): Promise<void> {
  const url = new URL(window.location.href);
  url.searchParams.set("pin", pin.replace(/\s/g, ""));
  window.location.replace(url.toString());
}

async function uploadFile(origin: string, token: string, file: File): Promise<void> {
  const url = `${origin}/api/upload?name=${encodeURIComponent(file.name)}&token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "上传失败。");
  }
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
