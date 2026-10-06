/**
 * Проверка общих правил валидации ID и кодов ошибок PvP.
 *
 * Запуск: node scripts/verify-validate.js
 *
 * Скрипт ничего не меняет и не ходит в БД — только проверяет чистые
 * функции. Существует потому, что расхождение копий validateId уже
 * стоило работоспособности (вступление в клан отклонялось ЛЮБЫМ
 * clan_id, включая корректный), а такие ошибки не видны ни линтеру,
 * ни запуску сервера: код формально корректен, просто читает не то
 * поле.
 */
const assert = require('assert');

const { validateId, requireId } = require('../utils/validate');
const { isConnectionError } = require('../db/database');

/**
 * Прогоняет проверки.
 *
 * Вынесено в функцию, а не оставлено на верхнем уровне: файл требуют
 * другие проверки (например, «грузятся ли все модули проекта»), и
 * require() исполнял бы тесты, печатая их результат в чужой вывод.
 */
function runChecks() {
let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  OK   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
}

console.log('validateId:');

check('принимает число', () => {
    assert.deepStrictEqual(validateId(7), { ok: true, value: 7 });
});

check('принимает строку из query и приводит к числу', () => {
    // Number.isInteger('7') === false, поэтому старая проверка в
    // routes/game/status.js отбраковывала item_id из query.
    const r = validateId('7');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value, 7);
    assert.strictEqual(typeof r.value, 'number');
});

check('отклоняет undefined, null и пустую строку', () => {
    for (const v of [undefined, null, '']) {
        assert.strictEqual(validateId(v).ok, false);
        assert.strictEqual(validateId(v).code, 'MISSING_FIELD');
    }
});

check('отклоняет не-положительные и дробные значения', () => {
    for (const v of [0, -5, 1.5, 'abc', NaN]) {
        assert.strictEqual(validateId(v).ok, false);
    }
});

check('отклоняет число за пределами safe integer', () => {
    // Number.isInteger(2 ** 53 + 1) === true, но значение уже другое.
    assert.strictEqual(validateId(2 ** 53).ok, false);
});

check('поле ok есть — именно его читают потребители', () => {
    // Регрессия clans.js: там было !result.valid, которого в ответе нет,
    // поэтому проверка отклоняла всё подряд.
    const r = validateId('7');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.valid, undefined);
});

check('requireId возвращает число', () => {
    assert.strictEqual(requireId('42', 'playerId'), 42);
});

check('requireId бросает Error на некорректном значении', () => {
    assert.throws(() => requireId('abc', 'playerId'), /Неверный playerId/);
});

console.log('\nPvP: ошибки не классифицируются по тексту сообщения.');

const { handleError } = require('../utils/serverApi');

/**
 * Правила PvP, которые раньше уезжали клиенту как INTERNAL_ERROR / 500
 * с текстом «Внутренняя ошибка сервера», потому что ни одно ключевое
 * слово ('COOLDOWN', 'энергия', 'мертв', ...) в сообщении не встречалось.
 */
const PvpError = {
    PLAYER_NOT_FOUND:  { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 },
    NOT_RED_ZONE:      { message: 'PvP доступно только на красных зонах', code: 'NOT_RED_ZONE', statusCode: 400 },
    NOT_SAME_LOCATION: { message: 'Игрок не на этой локации', code: 'NOT_SAME_LOCATION', statusCode: 400 },
    TARGET_DEAD:       { message: 'Противник уже мертв', code: 'PLAYER_DEAD', statusCode: 400 },
    LEVEL_TOO_LOW:     { message: 'Игроки ниже 5 уровня не могут участвовать в PvP', code: 'PVP_LEVEL_TOO_LOW', statusCode: 400 },
    TARGET_PROTECTED:  { message: 'Цель защищена от PvP до 5 уровня', code: 'TARGET_PROTECTED', statusCode: 400 },
    COOLDOWN:          { message: 'Подождите перед следующим PvP боем', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    ALREADY_IN_BATTLE: { message: 'Один из игроков уже находится в активном PvP бою', code: 'ALREADY_IN_BATTLE', statusCode: 409 },
    BATTLE_FINISHED:   { message: 'Бой уже завершён', code: 'BATTLE_FINISHED', statusCode: 409 },
    NOT_PARTICIPANT:   { message: 'Вы не участник этого боя', code: 'NOT_PARTICIPANT', statusCode: 403 }
};

for (const [name, spec] of Object.entries(PvpError)) {
    check(`${name} -> ${spec.code} / ${spec.statusCode}`, () => {
        let captured;
        const res = {
            status(code) { captured = code; return this; },
            json(body) { captured = body; return body; }
        };
        handleError(res, { message: spec.message, code: spec.code, statusCode: spec.statusCode }, 'test');

        assert.strictEqual(captured.status, undefined); // statusCode не попадает в тело
        assert.strictEqual(captured.code, spec.code);
        // Главное: клиент видит текст правила, а не «Внутренняя ошибка сервера».
        assert.strictEqual(captured.error, spec.message);
    });
}

console.log('\nisConnectionError: отличает недоступность базы от сбоя запроса.');

check('сетевые ошибки Node распознаются', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET']) {
        assert.strictEqual(isConnectionError({ code }), true, code);
    }
});

check('SQLSTATE класса 08 распознаются', () => {
    for (const code of ['08000', '08003', '08006', '08P01']) {
        assert.strictEqual(isConnectionError({ code }), true, code);
    }
});

check('ошибки запросов и наши коды НЕ считаются проблемой соединения', () => {
    // Иначе нехватка ключей или дубль инвайт-кода отдавала бы 502 вместо 400.
    for (const code of ['23505', '42P01', 'INSUFFICIENT_KEYS', 'INVITE_CODE_CONFLICT']) {
        assert.strictEqual(isConnectionError({ code }), false, code);
    }
});

check('пустая/неизвестная ошибка безопасна', () => {
    assert.strictEqual(isConnectionError(null), false);
    assert.strictEqual(isConnectionError(undefined), false);
    assert.strictEqual(isConnectionError(new Error('boom')), false);
});

console.log(`\nПройдено проверок: ${passed}`);
if (process.exitCode) console.log('ЕСТЬ ПРОВАЛЫ');
}

if (require.main === module) {
    runChecks();
    // Явный выход: winston держит открытые дескрипторы логов, и без этого
    // процесс печатает результат, но не завершается — скрипт выглядит
    // зависшим на вебхуке/в планировщике.
    process.exit(process.exitCode || 0);
}