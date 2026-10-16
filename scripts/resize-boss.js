'use strict';

// Утилита: ужать внешний PNG (1024/2048) до 256x256 билинейным ресемплингом.
// Чистый Node: свой минимальный декодер PNG (None/Sub/Up/Average/Paeth + inflate),
// билинейный даунскейл, кодирование через scripts/icon-gen/png.js.
//
// Использование: node scripts/resize-boss.js public/icons/boss-rat.png [256]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encodePNG } = require('./icon-gen/png');

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Декодирует PNG (8 бит, truecolor/truecolor+alpha) в RGBA. */
function decodePNG(buf) {
    if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('не PNG');
    let pos = 8, w = 0, h = 0, colorType = -1, bitDepth = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.slice(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0); h = data.readUInt32BE(4);
            bitDepth = data[8]; colorType = data[9];
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`поддерживаются только 8-bit RGB/RGBA, получено depth=${bitDepth} type=${colorType}`);
    }
    const ch = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch;
    const rgba = Buffer.alloc(w * h * 4);
    let p = 0;
    const prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const filter = raw[p++];
        const cur = Buffer.alloc(stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0;
            const b = prev[i], c = i >= ch ? prev[i - ch] : 0;
            let v = raw[p++];
            if (filter === 1) v = (v + a) & 255;
            else if (filter === 2) v = (v + b) & 255;
            else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
            else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
            cur[i] = v;
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4, s = x * ch;
            rgba[o] = cur[s]; rgba[o + 1] = cur[s + 1]; rgba[o + 2] = cur[s + 2];
            rgba[o + 3] = ch === 4 ? cur[s + 3] : 255;
        }
        prev.set(cur);
    }
    return { w, h, rgba };
}

/** Билинейный даунскейл RGBA до size x size. */
function downscale(src, sw, sh, size) {
    const dst = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        const sy = (y + 0.5) * sh / size - 0.5;
        const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1);
        const fy = Math.min(1, Math.max(0, sy - y0));
        for (let x = 0; x < size; x++) {
            const sx = (x + 0.5) * sw / size - 0.5;
            const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(sw - 1, x0 + 1);
            const fx = Math.min(1, Math.max(0, sx - x0));
            for (let k = 0; k < 4; k++) {
                const v00 = src[(y0 * sw + x0) * 4 + k], v10 = src[(y0 * sw + x1) * 4 + k];
                const v01 = src[(y1 * sw + x0) * 4 + k], v11 = src[(y1 * sw + x1) * 4 + k];
                dst[(y * size + x) * 4 + k] = Math.round(
                    v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy);
            }
        }
    }
    return dst;
}

const file = process.argv[2];
const size = parseInt(process.argv[3] || '256', 10);
if (!file) { console.error('usage: node scripts/resize-boss.js <png> [size]'); process.exit(1); }
const abs = path.resolve(file);
const { w, h, rgba } = decodePNG(fs.readFileSync(abs));
if (w !== h) console.warn(`внимание: не квадрат ${w}x${h}, ужмётся в ${size}x${size}`);
fs.writeFileSync(abs, encodePNG(size, size, downscale(rgba, w, h, size)));
console.log(`${path.basename(abs)}: ${w}x${h} -> ${size}x${size}, bytes: ${fs.statSync(abs).size}`);
