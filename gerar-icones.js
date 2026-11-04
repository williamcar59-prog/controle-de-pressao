/* Gera os ícones PNG do PWA (sem dependências).
   Uso: node gerar-icones.js */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- desenho ---------- */
const PULSE = [
  [0.08, 0.56], [0.28, 0.56], [0.36, 0.40], [0.44, 0.66],
  [0.54, 0.28], [0.62, 0.56], [0.72, 0.56], [0.78, 0.48], [0.92, 0.48]
];

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distToPulse(px, py, ox, oy, scale) {
  let best = Infinity;
  for (let i = 0; i < PULSE.length - 1; i++) {
    const a = PULSE[i], b = PULSE[i + 1];
    const d = distToSeg(px, py,
      ox + a[0] * scale, oy + a[1] * scale,
      ox + b[0] * scale, oy + b[1] * scale);
    if (d < best) best = d;
  }
  return best;
}

function roundRectDist(x, y, w, h, r, px, py) {
  // distância aproximada (negativa dentro)
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function renderIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? size * 0.20 : size * 0.14;
  const box = size - inset * 2;
  const radius = maskable ? 0 : size * 0.22;
  const lineW = size * (maskable ? 0.045 : 0.052);
  const c1 = [0xef, 0x44, 0x44]; // vermelho claro
  const c2 = [0x7f, 0x1d, 0x1d]; // vermelho escuro

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;

      // fundo (gradiente diagonal)
      const t = (x + y) / (2 * size);
      const br = c1[0] + (c2[0] - c1[0]) * t;
      const bg = c1[1] + (c2[1] - c1[1]) * t;
      const bb = c1[2] + (c2[2] - c1[2]) * t;

      const inside = maskable
        ? true
        : roundRectDist(0, 0, size, size, radius, x + 0.5, y + 0.5) <= 0;

      if (inside) {
        r = br; g = bg; b = bb; a = 255;

        // pulso branco com antialiasing
        const d = distToPulse(x + 0.5, y + 0.5, inset, inset, box);
        const alpha = Math.max(0, Math.min(1, lineW / 2 + 0.5 - d));
        if (alpha > 0) {
          r = r + (255 - r) * alpha;
          g = g + (255 - g) * alpha;
          b = b + (255 - b) * alpha;
        }
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = a;
    }
  }
  return encodePNG(size, size, rgba);
}

/* ---------- escrita ---------- */
const outDir = path.join(__dirname, 'icons');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
];

for (const [name, size, maskable] of files) {
  const buf = renderIcon(size, maskable);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`ok  ${name}  ${size}px  ${(buf.length / 1024).toFixed(1)} KB`);
}
