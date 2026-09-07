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

/**
 * Produces screen frames on demand. The hub starts the source when the first
 * viewer connects and stops it once the last one leaves; frames arrive through
 * the `onFrame` callback at whatever cadence the source manages internally.
 */
export interface FrameSource {
  start(quality: RemoteQuality, onFrame: (frame: RemoteFrame) => void): void;
  setQuality(quality: RemoteQuality): void;
  stop(): void;
}

export interface RemoteControlHubOptions {
  source: FrameSource;
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
 * keyboard messages into the platform input sink. Frames pushed by the source
 * are fanned out to every viewer whose socket is not already backed up.
 */
export class RemoteControlHub {
  private readonly options: RemoteControlHubOptions;
  private readonly clients = new Set<RemoteClient>();
  private quality: RemoteQuality = { ...DEFAULT_REMOTE_QUALITY };
  private sourceRunning = false;

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
    if (this.clients.size > 1 && this.quality.crop) {
      this.quality = { ...this.quality, crop: undefined };
      if (this.sourceRunning) {
        this.options.source.setQuality(this.quality);
      }
      for (const item of this.clients) {
        if (item !== client) {
          sendJson(item.socket, { t: "config", quality: this.quality });
        }
      }
    }

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
    this.ensureSource();
  }

  private detach(client: RemoteClient): void {
    if (!this.clients.delete(client)) {
      return;
    }
    this.broadcastPeers();
    this.options.onControllersChanged?.(this.clients.size);
    if (this.clients.size === 0) {
      this.stopSource();
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
      this.quality = clampQuality(msg, this.quality);
      if (this.clients.size > 1 && this.quality.crop) {
        this.quality = { ...this.quality, crop: undefined };
      }
      if (this.sourceRunning) {
        this.options.source.setQuality(this.quality);
      }
      for (const item of this.clients) {
        sendJson(item.socket, { t: "config", quality: this.quality });
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

  private ensureSource(): void {
    if (this.sourceRunning || this.clients.size === 0) {
      return;
    }
    this.sourceRunning = true;
    try {
      this.options.source.start(this.quality, (frame) => this.broadcastFrame(frame));
    } catch (error) {
      this.sourceRunning = false;
      this.options.log?.(`屏幕采集启动失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private stopSource(): void {
    if (!this.sourceRunning) {
      return;
    }
    this.sourceRunning = false;
    try {
      this.options.source.stop();
    } catch {
      /* ignore */
    }
  }

  private broadcastFrame(frame: RemoteFrame): void {
    if (!this.options.getEnabled()) {
      this.kickAll("这台电脑已关闭远程控制。");
      return;
    }
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
    this.stopSource();
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
