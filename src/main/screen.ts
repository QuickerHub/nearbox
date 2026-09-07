import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, desktopCapturer, ipcMain, screen, type WebContents } from "electron";
import { DEFAULT_REMOTE_QUALITY, type RemoteDisplay, type RemoteQuality } from "@shared/protocol";
import type { FrameSource, RemoteFrame } from "./remote";

const FRAME_CHANNEL = "nearbox:rc-frame";
const FAILED_CHANNEL = "nearbox:rc-failed";
const CONFIG_CHANNEL = "nearbox:rc-config";
/** How long we give the video stream to deliver a first frame before falling back to polling. */
const STREAM_GRACE_MS = 6000;

/** Logical size of the primary display; used by viewers only as an aspect-ratio hint. */
export function primaryDisplaySize(): RemoteDisplay {
  try {
    const size = screen.getPrimaryDisplay().size;
    return { width: size.width, height: size.height };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

// A tiny page that runs in a hidden window. It opens the primary screen as a
// MediaStream once (cheap per frame afterwards), scales each frame onto a canvas
// and ships it to the main process as JPEG. file:// counts as a secure context,
// which getUserMedia needs; a data: URL would not.
const CAPTURE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Nearbox capture</title></head>
<body>
<script>
(function () {
  const { ipcRenderer } = require("electron");
  const params = new URLSearchParams(location.search);
  let cfg = {
    quality: Number(params.get("quality")) || 72,
    fps: Number(params.get("fps")) || 12,
    maxWidth: Number(params.get("maxWidth")) || 1920,
    crop: null,
  };
  const sourceId = params.get("source");
  let video = null, canvas = null, ctx = null, timer = null, busy = false;
  function fail(reason) { ipcRenderer.send(${JSON.stringify(FAILED_CHANNEL)}, String(reason)); }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(grab, Math.max(33, Math.round(1000 / cfg.fps)));
  }
  function region() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const crop = cfg.crop;
    if (!crop || crop.w <= 0 || crop.h <= 0) {
      return { sx: 0, sy: 0, sw: vw, sh: vh };
    }
    let sx = Math.round(crop.x * vw);
    let sy = Math.round(crop.y * vh);
    let sw = Math.max(1, Math.round(crop.w * vw));
    let sh = Math.max(1, Math.round(crop.h * vh));
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + sw > vw) sw = vw - sx;
    if (sy + sh > vh) sh = vh - sy;
    return { sx, sy, sw: Math.max(1, sw), sh: Math.max(1, sh) };
  }
  async function grab() {
    if (busy || !video || !video.videoWidth) return;
    busy = true;
    try {
      const { sx, sy, sw, sh } = region();
      const scale = Math.min(1, cfg.maxWidth / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      const q = Math.min(0.95, Math.max(0.2, cfg.quality / 100));
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        ipcRenderer.send(${JSON.stringify(FRAME_CHANNEL)}, bytes, w, h);
      }
    } catch (e) {
      /* drop this frame */
    } finally {
      busy = false;
    }
  }
  ipcRenderer.on(${JSON.stringify(CONFIG_CHANNEL)}, (_event, next) => {
    cfg = Object.assign({}, cfg, next);
    cfg.crop = next && next.crop ? next.crop : null;
    schedule();
  });
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        minWidth: 1280,
        maxWidth: 7680,
        minHeight: 720,
        maxHeight: 4320,
        maxFrameRate: 30,
      },
    },
  }).then((stream) => {
    video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d", { alpha: false });
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener("ended", () => fail("track ended"));
    return video.play();
  }).then(() => schedule()).catch((e) => fail(e && e.message ? e.message : e));
})();
</script>
</body></html>
`;

/**
 * Produces screen frames for the remote-control hub. Prefers a live video
 * stream in a hidden window; if that never delivers, or dies, it polls
 * desktopCapturer thumbnails instead (slow, but works everywhere).
 */
export class ScreenSource implements FrameSource {
  private readonly dir: string;
  private window: BrowserWindow | null = null;
  private onFrame: ((frame: RemoteFrame) => void) | null = null;
  private quality: RemoteQuality = { ...DEFAULT_REMOTE_QUALITY };
  private running = false;
  private streaming = false;
  private generation = 0;
  private graceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollBusy = false;

  constructor(options: { dir: string }) {
    this.dir = options.dir;
    ipcMain.on(FRAME_CHANNEL, (event, data: Uint8Array | ArrayBuffer, width: number, height: number) => {
      if (!this.running || !this.onFrame || !this.isCaptureSender(event.sender)) {
        return;
      }
      if (!this.streaming) {
        this.streaming = true;
        this.clearGrace();
        this.stopPolling();
      }
      const view = data instanceof Uint8Array ? data : new Uint8Array(data);
      this.onFrame({ data: Buffer.from(view.buffer, view.byteOffset, view.byteLength), width, height });
    });
    ipcMain.on(FAILED_CHANNEL, (event, reason: string) => {
      if (!this.running || !this.isCaptureSender(event.sender)) {
        return;
      }
      console.warn(`[remote] 视频流采集不可用，退回截图模式：${reason}`);
      this.streaming = false;
      this.startPolling();
    });
  }

  start(quality: RemoteQuality, onFrame: (frame: RemoteFrame) => void): void {
    this.running = true;
    this.quality = quality;
    this.onFrame = onFrame;
    this.streaming = false;
    const generation = ++this.generation;
    void this.openStream(generation).catch((error) => {
      if (generation === this.generation && this.running) {
        console.warn(`[remote] 无法启动视频流采集，退回截图模式：${error instanceof Error ? error.message : String(error)}`);
        this.startPolling();
      }
    });
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      if (this.running && !this.streaming) {
        this.startPolling();
      }
    }, STREAM_GRACE_MS);
  }

  setQuality(quality: RemoteQuality): void {
    this.quality = quality;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(CONFIG_CHANNEL, quality);
    }
    if (this.pollTimer) {
      this.stopPolling();
      this.startPolling();
    }
  }

  stop(): void {
    this.running = false;
    this.streaming = false;
    this.onFrame = null;
    this.generation += 1;
    this.clearGrace();
    this.stopPolling();
    this.closeWindow();
  }

  private async openStream(generation: number): Promise<void> {
    const display = screen.getPrimaryDisplay();
    // Zero-size thumbnails skip the expensive per-source screenshot; we only need ids.
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (generation !== this.generation || !this.running) {
      return;
    }
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
    if (!source) {
      throw new Error("没有可用的屏幕源");
    }
    const file = join(this.dir, "rc-capture.html");
    await writeFile(file, CAPTURE_PAGE, "utf8");
    if (generation !== this.generation || !this.running) {
      return;
    }
    this.closeWindow();
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      webPreferences: {
        // Local page we wrote ourselves; it needs ipcRenderer and nothing else.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.window = window;
    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
      }
    });
    await window.loadFile(file, {
      query: {
        source: source.id,
        quality: String(this.quality.quality),
        fps: String(this.quality.fps),
        maxWidth: String(this.quality.maxWidth),
      },
    });
  }

  private isCaptureSender(sender: WebContents): boolean {
    return this.window !== null && !this.window.isDestroyed() && sender.id === this.window.webContents.id;
  }

  private closeWindow(): void {
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer || !this.running) {
      return;
    }
    const interval = Math.max(100, Math.round(1000 / this.quality.fps));
    this.pollTimer = setInterval(() => void this.pollOnce(), interval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.pollBusy || !this.running || !this.onFrame) {
      return;
    }
    this.pollBusy = true;
    try {
      const frame = await captureScreenOnce(this.quality);
      if (frame && this.running && this.onFrame) {
        this.onFrame(frame);
      }
    } catch {
      /* try again next tick */
    } finally {
      this.pollBusy = false;
    }
  }
}

/** One-off screenshot of the primary display via desktopCapturer thumbnails. */
export async function captureScreenOnce(quality: RemoteQuality): Promise<RemoteFrame | null> {
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const fullWidth = Math.max(1, Math.round(display.size.width * scale));
  const fullHeight = Math.max(1, Math.round(display.size.height * scale));
  const cap = Math.max(480, Math.min(quality.maxWidth || 1920, 3840));
  const cropW = quality.crop && quality.crop.w > 0 ? quality.crop.w : 1;
  const thumbWidth = Math.min(3840, Math.max(cap, Math.round(cap / cropW)));
  const ratio = fullWidth > thumbWidth ? thumbWidth / fullWidth : 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.max(1, Math.round(fullWidth * ratio)), height: Math.max(1, Math.round(fullHeight * ratio)) },
    fetchWindowIcons: false,
  });
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
  const image = source?.thumbnail;
  if (!image || image.isEmpty()) {
    return null;
  }
  let out = image;
  if (quality.crop) {
    const size = image.getSize();
    const x = Math.max(0, Math.round(quality.crop.x * size.width));
    const y = Math.max(0, Math.round(quality.crop.y * size.height));
    const width = Math.max(1, Math.min(size.width - x, Math.round(quality.crop.w * size.width)));
    const height = Math.max(1, Math.min(size.height - y, Math.round(quality.crop.h * size.height)));
    out = image.crop({ x, y, width, height });
  }
  const cropped = out.getSize();
  const longest = Math.max(cropped.width, cropped.height);
  if (longest > cap) {
    const down = cap / longest;
    out = out.resize({
      width: Math.max(1, Math.round(cropped.width * down)),
      height: Math.max(1, Math.round(cropped.height * down)),
    });
  }
  const size = out.getSize();
  return { data: out.toJPEG(Math.max(20, Math.min(quality.quality || 72, 95))), width: size.width, height: size.height };
}
