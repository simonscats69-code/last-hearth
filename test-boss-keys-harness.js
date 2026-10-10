/**
 * Тест P1-6: ошибка БД в getKeysRequiredForBoss не должна молча
 * превращаться в «нужен 1 ключ».
 *
 * До исправления `catch { return 1; }` гасил любой сбой запроса:
 *   - spendBossKeys недосписывал ключи;
 *   - raid/:id/join пускал игрока с меньшим числом ключей, чем требуется.
 *
 * Проверяем через реальные роуты: /bosses/start (spendBossKeys) и /raid/join.
 */
const Module = require('module');
const path = require('path');

let failOnKeysQuery = false;      // эмуляция падения БД
let keysRequiredValue = 3;        // босс требует 3 ключа
let keyQuantity = 5;              // у игрока 5 ключей

const db = {
    players: [],
    bosses: [],
    boss_keys: [],
    raid_progress: [],
    boss_sessions: []
};

function reset() {
    db.players = [{ id: 1, first_name: 'Тестер', health: 100, max_health: 100, energy: 50, max_energy: 100,
                    equipment: '{}', inventory: '[]', active_boss_id: null, active_boss_mode: null,
                    active_boss_started_at: null, active_raid_id: null, buffs: {} }];
    db.bosses = [
        { id: 2, name: 'Босс2', max_health: 500, icon: 'a', required_key_id: null, key_drop_chance: 0, keys_required: 3 },
        { id: 1, name: 'Босс1', max_health: 300, icon: 'b', required_key_id: null, key_drop_chance: 0, keys_required: 1 }
    ];
    db.boss_keys = [{ player_id: 1, boss_id: 1, quantity: 5 }];
    db.raid_progress = [];
    db.boss_sessions = [];
    failOnKeysQuery = false;
    keysRequiredValue = 3;
    keyQuantity = 5;
}

const log = [];
const loggerCalls = [];   // все вызовы logger.{warn,error} — проверяем, что сбой БД не съеден молча

function clientFactory() {
    return {
        query: async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();
            log.push({ sql: s, params });

            // keys_required с возможным сбоем
            if (/^SELECT keys_required FROM bosses WHERE id = \$1$/.test(s)) {
                if (failOnKeysQuery) {
                    const err = new Error('connection terminated unexpectedly');
                    err.code = '08006';
                    throw err;
                }
                const b = db.bosses.find(x => x.id === params[0]);
                return { rows: b ? [{ keys_required: keysRequiredValue }] : [] };
            }

            if (/FROM players[\s\S]*FOR UPDATE/.test(s)) {
                const p = db.players[0];
                return { rows: p ? [p] : [] };
            }
            if (/^SELECT \* FROM bosses WHERE id = \$1/.test(s) || /FROM bosses\s+WHERE id = \$1/.test(s)) {
                if (failOnKeysQuery) {
                    const err = new Error('connection terminated unexpectedly');
                    err.code = '08006';
                    throw err;
                }
                const b = db.bosses.find(x => x.id === params[0]);
                return { rows: b ? [b] : [] };
            }
            if (/SELECT quantity FROM boss_keys/.test(s)) {
                if (failOnKeysQuery) { const e = new Error('db down'); e.code = '08006'; throw e; }
                const k = db.boss_keys.find(x => x.player_id === params[0] && x.boss_id === params[1]);
                return { rows: k ? [{ quantity: k.quantity }] : [] };
            }
            if (/UPDATE boss_keys\s+SET quantity = quantity - \$1/.test(s)) {
                // params = [amount, playerId, bossId]
                const amount = params[0], pid = params[1], bid = params[2];
                const k = db.boss_keys.find(x => x.player_id === pid && x.boss_id === bid && x.quantity >= amount);
                if (!k) return { rows: [], rowCount: 0 };
                k.quantity -= amount;
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO player_boss_progress/.test(s)) return { rows: [] };
            if (/DELETE FROM raid_progress/.test(s)) return { rows: [], rowCount: 0 };
            if (/FROM raid_progress rp[\s\S]*JOIN bosses b ON b\.id = rp\.boss_id[\s\S]*WHERE rp\.id = \$1/.test(s)) {
                if (failOnKeysQuery) { const e = new Error('db down'); e.code = '08006'; throw e; }
                const r = db.raid_progress.find(x => x.id === Number(params[0]) && x.is_active && x.is_raid
                    && new Date(x.expires_at).getTime() > Date.now());
                if (!r) return { rows: [] };
                const b = db.bosses.find(x => x.id === r.boss_id);
                return { rows: [{ id: r.id, boss_id: r.boss_id, current_health: r.current_health, max_health: r.max_health,
                    expires_at: r.expires_at, boss_name: b ? b.name : 'Босс', icon: b ? b.icon : '' }] };
            }
            if (/INSERT INTO raid_progress/.test(s)) {
                const raid = { id: db.raid_progress.length + 1, boss_id: params[0], current_health: params[1],
                    max_health: params[2], expires_at: params[3], is_active: true, is_raid: true,
                    leader_id: params[4], leader_name: params[5] };
                db.raid_progress.push(raid);
                return { rows: [{ id: raid.id }] };
            }
            if (/INSERT INTO boss_sessions/.test(s)) return { rows: [] };
            if (/UPDATE players\s+SET active_boss_id/.test(s)) {
                const p = db.players[0];
                p.active_boss_id = params[0];
                if (params[1] !== undefined) p.active_raid_id = params[1];
                return { rows: [], rowCount: 1 };
            }
            if (/UPDATE players[\s\S]*is_in_battle/.test(s)) return { rows: [], rowCount: 1 };
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
    isConnectionError: (e) => e && (e.code === '08006' || e.code === 'ECONNREFUSED' || /connection/i.test(e.message || '')),
    transaction: async (fn) => fn(clientFactory()),
    withClient: async (fn) => fn(clientFactory())
};

const realEquipment = require(path.join(__dirname, 'public/shared/equipment.js'));
const realHelpers = require(path.join(__dirname, 'utils/game-helpers.js'));

const helpersMock = {
    normalizeInventory: realHelpers.normalizeInventory,
    getActiveBuffs: () => ({}),
    recalcEnergy: realHelpers.recalcEnergy,
    addItemToInventory: realHelpers.addItemToInventory,
    equipmentRules: realEquipment,
    wearEquipmentSlots: realHelpers.wearEquipmentSlots,
    applyAutoHeal: realHelpers.applyAutoHeal,
    trackCollectedItems: realHelpers.trackCollectedItems,
    progressDailyTask: realHelpers.progressDailyTask,
    getSetBonuses: async () => ({}),
    createInventoryItem: realHelpers.createInventoryItem
};

const serverApiMock = {
    logger: {
        info() {},
        warn(...a) { loggerCalls.push('warn'); },
        error(...a) { loggerCalls.push('error: ' + String(a[0] && a[0].message || a[0] || '').slice(0, 80)); },
        debug() {}
    },
    safeJsonParse: (v, d) => (typeof v === 'string' ? JSON.parse(v) : (v ?? d)),
    safeStringify: JSON.stringify,
    logPlayerAction: async () => {},
    logPlayerError: async () => {},
    handleError: (res, e, action) => {
        const statusCode = e.statusCode || 500;
        const rawCode = typeof e.code === 'string' ? e.code : '';
        const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
        const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
        const isClient = statusCode >= 400 && statusCode < 500;
        log.push({ __handleError: true, statusCode, code, internal: e.message });
        return res.status(statusCode).json({ success: false, error: isClient ? e.message : 'Внутренняя ошибка сервера', code });
    },
    handleConnectionError: (res, e) => {
        if (e && (e.code === '08006')) {
            log.push({ __connError: true });
            return res.status(503).json({ success: false, error: 'База данных недоступна', code: 'DB_UNAVAILABLE' });
        }
        return false;
    },
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
    SOLO_FIGHT_DURATION_MS: 3600000,
    MASS_FIGHT_DURATION_MS: 3600000
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../db/database': dbMock,
        '../../db/database': dbMock,
        './serverApi': serverApiMock,
        '../../utils/serverApi': serverApiMock,
        '../utils/gameConstants': gameConstantsMock,
        '../../utils/gameConstants': gameConstantsMock,
        './gameConstants': gameConstantsMock,
        '../../utils/lootCache': { lootPoolCache: {}, getLootCacheReady: () => false, getLootTypePool: () => [], getRandomLootItemFromPool: () => null }
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    if (request === './debuffs') return { DebuffAPI: { apply: async () => {}, cure: async () => ({}) } };
    if (request.includes('shared/equipment.js')) return realEquipment;
    if (request.includes('db/players')) return { addExperienceWithLevelUp: async () => ({}) };
    return originalLoad.apply(this, arguments);
};

const router = require(path.join(__dirname, 'routes/game/bosses.js'));
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

const makeReqRes = (body, params) => ({
    req: { player: { id: 1, first_name: 'Тестер' }, body, params: params || {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

async function run() {
    const startSolo = getHandler('/start');
    const raidJoin = getHandler('/raid/:id/join');
    console.log('=== P1-6: ошибка БД не молчит ===');
    ok('хендлер /bosses/start найден', typeof startSolo === 'function');
    ok('хендлер /raid/join найден', typeof raidJoin === 'function');

    // --- Норма: боссу 2 нужно 3 ключа от босса 1 ---
    console.log('\n  Нормальный режим (боссу 2 нужно 3 ключа):');
    reset();
    keysRequiredValue = 3;
    keyQuantity = 5;
    let { req, res } = makeReqRes({ boss_id: 2 });
    await startSolo(req, res);
    console.log('    /start resp:', res.statusCode, JSON.stringify(res.body).slice(0, 220));
    ok('с 5 ключами старт разрешён', res.statusCode === 200, res.statusCode + ' ' + (res.body && res.body.code));
    ok('списано ровно 3 ключа', db.boss_keys[0].quantity === 2, db.boss_keys[0].quantity);

    console.log('\n  Нормальный режим, но ключей мало:');
    reset();
    keysRequiredValue = 3;
    db.boss_keys[0].quantity = 2;   // реально кладём 2 ключа в «БД»
    ({ req, res } = makeReqRes({ boss_id: 2 }));
    await startSolo(req, res);
    ok('с 2 ключами старт запрещён', res.statusCode === 400, res.statusCode);
    ok('код INSUFFICIENT_KEYS', res.body && res.body.code === 'INSUFFICIENT_KEYS', res.body && res.body.code);
    ok('keys_required=3 в ответе', res.body && res.body.keys_required === 3, res.body && res.body.keys_required);
    ok('ключи не тронуты', db.boss_keys[0].quantity === 2, db.boss_keys[0].quantity);

    // --- СБОЙ БД: ключи НЕ должны недосписываться ---
    console.log('\n  СБОЙ БД при чтении keys_required:');
    reset();
    failOnKeysQuery = true;   // БД падает
    keyQuantity = 5;
    ({ req, res } = makeReqRes({ boss_id: 2 }));
    await startSolo(req, res);

    const errLog = log.find(l => l.__handleError);
    ok('НЕ 200: операция не проходит', res.statusCode !== 200, res.statusCode);
    ok('ошибка видна (500/502/503)', res.statusCode >= 500, res.statusCode);
    ok('ключи НЕ списаны при сбое', db.boss_keys[0].quantity === 5, db.boss_keys[0].quantity);
    ok('ответ — ошибка сервера, а не успех',
        res.body && (res.body.success === false || res.body.success === undefined),
        JSON.stringify(res.body).slice(0, 100));
    ok('сбой БД попал в логгер (не съеден молча)', loggerCalls.length > 0, loggerCalls.join(','));
    ok('игрок не начал бой', db.players[0].active_boss_id === null, db.players[0].active_boss_id);

    // --- СБОЙ БД в raid/join: вход с неверным числом ключей ---
    console.log('\n  СБОЙ БД в /raid/join:');
    reset();
    failOnKeysQuery = true;
    // Готовим активный рейд на босс 2 (leader = игрок 1)
    db.raid_progress.push({ id: 1, boss_id: 2, current_health: 500, max_health: 500,
        started_at: new Date(), expires_at: new Date(Date.now() + 3600000), is_active: true, is_raid: true,
        leader_id: 1, leader_name: 'Тестер' });
    log.length = 0;
    ({ req, res } = makeReqRes({}, { id: '1' }));
    await raidJoin(req, res);
    console.log('    raid/join resp:', res.statusCode, JSON.stringify(res.body).slice(0, 160));
    ok('рейд не присоединён при сбое БД', res.statusCode !== 200, res.statusCode);
    ok('код ошибки верхнего уровня (не success)', res.body && res.body.success === false, JSON.stringify(res.body));
    ok('ошибка не проглочена молча (есть в логгере)', loggerCalls.length > 0, loggerCalls.join(','));

    // --- Босс без строки (не ошибка): fallback = 1 ---
    console.log('\n  Босс не найден — это НЕ ошибка, fallback = 1:');
    reset();
    failOnKeysQuery = false;
    keyQuantity = 1;
    ({ req, res } = makeReqRes({ boss_id: 999 }));
    await startSolo(req, res);
    ok('несуществующий босс -> 404', res.statusCode === 404, res.statusCode + ' ' + (res.body && res.body.code));

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
