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
  DEFAULT_LIMITS,
  DEFAULT_PORT,
  type ChatMessage,
  type ClientToHost,
  type DeviceInfo,
  type HostSnapshot,
  type HostToClient,
  type InviteInfo,
  isImageMediaType,
  newId,
  PROTOCOL_VERSION,
  type ShareLimits,
} from "@shared/protocol";
import { receiveToInbox } from "./files";
import { isLoopbackOrPrivate, listPrivateLanAddresses, normalizeRemoteIp } from "./network";

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
};

interface Session {
  token: string;
  device: DeviceInfo;
}

interface SocketBinding {
  socket: WebSocket;
  deviceId: string;
}

export class LanServer extends EventEmitter {
  readonly port: number;
  readonly inboxDir: string;
  readonly limits: ShareLimits = { ...DEFAULT_LIMITS };
  readonly hostName = hostname() || "这台电脑";

  private readonly desktopSecret: string;
  private readonly rendererRoot: string | null;
  private readonly vitePort: number;
  private readonly appVersion: string;
  private readonly apkPath: string | null;
  private readonly stagingDir: string;
  private readonly filesById = new Map<string, { path: string; name: string; mediaType: string }>();
  private readonly sessions = new Map<string, Session>();
  private readonly sockets = new Set<SocketBinding>();
  private readonly messages: ChatMessage[] = [];
  private readonly devices = new Map<string, DeviceInfo>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private selectedHost = "";
  private invite: InviteInfo | null = null;
  private listenError: string | undefined;

  constructor(options: {
    userData: string;
    rendererRoot: string | null;
    vitePort: number;
    desktopSecret: string;
    appVersion: string;
    apkPath?: string | null;
    port?: number;
  }) {
    super();
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
  }

  async start(): Promise<void> {
    await mkdir(this.inboxDir, { recursive: true });
    await mkdir(this.stagingDir, { recursive: true });
    const addresses = listPrivateLanAddresses();
    this.selectedHost = addresses[0] ?? "";
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
      messages: this.messages.slice(-200),
      limits: this.limits,
      inboxDir: this.inboxDir,
      appVersion: this.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      apkAvailable: this.apkPath !== null,
      listenError: this.listenError,
    };
  }

  async setSelectedHost(host: string): Promise<HostSnapshot> {
    if (!listPrivateLanAddresses().includes(host)) {
      throw new Error("只能选择当前电脑上的局域网地址。");
    }
    this.selectedHost = host;
    await this.refreshInvite();
    this.broadcastSnapshot();
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
    this.broadcastSnapshot();
    return this.invite;
  }

  sendDesktopText(text: string, id = newId()): ChatMessage {
    return this.acceptText(
      {
        id: "desktop",
        name: this.hostName,
        role: "desktop",
      },
      id,
      text,
    );
  }

  private acceptText(
    from: Pick<DeviceInfo, "id" | "name" | "role">,
    id: string,
    text: string,
  ): ChatMessage {
    const trimmed = text.replace(/\r\n/g, "\n").trim();
    if (!trimmed) {
      throw Object.assign(new Error("消息不能为空。"), { code: "EMPTY" });
    }
    if (trimmed.length > this.limits.maxTextChars) {
      throw Object.assign(new Error("文字太长了。"), { code: "TEXT_TOO_LONG" });
    }
    const existing = this.messages.find((item) => item.id === id);
    if (existing) {
      return existing;
    }
    const message: ChatMessage = {
      id,
      from,
      kind: "text",
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: "sent",
    };
    this.messages.push(message);
    this.touchDevice(from.id);
    this.broadcast({ type: "message", message });
    this.broadcastSnapshot();
    return message;
  }

  private acceptFileMessage(
    from: Pick<DeviceInfo, "id" | "name" | "role">,
    file: { id: string; name: string; mediaType: string; byteLength: number },
  ): ChatMessage {
    const message: ChatMessage = {
      id: newId(),
      from,
      kind: isImageMediaType(file.mediaType) ? "image" : "file",
      file,
      createdAt: new Date().toISOString(),
      status: "sent",
    };
    this.messages.push(message);
    this.touchDevice(from.id);
    this.broadcast({ type: "message", message });
    this.broadcastSnapshot();
    return message;
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const remote = normalizeRemoteIp(req.socket.remoteAddress);
      if (!isLoopbackOrPrivate(remote)) {
        res.writeHead(403).end("仅允许局域网访问");
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "nearbox.local"}`);
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req)).end();
        return;
      }
      if (url.pathname === "/api/app" && req.method === "GET") {
        this.writeJson(res, {
          version: this.appVersion,
          protocol: PROTOCOL_VERSION,
          apkAvailable: this.apkPath !== null,
          apkUrl: this.apkPath ? "/app/nearbox.apk" : null,
        });
        return;
      }
      if (url.pathname === "/app/nearbox.apk" && req.method === "GET") {
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
        return;
      }
      if (url.pathname === "/api/state" && req.method === "GET") {
        this.writeJson(res, this.publicSnapshot(this.authorize(req, url)));
        return;
      }
      if (url.pathname === "/api/invite" && req.method === "POST") {
        this.requireDesktop(req, url);
        this.writeJson(res, await this.refreshInvite());
        return;
      }
      if (url.pathname === "/api/host" && req.method === "POST") {
        this.requireDesktop(req, url);
        const body = await readJson<{ host: string }>(req);
        this.writeJson(res, await this.setSelectedHost(String(body.host ?? "")));
        return;
      }
      if (url.pathname === "/api/text" && req.method === "POST") {
        const session = this.authorize(req, url);
        const body = await readJson<{ id?: string; text?: string }>(req);
        const message = this.acceptText(session.device, body.id || newId(), String(body.text ?? ""));
        this.writeJson(res, message);
        return;
      }
      if (url.pathname === "/api/upload" && req.method === "POST") {
        const session = this.authorize(req, url);
        const fileName = decodeURIComponent(url.searchParams.get("name") ?? "file");
        const mediaType = req.headers["content-type"] || "application/octet-stream";
        const kind = isImageMediaType(mediaType) ? "image" : "file";
        const maxBytes = kind === "image" ? this.limits.maxImageBytes : this.limits.maxFileBytes;
        const saved = await receiveToInbox({
          request: req,
          inboxDir: join(this.inboxDir, safeSegment(session.device.name)),
          stagingDir: this.stagingDir,
          fileName,
          mediaType,
          maxBytes,
        });
        const fileId = newId();
        const storedPath = join(this.inboxDir, safeSegment(session.device.name), saved.storedName);
        this.filesById.set(fileId, {
          path: storedPath,
          name: saved.storedName,
          mediaType: saved.mediaType,
        });
        const message = this.acceptFileMessage(session.device, {
          id: fileId,
          name: saved.storedName,
          mediaType: saved.mediaType,
          byteLength: saved.byteLength,
        });
        this.writeJson(res, message);
        return;
      }
      if (url.pathname.startsWith("/api/files/") && req.method === "GET") {
        this.authorize(req, url);
        const fileId = url.pathname.slice("/api/files/".length);
        const file = this.filesById.get(fileId);
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

      if (this.rendererRoot) {
        await this.serveRenderer(req, res, url.pathname);
        return;
      }
      this.proxyVite(req, res);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const status =
        code === "UNAUTHORIZED" ? 401 : code === "FILE_TOO_LARGE" ? 413 : code === "FILE_FORBIDDEN" ? 415 : 400;
      this.writeJson(res, { ok: false, message: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  private async serveRenderer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<void> {
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
      "Cache-Control": "no-cache",
    });
    res.end(body);
    void req;
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

  private bindSocket(socket: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://nearbox.local");
    let session: Session;
    try {
      session = this.authorizeFromParams(req, url);
    } catch (error) {
      sendSocket(socket, {
        type: "error",
        code: "UNAUTHORIZED",
        message: error instanceof Error ? error.message : "未授权",
      });
      socket.close();
      return;
    }

    session.device.online = true;
    session.device.lastSeenAt = new Date().toISOString();
    this.devices.set(session.device.id, session.device);
    const binding = { socket, deviceId: session.device.id };
    this.sockets.add(binding);
    sendSocket(socket, { type: "ready", self: session.device, snapshot: this.snapshot() });
    this.broadcastSnapshot();

    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(String(raw)) as ClientToHost;
        if (event.type === "send-text") {
          this.acceptText(session.device, event.id || newId(), event.text);
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
      const stillOnline = [...this.sockets].some((item) => item.deviceId === session.device.id);
      if (!stillOnline && session.device.id !== "desktop") {
        session.device.online = false;
        session.device.lastSeenAt = new Date().toISOString();
        this.devices.set(session.device.id, session.device);
        this.broadcastSnapshot();
      }
    });
  }

  private authorize(req: http.IncomingMessage, url: URL): Session {
    return this.authorizeFromParams(req, url);
  }

  private requireDesktop(req: http.IncomingMessage, url: URL): Session {
    const session = this.authorizeFromParams(req, url);
    if (session.device.role !== "desktop") {
      throw Object.assign(new Error("仅电脑端可以执行该操作。"), { code: "UNAUTHORIZED" });
    }
    return session;
  }

  private authorizeFromParams(req: http.IncomingMessage, url: URL): Session {
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
      const session = { token: randomBytes(18).toString("base64url"), device };
      this.sessions.set(session.token, session);
      this.devices.set(device.id, device);
      return session;
    }
    throw Object.assign(new Error("邀请已失效，请重新扫电脑上的二维码。"), { code: "UNAUTHORIZED" });
  }

  private publicSnapshot(session: Session): HostSnapshot & { sessionToken: string } {
    return { ...this.snapshot(), sessionToken: session.token };
  }

  private broadcastSnapshot(): void {
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
    this.emit("snapshot", this.snapshot());
  }

  private broadcast(event: HostToClient): void {
    const payload = JSON.stringify(event);
    for (const binding of this.sockets) {
      if (binding.socket.readyState === WebSocket.OPEN) {
        binding.socket.send(payload);
      }
    }
  }

  private touchDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = new Date().toISOString();
    }
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
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 64 * 1024) {
      throw new Error("请求过大。");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw) as T;
}

function corsHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  return {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
