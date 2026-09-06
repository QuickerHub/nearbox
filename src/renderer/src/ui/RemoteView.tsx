import { useCallback, useEffect, useRef, useState } from "react";
import type { HostSnapshot, RemoteButton, RemoteControlToHost, RemoteQuality } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { connectRemote, type RemoteConnection, type RemoteState } from "../lib/remoteClient";
import {
  MAX_SCALE,
  MIN_SCALE,
  distance,
  fitSize,
  midpoint,
  pointToFrame,
  refitTransform,
  wheelZoomFactor,
  zoomAt,
  zoomBetween,
  zoomTo,
  type FramePoint,
  type Point,
  type Size,
  type ViewTransform,
} from "../lib/remoteZoom";
import { Icon } from "./Icons";

interface RemoteViewProps {
  client: ClientHandle;
  snapshot: HostSnapshot;
  onExit(): void;
}

interface QualityPreset {
  id: string;
  label: string;
  quality: RemoteQuality;
}

const PRESETS: QualityPreset[] = [
  { id: "smooth", label: "流畅", quality: { quality: 42, fps: 15, maxWidth: 1200 } },
  { id: "balanced", label: "均衡", quality: { quality: 55, fps: 12, maxWidth: 1440 } },
  { id: "crisp", label: "清晰", quality: { quality: 72, fps: 10, maxWidth: 1920 } },
];

type ModifierCode = "ControlLeft" | "ShiftLeft" | "AltLeft";

const MODIFIERS: { code: ModifierCode; label: string }[] = [
  { code: "ControlLeft", label: "Ctrl" },
  { code: "ShiftLeft", label: "Shift" },
  { code: "AltLeft", label: "Alt" },
];

interface KeyDef {
  label: string;
  codes: string[];
  hint?: string;
}

interface KeyGroup {
  id: string;
  /** `grid` flows two rows column by column; `nav` is the 3x2 Home/arrows/End cluster. */
  layout: "grid" | "nav";
  keys: KeyDef[];
}

const KEY_GROUPS: KeyGroup[] = [
  {
    id: "edit",
    layout: "grid",
    keys: [
      { label: "Esc", codes: ["Escape"] },
      { label: "Tab", codes: ["Tab"] },
      { label: "⌫", codes: ["Backspace"], hint: "Backspace" },
      { label: "Enter", codes: ["Enter"] },
      { label: "Del", codes: ["Delete"], hint: "Delete" },
      { label: "Space", codes: ["Space"] },
    ],
  },
  {
    id: "nav",
    layout: "nav",
    keys: [
      { label: "Home", codes: ["Home"] },
      { label: "↑", codes: ["ArrowUp"], hint: "上" },
      { label: "End", codes: ["End"] },
      { label: "←", codes: ["ArrowLeft"], hint: "左" },
      { label: "↓", codes: ["ArrowDown"], hint: "下" },
      { label: "→", codes: ["ArrowRight"], hint: "右" },
    ],
  },
  {
    id: "page",
    layout: "grid",
    keys: [
      { label: "PgUp", codes: ["PageUp"], hint: "Page Up" },
      { label: "PgDn", codes: ["PageDown"], hint: "Page Down" },
    ],
  },
  {
    id: "combos",
    layout: "grid",
    keys: [
      { label: "Ctrl+C", codes: ["ControlLeft", "KeyC"], hint: "复制" },
      { label: "Ctrl+V", codes: ["ControlLeft", "KeyV"], hint: "粘贴" },
      { label: "Ctrl+X", codes: ["ControlLeft", "KeyX"], hint: "剪切" },
      { label: "Ctrl+Z", codes: ["ControlLeft", "KeyZ"], hint: "撤销" },
      { label: "Ctrl+A", codes: ["ControlLeft", "KeyA"], hint: "全选" },
      { label: "Ctrl+S", codes: ["ControlLeft", "KeyS"], hint: "保存" },
    ],
  },
  {
    id: "system",
    layout: "grid",
    keys: [
      { label: "Alt+Tab", codes: ["AltLeft", "Tab"], hint: "切换窗口" },
      { label: "Alt+F4", codes: ["AltLeft", "F4"], hint: "关闭窗口" },
      { label: "Win", codes: ["MetaLeft"], hint: "开始菜单" },
      { label: "Win+D", codes: ["MetaLeft", "KeyD"], hint: "显示桌面" },
    ],
  },
];

const STATE_LABEL: Record<RemoteState, string> = {
  connecting: "连接中…",
  open: "已连接",
  closed: "已断开",
};

/** Finger travel (CSS px) still counted as a tap rather than a drag. */
const TAP_SLOP = 10;
/** Hold a finger still this long to get a right click. */
const LONG_PRESS_MS = 500;
/** A second tap this soon and this close snaps to the first tap so Windows sees a double-click. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 28;
/** Finger travel per wheel notch when scrolling by touch. */
const SCROLL_NOTCH_PX = 40;
/** Two fingers: this much change in spread means pinch-zoom, this much travel means scroll. */
const PINCH_ZOOM_RATIO = 0.06;
const PINCH_SCROLL_PX = 12;
const ZOOM_STEP = 1.5;
const HINT_MS = 6000;
/** A phone on its side: the key panel would eat most of the screen, so it starts collapsed. */
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 480px)";

type Gesture =
  | { kind: "idle" }
  /** One finger down, not yet known to be a tap, a drag, a long press or half of a pinch. */
  | { kind: "pending"; id: number; start: Point; timer: number }
  /** A mouse button is held on the host and follows this pointer. */
  | { kind: "drag"; id: number; button: RemoteButton; held: ModifierCode[] }
  /** One pointer scrolling the wheel (scroll mode). */
  | { kind: "scroll"; id: number; last: Point; accum: Point; anchor: FramePoint | null }
  /** Two fingers: zoom / pan the view, or wheel-scroll when the view is not zoomed. */
  | {
      kind: "pinch";
      ids: [number, number];
      mode: "undecided" | "zoom" | "scroll";
      startMid: Point;
      startDist: number;
      lastMid: Point;
      lastDist: number;
      accum: Point;
      anchor: FramePoint | null;
    }
  /** Mouse middle button drags the zoomed view around. */
  | { kind: "pan"; id: number; last: Point; start: Point; moved: boolean }
  /** A gesture finished but fingers are still down; ignore them until they all lift. */
  | { kind: "settle" };

interface Layout {
  frame: Size | null;
  fit: Size;
  viewport: Size;
  t: ViewTransform;
}

function mediaMatches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function coarsePointer(): boolean {
  return mediaMatches("(pointer: coarse)");
}

function isTypingTarget(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function KeyLabel({ label }: { label: string }): JSX.Element {
  const parts = label.split("+");
  if (parts.length === 1) {
    return <>{label}</>;
  }
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className="key__part">
          {index > 0 ? <span className="key__plus">+</span> : null}
          {part}
        </span>
      ))}
    </>
  );
}

export function RemoteView({ client, snapshot, onExit }: RemoteViewProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connRef = useRef<RemoteConnection | null>(null);
  const decodeRef = useRef<{ busy: boolean; queued: Blob | null }>({ busy: false, queued: null });
  const framesRef = useRef(0);
  const lastMoveRef = useRef(0);
  const layoutRef = useRef<Layout>({
    frame: null,
    fit: { width: 0, height: 0 },
    viewport: { width: 0, height: 0 },
    t: { scale: 1, x: 0, y: 0 },
  });
  const rafRef = useRef(0);
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const pointersRef = useRef(new Map<number, Point>());
  const lastTapRef = useRef<{ at: Point; frame: Point; time: number } | null>(null);
  const modsRef = useRef<ModifierCode[]>([]);
  const rightArmedRef = useRef(false);
  const scrollModeRef = useRef(false);
  const supportsInputRef = useRef(true);

  const [state, setState] = useState<RemoteState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [supportsInput, setSupportsInput] = useState(true);
  const [controllers, setControllers] = useState(1);
  const [hasFrame, setHasFrame] = useState(false);
  const [fps, setFps] = useState(0);
  const [presetId, setPresetId] = useState("balanced");
  const [keyboardOn, setKeyboardOn] = useState(true);
  const [scrollMode, setScrollMode] = useState(false);
  const [rightArmed, setRightArmed] = useState(false);
  const [mods, setMods] = useState<ModifierCode[]>([]);
  const [text, setText] = useState("");
  const [zoomPct, setZoomPct] = useState(100);
  const [panelOpen, setPanelOpen] = useState(() => !mediaMatches(SHORT_LANDSCAPE));
  const [hint, setHint] = useState(false);

  const send = useCallback((message: RemoteControlToHost) => {
    connRef.current?.send(message);
  }, []);

  /** Mouse / keyboard traffic only; dropped when the host cannot inject input. */
  const input = useCallback(
    (message: RemoteControlToHost) => {
      if (supportsInputRef.current) {
        send(message);
      }
    },
    [send],
  );

  // ------------------------------------------------------------------ zoom / layout

  const applyTransform = useCallback(() => {
    if (rafRef.current) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      const { t, fit } = layoutRef.current;
      if (canvas) {
        canvas.style.width = `${fit.width}px`;
        canvas.style.height = `${fit.height}px`;
        canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
      }
      setZoomPct(Math.round(t.scale * 100));
    });
  }, []);

  const relayout = useCallback(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) {
      return;
    }
    const layout = layoutRef.current;
    const viewport = { width: viewportEl.clientWidth, height: viewportEl.clientHeight };
    const fit = fitSize(layout.frame ?? { width: 16, height: 9 }, viewport);
    layout.t = refitTransform(layout.t, { fit: layout.fit, viewport: layout.viewport }, { fit, viewport });
    layout.fit = fit;
    layout.viewport = viewport;
    applyTransform();
  }, [applyTransform]);

  const setTransform = useCallback(
    (t: ViewTransform) => {
      layoutRef.current.t = t;
      applyTransform();
    },
    [applyTransform],
  );

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      const { t, fit, viewport } = layoutRef.current;
      setTransform(zoomTo(t, direction > 0 ? t.scale * ZOOM_STEP : t.scale / ZOOM_STEP, fit, viewport));
    },
    [setTransform],
  );

  const resetZoom = useCallback(() => {
    const { t, fit, viewport } = layoutRef.current;
    setTransform(zoomTo(t, MIN_SCALE, fit, viewport));
  }, [setTransform]);

  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) {
      return;
    }
    relayout();
    const observer = new ResizeObserver(() => relayout());
    observer.observe(viewportEl);
    return () => {
      observer.disconnect();
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [relayout]);

  const drawFrame = useCallback(
    (blob: Blob) => {
      const decode = decodeRef.current;
      if (decode.busy) {
        decode.queued = blob; // keep only the freshest frame under load
        return;
      }
      decode.busy = true;
      void createImageBitmap(blob)
        .then((bitmap) => {
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          }
          const layout = layoutRef.current;
          if (!layout.frame || layout.frame.width !== bitmap.width || layout.frame.height !== bitmap.height) {
            layout.frame = { width: bitmap.width, height: bitmap.height };
            relayout();
          }
          bitmap.close();
          framesRef.current += 1;
          setHasFrame(true);
          decode.busy = false;
          if (decode.queued) {
            const next = decode.queued;
            decode.queued = null;
            drawFrame(next);
          }
        })
        .catch(() => {
          decode.busy = false;
        });
    },
    [relayout],
  );

  // ------------------------------------------------------------------ connection

  // Declared before the connection effect so its cleanup runs first, while the socket is still open:
  // never leave a button held or a modifier pressed on the host if the view goes away mid-gesture.
  useEffect(() => {
    return () => {
      const gesture = gestureRef.current;
      if (gesture.kind === "pending") {
        window.clearTimeout(gesture.timer);
      } else if (gesture.kind === "drag") {
        connRef.current?.send({ t: "up", button: gesture.button });
        for (const code of [...gesture.held].reverse()) {
          connRef.current?.send({ t: "key", code, down: false });
        }
      }
      gestureRef.current = { kind: "idle" };
    };
  }, []);

  useEffect(() => {
    setState("connecting");
    setError(null);
    const conn = connectRemote(client.origin, client.token, {
      onFrame: drawFrame,
      onHello: (_display, canInput, quality) => {
        supportsInputRef.current = canInput;
        setSupportsInput(canInput);
        const match = PRESETS.find((preset) => preset.quality.maxWidth === quality.maxWidth);
        if (match) {
          setPresetId(match.id);
        }
      },
      onConfig: (quality) => {
        const match = PRESETS.find((preset) => preset.quality.maxWidth === quality.maxWidth);
        if (match) {
          setPresetId(match.id);
        }
      },
      onPeers: setControllers,
      onPong: () => undefined,
      onError: (message) => setError(message),
      onState: setState,
    });
    connRef.current = conn;
    return () => {
      conn.dispose();
      connRef.current = null;
    };
  }, [client.origin, client.token, drawFrame]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFps(framesRef.current);
      framesRef.current = 0;
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Show the touch gesture cheat-sheet once the first frame lands on a touch device.
  useEffect(() => {
    if (!hasFrame || !coarsePointer()) {
      return;
    }
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hasFrame]);

  // Rotating a phone: collapse the key panel in short landscape, bring it back in portrait.
  // Skipped while typing, because the soft keyboard shrinking the viewport looks the same as a rotation.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(SHORT_LANDSCAPE);
    const onChange = (event: MediaQueryListEvent) => {
      if (!isTypingTarget()) {
        setPanelOpen(!event.matches);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Forward the physical keyboard while the view is focused and not typing in the IME box.
  useEffect(() => {
    if (!supportsInput || !keyboardOn) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget()) {
        return;
      }
      event.preventDefault();
      send({ t: "key", code: event.code, down: true });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isTypingTarget()) {
        return;
      }
      event.preventDefault();
      send({ t: "key", code: event.code, down: false });
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [supportsInput, keyboardOn, send]);

  // ------------------------------------------------------------------ modifiers

  const toggleModifier = (code: ModifierCode) => {
    const next = modsRef.current.includes(code) ? modsRef.current.filter((item) => item !== code) : [...modsRef.current, code];
    modsRef.current = next;
    setMods(next);
  };

  const clearModifiers = useCallback(() => {
    if (modsRef.current.length) {
      modsRef.current = [];
      setMods([]);
    }
  }, []);

  /** Press the latched modifiers on the host; the caller releases them after its action. */
  const holdModifiers = useCallback((): ModifierCode[] => {
    const held = [...modsRef.current];
    for (const code of held) {
      input({ t: "key", code, down: true });
    }
    return held;
  }, [input]);

  const releaseModifiers = useCallback(
    (held: ModifierCode[]) => {
      for (const code of [...held].reverse()) {
        input({ t: "key", code, down: false });
      }
      if (held.length) {
        clearModifiers();
      }
    },
    [input, clearModifiers],
  );

  const pressKey = (key: KeyDef) => {
    const extra = modsRef.current.filter((code) => !key.codes.includes(code));
    input({ t: "combo", codes: [...extra, ...key.codes] });
    clearModifiers();
  };

  // ------------------------------------------------------------------ pointer helpers

  const viewportPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  }, []);

  const framePoint = useCallback((point: Point): FramePoint | null => {
    const { t, fit } = layoutRef.current;
    return pointToFrame(point, t, fit);
  }, []);

  /** Which button a plain tap / click stands for right now, consuming the "right click next" arm. */
  const takeButton = useCallback((fallback: RemoteButton): RemoteButton => {
    if (rightArmedRef.current) {
      rightArmedRef.current = false;
      setRightArmed(false);
      return "right";
    }
    return fallback;
  }, []);

  const clickAt = useCallback(
    (frame: Point, button: RemoteButton) => {
      const held = holdModifiers();
      input({ t: "click", button, x: frame.x, y: frame.y });
      releaseModifiers(held);
    },
    [holdModifiers, input, releaseModifiers],
  );

  const sendMove = useCallback(
    (point: Point, force = false) => {
      const now = performance.now();
      if (!force && now - lastMoveRef.current < 16) {
        return;
      }
      lastMoveRef.current = now;
      const frame = framePoint(point);
      if (frame) {
        input({ t: "move", x: frame.x, y: frame.y });
      }
    },
    [framePoint, input],
  );

  /** Turn accumulated finger travel into wheel notches; `anchor` puts the host cursor over the content first. */
  const flushScroll = useCallback(
    (accum: Point, anchor: FramePoint | null) => {
      const notchesY = Math.trunc(accum.y / SCROLL_NOTCH_PX);
      const notchesX = Math.trunc(accum.x / SCROLL_NOTCH_PX);
      if (notchesY === 0 && notchesX === 0) {
        return;
      }
      accum.y -= notchesY * SCROLL_NOTCH_PX;
      accum.x -= notchesX * SCROLL_NOTCH_PX;
      const message: RemoteControlToHost = { t: "scroll", dy: -notchesY, dx: -notchesX };
      if (anchor?.inside) {
        message.x = anchor.x;
        message.y = anchor.y;
      }
      input(message);
    },
    [input],
  );

  const startDrag = useCallback(
    (id: number, at: Point, button: RemoteButton): Gesture => {
      const frame = framePoint(at);
      if (!frame?.inside) {
        return { kind: "settle" };
      }
      lastTapRef.current = null;
      const held = holdModifiers();
      input({ t: "down", button, x: frame.x, y: frame.y });
      return { kind: "drag", id, button, held };
    },
    [framePoint, holdModifiers, input],
  );

  const endDrag = useCallback(
    (gesture: Extract<Gesture, { kind: "drag" }>, at: Point) => {
      const frame = framePoint(at);
      input({ t: "up", button: gesture.button, ...(frame ? { x: frame.x, y: frame.y } : {}) });
      releaseModifiers(gesture.held);
    },
    [framePoint, input, releaseModifiers],
  );

  const startPinch = useCallback(
    (a: number, b: number): Gesture => {
      const pa = pointersRef.current.get(a);
      const pb = pointersRef.current.get(b);
      if (!pa || !pb) {
        return { kind: "settle" };
      }
      const mid = midpoint(pa, pb);
      const dist = distance(pa, pb);
      lastTapRef.current = null;
      return {
        kind: "pinch",
        ids: [a, b],
        // Already zoomed in: two fingers pan right away. At fit size, wait to see if it is a pinch or a scroll.
        mode: layoutRef.current.t.scale > 1.001 ? "zoom" : "undecided",
        startMid: mid,
        startDist: dist,
        lastMid: mid,
        lastDist: dist,
        accum: { x: 0, y: 0 },
        anchor: framePoint(mid),
      };
    },
    [framePoint],
  );

  const tap = useCallback(
    (at: Point) => {
      const frame = framePoint(at);
      if (!frame?.inside) {
        return;
      }
      const now = performance.now();
      const last = lastTapRef.current;
      let target: Point = frame;
      if (last && !rightArmedRef.current && now - last.time < DOUBLE_TAP_MS && distance(at, last.at) < DOUBLE_TAP_SLOP) {
        target = last.frame; // same host pixel as the first tap, so Windows treats it as a double-click
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { at, frame, time: now };
      }
      clickAt(target, takeButton("left"));
    },
    [framePoint, clickAt, takeButton],
  );

  const longPress = useCallback(
    (id: number) => {
      const gesture = gestureRef.current;
      if (gesture.kind !== "pending" || gesture.id !== id) {
        return;
      }
      const frame = framePoint(gesture.start);
      lastTapRef.current = null;
      if (frame?.inside) {
        takeButton("right");
        clickAt(frame, "right");
      }
      gestureRef.current = { kind: "settle" };
    },
    [framePoint, clickAt, takeButton],
  );

  // ------------------------------------------------------------------ pointer events

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewportEl = viewportRef.current;
      if (!viewportEl || (event.target !== viewportEl && event.target !== canvasRef.current)) {
        return; // zoom buttons, hint and overlay live inside the viewport too
      }
      event.preventDefault();
      try {
        viewportEl.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort */
      }
      const point = viewportPoint(event.clientX, event.clientY);
      const pointers = pointersRef.current;
      const gesture = gestureRef.current;

      if (event.pointerType === "touch") {
        pointers.set(event.pointerId, point);
        if (pointers.size === 1) {
          if (scrollModeRef.current) {
            gestureRef.current = { kind: "scroll", id: event.pointerId, last: point, accum: { x: 0, y: 0 }, anchor: framePoint(point) };
          } else {
            const timer = window.setTimeout(() => longPress(event.pointerId), LONG_PRESS_MS);
            gestureRef.current = { kind: "pending", id: event.pointerId, start: point, timer };
          }
          return;
        }
        if (pointers.size === 2) {
          if (gesture.kind === "pending") {
            window.clearTimeout(gesture.timer);
            gestureRef.current = startPinch(gesture.id, event.pointerId);
          } else if (gesture.kind === "drag") {
            endDrag(gesture, pointers.get(gesture.id) ?? point);
            gestureRef.current = startPinch(gesture.id, event.pointerId);
          } else if (gesture.kind === "scroll") {
            gestureRef.current = startPinch(gesture.id, event.pointerId);
          }
        }
        return; // a third finger changes nothing
      }

      // Mouse / pen: immediate, one pointer at a time.
      if (gesture.kind !== "idle") {
        return;
      }
      if (event.button === 1) {
        gestureRef.current = { kind: "pan", id: event.pointerId, last: point, start: point, moved: false };
        return;
      }
      if (scrollModeRef.current) {
        gestureRef.current = { kind: "scroll", id: event.pointerId, last: point, accum: { x: 0, y: 0 }, anchor: framePoint(point) };
        return;
      }
      const button = takeButton(event.button === 2 ? "right" : "left");
      const next = startDrag(event.pointerId, point, button);
      gestureRef.current = next.kind === "settle" ? { kind: "idle" } : next;
    },
    [viewportPoint, framePoint, longPress, startPinch, endDrag, takeButton, startDrag],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = viewportPoint(event.clientX, event.clientY);
      const pointers = pointersRef.current;
      const gesture = gestureRef.current;

      if (event.pointerType === "touch") {
        if (!pointers.has(event.pointerId)) {
          return;
        }
        pointers.set(event.pointerId, point);
      } else if (gesture.kind === "idle") {
        // Hovering mouse: keep the host cursor under it.
        if (event.target === viewportRef.current || event.target === canvasRef.current) {
          const frame = framePoint(point);
          if (frame?.inside) {
            sendMove(point);
          }
        }
        return;
      }

      switch (gesture.kind) {
        case "pending": {
          if (gesture.id !== event.pointerId || distance(point, gesture.start) <= TAP_SLOP) {
            return;
          }
          window.clearTimeout(gesture.timer);
          const next = startDrag(gesture.id, gesture.start, takeButton("left"));
          gestureRef.current = next;
          if (next.kind === "drag") {
            sendMove(point, true);
          }
          return;
        }
        case "drag":
          if (gesture.id === event.pointerId) {
            sendMove(point);
          }
          return;
        case "scroll":
          if (gesture.id === event.pointerId) {
            gesture.accum.x += point.x - gesture.last.x;
            gesture.accum.y += point.y - gesture.last.y;
            gesture.last = point;
            flushScroll(gesture.accum, gesture.anchor);
          }
          return;
        case "pan": {
          if (gesture.id !== event.pointerId) {
            return;
          }
          if (!gesture.moved && distance(point, gesture.start) <= TAP_SLOP) {
            return;
          }
          gesture.moved = true;
          const { t, fit, viewport } = layoutRef.current;
          setTransform(
            zoomBetween(t, 1, gesture.last, point, fit, viewport),
          );
          gesture.last = point;
          return;
        }
        case "pinch": {
          const [a, b] = gesture.ids;
          if (event.pointerId !== a && event.pointerId !== b) {
            return;
          }
          const pa = pointers.get(a);
          const pb = pointers.get(b);
          if (!pa || !pb) {
            return;
          }
          const mid = midpoint(pa, pb);
          const dist = distance(pa, pb);
          if (gesture.mode === "undecided") {
            const ratio = gesture.startDist > 0 ? dist / gesture.startDist : 1;
            if (Math.abs(ratio - 1) > PINCH_ZOOM_RATIO) {
              gesture.mode = "zoom";
            } else if (distance(mid, gesture.startMid) > PINCH_SCROLL_PX) {
              gesture.mode = "scroll";
            } else {
              gesture.lastMid = mid;
              gesture.lastDist = dist;
              return;
            }
          }
          if (gesture.mode === "zoom") {
            const { t, fit, viewport } = layoutRef.current;
            const factor = gesture.lastDist > 0 ? dist / gesture.lastDist : 1;
            setTransform(zoomBetween(t, factor, gesture.lastMid, mid, fit, viewport));
          } else {
            gesture.accum.x += mid.x - gesture.lastMid.x;
            gesture.accum.y += mid.y - gesture.lastMid.y;
            flushScroll(gesture.accum, gesture.anchor);
          }
          gesture.lastMid = mid;
          gesture.lastDist = dist;
          return;
        }
        default:
          return;
      }
    },
    [viewportPoint, framePoint, sendMove, startDrag, takeButton, flushScroll, setTransform],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = viewportPoint(event.clientX, event.clientY);
      const pointers = pointersRef.current;
      const gesture = gestureRef.current;
      const isTouch = event.pointerType === "touch";
      if (isTouch) {
        if (!pointers.has(event.pointerId)) {
          return;
        }
        pointers.delete(event.pointerId);
      }
      try {
        viewportRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      switch (gesture.kind) {
        case "pending":
          if (gesture.id === event.pointerId) {
            window.clearTimeout(gesture.timer);
            if (event.type !== "pointercancel") {
              tap(gesture.start);
            }
            gestureRef.current = { kind: "idle" };
          }
          break;
        case "drag":
          if (gesture.id === event.pointerId) {
            endDrag(gesture, point);
            gestureRef.current = { kind: "idle" };
          }
          break;
        case "scroll":
          if (gesture.id === event.pointerId) {
            gestureRef.current = { kind: "idle" };
          }
          break;
        case "pan":
          if (gesture.id === event.pointerId) {
            if (!gesture.moved && event.type !== "pointercancel") {
              const frame = framePoint(gesture.start);
              if (frame?.inside) {
                clickAt(frame, "middle");
              }
            }
            gestureRef.current = { kind: "idle" };
          }
          break;
        case "pinch":
          if (gesture.ids.includes(event.pointerId)) {
            gestureRef.current = pointers.size > 0 ? { kind: "settle" } : { kind: "idle" };
          }
          break;
        default:
          break;
      }
      if (isTouch && pointers.size === 0) {
        gestureRef.current = { kind: "idle" };
      }
    },
    [viewportPoint, tap, endDrag, framePoint, clickAt],
  );

  // Wheel needs a non-passive listener so ctrl+wheel (and trackpad pinch) can zoom without zooming the page.
  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.target !== viewportEl && event.target !== canvasRef.current) {
        return;
      }
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const { t, fit, viewport } = layoutRef.current;
        setTransform(zoomAt(t, wheelZoomFactor(event.deltaY), viewportPoint(event.clientX, event.clientY), fit, viewport));
        return;
      }
      input({ t: "scroll", dy: -event.deltaY / 100, dx: -event.deltaX / 100 });
    };
    viewportEl.addEventListener("wheel", onWheel, { passive: false });
    return () => viewportEl.removeEventListener("wheel", onWheel);
  }, [setTransform, viewportPoint, input]);

  const onContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  // ------------------------------------------------------------------ footer actions

  const applyPreset = (preset: QualityPreset) => {
    setPresetId(preset.id);
    send({ t: "config", ...preset.quality });
  };

  const sendText = () => {
    const value = text;
    if (value) {
      input({ t: "text", value });
      setText("");
    }
  };

  const armRight = () => {
    const next = !rightArmedRef.current;
    rightArmedRef.current = next;
    setRightArmed(next);
  };

  const toggleScrollMode = () => {
    const next = !scrollModeRef.current;
    scrollModeRef.current = next;
    setScrollMode(next);
  };

  const otherControllers = Math.max(0, controllers - 1);
  const live = hasFrame && state === "open";

  return (
    <div className="remote">
      <header className="remote__bar">
        <button type="button" className="icon-btn icon-btn--plain" onClick={onExit} title="返回">
          <Icon name="back" />
        </button>
        <div className="remote__title">
          <Icon name="monitor" size={16} />
          <strong>{snapshot.hostName}</strong>
          <span className={`remote__state remote__state--${state}`}>{STATE_LABEL[state]}</span>
        </div>
        <div className="remote__stats muted small">
          {hasFrame ? `${fps} fps` : "等待画面"}
          {otherControllers > 0 ? ` · 另有 ${otherControllers} 台在看` : ""}
        </div>
        <div className="remote__presets" role="group" aria-label="画质">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === presetId ? "seg seg--on" : "seg"}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {supportsInput ? (
          <button
            type="button"
            className={keyboardOn ? "icon-btn icon-btn--on" : "icon-btn icon-btn--plain"}
            onClick={() => setKeyboardOn((value) => !value)}
            title={keyboardOn ? "键盘转发已开（点按暂停）" : "键盘转发已停"}
          >
            <Icon name="keyboard" size={16} />
          </button>
        ) : null}
      </header>

      <div
        ref={viewportRef}
        className={supportsInput ? "remote__viewport remote__viewport--input" : "remote__viewport"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
      >
        <canvas ref={canvasRef} className={hasFrame ? "remote__canvas" : "remote__canvas remote__canvas--empty"} />
        {live ? (
          <div className="remote__zoom">
            <button type="button" className="remote__zoom-btn" onClick={() => stepZoom(-1)} disabled={zoomPct <= MIN_SCALE * 100} title="缩小">
              <Icon name="zoom-out" size={16} />
            </button>
            <button type="button" className="remote__zoom-level" onClick={resetZoom} title="恢复到适应屏幕">
              {zoomPct}%
            </button>
            <button type="button" className="remote__zoom-btn" onClick={() => stepZoom(1)} disabled={zoomPct >= MAX_SCALE * 100} title="放大">
              <Icon name="zoom-in" size={16} />
            </button>
          </div>
        ) : null}
        {live && hint ? (
          <button type="button" className="remote__hint" onClick={() => setHint(false)}>
            {supportsInput ? "单指点按 · 长按 = 右键 · 双指缩放 / 平移" : "双指缩放 / 平移"}
          </button>
        ) : null}
        {!live ? (
          <div className="remote__overlay">
            {error ? (
              <>
                <strong>{error}</strong>
                <p className="muted small">在电脑「设置 → 远程控制」里确认开关，或稍后重试。</p>
              </>
            ) : (
              <>
                <span className="spinner" />
                <p className="muted small">{STATE_LABEL[state]}</p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {supportsInput ? (
        <footer className="remote__controls">
          <div className="remote__modes">
            <button type="button" className={rightArmed ? "toggle toggle--on" : "toggle"} onClick={armRight} title="下一次点按发送右键">
              <Icon name="click" size={14} />
              右键
            </button>
            <button type="button" className={scrollMode ? "toggle toggle--on" : "toggle"} onClick={toggleScrollMode} title="拖动画面时滚动鼠标滚轮">
              <Icon name="mouse" size={14} />
              滚动
            </button>
            <span className="remote__sep" aria-hidden />
            {MODIFIERS.map((modifier) => (
              <button
                key={modifier.code}
                type="button"
                className={mods.includes(modifier.code) ? "toggle toggle--key toggle--on" : "toggle toggle--key"}
                onClick={() => toggleModifier(modifier.code)}
                title={`按住 ${modifier.label}，和下一次点按或按键一起发送`}
              >
                {modifier.label}
              </button>
            ))}
            <button
              type="button"
              className="icon-btn icon-btn--plain remote__collapse"
              onClick={() => setPanelOpen((value) => !value)}
              title={panelOpen ? "收起按键面板" : "展开按键面板"}
            >
              <Icon name={panelOpen ? "chevron-down" : "chevron-up"} size={16} />
            </button>
          </div>
          {panelOpen ? (
            <>
              <div className="remote__keys">
                {KEY_GROUPS.map((group) => (
                  <div key={group.id} className={`keygroup keygroup--${group.layout}`}>
                    {group.keys.map((key) => (
                      <button
                        key={key.label}
                        type="button"
                        className={key.codes.length > 1 ? "key key--combo" : "key"}
                        title={key.hint}
                        onClick={() => pressKey(key)}
                        onPointerDown={(event) => event.preventDefault()} // keep focus (and the soft keyboard) where it is
                      >
                        <KeyLabel label={key.label} />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <form
                className="remote__text"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendText();
                }}
              >
                <input
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="输入文字发送到电脑（支持中文 / 粘贴）"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button type="submit" className="primary primary--icon" disabled={!text}>
                  <Icon name="send" size={15} />
                  发送
                </button>
              </form>
            </>
          ) : null}
        </footer>
      ) : (
        <footer className="remote__controls remote__controls--view">
          <p className="muted small">这台电脑的系统不支持输入注入，当前为「仅查看」模式。</p>
        </footer>
      )}
    </div>
  );
}
