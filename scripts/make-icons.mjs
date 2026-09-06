// Generates the app / tray icons as PNGs without any image library.
// Design: rounded blue square, white "N" mark, small green dot (the "online" cue used in the UI).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- geometry in unit square coordinates -----------------------------------

function inRoundedRect(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Parallelogram with horizontal top edge (ax..bx at y0) and bottom edge (cx..dx at y1). */
function inSlab(x, y, y0, y1, ax, bx, cx, dx) {
  if (y < y0 || y > y1) {
    return false;
  }
  const t = (y - y0) / (y1 - y0);
  const left = ax + (cx - ax) * t;
  const right = bx + (dx - bx) * t;
  return x >= left && x <= right;
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const MARK = {
  top: 0.27,
  bottom: 0.73,
  bar: 0.115,
  left: 0.265,
};

function markCoverage(x, y) {
  const { top, bottom, bar, left } = MARK;
  const right = 1 - left;
  if (inRect(x, y, left, top, left + bar, bottom)) {
    return true;
  }
  if (inRect(x, y, right - bar, top, right, bottom)) {
    return true;
  }
  return inSlab(x, y, top, bottom, left, left + bar, right - bar, right);
}

function render(size, { withDot, plain }) {
  const pixels = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bg = 0;
      let mark = 0;
      let dot = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (inRoundedRect(x, y, plain ? 0.5 : 0.23)) {
            bg += 1;
            if (markCoverage(x, y)) {
              mark += 1;
            }
          }
          if (withDot && inCircle(x, y, 0.8, 0.8, 0.13)) {
            dot += 1;
          }
        }
      }
      const total = ss * ss;
      const y01 = py / size;
      const base = [0x25 + Math.round(0x05 * y01), 0x63 - Math.round(0x12 * y01), 0xeb - Math.round(0x13 * y01)];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (bg) {
        const cover = bg / total;
        const markCover = mark / total;
        const bgCover = cover - markCover;
        r += base[0] * bgCover + 0xff * markCover;
        g += base[1] * bgCover + 0xff * markCover;
        b += base[2] * bgCover + 0xff * markCover;
        a += cover;
      }
      if (dot) {
        const cover = dot / total;
        const ring = inCircle((px + 0.5) / size, (py + 0.5) / size, 0.8, 0.8, 0.095) ? 1 : 0;
        const dr = ring ? 0x22 : 0xff;
        const dg = ring ? 0xc5 : 0xff;
        const db = ring ? 0x5e : 0xff;
        r = r * (1 - cover) + dr * cover;
        g = g * (1 - cover) + dg * cover;
        b = b * (1 - cover) + db * cover;
        a = Math.min(1, a + cover);
      }
      const offset = (py * size + px) * 4;
      // Un-premultiply colour where partially transparent.
      const alpha = a;
      pixels[offset] = alpha ? Math.round(Math.min(255, r / alpha)) : 0;
      pixels[offset + 1] = alpha ? Math.round(Math.min(255, g / alpha)) : 0;
      pixels[offset + 2] = alpha ? Math.round(Math.min(255, b / alpha)) : 0;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, pixels);
}

const outputs = [
  ["build/icon.png", 512, { withDot: true }],
  ["resources/icons/icon.png", 256, { withDot: true }],
  ["resources/icons/tray.png", 16, { withDot: false }],
  ["resources/icons/tray@2x.png", 32, { withDot: false }],
];

for (const [relative, size, options] of outputs) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, render(size, options));
  console.log(`wrote ${relative} (${size}px)`);
}
