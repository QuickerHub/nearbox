import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCALE,
  clampTransform,
  fitSize,
  fitTransform,
  panBy,
  pointToFrame,
  refitTransform,
  wheelZoomFactor,
  zoomAt,
  zoomBetween,
  zoomTo,
  type ViewTransform,
} from "./remoteZoom.ts";

// A 16:9 frame streamed to a portrait phone: the frame is letterboxed top and bottom.
const frame = { width: 1440, height: 810 };
const phone = { width: 360, height: 640 };
const phoneFit = fitSize(frame, phone);

function close(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} should be ~${expected}`);
}

test("fitSize keeps the aspect ratio and fills the shorter axis", () => {
  close(phoneFit.width, 360);
  close(phoneFit.height, 202.5);
  const landscape = fitSize(frame, { width: 1000, height: 300 });
  close(landscape.height, 300);
  close(landscape.width, 1000 * (300 / 562.5));
  assert.deepEqual(fitSize({ width: 0, height: 0 }, phone), { width: 0, height: 0 });
});

test("fitTransform centers the frame at scale 1", () => {
  const t = fitTransform(phoneFit, phone);
  assert.equal(t.scale, 1);
  close(t.x, 0);
  close(t.y, (640 - 202.5) / 2);
});

test("clampTransform never reveals the letterbox on an axis the frame overflows", () => {
  // At 4x the frame is 1440x810, taller than the 640px viewport on both axes.
  const t = clampTransform({ scale: 4, x: 50, y: -5000 }, phoneFit, phone);
  assert.equal(t.scale, 4);
  assert.equal(t.x, 0, "left edge cannot come inside the viewport");
  assert.equal(t.y, 640 - 810, "bottom edge cannot come inside the viewport");
});

test("clampTransform recenters on an axis the frame does not fill", () => {
  const t = clampTransform({ scale: 2, x: -100, y: 123 }, phoneFit, phone);
  assert.equal(t.x, -100, "wider than the viewport: x is a valid offset");
  close(t.y, (640 - 405) / 2, "shorter than the viewport: y is centered");
});

test("clampTransform limits the scale range", () => {
  assert.equal(clampTransform({ scale: 0.2, x: 0, y: 0 }, phoneFit, phone).scale, 1);
  assert.equal(clampTransform({ scale: 99, x: 0, y: 0 }, phoneFit, phone).scale, MAX_SCALE);
  assert.equal(clampTransform({ scale: Number.NaN, x: 0, y: 0 }, phoneFit, phone).scale, 1);
});

test("zoomAt keeps the frame point under the anchor fixed", () => {
  const start = fitTransform(phoneFit, phone);
  const anchor = { x: 90, y: 320 };
  const before = pointToFrame(anchor, start, phoneFit)!;
  const zoomed = zoomAt(start, 2.5, anchor, phoneFit, phone);
  assert.equal(zoomed.scale, 2.5);
  const after = pointToFrame(anchor, zoomed, phoneFit)!;
  close(after.x, before.x);
  close(after.y, before.y);
});

test("zoomAt at the edge is clamped so the frame still covers the viewport", () => {
  const start = fitTransform(phoneFit, phone);
  const zoomed = zoomAt(start, 4, { x: 0, y: 320 }, phoneFit, phone);
  assert.equal(zoomed.x, 0);
  assert.ok(zoomed.y <= 0 && zoomed.y >= 640 - 202.5 * 4);
});

test("zoomBetween moves the anchored frame point to the new midpoint", () => {
  // Start zoomed far enough (4x) that the frame overflows on both axes, so no clamp interferes.
  const start = zoomAt(fitTransform(phoneFit, phone), 4, { x: 180, y: 320 }, phoneFit, phone);
  const anchor = { x: 180, y: 320 };
  const target = { x: 150, y: 300 };
  const before = pointToFrame(anchor, start, phoneFit)!;
  const next = zoomBetween(start, 1.1, anchor, target, phoneFit, phone);
  const after = pointToFrame(target, next, phoneFit)!;
  close(after.x, before.x);
  close(after.y, before.y);
  close(next.scale, 4.4);
});

test("zoomBetween on an axis that does not overflow stays centered on that axis", () => {
  const start = zoomAt(fitTransform(phoneFit, phone), 2, { x: 180, y: 320 }, phoneFit, phone);
  const next = zoomBetween(start, 1.05, { x: 180, y: 320 }, { x: 170, y: 250 }, phoneFit, phone);
  close(next.y, (640 - 202.5 * 2.1) / 2, "frame shorter than viewport is centered vertically");
  assert.ok(next.x <= 0 && next.x >= 360 - 360 * 2.1);
});

test("zoomTo(1) returns to the fit layout", () => {
  const zoomed = zoomAt(fitTransform(phoneFit, phone), 3, { x: 300, y: 500 }, phoneFit, phone);
  const back = zoomTo(zoomed, 1, phoneFit, phone);
  assert.deepEqual(back, fitTransform(phoneFit, phone));
});

test("panBy is clamped to the frame bounds", () => {
  const zoomed = zoomTo(fitTransform(phoneFit, phone), 2, phoneFit, phone);
  const panned = panBy(zoomed, 10_000, 0, phoneFit, phone);
  assert.equal(panned.x, 0);
  const other = panBy(zoomed, -10_000, 0, phoneFit, phone);
  close(other.x, 360 - 720);
});

test("pointToFrame flags letterbox hits and clamps them to the edge", () => {
  const t = fitTransform(phoneFit, phone);
  const onFrame = pointToFrame({ x: 180, y: 320 }, t, phoneFit)!;
  assert.ok(onFrame.inside);
  close(onFrame.x, 0.5);
  close(onFrame.y, 0.5);
  const above = pointToFrame({ x: 180, y: 10 }, t, phoneFit)!;
  assert.equal(above.inside, false);
  assert.equal(above.y, 0);
  assert.equal(pointToFrame({ x: 1, y: 1 }, t, { width: 0, height: 0 }), null);
});

test("pointToFrame follows the zoom so taps land where the finger is", () => {
  const t: ViewTransform = { scale: 3, x: -360, y: -200 };
  const p = pointToFrame({ x: 0, y: 0 }, t, phoneFit)!;
  close(p.x, 360 / (360 * 3));
  close(p.y, 200 / (202.5 * 3));
});

test("refitTransform keeps the zoom and the point at the viewport center when rotating", () => {
  const zoomed = zoomAt(fitTransform(phoneFit, phone), 2, { x: 100, y: 400 }, phoneFit, phone);
  const centerBefore = pointToFrame({ x: 180, y: 320 }, zoomed, phoneFit)!;
  const landscape = { width: 640, height: 360 };
  const landscapeFit = fitSize(frame, landscape);
  const next = refitTransform(zoomed, { fit: phoneFit, viewport: phone }, { fit: landscapeFit, viewport: landscape });
  assert.equal(next.scale, 2);
  const centerAfter = pointToFrame({ x: 320, y: 180 }, next, landscapeFit)!;
  close(centerAfter.x, centerBefore.x);
  close(centerAfter.y, centerBefore.y);
});

test("refitTransform from an empty layout falls back to the fit layout", () => {
  const next = refitTransform(
    { scale: 1, x: 0, y: 0 },
    { fit: { width: 0, height: 0 }, viewport: phone },
    { fit: phoneFit, viewport: phone },
  );
  assert.deepEqual(next, fitTransform(phoneFit, phone));
});

test("wheelZoomFactor zooms in on wheel-up and is symmetric", () => {
  assert.ok(wheelZoomFactor(-100) > 1);
  assert.ok(wheelZoomFactor(100) < 1);
  close(wheelZoomFactor(-100) * wheelZoomFactor(100), 1);
  assert.equal(wheelZoomFactor(0), 1);
  assert.equal(wheelZoomFactor(Number.NaN), 1);
  close(wheelZoomFactor(-100_000), Math.exp(1), "huge deltas are capped");
});
