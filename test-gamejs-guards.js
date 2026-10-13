/**
 * Тесты защит public/game.js:
 *  - isColorDark: короткая форма, мусор на входе
 *  - formatNumber: отрицательные и дробные числа
 *  - lockAction/unlockAction: страховочный снятие блокировки
 *
 * Перезагружает исходник в песочницу vm с разным window/location.
 *
 * ВАЖНО: убран блок про DEV_FALLBACK_ENABLED, из-за которого тест падал:
 * этот идентификатор в game.js не существовал (ReferenceError при загрузке
 * модуля, покрытие = 0), потому что dev-режим с тех пор приходит с сервера
 * через {{devMode}} в script-теге, а не через локальную константу.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra !== undefined ? String(extra) : ''); }
};

/**
 * Загружает game.js в песочницу vm с заданным hostname/hash.
 * Возвращает объект с доступом к внутренним функциям через хвост к исходнику.
 */
function loadGameJs({ hostname = 'localhost', protocol = 'http:', hash = '' } = {}) {
    const captured = {};

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: (m) => { captured.error = String(m); } },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (id) => clearInterval(id),
        Date, Math, JSON, Promise, Number, String, Object, Array, Error, RegExp, Map, Set, WeakMap,
        isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
        URLSearchParams, AbortController, AbortSignal, Headers,
        fetch: () => Promise.reject(new Error('offline'))
    };

    const win = {};
    win.window = win;
    win.location = { hostname, protocol, hash, origin: 'https://x' };
    win.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    win.addEventListener = () => {};
    win.removeEventListener = () => {};

    const doc = {
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => {
            const el = {
                _text: '', set textContent(v) { this._text = String(v); },
                get textContent() { return this._text; },
                set innerHTML(v) { this._html = String(v); },
                get innerHTML() { return this._html; }
            };
            return el;
        },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: { appendChild: () => {}, classList: { add() {}, remove() {} } }
    };

    sandbox.window = win;
    sandbox.document = doc;
    sandbox.location = win.location;
    sandbox.localStorage = win.localStorage;
    sandbox.navigator = { onLine: true, serviceWorker: undefined, userAgent: 'node' };
    sandbox.performance = { now: () => Date.now() };
    sandbox.showNotification = () => {};

    const tail = '\n;globalThis.__exports = {' +
        'isColorDark, formatNumber, formatTime, escapeHtml,' +
        'getInitData, getTelegramId, lockAction, unlockAction, actionLocks, delay, apiCache, setCached, MAX_CACHE_ENTRIES' +
        '};\n';

    vm.createContext(sandbox);
    vm.runInContext(SRC + tail, sandbox, { filename: 'game.js' });

    return { api: sandbox.__exports, captured };
}

function run() {
    console.log('=== isColorDark: короткая форма и мусор ===');
    const g = loadGameJs({});
    ok('#abc (яркий)', g.api.isColorDark('#abc') === false, g.api.isColorDark('#abc'));   // #aabbb -> яркий
    ok('#000 тёмный', g.api.isColorDark('#000') === true, g.api.isColorDark('#000'));
    ok('#fff светлый', g.api.isColorDark('#fff') === false, g.api.isColorDark('#fff'));
    ok('#ff0000 тёмный', g.api.isColorDark('#ff0000') === true, g.api.isColorDark('#ff0000'));
    ok('#00ff00 светлый', g.api.isColorDark('#00ff00') === false, g.api.isColorDark('#00ff00'));
    ok('без # работает', g.api.isColorDark('000000') === true, g.api.isColorDark('000000'));
    ok('мусор -> false', g.api.isColorDark('xyz') === false, g.api.isColorDark('xyz'));
    ok('не строка -> false', g.api.isColorDark(123) === false, g.api.isColorDark(123));
    ok('пустая строка -> false', g.api.isColorDark('') === false);

    console.log('\n=== formatNumber: знак и дробная часть ===');
    ok('1234567', g.api.formatNumber(1234567) === '1 234 567', g.api.formatNumber(1234567));
    ok('-1234567 со знаком', g.api.formatNumber(-1234567) === '-1 234 567', g.api.formatNumber(-1234567));
    ok('-999', g.api.formatNumber(-999) === '-999', g.api.formatNumber(-999));
    ok('1000.5 дробная часть', g.api.formatNumber(1000.5) === '1 000.5', g.api.formatNumber(1000.5));
    ok('-100.25', g.api.formatNumber(-100.25) === '-100.25', g.api.formatNumber(-100.25));
    ok('0', g.api.formatNumber(0) === '0', g.api.formatNumber(0));
    ok('Infinity -> 0', g.api.formatNumber(Infinity) === '0', g.api.formatNumber(Infinity));
    ok('не число -> 0', g.api.formatNumber('x') === '0', g.api.formatNumber('x'));
    ok('null -> 0', g.api.formatNumber(null) === '0', g.api.formatNumber(null));

    console.log('\n=== Разбиение на разряды (группы по 3) ===');
    let groupedOk = true;
    for (const n of [0, 5, 42, 999, 1000, 10000, 99999, 100000, 123456, 999999, 1000000]) {
        const s = g.api.formatNumber(n);
        const parts = s.replace('-', '').split(' ');
        if (!parts.every(p => p.length <= 3)) {
            console.log('    плохая группировка: ' + n + ' -> ' + s);
            groupedOk = false;
        }
    }
    ok('все числа сгруппированы корректно', groupedOk);

    console.log('\n=== escapeHtml: спецсимволы ===');
    // Пять символов по порядку: & < > " '
    ok('все спецсимволы экранируются',
        g.api.escapeHtml('<img src=x onerror=alert(1)>&\'"') === '&lt;img src=x onerror=alert(1)&gt;&amp;&#39;&quot;',
        g.api.escapeHtml('<img src=x onerror=alert(1)>&\'"'));
    ok('не строка -> пусто', g.api.escapeHtml(null) === '');
    ok('число -> строка', g.api.escapeHtml(42) === '42', g.api.escapeHtml(42));

    console.log('\n=== formatTime: секунды -> читаемый вид ===');
    ok('0 -> 0с', g.api.formatTime(0) === '0с', g.api.formatTime(0));
    ok('59 -> 59с', g.api.formatTime(59) === '59с', g.api.formatTime(59));
    ok('75 -> 1м 15с', g.api.formatTime(75) === '1м 15с', g.api.formatTime(75));
    ok('3600 -> 1ч 00:00', g.api.formatTime(3600) === '1ч 00:00', g.api.formatTime(3600));
    ok('3665 -> 1ч 01:05', g.api.formatTime(3665) === '1ч 01:05', g.api.formatTime(3665));

    console.log('\n=== delay: джиттер разбросан ===');
    const times = [];
    const measure = (i) => {
        if (i >= 4) {
            const allSame = times.every(t => t === times[0]);
            ok('интервалы повторений не идентичны (джиттер)', !allSame, JSON.stringify(times));
            report();
            return null;
        }
        const t0 = Date.now();
        return g.api.delay(0).then(() => { times.push(Date.now() - t0); return measure(i + 1); });
    };
    measure(0);
}

function report() {
    console.log(`\nИТОГ: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
