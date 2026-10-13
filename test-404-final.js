/**
 * Финальная проверка двух спорных путей:
 *   1) /api/leaderboard/${type} — шаблонная строка, подставляется в рантайме;
 *   2) /api/game/purchase — требует {item_id, currency:'stars'}.
 *
 * ЗДЕСЬ БЫЛ ИСТОЧНИК МУСОРА В БД. Харнес запускал настоящий сервер через
 * spawn('node', ['index.js']) и подписывал фиктивный initData боевым
 * BOT_TOKEN. validatePlayer создавал игрока строкой INSERT INTO players, и
 * каждый прогон оставлял в БД «Тест»/«ТестНовый» с id 700000000+.
 *
 * Теперь проверяем поведение напрямую: обработчик покупки вызывается с
 * моками req/res без БД и без сервера.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  OK   ' + n); } else { failed++; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); } };

// ─── Моки: БД не нужна вообще ───
const dbMock = {
    transaction: async (fn) => fn({ query: async () => ({ rows: [{ stars: 0, buffs: '{}', cosmetics: '[]' }] }) }),
    queryOne: async () => null,
    queryAll: async () => [],
    query: async () => ({ rows: [] })
};
const helpersMock = {
    buildPlayerStatus: () => ({}),
    normalizeInventory: () => [],
    normalizeEquipment: () => ({}),
    createInventoryItem: (i) => i,
    normalizeRadiation: () => ({ level: 0 }),
    calculateSellPrice: () => 0,
    addItemToInventory: (v) => v,
    trackCollectedItems: () => {},
    consumeInventoryItem: (v) => ({ updatedInventory: v, quantityLeft: 0 }),
    getSetBonuses: async () => ({}),
    equipmentRules: { resolveEquipmentSlot: () => null }
};
const serverApiMock = {
    safeJsonParse: (v, d) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return d; } })() : (v == null ? d : v)),
    handleError: (res, e) => res.status(e?.statusCode || 500).json({ success: false, error: e?.message, code: e?.code || 'ERROR' }),
    logPlayerAction: async () => {}
};
const validateMock = { validateId: () => ({ ok: true, value: 1 }), validateQuantity: () => ({ ok: true, value: 1 }) };
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
    if (request.includes('shared/equipment')) {
        // Только то, что нужно minigames.js: getStarShopItem возвращает null
        // для item_id 999999 — это ветка 404 ITEM_NOT_FOUND.
        return { MAX_INVENTORY_SLOTS: 100, CONTAMINATION_DAMAGE_FROM_LEVEL: 5, getStarShopItem: () => null };
    }
    return originalLoad.apply(this, arguments);
};

const minigamesRouter = require(path.join(__dirname, 'routes/game/minigames.js'));
Module._load = originalLoad;

// Пути роутера с учётом массивов (['/purchase', '/'])
const routerPaths = (router) => {
    const out = [];
    for (const l of router.stack) {
        if (!l.route) continue;
        const p = l.route.path;
        if (Array.isArray(p)) out.push(...p); else out.push(p);
    }
    return out;
};
const getHandler = (router, p) => {
    for (const l of router.stack) {
        if (!l.route) continue;
        const rp = l.route.path;
        if (Array.isArray(rp) ? rp.includes(p) : rp === p) return l.route.stack[0].handle;
    }
    return null;
};
const makeReqRes = (body) => ({
    req: { player: { id: 1 }, body: body || {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

(async () => {
    console.log('=== Шаблонный путь loadRating подставляет type в рантайме ===');
    // Клиент: `apiRequest('/api/leaderboard/' + type)`.
    // index.js переписывает /api/leaderboard -> /minigames/leaderboard,
    // а роут в minigames зарегистрирован строкой '/leaderboard/players'.
    const idxSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    for (const t of ['players', 'clans']) {
        ok('GET /api/leaderboard/' + t + ' покрыта rewrite в index.js',
            /app\.use\('\/api\/leaderboard'[\s\S]{0,300}?'\/minigames\/leaderboard'\s*\+\s*req\.url/.test(idxSrc));
        ok('GET /leaderboard/' + t + ' зарегистрирован в minigames',
            routerPaths(minigamesRouter).includes('/leaderboard/' + t));
    }

    console.log('\n=== /api/game/purchase требует currency: stars ===');
    const purchase = getHandler(minigamesRouter, '/purchase');
    ok('обработчик /purchase найден', typeof purchase === 'function');

    let { req, res } = makeReqRes({ item_id: 999999, currency: 'stars' });
    await purchase(req, res);
    ok('stars: не маршрутный 404 (обработчик вызван)',
        !(res.body && res.body.error === 'Not found'), JSON.stringify(res.body));
    console.log('    -> ' + res.statusCode + ' ' + JSON.stringify(res.body));

    ({ req, res } = makeReqRes({ item_id: 999999, currency: 'coins' }));
    await purchase(req, res);
    ok('coins: 400 INVALID_CURRENCY (endpoint только для Stars)',
        res.body && res.body.code === 'INVALID_CURRENCY' && res.statusCode === 400,
        JSON.stringify(res.body));
    console.log('    -> ' + res.statusCode + ' ' + JSON.stringify(res.body));

    // Товара 999999 не существует — проверяем ITEM_NOT_FOUND, а не 500
    ({ req, res } = makeReqRes({ item_id: 999999, currency: 'stars' }));
    await purchase(req, res);
    ok('неизвестный item_id -> 404 ITEM_NOT_FOUND, а не падение',
        res.body && res.body.code === 'ITEM_NOT_FOUND' && res.statusCode === 404,
        JSON.stringify(res.body));

    // Проверим, что клиент shop-кнопок действительно шлёт stars
    const src = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');
    ok('клиент shop-кнопок шлёт currency: stars',
        /currency: 'stars'/.test(src) && /getStarShopItemsByCategory/.test(src), 'проверь renderShopList');

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
