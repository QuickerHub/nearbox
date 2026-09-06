import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import { hostname } from "node:os";
import { extname, join, resolve as resolvePath } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";
import {
  type Actor,
  type AgentKind,
  type ClientToHost,
  DEFAULT_LIMITS,
  DEFAULT_PORT,
  type DeviceInfo,
  type DispatchInput,
  type HostSettings,
  type HostSnapshot,
  type HostToClient,
  type InviteInfo,
  isImageMediaType,
  newId,
  PROTOCOL_VERSION,
  type RunEvent,
  type ShareLimits,
  type TaskInput,
  type TaskPatch,
} from "@shared/protocol";
import { receiveToInbox } from "./files";
import type { TaskHub } from "./hub";
import { isLoopbackOrPrivate, listPrivateLanAddresses, normalizeRemoteIp } from "./network";
import type { PairedSession } from "./store";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

interface SocketBinding {
  socket: WebSocket;
  deviceId: string;
  runs: Set<string>;
}

export class LanServer extends EventEmitter {
  readonly port: number;
  readonly inboxDir: string;
  readonly limits: ShareLimits = { ...DEFAULT_LIMITS };
  readonly hostName = hostname() || "这台电脑";

  private readonly hub: TaskHub;
  private readonly desktopSecret: string;
  private readonly rendererRoot: string | null;
  private readonly vitePort: number;
  private readonly appVersion: string;
  private readonly apkPath: string | null;
  private readonly stagingDir: string;
  private readonly sessions = new Map<string, PairedSession>();
  private readonly sockets = new Set<SocketBinding>();
  private readonly devices = new Map<string, DeviceInfo>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private selectedHost = "";
  private invite: InviteInfo | null = null;
  private listenError: string | undefined;
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(options: {
    hub: TaskHub;
    userData: string;
    rendererRoot: string | null;
    vitePort: number;
    desktopSecret: string;
    appVersion: string;
    apkPath?: string | null;
    port?: number;
  }) {
    super();
    this.hub = options.hub;
    this.port = options.port ?? DEFAULT_PORT;
    this.rendererRoot = options.rendererRoot;
    this.vitePort = options.vitePort;
    this.desktopSecret = options.desktopSecret;
    this.appVersion = options.appVersion;
    this.apkPath = options.apkPath && existsSync(options.apkPath) ? options.apkPath : null;
    this.inboxDir = join(options.userData, "inbox");
    this.stagingDir = join(options.userData, "staging");
    this.devices.set("desktop", {
      id: "desktop",
      name: this.hostName,
      role: "desktop",
      online: true,
    });
    for (const session of this.hub.store.state.sessions) {
      this.sessions.set(session.token, session);
      this.devices.set(session.device.id, { ...session.device, online: false });
    }
    this.hub.on("changed", () => this.scheduleSnapshot());
    this.hub.on("run-event", (runId: string, event: RunEvent) => this.broadcastRunEvent(runId, event));
  }

  async start(): Promise<void> {
    await mkdir(this.inboxDir, { recursive: true });
    await mkdir(this.stagingDir, { recursive: true });
    const addresses = listPrivateLanAddresses();
    const preferred = this.hub.settings.preferredHost;
    this.selectedHost = (preferred && addresses.includes(preferred) ? preferred : addresses[0]) ?? "";
    if (!this.selectedHost) {
      this.listenError = "没有找到可用的局域网地址。请确认电脑已连上 Wi-Fi 或以太网。";
    }

    const server = http.createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://nearbox.local");
      if (url.pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
        return;
      }
      if (!this.rendererRoot) {
        this.proxyUpgrade(req, socket, head);
        return;
      }
      socket.destroy();
    });
    wss.on("connection", (socket, req) => {
      this.bindSocket(socket, req);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.server = server;
    this.wss = wss;
    if (this.selectedHost) {
      await this.refreshInvite();
    }
  }

  async stop(): Promise<void> {
    for (const binding of this.sockets) {
      binding.socket.close();
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.wss = null;
    this.server = null;
  }

  snapshot(): HostSnapshot {
    return {
      running: this.server !== null,
      hostName: this.hostName,
      hostAddresses: listPrivateLanAddresses(),
      selectedHost: this.selectedHost,
      port: this.port,
      invite: this.invite,
      devices: [...this.devices.values()],
      tasks: this.hub.tasks,
      projects: this.hub.projects,
      runs: this.hub.runs.slice(-120),
      agents: this.hub.agents,
      settings: this.hub.settings,
      limits: this.limits,
      inboxDir: this.inboxDir,
      dataDir: this.hub.dataDir,
      appVersion: this.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      apkAvailable: this.apkPath !== null,
      listenError: this.listenError,
    };
  }

  onlinePhones(): number {
    return [...this.devices.values()].filter((device) => device.role === "phone" && device.online).length;
  }

  async setSelectedHost(host: string): Promise<HostSnapshot> {
    if (!listPrivateLanAddresses().includes(host)) {
      throw new Error("只能选择当前电脑上的局域网地址。");
    }
    this.selectedHost = host;
    this.hub.settings.preferredHost = host;
    this.hub.store.save();
    await this.refreshInvite();
    return this.snapshot();
  }

  async refreshInvite(): Promise<InviteInfo> {
    if (!this.selectedHost) {
      throw new Error("没有可用的局域网地址。");
    }
    const token = randomBytes(18).toString("base64url");
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const url = `http://${this.selectedHost}:${this.port}/?t=${token}`;
    const qrOptions = { margin: 1, width: 320, color: { dark: "#111827", light: "#ffffff" } };
    const qrDataUrl = await QRCode.toDataURL(url, qrOptions);
    const apkUrl = this.apkPath ? `http://${this.selectedHost}:${this.port}/app/nearbox.apk` : undefined;
    const apkQrDataUrl = apkUrl ? await QRCode.toDataURL(apkUrl, qrOptions) : undefined;
    this.invite = {
      url,
      token,
      pin,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      host: this.selectedHost,
      port: this.port,
      qrDataUrl,
      apkUrl,
      apkQrDataUrl,
    };
    this.scheduleSnapshot();
    return this.invite;
  }

  forgetDevice(deviceId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.device.id === deviceId) {
        this.sessions.delete(token);
      }
    }
    for (const binding of this.sockets) {
      if (binding.deviceId === deviceId) {
        binding.socket.close();
      }
    }
    this.devices.delete(deviceId);
    this.persistSessions();
    this.scheduleSnapshot();
  }

  // ------------------------------------------------------------------ HTTP

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const remote = normalizeRemoteIp(req.socket.remoteAddress);
      if (!isLoopbackOrPrivate(remote)) {
        res.writeHead(403).end("仅允许局域网访问");
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "nearbox.local"}`);
      const method = req.method ?? "GET";
      if (method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req)).end();
        return;
      }
      if (url.pathname === "/api/app" && method === "GET") {
        this.writeJson(res, {
          version: this.appVersion,
          protocol: PROTOCOL_VERSION,
          apkAvailable: this.apkPath !== null,
          apkUrl: this.apkPath ? "/app/nearbox.apk" : null,
        });
        return;
      }
      if (url.pathname === "/app/nearbox.apk" && method === "GET") {
        await this.serveApk(res);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await this.handleApi(req, res, url, method);
        return;
      }
      if (this.rendererRoot) {
        await this.serveRenderer(res, url.pathname);
        return;
      }
      this.proxyVite(req, res);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status =
        code === "UNAUTHORIZED"
          ? 401
          : code === "NOT_FOUND"
            ? 404
            : code === "FILE_TOO_LARGE"
              ? 413
              : code === "FILE_FORBIDDEN"
                ? 415
                : 400;
      this.writeJson(res, { ok: false, message: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  private async handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    method: string,
  ): Promise<void> {
    const path = url.pathname;
    const session = this.authorize(req, url);
    const actor = actorOf(session.device);
    const segments = path.split("/").filter(Boolean); // ["api", ...]

    if (path === "/api/state" && method === "GET") {
      this.writeJson(res, { ...this.snapshot(), sessionToken: session.token, self: session.device });
      return;
    }
    if (path === "/api/invite" && method === "POST") {
      this.requireDesktop(session);
      this.writeJson(res, await this.refreshInvite());
      return;
    }
    if (path === "/api/host" && method === "POST") {
      this.requireDesktop(session);
      const body = await readJson<{ host: string }>(req);
      this.writeJson(res, await this.setSelectedHost(String(body.host ?? "")));
      return;
    }
    if (path === "/api/devices/forget" && method === "POST") {
      this.requireDesktop(session);
      const body = await readJson<{ deviceId: string }>(req);
      this.forgetDevice(String(body.deviceId ?? ""));
      this.writeJson(res, { ok: true });
      return;
    }

    // ----- capture / tasks
    if (path === "/api/capture" && method === "POST") {
      const body = await readJson<{ id?: string; text?: string }>(req);
      this.assertTextLength(String(body.text ?? ""));
      this.writeJson(res, this.hub.capture(actor, String(body.text ?? ""), body.id || newId()));
      return;
    }
    if (path === "/api/tasks" && method === "POST") {
      const body = await readJson<TaskInput>(req);
      this.writeJson(res, this.hub.createTask(actor, body));
      return;
    }
    if (segments[1] === "tasks" && segments[2]) {
      const taskId = decodeURIComponent(segments[2]);
      const tail = segments[3];
      if (!tail && method === "PATCH") {
        const body = await readJson<TaskPatch>(req);
        this.writeJson(res, this.hub.updateTask(actor, taskId, body));
        return;
      }
      if (!tail && method === "DELETE") {
        this.hub.deleteTask(taskId);
        this.writeJson(res, { ok: true });
        return;
      }
      if (tail === "notes" && method === "POST") {
        const body = await readJson<{ text?: string }>(req);
        this.assertTextLength(String(body.text ?? ""));
        this.writeJson(res, this.hub.addNote(actor, taskId, String(body.text ?? "")));
        return;
      }
      if (tail === "prompt" && method === "GET") {
        this.writeJson(res, { prompt: this.hub.defaultPrompt(taskId, url.searchParams.get("projectId") ?? undefined) });
        return;
      }
      if (tail === "dispatch" && method === "POST") {
        const body = await readJson<DispatchInput>(req);
        this.writeJson(res, this.hub.dispatch(actor, taskId, body));
        return;
      }
    }

    // ----- uploads / files
    if (path === "/api/upload" && method === "POST") {
      const fileName = decodeURIComponent(url.searchParams.get("name") ?? "file");
      const taskId = url.searchParams.get("taskId") || null;
      const mediaType = req.headers["content-type"] || "application/octet-stream";
      const kind = isImageMediaType(mediaType) ? "image" : "file";
      const maxBytes = kind === "image" ? this.limits.maxImageBytes : this.limits.maxFileBytes;
      const deviceDir = join(this.inboxDir, safeSegment(session.device.name));
      const saved = await receiveToInbox({
        request: req,
        inboxDir: deviceDir,
        stagingDir: this.stagingDir,
        fileName,
        mediaType,
        maxBytes,
      });
      const fileId = newId();
      const result = this.hub.attachFile(
        actor,
        taskId,
        { id: fileId, name: saved.storedName, mediaType: saved.mediaType, byteLength: saved.byteLength },
        { path: join(deviceDir, saved.storedName), name: saved.storedName, mediaType: saved.mediaType },
      );
      this.writeJson(res, result);
      return;
    }
    if (segments[1] === "files" && segments[2] && method === "GET") {
      const file = this.hub.fileById(decodeURIComponent(segments[2]));
      if (!file || !existsSync(file.path)) {
        res.writeHead(404).end("文件不存在");
        return;
      }
      const info = await stat(file.path);
      res.writeHead(200, {
        "Content-Type": file.mediaType,
        "Content-Length": info.size,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, max-age=3600",
      });
      createReadStream(file.path).pipe(res);
      return;
    }

    // ----- projects
    if (path === "/api/projects" && method === "POST") {
      const body = await readJson<{ path: string; name?: string; defaultAgent?: AgentKind | null }>(req);
      this.writeJson(res, this.hub.addProject(body));
      return;
    }
    if (segments[1] === "projects" && segments[2]) {
      const projectId = decodeURIComponent(segments[2]);
      if (method === "PATCH") {
        const body = await readJson<{ name?: string; defaultAgent?: AgentKind | null }>(req);
        this.writeJson(res, this.hub.updateProject(projectId, body));
        return;
      }
      if (method === "DELETE") {
        this.hub.removeProject(projectId);
        this.writeJson(res, { ok: true });
        return;
      }
    }

    // ----- runs
    if (segments[1] === "runs" && segments[2]) {
      const runId = decodeURIComponent(segments[2]);
      const tail = segments[3];
      if (tail === "events" && method === "GET") {
        const after = Number(url.searchParams.get("after") ?? "0") || 0;
        this.writeJson(res, { events: await this.hub.runEvents(runId, after) });
        return;
      }
      if (tail === "cancel" && method === "POST") {
        this.hub.cancelRun(runId);
        this.writeJson(res, { ok: true });
        return;
      }
      if (tail === "reply" && method === "POST") {
        const body = await readJson<{ text?: string }>(req);
        this.assertTextLength(String(body.text ?? ""));
        this.writeJson(res, this.hub.reply(actor, runId, String(body.text ?? "")));
        return;
      }
    }

    // ----- agents / settings
    if (path === "/api/agents/refresh" && method === "POST") {
      this.writeJson(res, { agents: await this.hub.refreshAgents() });
      return;
    }
    if (path === "/api/settings" && method === "POST") {
      const body = await readJson<Partial<HostSettings>>(req);
      this.writeJson(res, this.hub.updateSettings(body));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, message: "接口不存在" }));
  }

  private assertTextLength(text: string): void {
    if (text.length > this.limits.maxTextChars) {
      throw Object.assign(new Error("文字太长了。"), { code: "TEXT_TOO_LONG" });
    }
  }

  private async serveApk(res: http.ServerResponse): Promise<void> {
    if (!this.apkPath) {
      res.writeHead(404).end("当前电脑端没有附带 Android 安装包。");
      return;
    }
    const info = await stat(this.apkPath);
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": info.size,
      "Content-Disposition": `attachment; filename="Nearbox-${this.appVersion}.apk"`,
      "Cache-Control": "no-store",
    });
    createReadStream(this.apkPath).pipe(res);
  }

  private async serveRenderer(res: http.ServerResponse, pathname: string): Promise<void> {
    const root = this.rendererRoot;
    if (!root) {
      res.writeHead(404).end();
      return;
    }
    const relative = pathname === "/" ? "/index.html" : pathname;
    const target = resolvePath(root, `.${relative}`);
    if (!target.startsWith(resolvePath(root))) {
      res.writeHead(403).end();
      return;
    }
    const file = existsSync(target) && (await stat(target)).isFile() ? target : join(root, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=86400",
    });
    res.end(body);
  }

  private proxyVite(req: http.IncomingMessage, res: http.ServerResponse): void {
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: this.vitePort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${this.vitePort}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("桌面端开发服务还没起来，请先在电脑上运行 npm run dev。");
    });
    req.pipe(proxy);
  }

  private proxyUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const proxy = http.request({
      hostname: "127.0.0.1",
      port: this.vitePort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${this.vitePort}` },
    });
    proxy.on("upgrade", (res, upstream, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(res.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (head.length) {
        upstream.write(head);
      }
      if (upstreamHead.length) {
        socket.write(upstreamHead);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    proxy.on("error", () => socket.destroy());
    proxy.end();
  }

  // ------------------------------------------------------------- WebSocket

  private bindSocket(socket: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://nearbox.local");
    let session: PairedSession;
    try {
      session = this.authorize(req, url);
    } catch (error) {
      sendSocket(socket, {
        type: "error",
        code: "UNAUTHORIZED",
        message: error instanceof Error ? error.message : "未授权",
      });
      socket.close();
      return;
    }

    const device = this.devices.get(session.device.id) ?? session.device;
    device.online = true;
    device.lastSeenAt = new Date().toISOString();
    this.devices.set(device.id, device);
    const binding: SocketBinding = { socket, deviceId: device.id, runs: new Set() };
    this.sockets.add(binding);
    sendSocket(socket, { type: "ready", self: device, snapshot: this.snapshot() });
    this.scheduleSnapshot();

    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(String(raw)) as ClientToHost;
        if (event.type === "capture") {
          this.assertTextLength(event.text);
          this.hub.capture(actorOf(device), event.text, event.id || newId());
        } else if (event.type === "subscribe-run") {
          binding.runs.add(event.runId);
        } else if (event.type === "unsubscribe-run") {
          binding.runs.delete(event.runId);
        }
      } catch (error) {
        sendSocket(socket, {
          type: "error",
          code: "BAD_MESSAGE",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    socket.on("close", () => {
      this.sockets.delete(binding);
      const stillOnline = [...this.sockets].some((item) => item.deviceId === device.id);
      if (!stillOnline && device.id !== "desktop") {
        device.online = false;
        device.lastSeenAt = new Date().toISOString();
        this.scheduleSnapshot();
      }
    });
  }

  private broadcastRunEvent(runId: string, event: RunEvent): void {
    const payload = JSON.stringify({ type: "run-event", runId, event } satisfies HostToClient);
    for (const binding of this.sockets) {
      if (binding.runs.has(runId) && binding.socket.readyState === WebSocket.OPEN) {
        binding.socket.send(payload);
      }
    }
  }

  /** Snapshots are coalesced so a burst of changes produces one broadcast. */
  private scheduleSnapshot(): void {
    if (this.snapshotTimer) {
      return;
    }
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      const snapshot = this.snapshot();
      const payload = JSON.stringify({ type: "snapshot", snapshot } satisfies HostToClient);
      for (const binding of this.sockets) {
        if (binding.socket.readyState === WebSocket.OPEN) {
          binding.socket.send(payload);
        }
      }
      this.emit("snapshot", snapshot);
    }, 60);
  }

  // ------------------------------------------------------------------ auth

  private requireDesktop(session: PairedSession): void {
    if (session.device.role !== "desktop") {
      throw Object.assign(new Error("仅电脑端可以执行该操作。"), { code: "UNAUTHORIZED" });
    }
  }

  private authorize(req: http.IncomingMessage, url: URL): PairedSession {
    const token = bearerToken(req) || url.searchParams.get("token") || url.searchParams.get("t") || "";
    if (token && token === this.desktopSecret) {
      return {
        token: this.desktopSecret,
        device: this.devices.get("desktop") ?? {
          id: "desktop",
          name: this.hostName,
          role: "desktop",
          online: true,
        },
      };
    }
    const existing = this.sessions.get(token);
    if (existing) {
      return existing;
    }
    if (this.invite && (token === this.invite.token || token === this.invite.pin) && !inviteExpired(this.invite)) {
      const deviceId = `phone-${randomBytes(6).toString("hex")}`;
      const device: DeviceInfo = {
        id: deviceId,
        name: phoneNameFromUa(req.headers["user-agent"]),
        role: "phone",
        online: true,
        lastSeenAt: new Date().toISOString(),
      };
      const session: PairedSession = { token: randomBytes(18).toString("base64url"), device };
      this.sessions.set(session.token, session);
      this.devices.set(device.id, device);
      this.persistSessions();
      return session;
    }
    throw Object.assign(new Error("邀请已失效，请重新扫电脑上的二维码。"), { code: "UNAUTHORIZED" });
  }

  private persistSessions(): void {
    this.hub.store.state.sessions = [...this.sessions.values()].map((session) => ({
      token: session.token,
      device: { ...session.device, online: false },
    }));
    this.hub.store.save();
  }

  private writeJson(res: http.ServerResponse, body: unknown, status = 200): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end(JSON.stringify(body));
  }
}

function actorOf(device: DeviceInfo): Actor {
  return { id: device.id, name: device.name, role: device.role };
}

function sendSocket(socket: WebSocket, event: HostToClient): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function bearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function inviteExpired(invite: InviteInfo): boolean {
  return Date.parse(invite.expiresAt) <= Date.now();
}

function phoneNameFromUa(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "iPhone";
  }
  if (/Android/i.test(ua)) {
    return "Android 手机";
  }
  return "手机";
}

function safeSegment(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "phone";
  return cleaned.slice(0, 60);
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) {
      throw new Error("请求过大。");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw) as T;
}

function corsHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  return {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}
