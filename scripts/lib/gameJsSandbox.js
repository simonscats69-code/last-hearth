/**
 * Клиентские тесты логики из public/game.js.
 *
 * game.js — браузерный скрипт без модулей, поэтому функции вырезаются из
 * исходника и выполняются в vm-песочнице с минимальными заглушками.
 * Тот же подход использует scripts/test_hash_parse.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Модуль лежит в scripts/lib/, поэтому путь к public/game.js — на два
// уровня вверх от __dirname
const GAME_JS_PATH = path.join(__dirname, '..', '..', 'public', 'game.js');

function readGameSource() {
    return fs.readFileSync(GAME_JS_PATH, 'utf8');
}

/**
 * Вырезает объявление `function name(...) { ... }` по имени.
 *
 * Считает парность фигурных скобок, ПРОПУСКАЯ их внутри строковых
 * литералов ('...', "...", `...`) и комментариев. Без этого любой
 * литерал вида `'}'` или сигнатура вида `options = {}` ломали бы разбор.
 *
 * @param {string} source - исходник game.js
 * @param {string} name - имя функции
 * @returns {string} исходный код функции целиком
 */
function extractFunction(source, name) {
    // Ищем и обычное, и `async function` объявление. indexOf идёт по
    // подстроке `function name(`, поэтому для async-функции начало надо
    // сдвинуть назад на `async ` — иначе теряется ключевое слово.
    const marker = `function ${name}(`;
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(`Функция ${name} не найдена в public/game.js`);
    }

    const preceding = source.slice(Math.max(0, markerIndex - 6), markerIndex);
    const start = /async\s+$/.test(preceding) ? markerIndex - preceding.length : markerIndex;

    // Тело функции начинается с первой `{` ПОСЛЕ закрывающей скобки
    // сигнатуры — иначе мы поймаем `{` в значении параметра по умолчанию.
    let signatureEnd = -1;
    let parenDepth = 0;
    for (let i = source.indexOf('(', start); i < source.length; i++) {
        const ch = source[i];
        if (ch === '(') parenDepth++;
        else if (ch === ')') {
            parenDepth--;
            if (parenDepth === 0) { signatureEnd = i; break; }
        }
    }
    if (signatureEnd === -1) {
        throw new Error(`Не удалось разобрать сигнатуру функции ${name}`);
    }

    const bodyStart = source.indexOf('{', signatureEnd);
    if (bodyStart === -1) {
        throw new Error(`У функции ${name} нет тела`);
    }

    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const ch = source[i];

        // Комментарии
        if (ch === '/' && source[i + 1] === '/') {
            i = source.indexOf('\n', i);
            if (i === -1) break;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            i = source.indexOf('*/', i + 2);
            if (i === -1) break;
            i++; // пропускаем закрывающий '/'
            continue;
        }

        // Строковые литералы: пропускаем содержимое целиком
        if (ch === '\'' || ch === '"' || ch === '`') {
            const quote = ch;
            i++;
            while (i < source.length) {
                if (source[i] === '\\') { i++; continue; }
                if (source[i] === quote) break;
                // В шаблонных строках учитываем ${...} — там снова могут быть скобки
                if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
                    let inner = 1;
                    i += 2;
                    while (i < source.length && inner > 0) {
                        if (source[i] === '{') inner++;
                        else if (source[i] === '}') inner--;
                        i++;
                    }
                    i--;
                    continue;
                }
                i++;
            }
            continue;
        }

        // Регулярные литералы: `/"/g` содержит кавычку, и без их учёта
        // сканер принял бы её за начало строки. Регулярка начинается там,
        // где перед `/` не может стоять значение выражения.
        if (ch === '/') {
            let prev = '';
            for (let j = i - 1; j >= 0; j--) {
                const p = source[j];
                if (p !== ' ' && p !== '\t' && p !== '\n' && p !== '\r') { prev = p; break; }
            }
            const startsRegex = prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);
            if (startsRegex) {
                i++;
                let inClass = false;
                while (i < source.length) {
                    if (source[i] === '\\') { i++; continue; }
                    if (source[i] === '[') inClass = true;
                    else if (source[i] === ']') inClass = false;
                    else if (source[i] === '/' && !inClass) break;
                    else if (source[i] === '\n') break;
                    i++;
                }
                continue;
            }
        }

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }

    throw new Error(`Не удалось найти конец функции ${name}`);
}

/** Достаёт объявление `const actionLocks = {...};` целиком. */
function extractActionLocks(source) {
    const match = /const actionLocks = \{[\s\S]*?\n\};/.exec(source);
    if (!match) throw new Error('actionLocks не найден в public/game.js');
    return match[0];
}

/** Песочница с заглушками браузерного окружения. */
function createSandbox(overrides = {}) {
    const sandbox = {
        console,
        URLSearchParams,
        AbortController,
        DOMException,
        Object,
        Number,
        String,
        Boolean,
        Error,
        JSON,
        Promise,
        setTimeout,
        clearTimeout,
        API_BASE: 'https://example.test/api',
        createLoadingTimeout: () => null,
        delay: () => Promise.resolve(),
        showNotification: () => {},
        getInitData: () => 'user=%7B%22id%22%3A1%7D&hash=real',
        DEV_FALLBACK_ENABLED: false,
        fetch: async () => {
            throw new Error('fetch не переопределён в тесте');
        },
        ...overrides
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

/** Загружает набор функций из game.js и возвращает их. */
function loadFunctions(names, overrides = {}) {
    const source = readGameSource();
    const sandbox = createSandbox(overrides);
    const code = names.map((name) => extractFunction(source, name)).join('\n\n');
    vm.runInContext(`${code}\nthis.__api = { ${names.join(', ')} };`, sandbox);
    return sandbox.__api;
}

module.exports = {
    readGameSource,
    extractFunction,
    extractActionLocks,
    createSandbox,
    loadFunctions
};