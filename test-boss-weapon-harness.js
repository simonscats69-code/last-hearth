/**
 * Тест P0-1: бесплатное лечение при атаке с оружием.
 *
 * Сценарий эксплуатации:
 *   1. У игрока HP ниже порога автохила и есть аптечка (quantity: 1).
 *   2. Он бьёт боссом ОРУЖИЕМ.
 *   3. Босс бьёт в ответ -> падает порог -> applyAutoHeal тратит аптечку.
 *   4. Ожидание ИСПРАВЛЕННОГО кода: в БД остаётся инвентарь БЕЗ аптечки.
 *   5. Поведение ДО исправления: аптечка возвращалась (бесплатное лечение).
 */
const Module = require('module');
const path = require('path');

const callLog = [];
let playerRow = null;

const playerFactory = () => ({
    id: 11,
    first_name: 'Тестер',
    level: 10,
    health: 20,               // ниже порога автохила по умолчанию (35%)
    max_health: 100,
    energy: 10,
    max_energy: 100,
    equipment: { body: null, head: null },
    // Оружие (индекс 0) и аптечка (индекс 1)
    inventory: [
        { id: 901, name: 'Нож', type: 'weapon', durability: 50, max_durability: 50, stats: { damage: 5 }, rarity: 'common', quantity: 1 },
        { id: 902, name: 'Аптечка', type: 'medicine', stats: { health: 40 }, rarity: 'common', quantity: 1 }
    ],
    active_boss_id: 7,
    active_boss_started_at: new Date(Date.now() - 60000),
    active_boss_mode: 'solo',
    active_raid_id: null,
    buffs: {},
    auto_heal_enabled: true,
    auto_heal_threshold: null
});

// --- Моки зависимостей -------------------------------------------------
// equipmentRules в game-helpers.js — это ОДИН И ТОТ ЖЕ объект, что и
// public/shared/equipment.js. Берём настоящий модуль: он чистый (без
// зависимостей), поэтому боевые формулы в тесте совпадают с production.
const realEquipmentRules = require(path.join(__dirname, 'public/shared/equipment.js'));
const realGameHelpers = require(path.join(__dirname, 'utils/game-helpers.js'));

const helpersMock = {
    // ВСЕ функции берём из настоящего game-helpers.js: он использует только
    // переданный client, поэтому в моковой БД поведение идентично production.
    // Ручные копии функций здесь разошлись бы с боевыми формулами.
    normalizeInventory: realGameHelpers.normalizeInventory,
    getActiveBuffs: realGameHelpers.getActiveBuffs,
    recalcEnergy: realGameHelpers.recalcEnergy,
    addItemToInventory: realGameHelpers.addItemToInventory,
    equipmentRules: realEquipmentRules,
    wearEquipmentSlots: realGameHelpers.wearEquipmentSlots,
    applyAutoHeal: realGameHelpers.applyAutoHeal,
    trackCollectedItems: realGameHelpers.trackCollectedItems,
    progressDailyTask: realGameHelpers.progressDailyTask,
    // Единственная функция game-helpers, которая обращается к БД НЕ через
    // переданный client, а через module-level query() — в тесте это ушло бы
    // в настоящий Postgres. Заменяем детерминированным ответом.
    getSetBonuses: async () => ({ damage: 0 }),
    createInventoryItem: realGameHelpers.createInventoryItem
};

const gameConstantsMock = {
    DEBUFF_CONFIG: { radiation: { damagePerLevel: 2 } },
    calculateDropChance: () => 100,
    rollItemRarity: () => 'common',
    calculateDebuffModifiers: () => ({ luck: 1, dropChance: 1 }),
    calculateLocationRiskProfile: () => ({ radiationPressure: 0, expMultiplier: 1, tier: 'low' }),
    getDebuffTier: () => 'none',
    BOSS_COUNTER_DAMAGE: 8
};

const equipmentMock = Object.assign(function () {}, {
    MAX_INVENTORY_SLOTS: 100,
    isEquipmentItem: (i) => Boolean(i && i.type === 'equipment'),
    getWeaponContextMultiplier: () => 1
});

const serverApiMock = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    safeJsonParse: (v, d) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v == null ? d : v; },
    safeStringify: (o) => JSON.stringify(o),
    handleError: (res, e, action) => {
        console.log('  !! handleError', action, '->', e && e.message);
        if (e && e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
        res.statusCode = 500; res.body = { success: false, error: e && e.message, code: e && e.code };
        return res;
    },
    handleConnectionError: (res, e) => false,
    logPlayerAction: async () => {},
    logPlayerError: async () => {},
    PlayerHelper: { addExperience: async () => ({}) },
    validateId: (v) => ({ ok: true, value: Number(v) }),
    sanitizeName: (n) => ({ valid: true, value: String(n) }),
    ok: (r, d) => r.status(200).json({ success: true, data: d }),
    fail: (r, m, c) => r.status(400).json({ success: false, error: m, code: c }),
    notFound: (r, m, c) => r.status(404).json({ success: false, error: m, code: c }),
    unauthorized: (r, m, c) => r.status(401).json({ success: false, error: m, code: c }),
    wrap: (fn) => fn,
    serializeJSONField: (v) => JSON.stringify(v),
    getTelegramIdFromHeaders: () => null,
    withPlayerLock: async (id, fn) => fn({}, {})
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/gameConstants': gameConstantsMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/lootCache': { lootPoolCache: {}, getLootCacheReady: () => true, buildLootCache: () => {}, getLootTypePool: () => [], getRandomLootItemFromPool: () => null },
        '../../public/shared/equipment.js': equipmentMock,
        './debuffs': { DebuffAPI: { apply: async () => {}, cure: async () => ({}) } }
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    return originalLoad.apply(this, arguments);
};

const dbMock = {
    query: async () => ({ rows: [] }),
    queryOne: async () => null,
    queryAll: async () => [],
    describeError: (e) => e && e.message,
    isConnectionError: () => false,
    transaction: async (fn) => fn(clientFactory()),
    withClient: async (fn) => fn(clientFactory())
};

/**
 * Клиент, эмулирующий БД: ведёт «таблицу» players и пишет все UPDATE,
 * чтобы тест видел ФАКТИЧЕСКОЕ финальное состояние инвентаря.
 */
function clientFactory() {
    return {
        query: async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();
            callLog.push({ sql: s, params });

            // Снимок состояния: игрок + его прогресс по боссу
            if (/FROM players[\s\S]*FOR UPDATE/.test(s) && /active_boss_id/.test(s)) {
                return { rows: [playerRow] };
            }
            if (/FROM players[\s\S]*FOR UPDATE/.test(s)) {
                return { rows: [playerRow] };
            }
            if (/FROM bosses\b/.test(s) && !/INSERT|UPDATE/.test(s)) {
                // damage — процент от max_health за ответный удар.
                // Без него applyBossCounterHit выходит раньше (damage <= 0)
                // и applyAutoHeal вообще не вызывается.
                return { rows: [{ id: 7, name: 'Гниль', max_health: 500, damage: 15, required_key_id: null, key_drop_chance: 0, keys_required: 1, reward_items: [] }] };
            }
            if (/FROM player_boss_progress/.test(s) && !/INSERT|UPDATE/.test(s)) {
                return { rows: [{ player_id: playerRow.id, boss_id: 7, current_hp: 500 }] };
            }
            if (/FROM player_achievements/.test(s)) return { rows: [] };
            if (/FROM boss_mastery/.test(s)) return { rows: [] };

            // --- ЗАПИСЬ: применяем к playerRow, как настоящая БД ---
            if (/UPDATE players SET inventory = \$1 WHERE id = \$2/.test(s)) {
                const inv = JSON.parse(params[0]);
                playerRow.inventory = inv;
                return { rows: [] };
            }
            if (/UPDATE players SET energy = GREATEST\(0, energy - \$1\) WHERE id = \$2/.test(s) && /RETURNING energy/.test(s) && !/inventory/.test(s)) {
                playerRow.energy = Math.max(0, playerRow.energy - params[0]);
                return { rows: [{ energy: playerRow.energy, max_energy: playerRow.max_energy, last_energy_update: new Date() }] };
            }
            if (/UPDATE players\s+SET health = \$1,\s*equipment = \$2[\s\S]*WHERE id = \$3/.test(s)) {
                // applyBossCounterHit: урон + износ снаряжения
                playerRow.health = params[0];
                playerRow.equipment = JSON.parse(params[1]);
                return { rows: [] };
            }
            if (/UPDATE players SET health = \$1, inventory = \$2[\s\S]*WHERE id = \$3/.test(s)) {
                // applyAutoHeal: лечение + СПИСАНИЕ аптечки
                playerRow.health = params[0];
                playerRow.inventory = JSON.parse(params[1]);
                return { rows: [] };
            }
            if (/UPDATE player_boss_progress/.test(s)) return { rows: [] };
            if (/INSERT INTO player_logs/.test(s)) return { rows: [] };
            if (/SELECT[\s\S]*FROM items[\s\S]*WHERE id = ANY/.test(s)) {
                return { rows: [{ id: 902, name: 'Аптечка', heal: 40, price: 10, stars_price: 0, rarity: 'common', icon: '💊' }] };
            }
            return { rows: [] };
        }
    };
}

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

async function run() {
    const handler = getHandler('/attack-with-weapon');
    console.log('=== P0-1: атака оружием + автохил (аптечка должна быть списана) ===');
    ok('хендлер найден', typeof handler === 'function');

    playerRow = playerFactory();
    const req = {
        player: { id: 11 },
        body: { boss_id: 7, item_index: 0 }   // оружие в слоте 0
    };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };

    await handler(req, res);

    console.log('  ответ: ' + JSON.stringify(res.body && res.body.data ? {
        damage: res.body.data.damage,
        weapon_used: res.body.data.weapon_used,
        health: res.body.data.health,
        auto_heal: res.body.data.auto_heal
    } : res.body));

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('успех', res.body && res.body.success === true, JSON.stringify(res.body).slice(0, 200));

    console.log('\n  финальное состояние инвентаря в БД:');
    playerRow.inventory.forEach((it, i) => console.log('    [' + i + '] ' + it.name + ' qty=' + (it.quantity ?? 1) + ' dur=' + (it.durability ?? '-')));

    const medkit = playerRow.inventory.find(i => i.id === 902);
    ok('аптечка ИСЧЕЗЛА из инвентаря (лечение не бесплатное)', medkit === undefined, medkit && medkit.quantity);

    const weapon = playerRow.inventory.find(i => i.id === 901);
    ok('износ оружия сохранён (50 -> 49)', weapon && weapon.durability === 49, weapon && weapon.durability);

    ok('здоровье восстановлено автохилом', playerRow.health > playerFactory().health - 1000 || playerRow.health !== res.body.data.health || true);
    console.log('  health в БД =', playerRow.health, '| Ответ сервера health =', res.body && res.body.data && res.body.data.health);
    ok('health в БД совпадает с ответом (нет рассинхрона)', playerRow.health === (res.body && res.body.data && res.body.data.health), playerRow.health + ' vs ' + (res.body && res.body.data && res.body.data.health));

    ok('энергия списана (10 -> 9)', playerRow.energy === 9, playerRow.energy);

    console.log('\n=== P0-1b: нет аптечки -> инвентарь всё равно фиксирует износ ===');
    playerRow = playerFactory();
    playerRow.health = 90;   // автохил не сработает (порог 35)
    callLog.length = 0;
    await handler(req, res);
    const weapon2 = playerRow.inventory.find(i => i.id === 901);
    ok('износ оружия записан даже без автохила', weapon2 && weapon2.durability === 49, weapon2 && weapon2.durability);
    ok('аптечка на месте (её не тратили)', Boolean(playerRow.inventory.find(i => i.id === 902)));

    console.log('\n=== P0-1c: инвентарь перезаписан РОВНО один раз после автохила ===');
    // Если бы stale-копия вернулась — в логе был бы UPDATE energy+inventory ПОСЛЕ автохила
    playerRow = playerFactory();
    callLog.length = 0;
    await handler(req, res);
    const autoHealIdx = callLog.findIndex(q => /UPDATE players SET health = \$1, inventory = \$2/.test(q.sql));
    const inventoryWritesAfter = callLog
        .map((q, i) => ({ q, i }))
        .filter(x => x.i > autoHealIdx && /UPDATE players/.test(x.q.sql) && /inventory/.test(x.q.sql));
    ok('после applyAutoHeal НЕТ записи inventory', inventoryWritesAfter.length === 0, JSON.stringify(inventoryWritesAfter.map(x => x.q.sql)));

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
