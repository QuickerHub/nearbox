import type { RemoteControlToClient, RemoteControlToHost, RemoteQuality } from "@shared/protocol";

export type RemoteState = "connecting" | "open" | "closed";

export interface RemoteHandlers {
  onFrame(blob: Blob): void;
  onHello(display: { width: number; height: number }, supportsInput: boolean, quality: RemoteQuality): void;
  onConfig(quality: RemoteQuality): void;
  onPeers(controllers: number): void;
  onPong(ts?: number): void;
  onError(message: string): void;
  onState(state: RemoteState): void;
}

export interface RemoteConnection {
  send(message: RemoteControlToHost): void;
  dispose(): void;
}

function remoteUrl(origin: string, token: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/rc";
  url.search = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

/**
 * Keeps a live `/rc` WebSocket: binary messages are screen frames, text
 * messages are control JSON. Reconnects with backoff until disposed.
 */
export function connectRemote(origin: string, token: string, handlers: RemoteHandlers): RemoteConnection {
  let socket: WebSocket | null = null;
  let disposed = false;
  let retry = 0;
  let reconnectTimer: number | null = null;

  const open = () => {
    if (disposed) {
      return;
    }
    handlers.onState("connecting");
    const next = new WebSocket(remoteUrl(origin, token));
    next.binaryType = "blob";
    socket = next;

    next.addEventListener("open", () => {
      retry = 0;
      handlers.onState("open");
    });
    next.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        handlers.onFrame(event.data as Blob);
        return;
      }
      let payload: RemoteControlToClient;
      try {
        payload = JSON.parse(event.data) as RemoteControlToClient;
      } catch {
        return;
      }
      switch (payload.t) {
        case "hello":
          handlers.onHello(payload.display, payload.supportsInput, payload.quality);
          break;
        case "config":
          handlers.onConfig(payload.quality);
          break;
        case "peers":
          handlers.onPeers(payload.controllers);
          break;
        case "pong":
          handlers.onPong(payload.ts);
          break;
        case "error":
          handlers.onError(payload.message);
          break;
      }
    });
    next.addEventListener("close", () => {
      if (disposed) {
        return;
      }
      handlers.onState("closed");
      retry += 1;
      reconnectTimer = window.setTimeout(open, Math.min(6000, 800 * retry));
    });
    next.addEventListener("error", () => {
      try {
        next.close();
      } catch {
        /* already closing */
      }
    });
  };
  open();

  return {
    send: (message) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    dispose: () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    },
  };
}
