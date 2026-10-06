/**
 * Объединённый модуль игровых хелперов
 * Объединяет функции работы с состоянием игрока и систему достижений
 * 
 * Объединённые модули:
 * - playerState.js (нормализация состояния игрока)
 * - achievements.js (система достижений)
 */

const { query, transaction } = require('../db/database');
// Один импорт вместо двух: и logger, и safeParseJson берутся из того же
// модуля. Два отдельных require одного файла выглядят мелкой безобидной
// правдой, пока однажды не появится третья строка, взятая не оттуда.
const { logger, safeJsonParse } = require('./serverApi');

// ==========================================
// ФУНКЦИИ СОСТОЯНИЯ ИГРОКА (из playerState.js)
// ==========================================

/**
 * Безопасный парсинг JSON с fallback значением.
 * Псевдоним сохранён: в файле сотни вызовов safeParseJson.
 */
const safeParseJson = safeJsonParse;

/**
 * Нормализация инвентаря
 */
function normalizeInventory(value) {
    const parsed = safeParseJson(value, []);

    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    }

    return [];
}

/**
 * Общая нормализация: любой JSON в чистый объект (не массив, не null).
 */
function normalizePlainObject(value) {
    const parsed = safeParseJson(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/**
 * Нормализация stats предмета
 */
function normalizeItemStats(value) {
    return normalizePlainObject(value);
}

/**
 * Построить унифицированный предмет инвентаря
 */
function createInventoryItem(item, options = {}) {
    const source = item && typeof item === 'object' ? item : {};
    const stats = normalizeItemStats(options.stats !== undefined ? options.stats : source.stats);
    const durability = Number(options.durability ?? source.durability ?? 100);
    const rawModifications = options.modifications ?? source.modifications ?? {};
    const modifications = rawModifications && typeof rawModifications === 'object' && !Array.isArray(rawModifications)
        ? { ...rawModifications }
        : {};

    return {
        ...source,
        id: source.id ?? options.id ?? null,
        name: source.name || options.name || 'Предмет',
        type: source.type || options.type || 'misc',
        category: source.category || options.category || source.type || options.type || 'misc',
        rarity: options.rarity || source.rarity || 'common',
        icon: source.icon || options.icon || '📦',
        slot: source.slot || options.slot || null,
        stats,
        damage: Number(options.damage ?? source.damage ?? stats.damage ?? 0),
        defense: Number(options.defense ?? source.defense ?? stats.defense ?? 0),
        heal: Number(options.heal ?? source.heal ?? stats.health ?? stats.health_restore ?? 0),
        rad_removal: Number(options.rad_removal ?? source.rad_removal ?? stats.radiation_cure ?? 0),
        radiation_resist: Number(options.radiation_resist ?? source.radiation_resist ?? stats.radiation_resist ?? 0),
        infection_resist: Number(options.infection_resist ?? source.infection_resist ?? stats.infection_resist ?? 0),
        durability,
        max_durability: Number(options.max_durability ?? source.max_durability ?? 100),
        quantity: Math.max(1, Number(options.quantity ?? source.quantity ?? 1) || 1),
        upgrade_level: Number(options.upgrade_level ?? source.upgrade_level ?? 0),
        modifications
    };
}

/**
 * Нормализация радиации
 */
function normalizeRadiation(value) {
    const parsed = safeParseJson(value, { level: 0 });

    if (typeof parsed === 'number') {
        return {
            level: parsed,
            expires_at: null,
            applied_at: null
        };
    }

    if (parsed && typeof parsed === 'object') {
        return {
            level: Number(parsed.level || 0),
            expires_at: parsed.expires_at || null,
            applied_at: parsed.applied_at || null
        };
    }

    return {
        level: 0,
        expires_at: null,
        applied_at: null
    };
}

/**
 * Нормализация инфекций
 */
function normalizeInfections(value) {
    const parsed = safeParseJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
}

/**
 * Нормализация активных баффов игрока
 */
function normalizePlayerBuffs(value) {
    return normalizePlainObject(value);
}

/**
 * Предметы, которые нельзя продать.
 * Ключи боссов — валюта прогрессии: их нельзя обратить в монеты,
 * иначе можно было бы бесконечно фармить монеты, покупая ключи по кругу.
 */
const NON_SELLABLE_TYPES = new Set(['key']);

/** Доля от цены в магазине, которую игрок получает при продаже */
const SELL_RATE = 0.35;

/** Минимальная цена продажи по редкости (для добычи, у price = 0) */
const SELL_FLOOR_BY_RARITY = {
    common: 3,
    uncommon: 8,
    rare: 20,
    epic: 45,
    legendary: 100
};

/**
 * Посчитать цену продажи одного предмета.
 * Цена берётся из таблицы items по id (не из JSON инвентаря), поэтому
 * подделать стоимость на клиенте невозможно.
 * @param {object|null} dbItem - строка из таблицы items
 * @param {object} inventoryItem - предмет из инвентаря
 * @returns {number} цена за одну штуку
 */
function calculateSellPrice(dbItem, inventoryItem) {
    if (!dbItem) return 0;
    if (NON_SELLABLE_TYPES.has(String(dbItem.type || inventoryItem?.type || ''))) return 0;

    const shopPrice = Number(dbItem.price || 0);
    if (shopPrice > 0) {
        return Math.max(1, Math.floor(shopPrice * SELL_RATE));
    }

    const rarity = String(dbItem.rarity || inventoryItem?.rarity || 'common');
    return SELL_FLOOR_BY_RARITY[rarity] || SELL_FLOOR_BY_RARITY.common;
}

/**
 * Добавить предмет в инвентарь с учётом стакования.
 *
 * Без этого покупка 10 яблок создавала 10 слотов (и упиралась в
 * лимит в 100), хотя в таблице items есть stackable/max_stack.
 * Стакуются только предметы с одинаковыми id, rarity и нулевым
 * upgrade_level — чтобы не смешивать апгрейженные экземпляры.
 * @param {Array} inventory - текущий инвентарь (мутируется)
 * @param {object} newItem - новый предмет из createInventoryItem()
 * @param {object|null} dbItem - строка из таблицы items (для stackable/max_stack)
 * @returns {number} сколько предметов реально добавлено новыми слотами
 */
/**
 * Типы предметов, которые нельзя складывать в стек.
 * Проверяются вместе со слотом: колонка items.slot nullable,
 * и у части оружия она пустая — без проверки типа два одинаковых
 * меча слились бы в один слот.
 */
const EQUIPMENT_TYPES = new Set([
    'weapon', 'armor', 'helmet', 'body', 'head',
    'hands', 'legs', 'boots', 'accessory', 'equipment'
]);

function addItemToInventory(inventory, newItem, dbItem) {
    if (!Array.isArray(inventory) || !newItem) return 0;

    const type = String(newItem.type || dbItem?.type || '').toLowerCase();
    const category = String(newItem.category || dbItem?.category || type).toLowerCase();
    // Снаряжение (у него есть slot) и ключи НИКОГДА не стакаются:
    // два меча в одном слоте — это поломанный предмет, а не стопка.
    const isEquipment = Boolean(newItem.slot || dbItem?.slot)
        || EQUIPMENT_TYPES.has(type)
        || EQUIPMENT_TYPES.has(category);
    const stackable = dbItem ? dbItem.stackable !== false : true;

    const maxStack = Math.max(1, Number(dbItem?.max_stack || 99));
    const quantity = Math.max(1, Number(newItem.quantity || 1));

    let remaining = quantity;

    if (stackable && !isEquipment && type !== 'key' && !newItem.upgrade_level) {
        for (let i = 0; i < inventory.length && remaining > 0; i++) {
            const existing = inventory[i];
            if (!existing || existing.id !== newItem.id) continue;
            if (existing.rarity !== newItem.rarity) continue;
            if (Number(existing.upgrade_level || 0) !== 0) continue;

            const currentQty = Math.max(0, Number(existing.quantity || 1));
            if (currentQty >= maxStack) continue;

            const toAdd = Math.min(maxStack - currentQty, remaining);
            inventory[i] = { ...existing, quantity: currentQty + toAdd };
            remaining -= toAdd;
        }
    }

    // Что не влезло в стеки — новыми слотами.
    // Остаток режем на полные стеки и возвращаем точное число новых слотов:
    // иначе покупка 4 в стек из 4 при max_stack=5 дала бы 5 + 4 = 9 вместо
    // 5 + 3, а покупка 12 при max_stack=10 — один слот на 12 штук.
    let slotsAdded = 0;
    while (remaining > 0) {
        const chunk = Math.min(maxStack, remaining);
        inventory.push({ ...newItem, quantity: chunk });
        remaining -= chunk;
        slotsAdded++;
    }

    return slotsAdded;
}

/**
 * Получить только активные баффы игрока
 */
function getActiveBuffs(value, now = Date.now()) {
    const buffs = normalizePlayerBuffs(value);
    const active = {};

    for (const [effect, buffData] of Object.entries(buffs)) {
        if (!buffData || typeof buffData !== 'object') continue;

        const expiresAtRaw = buffData.expires_at || buffData.expiresAt || buffData.expires;
        if (!expiresAtRaw) continue;

        const expiresAt = typeof expiresAtRaw === 'number'
            ? expiresAtRaw
            : new Date(expiresAtRaw).getTime();

        if (Number.isFinite(expiresAt) && expiresAt > now) {
            active[effect] = {
                ...buffData,
                expires_at: expiresAt
            };
        }
    }

    return active;
}

/**
 * Построение объекта статуса игрока
 */
function buildPlayerStatus(player) {
    const radiation = normalizeRadiation(player.radiation);
    const infectionsList = normalizeInfections(player.infections);

    return {
        health: Number(player.health || 0),
        max_health: Number(player.max_health || 0),
        radiation: radiation.level,
        fatigue: 0,
        energy: Number(player.energy || 0),
        max_energy: Number(player.max_energy || 0),
        infections: infectionsList.reduce((sum, infection) => sum + (infection.level || 0), 0),
        infections_list: infectionsList,
        last_energy_update: player.last_energy_update || null
    };
}

/**
 * Пересчёт энергии на основе реально прошедшего времени.
 * НЕ сбрасывает таймер при трате — реген идёт непрерывно.
 * @param {object} client - клиент БД (транзакция)
 * @param {object} player - объект игрока (мутирует energy/last_energy_update)
 * @returns {object} тот же player с обновлённой энергией
 */
async function recalcEnergy(client, player) {
    const now = Date.now();
    const last = new Date(player.last_energy_update).getTime();
    if (!Number.isFinite(last)) return player;

    const elapsedMs = Math.max(0, now - last);
    // 1 энергия за интервал из общего файла правил (60 c)
    const regen = Math.floor(elapsedMs / equipmentRules.ENERGY_REGEN_INTERVAL_MS);
    if (regen <= 0) return player;

    const currentEnergy = Number(player.energy || 0);
    const maxEnergy = Number(player.max_energy || 50);
    const newEnergy = Math.min(maxEnergy, currentEnergy + regen);

    if (newEnergy === currentEnergy) {
        // Игрок уже на максимуме: регенировать нечего, но ОБЯЗАНЫ двигать
        // last_energy_update. Иначе метка «застывает» на момент заполнения,
        // а потом любой расход (поиск/атака) мгновенно возвращается на клиенте:
        // getEffectivePlayerStatus() дочитывает реген с прошедшего времени.
        await client.query(
            'UPDATE players SET last_energy_update = $1 WHERE id = $2',
            [new Date(now).toISOString(), player.id]
        );
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    // Сдвигаем метку на фактически восстановленное время
    const newLast = new Date(last + regen * equipmentRules.ENERGY_REGEN_INTERVAL_MS).toISOString();
    await client.query(
        `UPDATE players SET energy = $1, last_energy_update = $2 WHERE id = $3`,
        [newEnergy, newLast, player.id]
    );
    player.energy = newEnergy;
    player.last_energy_update = newLast;
    return player;
}
/**
 * Пассивное восстановление здоровья — по реально прошедшему времени.
 *
 * Правило: +1 HP за 90 секунд, но не выше 60% от максимума. Потолок
 * существует ради баланса: бесплатно до полного здоровья добраться нельзя,
 * поэтому аптечки в бою остаются нужны. Реген — страховка ПОСЛЕ боя, а не
 * замена лекарствам.
 *
 * Метка last_hp_regen двигается ровно на восстановленное время (как
 * last_energy_update у энергии), иначе недобранное время терялось бы.
 *
 * @param {object} client клиент БД (транзакция или пул)
 * @param {object} player объект игрока (мутируется)
 * @returns {Promise<number>} сколько HP восстановлено
 */
async function regenerateHealth(client, player) {
    const maxHealth = Math.max(1, Number(player.max_health) || 1);
    const current = Math.max(0, Number(player.health) || 0);

    const regenerable = equipmentRules.getRegenerableHealth(current, maxHealth);
    const stamp = () => new Date().toISOString();

    if (regenerable <= 0) {
        // На потолке метку всё равно двигаем: иначе она «застынет» и при
        // следующем уроне накопится время с прошлого раза.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [stamp(), player.id]);
        player.last_hp_regen = stamp();
        return 0;
    }

    const last = player.last_hp_regen ? new Date(player.last_hp_regen).getTime() : NaN;
    const now = Date.now();

    if (!Number.isFinite(last)) {
        // Первый запуск: только ставим метку, ничего не начисляем.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [stamp(), player.id]);
        player.last_hp_regen = stamp();
        return 0;
    }

    const steps = Math.floor((now - last) / equipmentRules.HEALTH_REGEN_INTERVAL_MS);
    if (steps <= 0) return 0;

    const restored = Math.min(steps, regenerable);
    const newHealth = current + restored;
    // Метку двигаем на фактически начисленное время: если восстановление
    // уперлось в потолок, «лишнее» время не должно накапливаться.
    const consumedMs = restored * equipmentRules.HEALTH_REGEN_INTERVAL_MS;
    const newLast = new Date(last + Math.max(consumedMs, 0)).toISOString();

    await client.query(
        'UPDATE players SET health = $1, last_hp_regen = $2 WHERE id = $3',
        [newHealth, newLast, player.id]
    );

    player.health = newHealth;
    player.last_hp_regen = newLast;
    return restored;
}

/**
 * Автолечение: если здоровье упало ниже порога, расходуем самый
 * экономный лечащий предмет из инвентаря.
 *
 * Сознательно серверная функция: выбор предмета и списание только здесь,
 * клиент не может «попросить» вылечить себя бесплатно.
 *
 * @param {object} client клиент транзакции
 * @param {number} playerId
 * @param {object} player актуальное состояние игрока
 * @returns {Promise<{used:string,heal:number,health:number}|null>}
 */
async function applyAutoHeal(client, playerId, player) {
    if (!player || player.auto_heal_enabled === false) return null;

    const maxHealth = Math.max(1, Number(player.max_health) || 1);
    const health = Math.max(0, Number(player.health) || 0);
    if (health >= maxHealth) return null;

    const threshold = equipmentRules.getAutoHealThreshold(maxHealth, player.auto_heal_threshold);
    if (health > threshold) return null;

    const inventory = normalizeInventory(player.inventory);

    // Кандидаты: предметы, которые что-то лечат (поле health в stats).
    const candidates = inventory.filter((entry) => {
        const heal = Number(entry?.stats?.health ?? entry?.stats?.healing ?? entry?.heal ?? 0);
        return heal > 0;
    });
    if (candidates.length === 0) return null;

    const ids = [...new Set(candidates.map((entry) => Number(entry.id)).filter(Boolean))];
    const catalogResult = await client.query(
        `SELECT id, name, icon, price, stars_price, rarity,
                COALESCE((stats->>'health')::int, 0) AS heal
           FROM items WHERE id = ANY($1::int[])`,
        [ids]
    );
    const catalog = new Map(catalogResult.rows.map((row) => [row.id, row]));

    const items = candidates
        .map((entry) => {
            const meta = catalog.get(Number(entry.id));
            if (!meta || Number(meta.heal) <= 0) return null;
            return {
                id: Number(meta.id),
                name: meta.name,
                icon: meta.icon,
                price: Number(meta.price) || 0,
                stars_price: Number(meta.stars_price) || 0,
                heal: Number(meta.heal),
                stack: inventory
                    .filter((e) => Number(e.id) === Number(meta.id))
                    .reduce((sum, e) => sum + Math.max(1, Number(e.quantity || 1)), 0)
            };
        })
        .filter(Boolean);

    const choice = equipmentRules.selectHealItem(items, { health, maxHealth, threshold });
    if (!choice) return null;

    // Списываем ровно одну штуку выбранного предмета.
    let remaining = 1;
    for (let i = 0; i < inventory.length && remaining > 0; i++) {
        if (Number(inventory[i].id) !== choice.id) continue;
        const have = Math.max(1, Number(inventory[i].quantity || 1));
        if (have > remaining) {
            inventory[i] = { ...inventory[i], quantity: have - remaining };
            remaining = 0;
        } else {
            inventory.splice(i, 1);
            i--;
            remaining -= have;
        }
    }

    const healed = Math.min(choice.heal, maxHealth - health);
    const newHealth = health + healed;

    await client.query(
        'UPDATE players SET health = $1, inventory = $2::jsonb WHERE id = $3',
        [newHealth, JSON.stringify(inventory), playerId]
    );

    player.health = newHealth;
    player.inventory = inventory;

    return { used: choice.name, heal: healed, health: newHealth };
}

/**
 * Нормализация экипировки с валидацией слотов
 */
function normalizeEquipment(raw) {
    const eq = safeParseJson(raw, {});
    if (!eq || typeof eq !== 'object') return {};

    // Слоты берём из public/shared/equipment.js, того же файла, что читает
    // браузер: расхождение списков означало бы предметы, которые сервер
    // считает «надетыми», а бой не учитывает.
    const out = {};
    for (const slot of equipmentRules.COMBAT_SLOTS) {
        if (eq[slot] && typeof eq[slot] === 'object' && !Array.isArray(eq[slot])) {
            out[slot] = eq[slot];
        }
    }
    return out;
}

// ==========================================
// СЕТЫ, ИЗНОС И СЧЁТЧИКИ ПРОГРЕССА
// ==========================================

// Общие правила предметов живут в public/shared/equipment.js — оттуда же
// берём прочность, апгрейд и бонусы сетов, чтобы сервер и клиент считали
// одинаково.
const equipmentRules = require('../public/shared/equipment.js');

/**
 * Бонусы сетов по надетой экипировке.
 * @param {object} equipment экипировка игрока
 * @returns {Promise<Record<string, number>>}
 */
async function getSetBonuses(equipment) {
    const sets = await query('SELECT id, bonus_2, bonus_3, bonus_4 FROM item_sets ORDER BY id');
    return equipmentRules.calculateSetBonuses(equipment, (sets.rows || []).map((row) => ({
        id: row.id,
        bonus_2: safeParseJson(row.bonus_2, {}),
        bonus_3: safeParseJson(row.bonus_3, {}),
        bonus_4: safeParseJson(row.bonus_4, {})
    })));
}

/**
 * Износ экипировки по слотам и запись результата.
 *
 * Износ симметричен: 1 единица за удар, сломанный предмет теряет бонусы,
 * но остаётся в инвентаре и чинится в мастерской.
 *
 * @param {object} client клиент БД (транзакция)
 * @param {number} playerId
 * @param {object} equipment экипировка (мутируется)
 * @param {string[]} slots какие слоты изнашивать
 * @returns {string[]} список слотов, где предмет сломался (для ответа клиенту)
 */
function wearEquipmentSlots(client, playerId, equipment, slots) {
    if (!equipment || !Array.isArray(slots) || slots.length === 0) return [];

    const broken = [];
    for (const slot of slots) {
        const item = equipment[slot];
        if (!item) continue;
        equipment[slot] = equipmentRules.wearEquipment(item, 1);
        if (equipmentRules.getDurabilityInfo(equipment[slot]).isBroken) {
            broken.push(slot);
        }
    }
    return broken;
}

/**
 * Пополнить unique_items новыми id предметов.
 *
 * Поле читают достижения «Коллекционер»/«Хранитель» (10 и 25 уникальных
 * предметов), но не обновлял никто — прогресс навсегда оставался 0.
 *
 * @param {object} client клиент БД
 * @param {number} playerId
 * @param {Iterable<number|string>} itemIds
 */
async function trackCollectedItems(client, playerId, itemIds) {
    const ids = [...new Set([...itemIds].map(Number).filter(Number.isFinite))];
    if (ids.length === 0) return;

    await client.query(`
        UPDATE players
           SET unique_items = (
                   SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                     FROM jsonb_array_elements_text(
                         COALESCE(unique_items, '[]'::jsonb) || $2::jsonb
                     ) AS value
               )
         WHERE id = $1
    `, [playerId, JSON.stringify(ids)]);
}

/**
 * Прогресс ежедневного задания.
 *
 * Поля current_value/completed в daily_tasks были, но их не менял ни один
 * обработчик: задания показывались, но не выполнялись. task_type совпадает с
 * теми, что выдаёт routes/api.js: search / boss_damage / collect_items.
 *
 * @param {object} client клиент БД
 * @param {number} playerId
 * @param {string} taskType
 * @param {number} amount на сколько увеличить прогресс
 * @returns {Promise<number>} новое значение current_value (0 — заданий нет)
 */
async function progressDailyTask(client, playerId, taskType, amount) {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta === 0) return 0;

    const result = await client.query(`
        UPDATE daily_tasks
           SET current_value = LEAST(target_value, current_value + $3),
               completed = (LEAST(target_value, current_value + $3) >= target_value)
         WHERE player_id = $1
           AND task_type = $2
           AND completed = false
           AND expires_at > NOW()
        RETURNING current_value
    `, [playerId, taskType, delta]);

    return result.rows[0]?.current_value || 0;
}

// ==========================================
// СИСТЕМА ДОСТИЖЕНИЙ (из achievements.js)
// ==========================================

/**
 * Получить текущее значение для проверки достижения
 */
function getAchievementCurrentValue(condition, player, runtimeContext) {
    switch (condition.type) {
        case 'level':
            return player.level || 1;
        case 'days_played':
            return player.days_played || 1;
        case 'bosses_killed':
        case 'boss_kills':
        case 'first_boss_kill':
            return runtimeContext?.totalBossesKilled || player.bosses_killed || 0;
        case 'single_boss_kills':
            return runtimeContext?.maxSingleBossKills || 0;
        case 'all_bosses_killed':
            return runtimeContext?.defeatedBosses || 0;
        case 'pvp_wins':
            return player.pvp_wins || 0;
        case 'unique_items':
            return Array.isArray(player.unique_items) ? player.unique_items.length : 0;
        case 'locations_visited':
            return Array.isArray(player.locations_visited) ? player.locations_visited.length : 0;
        case 'in_clan':
            return player.clan_id ? 1 : 0;
        case 'clan_leader':
            return player.clan_role === 'leader' ? 1 : 0;
        case 'clans_joined':
            return player.clans_joined || 0;
        case 'loot':
        case 'items_collected':
            return player.items_collected || 0;
        case 'streak':
            return player.daily_streak || 0;
        default:
            return 0;
    }
}

/**
 * Получить целевое значение для достижения
 */
function getAchievementTargetValue(condition, runtimeContext) {
    if (condition.type === 'all_bosses_killed') {
        return Math.max(1, runtimeContext?.totalBosses || 0);
    }
    if (condition.type === 'first_boss_kill') {
        return 1;
    }
    if (condition.type === 'in_clan' || condition.type === 'clan_leader') {
        return 1;
    }
    return Number(condition.count || condition.value || 0);
}

/**
 * Получить контекст для достижений (данные из БД)
 */
async function getAchievementRuntimeContext(client, playerId) {
    const fn = client
        ? (sql, params) => client.query(sql, params).then(r => r.rows[0])
        : (sql, params) => query(sql, params).then(r => r.rows[0]);

    const row = await fn(`
        SELECT
            (SELECT COUNT(*) FROM bosses) AS total_bosses,
            (SELECT COUNT(DISTINCT boss_id) FROM boss_mastery WHERE player_id = $1 AND kills > 0) AS defeated_bosses,
            (SELECT COALESCE(MAX(kills), 0) FROM boss_mastery WHERE player_id = $1) AS max_single_boss_kills,
            (SELECT COALESCE(SUM(kills), 0) FROM boss_mastery WHERE player_id = $1) AS total_bosses_killed
    `, [playerId]);

    return {
        totalBosses: Number(row?.total_bosses || 0),
        defeatedBosses: Number(row?.defeated_bosses || 0),
        maxSingleBossKills: Number(row?.max_single_boss_kills || 0),
        totalBossesKilled: Number(row?.total_bosses_killed || 0)
    };
}

/**
 * Проверить и выдать достижения игроку (на основе таблицы achievements)
 * @param {number} playerId - ID игрока
 * @param {object} client - опциональный клиент БД для транзакций
 */
async function checkAchievements(playerId, client = null) {
    try {
        const fn = client
            ? (sql, params) => client.query(sql, params)
            : (sql, params) => query(sql, params);

        // Получаем все достижения из таблицы
        const achResult = await fn('SELECT * FROM achievements ORDER BY id', []);
        const achievements = achResult.rows || [];

        if (!achievements.length) return [];

        // Получаем уже выданные достижения
        const ownedResult = await fn(
            'SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND completed = true',
            [playerId]
        );
        const owned = new Set(ownedResult.rows?.map(r => r.achievement_id) || []);

        // Получаем данные игрока
        const playerResult = await fn(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, unique_items, locations_visited,
                    clan_id, clan_role, clans_joined
             FROM players WHERE id = $1`,
            [playerId]
        );
        const player = playerResult.rows?.[0];
        if (!player) return [];

        // Получаем контекст для достижений
        const runtimeContext = await getAchievementRuntimeContext(client, playerId);

        const newAchievements = [];

        for (const ach of achievements) {
            if (owned.has(ach.id)) continue;

            const condition = safeParseJson(ach.condition, {});
            if (!condition.type) continue;

            const currentValue = getAchievementCurrentValue(condition, player, runtimeContext);
            const targetValue = getAchievementTargetValue(condition, runtimeContext);

            if (currentValue >= targetValue) {
                // Выдаём достижение — используем переданный client или transaction()
                const wasInserted = client
                    ? await insertAchievement(client, playerId, ach, currentValue)
                    : await transaction(async (txClient) => {
                        return await insertAchievement(txClient, playerId, ach, currentValue);
                    });

                if (wasInserted) {
                    const reward = safeParseJson(ach.reward, {});
                    newAchievements.push({
                        id: ach.id,
                        name: ach.name,
                        description: ach.description,
                        reward: reward
                    });
                }
            }
        }

        return newAchievements;
    } catch (err) {
        logger.error({ type: 'check_achievements_error', message: err.message, stack: err.stack });
        return [];
    }
}

/**
 * Пометить достижение выполненным (в транзакции).
 *
 * ВАЖНО: награду здесь НЕ выдаём. Единственный источник выдачи — эндпоинт
 * claim (кнопка «Получить» в UI); если выдать её ещё и здесь, игрок получит
 * двойную награду за каждое достижение.
 */
async function insertAchievement(client, playerId, ach, progressValue) {
    const reward = safeParseJson(ach.reward, {});

    // Вставляем или обновляем достижение. ON CONFLICT НЕ трогает
    // reward_claimed: уже полученная награда остаётся полученной.
    const insertResult = await client.query(
        `INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed, completed_at, reward_claimed)
         VALUES ($1, $2, $3, true, NOW(), false)
         ON CONFLICT (player_id, achievement_id)
         DO UPDATE SET completed = true, completed_at = NOW(), progress_value = $3
         RETURNING id`,
        [playerId, ach.id, progressValue]
    );

    if (insertResult.rowCount === 0) return false;

    logger.info({
        type: 'achievement_unlocked',
        playerId,
        achievement: ach.name,
        reward_available: reward
    });

    return true;
}

/**
 * Получить все достижения игрока
 */
async function getPlayerAchievements(playerId) {
    try {
        const result = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
            FROM achievements a
            LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
            ORDER BY a.category, a.id
        `, [playerId]);

        return (result.rows || []).map(row => ({
            id: row.id,
            key: String(row.id),
            name: row.name,
            desc: row.description,
            type: row.category,
            category: row.category,
            icon: row.icon,
            rarity: row.rarity,
            req: safeParseJson(row.condition, {}).count || 0,
            reward: safeParseJson(row.reward, {}).stars || 0,
            obtained: row.completed || false,
            rewarded_at: row.completed_at,
            reward_claimed: row.reward_claimed || false,
            progress_value: row.progress_value || 0
        }));
    } catch (err) {
        logger.error({ type: 'get_achievements_error', message: err.message });
        return [];
    }
}

/**
 * Получить прогресс игрока по всем типам достижений
 */
async function getPlayerProgress(playerId) {
    try {
        const playerResult = await query(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak
             FROM players WHERE id = $1`,
            [playerId]
        );

        if (!playerResult.rows.length) return null;

        const p = playerResult.rows[0];
        const runtimeContext = await getAchievementRuntimeContext(null, playerId);

        const progress = {
            level: { current: p.level, achievements: [] },
            boss: { current: runtimeContext.totalBossesKilled || p.bosses_killed || 0, achievements: [] },
            pvp: { current: p.pvp_wins || 0, achievements: [] },
            loot: { current: p.items_collected || 0, achievements: [] },
            streak: { current: p.daily_streak || 0, achievements: [] }
        };

        // Заполняем прогресс по каждому типу
        const achievementsResult = await query('SELECT * FROM achievements ORDER BY id');
        const achievements = achievementsResult.rows || [];

        for (const ach of achievements) {
            const condition = safeParseJson(ach.condition, {});
            const type = condition.type || '';
            const category = ach.category || '';

            // Определяем тип прогресса
            let progressType = null;
            if (type === 'level') progressType = 'level';
            else if (type.includes('boss')) progressType = 'boss';
            else if (type === 'pvp_wins') progressType = 'pvp';
            else if (type === 'loot' || type === 'items_collected') progressType = 'loot';
            else if (type === 'streak') progressType = 'streak';
            else if (category && progress[category]) progressType = category;

            if (progressType && progress[progressType]) {
                const targetValue = getAchievementTargetValue(condition, runtimeContext);
                progress[progressType].achievements.push({
                    id: ach.id,
                    name: ach.name,
                    req: targetValue,
                    current: progress[progressType].current,
                    completed: progress[progressType].current >= targetValue
                });
            }
        }

        return progress;
    } catch (err) {
        logger.error({ type: 'get_progress_error', message: err.message });
        return null;
    }
}

/**
 * Инициализировать таблицу достижений.
 * P2-12: единый источник теперь schema.js (4 базовых ачивки).
 * Старый набор из 19 записей больше не вставляется, чтобы не дублировать
 * и не путать UI. Функция оставлена для обратной совместимости вызовов.
 */
async function initAchievementsTable() {
    const countResult = await query('SELECT COUNT(*) as cnt FROM achievements');
    const count = Number(countResult.rows[0]?.cnt || 0);

    if (count === 0) {
        logger.warn('[achievements] таблица achievements пуста — ожидается наполнение через db/schema.js (миграции). Старый набор не вставляется во избежание дублей.');
    }
    return count;
}

// ==========================================
// ЭКСПОРТ
// ==========================================

/**
 * Уменьшить количество предмета в инвентаре на 1 (с учётом стаков).
 * Используется вместо ручного splice/quantity-- во всех местах.
 *
 * @param {Array} inventory - массив предметов инвентаря (уже нормализованный)
 * @param {number} itemIndex - индекс предмета в массиве
 * @returns {Object} { updatedInventory, item, quantityLeft }
 *   - updatedInventory: новый массив инвентаря (копия, не мутирует оригинал)
 *   - item: предмет, который был потреблён
 *   - quantityLeft: количество предметов, оставшихся после потребления
 */
function consumeInventoryItem(inventory, itemIndex) {
    const item = inventory[itemIndex];
    if (!item) {
        return { updatedInventory: inventory, item: null, quantityLeft: 0 };
    }
    
    const currentQty = Math.max(1, Number(item.quantity || 1));
    const remainingQty = currentQty - 1;
    
    // Создаём копию инвентаря (иммутабельно)
    const updatedInventory = [...inventory];
    
    if (remainingQty > 0) {
        updatedInventory[itemIndex] = { ...item, quantity: remainingQty };
    } else {
        updatedInventory.splice(itemIndex, 1);
    }
    
    return { updatedInventory, item, quantityLeft: remainingQty };
}

module.exports = {
    // Функции состояния игрока.
    //
    // normalizeItemStats, normalizePlayerBuffs и SELL_RATE здесь не
    // экспортируются: они используются только внутри файла, а раньше
    // уходили наружу вместе с остальными. Список экспортов должен
    // отвечать на вопрос «что зовут другие модули» — иначе мёртвые имена
    // маскируют настоящие дубли (см. историю ITEM_CATEGORIES в
    // gameConstants.js).
    safeParseJson,
    normalizeInventory,
    createInventoryItem,
    normalizeRadiation,
    normalizeInfections,
    getActiveBuffs,
    buildPlayerStatus,
    recalcEnergy,
    regenerateHealth,
    applyAutoHeal,
    normalizeEquipment,
    calculateSellPrice,
    addItemToInventory,
    SELL_FLOOR_BY_RARITY,

    // Правила предметов и счётчики прогресса
    equipmentRules,
    getSetBonuses,
    wearEquipmentSlots,
    trackCollectedItems,
    progressDailyTask,
    consumeInventoryItem,
    
    // Функции достижений (achievements.js)
    getAchievementCurrentValue,
    getAchievementTargetValue,
    getAchievementRuntimeContext,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    initAchievementsTable
};
