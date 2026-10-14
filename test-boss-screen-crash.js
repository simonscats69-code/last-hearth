/**
 * Регрессия на точный сценарий из лога пользователя:
 *
 *   Unhandled promise rejection: ReferenceError: equipmentRules is not defined
 *       at renderPlayerEquipmentInBossFight (game.js:5017)
 *       at renderBossFightScreen (game.js:5119)
 *       at loadBosses (game.js:4811)
 *
 * Проверяем цепочку loadBosses -> renderBossFightScreen ->
 * renderPlayerEquipmentInBossFight в песочнице vm с мок-ответом сервера.
 *
 * ЗДЕСЬ БЫЛ ИСТОЧНИК МУСОРА В БД: харнес поднимал настоящий сервер через
 * spawn('node', ['index.js']) и ходил в него с initData реального аккаунта.
 * Каждый прогон оставлял в players.active_boss_id активный соло-бой.
 * Боевую строку видели сами пользователи: экран боссов после теста открывался
 * сразу в бой.
 *
 * Теперь БД и сервера нет вообще: ответ /bosses и equipment подставляются
 * как JSON, а цепочка вызовов выполняется в vm-песочнице.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const ok = (n, c, e) => {
    if (c) { passed++; console.log('  OK   ' + n); }
    else { failed++; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); }
};

(async () => {
    const src = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');
    const shared = require(path.join(__dirname, 'public/shared/equipment.js'));

    // ─── Мок-ответа GET /api/game/bosses (активный соло-бой) ───
    // Поля ровно те, что читает renderBossFightScreen:
    // boss.name/icon/hp/max_hp/max_health + active_battle.time_remaining_ms
    const serverBosses = {
        success: true,
        data: {
            active_battle: {
                type: 'solo',
                boss: {
                    id: 1,
                    name: 'Крыса-мутант',
                    icon: '🐀',
                    hp: 500,
                    max_hp: 1000,
                    max_health: 1000,
                    current_damage: 42,
                    damage_percent: 3
                },
                time_remaining_ms: 8 * 60 * 60 * 1000,
                fight_duration_ms: 8 * 60 * 60 * 1000
            }
        }
    };

    // ─── Мок надетой экипировки: все слоты, как на реальном аккаунте ───
    // Слоты по канону (public/shared/equipment.js): armor/helmet/face/body/
    // hands/legs/boots/accessory/weapon. Слот 'head' удалён — маски и
    // противогазы переехали в 'face', каски живут в 'helmet'.
    const equipment = {
        weapon: { name: 'Нож', type: 'weapon', icon: '🔪', slot: 'weapon', durability: 40, max_durability: 50 },
        armor: { name: 'Бронежилет', type: 'armor', icon: '🦺', slot: 'armor', durability: 48, max_durability: 50 },
        helmet: { name: 'Шлем', type: 'armor', icon: '🪖', slot: 'helmet', durability: 48, max_durability: 50 },
        face: { name: 'Противогаз', type: 'armor', icon: '😷', slot: 'face', durability: 48, max_durability: 50 },
        body: { name: 'Куртка', type: 'armor', icon: '🧥', slot: 'body', durability: 48, max_durability: 50 },
        hands: { name: 'Перчатки', type: 'armor', icon: '🧤', slot: 'hands', durability: 48, max_durability: 50 },
        legs: { name: 'Штаны', type: 'armor', icon: '👖', slot: 'legs', durability: 48, max_durability: 50 },
        boots: { name: 'Ботинки', type: 'armor', icon: '🥾', slot: 'boots', durability: 48, max_durability: 50 }
    };

    // Слоты, которые рисует экран боя (те же девять, что в renderEquipment)
    const slots = ['helmet', 'face', 'armor', 'body', 'hands', 'legs', 'boots', 'weapon', 'accessory'];

    // ─── Лёгкий DOM-элемент, которого хватает renderPlayerEquipmentInBossFight ───
    const mkEl = (tag) => {
        const el = {
            tagName: tag, children: [], dataset: {}, _attrs: {}, _text: '', _html: '', _cls: new Set(), style: {},
            classList: {
                add(c) { el._cls.add(c); },
                remove(c) { el._cls.delete(c); },
                toggle(c, on) { if (on) el._cls.add(c); else el._cls.delete(c); },
                contains(c) { return el._cls.has(c); }
            },
            setAttribute(k, v) { el._attrs[k] = v; },
            getAttribute(k) { return el._attrs[k]; },
            appendChild(c) { el.children.push(c); return c; },
            removeChild(c) { el.children = el.children.filter(x => x !== c); },
            remove() { },
            addEventListener() { },
            removeEventListener() { },
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
            get innerHTML() { return el._html; },
            set innerHTML(v) { el._html = String(v); },
            get textContent() { return el._text; },
            set textContent(v) { el._text = String(v); }
        };
        return el;
    };

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

    const errors = [];
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
    ok('нет ReferenceError (корень бага)', !(throwErr instanceof ReferenceError),
        throwErr && throwErr.message);
    ok('console.error не вызывался', errors.length === 0, errors.join(' | '));

    if (!throwErr) {
        let anySlotFilled = false;
        slots.forEach(s => { if (![...slotEls[s]._cls].includes('empty')) anySlotFilled = true; });
        ok('надетые слоты обработаны (empty снят)', anySlotFilled, 'все слоты остались empty');
    }

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
