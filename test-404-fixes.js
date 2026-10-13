/**
 * E2E-регрессия исправлений 404.
 *
 * ЗДЕСЬ БЫЛ ИСТОЧНИК МУСОРА В БД. Харнес поднимал настоящий сервер
 * (`spawn('node', ['index.js'])`), читал BOT_TOKEN из .env и подписывал
 * фиктивный initData. validatePlayer проверял подпись, а
 * upsertPlayerFromTelegramUser делал INSERT INTO players. Каждый прогон
 * оставлял в боевой БД игроков «ТестНовый» / «Тест» с id 700000000+, и они
 * всплывали в PvP, рейтинге и кланах.
 *
 * Теперь тестов нет БД вовсе: проверяем то, что этот харнес и должен был
 * проверять — наличие маршрутов и контракт ответа между клиентом и
 * сервером. Ответы возвращают моки роутов, поэтому база не нужна.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

// ─── Моки, чтобы роуты грузились без БД ───
const dbMock = {
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    queryOne: async () => null,
    queryAll: async () => [],
    query: async () => ({ rows: [] })
};
const helpersMock = {
    buildPlayerStatus: () => ({ health: 100, max_health: 100, radiation: 0 }),
    normalizeInventory: () => [],
    normalizeEquipment: () => ({}),
    createInventoryItem: (i) => i,
    normalizeRadiation: () => ({ level: 0 }),
    calculateSellPrice: () => 0,
    addItemToInventory: (v) => v,
    trackCollectedItems: () => {},
    consumeInventoryItem: (v) => ({ updatedInventory: v, quantityLeft: 0 }),
    getSetBonuses: async () => ({}),
    equipmentRules: {
        resolveEquipmentSlot: () => null,
        getDurabilityState: () => ({ state: 'ok' })
    }
};
const serverApiMock = {
    safeJsonParse: (v, d) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return d; } })() : (v == null ? d : v)),
    handleError: (res, e) => res.status(e?.statusCode || 500).json({ success: false, error: e?.message, code: e?.code || 'ERROR' }),
    logPlayerAction: async () => {}
};
const validateMock = {
    validateId: (v) => ({ ok: true, value: Number(v) }),
    validateQuantity: () => ({ ok: true, value: 1 })
};
const gameConstantsMock = {};
const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/validate': validateMock,
        '../../utils/gameConstants': gameConstantsMock
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    if (request.includes('shared/equipment')) return { MAX_INVENTORY_SLOTS: 100, CONTAMINATION_DAMAGE_FROM_LEVEL: 5 };
    return originalLoad.apply(this, arguments);
};

// Настоящие роутеры — именно их монтирование и проверялось в харнесе
const bossesRouter = require(path.join(__dirname, 'routes/game/bosses.js'));
const playerRouter = require(path.join(__dirname, 'routes/game/player.js'));
const minigamesRouter = require(path.join(__dirname, 'routes/game/minigames.js'));
Module._load = originalLoad;

// Пути роутера, включая массивы путей: ['/use','/use-item']
const routerPaths = (router) => {
    const out = [];
    for (const l of router.stack) {
        if (!l.route) continue;
        const p = l.route.path;
        if (Array.isArray(p)) out.push(...p);
        else out.push(p);
    }
    return out;
};
const hasPath = (router, p) => routerPaths(router).includes(p);

console.log('=== FIX-2: /bosses/start смонтирован, /bosses/attack — нет ===');
ok('POST /start существует', hasPath(bossesRouter, '/start'));
ok('старый путь /attack (без -boss) отсутствует',
    !hasPath(bossesRouter, '/attack'),
    'нашёлся маршрут /attack — старый путь не удалён');

console.log('\n=== FIX-4: /player/achievements/progress смонтирован ===');
ok('GET /achievements/progress существует', hasPath(playerRouter, '/achievements/progress'));

console.log('\n=== FIX-5: /player/achievements/claim смонтирован ===');
ok('POST /achievements/claim существует', hasPath(playerRouter, '/achievements/claim'));

console.log('\n=== FIX-1: /api/leaderboard проксируется в minigames ===');
// Роут зарегистрирован не алиасом router.use, а rewrite в index.js:
// app.use('/api/leaderboard', ...) -> req.url = '/minigames/leaderboard' + rest.
// Раньше совпадения путей не было (в minigames '/leaderboard/players'),
// и запрос давал 404 — этот харнес для того и писался.
const idxSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
ok("index.js проксирует /api/leaderboard в /minigames/leaderboard",
    /app\.use\('\/api\/leaderboard'[\s\S]{0,300}?'\/minigames\/leaderboard'\s*\+\s*req\.url/.test(idxSrc));
ok('GET /leaderboard/players есть в minigames', hasPath(minigamesRouter, '/leaderboard/players'));
ok('GET /leaderboard/clans есть в minigames', hasPath(minigamesRouter, '/leaderboard/clans'));

console.log('\n=== Контракт ответа: поля, которые ждёт клиент ===');
// Клиент читает result.data.boss / current_damage / time_remaining_ms.
const bossSrc = fs.readFileSync(path.join(__dirname, 'routes/game/bosses.js'), 'utf8');
ok('start отдаёт data.boss', /boss:\s*\{/.test(bossSrc));
ok('start отдаёт time_remaining_ms', /time_remaining_ms:/.test(bossSrc));
ok('attack отдаёт текущий урон игрока', /current_damage/.test(bossSrc));

console.log('\n=== Бонус: старые 404-пути больше не зовутся клиентом ===');
// Сверяем только РАБОЧИЙ код, без комментариев: в них старые пути
// упоминаются намеренно, как пояснение что было.
const srcRaw = fs.readFileSync(path.join(__dirname, 'public/game.js'), 'utf8');
const src = srcRaw.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
// Точная проверка вызова, а не подстроки: /attack-boss — единственный
// путь атаки босса (удар идёт через надетое оружие), второй путь
// /attack-with-weapon удалён вместе с экраном выбора оружия.
ok("в коде game.js нет вызова apiRequest('/api/game/bosses/attack')",
    !/apiRequest\(\s*['"`]\/api\/game\/bosses\/attack['"`]/.test(src));
ok('единственный путь атаки /attack-boss на месте',
    /apiRequest\(\s*['"`]\/api\/game\/bosses\/attack-boss['"`]/.test(src));
ok('второго пути атаки /attack-with-weapon нет',
    !/apiRequest\(\s*['"`]\/api\/game\/bosses\/attack-with-weapon['"`]/.test(src));
ok('в коде нет вызова `/rating/${type}`', !/apiRequest\(`\/rating\/\$\{type\}`\)/.test(src));
ok('в коде нет /api/achievements/progress', !src.includes('/api/achievements/progress'));
ok('в коде нет /api/achievements/claim', !src.includes('/api/achievements/claim'));

console.log('\n========================================');
console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);