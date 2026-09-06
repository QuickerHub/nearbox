import { useCallback, useEffect, useRef, useState } from "react";
import type { HostSnapshot, RemoteButton, RemoteControlToHost, RemoteQuality } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { connectRemote, type RemoteConnection, type RemoteState } from "../lib/remoteClient";
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

const SPECIAL_KEYS: { label: string; codes: string[] }[] = [
  { label: "Esc", codes: ["Escape"] },
  { label: "Tab", codes: ["Tab"] },
  { label: "⌫", codes: ["Backspace"] },
  { label: "Del", codes: ["Delete"] },
  { label: "Enter", codes: ["Enter"] },
  { label: "↑", codes: ["ArrowUp"] },
  { label: "↓", codes: ["ArrowDown"] },
  { label: "←", codes: ["ArrowLeft"] },
  { label: "→", codes: ["ArrowRight"] },
  { label: "Win", codes: ["MetaLeft"] },
  { label: "Ctrl+C", codes: ["ControlLeft", "KeyC"] },
  { label: "Ctrl+V", codes: ["ControlLeft", "KeyV"] },
  { label: "Alt+Tab", codes: ["AltLeft", "Tab"] },
];

const STATE_LABEL: Record<RemoteState, string> = {
  connecting: "连接中…",
  open: "已连接",
  closed: "已断开",
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function RemoteView({ client, snapshot, onExit }: RemoteViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connRef = useRef<RemoteConnection | null>(null);
  const decodeRef = useRef<{ busy: boolean; queued: Blob | null }>({ busy: false, queued: null });
  const framesRef = useRef(0);
  const lastMoveRef = useRef(0);
  const activeButtonRef = useRef<RemoteButton | null>(null);
  const downRef = useRef(false);
  const scrollAccumRef = useRef(0);
  const lastClientYRef = useRef(0);
  const rightArmedRef = useRef(false);

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
  const [text, setText] = useState("");

  const send = useCallback((message: RemoteControlToHost) => {
    connRef.current?.send(message);
  }, []);

  const drawFrame = useCallback((blob: Blob) => {
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
  }, []);

  useEffect(() => {
    setState("connecting");
    setError(null);
    const conn = connectRemote(client.origin, client.token, {
      onFrame: drawFrame,
      onHello: (_display, canInput, quality) => {
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

  // Forward the physical keyboard while the view is focused and not typing in the IME box.
  useEffect(() => {
    if (!supportsInput || !keyboardOn) {
      return;
    }
    const isTypingTarget = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };
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

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!supportsInput) {
        return;
      }
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort */
      }
      downRef.current = true;
      lastClientYRef.current = event.clientY;
      scrollAccumRef.current = 0;
      if (scrollMode) {
        return;
      }
      const point = pointFromEvent(event);
      if (!point) {
        return;
      }
      const button: RemoteButton = rightArmedRef.current ? "right" : event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
      activeButtonRef.current = button;
      send({ t: "down", button, x: point.x, y: point.y });
    },
    [supportsInput, scrollMode, pointFromEvent, send],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!supportsInput) {
        return;
      }
      if (scrollMode && downRef.current) {
        const dyPixels = event.clientY - lastClientYRef.current;
        lastClientYRef.current = event.clientY;
        scrollAccumRef.current += dyPixels;
        const notches = Math.trunc(scrollAccumRef.current / 40);
        if (notches !== 0) {
          scrollAccumRef.current -= notches * 40;
          send({ t: "scroll", dy: -notches });
        }
        return;
      }
      const now = performance.now();
      if (now - lastMoveRef.current < 16) {
        return;
      }
      lastMoveRef.current = now;
      const point = pointFromEvent(event);
      if (point) {
        send({ t: "move", x: point.x, y: point.y });
      }
    },
    [supportsInput, scrollMode, pointFromEvent, send],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!supportsInput) {
        return;
      }
      event.preventDefault();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      downRef.current = false;
      if (scrollMode) {
        return;
      }
      const button = activeButtonRef.current;
      if (button) {
        const point = pointFromEvent(event);
        send({ t: "up", button, ...(point ?? {}) });
        activeButtonRef.current = null;
      }
      if (rightArmedRef.current) {
        rightArmedRef.current = false;
        setRightArmed(false);
      }
    },
    [supportsInput, scrollMode, pointFromEvent, send],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (!supportsInput) {
        return;
      }
      const dy = -event.deltaY / 100;
      const dx = -event.deltaX / 100;
      send({ t: "scroll", dy, dx });
    },
    [supportsInput, send],
  );

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
    },
    [],
  );

  const applyPreset = (preset: QualityPreset) => {
    setPresetId(preset.id);
    send({ t: "config", ...preset.quality });
  };

  const sendText = () => {
    const value = text;
    if (value) {
      send({ t: "text", value });
      setText("");
    }
  };

  const armRight = () => {
    const next = !rightArmed;
    setRightArmed(next);
    rightArmedRef.current = next;
  };

  const otherControllers = Math.max(0, controllers - 1);

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
        <div className="remote__presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === presetId ? "toggle toggle--on" : "toggle"}
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

      <div className="remote__viewport">
        <canvas
          ref={canvasRef}
          className="remote__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        />
        {!hasFrame || state !== "open" ? (
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
            <button type="button" className={rightArmed ? "toggle toggle--on" : "toggle"} onClick={armRight}>
              右键{rightArmed ? "·就绪" : ""}
            </button>
            <button type="button" className={scrollMode ? "toggle toggle--on" : "toggle"} onClick={() => setScrollMode((value) => !value)}>
              滚动{scrollMode ? "·开" : ""}
            </button>
          </div>
          <div className="remote__keys">
            {SPECIAL_KEYS.map((key) => (
              <button key={key.label} type="button" className="mini-btn" onClick={() => send({ t: "combo", codes: key.codes })}>
                {key.label}
              </button>
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
        </footer>
      ) : (
        <footer className="remote__controls remote__controls--view">
          <p className="muted small">这台电脑的系统不支持输入注入，当前为「仅查看」模式。</p>
        </footer>
      )}
    </div>
  );
}
