/**
 * Проверка целостности данных: только SELECT, ничего не изменяет.
 *
 * Зачем: ссылки между таблицами (боссы → предметы, игроки → снаряжение)
 * накапливаются постепенно, и поломка не всегда видна в логах.
 *
 * Запуск (нужен DATABASE_URL в окружении):
 *     npm run verify:data
 *
 * Скрипт БЕЗОПАСЕН для прода: выполняет только SELECT-запросы.
 */

try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ENOENT') throw e;
}

const { pool, closePool } = require('../db/database');
const equipmentRules = require('../public/shared/equipment.js');

const problems = [];
const warn = (area, message) => problems.push({ area, message });

/** Все имена, которые equipment.js требует от каталога предметов. */
function requiredMaterialNames() {
    const names = new Set();
    for (const v of Object.values(equipmentRules.SCRAP_YIELD_BY_RARITY)) {
        for (const k of Object.keys(v)) names.add(k);
    }
    for (const v of Object.values(equipmentRules.UPGRADE_MATERIAL_BY_RARITY)) names.add(v);
    for (const mod of Object.values(equipmentRules.MODIFICATIONS)) {
        for (const v of Object.values(mod.materials)) names.add(v);
    }
    names.add(equipmentRules.AMMO_ITEM_NAME);
    names.add(equipmentRules.ROCKET_ITEM_NAME);
    return names;
}

/** Шаги 1-3: схема, материалы мастерской, награды боссов. */
async function checkCatalogAndBosses(client) {
    const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tableNames = new Set(tables.rows.map((r) => r.table_name));
    for (const required of ['players', 'items', 'bosses', 'clans', 'boss_keys', 'locations']) {
        if (!tableNames.has(required)) warn('схема', `нет таблицы ${required}`);
    }

    const items = await client.query('SELECT id, name FROM items');
    const itemIds = new Set(items.rows.map((r) => String(r.id)));
    const itemByName = new Map(items.rows.map((r) => [r.name, r]));

    for (const material of requiredMaterialNames()) {
        if (!itemByName.has(material)) {
            warn('материалы', `«${material}» нет в каталоге — мастерская и разбор отдадут 500`);
        }
    }

    const bosses = await client.query('SELECT id, name, reward_items, required_key_id FROM bosses');
    for (const boss of bosses.rows) {
        const loot = Array.isArray(boss.reward_items) ? boss.reward_items : [];
        if (loot.length === 0) warn('боссы', `«${boss.name}»: reward_items пуст — убийство не даст лута`);
        for (const entry of loot) {
            const itemId = String(entry?.item_id ?? entry?.id);
            if (itemId !== 'undefined' && !itemIds.has(itemId)) {
                warn('боссы', `«${boss.name}»: награда ссылается на несуществующий предмет id=${itemId}`);
            }
        }
    }

    // Прогрессия ключей: начиная со второго босса у каждого есть предмет-ключ.
    const sorted = bosses.rows.slice().sort((a, b) => Number(a.id) - Number(b.id));
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].required_key_id === null) {
            warn('ключи', `«${sorted[i].name}» недоступен: нет required_key_id (его даёт босс №${i})`);
        }
    }

    return itemIds;
}

/** Шаги 4-6: фантомные предметы у игроков и значения вне диапазона. */
async function checkPlayers(client, itemIds) {
    const players = await client.query('SELECT id, inventory, equipment FROM players');
    for (const player of players.rows) {
        const inventory = Array.isArray(player.inventory) ? player.inventory : [];
        for (const entry of inventory) {
            if (entry && entry.id != null && !itemIds.has(String(entry.id))) {
                warn('инвентарь', `игрок ${player.id}: предмет с несуществующим id=${entry.id}`);
            }
        }
        const equipment = player.equipment && typeof player.equipment === 'object'
            ? player.equipment
            : {};
        for (const [slot, item] of Object.entries(equipment)) {
            if (item && item.id != null && !itemIds.has(String(item.id))) {
                warn('снаряжение', `игрок ${player.id}, слот ${slot}: несуществующий id=${item.id}`);
            }
        }
    }

    const range = await client.query(`
        SELECT COUNT(*) FILTER (WHERE health < 0)             AS neg_health,
               COUNT(*) FILTER (WHERE energy < 0)             AS neg_energy,
               COUNT(*) FILTER (WHERE health > max_health)    AS hp_over,
               COUNT(*) FILTER (WHERE level < 1)              AS bad_level
          FROM players
    `);
    const r = range.rows[0];
    if (Number(r.neg_health)) warn('значения', `health < 0 у ${r.neg_health} игроков`);
    if (Number(r.neg_energy)) warn('значения', `energy < 0 у ${r.neg_energy} игроков`);
    if (Number(r.hp_over)) warn('значения', `health > max_health у ${r.hp_over} игроков`);
    if (Number(r.bad_level)) warn('значения', `level < 1 у ${r.bad_level} игроков`);

    const stale = await client.query(`
        SELECT COUNT(*) AS n FROM daily_tasks WHERE expires_at < NOW() - INTERVAL '7 days'
    `);
    if (Number(stale.rows[0].n) > 0) {
        warn('таблицы', `daily_tasks: ${stale.rows[0].n} просроченных строк старше 7 дней`);
    }
}

async function main() {
    const client = await pool.connect();
    try {
        const itemIds = await checkCatalogAndBosses(client);
        await checkPlayers(client, itemIds);
    } finally {
        client.release();
        await closePool();
    }
}

main()
    .then(() => {
        if (problems.length === 0) {
            console.log('\n✅ Проблем не найдено.');
            process.exit(0);
        }
        console.log(`\n❌ Найдено проблем: ${problems.length}\n`);
        const byArea = new Map();
        for (const p of problems) {
            if (!byArea.has(p.area)) byArea.set(p.area, []);
            byArea.get(p.area).push(p.message);
        }
        for (const [area, list] of byArea) {
            console.log(`-- ${area} (${list.length}) --`);
            // Одна проблема повторяется для каждого игрока — показываем первые пять.
            for (const m of list.slice(0, 5)) console.log('  ' + m);
            if (list.length > 5) console.log(`  ... и ещё ${list.length - 5}`);
            console.log('');
        }
        process.exit(1);
    })
    .catch((error) => {
        console.error('[verify:data] ОШИБКА:', error.message);
        process.exit(2);
    });