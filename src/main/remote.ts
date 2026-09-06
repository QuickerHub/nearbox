import type { WebSocket } from "ws";
import type { RemoteControlToClient, RemoteDisplay, RemoteQuality, RemoteStatus } from "@shared/protocol";
import { DEFAULT_REMOTE_QUALITY } from "@shared/protocol";
import type { InputSink } from "./input-win";
import { clampQuality, parseControlMessage, shouldSendFrame, translateInput } from "./remote-input";

const WS_OPEN = 1;

export interface RemoteFrame {
  data: Buffer;
  width: number;
  height: number;
}

export interface RemoteControlHubOptions {
  capture(quality: RemoteQuality): Promise<RemoteFrame | null>;
  input: InputSink;
  getEnabled(): boolean;
  getDisplay(): RemoteDisplay;
  onControllersChanged?(controllers: number, latest?: { id: string; name: string }): void;
  log?(message: string): void;
}

interface RemoteClient {
  socket: WebSocket;
  deviceId: string;
  name: string;
}

/**
 * Streams the primary screen to connected viewers and feeds their pointer /
 * keyboard messages into the platform input sink. One capture per tick is fanned
 * out to every viewer whose socket is not already backed up.
 */
export class RemoteControlHub {
  private readonly options: RemoteControlHubOptions;
  private readonly clients = new Set<RemoteClient>();
  private quality: RemoteQuality = { ...DEFAULT_REMOTE_QUALITY };
  private timer: NodeJS.Timeout | null = null;
  private capturing = false;
  private captureFailed = false;

  constructor(options: RemoteControlHubOptions) {
    this.options = options;
  }

  status(): RemoteStatus {
    let display: RemoteDisplay | null = null;
    try {
      display = this.options.getDisplay();
    } catch {
      display = null;
    }
    return {
      supported: this.options.input.supported,
      enabled: this.options.getEnabled(),
      controllers: this.clients.size,
      display,
    };
  }

  attach(socket: WebSocket, device: { id: string; name: string }): void {
    if (!this.options.getEnabled()) {
      sendJson(socket, { t: "error", message: "这台电脑已关闭远程控制。" });
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      return;
    }
    const client: RemoteClient = { socket, deviceId: device.id, name: device.name };
    this.clients.add(client);
    void this.options.input.ready();

    sendJson(socket, {
      t: "hello",
      display: this.status().display ?? { width: 1920, height: 1080 },
      supportsInput: this.options.input.supported,
      quality: this.quality,
      controllerName: device.name,
    });

    socket.on("message", (raw: unknown, isBinary: boolean) => {
      if (isBinary) {
        return;
      }
      this.handleMessage(client, String(raw));
    });
    socket.on("close", () => this.detach(client));
    socket.on("error", () => this.detach(client));

    this.broadcastPeers();
    this.options.onControllersChanged?.(this.clients.size, { id: device.id, name: device.name });
    this.ensureLoop();
  }

  private detach(client: RemoteClient): void {
    if (!this.clients.delete(client)) {
      return;
    }
    this.broadcastPeers();
    this.options.onControllersChanged?.(this.clients.size);
    if (this.clients.size === 0) {
      this.stopLoop();
    }
  }

  /** Called when the user flips the setting off: drop everyone immediately. */
  refreshEnabled(): void {
    if (!this.options.getEnabled()) {
      this.kickAll("这台电脑已关闭远程控制。");
    }
  }

  private handleMessage(client: RemoteClient, raw: string): void {
    const msg = parseControlMessage(raw);
    if (!msg) {
      return;
    }
    if (msg.t === "ping") {
      sendJson(client.socket, { t: "pong", ts: msg.ts });
      return;
    }
    if (msg.t === "config") {
      const previousFps = this.quality.fps;
      this.quality = clampQuality(msg, this.quality);
      for (const item of this.clients) {
        sendJson(item.socket, { t: "config", quality: this.quality });
      }
      if (this.quality.fps !== previousFps && this.timer) {
        this.stopLoop();
        this.ensureLoop();
      }
      return;
    }
    if (!this.options.input.supported) {
      return;
    }
    const commands = translateInput(msg);
    if (commands.length) {
      this.options.input.send(commands);
    }
  }

  private ensureLoop(): void {
    if (this.timer || this.clients.size === 0) {
      return;
    }
    const interval = Math.max(33, Math.round(1000 / this.quality.fps));
    this.timer = setInterval(() => void this.tick(), interval);
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.options.getEnabled()) {
      this.kickAll("这台电脑已关闭远程控制。");
      return;
    }
    if (this.capturing || this.clients.size === 0) {
      return;
    }
    this.capturing = true;
    try {
      const frame = await this.options.capture(this.quality);
      if (frame) {
        this.captureFailed = false;
        this.broadcastFrame(frame);
      }
    } catch (error) {
      if (!this.captureFailed) {
        this.captureFailed = true;
        this.options.log?.(`屏幕采集失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.capturing = false;
    }
  }

  private broadcastFrame(frame: RemoteFrame): void {
    for (const client of this.clients) {
      const socket = client.socket;
      if (socket.readyState === WS_OPEN && shouldSendFrame(socket.bufferedAmount)) {
        try {
          socket.send(frame.data);
        } catch {
          this.detach(client);
        }
      }
    }
  }

  private broadcastPeers(): void {
    for (const client of this.clients) {
      sendJson(client.socket, { t: "peers", controllers: this.clients.size });
    }
  }

  private kickAll(message: string): void {
    for (const client of [...this.clients]) {
      sendJson(client.socket, { t: "error", message });
      try {
        client.socket.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(client);
    }
    this.stopLoop();
    this.options.onControllersChanged?.(0);
  }

  stop(): void {
    this.kickAll("电脑端正在关闭。");
    this.options.input.dispose();
  }
}

function sendJson(socket: WebSocket, message: RemoteControlToClient): void {
  try {
    if (socket.readyState === WS_OPEN) {
      socket.send(JSON.stringify(message));
    }
  } catch {
    /* the socket is on its way out; nothing to do */
  }
}
