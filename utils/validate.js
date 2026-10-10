/**
 * Валидация входных значений.
 *
 * Отдельный файл не из-за красоты, а из-за порядка загрузки модулей:
 * serverApi.js лениво (внутри функции) требует db/players.js, поэтому
 * players.js не может импортировать serverApi — возник бы цикл.
 * Здесь нет ни одного require, и модуль можно тянуть откуда угодно.
 */

/**
 * Валидация положительного целого ID.
 *
 * Раньше копий было три, и расхождение между ними стоило
 * работоспособности двух функций:
 *
 *  1) serverApi.js             — возвращала { ok, error, code };
 *  2) routes/game/status.js    — бросала объект { message, code, statusCode };
 *  3) db/players.js            — бросала Error и ВОЗВРАЩАЛА число.
 *
 * clans.js читал у результата (1) поле `.valid`, которого там нет:
 * `!undefined` всегда true, поэтому вступление в клан отклонялось
 * ЛЮБЫМ clan_id, включая корректный.
 * (2) отбраковывала item_id из query — это всегда строка, а
 * Number.isInteger('12') === false, то есть endpoint не работал вовсе.
 *
 * Теперь правило одно и форма ответа одна:
 *   { ok: true,  value }
 *   { ok: false, error, code }
 *
 * @param {*} value проверяемое значение (строка из query или число)
 * @param {string} [fieldName='ID'] имя поля для текста ошибки
 * @returns {{ok: true, value: number}|{ok: false, error: string, code: string}}
 */
function validateId(value, fieldName = 'ID') {
    if (value === undefined || value === null || value === '') {
        return { ok: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }

    // Приводим к числу ДО проверки: query-параметры и JSON-тело дают строки.
    const num = Number(value);

    // isSafeInteger, а не isInteger: Number.isInteger(2 ** 53 + 1) === true,
    // то есть «целое» значение, которое в БД уйдёт уже другим числом.
    if (!Number.isSafeInteger(num) || num <= 0) {
        return { ok: false, error: `${fieldName} должен быть целым числом > 0`, code: 'INVALID_ID' };
    }

    return { ok: true, value: num };
}

/**
 * То же, но бросает Error — для слоя БД, где об ошибке сообщают
 * исключением, а не кодом ответа. Код и текст приходят из validateId,
 * поэтому правило проверки остаётся единственным.
 *
 * @param {*} value проверяемое значение
 * @param {string} [name='id'] имя поля для текста ошибки
 * @returns {number} нормализованный ID
 * @throws {Error}
 */
function requireId(value, name = 'id') {
    const result = validateId(value, name);
    if (!result.ok) {
        throw new Error(`Неверный ${name}`);
    }
    return result.value;
}

/**
 * Валидация количества предметов для покупки/использования.
 *
 * Зачем отдельно от validateId: в items.js было
 * `Math.max(1, Math.min(99, Number(req.body?.quantity || 1)))`.
 * При quantity = {} или "abc" Number() даёт NaN, а Math.min(99, NaN) и
 * Math.max(1, NaN) тоже NaN. Дальше `totalPrice = price * NaN` -> NaN и
 * проверка `player.coins < NaN` ВСЕГДА ложна, то есть оплата молча
 * «проходила», а управление уходило в UPDATE с NaN.
 *
 * Здесь NaN отсекается до арифметики, а границы задаются явно.
 *
 * @param {*} value проверяемое количество
 * @param {number} [min=1] минимальное допустимое
 * @param {number} [max=99] максимальное допустимое
 * @returns {{ok: true, value: number}|{ok: false, error: string, code: string}}
 */
function validateQuantity(value, min = 1, max = 99) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: min };
    }

    const num = Number(value);

    if (!Number.isSafeInteger(num) || num < min || num > max) {
        return {
            ok: false,
            error: `Количество должно быть целым числом от ${min} до ${max}`,
            code: 'INVALID_QUANTITY'
        };
    }

    return { ok: true, value: num };
}

module.exports = {
    validateId,
    validateQuantity,
    requireId
};