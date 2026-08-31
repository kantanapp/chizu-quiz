/**
 * icons/*.png を生成する（外部ライブラリなし・Node の zlib だけで PNG を書く）。
 *   cd chizu-quiz/tools && node make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

/* ---------- PNG エンコーダ ---------- */
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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 絵柄（地球儀）---------- */
const BG_TOP = [29, 78, 216];      // #1d4ed8
const BG_BOT = [56, 132, 232];
const GLOBE  = [248, 251, 255];
const LINE   = [29, 78, 216];
const OCEAN  = [147, 197, 253];

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * @param {number} u 0..1  @param {number} v 0..1
 * @param {{radius:number, round:number}} opt
 */
function shade(u, v, opt) {
  const R = opt.radius;
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.hypot(dx, dy);
  const w = R * 0.075;             // 線の太さ

  /* 角丸の外側は透明 */
  if (opt.round > 0) {
    const k = opt.round;
    const qx = Math.max(Math.abs(dx) - (0.5 - k), 0);
    const qy = Math.max(Math.abs(dy) - (0.5 - k), 0);
    if (Math.hypot(qx, qy) > k) return null;
  }

  let color = lerp(BG_TOP, BG_BOT, v);

  if (r <= R) {
    color = GLOBE;

    /* 緯線（球を横から見ると水平な直線になる） */
    for (const lat of [-0.55, 0, 0.55]) {
      if (Math.abs(dy - lat * R) < w / 2) color = lat === 0 ? LINE : OCEAN;
    }
    /* 経線（楕円） */
    for (const a of [R * 0.42, R * 0.8]) {
      const F = (dx / a) ** 2 + (dy / R) ** 2 - 1;
      const g = Math.hypot((2 * dx) / (a * a), (2 * dy) / (R * R));
      if (g > 0 && Math.abs(F) / g < w / 2) color = OCEAN;
    }
    if (Math.abs(dx) < w / 2) color = OCEAN;   // 中央の経線
  }
  /* 球の輪郭 */
  if (Math.abs(r - R) < w * 0.7) color = LINE;

  return color;
}

function draw(size, opt) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3;   // 3x3 のスーパーサンプリングでギザギザを消す
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, opt);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      buf[i]     = a ? Math.round(r / (a / 255)) : 0;
      buf[i + 1] = a ? Math.round(g / (a / 255)) : 0;
      buf[i + 2] = a ? Math.round(b / (a / 255)) : 0;
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

const files = [
  ['icon-192.png',          192, { radius: 0.30, round: 0.22 }],
  ['icon-512.png',          512, { radius: 0.30, round: 0.22 }],
  ['maskable-512.png',      512, { radius: 0.24, round: 0 }],
  ['apple-touch-icon.png',  180, { radius: 0.31, round: 0 }]
];

for (const [name, size, opt] of files) {
  const png = encodePNG(size, draw(size, opt));
  writeFileSync(join(OUT, name), png);
  console.log(name.padEnd(22), size + 'px', (png.length / 1024).toFixed(1) + ' KB');
}
