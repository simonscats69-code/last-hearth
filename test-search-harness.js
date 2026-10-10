/**
 * Тест-стенд для routes/game/world.js (POST /search).
 * Важно: world.js деструктурирует { query, queryAll, transaction } при require,
 * поэтому моки должны быть заданы ДО загрузки модуля.
 */
const Module = require('module');
const path = require('path');

const AMP = '\u0026';
const Q = String.fromCharCode(39);

// --- Очередь ответов БД (заполняется перед каждым прогоном) ------------
let responses = [];
let idx = 0;
const captured = [];

function reset(nextResponses) {
    responses = nextResponses;
    idx = 0;
    captured.length = 0;
}

// --- Мок клиента: отвечает по паттерну SQL ----------------------------
// Это устойчивее, чем очередь ответов: тест не зависит от того,
// сколько запросов и в каком порядке выполняет обработчик.
let clientQueryResponder = () => ({ rows: [] });

/** Управляемое состояние моков (ролл редкости, выпадение монет и т.п.) */
const state = { rolledRarity: 'common' };

const clientFactory = () => ({
    query: async (...a) => {
        captured.push(a);
        return clientQueryResponder(...a);
    }
});

function params(p) {
    if (!p) return '';
    return '| p=' + JSON.stringify(p).slice(0, 80);
}

const dbMock = {
    query: async () => ({ rows: [] }),
    queryAll: async () => [],
    describeError: (e) => e.message,
    transaction: async (fn) => fn(clientFactory())
};

const helpersMock = {
    normalizeInventory: (i) => Array.isArray(i) ? i : [],
    normalizeRadiation: (r) => ({ level: Number(r?.level ?? r ?? 0) }),
    getActiveBuffs: () => ({}),
    createInventoryItem: (item, opts) => ({ ...item, ...opts }),
    recalcEnergy: async () => {}, regenerateHealth: async () => {},
    addItemToInventory: (inv, item) => { inv.push(item); },
    equipmentRules: { calculateEquipmentLuckBonus: () => 0 },
    trackCollectedItems: async () => {}, progressDailyTask: async () => {}
};

const constantsMock = {
    DEBUFF_CONFIG: { radiation: { damagePerLevel: 2, baseDurationMs: 3600000, durationPerLevelMs: 0, maxLevel: 100 } },
    calculateDropChance: () => 100,
    // Результат ролла редкости управляется из тестов через state.rolledRarity
    rollItemRarity: () => state.rolledRarity,
    calculateDebuffModifiers: () => ({ luck: 1, dropChance: 1 }),
    calculateLocationRiskProfile: () => ({
        radiationPressure: 0, infectionDefense: 0, rewardMultiplier: 1, expMultiplier: 1,
        tier: 'low', label: 'Низкий', riskScore: 0, keyChanceMultiplier: 1,
        rarityLuckBonus: 0, isPrepared: true
    }),
    getDebuffTier: () => 'none'
};

let lastHandleError = null;
const serverApiMock = {
    logger: { info() {}, warn() {}, error() {} },
    safeJsonParse: (v, d) => (typeof v === 'string' ? JSON.parse(v) : (v ?? d)),
    handleError: (res, e, action) => {
        lastHandleError = { message: e && e.message, stack: e && e.stack, action };
        console.log('    !! handleError:', action, '->', e && e.message);
        if (e && e.stack) console.log(e.stack.split('\n').slice(0, 4).join('\n'));
        res.statusCode = 500; res.body = { success: false, error: e && e.message, __action: action };
    },
    logPlayerAction: async () => {}
};

const lootCacheMock = {
    lootPoolCache: {}, getLootCacheReady: () => true, buildLootCache: () => {},
    getLootTypePool: () => ['food'], getRandomLootItemFromPool: () => null
};

// Управляемый crypto мир: rollValue позволяет детерминировать роллы
// (кулдауны, выпадение ключа, дроп шанса) в тестах.
const cryptoMock = {
    rollValue: 0,        // сколько вернёт randomInt (по умолчанию — 'выпало')
    randomInt(max) { return cryptoMock.rollValue >= max ? max - 1 : cryptoMock.rollValue; }
};

const debuffsMock = { DebuffAPI: { apply: async () => {}, cure: async () => ({}) } };
// Контракт совпадает с реальным public/shared/equipment.js:
// оттуда экспортируются ОТДЕЛЬНЫЕ функции, а не объект equipmentRules.
// equipmentRules (namespace с методами) приходит из helpers.
const equipmentMock = Object.assign(
    function calculateCoinDrop() { return { amount: 42 }; },
    { MAX_INVENTORY_SLOTS: 100 }
);
equipmentMock.calculateCoinDrop = () => ({ amount: 42 });

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/gameConstants': constantsMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/lootCache': lootCacheMock,
        '../../public/shared/equipment.js': equipmentMock
    };
    if (map[request]) return map[request];
    // Контролируемая случайность вместо настоящего crypto
    if (request === 'crypto') return cryptoMock;
    if (request.includes('game-helpers')) return helpersMock;
    if (request === './debuffs') return debuffsMock;
    return originalLoad.apply(this, arguments);
};

const worldRouter = require(path.join(__dirname, 'routes/game/world.js'));
Module._load = originalLoad;

const searchLayer = worldRouter.stack.find(l => l.route && l.route.path === '/search');
if (!searchLayer) { console.error('POST /search не найден'); process.exit(1); }
const handler = searchLayer.route.stack[0].handle;

const basePlayer = () => ({
    id: 7, level: 10, energy: 5, max_energy: 100, health: 100, max_health: 100,
    current_location_id: 3, luck: 5, total_actions: 0, buffs: {},
    inventory: [], equipment: {}, radiation: { level: 0 }
});
const baseLocation = () => ({ id: 3, name: 'Тест', radiation: 0, infection: 0 });

const makeReqRes = (player) => ({
    req: { player, body: {}, headers: {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra || ''); }
};

async function run() {
    // Строим UPDATE динамически с правильными позициями параметров
    // ПЕРЕД вызовом: мок отвечает по паттерну, порядок не важен.
    // (см. постоянный clientFactory выше)
    // ============ Сценарий 1: успешный поиск с выпадением монет ============
    console.log('\nСценарий 1: успешный поиск + монеты');
    // Мокируем ответы: 0 - игрок, 1 - локация, 2 - ключи босса (CTE одним запросом),
    // 3 - UPDATE players
    clientQueryResponder = (sql, params) => {
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return { rows: [currentPlayer] };
        }
        if (/FROM locations WHERE id/.test(sql)) {
            return { rows: [baseLocation()] };
        }
        // getBossKeyChances: ОДИН объединённый запрос через CTE
        if (/WITH next_boss/.test(sql)) {
            return { rows: [] };  // ключ не выпал - идёт обычный лут
        }
        if (/UPDATE players SET/.test(sql)) {
            return { rows: [{ energy: 4, max_energy: 100, last_energy_update: 'now', coins: 0 }] };
        }
        return { rows: [] };
    };
    captured.length = 0;
    currentPlayer = basePlayer();
    let { req, res } = makeReqRes(currentPlayer);

    await handler(req, res);

    // getBossKeyChances должен выполнить РОВНО ОДИН запрос к БД
    const keyQueries = captured.filter(c => /WITH next_boss|boss_keys|MAX\(id\)/.test(String(c[0])));
    ok('getBossKeyChances: ровно один запрос к БД', keyQueries.length === 1, 'count=' + keyQueries.length);
    ok('getBossKeyChances: использует CTE', /WITH next_boss/.test(String(keyQueries[0] && keyQueries[0][0])), String(keyQueries[0] && keyQueries[0][0]).slice(0, 120));
    ok('чёткий ответ на успешный поиск', res.statusCode === 200 && res.body.success, JSON.stringify(res.body).slice(0, 150));

    console.log('\nСценарий 1b: ключ босса выпал (тем же одним запросом)');
    clientQueryResponder = (sql, params) => {
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [currentPlayer] };
        if (/FROM locations WHERE id/.test(sql)) return { rows: [baseLocation()] };
        if (/WITH next_boss/.test(sql)) {
            // Ключ доступен — выпадет ли его, решает crypto.randomInt в обработчике.
            // Харнесс управляет им через cryptoMock.rollValue.
            return { rows: [{ boss_id: 3, boss_name: 'Гниль', key_drop_chance: 5, key_name: 'Ключ от Гнили', key_icon: '🗝️', key_rarity: 'epic' }] };
        }
        if (/UPDATE players SET/.test(sql)) {
            return { rows: [{ energy: 4, max_energy: 100, last_energy_update: 'now', coins: 0 }] };
        }
        return { rows: [] };
    };
    captured.length = 0;
    ({ req, res } = makeReqRes(currentPlayer));
    await handler(req, res);
    ok('found_key отдан клиенту', res.body && res.body.found_key && res.body.found_key.name === 'Ключ от Гнили', JSON.stringify(res.body && res.body.found_key));
    const keyQ2 = captured.filter(c => /WITH next_boss/.test(String(c[0])));
    ok('и здесь один запрос', keyQ2.length === 1, 'count=' + keyQ2.length);

    // ============ Сценарий 2: нет игрока ============
    console.log('\nСценарий 2: игрок не найден');
    clientQueryResponder = (sql) => {
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [] };
        return { rows: [] };
    };
    captured.length = 0;
    ({ req, res } = makeReqRes(basePlayer()));
    await handler(req, res);
    ok('HTTP 404', res.statusCode === 404, res.statusCode);
    ok('код PLAYER_NOT_FOUND', res.body && res.body.code === 'PLAYER_NOT_FOUND', JSON.stringify(res.body));

    // ============ Сценарий 3: инвентарь переполнен ============
    console.log('\nСценарий 3: инвентарь переполнен');
    clientQueryResponder = (sql) => {
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) {
            const p = basePlayer();
            p.inventory = new Array(100).fill(null).map((_, i) => ({ id: i, type: 'food', name: 'x' + i, quantity: 1 }));
            return { rows: [p] };
        }
        if (/FROM locations WHERE id/.test(sql)) return { rows: [baseLocation()] };
        if (/WITH next_boss/.test(sql)) return { rows: [] };
        // getRandomLootItem фолбэк: ищем в items
        if (/FROM items/.test(sql)) return { rows: [{ id: 55, name: 'Найдок', type: 'food', category: 'food', rarity: 'common', icon: 'x', damage: 0, defense: 0, stats: {} }] };
        return { rows: [] };
    };
    captured.length = 0;
    const fullP = basePlayer();
    fullP.inventory = new Array(100).fill(null).map((_, i) => ({ id: i, type: 'food', name: 'x' + i, quantity: 1 }));
    ({ req, res } = makeReqRes(fullP));
    await handler(req, res);
    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('код INVENTORY_FULL', res.body && res.body.code === 'INVENTORY_FULL', JSON.stringify(res.body));

    // ============ Сценарий 4: предмет + опыт + монеты ============
    console.log('\nСценарий 4: полный набор параметров UPDATE');
    state.rolledRarity = 'rare';
    clientQueryResponder = (sql) => {
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [currentPlayer] };
        if (/FROM locations WHERE id/.test(sql)) return { rows: [baseLocation()] };
        if (/WITH next_boss/.test(sql)) return { rows: [] };
        if (/FROM items/.test(sql)) return { rows: [{ id: 77, name: 'Редкость', type: 'food', category: 'food', rarity: 'rare', icon: 'y', damage: 0, defense: 0, stats: {} }] };
        if (/UPDATE players SET/.test(sql)) return { rows: [{ energy: 4, max_energy: 100, last_energy_update: 'now', coins: 0 }] };
        return { rows: [] };
    };
    captured.length = 0;
    ({ req, res } = makeReqRes(basePlayer()));
    await handler(req, res);
    const upd2 = captured.find(c => /^UPDATE players SET/.test(String(c[0])));
    if (upd2) {
        const sql2 = upd2[0], ps2 = upd2[1];
        console.log('    SQL   :', sql2.replace(/\s+/g, ' '));
        console.log('    PARAMS:', JSON.stringify(ps2));
        ok('все обязательные поля в UPDATE',
            /inventory = \$\d+/.test(sql2) && /experience = experience \+ \$\d+/.test(sql2) && /items_collected = COALESCE\(items_collected, 0\) \+ \$\d+/.test(sql2) && /coins = COALESCE\(coins, 0\) \+ \$\d+/.test(sql2));
        ok('последний параметр = playerId', ps2[ps2.length - 1] === 7, JSON.stringify(ps2[ps2.length - 1]));
        const sc2 = sql2.slice(sql2.indexOf('SET') + 3, sql2.lastIndexOf('WHERE'));
        const nums2 = [...sc2.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
        ok('номера параметров последовательны',
            nums2.length === ps2.length - 1 && Math.max(...nums2) === ps2.length - 1,
            'nums=' + JSON.stringify(nums2) + ' len=' + ps2.length);
        ok('exp_gained > 0', res.body && res.body.exp_gained > 0, JSON.stringify(res.body && res.body.exp_gained));
        // Проверка баланса: rarity=rare(7) + base 6 = 13; локация id=3 -> ×1.3;
        // (total_actions+1)=1, комбо не срабатывает; riskMultiplier=1 -> 16
        ok('XP считается по тем же формулам (16)', res.body && res.body.exp_gained === 16, JSON.stringify(res.body && res.body.exp_gained));

        // Комбо: на 10-м действии подряд бонус ×1.5
        currentPlayer = basePlayer();
        currentPlayer.total_actions = 9;   // (9+1) % 10 === 0 -> комбо
        ({ req, res } = makeReqRes(currentPlayer));
        await handler(req, res);
        // 13 * 1.3 * 1.5 = 25.35 -> floor = 25
        ok('комбо-бонус ×1.5 применён (25)', res.body && res.body.exp_gained === 25, JSON.stringify(res.body && res.body.exp_gained));
    } else {
        ok('UPDATE найден (сценарий 4)', false);
    }

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
