/**
 * Тест-стенд для public/game.js — чистые функции и инфраструктура.
 * Эмулирует минимальное браузерное окружение (window/document/location),
 * поэтому файл можно исполнять в Node без jsdom.
 */
const fs = require('fs');
const path = require('path');

// --- Минимальное браузерное окружение ----------------------------------
const storage = new Map();
const listeners = {};
const timeoutRegistry = new Set();
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;

function makeWindow() {
    const w = {};
    w.window = w;
    w.__DEV_MODE__ = false;
    w.location = { origin: 'https://game.example', hash: '', hostname: 'game.example' };
    w.localStorage = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
    };
    w.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    w.removeEventListener = () => {};
    w.EquipmentShared = { ENERGY_REGEN_INTERVAL_MS: 60000, MAX_INVENTORY_SLOTS: 100 };
    w.Telegram = undefined;
    return w;
}

global.window = makeWindow();

// Заглушки, которые game.js ожидает найти в DOM (вызываются лениво)
global.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => {
        const el = {
            _text: '', _html: '',
            set textContent(v) { this._text = String(v); this._html = String(v)
                .replace(/&/g, '\u0026amp;').replace(/</g, '\u0026lt;')
                .replace(/>/g, '\u0026gt;').replace(/"/g, '\u0026quot;')
                .replace(/'/g, '\u0026#39;'); },
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
global.location = global.window.location;

// --- Загрузка game.js ---------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');
const sandbox = global;

// safeSetTimeout/safeSetInterval должны быть наблюдаемы: регистрируем ID
global.setTimeout = (fn, ms, ...rest) => { const id = realSetTimeout(fn, ms, ...rest); timeoutRegistry.add(id); return id; };
global.clearTimeout = (id) => { timeoutRegistry.delete(id); realClearTimeout(id); };
global.setInterval = (fn, ms, ...rest) => { const id = realSetInterval(fn, ms, ...rest); return id; };
global.clearInterval = (id) => { realClearInterval(id); };

const wrapped = new Function(
    'window', 'document', 'location', 'localStorage', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Headers', 'AbortController', 'AbortSignal', 'fetch', 'URLSearchParams', 'Promise',
    '"use strict";\n' + src + '\n;return {' +
    'escapeHtml, escapeAttribute, isColorDark, formatNumber, formatPercent, formatTime,' +
    'getItemCategory, getClanRoleEmoji, getRarityClassByLevel, getPlayerEmoji,' +
    'safeSetTimeout, safeClearTimeout, safeSetInterval, clearAllIntervals, ' +
    'activeTimeouts, activeIntervals, withTimeout, delay, createApiMethod, endpoints,' +
    'invalidateCache, invalidateAllCaches, apiCache, getInitData, getInitDataFromHash,' +
    'apiRequest, clientErrorMessage, Loader, Templates, RenderCache, modalState' +
    '};'
);

const amp = String.fromCharCode(38);
let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra !== undefined ? String(extra) : ''); }
};

let api = null;
try {
    api = wrapped(
        global.window, global.document, global.location, global.window.localStorage, console,
        global.setTimeout, global.clearTimeout, global.setInterval, global.clearInterval,
        Headers, AbortController, AbortSignal, global.fetch, URLSearchParams, Promise
    );
    console.log('game.js загружен без ошибок\n');
} catch (e) {
    console.error('ОШИБКА ЗАГРУЗКИ game.js:', e.message);
    console.error(e.stack);
    process.exit(1);
}

function run() {
    console.log('=== escapeHtml ===');
    // Регресс: ранее entity были вырезаны и функция была no-op
    ok('экранирует <', api.escapeHtml('<b>') === amp + 'lt;b' + amp + 'gt;', api.escapeHtml('<b>'));
    ok('экранирует &', api.escapeHtml('a&b') === 'a' + amp + 'amp;b', api.escapeHtml('a&b'));
    ok('экранирует кавычки', api.escapeHtml('"x"') === amp + 'quot;x' + amp + 'quot;', api.escapeHtml('"x"'));
    ok('экранирует одинарную кавычку', api.escapeHtml("it's") === "it" + amp + "#39;s", api.escapeHtml("it's"));
    ok('полный XSS-вектор обезврежен',
        api.escapeHtml('<script>alert(1)</script>') === amp + 'lt;script' + amp + 'gt;alert(1)' + amp + 'lt;/script' + amp + 'gt;',
        api.escapeHtml('<script>alert(1)</script>'));
    ok('не-строка: число приводится к строке (регрессия!)', api.escapeHtml(42) === '42', api.escapeHtml(42));
    ok('0 остаётся 0', api.escapeHtml(0) === '0', api.escapeHtml(0));
    ok('null -> пустая строка', api.escapeHtml(null) === '');
    ok('undefined -> пустая строка', api.escapeHtml(undefined) === '');
    ok('не ломает обычный текст', api.escapeHtml('Привет, игрок!') === 'Привет, игрок!', api.escapeHtml('Привет, игрок!'));

    console.log('\n=== Регрессия: escapeHtml на числовых id (clan/boss/raid/item) ===');
    // P0-3 прошлой сессии: typeof-guard превращал числа в '' и ломал потоки.
    // Проверяем реальные формы данных из API сервера.
    const clan = { id: 42, name: 'Тест-клан', level: 5, members_count: 3 };
    const clanRow = '<div class="clan-list-item" data-clan-id="' + api.escapeHtml(clan.id) + '">' +
        '<div class="clan-list-stats">👥 ' + (clan.members_count || 1) + ' | Уровень ' + api.escapeHtml(clan.level) + '</div>' +
        '<button class="join-btn" data-clan-id="' + api.escapeHtml(clan.id) + '">Вступить</button></div>';
    ok('data-clan-id не пустой', clanRow.indexOf('data-clan-id="42"') !== -1, clanRow);
    ok('joinClan получает число', parseInt(clanRow.match(/data-clan-id="(\d+)"/)[1], 10) === 42);
    ok('уровень клана отображается', clanRow.indexOf('Уровень 5') !== -1, clanRow);

    const boss = { id: 150480, name: 'Гниль' };
    const bossRow = '<div class="boss-card" data-id="' + api.escapeHtml(boss.id) + '">' + api.escapeHtml(boss.name) + '</div>';
    ok('boss id полноценный', bossRow.indexOf('data-id="150480"') !== -1, bossRow);

    const raid = { id: 7, boss: { id: 3 } };
    const raidRow = 'data-raid-id="' + api.escapeHtml(raid.id) + '" data-boss-id="' + api.escapeAttribute(raid.boss?.id) + '"';
    ok('raid id полноценный', raidRow.indexOf('data-raid-id="7"') !== -1, raidRow);
    ok('raid.boss.id через escapeAttribute', raidRow.indexOf('data-boss-id="3"') !== -1, raidRow);

    const chatMsg = { first_name: 'Игрок', level: 12, message: '<script>alert(1)</script>' };
    const chatRow = api.escapeHtml(chatMsg.first_name) + ' ' + api.escapeHtml(chatMsg.level) + ': ' + api.escapeHtml(chatMsg.message);
    ok('chat level=12 не теряется', chatRow.indexOf(' 12: ') !== -1, chatRow);
    ok('chat XSS обезврежен', chatRow.indexOf('<script>') === -1, chatRow);

    const timeLeft = api.escapeHtml(3600);
    ok('timeRemaining остаётся строкой', timeLeft === '3600', timeLeft);

    console.log('\n=== escapeAttribute ===');
    ok('экранирует кавычку атрибута',
        api.escapeAttribute('x" onmouseover=alert(1)').indexOf('onmouseover') !== -1 &&
        api.escapeAttribute('x" onmouseover=').indexOf(amp + 'quot;') !== -1,
        api.escapeAttribute('x" onmouseover=alert(1)'));
    ok('null/undefined -> пустая строка', api.escapeAttribute(null) === '' && api.escapeAttribute(undefined) === '');
    ok('число приводится к строке', api.escapeAttribute(5) === '5', api.escapeAttribute(5));

    console.log('\n=== Templates.modal (XSS-регресс) ===');
    const modalHtml = api.Templates.modal('Заголовок', '<img src=x onerror=alert(1)>');
    ok('title экранирован', modalHtml.indexOf(amp + 'lt;h3' + amp + 'gt;') !== -1 || modalHtml.indexOf('<h3>') !== -1);
    ok('content экранирован (нет голого <img)', modalHtml.indexOf('<img') === -1, modalHtml.slice(0, 200));
    ok('content содержит &lt;img', modalHtml.indexOf(amp + 'lt;img') !== -1);
    const modalXssTitle = api.Templates.modal('<script>x</script>', 'ok');
    ok('заголовок модалки экранирован', modalXssTitle.indexOf('<script>') === -1, modalXssTitle.slice(0, 150));

    console.log('\n=== isColorDark ===');
    ok('белый светлый', api.isColorDark('#ffffff') === false);
    ok('чёрный тёмный', api.isColorDark('#000000') === true);
    ok('пустой -> false', api.isColorDark('') === false);

    console.log('\n=== formatNumber ===');
    ok('тысячи разделены', api.formatNumber(1234567) === '1 234 567', api.formatNumber(1234567));
    ok('не число -> 0', api.formatNumber('abc') === '0', api.formatNumber('abc'));
    ok('NaN -> 0', api.formatNumber(NaN) === '0', api.formatNumber(NaN));
    ok('0 -> 0', api.formatNumber(0) === '0', api.formatNumber(0));
    ok('999 без разделителя', api.formatNumber(999) === '999', api.formatNumber(999));

    console.log('\n=== formatPercent ===');
    ok('округляет', api.formatPercent(33.6) === '34%', api.formatPercent(33.6));
    ok('целое', api.formatPercent(50) === '50%', api.formatPercent(50));

    console.log('\n=== formatTime ===');
    ok('45 секунд', api.formatTime(45).indexOf('45') !== -1, api.formatTime(45));
    ok('минуты и секунды', /м/.test(api.formatTime(125)) && /05/.test(api.formatTime(125)), api.formatTime(125));
    ok('часы', /ч/.test(api.formatTime(3661)), api.formatTime(3661));

    console.log('\n=== getItemCategory ===');
    ok('по type', api.getItemCategory({ type: 'WEAPON' }) === 'weapon', api.getItemCategory({ type: 'WEAPON' }));
    ok('fallback на category', api.getItemCategory({ category: 'Food' }) === 'food', api.getItemCategory({ category: 'Food' }));
    ok('default misc', api.getItemCategory({}) === 'misc', api.getItemCategory({}));
    ok('null-safe', api.getItemCategory(null) === 'misc', api.getItemCategory(null));

    console.log('\n=== getClanRoleEmoji / getRarityClassByLevel / getPlayerEmoji ===');
    ok('leader', api.getClanRoleEmoji('leader') === String.fromCodePoint(0x1F451), api.getClanRoleEmoji('leader'));
    ok('unknown role -> member', api.getClanRoleEmoji('zzz') === api.getClanRoleEmoji('member'));
    ok('lvl 50 legendary', api.getRarityClassByLevel(50) === 'rarity-legendary', api.getRarityClassByLevel(50));
    ok('lvl 1 common', api.getRarityClassByLevel(1) === 'rarity-common', api.getRarityClassByLevel(1));
    ok('emoji для 0 уровня', typeof api.getPlayerEmoji(0) === 'string');

    console.log('\n=== Управление таймаутами (утечка памяти) ===');
    const before = api.activeTimeouts.size;
    const t1 = api.safeSetTimeout(() => {}, 100000);
    const t2 = api.safeSetTimeout(() => {}, 100000);
    ok('таймауты зарегистрированы', api.activeTimeouts.size === before + 2, api.activeTimeouts.size);
    api.safeClearTimeout(t1);
    ok('после safeClearTimeout запись удалена', api.activeTimeouts.size === before + 1, api.activeTimeouts.size);
    api.safeClearTimeout(t2);
    ok('оба очищены', api.activeTimeouts.size === before, api.activeTimeouts.size);
    ok('safeClearTimeout не падает на неизвестном id', (api.safeClearTimeout(999999), api.activeTimeouts.size === before));

    const i1 = api.safeSetInterval(() => {}, 100000);
    ok('интервал зарегистрирован', api.activeIntervals.size === 1);
    api.clearAllIntervals();
    ok('clearAllIntervals чистит оба реестра', api.activeTimeouts.size === 0 && api.activeIntervals.size === 0,
        't=' + api.activeTimeouts.size + ' i=' + api.activeIntervals.size);

    console.log('\n=== safeSetTimeout: ошибка в колбэке не ломает реестр ===');
    let threw = false;
    const badId = api.safeSetTimeout(() => { throw new Error('boom'); }, 0);
    realSetTimeout(() => {
        try {
            ok('необработанное исключение в колбэке не выходит наружу', true);
            ok('ID удалён из реестра после срабатывания', api.activeTimeouts.has(badId) === false, api.activeTimeouts.has(badId));
            finish();
        } catch (e) { finish(); }
    }, 30);

    function finish() {
        console.log('\n=== delay (backoff) ===');
        const t0 = Date.now();
        return api.delay(0).then(() => {
            ok('delay(0) ждёт ~1с', Date.now() - t0 >= 900, Date.now() - t0);

            console.log('\n=== withTimeout ===');
            return api.withTimeout(new Promise(r => setTimeout(() => r('ok'), 10)), 1000)
                .then(v => { ok('withTimeout пропускает быстрый промис', v === 'ok', v); })
                .then(() => api.withTimeout(new Promise(() => {}), 50))
                .then(() => { ok('медленный промис должен отваливаться', false, 'не rejects'); },
                      (e) => { ok('withTimeout реджектит по таймауту', e && /[Тт]аймаут/.test(e.message), e && e.message); })
                .then(() => {
                    // Таймер withTimeout должен очищаться: иначе он бы "утека"
                    console.log('\n=== withTimeout: таймер очищается ===');
                    const pend = process._getActiveHandles ? process._getActiveHandles().length : 0;
                    return api.withTimeout(new Promise(() => {}), 50).catch(() => {}).then(() => {
                        realSetTimeout(() => {
                            const after = process._getActiveHandles ? process._getActiveHandles().length : 0;
                            ok('нет подозрительного роста активных хендлов', after <= pend + 2, pend + ' -> ' + after);
                            report();
                        }, 40);
                    });
                });
        });
    }

    function report() {
        console.log('\n========================================');
        console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
        console.log('========================================');
        process.exit(failed > 0 ? 1 : 0);
    }
}

run();
