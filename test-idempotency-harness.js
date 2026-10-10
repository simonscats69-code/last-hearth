/**
 * Тест P1-8: идемпотентность мутаций.
 *
 * Серверная часть была мёртвой дважды:
 *   1) клиент НИКОГДА не отправлял заголовок Idempotency-Key;
 *   2) idempotencyMiddleware стоял на app.use('/api/game', ...) в index.js —
 *      ДО validatePlayer, поэтому req.player был undefined и middleware
 *      всегда уходил в next().
 *
 * Клиентская часть теперь:
 *   - createApiMethod генерирует стабильный ключ для эндпоинтов из
 *     IDEMPOTENT_ENDPOINTS (окно 1.5 с поймает двойной тап);
 *   - gameApi.post принимает { idempotencyKey } для прямых вызовов;
 *   - apiRequest кладёт ключ в заголовок Idempotency-Key.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Заголовки в объекте Headers хранятся в нижнем регистре,
 * поэтому поиск делаем без учёта регистра — как и HTTP.
 */
function headerOf(headers, name) {
    if (!headers) return undefined;
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
}

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

// ============================================================================
// ЧАСТЬ 1: серверная проводка
// ============================================================================
console.log('=== Сервер: idempotencyMiddleware смонтирован после validatePlayer ===');

const routeIdx = fs.readFileSync('routes/game/index.js', 'utf8').split(/\r?\n/);
const mainIdx = fs.readFileSync('index.js', 'utf8').split(/\r?\n/);

const lineOf = (arr, re) => arr.findIndex(l => re.test(l));

const rValidate = lineOf(routeIdx, /^\s*router\.use\(validatePlayer\)/);
const rIdem = lineOf(routeIdx, /^\s*router\.use\(idempotencyMiddleware\)/);
const rCritical = lineOf(routeIdx, /^\s*router\.use\('\/pvp\/attack', criticalActionLimiter\)/);
const rGeneral = lineOf(routeIdx, /^\s*router\.use\(generalActionLimiter\)/);

ok('в routes/game/index.js есть монтирование', rIdem !== -1, 'не найдено');
ok('idempotency ПОСЛЕ validatePlayer (есть req.player.id)',
    rValidate !== -1 && rIdem > rValidate,
    'validate=' + rValidate + ' idem=' + rIdem);
ok('idempotency ПОСЛЕ точечных лимитов (ключи не обходят rate-limit)',
    rCritical !== -1 && rIdem > rCritical,
    'critical=' + rCritical + ' idem=' + rIdem);
ok('idempotency ПЕРЕД общим лимитером (реплеи дёшевы)',
    rGeneral !== -1 && rIdem < rGeneral,
    'idem=' + rIdem + ' general=' + rGeneral);

const mIdemMount = lineOf(mainIdx, /idempotencyMiddleware.*gameRouter|app\.use\('\/api\/game'.*idempotencyMiddleware/);
ok('в index.js больше нет мёртвого монтирования', mIdemMount === -1, 'осталось на строке ' + (mIdemMount + 1));
ok('idempotencyMiddleware не импортируется зря в index.js',
    !/idempotencyMiddleware/.test(mainIdx.filter(l => /require\('\.\/utils\/serverApi'\)/.test(l)).join('')));

const routeSrc = fs.readFileSync('routes/game/index.js', 'utf8');
ok('idempotencyMiddleware импортирован в routes/game/index.js',
    /const \{[^}]*idempotencyMiddleware[^}]*\} = require\('\.\.\/\.\.\/utils\/serverApi'\)/.test(routeSrc));

// ============================================================================
// ЧАСТЬ 2: клиентские ключи (исполняем game.js в песочнице)
// ============================================================================
console.log('\n=== Клиент: генерация и отправка Idempotency-Key ===');

const src = fs.readFileSync('public/game.js', 'utf8');

const captured = { sentHeaders: null, requests: [] };

const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    Date, Math, JSON, Promise, Number, String, Object, Array, Error, RegExp, Map, Set, WeakMap,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    URLSearchParams, AbortController, AbortSignal, Headers,
    performance: { now: () => Date.now() },
    // fetch-мок: запоминает заголовки каждого вызова
    fetch: async (url, config) => {
        const hdrs = {};
        if (config && config.headers) {
            // Headers или объект
            if (typeof config.headers.forEach === 'function') {
                config.headers.forEach((v, k) => { hdrs[k] = v; });
            } else {
                Object.assign(hdrs, config.headers);
            }
        }
        captured.sentHeaders = hdrs;
        captured.requests.push({ url: String(url), headers: hdrs, method: config && config.method });
        return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: { ok: true } })
        };
    }
};

const win = {};
win.window = win;
win.__DEV_MODE__ = false;
win.location = { origin: 'https://x', hash: '', hostname: 'x.example', protocol: 'https:' };
const store = new Map();
win.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};
win.addEventListener = () => {};
win.removeEventListener = () => {};
win.EquipmentShared = { ENERGY_REGEN_INTERVAL_MS: 60000 };
win.Telegram = { WebApp: { initData: 'auth_date=1&hash=abc&user=%7B%22id%22%3A5%7D' } };

const doc = {
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => {
        const el = { set textContent(v) { this._t = String(v); }, get textContent() { return this._t || ''; },
                    set innerHTML(v) { this._h = String(v); }, get innerHTML() { return this._h || ''; } };
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
sandbox.navigator = { onLine: true, userAgent: 'node' };

vm.createContext(sandbox);

const tail = '\n;globalThis.__x = {' +
    'stableMutationKey, IDEMPOTENT_ENDPOINTS, IDEMPOTENCY_WINDOW_MS, apiRequest, gameApi' +
    '};\n';

try {
    vm.runInContext(src + tail, sandbox, { filename: 'game.js' });
} catch (e) {
    console.error('ОШИБКА ЗАГРУЗКИ game.js:', e.message);
    process.exit(1);
}
const X = sandbox.__x;

console.log('  game.js загружен');

// --- Юнит-тесты stableMutationKey ---
const k1 = X.stableMutationKey('wheelSpin');
const k2 = X.stableMutationKey('wheelSpin');
const k3 = X.stableMutationKey('purchase');
ok('повторный вызов в окне даёт тот же ключ (защита от двойного тапа)', k1 === k2, k1 + ' vs ' + k2);
ok('разные области дают разные ключи', k1 !== k3, k1 + ' vs ' + k3);
ok('ключ не пустой', typeof k1 === 'string' && k1.length > 5, k1);
ok('ключ содержит область', k1.indexOf('wheelSpin') !== -1, k1);

// Окно истекает
const kOld = X.stableMutationKey('scope-x');
// Ждём выхода из окна
setTimeout(() => {
    const kNew = X.stableMutationKey('scope-x');
    ok('после окна генерируется новый ключ', kNew !== kOld, kOld + ' vs ' + kNew);

    // --- IDEMPOTENT_ENDPOINTS ---
    console.log('\n=== Список идемпотентных эндпоинтов ===');
    const list = [...X.IDEMPOTENT_ENDPOINTS];
    console.log('  ' + list.join(', '));
    ok('в списке wheelSpin', list.includes('wheelSpin'));
    ok('в списке clanJoin', list.includes('clanJoin'));
    ok('НЕТ поиска/атак (два удара — легитимная игра)', !list.includes('search') && !list.includes('attackBoss'), list.join(','));
    ok('НЕТ несуществующих имён (buyCoinItem идёт через gameApi.post)',
        !list.includes('buyCoinItem') && !list.includes('buyEnergy') && !list.includes('claimAchievement'), list.join(','));

    (async () => {
        // --- Клиент реально отправляет заголовок ---
        console.log('\n=== Заголовок Idempotency-Key уходит на сервер ===');
        captured.requests.length = 0;
        try {
            await X.apiRequest('/game/wheel/spin', { method: 'POST', body: { is_paid: false }, idempotencyKey: 'key-abc-123' }, 0);
        } catch (e) { /* моки ответа достаточно */ }

        ok('запрос отправлен', captured.requests.length === 1, captured.requests.length);
        const sent = captured.requests[0] && captured.requests[0].headers;
        console.log('  отправленные заголовки: ' + JSON.stringify(sent));
        ok('Idempotency-Key присутствует', Boolean(sent && headerOf(sent, 'Idempotency-Key')), JSON.stringify(sent));
        ok('Idempotency-Key = переданному ключу', sent && headerOf(sent, 'Idempotency-Key') === 'key-abc-123', sent && headerOf(sent, 'Idempotency-Key'));
        ok('x-init-data тоже уходит', Boolean(sent && sent['x-init-data']), JSON.stringify(sent && sent['x-init-data']));

        // --- POST без ключа: ключ НЕ добавляется (не ломаем остальные мутации) ---
        captured.requests.length = 0;
        try {
            await X.apiRequest('/game/pvp/attack-hit', { method: 'POST', body: { battle_id: 1 } }, 0);
        } catch (e) { /* noop */ }
        const sent2 = captured.requests[0] && captured.requests[0].headers;
        ok('для обычной мутации ключ НЕ добавляется (два удара остаются легитимными)',
            Boolean(sent2) && sent2['Idempotency-Key'] === undefined,
            JSON.stringify(sent2));

        // --- createApiMethod: колесо получает ключ автоматически ---
        console.log('\n=== createApiMethod: колесо и клан получают ключ сами ===');
        captured.requests.length = 0;
        try { await X.gameApi.wheelSpin({ is_paid: true }); } catch (e) { /* noop */ }
        const w = captured.requests[0] && captured.requests[0].headers;
        ok('wheelSpin отправляет Idempotency-Key', Boolean(w && headerOf(w, 'Idempotency-Key')), JSON.stringify(w));
        ok('ключ wheelSpin упоминает область',
            Boolean(w && headerOf(w, 'Idempotency-Key') && headerOf(w, 'Idempotency-Key').indexOf('wheelSpin') !== -1),
            headerOf(w, 'Idempotency-Key'));

        // Два вызова подряд — один ключ
        const firstKey = w && headerOf(w, 'Idempotency-Key');
        captured.requests.length = 0;
        try { await X.gameApi.wheelSpin({ is_paid: true }); } catch (e) { /* noop */ }
        const w2 = captured.requests[0] && captured.requests[0].headers;
        ok('два быстрых вызова колеса несут ОДИН ключ (двойной тап схлопнется)',
            Boolean(w2 && headerOf(w2, 'Idempotency-Key') === firstKey), firstKey + ' vs ' + (w2 && headerOf(w2, 'Idempotency-Key')));

        // Поиск НЕ получает ключ
        captured.requests.length = 0;
        try { await X.gameApi.search({}); } catch (e) { /* noop */ }
        const s = captured.requests[0] && captured.requests[0].headers;
        ok('search НЕ получает ключ (повторный поиск — легитимен)',
            Boolean(s) && s['Idempotency-Key'] === undefined, JSON.stringify(s));

        // --- gameApi.post с options ---
        console.log('\n=== gameApi.post принимает options.idempotencyKey ===');
        captured.requests.length = 0;
        try { await X.gameApi.post('/game/items/buy', { item_id: 1 }, { idempotencyKey: 'direct-key-1' }); } catch (e) { /* noop */ }
        const d = captured.requests[0] && captured.requests[0].headers;
        ok('gameApi.post проводит ключ в заголовок', Boolean(d && headerOf(d, 'Idempotency-Key') === 'direct-key-1'),
            JSON.stringify(d));

        console.log('\n========================================');
        console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
        console.log('========================================');
        process.exit(failed > 0 ? 1 : 0);
    })();
}, 1700);
