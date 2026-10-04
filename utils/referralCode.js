/**
 * Единый генератор реферальных кодов.
 *
 * Код случайный и от telegram_id не зависит. Если закодировать в него
 * base36(telegram_id), зная свой код игрок вычислит свой telegram_id, а
 * перебором диапазона — коды всех остальных. Реферальная система платит
 * 50 монет за ввод чужого кода, то есть это готовый способ фарма.
 */

const crypto = require('crypto');

const PREFIX = 'LH-';
const RANDOM_LENGTH = 8;
const MAX_LENGTH = 20;

// Алфавит без похожих символов (0/O, 1/I/L), чтобы код можно было
// продиктовать или прочитать с экрана без ошибок.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Сгенерировать случайный реферальный код вида LH-XXXXXXXX
 */
function generateReferralCode() {
    const bytes = crypto.randomBytes(RANDOM_LENGTH);
    let code = PREFIX;

    for (let i = 0; i < RANDOM_LENGTH; i++) {
        // Отсекаем по модулю, чтобы избежать смещения (аналог rejection sampling):
        // 256 кратно длине алфавита (32), поэтому байты 0-255 делятся на 32 ровно
        // и каждый символ появляется с одинаковой вероятностью.
        code += ALPHABET[bytes[i] % ALPHABET.length];
    }

    return code;
}

/**
 * Проверить, что код похож на сгенерированный нами (для can_change).
 * Проверка по алфавиту и длине обязательна: одного префикса LH- мало —
 * код, введённый самим игроком, тоже начинается с него.
 */
function isGeneratedReferralCode(code) {
    if (typeof code !== 'string' || !code.startsWith(PREFIX)) return false;
    const body = code.slice(PREFIX.length);
    if (body.length !== RANDOM_LENGTH) return false;
    for (const ch of body) {
        if (!ALPHABET.includes(ch)) return false;
    }
    return true;
}

module.exports = {
    generateReferralCode,
    isGeneratedReferralCode,
    PREFIX,
    MAX_LENGTH
};
