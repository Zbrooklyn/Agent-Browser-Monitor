// Generate PWA PNG icons offline (no image libs): RGBA buffer -> PNG via built-in zlib.
// Motif: dark rounded "browser wall" — a 2x2 grid of tiles, top-left green (the 'live' accent).
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  draw(set, size);
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) { raw[y * stride] = 0; px.copy(raw, y * stride + 1, y * size * 4, y * size * 4 + size * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(pad) {
  return (set, size) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 11, 11, 11); // bg #0b0b0b
    const m = Math.round(size * pad), inner = size - 2 * m, gap = Math.round(inner * 0.07), ts = Math.round((inner - gap) / 2), r = Math.round(ts * 0.2);
    const tiles = [[0, 0, true], [1, 0, false], [0, 1, false], [1, 1, false]];
    for (const [cx, cy, green] of tiles) {
      const x0 = m + cx * (ts + gap), y0 = m + cy * (ts + gap), x1 = x0 + ts, y1 = y0 + ts;
      const R = green ? 46 : 38, G = green ? 204 : 38, B = green ? 64 : 42;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const dx = Math.min(x - x0, x1 - 1 - x), dy = Math.min(y - y0, y1 - 1 - y);
        if (dx < r && dy < r) { const a = r - dx, b = r - dy; if (a * a + b * b > r * r) continue; }
        set(x, y, R, G, B);
      }
    }
  };
}

fs.writeFileSync(path.join(__dirname, 'icon-192.png'), png(192, drawIcon(0.14)));
fs.writeFileSync(path.join(__dirname, 'icon-512.png'), png(512, drawIcon(0.14)));
fs.writeFileSync(path.join(__dirname, 'icon-maskable-512.png'), png(512, drawIcon(0.24))); // extra safe-zone padding
console.log('icons written');
