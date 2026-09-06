import type {
  RemoteButton,
  RemoteControlToHost,
  RemoteQuality,
} from "@shared/protocol";

// Pure translation between the viewer's high-level input messages and the tiny
// line protocol our Windows injector reads on stdin. No Node/Electron imports so
// this stays unit-testable. Every injector command is a single line of ASCII:
//
//   M <x> <y>        absolute mouse move, x/y in 0..65535 over the primary screen
//   B <1|2|3> <0|1>  mouse button (1 left, 2 right, 3 middle) up(0)/down(1)
//   W <delta>        vertical wheel, signed, multiples of 120
//   H <delta>        horizontal wheel, signed, multiples of 120
//   K <vk> <0|1> <0|1>  key by virtual-key code, up(0)/down(1), extended flag
//   U <codeunit>     type one UTF-16 code unit as a Unicode keystroke

const ABS_MAX = 65535;
const WHEEL_STEP = 120;

const BUTTON_CODE: Record<RemoteButton, number> = { left: 1, right: 2, middle: 3 };

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Map a normalized [0,1] coordinate to the SendInput absolute range. */
export function toAbsolute(value: number): number {
  return Math.round(clampUnit(value) * ABS_MAX);
}

export function moveCommand(x: number, y: number): string {
  return `M ${toAbsolute(x)} ${toAbsolute(y)}`;
}

export function buttonCommand(button: RemoteButton, down: boolean): string {
  return `B ${BUTTON_CODE[button] ?? 1} ${down ? 1 : 0}`;
}

/** notches > 0 scrolls the wheel forward (content up), matching a physical mouse. */
export function wheelCommand(notches: number): string | null {
  const delta = Math.round((Number.isFinite(notches) ? notches : 0) * WHEEL_STEP);
  return delta === 0 ? null : `W ${delta}`;
}

export function hWheelCommand(notches: number): string | null {
  const delta = Math.round((Number.isFinite(notches) ? notches : 0) * WHEEL_STEP);
  return delta === 0 ? null : `H ${delta}`;
}

export function keyCommand(vk: number, down: boolean, extended: boolean): string {
  return `K ${vk} ${down ? 1 : 0} ${extended ? 1 : 0}`;
}

/** One Unicode keystroke per UTF-16 code unit; surrogate pairs pass through untouched. */
export function textCommands(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    out.push(`U ${value.charCodeAt(i)}`);
  }
  return out;
}

interface VkMapping {
  vk: number;
  extended: boolean;
}

const EXTENDED_CODES = new Set([
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "NumpadDivide",
  "NumpadEnter",
  "ControlRight",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "PrintScreen",
  "NumLock",
  "ContextMenu",
]);

const NAMED_VK: Record<string, number> = {
  Escape: 0x1b,
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Space: 0x20,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  CapsLock: 0x14,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  Insert: 0x2d,
  Delete: 0x2e,
  Minus: 0xbd,
  Equal: 0xbb,
  BracketLeft: 0xdb,
  BracketRight: 0xdd,
  Backslash: 0xdc,
  Semicolon: 0xba,
  Quote: 0xde,
  Backquote: 0xc0,
  Comma: 0xbc,
  Period: 0xbe,
  Slash: 0xbf,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadMultiply: 0x6a,
  NumpadDivide: 0x6f,
  NumpadDecimal: 0x6e,
  PrintScreen: 0x2c,
  ScrollLock: 0x91,
  Pause: 0x13,
  NumLock: 0x90,
  AudioVolumeMute: 0xad,
  AudioVolumeDown: 0xae,
  AudioVolumeUp: 0xaf,
  MediaPlayPause: 0xb3,
};

/** Resolve a DOM `KeyboardEvent.code` to a Windows virtual-key code. */
export function codeToVk(code: string): VkMapping | null {
  let vk: number | undefined;
  if (/^Key[A-Z]$/.test(code)) {
    vk = code.charCodeAt(3); // 'A'..'Z' == 0x41..0x5A
  } else if (/^Digit[0-9]$/.test(code)) {
    vk = code.charCodeAt(5); // '0'..'9' == 0x30..0x39
  } else if (/^Numpad[0-9]$/.test(code)) {
    vk = 0x60 + Number(code.slice(6));
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    vk = 0x70 + Number(code.slice(1)) - 1;
  } else {
    vk = NAMED_VK[code];
  }
  if (vk === undefined) {
    return null;
  }
  return { vk, extended: EXTENDED_CODES.has(code) };
}

function comboCommands(codes: string[]): string[] {
  const resolved = codes.map(codeToVk).filter((item): item is VkMapping => item !== null);
  if (!resolved.length) {
    return [];
  }
  const down = resolved.map((item) => keyCommand(item.vk, true, item.extended));
  const up = [...resolved].reverse().map((item) => keyCommand(item.vk, false, item.extended));
  return [...down, ...up];
}

/** Turn one control message into the injector commands it should produce. */
export function translateInput(msg: RemoteControlToHost): string[] {
  switch (msg.t) {
    case "move":
      return [moveCommand(msg.x, msg.y)];
    case "down": {
      const out: string[] = [];
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        out.push(moveCommand(msg.x, msg.y));
      }
      out.push(buttonCommand(msg.button, true));
      return out;
    }
    case "up": {
      const out: string[] = [];
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        out.push(moveCommand(msg.x, msg.y));
      }
      out.push(buttonCommand(msg.button, false));
      return out;
    }
    case "click": {
      const out: string[] = [];
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        out.push(moveCommand(msg.x, msg.y));
      }
      out.push(buttonCommand(msg.button, true), buttonCommand(msg.button, false));
      if (msg.double) {
        out.push(buttonCommand(msg.button, true), buttonCommand(msg.button, false));
      }
      return out;
    }
    case "scroll": {
      const out: string[] = [];
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        out.push(moveCommand(msg.x, msg.y));
      }
      const vertical = wheelCommand(msg.dy ?? 0);
      if (vertical) {
        out.push(vertical);
      }
      const horizontal = hWheelCommand(msg.dx ?? 0);
      if (horizontal) {
        out.push(horizontal);
      }
      return out;
    }
    case "key": {
      const mapping = codeToVk(msg.code);
      return mapping ? [keyCommand(mapping.vk, msg.down, mapping.extended)] : [];
    }
    case "combo":
      return comboCommands(msg.codes);
    case "text":
      return textCommands(msg.value);
    default:
      return [];
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return num < min ? min : num > max ? max : num;
}

/** Fold a partial quality request onto a base config, keeping every field in range. */
export function clampQuality(
  patch: Partial<RemoteQuality> | undefined,
  base: RemoteQuality,
): RemoteQuality {
  return {
    quality: patch?.quality === undefined ? base.quality : clampInt(patch.quality, 20, 95, base.quality),
    fps: patch?.fps === undefined ? base.fps : clampInt(patch.fps, 1, 30, base.fps),
    maxWidth: patch?.maxWidth === undefined ? base.maxWidth : clampInt(patch.maxWidth, 480, 3840, base.maxWidth),
  };
}

/** Skip a client whose send buffer is already backed up, so we never queue frames faster than the link drains. */
export function shouldSendFrame(bufferedAmount: number, threshold = 512 * 1024): boolean {
  return bufferedAmount <= threshold;
}

const KNOWN_TYPES = new Set([
  "move",
  "down",
  "up",
  "click",
  "scroll",
  "key",
  "combo",
  "text",
  "config",
  "ping",
]);

/** Parse and sanity-check a control-channel message; returns null for anything malformed. */
export function parseControlMessage(raw: string): RemoteControlToHost | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.t !== "string" || !KNOWN_TYPES.has(msg.t)) {
    return null;
  }
  switch (msg.t) {
    case "move":
      return typeof msg.x === "number" && typeof msg.y === "number" ? { t: "move", x: msg.x, y: msg.y } : null;
    case "down":
    case "up":
    case "click": {
      const button = asButton(msg.button);
      if (!button) {
        return null;
      }
      const base = { t: msg.t, button } as RemoteControlToHost;
      const withXy = attachXy(base as Record<string, unknown>, msg);
      if (msg.t === "click" && msg.double === true) {
        (withXy as Record<string, unknown>).double = true;
      }
      return withXy;
    }
    case "scroll": {
      const out: Record<string, unknown> = { t: "scroll" };
      if (typeof msg.dy === "number") {
        out.dy = msg.dy;
      }
      if (typeof msg.dx === "number") {
        out.dx = msg.dx;
      }
      attachXy(out, msg);
      return out as RemoteControlToHost;
    }
    case "key":
      return typeof msg.code === "string" && typeof msg.down === "boolean"
        ? { t: "key", code: msg.code, down: msg.down }
        : null;
    case "combo":
      return Array.isArray(msg.codes) && msg.codes.every((c) => typeof c === "string")
        ? { t: "combo", codes: msg.codes as string[] }
        : null;
    case "text":
      return typeof msg.value === "string" ? { t: "text", value: msg.value } : null;
    case "config":
      return {
        t: "config",
        quality: typeof msg.quality === "number" ? msg.quality : undefined,
        fps: typeof msg.fps === "number" ? msg.fps : undefined,
        maxWidth: typeof msg.maxWidth === "number" ? msg.maxWidth : undefined,
      };
    case "ping":
      return { t: "ping", ts: typeof msg.ts === "number" ? msg.ts : undefined };
    default:
      return null;
  }
}

function asButton(value: unknown): RemoteButton | null {
  return value === "left" || value === "right" || value === "middle" ? value : null;
}

function attachXy(target: Record<string, unknown>, msg: Record<string, unknown>): RemoteControlToHost {
  if (typeof msg.x === "number" && typeof msg.y === "number") {
    target.x = msg.x;
    target.y = msg.y;
  }
  return target as RemoteControlToHost;
}
