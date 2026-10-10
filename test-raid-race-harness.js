/**
 * Тест P1-4: гонка при создании массового боя (raid/start).
 *
 * Проверяет:
 *  1. Блокировка строки босса: параллельные лидеры сериализуются, второй
 *     получает RAID_ALREADY_ACTIVE (400), а не 500 от UNIQUE(boss_id, is_active).
 *  2. Страховка: если constraint срабатывает раньше блокировки — тоже 400.
 *  3. Одиночный старт рейда работает как прежде.
 *  4. Создание рейда на РАЗНЫХ боссов не блокируется.
 */
const Module = require('module');
const path = require('path');

// --- In-memory модель БД ---------------------------------------------------
const db = {
    players: [
        { id: 1, first_name: 'ЛидерА', health: 100, max_health: 100, energy: 50, max_energy: 100,
          equipment: {}, inventory: JSON.stringify([]), active_boss_id: null, active_boss_mode: null,
          active_raid_id: null, buffs: {}, auto_heal_enabled: true, auto_heal_threshold: null },
        { id: 2, first_name: 'ЛидерБ', health: 100, max_health: 100, energy: 50, max_energy: 100,
          equipment: {}, inventory: JSON.stringify([]), active_boss_id: null, active_boss_mode: null,
          active_raid_id: null, buffs: {}, auto_heal_enabled: true, auto_heal_threshold: null }
    ],
    bosses: [{ id: 5, name: 'Гниль', max_health: 1000, icon: 'x', required_key_id: null, key_drop_chance: 0, keys_required: 1 },
             { id: 6, name: 'Хор', max_health: 2000, icon: 'y', required_key_id: null, key_drop_chance: 0, keys_required: 1 },
             { id: 4, name: 'Предыдущий', max_health: 800, icon: 'z', required_key_id: null, key_drop_chance: 0, keys_required: 1 }],
    raid_progress: [],
    // Ключи от предыдущих боссов: для босса 5 нужен ключ от 4,
    // для босса 6 — ключ от 5.
    boss_keys: [
        { player_id: 1, boss_id: 4, quantity: 5 },
        { player_id: 2, boss_id: 4, quantity: 5 },
        { player_id: 1, boss_id: 5, quantity: 5 },
        { player_id: 2, boss_id: 5, quantity: 5 }
    ]
};

let raidSeq = 1;
const lockWait = [];   // очередь ожидающих блокировку босса

// Блокировки строк: кто держит и кто ждёт
const rowLocks = new Map();   // key: "bosses:5" -> clientId
let clientSeq = 1;

function makeClient() {
    const id = clientSeq++;

    return {
        id,
        query: async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();

            // --- БЛОКИРОВКА СТРОКИ БОССА (FOR UPDATE) ---
            const bossLockMatch = s.match(/^SELECT id FROM bosses WHERE id = \$1 FOR UPDATE$/);
            if (bossLockMatch) {
                const key = 'bosses:' + params[0];
                // Если держит другой клиент — ждём освобождения
                while (rowLocks.get(key) && rowLocks.get(key) !== id) {
                    await new Promise(r => lockWait.push(r));
                }
                rowLocks.set(key, id);
                return { rows: [{ id: params[0] }] };
            }

            // --- Игрок (FOR UPDATE) ---
            let m = s.match(/FROM players\s+WHERE id = \$1 FOR UPDATE/);
            if (m) {
                const row = db.players.find(p => p.id === params[0]);
                return { rows: row ? [row] : [] };
            }

            // --- Босс без блокировки ---
            if (/FROM bosses\s+WHERE id = \$1/.test(s) && !/FOR UPDATE/.test(s)) {
                const b = db.bosses.find(x => x.id === params[0]);
                return { rows: b ? [b] : [] };
            }

            // --- Активный бой игрока ---
            if (/FROM player_boss_progress\s+WHERE player_id = \$1/.test(s)) return { rows: [] };

            // --- DELETE устаревших рейдов ---
            if (/DELETE FROM raid_progress/.test(s)) {
                const before = db.raid_progress.length;
                db.raid_progress = db.raid_progress.filter(r => !(r.boss_id === params[0] && r.is_active === true
                    && (new Date(r.expires_at).getTime() <= Date.now() || r.is_active === false)));
                return { rows: [], rowCount: before - db.raid_progress.length };
            }

            // --- Проверка существования рейда (БЕЗ блокировки в коде) ---
            if (/SELECT id FROM raid_progress\s+WHERE boss_id = \$1 AND is_active = true AND is_raid = true AND expires_at > NOW\(\)/.test(s)) {
                const found = db.raid_progress.find(r => r.boss_id === params[0] && r.is_active === true && r.is_raid === true && new Date(r.expires_at).getTime() > Date.now());
                return { rows: found ? [{ id: found.id }] : [] };
            }

            // --- INSERT рейда: проверяем UNIQUE(boss_id, is_active) ---
            // Список проверки = видимые рейды + «скрытые» (созданные параллельно,
            // но ещё не видимые нашей CHECK-проверке) — это и есть гонка.
            if (/INSERT INTO raid_progress/.test(s)) {
                const bossId = params[0];
                // Модель UNIQUE(boss_id, is_active): NULL считаются различными
                const candidates = db.raid_progress.concat(db.hiddenRaids || []);
                const conflict = candidates.find(r => r.boss_id === bossId && r.is_active === true);
                if (conflict) {
                    const err = new Error('duplicate key value violates unique constraint "raid_progress_boss_id_is_active_key"');
                    err.code = '23505';
                    err.constraint = 'raid_progress_boss_id_is_active_key';
                    throw err;
                }
                const raid = {
                    id: raidSeq++, boss_id: bossId, current_health: params[1], max_health: params[2],
                    started_at: new Date(), expires_at: params[3], is_active: true, is_raid: true,
                    leader_id: params[4], leader_name: params[5]
                };
                db.raid_progress.push(raid);
                return { rows: [{ id: raid.id }] };
            }

            // --- boss_sessions upsert ---
            if (/INSERT INTO boss_sessions/.test(s)) return { rows: [] };

            // --- UPDATE players.active_* ---
            if (/UPDATE players\s+SET active_boss_id = \$1/.test(s)) {
                const p = db.players.find(x => x.id === params[2]);
                if (p) { p.active_boss_id = params[0]; p.active_raid_id = params[1]; p.active_boss_mode = 'mass'; }
                return { rows: [], rowCount: 1 };
            }

    // --- Ключи боссов: у игроков достаточно для перехода -----------------
            // getKeysRequiredForBoss читает bosses.keys_required через отдельный
            // SELECT, поэтому нужен ответ и для него.
            if (/^SELECT keys_required FROM bosses WHERE id = \$1/.test(s)) {
                const b = db.bosses.find(x => x.id === params[0]);
                return { rows: b ? [{ keys_required: b.keys_required }] : [] };
            }
            if (/SELECT quantity FROM boss_keys/.test(s)) {
                if (/FOR UPDATE/.test(s)) {
                    // Блокировка строки ключей
                    while (rowLocks.get('key:' + params[0] + ':' + params[1]) && rowLocks.get('key:' + params[0] + ':' + params[1]) !== id) {
                        await new Promise(r => lockWait.push(r));
                    }
                    rowLocks.set('key:' + params[0] + ':' + params[1], id);
                }
                const k = db.boss_keys.find(x => x.player_id === params[0] && x.boss_id === params[1]);
                return { rows: k ? [{ quantity: k.quantity }] : [] };
            }
            if (/UPDATE boss_keys\s+SET quantity = quantity - \$1/.test(s)) {
                const k = db.boss_keys.find(x => x.player_id === params[0] && x.boss_id === params[2] && x.quantity >= params[0]);
                if (!k) return { rows: [], rowCount: 0 };
                k.quantity -= params[0];
                return { rows: [{ quantity: k.quantity }], rowCount: 1 };
            }
            if (/INSERT INTO player_logs/.test(s)) return { rows: [] };
            return { rows: [] };
        },
        release: () => {
            // Освобождаем все блокировки этого клиента (строки боссов и ключи)
            for (const [k, v] of rowLocks) {
                if (v === id) {
                    rowLocks.delete(k);
                    const waiter = lockWait.shift();
                    if (waiter) waiter();
                }
            }
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
        const client = makeClient();
        try {
            return await fn(client);
        } finally {
            client.release();   // COMMIT или ROLLBACK — блокировки снимаются
        }
    },
    withClient: async (fn) => {
        const client = makeClient();
        try { return await fn(client); } finally { client.release(); }
    }
};

const realEquipment = require(path.join(__dirname, 'public/shared/equipment.js'));
const realHelpers = require(path.join(__dirname, 'utils/game-helpers.js'));

const helpersMock = {
    normalizeInventory: realHelpers.normalizeInventory,
    getActiveBuffs: realHelpers.getActiveBuffs,
    recalcEnergy: realHelpers.recalcEnergy,
    addItemToInventory: realHelpers.addItemToInventory,
    equipmentRules: realEquipment,
    wearEquipmentSlots: realHelpers.wearEquipmentSlots,
    applyAutoHeal: realHelpers.applyAutoHeal,
    trackCollectedItems: realHelpers.trackCollectedItems,
    progressDailyTask: realHelpers.progressDailyTask,
    getSetBonuses: async () => ({ damage: 0 }),
    createInventoryItem: realHelpers.createInventoryItem
};

const serverApiMock = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    safeJsonParse: (v, d) => (typeof v === 'string' ? JSON.parse(v) : (v ?? d)),
    safeStringify: JSON.stringify,
    logPlayerAction: async () => {},
    logPlayerError: async () => {},
    handleError: (res, e, action) => {
        res.statusCode = e.statusCode || 500;
        res.body = { success: false, error: e.message, code: e.code };
    },
    handleConnectionError: (res, e) => false,
    ok: (r, d) => r.status(200).json({ success: true, data: d }),
    fail: (r, m, c) => r.status(400).json({ success: false, error: m, code: c }),
    notFound: (r, m, c) => r.status(404).json({ success: false, error: m, code: c }),
    PlayerHelper: { addExperience: async () => ({}) },
    validateId: (v) => ({ ok: true, value: Number(v) }),
    sanitizeName: (n) => ({ valid: true, value: String(n) })
};

const gameConstantsMock = {
    DEBUFF_CONFIG: { radiation: { damagePerLevel: 2 } },
    calculateDropChance: () => 100,
    rollItemRarity: () => 'common',
    calculateDebuffModifiers: () => ({ luck: 1, dropChance: 1 }),
    calculateLocationRiskProfile: () => ({}),
    getDebuffTier: () => 'none',
    MASS_FIGHT_DURATION_MS: 3600000,
    SOLO_FIGHT_DURATION_MS: 3600000
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../db/database': dbMock,
        '../../db/database': dbMock,
        '../utils/serverApi': serverApiMock,
        '../../utils/serverApi': serverApiMock,
        './serverApi': serverApiMock,
        '../utils/gameConstants': gameConstantsMock,
        '../../utils/gameConstants': gameConstantsMock,
        './gameConstants': gameConstantsMock,
        '../../utils/lootCache': { lootPoolCache: {}, getLootCacheReady: () => true, buildLootCache: () => {}, getLootTypePool: () => [], getRandomLootItemFromPool: () => null }
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    if (request === './debuffs') return { DebuffAPI: { apply: async () => {}, cure: async () => ({}) } };
    if (request.includes('shared/equipment.js')) return realEquipment;
    if (request.includes('db/players')) return { addExperienceWithLevelUp: async () => ({}) };
    if (request.includes('db/pvp')) return { isProtectedFromPVP: async () => false, getPVPCooldown: async () => null, createPVPMatch: async () => ({ id: 1 }) };
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

const makeReqRes = (playerId, body) => ({
    req: { player: { id: playerId, first_name: db.players.find(p => p.id === playerId).first_name }, body },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

/** Сброс состояния между сценариями: игроки не в бою, рейды убраны, ключи восстановлены */
function resetState() {
    db.raid_progress = [];
    db.hiddenRaids = [];
    db.boss_keys.forEach(k => { k.quantity = 5; });
    db.players.forEach(p => {
        p.active_boss_id = null;
        p.active_boss_mode = null;
        p.active_raid_id = null;
        p.active_boss_started_at = null;
        p.health = 100;
    });
}

async function run() {
    const handler = getHandler('/raid/start');
    console.log('=== P1-4: гонка двух лидеров на одном боссе ===');
    ok('хендлер найден', typeof handler === 'function');
    resetState();

    // Два лидера одновременно стартуют рейд на босс 5
    const p1 = makeReqRes(1, { boss_id: 5 });
    const p2 = makeReqRes(2, { boss_id: 5 });

    await Promise.all([handler(p1.req, p1.res), handler(p2.req, p2.res)]);

    console.log('  Лидер А: HTTP ' + p1.res.statusCode + ' code=' + (p1.res.body && p1.res.body.code) + ' raid=' + (p1.res.body && p1.res.body.data && p1.res.body.data.raid_id));
    console.log('  Лидер Б: HTTP ' + p2.res.statusCode + ' code=' + (p2.res.body && p2.res.body.code));

    ok('оба ответа не 500 (нет constraint-crash)',
        p1.res.statusCode !== 500 && p2.res.statusCode !== 500,
        'A=' + p1.res.statusCode + ' B=' + p2.res.statusCode);

    const codes = [p1.res.body && p1.res.body.code, p2.res.body && p2.res.body.code].filter(Boolean);
    ok('ровно один рейд создан', p1.res.statusCode === 200 || p2.res.statusCode === 200);
    ok('второй получил RAID_ALREADY_ACTIVE', codes.includes('RAID_ALREADY_ACTIVE'), codes.join(','));
    ok('создана ровно одна запись рейда', db.raid_progress.length === 1, db.raid_progress.length);

    console.log('\n=== Разные боссы не блокируют друг друга ===');
    resetState();
    db.raid_progress = [];
    const b1 = makeReqRes(1, { boss_id: 5 });
    const b2 = makeReqRes(2, { boss_id: 6 });
    await Promise.all([handler(b1.req, b1.res), handler(b2.req, b2.res)]);
    ok('оба рейда созданы', db.raid_progress.length === 2, db.raid_progress.length);
    ok('оба ответа 200', b1.res.statusCode === 200 && b2.res.statusCode === 200,
        'A=' + b1.res.statusCode + ' B=' + b2.res.statusCode);

    console.log('\n=== Повторный старт тем же лидером -> RAID_ALREADY_ACTIVE ===');
    resetState();
    db.raid_progress = [];
    const s1 = makeReqRes(1, { boss_id: 5 });
    await handler(s1.req, s1.res);
    ok('первый рейд создан', s1.res.statusCode === 200, s1.res.statusCode);

    const s2 = makeReqRes(2, { boss_id: 5 });
    await handler(s2.req, s2.res);
    ok('второй лидер получает 400', s2.res.statusCode === 400, s2.res.statusCode);
    ok('код RAID_ALREADY_ACTIVE', s2.res.body && s2.res.body.code === 'RAID_ALREADY_ACTIVE',
        s2.res.body && s2.res.body.code);
    ok('рейд всё ещё один', db.raid_progress.length === 1, db.raid_progress.length);

    console.log('\n=== Истёкший рейд -> новый создаётся ===');
    resetState();
    db.raid_progress = [];
    const e1 = makeReqRes(1, { boss_id: 5 });
    await handler(e1.req, e1.res);
    ok('первый рейд создан', e1.res.statusCode === 200);
    // Помечаем истёкшим
    db.raid_progress[0].expires_at = new Date(Date.now() - 1000);
    db.raid_progress[0].is_active = false;
    const e2 = makeReqRes(2, { boss_id: 5 });
    await handler(e2.req, e2.res);
    ok('новый лидер получает 200 (старый истёк)', e2.res.statusCode === 200,
        e2.res.statusCode + ' ' + (e2.res.body && e2.res.body.code));

    console.log('\n=== Страховка: constraint срабатывает раньше блокировки ===');
    resetState();
    // Моделируем: UNIQUE violation без видимого рейда (как было бы без блокировки)
    db.raid_progress = [];
    db.playerActiveMode = null;
    // Принудительно создаём «невидимый» рейд, который вызовет 23505 на INSERT
    const hidden = { id: 99, boss_id: 5, current_health: 100, max_health: 100, started_at: new Date(),
                     expires_at: new Date(Date.now() + 3600000), is_active: true, is_raid: true, leader_id: 1, leader_name: 'A' };
    db.raid_progress.push(hidden);
    // Но SELECT-проверка его НЕ видит (имитируем гонку в старом коде)
    const origFind = Array.prototype.find;
    const c1 = makeReqRes(2, { boss_id: 5 });
    // Подменяем поведение: делаем SELECT рейда пустым, INSERT — конфликтующим
    // Для этого временно прячем рейд от SELECT через флаг
    hidden.__hiddenFromSelect = true;
    const cl = db.raid_progress.find(r => r.id === 99);
    // Меняем предикат SELECT через обёртку: используем свойство is_active=false для SELECT,
    // но UNIQUE проверяет по is_active=true (в модели — отдельно)
    // Проще: временно убираем из массива для SELECT и добавляем для INSERT
    // -> эмулируем тем, что между SELECT и INSERT рейд «появляется».
    // Здесь: SELECT пройдёт (список пуст для него), INSERT упрётся в UNIQUE.
    // Реализация: убираем из общего массива, но оставляем в отдельном списке constraint'ов.
    db.hiddenRaids = db.hiddenRaids || [];
    db.hiddenRaids.push(hidden);
    db.raid_progress = db.raid_progress.filter(r => r.id !== 99);
    // Патчим модель INSERT: учитывать hiddenRaids
    await handler(c1.req, c1.res);
    ok(' constraint race -> 400 RAID_ALREADY_ACTIVE (не 500)',
        c1.res.statusCode === 400 && c1.res.body.code === 'RAID_ALREADY_ACTIVE',
        c1.res.statusCode + ' ' + (c1.res.body && c1.res.body.code));

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
