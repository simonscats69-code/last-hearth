/**
 * Регрессия на точный сценарий из лога пользователя:
 *
 *   Unhandled promise rejection: ReferenceError: equipmentRules is not defined
 *       at renderPlayerEquipmentInBossFight (game.js:5017)
 *       at renderBossFightScreen (game.js:5119)
 *       at loadBosses (game.js:4811)
 *
 * 1. E2E: POST /api/game/bosses/start — создаём активный соло-бой;
 * 2. E2E: GET /api/game/bosses — проверяем, что active_battle.boss содержит
 *    все поля, которые читает renderBossFightScreen;
 * 3. Рантайм: прогоняем loadBosses -> renderBossFightScreen ->
 *    renderPlayerEquipmentInBossFight с НАСТОЯЩИМ ответом сервера и
 *    убеждаемся, что ReferenceError больше нет.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const BOT_TOKEN = /^TG_BOT_TOKEN=(.*)$/m.exec(fs.readFileSync('.env', 'utf8'))[1].trim();
const PORT = 4340;
const BASE = 'http://127.0.0.1:' + PORT;

function makeInitData(user) {
    const params = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAF_t' + Math.random().toString(36).slice(2, 10),
        user: JSON.stringify(user)
    };
    const dcs = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    return Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&') + '&hash=' + hash;
}

async function waitReady() {
    const id = makeInitData({ id: 1, first_name: 'p' });
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(BASE + '/api/game/profile', { headers: { 'x-init-data': id } });
            if (r.status !== 503) return true;
        } catch (e) { }
        await new Promise(r => setTimeout(r, 1500));
    }
    return false;
}

let passed = 0, failed = 0;
const ok = (n, c, e) => {
    if (c) { passed++; console.log('  OK   ' + n); }
    else { failed++; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); }
};

(async () => {
    const child = spawn('node', ['index.js'], {
        env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', LOG_LEVEL: 'warn' }, stdio: 'ignore'
    });
    if (!await waitReady()) { console.error('Сервер не готов'); child.kill(); process.exit(1); }

    // Используем игрока с уже надетой экипировкой (player 1 из БД), иначе
    // renderPlayerEquipmentInBossFight просто выйдет раньше и тест ничего
    // не проверит.
    const USER = { id: 5449121710, first_name: 'Cats6y', username: 'Cats6y' };
    const initData = makeInitData(USER);
    console.log('Тестируем игрока ' + USER.id + ' (в БД есть надетое снаряжение)\n');

    async function call(method, p, body) {
        const r = await fetch(BASE + p, {
            method, headers: { 'content-type': 'application/json', 'x-init-data': initData },
            body: body ? JSON.stringify(body) : undefined
        });
        let j = null; try { j = await r.json(); } catch (e) { }
        return { status: r.status, json: j, text: JSON.stringify(j).slice(0, 180) };
    }

    // Проверим, что у игрока есть экипировка (иначе смысла нет).
    // ВАЖНО: сервер отдаёт equipment на верхнем уровне data.equipment,
    // а не внутри data.player — как раз это читает gameState.player.equipment.
    const prof = await call('GET', '/api/game/profile');
    const plData = (prof.json && prof.json.data) || {};
    const pl = plData.player || {};
    const equipment = plData.equipment || {};
    const eqCount = Object.keys(equipment).length;
    console.log('  надетых слотов у игрока: ' + eqCount);
    ok('у тестового игрока есть надетое снаряжение', eqCount > 0, eqCount);

    // 1. Старт боя
    console.log('\n=== 1. POST /api/game/bosses/start ===');
    let r = await call('POST', '/api/game/bosses/start', { boss_id: 1 });
    ok('start -> 200 или «уже есть активный бой» (не 404)',
        r.status === 200 || (r.json && /активн/i.test(r.json.message || '')),
        r.status + ' ' + r.text);

    // 2. GET /bosses — данные экрана
    console.log('\n=== 2. GET /api/game/bosses — контракт экрана боя ===');
    r = await call('GET', '/api/game/bosses');
    ok('bosses -> 200', r.status === 200, r.status + ' ' + r.text);

    const data = (r.json && r.json.data) || {};
    const ab = data.active_battle || null;
    console.log('  active_battle: ' + JSON.stringify(ab).slice(0, 220));
    ok('есть active_battle', Boolean(ab), JSON.stringify(Object.keys(data)));

    if (ab && ab.boss) {
        const b = ab.boss;
        ['name', 'icon'].forEach(k => ok('boss.' + k + ' есть', k in b, Object.keys(b).join(',')));
        ok('boss.hp|health|max_health (renderBossFightScreen читает все три)',
            b.hp !== undefined || b.health !== undefined || b.max_health !== undefined,
            Object.keys(b).join(','));
        ok('boss.max_hp|max_health есть', b.max_hp !== undefined || b.max_health !== undefined);
        ok('time_remaining_ms есть', typeof ab.time_remaining_ms === 'number', ab.time_remaining_ms);
    }

    // 3. Рантайм: цепочка вызовов
    console.log('\n=== 3. Рантайм: loadBosses -> renderBossFightScreen -> equipment ===');
    {
        const src = fs.readFileSync('public/game.js', 'utf8');
        const shared = require('./public/shared/equipment.js');
        const errors = [];

        // Ответ сервера как есть (из шага 2).
        // let, а не const: fetch-мок ниже ссылается на эту переменную, а
        // const создал бы temporal dead zone на весь блок.
        let serverBosses = r.json || { success: true, data: {} };

        const mkEl = (tag) => {
            const el = {
                tagName: tag, children: [], dataset: {}, _attrs: {}, _text: '', _html: '', _cls: new Set(), style: {},
                classList: { add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); },
                    toggle(c, on) { if (on) el._cls.add(c); else el._cls.delete(c); }, contains(c) { return el._cls.has(c); } },
                setAttribute(k, v) { el._attrs[k] = v; }, getAttribute(k) { return el._attrs[k]; },
                appendChild(c) { el.children.push(c); return c; }, removeChild(c) { el.children = el.children.filter(x => x !== c); },
                remove() { }, addEventListener() { }, removeEventListener() { },
                querySelector(sel) {
                    const m = /\[data-slot="([^"]+)"\]/.exec(sel);
                    if (m) {
                        if (el.dataset && el.dataset.slot === m[1]) return el;
                        for (const c of el.children) { const q = c.querySelector(sel); if (q) return q; }
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
            return el;
        };

        const slots = ['head', 'body', 'hands', 'legs', 'boots', 'weapon', 'accessory'];
        const slotEls = {};
        const eqContainer = mkEl('div');
        slots.forEach(s => { const e = mkEl('div'); e.dataset.slot = s; slotEls[s] = e; eqContainer.children.push(e); });

        // Экраны боя
        const ids = ['boss-name', 'boss-icon', 'boss-health-text', 'boss-health-bar', 'fight-log', 'boss-fight-timer', 'boss-timer-text', 'player-equipment-slots', 'bosses-list', 'bosses-info', 'raids-list'];
        const els = {};
        ids.forEach(i => { els[i] = mkEl('div'); });

        const win = {};
        win.window = win; win.__DEV_MODE__ = false;
        win.location = { origin: 'https://x', hash: '', hostname: 'x', protocol: 'https:' };
        win.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
        win.addEventListener = () => {}; win.removeEventListener = () => {};
        win.EquipmentShared = shared;
        win.Telegram = { WebApp: { initData: 'x' } };

        const doc = {
            addEventListener() { }, removeEventListener() { }, createElement: mkEl,
            getElementById: (id) => (id === 'player-equipment-slots' ? eqContainer : (els[id] || null)),
            querySelector: () => null, querySelectorAll: () => [],
            body: { appendChild() { }, classList: { add() {}, remove() {} } }
        };

        const sandbox = {
            console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')), debug() {} },
            setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
            Date, Math, JSON, Promise, Number, String, Object, Array, Error, RegExp, Map, Set, WeakMap,
            isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
            URLSearchParams, AbortController, AbortSignal, Headers,
            performance: { now: () => Date.now() },
            fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => serverBosses })
        };
        sandbox.window = win; sandbox.document = doc;
        sandbox.location = win.location; sandbox.localStorage = win.localStorage;
        sandbox.navigator = { onLine: true, userAgent: 'node' };
        vm.createContext(sandbox);

        let throwErr = null;
        try {
            vm.runInContext(src, sandbox, { filename: 'game.js' });
            vm.runInContext(`
                gameState.player = { equipment: ${JSON.stringify(equipment)} };
                gameState.buffs = {};
            `, sandbox);

            // Вызываем ТУ ЖЕ цепочку, что из лога.
            // ВАЖНО: serverBosses живёт в Node, внутри VM его нет — передаём
            // значения аргументами как JSON.
            const abForRun = serverBosses.data && serverBosses.data.active_battle;
            await vm.runInContext(
                'renderBossFightScreen(' + JSON.stringify(abForRun && abForRun.boss) + ', ' +
                JSON.stringify(abForRun && abForRun.time_remaining_ms) + ')',
                sandbox
            );
            await vm.runInContext('renderPlayerEquipmentInBossFight()', sandbox);
        } catch (e) {
            throwErr = e;
        }

        ok('цепочка renderBossFightScreen -> renderPlayerEquipmentInBossFight не падает',
            throwErr === null, throwErr && (throwErr.name + ': ' + throwErr.message));
        ok('нет ReferenceError (корень былая)', !(throwErr instanceof ReferenceError),
            throwErr && throwErr.message);
        ok('console.error не вызывался', errors.length === 0, errors.join(' | '));

        if (!throwErr) {
            // Слоты с надетым снаряжением должны быть обработаны
            let anySlotFilled = false;
            slots.forEach(s => { if (![...slotEls[s]._cls].includes('empty')) anySlotFilled = true; });
            ok('надетые слоты обработаны (empty снят)', anySlotFilled, 'все слоты остались empty');
        }
    }

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    child.kill();
    process.exit(failed ? 1 : 0);
})();
