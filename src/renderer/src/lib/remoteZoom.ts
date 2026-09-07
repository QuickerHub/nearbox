// Pure geometry for the remote-control viewer: how the streamed frame is fit
// inside the viewport, how pinch / wheel zoom moves it around, and how a point
// on screen maps back to the normalized [0,1] coordinates the host expects.
// No DOM here so it stays unit-testable.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewTransform {
  /** Zoom relative to the fit-to-viewport size; 1 means the whole frame is visible. */
  scale: number;
  /** Top-left corner of the drawn frame inside the viewport, in CSS pixels. */
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return MIN_SCALE;
  }
  return scale < MIN_SCALE ? MIN_SCALE : scale > MAX_SCALE ? MAX_SCALE : scale;
}

/** Largest box with the frame's aspect ratio that fits inside the viewport. */
export function fitSize(frame: Size, viewport: Size): Size {
  if (frame.width <= 0 || frame.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  return { width: frame.width * ratio, height: frame.height * ratio };
}

/** The frame centered at scale 1. */
export function fitTransform(fit: Size, viewport: Size): ViewTransform {
  return { scale: 1, x: (viewport.width - fit.width) / 2, y: (viewport.height - fit.height) / 2 };
}

function clampAxis(offset: number, drawn: number, viewport: number): number {
  if (drawn <= viewport) {
    return (viewport - drawn) / 2; // smaller than the viewport: keep it centered
  }
  // Larger than the viewport: never let the edge of the frame come inside.
  return offset > 0 ? 0 : offset < viewport - drawn ? viewport - drawn : offset;
}

/** Keep the frame covering the viewport on any axis where it is bigger, centered where it is not. */
export function clampTransform(t: ViewTransform, fit: Size, viewport: Size): ViewTransform {
  const scale = clampScale(t.scale);
  return {
    scale,
    x: clampAxis(t.x, fit.width * scale, viewport.width),
    y: clampAxis(t.y, fit.height * scale, viewport.height),
  };
}

/**
 * Zoom so that the frame point currently under `anchor` ends up under `target`.
 * A plain zoom passes the same point for both; a pinch passes the previous and
 * current midpoints so the content tracks the fingers.
 */
export function zoomBetween(
  t: ViewTransform,
  factor: number,
  anchor: Point,
  target: Point,
  fit: Size,
  viewport: Size,
): ViewTransform {
  const scale = clampScale(t.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  const k = scale / t.scale;
  return clampTransform(
    {
      scale,
      x: target.x - (anchor.x - t.x) * k,
      y: target.y - (anchor.y - t.y) * k,
    },
    fit,
    viewport,
  );
}

/** Zoom around a fixed point (buttons, ctrl+wheel). */
export function zoomAt(t: ViewTransform, factor: number, at: Point, fit: Size, viewport: Size): ViewTransform {
  return zoomBetween(t, factor, at, at, fit, viewport);
}

/** Zoom to an exact scale around the middle of the viewport. */
export function zoomTo(t: ViewTransform, scale: number, fit: Size, viewport: Size): ViewTransform {
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  return zoomAt(t, clampScale(scale) / t.scale, center, fit, viewport);
}

export function panBy(t: ViewTransform, dx: number, dy: number, fit: Size, viewport: Size): ViewTransform {
  return clampTransform({ scale: t.scale, x: t.x + dx, y: t.y + dy }, fit, viewport);
}

/**
 * The viewport or the frame changed size: keep the same zoom and keep whatever
 * was in the middle of the viewport in the middle.
 */
export function refitTransform(
  t: ViewTransform,
  previous: { fit: Size; viewport: Size },
  next: { fit: Size; viewport: Size },
): ViewTransform {
  if (previous.fit.width <= 0 || previous.fit.height <= 0) {
    return clampTransform(fitTransform(next.fit, next.viewport), next.fit, next.viewport);
  }
  const centerX = (previous.viewport.width / 2 - t.x) / (t.scale * previous.fit.width);
  const centerY = (previous.viewport.height / 2 - t.y) / (t.scale * previous.fit.height);
  return clampTransform(
    {
      scale: t.scale,
      x: next.viewport.width / 2 - centerX * t.scale * next.fit.width,
      y: next.viewport.height / 2 - centerY * t.scale * next.fit.height,
    },
    next.fit,
    next.viewport,
  );
}

export interface FramePoint extends Point {
  /** False when the viewport point falls on the letterbox rather than the frame. */
  inside: boolean;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Map a viewport point (CSS px from its top-left) to normalized frame coordinates. */
export function pointToFrame(point: Point, t: ViewTransform, fit: Size): FramePoint | null {
  const drawnWidth = fit.width * t.scale;
  const drawnHeight = fit.height * t.scale;
  if (drawnWidth <= 0 || drawnHeight <= 0) {
    return null;
  }
  const x = (point.x - t.x) / drawnWidth;
  const y = (point.y - t.y) / drawnHeight;
  return { x: clamp01(x), y: clamp01(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export function isFullCrop(crop: CropRect): boolean {
  return crop.x <= 0.001 && crop.y <= 0.001 && crop.w >= 0.998 && crop.h >= 0.998;
}

/** The portion of the frame currently on screen, padded so a small pan does not re-request. */
export function visibleCrop(t: ViewTransform, fit: Size, viewport: Size, pad = 0.14): CropRect {
  const drawnWidth = fit.width * t.scale;
  const drawnHeight = fit.height * t.scale;
  if (drawnWidth <= 0 || drawnHeight <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { ...FULL_CROP };
  }
  const visibleW = viewport.width / drawnWidth;
  const visibleH = viewport.height / drawnHeight;
  if (t.scale <= 1.08 || (visibleW >= 0.9 && visibleH >= 0.9)) {
    return { ...FULL_CROP };
  }
  let x = (0 - t.x) / drawnWidth;
  let y = (0 - t.y) / drawnHeight;
  let w = visibleW;
  let h = visibleH;
  const padX = w * pad;
  const padY = h * pad;
  x -= padX;
  y -= padY;
  w += padX * 2;
  h += padY * 2;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > 1) {
    w = 1 - x;
  }
  if (y + h > 1) {
    h = 1 - y;
  }
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: Math.max(0.08, w),
    h: Math.max(0.08, h),
  };
}

/** Snap a crop onto a coarse grid so tiny pans do not spam the host. */
export function quantizeCrop(crop: CropRect, steps = 24): CropRect {
  const snap = (value: number): number => Math.round(value * steps) / steps;
  const next = {
    x: clamp01(snap(crop.x)),
    y: clamp01(snap(crop.y)),
    w: Math.max(1 / steps, snap(crop.w)),
    h: Math.max(1 / steps, snap(crop.h)),
  };
  if (next.x + next.w > 1) {
    next.w = 1 - next.x;
  }
  if (next.y + next.h > 1) {
    next.h = 1 - next.y;
  }
  return isFullCrop(next) ? { ...FULL_CROP } : next;
}

export function cropsClose(a: CropRect, b: CropRect, epsilon = 0.02): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.w - b.w) <= epsilon && Math.abs(a.h - b.h) <= epsilon;
}

/** True when `bitmap` has the aspect we expect for `crop` of `frame`. */
export function frameMatchesCrop(bitmap: Size, frame: Size, crop: CropRect): boolean {
  if (bitmap.width <= 0 || bitmap.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return false;
  }
  const expected = (Math.max(0.08, crop.w) * frame.width) / (Math.max(0.08, crop.h) * frame.height);
  const actual = bitmap.width / bitmap.height;
  return Math.abs(actual - expected) / expected < 0.08;
}

export interface StreamQuality {
  quality: number;
  fps: number;
  maxWidth: number;
  crop?: CropRect;
}

/**
 * Encode the visible region at the phone's physical pixel size when zoomed;
 * otherwise keep the user's preset. Never upscales past 3840.
 */
export function streamQuality(
  preset: { quality: number; fps: number; maxWidth: number },
  crop: CropRect,
  viewport: Size,
  dpr: number,
): StreamQuality {
  if (isFullCrop(crop)) {
    return { quality: preset.quality, fps: preset.fps, maxWidth: preset.maxWidth };
  }
  const pixelRatio = Math.min(3.5, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
  const longest = Math.max(viewport.width, viewport.height) * pixelRatio;
  return {
    quality: Math.max(preset.quality, 82),
    fps: Math.min(preset.fps, 10),
    maxWidth: Math.min(3840, Math.max(960, Math.round(longest))),
    crop,
  };
}

export function qualityEqual(a: StreamQuality, b: StreamQuality): boolean {
  if (a.quality !== b.quality || a.fps !== b.fps || a.maxWidth !== b.maxWidth) {
    return false;
  }
  const ac = a.crop ?? FULL_CROP;
  const bc = b.crop ?? FULL_CROP;
  return cropsClose(ac, bc, 0.001);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Wheel delta (with ctrl held, or a trackpad pinch) to a zoom factor; mouse notches feel like ~1.4x. */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 1;
  }
  const clamped = deltaY < -300 ? -300 : deltaY > 300 ? 300 : deltaY;
  return Math.exp(-clamped / 300);
}
