/**
 * Генератор иконок PWA (icon-192.png, icon-512.png)
 * Запуск: node scripts/generate-icons.js
 * Создаёт тёмные квадратные иконки с оранжевым «очагом» по центру.
 * Использует только встроенный zlib — без внешних зависимостей.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/**
 * Рисуем пиксельную иконку size x size (RGBA).
 * Фон #0f0f23, рамка #2a2a4a, «очаг» — оранжевое пламя из треугольников.
 */
function drawIcon(size) {
    const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 байт фильтра на строку
    const bg = [15, 15, 35];
    const border = [42, 42, 74];
    const flameOuter = [255, 140, 0];
    const flameInner = [255, 215, 0];

    for (let y = 0; y < size; y++) {
        const rowStart = y * (size * 4 + 1);
        raw[rowStart] = 0; // фильтр None
        for (let x = 0; x < size; x++) {
            const px = rowStart + 1 + x * 4;
            let color;

            const borderW = Math.max(2, Math.round(size * 0.02));
            const isBorder = x < borderW || y < borderW || x >= size - borderW || y >= size - borderW;
            if (isBorder) {
                color = border;
            } else {
                // Пламя: центр внизу, расширяется кверху с рваными краями
                const cx = size / 2;
                const baseY = size * 0 + size * 0.82;
                const tipY = size * 0.18;
                const rel = (baseY - y) / (baseY - tipY); // 0 внизу, 1 наверху

                if (rel >= 0 && rel <= 1) {
                    const halfWidth = (size * 0.28) * Math.sin(rel * Math.PI * 0.9);
                    // Рваные края: синусоидальное дрожание
                    const wobble = Math.sin(y * 0.7) * size * 0.02;
                    const dx = Math.abs(x - cx + wobble);
                    if (dx < halfWidth) {
                        color = dx < halfWidth * 0.45 ? flameInner : flameOuter;
                    }
                }
                if (!color) color = bg;
            }

            raw[px] = color[0];
            raw[px + 1] = color[1];
            raw[px + 2] = color[2];
            raw[px + 3] = 255;
        }
    }
    return raw;
}

function makePng(size) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(drawIcon(size), { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

const publicDir = path.join(__dirname, '..', 'public');
for (const size of [192, 512]) {
    const file = path.join(publicDir, `icon-${size}.png`);
    fs.writeFileSync(file, makePng(size));
    console.log(`Создан ${file} (${fs.statSync(file).size} байт)`);
}