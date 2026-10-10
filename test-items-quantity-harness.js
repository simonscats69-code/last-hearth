/**
 * Тест P1-5: quantity = NaN обходит проверку баланса в /buy и /buy-stars.
 *
 * Векторы атаки:
 *   quantity = {}, [], "abc", true, null -> Number() даёт NaN
 *   -> Math.max(1, Math.min(99, NaN)) === NaN
 *   -> totalPrice = price * NaN === NaN
 *   -> проверка `player.coins < NaN` ВСЕГДА ложна
 *   -> управление уходило в `coins = coins - NaN`
 */
const Module = require('module');
const path = require('path');

const log = [];
let playerRow = null;
let itemRow = null;
let forcedBarrier = null;   // {match: /regex/, error}

function reset() {
    log.length = 0;
    forcedBarrier = null;
}

function makePlayer() {
    return { id: 3, coins: 10, stars: 0, inventory: '[]', equipment: '{}', health: 100, max_health: 100 };
}

function clientFactory() {
    return {
        query: async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();
            log.push({ sql: s, params });

            // Барьер: эмуляция «БД упала на этом запросе»
            if (forcedBarrier && forcedBarrier.match.test(s)) {
                throw forcedBarrier.error;
            }

            if (/FROM players WHERE id = \$1 FOR UPDATE/.test(s)) {
                return { rows: playerRow ? [playerRow] : [] };
            }
            if (/FROM items WHERE id = \$1 AND price > 0/.test(s)) {
                return { rows: itemRow ? [itemRow] : [] };
            }
            if (/FROM items WHERE id = \$1 AND stars_price > 0/.test(s)) {
                return { rows: itemRow ? [itemRow] : [] };
            }
            if (/UPDATE players SET coins = coins - \$1/.test(s)) {
                playerRow.coins -= params[0];
                return { rows: [], rowCount: 1 };
            }
            if (/UPDATE players SET stars = GREATEST\(0, stars - \$1\)/.test(s)) {
                playerRow.stars = Math.max(0, playerRow.stars - params[0]);
                return { rows: [], rowCount: 1 };
            }
            if (/UPDATE players SET inventory/.test(s)) {
                playerRow.inventory = params[0];
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO player_logs/.test(s)) return { rows: [] };
            return { rows: [] };
        }
    };
}

const dbMock = {
    query: async () => ({ rows: [] }),
    queryOne: async () => null,
    queryAll: async () => [],
    describeError: (e) => e && e.message,
    isConnectionError: () => false,
    transaction: async (fn) => {
        const client = clientFactory();
        try {
            return await fn(client);
        } finally { /* COMMIT */ }
    },
    withClient: async (fn) => {
        const client = clientFactory();
        try { return await fn(client); } finally { }
    }
};

const realEquipment = require(path.join(__dirname, 'public/shared/equipment.js'));
const realHelpers = require(path.join(__dirname, 'utils/game-helpers.js'));

const helpersMock = {
    normalizeInventory: realHelpers.normalizeInventory,
    normalizeEquipment: realHelpers.normalizeEquipment,
    createInventoryItem: realHelpers.createInventoryItem,
    normalizeRadiation: realHelpers.normalizeRadiation || (() => ({ level: 0 })),
    normalizeInfections: realHelpers.normalizeInfections || (() => []),
    calculateSellPrice: realHelpers.calculateSellPrice || ((p) => Number(p) || 0),
    addItemToInventory: realHelpers.addItemToInventory,
    equipmentRules: realEquipment,
    getSetBonuses: async () => ({}),
    trackCollectedItems: realHelpers.trackCollectedItems || (async () => {}),
    consumeInventoryItem: realHelpers.consumeInventoryItem
};

const serverApiMock = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    safeJsonParse: (v, d) => (typeof v === 'string' ? JSON.parse(v) : (v ?? d)),
    safeStringify: JSON.stringify,
    logPlayerAction: async () => {},
    logPlayerError: async () => {},
    handleError: (res, e, action) => {
        // Повторяем поведение настоящего handleError: 4xx — текст сервера,
        // 5xx — маскированное сообщение, код INTERNAL_ERROR
        const statusCode = e.statusCode || 500;
        const rawCode = typeof e.code === 'string' ? e.code : '';
        const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
        const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
        const isClient = statusCode >= 400 && statusCode < 500;
        log.push({ __handleError: true, statusCode, code, internal: e.message });
        return res.status(statusCode).json({ success: false, error: isClient ? e.message : 'Внутренняя ошибка сервера', code });
    },
    handleConnectionError: (res, e) => false,
    ok: (r, d) => r.status(200).json({ success: true, data: d }),
    fail: (r, m, c) => r.status(400).json({ success: false, error: m, code: c }),
    notFound: (r, m, c) => r.status(404).json({ success: false, error: m, code: c }),
    PlayerHelper: { addExperience: async () => ({}) }
};

const gameConstantsMock = {
    DEBUFF_CONFIG: { radiation: { damagePerLevel: 2 } },
    calculateDropChance: () => 100,
    rollItemRarity: () => 'common',
    calculateDebuffModifiers: () => ({}),
    calculateLocationRiskProfile: () => ({}),
    getDebuffTier: () => 'none',
    MAX_INVENTORY_SLOTS: 100
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/gameConstants': gameConstantsMock,
        '../../utils/lootCache': { lootPoolCache: {}, getLootCacheReady: () => false, getLootTypePool: () => [], getRandomLootItemFromPool: () => null },
        '../../public/shared/equipment.js': realEquipment,
        './debuffs': { DebuffAPI: { apply: async () => {}, cure: async () => ({}) } }
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    return originalLoad.apply(this, arguments);
};

// Настоящая utils/validate.js — проверяем именно её (мока не требуется)
const validateLib = require(path.join(__dirname, 'utils/validate.js'));

const router = require(path.join(__dirname, 'routes/game/items.js'));
Module._load = originalLoad;

const getHandler = (p) => {
    const l = router.stack.find(x => x.route && x.route.path === p);
    return l ? l.route.stack[0].handle : null;
};

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

const makeReqRes = (body) => ({
    req: { player: { id: 3 }, body },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

async function run() {
    const buy = getHandler('/buy');
    const buyStars = getHandler('/buy-stars');
    console.log('=== P1-5: NaN-векторы количества ===');
    ok('хендлер /buy найден', typeof buy === 'function');
    ok('хендлер /buy-stars найден', typeof buyStars === 'function');

    // --- Сначала: подтверждаем, что СТАРЫЙ паттерн действительно опасен ---
    console.log('\n  Подтверждение опасности старого паттерна:');
    const bad = Math.max(1, Math.min(99, Number({} || 1)));
    console.log('    Math.max(1, Math.min(99, Number({}))) =', bad);
    ok('старый паттерн даёт NaN (доказательство уязвимости)', Number.isNaN(bad), bad);
    ok('старая проверка coins < NaN всегда ложна', (10 < bad) === false, 10 < bad);

    // --- Новое поведение ---
    const vectors = [
        { name: 'quantity = {} (объект)', q: {} },
        { name: 'quantity = [] (массив)', q: [] },
        { name: 'quantity = "abc"', q: 'abc' },
        { name: 'quantity = [1,2] (массив чисел)', q: [1, 2] },
        { name: 'quantity = -5', q: -5 },
        { name: 'quantity = 0', q: 0 },
        { name: 'quantity = 1000', q: 1000 },
        { name: 'quantity = 2.5 (дробное)', q: 2.5 }
    ];

    console.log('\n  /buy с вредоносными quantity:');
    for (const v of vectors) {
        reset();
        playerRow = makePlayer();
        itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
        const { req, res } = makeReqRes({ item_id: 55, quantity: v.q });
        await buy(req, res);

        const is400 = res.statusCode === 400;
        const code = res.body && res.body.code;
        const noDbWrite = !log.some(l => /UPDATE players SET coins/.test(l.sql));
        const err = log.find(l => l.__handleError);
        ok(v.name + ' -> 400 + ' + (code || '?'),
            is400 && (code === 'INVALID_QUANTITY' || code === 'INVALID_ITEM_ID'),
            res.statusCode + ' ' + code);
        ok(v.name + ' -> нет записи в БД', noDbWrite, JSON.stringify(log.filter(l => /UPDATE/.test(l.sql)).map(l => l.sql)));
        ok(v.name + ' -> нет 500/INTERNAL_ERROR', !(err && err.statusCode === 500), err && err.code);
    }

    console.log('\n  /buy-stars с вредоносными quantity:');
    for (const v of vectors.slice(0, 5)) {
        reset();
        playerRow = makePlayer();
        itemRow = { id: 56, name: 'Звёздный товар', price: 0, stars_price: 5, type: 'food', category: 'food', rarity: 'common' };
        const { req, res } = makeReqRes({ item_id: 56, quantity: v.q });
        await buyStars(req, res);
        const is400 = res.statusCode === 400;
        const code = res.body && res.body.code;
        const noDbWrite = !log.some(l => /UPDATE players SET/.test(l.sql));
        ok(v.name + ' -> 400', is400, res.statusCode);
        ok(v.name + ' -> код INVALID_QUANTITY', code === 'INVALID_QUANTITY', code);
        ok(v.name + ' -> нет записи в БД', noDbWrite);
    }

    console.log('\n  Корректные значения по-прежнему работают:');
    reset();
    playerRow = makePlayer();
    playerRow.coins = 1000;
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    let { req, res } = makeReqRes({ item_id: 55, quantity: 3 });
    await buy(req, res);
    ok('quantity=3 -> 200', res.statusCode === 200, res.statusCode + ' ' + (res.body && res.body.error));
    ok('списано ровно 30 монет', playerRow.coins === 970, playerRow.coins);

    reset();
    playerRow = makePlayer();
    playerRow.coins = 1000;
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    ({ req, res } = makeReqRes({ item_id: 55, quantity: 3 }));
    await buy(req, res);
    ok('quantity=3 при coins=1000 -> 200', res.statusCode === 200, res.statusCode);
    ok('списано ровно 30', playerRow.coins === 970, playerRow.coins);

    reset();
    playerRow = makePlayer();
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    ({ req, res } = makeReqRes({ item_id: 55 }));
    await buy(req, res);
    ok('quantity по умолчанию (нет поля) -> 200', res.statusCode === 200, res.statusCode + ' ' + (res.body && res.body.error));

    reset();
    playerRow = makePlayer();
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    ({ req, res } = makeReqRes({ item_id: 55, quantity: 1 }));
    await buy(req, res);
    ok('quantity=1 -> 200', res.statusCode === 200, res.statusCode);

    reset();
    playerRow = makePlayer();
    playerRow.coins = 5000;   // хватает на 99 шт по 10
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    ({ req, res } = makeReqRes({ item_id: 55, quantity: 99 }));
    await buy(req, res);
    ok('quantity=99 (граница) -> 200', res.statusCode === 200, res.statusCode + ' ' + (res.body && res.body.error));
    ok('списано 990', playerRow.coins === 5000 - 990, playerRow.coins);

    // item_id дробное
    console.log('\n  item_id валидация:');
    reset();
    playerRow = makePlayer();
    itemRow = { id: 55, name: 'Товар', price: 10, stars_price: 0, type: 'food', category: 'food', rarity: 'common' };
    ({ req, res } = makeReqRes({ item_id: 2.5, quantity: 1 }));
    await buy(req, res);
    ok('item_id=2.5 -> 400', res.statusCode === 400, res.statusCode);
    ok('код INVALID_ITEM_ID', res.body && res.body.code === 'INVALID_ITEM_ID', res.body && res.body.code);

    reset();
    playerRow = makePlayer();
    ({ req, res } = makeReqRes({ item_id: 'abc', quantity: 1 }));
    await buy(req, res);
    ok('item_id="abc" -> 400', res.statusCode === 400, res.statusCode);
    ok('нет похода в БД', !log.some(l => /UPDATE players/.test(l.sql)));

    console.log('\n=== Юнит-тесты validateQuantity ===');
    ok('quantity=1 -> ok', validateLib.validateQuantity(1).ok && validateLib.validateQuantity(1).value === 1);
    ok('quantity=99 -> ok', validateLib.validateQuantity(99).ok && validateLib.validateQuantity(99).value === 99);
    ok('quantity=100 -> отказ', !validateLib.validateQuantity(100).ok);
    ok('quantity=0 -> отказ', !validateLib.validateQuantity(0).ok);
    ok('quantity=-1 -> отказ', !validateLib.validateQuantity(-1).ok);
    ok('quantity=NaN -> отказ', !validateLib.validateQuantity(NaN).ok);
    ok('quantity=Infinity -> отказ', !validateLib.validateQuantity(Infinity).ok);
    ok('quantity={} -> отказ', !validateLib.validateQuantity({}).ok);
    ok('quantity=[] -> отказ', !validateLib.validateQuantity([]).ok);
    ok('quantity=null -> default 1', validateLib.validateQuantity(null).ok && validateLib.validateQuantity(null).value === 1);
    ok('quantity=undefined -> default 1', validateLib.validateQuantity(undefined).ok && validateLib.validateQuantity(undefined).value === 1);
    ok('quantity="" -> default 1', validateLib.validateQuantity('').ok && validateLib.validateQuantity('').value === 1);
    ok('quantity="5" (строка) -> 5', validateLib.validateQuantity('5').ok && validateLib.validateQuantity('5').value === 5);
    ok('границы настраиваются', (() => {
        const r = validateLib.validateQuantity(150, 1, 200);
        return r.ok && r.value === 150;
    })());

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
