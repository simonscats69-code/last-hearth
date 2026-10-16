'use strict';

// Минимальный PNG-энкодер на чистом Node: без единой зависимости.
//
// Зачем своё, а не pngjs/sharp: генерация иконок — разовая операция при
// разработке, тянуть ради неё нативные библиотеки в постапокалиптический
// буррито-стек нет смысла. zlib входит в стандартную библиотеку Node,
// а формат PNG (сигнатура + чанки IHDR/IDAT/IEND с CRC32) проще, чем
// кажется: пиксели RGBA со scanline-фильтром None сжимаются deflate'ом.
const zlib = require('zlib');

// Таблица CRC32 (полином 0xEDB88320) — стандарт PNG/RFC 1950.
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

// Чанк PNG: длина данных + тип + данные + CRC32 от типа и данных.
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

/**
 * Кодирует RGBA-пиксели в PNG-файл.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba width*height*4 байт
 * @returns {Buffer} готовый PNG
 */
function encodePNG(width, height, rgba) {
    if (rgba.length !== width * height * 4) {
        throw new Error(`encodePNG: ожидалось ${width * height * 4} байт, получено ${rgba.length}`);
    }

    // Каждая scanline_prefixed нулевым байтом фильтра (None). Фильтрацию
    // не используем: иконки маленькие, а level 9 deflate справляется.
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type: RGBA
    ihdr[10] = 0;  // compression: deflate
    ihdr[11] = 0;  // filter method: adaptive
    ihdr[12] = 0;  // interlace: нет

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

module.exports = { encodePNG };
