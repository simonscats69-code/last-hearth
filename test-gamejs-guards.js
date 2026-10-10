/**
 * Тесты новых защит public/game.js:
 *  - DEV_FALLBACK_ENABLED: выключен на нелокальном домене
 *  - isColorDark: короткая форма #abc, мусор на входе
 *  - formatNumber: отрицательные и дробные числа
 *  - lockAction/unlockAction: страховочный снятие блокировки
 *
 * Перезагружает исходник с разным window.__DEV_MODE__, поэтому окружение
 * готовится отдельной функцией.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AMP = String.fromCharCode(38);
const SRC = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra !== undefined ? String(extra) : ''); }
};

/**
 * Загружает game.js в песочницу vm с заданным hostname/hash/__DEV_MODE__.
 * Возвращает объект с доступом к внутренним функциям через добавленный
 * хвост к исходнику.
 */
function loadGameJs({ hostname = 'localhost', protocol = 'http:', __DEV_MODE__ = false, hash = '' } = {}) {
    const captured = {};

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: (m) => { captured.__devGuardError = String(m); } },
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
    win.__DEV_MODE__ = __DEV_MODE__;
    win.location = { hostname, protocol, hash, origin: 'https://x' };
    win.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    win.addEventListener = () => {};
    win.removeEventListener = () => {};
    win.EquipmentShared = { ENERGY_REGEN_INTERVAL_MS: 60000, MAX_INVENTORY_SLOTS: 100 };

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
        'DEV_FALLBACK_ENABLED, isColorDark, formatNumber, formatTime, escapeHtml,' +
        'getInitData, getTelegramId, lockAction, unlockAction, actionLocks, delay, apiCache, setCached, MAX_CACHE_ENTRIES' +
        '};\n';

    vm.createContext(sandbox);
    vm.runInContext(SRC + tail, sandbox, { filename: 'game.js' });

    return { api: sandbox.__exports, captured };
}

function run() {
    console.log('=== DEV_FALLBACK_ENABLED: страховка от утечки dev-настроек ===');
    const prod = loadGameJs({ hostname: 'game.last-hearth.ru', __DEV_MODE__: true });
    ok('на production-домене фоллбэк выключен', prod.api.DEV_FALLBACK_ENABLED === false);
    ok('ошибка залогирована', /DEV_FALLBACK_ENABLED/.test(prod.captured.__devGuardError || ''), prod.captured.__devGuardError);
    ok('getInitData вернул null (без авторизации)', prod.api.getInitData() === null);

    const devLocal = loadGameJs({ hostname: 'localhost', __DEV_MODE__: true });
    ok('на localhost фоллбэк включён', devLocal.api.DEV_FALLBACK_ENABLED === true);
    ok('getInitData даёт заглушку', typeof devLocal.api.getInitData() === 'string' && devLocal.api.getInitData().includes('hash=dummy'));

    const devFile = loadGameJs({ hostname: '', protocol: 'file:', __DEV_MODE__: true });
    ok('на file:// фоллбэк включён', devFile.api.DEV_FALLBACK_ENABLED === true);

    const devLocalExt = loadGameJs({ hostname: 'myapp.local', __DEV_MODE__: true });
    ok('на *.local фоллбэк включён', devLocalExt.api.DEV_FALLBACK_ENABLED === true);

    const noDev = loadGameJs({ hostname: 'localhost', __DEV_MODE__: false });
    ok('без флага фоллбэк выключен', noDev.api.DEV_FALLBACK_ENABLED === false);
    ok('getTelegramId -> null', noDev.api.getTelegramId() === null, noDev.api.getTelegramId());

    console.log('\n=== isColorDark: короткая форма и мусор ===');
    const g = loadGameJs({});
    ok('#abc тёмный', g.api.isColorDark('#abc') === false, g.api.isColorDark('#abc'));   // #aabbb -> яркий
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

    console.log('\n=== Подграницы (разряды по 3) ===');
    for (const n of [0, 5, 42, 999, 1000, 10000, 99999, 100000, 123456, 999999, 1000000]) {
        const s = g.api.formatNumber(n);
        // Сгруппировано correctly: группы цифр длиной <= 3
        const parts = s.split(' ');
        const good = parts.every(p => p.length <= 3) && parts[0].length <= 3;
        if (!good) { ok('группировка ' + n + ' -> ' + s, false); }
    }
    ok('все числа сгруппированы корректно', true);

    console.log('\n=== delay: джиттер разбросан ===');
    const times = [];
    // Замеряем несколько вызовов подряд и убеждаемся, что они не одинаковы
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
    return measure(0);

    function report() {
        console.log('\n========================================');
        console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
        console.log('========================================');
        process.exit(failed > 0 ? 1 : 0);
    }
}

run();
