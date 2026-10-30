/**
 * Проверка показа ошибок в клиенте.
 *
 * Запуск: node scripts/verify-client-errors.js
 *
 * Две задачи:
 *
 * 1) Найти catch-блоки, где игроку показывают обобщённый текст, выбрасывая
 *    error.message. Сервер объясняет причину («Недостаточно ключей от
 *    босса 4», «Недостаточно Stars»), но игрок видел «Не удалось начать
 *    бой» — и не понимал, что делать. Таких мест было 23, включая пустой
 *    catch у PvP-атаки: игрок жал «АТАКОВАТЬ» и не видел ничего.
 *
 * 2) Проверить саму функцию clientErrorMessage: она выбирает между текстом
 *    сервера и запасным вариантом по HTTP-коду, поэтому ошибка в ней
 *    разошлась бы тихо — игрок либо увидит внутренний текст сервера,
 *    либо перестанет видеть причину отказа.
 *
 * Скрипт ничего не меняет.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GAME = path.join(ROOT, 'public/game.js');

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

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'условие не выполнено');
}

const src = fs.readFileSync(GAME, 'utf8');

// ---------------------------------------------------------------- 1. логика

/**
 * Достаёт clientErrorMessage из game.js и исполняет её отдельно.
 * Функция чистая (не смотрит ни во что, кроме аргументов), поэтому её
 * можно вырвать из файла и проверить без браузера.
 * @returns {Function}
 */
function loadClientErrorMessage() {
    const m = src.match(/function clientErrorMessage\s*\([\s\S]*?\n\}/);
    assert(m, 'не найдена функция clientErrorMessage в public/game.js');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`${m[0]}; this.fn = clientErrorMessage;`, sandbox);
    return sandbox.fn;
}

function runLogicChecks() {
    console.log('clientErrorMessage:');
    const fn = loadClientErrorMessage();

    check('4xx показывает текст сервера', () => {
        const e = { status: 400, message: 'Недостаточно ключей от босса 4' };
        assert(fn(e, 'запасной') === 'Недостаточно ключей от босса 4');
    });

    check('403, 404, 409, 422, 429 тоже показывают текст', () => {
        for (const status of [403, 404, 409, 422, 429]) {
            const e = { status, message: 'причина' };
            assert(fn(e, 'запасной') === 'причина', `статус ${status}`);
        }
    });

    check('5xx НЕ показывает текст сервера', () => {
        // Внутренние сообщения сервера игроку видеть не нужно, и к тому же
        // для 5xx apiRequest уже показал тост — будет дубль.
        const e = { status: 500, message: 'UPDATE players SET ... нарушение constraint' };
        assert(fn(e, 'запасной') === 'запасной');
    });

    check('сетевая ошибка без status показывает запасной', () => {
        const e = { message: 'Failed to fetch' };
        assert(fn(e, 'запасной') === 'запасной');
    });

    check('пустой message не ломает вызов', () => {
        assert(fn({ status: 400, message: '' }, 'запасной') === 'запасной');
    });

    check('null и undefined не ломают вызов', () => {
        assert(fn(null, 'запасной') === 'запасной');
        assert(fn(undefined, 'запасной') === 'запасной');
    });
}

// ------------------------------------------------- 2. catch-блоки без текста

/**
 * Находит индекс строки с закрывающей скобкой catch-блока (подсчёт скобок).
 * @param {string[]} lines - все строки файла
 * @param {number} startLine - индекс строки с "} catch (var) {"
 * @returns {number} индекс строки с закрывающей "}" catch-блока
 */
function findCatchBlockEnd(lines, startLine) {
    let depth = 0;
    // Подсчёт скобок на самой строке catch: "} catch (var) {" -> чистое изменение 0
    for (const ch of lines[startLine]) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
    }
    // Входим в тело catch-блока через {, начинаем с depth = 1
    depth = Math.max(depth, 0) + 1;

    for (let i = startLine + 1; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    // Fallback: если не нашли закрывающую скобку, используем старое окно
    return startLine + 9;
}

/**
 * Ищет catch-блоки, где показывают сообщение, но не используют ни
 * error.message, ни clientErrorMessage.
 * Окно поиска ограничивается телом catch-блока (до закрывающей }),
 * чтобы не ловить showNotification/showModal из соседних блоков
 * (else / finally и т.д.), которые могут попасть в 10-строчное окно
 * после строки catch, но не относятся к обработке ошибки внутри catch.
 * @returns {number[]} номера строк
 */
function findSwallowedErrors() {
    const lines = src.split('\n');
    const catches = [];
    const re = /}\s*catch\s*\(\s*(\w+)\s*\)\s*{/;

    lines.forEach((line, i) => {
        const m = line.match(re);
        if (m) catches.push({ line: i, varName: m[1] });
    });

    const bad = [];
    for (const c of catches) {
        const endLine = findCatchBlockEnd(lines, c.line);
        const window = lines.slice(c.line, endLine + 1).join('\n');
        if (!/showModal\(|showNotification\(/.test(window)) continue;

        const v = c.varName;
        // `\??\.` обязателен: в файле встречается и `error.message`,
        // и `error?.message`. Без вопросительного знака в регулярке
        // вариант с `?.` не распознавался, и нормальные места попадали
        // в список как «теряющие текст».
        const usesText =
            new RegExp(`\\b${v}\\??\\.message\\b`).test(window) ||
            /clientErrorMessage\(/.test(window);
        if (!usesText) bad.push(c.line + 1);
    }

    return bad;
}

function runSwallowChecks() {
    console.log('\ncatch-блоки, выбрасывающие текст ошибки:');
    const bad = findSwallowedErrors();

    check('ни один catch не теряет текст ошибки', () => {
        assert(
            bad.length === 0,
            `в строках ${bad.join(', ')} показывается свой текст без error.message`
        );
    });
}

runLogicChecks();
runSwallowChecks();

console.log(`\nПройдено проверок: ${passed}`);

if (require.main === module) {
    process.exit(process.exitCode || 0);
}