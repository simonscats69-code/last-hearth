/**
 * Валидация входных значений.
 *
 * Отдельный файл не из-за красоты, а из-за порядка загрузки модулей:
 * serverApi.js лениво (внутри функции) требует db/players.js, поэтому
 * players.js не может импортировать serverApi — возник бы цикл.
 * Здесь нет ни одного require, и модуль можно тянуть откуда угодно.
 */

function _toSafeInteger(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === 'string') {
        // Строгий разбор: только десятичные цифры, без знаков/экспонент/хекса.
        if (!/^[0-9]+$/.test(value.trim())) return null;
        const num = Number(value.trim());
        return Number.isSafeInteger(num) ? num : null;
    }
    return null;
}

/**
 * Валидация положительного целого ID.
 */
function validateId(value, fieldName = 'ID') {
    if (value === undefined || value === null || value === '') {
        return { ok: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }

    const num = _toSafeInteger(value);

    if (num === null || num <= 0) {
        return { ok: false, error: `${fieldName} должен быть целым числом > 0`, code: 'INVALID_ID' };
    }

    return { ok: true, value: num };
}

function requireId(value, name = 'id') {
    const result = validateId(value, name);
    if (!result.ok) {
        const err = new Error(`Неверный ${name}`);
        err.code = result.code;
        err.statusCode = 400;
        throw err;
    }
    return result.value;
}

function validateQuantity(value, min = 1, max = 99) {
    const minNum = Number.isSafeInteger(min) && min >= 0 ? min : 1;
    const maxNum = Number.isSafeInteger(max) && max >= minNum ? max : 99;

    if (value === undefined || value === null || value === '') {
        return { ok: true, value: minNum };
    }

    const num = _toSafeInteger(value);

    if (num === null || num < minNum || num > maxNum) {
        return {
            ok: false,
            error: `Количество должно быть целым числом от ${minNum} до ${maxNum}`,
            code: 'INVALID_QUANTITY'
        };
    }

    return { ok: true, value: num };
}

function validateItemIndex(value, fieldName = 'индекс предмета', max = null) {
    if (value === undefined || value === null || value === '') {
        return { ok: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }

    const num = _toSafeInteger(value);

    if (num === null || num < 0) {
        return { ok: false, error: `${fieldName} должен быть целым числом >= 0`, code: 'INVALID_INDEX' };
    }
    if (max !== null && Number.isSafeInteger(max) && num > max) {
        return { ok: false, error: `${fieldName} превышает допустимый предел`, code: 'INVALID_INDEX' };
    }

    return { ok: true, value: num };
}

module.exports = {
    validateId,
    validateQuantity,
    validateItemIndex,
    requireId
};
