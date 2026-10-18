'use strict';

// Проверка сгенерированных PNG: сигнатура, размер, декодируемость и
// отсутствие «пустых» (одноцветных прозрачных) иконок.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'public', 'icons');
const bad = [];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));

for (const f of files) {
    let key;
    let buf;
    try {
        key = f.replace(/\.png$/, '');
        buf = fs.readFileSync(path.join(dir, f));
        if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
            bad.push(`${f}: bad signature`);
            continue;
        }
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        const idat = [];
        let off = 8;
        while (off < buf.length) {
            const len = buf.readUInt32BE(off);
            const type = buf.subarray(off + 4, off + 8).toString('ascii');
            if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
            off += 12 + len;
        }
        let raw;
        try {
            raw = zlib.inflateSync(Buffer.concat(idat));
        } catch (e) {
            bad.push(`${f}: inflate failed: ${e.message}`);
            continue;
        }
        const stride = w * 4 + 1;
        let opaque = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (raw[y * stride + 1 + x * 4 + 3] > 200) opaque++;
            }
        }
        const frac = opaque / (w * h);
        const expectedW = key.startsWith('boss-') ? 256 : 64;
        const expectedH = key.startsWith('boss-') ? 256 : 64;
        if (w !== expectedW || h !== expectedH) bad.push(`${f}: size ${w}x${h}, expected ${expectedW}x${expectedH}`);
        if (frac < 0.3) bad.push(`${f}: almost empty (${(frac * 100).toFixed(1)}% opaque)`);
    } catch (e) {
        bad.push(`${f}: check failed: ${e.message}`);
    }
}

console.log(`Checked PNG: ${files.length}`);
if (bad.length) {
    console.log('PROBLEMS:');
    console.log(bad.join('\n'));
    process.exitCode = 1;
} else {
    console.log('All PNG valid and non-empty');
}
