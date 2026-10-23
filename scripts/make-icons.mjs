// Генерирует PNG-иконки PWA (гантель на тёмном фоне) без внешних зависимостей.
// Запуск: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });
const BG = [15, 17, 21];
const FG = [74, 222, 128];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  // Прямоугольники в долях от размера (safe zone для maskable — центральные 80%).
  const rects = [
    [0.2, 0.47, 0.8, 0.53], // гриф
    [0.24, 0.34, 0.31, 0.66], // блины
    [0.32, 0.38, 0.37, 0.62],
    [0.69, 0.34, 0.76, 0.66],
    [0.63, 0.38, 0.68, 0.62],
  ];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size;
      const fy = (y + 0.5) / size;
      const on = rects.some(([x0, y0, x1, y1]) => fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1);
      const c = on ? FG : BG;
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // глубина
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, 'icon-192.png'), png(192));
writeFileSync(join(out, 'icon-512.png'), png(512));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180));
writeFileSync(
  join(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0f1115"/><g fill="#4ade80"><rect x="20" y="47" width="60" height="6"/><rect x="24" y="34" width="7" height="32"/><rect x="32" y="38" width="5" height="24"/><rect x="69" y="34" width="7" height="32"/><rect x="63" y="38" width="5" height="24"/></g></svg>\n`,
);
console.log('Иконки записаны в public/');
