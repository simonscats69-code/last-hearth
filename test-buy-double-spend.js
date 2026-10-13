/**
 * Тест защиты /api/game/inventory/buy от двойного списания.
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ: покупатель жмёт «Купить» дважды подряд (двойной тап,
 * реконнек, повтор с тем же Idempotency-Key). Без защиты от повторного
 * списания деньги уходят один раз, а предмет приходит дважды — или наоборот.
 *
 * Что проверяем:
 *  1. SELECT ... FOR UPDATE идёт ДО проверки баланса и ДО UPDATE coins.
 *     Lock строки players обязан снять состояние гонки «два параллельных
 *     чтения увидели один баланс».
 *  2. Цена умножается на quantity.
 *  3. При нехватке монет UPDATE не выполняется вовсе (транзакция откатывается).
 *  4. Последовательные покупки ВИДЯТ уменьшенный баланс: вторая покупка
 *     считается уже от coins - totalPrice. Второе списание за те же деньги
 *     невозможно, потому что на новом балансе проверка упадёт.
 */
const Module = require('module');
const path = require('path');

const callLog = [];
let coins = 1000;
let inventory = [];

function reset(startCoins, startInventory) {
    callLog.length = 0;
    coins = startCoins;
    inventory = startInventory || [];
}

// Мок клиента: отвечает по SQL, ведёт «настоящую» копилку coins
const clientFactory = () => ({
    query: async (sqlRaw, params) => {
        const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
        callLog.push({ sql, params });

        if (/SELECT \* FROM items WHERE id = \$1 AND price > 0/.test(sql)) {
            // Цена = 100, чтобы totalPrice = 100 * quantity был предсказуем
            return { rows: [{ id: Number(params[0]), name: 'Аптечка', price: 100, stackable: true, max_stack: 99 }] };
        }
        if (/SELECT coins, inventory FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return { rows: [{ coins, inventory }] };
        }
        if (/^UPDATE players SET coins = coins - \$1, inventory = \$2/.test(sql)) {
            // Именно вычитание: оно атомарно на стороне SQL. Если бы роут
            // считал newCoins в JS и писал SET coins = $N, повторное
            // применение дало бы двойное списание.
            const amount = Number(params[0]);
            coins = coins - amount;
            return { rows: [{ coins }] };
        }
        return { rows: [] };
    }
});

const dbMock = {
    transaction: async (fn) => fn(clientFactory()),
    queryOne: async () => null,
    queryAll: async () => [],
    query: async () => ({ rows: [] })
};

const helpersMock = {
    normalizeInventory: (i) => {
        if (Array.isArray(i)) return i;
        if (typeof i === 'string') { try { const p = JSON.parse(i); return Array.isArray(p) ? p : []; } catch { return []; } }
        return [];
    },
    normalizeEquipment: () => ({}),
    createInventoryItem: (item, opts) => Object.assign({}, item, opts),
    normalizeRadiation: () => ({ level: 0 }),
    calculateSellPrice: (item) => Number(item?.price || 0),
    addItemToInventory: (inv, item) => { inv.push(item); return 1; },
    trackCollectedItems: () => {},
    consumeInventoryItem: (inv, index) => ({ updatedInventory: inv, quantityLeft: 0 }),
    getSetBonuses: async () => ({}),
    equipmentRules: { resolveEquipmentSlot: () => null }
};

const serverApiMock = {
    safeJsonParse: (v, d) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return d; } })() : (v == null ? d : v)),
    handleError: (res, error, action) => {
        const statusCode = error.statusCode || 500;
        const code = typeof error.code === 'string' ? error.code : 'ERROR';
        return res.status(statusCode).json({ success: false, error: error.message, code });
    },
    logPlayerAction: async () => {}
};

const validateMock = {
    validateId: (v) => ({ ok: true, value: Number(v) }),
    validateQuantity: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 99) {
            return { ok: false, error: 'Количество: 1..99', code: 'INVALID_QUANTITY' };
        }
        return { ok: true, value: Math.floor(n) };
    }
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/validate': validateMock,
        '../../utils/gameConstants': {}
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    if (request.includes('shared/equipment')) return { MAX_INVENTORY_SLOTS: 100 };
    return originalLoad.apply(this, arguments);
};

const itemsRouter = require(path.join(__dirname, 'routes/game/items.js'));
Module._load = originalLoad;

const getHandler = (router, p) => {
    for (const l of router.stack) {
        if (!l.route) continue;
        const rp = l.route.path;
        if (Array.isArray(rp) ? rp.includes(p) : rp === p) return l.route.stack[0].handle;
    }
    return null;
};

const buy = getHandler(itemsRouter, '/buy');
let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra !== undefined ? String(extra) : ''); }
};

const makeReqRes = (player, body) => ({
    req: { player, body: body || {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});
const player = () => ({ id: 5 });

(async () => {
    ok('хендлер /buy найден', typeof buy === 'function');

    console.log('\n=== Порядок SQL: FOR UPDATE до UPDATE coins ===');
    reset(1000, []);
    let { req, res } = makeReqRes(player(), { item_id: 1, quantity: 2 });
    await buy(req, res);

    const lockIndex = callLog.findIndex(q => /SELECT coins, inventory FROM players WHERE id = \$1 FOR UPDATE/.test(q.sql));
    const updateIndex = callLog.findIndex(q => /^UPDATE players SET coins = coins - \$1/.test(q.sql));
    ok('SELECT ... FOR UPDATE выполнен', lockIndex !== -1);
    ok('UPDATE coins выполнен', updateIndex !== -1);
    ok('блокировка взята ДО списания', lockIndex !== -1 && lockIndex < updateIndex, `lock=${lockIndex} update=${updateIndex}`);
    ok('цена × количество = 200', coins === 800, String(coins));

    console.log('\n=== Последовательная покупка видит уменьшенный баланс ===');
    reset(250, []);
    ({ req, res } = makeReqRes(player(), { item_id: 1, quantity: 2 }));
    await buy(req, res);
    ok('первая покупка прошла (250 - 200 = 50)', coins === 50, String(coins));

    ({ req, res } = makeReqRes(player(), { item_id: 1, quantity: 1 }));
    await buy(req, res);
    ok('вторая покупка за те же деньги не проходит', res.body && res.body.code === 'INSUFFICIENT_COINS', JSON.stringify(res.body));
    ok('баланс не изменился после отказа', coins === 50, String(coins));

    console.log('\n=== Недостаточно монет: UPDATE не выполняется ===');
    reset(50, []);
    ({ req, res } = makeReqRes(player(), { item_id: 1, quantity: 2 }));
    await buy(req, res);
    ok('INSUFFICIENT_COINS', res.body && res.body.code === 'INSUFFICIENT_COINS', JSON.stringify(res.body));
    ok('UPDATE coins отсутствует', !callLog.some(q => /^UPDATE players SET coins/.test(q.sql)));
    ok('баланс цел', coins === 50, String(coins));

    console.log('\n=== Итог ===');
    console.log(`ИТОГ: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
