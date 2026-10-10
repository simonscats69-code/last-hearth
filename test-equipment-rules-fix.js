/**
 * Регрессия: renderPlayerEquipmentInBossFight падал с ReferenceError.
 *
 * Корень: в функции использовалась необъявленная переменная equipmentRules,
 * тогда как весь остальной файл работает через window.EquipmentShared.
 *Guard `EquipmentShared.getDurabilityInfo ? ... : fallback` тут же не помогал:
 * `? :` защищает от отсутствующего СВОЙСТВА, но не от необъявленного
 * идентификатора — ReferenceError возникал раньше.
 *
 * Ошибка всплывала через renderBossFightScreen из loadBosses, то есть ломала
 * весь экран боссов у любого игрока с активным боем и надетым предметом.
 */
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('public/game.js', 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

/** Готовит песочницу с DOM-заглушками и НАСТОЯЩИМ shared/equipment.js */
function makeSandbox(opts = {}) {
    const shared = require('./public/shared/equipment.js');
    const created = [];
    const log = [];

    const mkEl = (tag) => {
        const el = {
            tagName: tag, children: [], dataset: {}, _attrs: {}, _text: '', _html: '', _cls: new Set(),
            style: {},
            classList: {
                add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); },
                toggle(c, on) { if (on) el._cls.add(c); else el._cls.delete(c); },
                contains(c) { return el._cls.has(c); }
            },
            setAttribute(k, v) { el._attrs[k] = v; },
            getAttribute(k) { return el._attrs[k]; },
            appendChild(c) { el.children.push(c); return c; },
            removeChild(c) { el.children = el.children.filter(x => x !== c); },
            remove() { },
            addEventListener() { }, removeEventListener() { },
            querySelector(sel) {
                // Поддержка [data-slot="head"], .slot-item, .slot-durability
                const m = /\[data-slot="([^"]+)"\]/.exec(sel);
                if (m) {
                    const slot = m[1];
                    if (el.dataset && el.dataset.slot === slot) return el;
                    for (const c of el.children) { const r = c.querySelector(sel); if (r) return r; }
                    return null;
                }
                if (sel === '.slot-item' || sel === '.slot-durability') {
                    const key = sel === '.slot-item' ? 'item' : 'dur';
                    if (!el.__slots) el.__slots = {};
                    if (!el.__slots[key]) el.__slots[key] = mkEl('div');
                    return el.__slots[key];
                }
                return null;
            },
            querySelectorAll() { return []; },
            get innerHTML() { return el._html; }, set innerHTML(v) { el._html = String(v); },
            get textContent() { return el._text; }, set textContent(v) { el._text = String(v); }
        };
        created.push(el);
        return el;
    };

    // Контейнер слотов: 7 слотов экипировки
    const slots = ['head', 'body', 'hands', 'legs', 'boots', 'weapon', 'accessory'];
    const slotEls = {};
    const container = mkEl('div');
    slots.forEach(s => { const e = mkEl('div'); e.dataset.slot = s; slotEls[s] = e; container.children.push(e); });

    const win = {};
    win.window = win;
    win.__DEV_MODE__ = false;
    win.location = { origin: 'https://x', hash: '', hostname: 'x', protocol: 'https:' };
    win.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); }
    };
    win.addEventListener = () => {};
    win.removeEventListener = () => {};
    win.EquipmentShared = opts.noShared ? undefined : shared;
    win.Telegram = { WebApp: { initData: 'x' } };

    const doc = {
        addEventListener() { }, removeEventListener() { },
        createElement: mkEl,
        getElementById: (id) => (id === 'player-equipment-slots' ? container : null),
        querySelector: () => null, querySelectorAll: () => [],
        body: { appendChild() { }, classList: { add() {}, remove() {} } }
    };

    const sandbox = {
        console: { log() {}, warn() {}, error: (...a) => log.push(a.join(' ')), debug() {} },
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
        Date, Math, JSON, Promise, Number, String, Object, Array, Error, RegExp, Map, Set, WeakMap,
        isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
        URLSearchParams, AbortController, AbortSignal, Headers,
        performance: { now: () => Date.now() },
        fetch: async () => ({ ok: false, status: 500, headers: { get: () => 'json' }, json: async () => ({}) })
    };
    sandbox.window = win;
    sandbox.document = doc;
    sandbox.location = win.location;
    sandbox.localStorage = win.localStorage;
    sandbox.navigator = { onLine: true, userAgent: 'node' };

    vm.createContext(sandbox);
    return { sandbox, container, slotEls, log, created };
}

// --- Статическая проверка: нет необъявленных идентификаторов -------------
console.log('=== Статика: необъявленные идентификаторы ===');
{
    const { execFileSync } = require('child_process');
    let out = '';
    try {
        out = execFileSync('npx', [
            'eslint', 'public/game.js', '--no-eslintrc',
            '--env', 'browser,es2021',
            '--parser-options', 'ecmaVersion:latest,sourceType:script',
            '--rule', '{"no-undef":"error"}',
            '--format', 'compact'
        ], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) { out = String(e.stdout || ''); }

    const undef = out.split(/\r?\n/).filter(l => /no-undef/.test(l));
    ok('в public/game.js 0 ошибок no-undef', undef.length === 0, undef.join(' | '));
    ok('нет ссылок на equipmentRules',
        !/\bequipmentRules\b/.test(src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')),
        'упоминание осталось в коде');
}

// --- Рантайм: функция работает с надетым предметом -----------------------
console.log('\n=== Рантайм: renderPlayerEquipmentInBossFight ===');

async function runRender(opts) {
    const { sandbox, container, slotEls, log } = makeSandbox(opts);
    let err = null;
    try {
        vm.runInContext(src, sandbox, { filename: 'game.js' });
        // Ставим состояние: игрок с надетым оружием
        vm.runInContext(`
            gameState.player = { equipment: {
                weapon: { name: 'Нож', icon: '🗡️', max_durability: 50, durability: 50, upgrade_level: 0 },
                body:   { name: 'Броня', icon: '🧥', max_durability: 100, durability: 0, upgrade_level: 0 }
            } };
        `, sandbox);
        await vm.runInContext('renderPlayerEquipmentInBossFight()', sandbox);
    } catch (e) {
        err = e;
    }
    return { err, sandbox, slotEls, log, container };
}

(async () => {
    let r = await runRender({});
    ok('не бросает ReferenceError', !(r.err && r.err instanceof ReferenceError),
        r.err && r.err.message);
    ok('вообще не бросает', r.err === null, r.err && r.err.message);
    ok('никаких ошибок в console.error', r.log.length === 0, r.log.join(' | '));

    if (!r.err) {
        // Сломанный предмет должен получить класс broken, целый — нет
        const bodyClasses = [...r.slotEls.body._cls];
        const weaponClasses = [...r.slotEls.weapon._cls];
        ok('сломанный предмет (0/100) помечен broken', bodyClasses.includes('broken'), bodyClasses.join(','));
        ok('целый предмет (50/50) НЕ помечен broken', !weaponClasses.includes('broken'), weaponClasses.join(','));
        ok('класс empty снят с занятого слота', !bodyClasses.includes('empty'), bodyClasses.join(','));
        // Иконка и title
        const itemEl = r.slotEls.weapon.querySelector('.slot-item');
        ok('иконка предмета подставлена', itemEl && itemEl.textContent === '🗡️', itemEl && itemEl.textContent);
    }

    // --- БЕЗ общего модуля: функция должна работать, а не падать ----------
    console.log('\n=== Без window.EquipmentShared (fallback) ===');
    r = await runRender({ noShared: true });
    ok('fallback: не бросает', r.err === null, r.err && r.err.message);
    if (!r.err) {
        const bodyClasses = [...r.slotEls.body._cls];
        ok('fallback: сломанный предмет всё равно помечен broken', bodyClasses.includes('broken'), bodyClasses.join(','));
    }

    // --- Пустая экипировка ------------------------------------------------
    console.log('\n=== Пустая экипировка ===');
    {
        const { sandbox, slotEls } = makeSandbox();
        let err = null;
        try {
            vm.runInContext(src, sandbox, { filename: 'game.js' });
            vm.runInContext('gameState.player = { equipment: {} };', sandbox);
            vm.runInContext('renderPlayerEquipmentInBossFight()', sandbox);
        } catch (e) { err = e; }
        ok('пустая экипировка: не бросает', err === null, err && err.message);
        ok('слот остаётся empty', [...slotEls.head._cls].includes('empty'), [...slotEls.head._cls].join(','));
    }

    // --- Нет контейнера на странице ---------------------------------------
    console.log('\n=== Нет контейнера (ранний выход) ===');
    {
        const { sandbox } = makeSandbox();
        let err = null;
        try {
            vm.runInContext(src, sandbox, { filename: 'game.js' });
            sandbox.document.getElementById = () => null;
            await vm.runInContext('renderPlayerEquipmentInBossFight()', sandbox);
        } catch (e) { err = e; }
        ok('без контейнера: не бросает', err === null, err && err.message);
    }

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed ? 1 : 0);
})();
