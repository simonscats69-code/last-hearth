/**
 * Игровые хелперы (игровой мир, инвентарь и т.д.)
 * Используется в playerState.js (генерирование состояния игрока)
 * и achievements.js (система достижений).
 */

const { query, transaction } = require('../db/database');
// logger и safeJsonParse берутся из serverApi (единственный источник truth).
// require берется напрямую, чтобы избежать циклических зависимостей
// (проверка achieve, нормализация предметов). В остальном — через serverApi.
const { logger, safeJsonParse, logPlayerAction } = require('./serverApi');
const { normalizeRadiationLevel } = require('./gameConstants');
const equipmentRules = require('../public/shared/equipment.js');

// ==========================================
// Вспомогательные функции (от playerState.js)
// ==========================================

/**
 * Проверка, что значение — обычный объект.
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepClone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(deepClone);
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = deepClone(value[key]);
    }
    return out;
}

function toFiniteNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

const VALID_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);

function normalizeInventoryItem(raw) {
    if (!isPlainObject(raw)) return null;
    const copy = deepClone(raw);

    // id: безопасное целое число, иначе null (если null/undefined — 0).
    if (copy.id !== null && copy.id !== undefined) {
        const idNum = Number(copy.id);
        copy.id = Number.isSafeInteger(idNum) ? idNum : null;
    } else {
        copy.id = null;
    }

    // quantity: положительное целое, по умолчанию 1.
    const q = Number(copy.quantity);
    copy.quantity = (Number.isFinite(q) && Number.isInteger(q) && q > 0) ? q : 1;

    // rarity: одна из допустимых, иначе 'common'.
    if (typeof copy.rarity !== 'string' || !VALID_RARITIES.has(copy.rarity)) {
        copy.rarity = 'common';
    }

    // upgrade_level: неотрицательное целое.
    const ul = Number(copy.upgrade_level);
    copy.upgrade_level = (Number.isFinite(ul) && Number.isInteger(ul) && ul >= 0) ? ul : 0;

    // durability / max_durability: нормализация значений.
    copy.durability = toFiniteNumber(copy.durability, 0);
    if (copy.durability < 0) copy.durability = 0;
    copy.max_durability = toFiniteNumber(copy.max_durability, equipmentRules.BASE_DURABILITY || 500);
    if (copy.max_durability < 1) copy.max_durability = 100;
    if (copy.durability > copy.max_durability) copy.durability = copy.max_durability;

    // stats / modifications: обычные объекты, иначе {}.
    copy.stats = isPlainObject(copy.stats) ? deepClone(copy.stats) : {};
    copy.modifications = isPlainObject(copy.modifications) ? deepClone(copy.modifications) : {};

    // name/type/category/icon/slot: строки.
    if (typeof copy.name !== 'string') copy.name = String(copy.name ?? 'Предмет');
    if (typeof copy.type !== 'string') copy.type = String(copy.type ?? 'misc');
    if (typeof copy.category !== 'string') copy.category = String(copy.category ?? copy.type);
    if (typeof copy.icon !== 'string') copy.icon = String(copy.icon ?? '=ж');
    if (copy.slot !== null && copy.slot !== undefined && typeof copy.slot !== 'string') {
        copy.slot = String(copy.slot);
    }

    // Очистка статистики: нечисловые ключи удаляются.
    for (const key of Object.keys(copy.stats)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            delete copy.stats[key];
            continue;
        }
        const v = Number(copy.stats[key]);
        if (!Number.isFinite(v)) {
            delete copy.stats[key];
        } else {
            copy.stats[key] = v;
        }
    }

    return copy;
}

function normalizeInventory(value) {
    const parsed = safeJsonParse(value, []);

    if (Array.isArray(parsed)) {
        return parsed.map(normalizeInventoryItem).filter(Boolean);
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Одиночный объект — инвентарь с одним предметом (id/name/type), или карта.
        if (isPlainObject(parsed) && (parsed.id !== undefined || parsed.name !== undefined || parsed.type !== undefined)) {
            const item = normalizeInventoryItem(parsed);
            return item ? [item] : [];
        }
        return Object.values(parsed).map(normalizeInventoryItem).filter(Boolean);
    }

    return [];
}

/**
 * Нормализация plain-объекта (парсинг JSON или объект как есть).
 * Защита от прототипного заражения (__proto__, constructor, prototype).
 */
function normalizePlainObject(value) {
    const parsed = safeJsonParse(value, {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = Object.create(null);
    for (const key of Object.keys(parsed)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = parsed[key];
    }
    return out;
}

/**
 * Нормализация статистики предмета.
 */
function normalizeItemStats(value) {
    const obj = normalizePlainObject(value);
    if (!isPlainObject(obj)) return {};
    const out = {};
    for (const key of Object.keys(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const v = Number(obj[key]);
        if (Number.isFinite(v)) out[key] = v;
    }
    return out;
}

/**
 * Создание объекта предмета инвентаря на основе данных из таблицы items.
 */
function createInventoryItem(item, options = {}) {
    const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};

    const stats = normalizeItemStats(opts.stats !== undefined ? opts.stats : source.stats);
    const durability = toFiniteNumber(opts.durability ?? source.durability ?? (equipmentRules.BASE_DURABILITY || 500), (equipmentRules.BASE_DURABILITY || 500));
    const maxDurability = toFiniteNumber(opts.max_durability ?? source.max_durability ?? (equipmentRules.BASE_DURABILITY || 500), (equipmentRules.BASE_DURABILITY || 500));
    const rawModifications = opts.modifications ?? source.modifications ?? {};
    const modifications = isPlainObject(rawModifications) ? deepClone(rawModifications) : {};

    const safeId = (v) => {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : null;
    };

    return {
        id: (opts.id !== undefined ? safeId(opts.id) : (source.id !== undefined ? safeId(source.id) : null)),
        name: String(opts.name ?? source.name ?? 'Предмет'),
        type: String(opts.type ?? source.type ?? 'misc'),
        category: String(opts.category ?? source.category ?? opts.type ?? source.type ?? 'misc'),
        rarity: VALID_RARITIES.has(opts.rarity ?? source.rarity) ? (opts.rarity ?? source.rarity) : 'common',
        icon: String(opts.icon ?? source.icon ?? '=ж'),
        slot: (opts.slot ?? source.slot) == null ? null : String(opts.slot ?? source.slot),
        stats,
        damage: toFiniteNumber(opts.damage ?? source.damage ?? stats.damage ?? 0, 0),
        defense: toFiniteNumber(opts.defense ?? source.defense ?? stats.defense ?? 0, 0),
        heal: toFiniteNumber(opts.heal ?? source.heal ?? stats.health ?? stats.health_restore ?? 0, 0),
        rad_removal: toFiniteNumber(opts.rad_removal ?? source.rad_removal ?? stats.radiation_cure ?? 0, 0),
        contamination_resist: toFiniteNumber(
            opts.contamination_resist ?? source.contamination_resist
            ?? opts.radiation_resist ?? source.radiation_resist
            ?? opts.infection_resist ?? source.infection_resist
            ?? stats.radiation_resist ?? stats.infection_resist ?? 0, 0),
        radiation_resist: toFiniteNumber(opts.radiation_resist ?? source.radiation_resist ?? stats.radiation_resist ?? 0, 0),
        durability: Math.max(0, Math.min(durability, maxDurability)),
        max_durability: Math.max(1, maxDurability),
        quantity: (() => { const q = Number(opts.quantity ?? source.quantity ?? 1); return Number.isFinite(q) && Number.isInteger(q) && q > 0 ? q : 1; })(),
        upgrade_level: (() => { const u = Number(opts.upgrade_level ?? source.upgrade_level ?? 0); return Number.isFinite(u) && Number.isInteger(u) && u >= 0 ? u : 0; })(),
        modifications
    };
}

/**
 * Нормализация радиации игрока.
 */
function normalizeRadiation(value) {
    const parsed = safeJsonParse(value, { level: 0 });

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
 * Нормализация баффов игрока (объект 10fff22 из БД).
 */
function normalizePlayerBuffs(value) {
    return normalizePlainObject(value);
}

/**
 * Проверка, является ли предмет не продаваемым.
 * Ключевые типы: ключ, квест, валюта, материал.
 */
const NON_SELLABLE_TYPES = new Set(['key', 'quest', 'currency', 'material']);

/** Коэффициент продажи (берется из public/shared/equipment.js) */
const SELL_RATE = equipmentRules.SELL_RATE;
const SELL_FLOOR_BY_RARITY = equipmentRules.SELL_FLOOR_BY_RARITY || {};

/**
     * Расчет цены продажи предмета.
     *
     * Если dbItem (строка каталога) не найдена — не возвращаем 0 без попытки:
     * фоллбэк на данные из инвентаря (rarity, price). Иначе предметы с
     * устевшим/phantom id или null-id пропадали из экономики, хотя
     * продаваемыми были по редкости.
     *
     * @param {object|null} dbItem - запись из таблицы items
     * @param {object} inventoryItem - предмет из инвентаря игрока
     * @returns {number} цена продажи за 1 штуку
     */
    function calculateSellPrice(dbItem, inventoryItem) {
        const source = dbItem || (inventoryItem && typeof inventoryItem === 'object' ? inventoryItem : null);
        if (!source) return 0;

        const type = String(source.type || (inventoryItem && inventoryItem.type) || '');
        if (NON_SELLABLE_TYPES.has(type)) return 0;

        const shopPrice = Number(source.price || (inventoryItem && inventoryItem.price) || 0);
        if (shopPrice > 0) {
            return Math.max(1, Math.floor(shopPrice * SELL_RATE));
        }

        const rarity = String(source.rarity || (inventoryItem && inventoryItem.rarity) || 'common');
        return SELL_FLOOR_BY_RARITY[rarity] || SELL_FLOOR_BY_RARITY.common;
    }

/**
 * Добавление предмета в инвентарь с объединением стаков.
 * @param {Array} inventory - массив предметов инвентаря (редактируется на месте)
 * @param {object} newItem - новый предмет (createInventoryItem())
 * @param {object|null} dbItem - запись из таблицы items (для stackable/max_stack)
 * @returns {number} количество добавленных новых слотов
 */
function addItemToInventory(inventory, newItem, dbItem) {
    if (!Array.isArray(inventory)) return 0;
    if (!newItem || typeof newItem !== 'object' || Array.isArray(newItem)) return 0;

    const item = deepClone(newItem);

    const type = String(item.type || dbItem?.type || '').toLowerCase();
    const category = String(item.category || dbItem?.category || type).toLowerCase();

    const isEquipment = Boolean(item.slot || dbItem?.slot)
        || EQUIPMENT_TYPES.has(type)
        || EQUIPMENT_TYPES.has(category);

    // stackable: значение по умолчанию true, если явно не false/0/'0'/'false'/null.
    const stackable = dbItem
        ? (dbItem.stackable !== false && dbItem.stackable !== 0 && dbItem.stackable !== '0'
           && dbItem.stackable !== 'false' && dbItem.stackable !== null)
        : true;

    const rawMax = Number(dbItem?.max_stack ?? 99);
    const maxStack = (Number.isFinite(rawMax) && rawMax >= 1) ? Math.min(Math.floor(rawMax), 10000) : 99;

    const rawQty = Number(item.quantity);
    const quantity = (Number.isFinite(rawQty) && Number.isInteger(rawQty) && rawQty > 0) ? rawQty : 1;

    // id: безопасное целое, иначе null.
    const newItemId = (item.id !== null && item.id !== undefined) ? (Number.isSafeInteger(Number(item.id)) ? Number(item.id) : null) : null;

    let remaining = quantity;

    // Сравнение двух предметов для объединения стаков (через JSON.stringify).
    const deepEqual = (a, b) => {
        if (a === b) return true;
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        if (ka.length !== kb.length) return false;
        for (let i = 0; i < ka.length; i++) {
            if (ka[i] !== kb[i]) return false;
            if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
        }
        return true;
    };

    if (stackable && !isEquipment && type !== 'key' && Number(item.upgrade_level || 0) === 0 && newItemId !== null) {
        for (let i = 0; i < inventory.length && remaining > 0; i++) {
            const existing = inventory[i];
            if (!existing || typeof existing !== 'object' || Array.isArray(existing)) continue;
            const existingId = (existing.id !== null && existing.id !== undefined) ? (Number.isSafeInteger(Number(existing.id)) ? Number(existing.id) : null) : null;
            if (existingId !== newItemId) continue;
            if (existing.rarity !== item.rarity) continue;
            if (Number(existing.upgrade_level || 0) !== 0) continue;
            // Предметы с разной прочностью/макс.прочностью/модификациями/статами не объединяются.
            if (Number(existing.durability || 0) !== Number(item.durability || 0)) continue;
            if (Number(existing.max_durability || 0) !== Number(item.max_durability || 0)) continue;
            if (!deepEqual(existing.modifications || null, item.modifications || null)) continue;
            if (!deepEqual(existing.stats || null, item.stats || null)) continue;

            const currentQty = Math.max(0, Number.isFinite(Number(existing.quantity)) ? Number(existing.quantity) : 0);
            if (currentQty >= maxStack) continue;

            const toAdd = Math.min(maxStack - currentQty, remaining);
            inventory[i] = { ...existing, quantity: currentQty + toAdd };
            remaining -= toAdd;
        }
    }

    // Если остался нераспределенный остаток — добавляем новыми слотами.
    let slotsAdded = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 10000;
    while (remaining > 0 && iterations < MAX_ITERATIONS) {
        const chunk = Math.min(maxStack, remaining);
        inventory.push({ ...item, quantity: chunk });
        remaining -= chunk;
        slotsAdded++;
        iterations++;
    }

    return slotsAdded;
}

/**
 * Получение активных баффов игрока (с учетом истечения срока).
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
 * Построение статуса игрока (здоровье, радиация, энергия и т.д.).
 * Для отображения: радиация — уровень. Инфекции — отдельно.
 */
function buildPlayerStatus(player) {
    const radiation = normalizeRadiation(player.radiation);

    return {
        health: Number(player.health || 0),
        max_health: Number(player.max_health || 0),
        radiation: radiation.level,
        fatigue: 0,
        energy: Number(player.energy || 0),
        max_energy: Number(player.max_energy || 0),
        last_energy_update: player.last_energy_update || null
    };
}

/**
 * Пересчет энергии игрока.
 * @param {object} client - клиент БД (в транзакции)
 * @param {object} player - состояние игрока (energy/last_energy_update)
 * @returns {object} обновленное состояние игрока
 */
async function recalcEnergy(client, player) {
    const now = Date.now();
    if (!player.last_energy_update) {
        await client.query('UPDATE players SET last_energy_update = $1 WHERE id = $2', [new Date(now).toISOString(), player.id]);
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }
    const last = new Date(player.last_energy_update).getTime();
    if (!Number.isFinite(last)) return player;

    // Если last_energy_update в будущем — сбрасываем на сейчас.
    if (last > now) {
        await client.query('UPDATE players SET last_energy_update = $1 WHERE id = $2', [new Date(now).toISOString(), player.id]);
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    const elapsedMs = Math.max(0, now - last);
    // 1 единица энергии каждые ENERGY_REGEN_INTERVAL_MS (60 сек).
    const regen = Math.floor(elapsedMs / equipmentRules.ENERGY_REGEN_INTERVAL_MS);
    if (regen <= 0) return player;

    const currentEnergy = Number(player.energy || 0);
    const maxEnergy = Number(player.max_energy || 50);
    const newEnergy = Math.min(maxEnergy, currentEnergy + regen);

    if (newEnergy === currentEnergy) {
        // Энергия не изменилась — только обновляем last_energy_update.
        await client.query(
            'UPDATE players SET last_energy_update = $1 WHERE id = $2',
            [new Date(now).toISOString(), player.id]
        );
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    // Применяем накопленную регенерацию.
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
 * Регенерация здоровья игрока.
 * +1 HP каждые HEALTH_REGEN_INTERVAL_MS, до лимита (HEALTH_REGEN_CAP_RATIO).
 */
async function regenerateHealth(client, player) {
    const maxHealth = Math.max(100, Number(player.max_health) || 100);
    const cap = Math.floor(maxHealth * (equipmentRules.HEALTH_REGEN_CAP_RATIO || 1.0));
    const effectiveMax = Math.max(1, cap);
    const current = Math.max(0, Number(player.health) || 0);

    const regenerable = Math.max(0, effectiveMax - current);
    const nowStamp = new Date().toISOString();

    if (regenerable <= 0) {
        // Здоровье уже полное — только обновляем last_hp_regen.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [nowStamp, player.id]);
        player.last_hp_regen = nowStamp;
        return 0;
    }

    const last = player.last_hp_regen ? new Date(player.last_hp_regen).getTime() : NaN;
    const now = Date.now();

    if (!Number.isFinite(last)) {
        // first regen — инициализация last_hp_regen.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [nowStamp, player.id]);
        player.last_hp_regen = nowStamp;
        return 0;
    }

    const steps = Math.floor((now - last) / equipmentRules.HEALTH_REGEN_INTERVAL_MS);
    if (steps <= 0) return 0;

    const restored = Math.min(steps, regenerable);
    const newHealth = current + restored;
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
 * Нормализация экипировки игрока (объект из players.equipment).
 * См. public/shared/equipment.js для COMBAT_SLOTS и типов предметов.
 */
function normalizeEquipment(raw) {
    const eq = safeJsonParse(raw, {});

    if (!isPlainObject(eq)) return {};

    const out = Object.create(null);
    for (const slot of Object.keys(eq)) {
        if (slot === '__proto__' || slot === 'constructor' || slot === 'prototype') continue;
        const item = eq[slot];
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const normalized = normalizeInventoryItem(item);
        if (normalized) out[slot] = normalized;
    }
    return out;
}

// ==========================================
// Бонусы наборов предметов (от achievements.js)
// ==========================================

// Типы экипировки (берутся из public/shared/equipment.js, дублируются здесь для удобства).
const EQUIPMENT_TYPES = new Set([
    'weapon', 'armor', 'helmet', 'face', 'body',
    'hands', 'legs', 'boots', 'accessory', 'equipment'
]);

/**
 * Расчет бонусов набора предметов.
 * @param {object} equipment - экипировка игрока
 * @param {object} [client] - клиент БД (в транзакции)
 * @returns {Promise<Object>} бонусы набора
 */
async function getSetBonuses(equipment, client) {
    const queryFn = client && typeof client.query === 'function' ? client.query.bind(client) : query;
    const sets = await queryFn('SELECT id, bonus_2, bonus_3, bonus_4 FROM item_sets ORDER BY id');
    return equipmentRules.calculateSetBonuses(equipment, (sets.rows || []).map((row) => ({
        id: row.id,
        bonus_2: safeJsonParse(row.bonus_2, {}),
        bonus_3: safeJsonParse(row.bonus_3, {}),
        bonus_4: safeJsonParse(row.bonus_4, {})
    })));
}

/**
 * Износ слотов экипировки.
 * @param {object} equipment - экипировка игрока
 * @param {string[]} slots - слоты для износа
 * @returns {string[]} список сломанных слотов
 */
function wearEquipmentSlots(equipment, slots) {
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
 * Отслеживание собранных уникальных предметов (достижение «Коллекционер»).
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {Iterable<number|string>} itemIds - ID предметов
 */
async function trackCollectedItems(client, playerId, itemIds) {
    const ids = [...new Set(Array.from(itemIds || []).map(Number).filter(Number.isFinite))];
    if (ids.length === 0) return;

    await client.query(`
        UPDATE players
           SET unique_items = (
                   SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                      FROM jsonb_array_elements(
                          COALESCE(unique_items, '[]'::jsonb) || $2::jsonb
                      ) AS value
                )
         WHERE id = $1
    `, [playerId, JSON.stringify(ids)]);
}

// ==========================================
// Ежедневные задания (от achievements.js)
// ==========================================

const DAILY_TASK_TYPES = [
    { type: 'search', target: (level) => Math.max(3, Math.floor(level / 5) + 3), reward: { coins: 50, xp: 20 }, difficulty: 'easy' },
    { type: 'boss_damage', target: (level) => 100 * level, reward: { coins: 100, xp: 50 }, difficulty: 'medium' },
    { type: 'collect_items', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy' },
    { type: 'pvp_wins', target: () => 1, reward: { coins: 150, xp: 75 }, difficulty: 'hard' },
    { type: 'locations_visited', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy' },
    { type: 'boss_kill', target: () => 1, reward: { coins: 200, xp: 100 }, difficulty: 'hard' },
];

/**
 * Обновление прогресса ежедневного задания.
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {string} taskType - тип задания
 * @param {number} amount - количество прогресса
 * @returns {Promise<{updated: number, completed: Array, total_progress: number}>}
 */
async function progressDailyTask(client, playerId, taskType, amount) {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta === 0) return { updated: 0, completed: [], total_progress: 0 };

    // Если заданий на сегодня нет — сгенерировать 3 новых.
    const existing = await client.query(
        `SELECT id FROM daily_tasks WHERE player_id = $1 AND expires_at > NOW()`,
        [playerId]
    );
    if (existing.rows.length === 0) {
        const player = await client.query('SELECT level FROM players WHERE id = $1', [playerId]);
        const level = Number(player.rows[0]?.level) || 1;
        const types = DAILY_TASK_TYPES || [];
        const picked = [];
        const pool = [...types];
        while (picked.length < 3 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
        }
        const expiresAt = new Date();
        expiresAt.setHours(24, 0, 0, 0);

        for (const t of picked) {
            const target = t.target(level);
            const reward = { ...t.reward };
            await client.query(`
                INSERT INTO daily_tasks (player_id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, created_at)
                VALUES ($1, $2, $3, 0, $4::jsonb, $5, false, false, $6, 'active', NOW())
                ON CONFLICT (player_id, task_type, expires_at) DO NOTHING
            `, [playerId, t.type, target, JSON.stringify(reward), expiresAt, t.difficulty]);
        }
    }

    const result = await client.query(`
        UPDATE daily_tasks
           SET current_value = LEAST(target_value, current_value + $3),
               completed = (LEAST(target_value, current_value + $3) >= target_value)
         WHERE player_id = $1
           AND task_type = $2
           AND completed = false
           AND expires_at > NOW()
        RETURNING id, current_value, target_value, completed, reward
    `, [playerId, taskType, delta]);

    const completed = result.rows.filter((r) => r.completed);
    const totalProgress = result.rows.reduce((sum, r) => sum + (r.current_value || 0), 0);

    return { updated: result.rows.length, completed, total_progress: totalProgress };
}

const CONTRACT_TYPES = [
    { type: 'hunt', target: (level) => Math.max(1, Math.floor(level / 10) + 1), reward: { coins: 200, xp: 100 }, difficulty: 'hard', reputation: 10, targetType: 'boss_kill' },
    { type: 'rescue', target: (level) => Math.max(1, Math.floor(level / 5) + 1), reward: { coins: 150, xp: 75 }, difficulty: 'medium', reputation: 8, targetType: 'boss_damage' },
    { type: 'rat_hunt', target: () => 10, reward: { coins: 50, xp: 20 }, difficulty: 'easy', reputation: 5, targetType: 'rat_kill' },
    { type: 'scout', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy', reputation: 3, targetType: 'locations_visited' },
    { type: 'gather', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy', reputation: 4, targetType: 'collect_items' },
];

/**
 * Обновление прогресса контракта выживания.
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {string} targetType - тип цели контракта
 * @param {number} amount - количество прогресса
 * @returns {Promise<{updated: number, completed: Array}>}
 */
async function progressContract(client, playerId, targetType, amount) {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta === 0) return { updated: 0, completed: [] };

    const result = await client.query(
        "UPDATE survivor_contracts SET current_value = LEAST(target_value, current_value + $3), completed = (LEAST(target_value, current_value + $3) >= target_value) WHERE player_id = $1 AND target_type = $2 AND completed = false AND claimed = false AND expires_at > NOW() RETURNING id, current_value, target_value, completed, reward",
        [playerId, targetType, delta]
    );

    const completed = result.rows.filter((r) => r.completed);
    return { updated: result.rows.length, completed };
}

// ==========================================
// Достижения (от achievements.js)
// ==========================================

/**
 * Текущее значение условия достижения.
 * @param {object} condition - условие достижения
 * @param {object} player - состояние игрока
 * @param {object} runtimeContext - контекст для расчета
 * @returns {number} текущее значение
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
        case 'radiation_level':
            return normalizeRadiationLevel(player.radiation) || 0;
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
 * Целевое значение достижения.
 * @param {object} condition - условие достижения
 * @param {object} runtimeContext - контекст для расчета
 * @returns {number} целевое значение
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
 * Контекст выполнения достижений (количество боссов и т.д.).
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @returns {Promise<Object>}
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
 * Проверка и разблокировка достижений игрока.
 * @param {number} playerId - ID игрока
 * @param {object} client - клиент БД (в транзакции)
 * @returns {Promise<Array>} только что разблокированные достижения
 */
async function checkAchievements(playerId, client = null) {
    try {
        const fn = client
            ? (sql, params) => client.query(sql, params)
            : (sql, params) => query(sql, params);

        // Загрузка всех достижений из БД.
        const achResult = await fn('SELECT * FROM achievements ORDER BY id', []);
        const achievements = achResult.rows || [];

        if (!achievements.length) return [];

        // Загрузка уже полученных достижений.
        const ownedResult = await fn(
            'SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND completed = true',
            [playerId]
        );
        const owned = new Set(ownedResult.rows?.map(r => r.achievement_id) || []);

        // Состояние игрока.
        const playerResult = await fn(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, unique_items, locations_visited,
                    clan_id, clan_role, clans_joined,
                    radiation
             FROM players WHERE id = $1`,
            [playerId]
        );
        const player = playerResult.rows?.[0];
        if (!player) return [];

        // Контекст выполнения достижений.
        const runtimeContext = await getAchievementRuntimeContext(client, playerId);

        const newAchievements = [];

        for (const ach of achievements) {
            if (owned.has(ach.id)) continue;

            const condition = safeJsonParse(ach.condition, {});
            if (!condition.type) continue;

            const currentValue = getAchievementCurrentValue(condition, player, runtimeContext);
            const targetValue = getAchievementTargetValue(condition, runtimeContext);

            if (currentValue >= targetValue) {
                // Разблокировка достижения (внутри транзакции или отдельно).
                const wasInserted = client
                    ? await insertAchievement(client, playerId, ach, currentValue)
                    : await transaction(async (txClient) => {
                        return await insertAchievement(txClient, playerId, ach, currentValue);
                    });

                if (wasInserted) {
                    const reward = safeJsonParse(ach.reward, {});
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
 * Разблокировка достижения (внутри транзакции).
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {object} ach - достижение
 * @param {number} progressValue - текущее значение прогресса
 * @returns {Promise<boolean>}
 */
async function insertAchievement(client, playerId, ach, progressValue) {
    const reward = safeJsonParse(ach.reward, {});

    // Вставка достижения игрока. ON CONFLICT — обновление.
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
 * Получение списка достижений игрока.
 * @param {number} playerId - ID игрока
 * @returns {Promise<Array>}
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
            req: safeJsonParse(row.condition, {}).count || 0,
            reward: safeJsonParse(row.reward, {}).stars || 0,
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
 * Получение прогресса игрока по категориям достижений.
 * @param {number} playerId - ID игрока
 * @returns {Promise<object|null>}
 */
async function getPlayerProgress(playerId) {
    try {
        const playerResult = await query(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, radiation
             FROM players WHERE id = $1`,
            [playerId]
        );

        if (!playerResult.rows.length) return null;

        const p = playerResult.rows[0];
        let runtimeContext = { totalBossesKilled: 0 };
        try {
            runtimeContext = await getAchievementRuntimeContext(null, playerId);
        } catch (_) { /* fallback */ }

        const progress = {
            level: { current: p.level, achievements: [] },
            boss: { current: runtimeContext.totalBossesKilled || p.bosses_killed || 0, achievements: [] },
            pvp: { current: p.pvp_wins || 0, achievements: [] },
            loot: { current: p.items_collected || 0, achievements: [] },
            streak: { current: p.daily_streak || 0, achievements: [] }
        };

        // Группировка достижений по категориям прогресса.
        const achievementsResult = await query('SELECT * FROM achievements ORDER BY id');
        const achievements = achievementsResult.rows || [];

        for (const ach of achievements) {
            const condition = safeJsonParse(ach.condition, {});
            const type = condition.type || '';
            const category = ach.category || '';

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
 * Начисление валюты игроку (монеты/звёзды) за награду достижения.
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {object} reward - { coins?: number, stars?: number }
 * @param {boolean} touchUpdatedAt - обновить updated_at
 * @returns {Promise<void>}
 */
async function grantCurrencyReward(client, playerId, reward, touchUpdatedAt = false) {
    if (!reward || typeof reward !== 'object') {
        return;
    }

    const coins = Math.max(0, Math.floor(Number(reward.coins) || 0));
    const stars = Math.max(0, Math.floor(Number(reward.stars) || 0));

    if (coins === 0 && stars === 0) {
        return; // нет награды
    }

    const updates = [];
    const params = [playerId];
    let paramIdx = 2;

    if (coins > 0) {
        updates.push(`coins = coins + $${paramIdx++}`);
        params.push(coins);
    }

    if (stars > 0) {
        updates.push(`stars = stars + $${paramIdx++}`);
        params.push(stars);
    }

    if (touchUpdatedAt) {
        updates.push('updated_at = NOW()');
    }

    if (updates.length > 0) {
        await client.query(
            `UPDATE players SET ${updates.join(', ')} WHERE id = $1`,
            params
        );
    }
}

/**
 * Получение награды за достижение.
 * @param {number} playerId - ID игрока
 * @param {number} achievementId - ID достижения
 * @returns {Promise<{success: boolean, message: string, new_balance: {coins: number, stars: number}}>}
 */
async function claimAchievementReward(playerId, achievementId) {
    return await transaction(async (client) => {
        // Загрузка достижения и его статуса у игрока.
        const achResult = await client.query(`
            SELECT a.id, a.name, a.reward, a.category,
                   pa.completed, pa.reward_claimed
            FROM achievements a
            LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
            WHERE a.id = $2
        `, [playerId, achievementId]);

        if (!achResult.rows.length) {
            throw { message: 'Достижение не найдено', code: 'ACHIEVEMENT_NOT_FOUND', statusCode: 404 };
        }

        const ach = achResult.rows[0];

        if (!ach.completed) {
            throw { message: 'Достижение не выполнено', code: 'NOT_COMPLETED', statusCode: 400 };
        }

        // Атомарное получение награды: только если reward_claimed = false.
        const claimed = await client.query(`
            UPDATE player_achievements
               SET reward_claimed = true, claimed_at = NOW()
             WHERE player_id = $1
               AND achievement_id = $2
               AND completed = true
               AND reward_claimed = false
            RETURNING achievement_id
        `, [playerId, achievementId]);

        if (claimed.rows.length === 0) {
            const current = await client.query(`
                SELECT completed, reward_claimed
                  FROM player_achievements
                 WHERE player_id = $1 AND achievement_id = $2
            `, [playerId, achievementId]);

            if (!current.rows[0]) {
                throw { message: 'Прогресс достижения не найден', code: 'ACHIEVEMENT_NOT_FOUND', statusCode: 404 };
            }
            if (!current.rows[0].completed) {
                throw { message: 'Достижение не выполнено', code: 'NOT_COMPLETED', statusCode: 400 };
            }
            throw { message: 'Награда уже получена', code: 'ALREADY_CLAIMED', statusCode: 400 };
        }

        // Начисление награды.
        const reward = safeJsonParse(ach.reward, {});
        const coins = Math.max(0, Math.floor(Number(reward.coins) || 0));
        const stars = Math.max(0, Math.floor(Number(reward.stars) || 0));

        if (coins > 0 || stars > 0) {
            await grantCurrencyReward(client, playerId, { coins, stars }, false);
        }

        // Логирование.
        await logPlayerAction(playerId, 'claim_achievement', {
            achievement_id: achievementId,
            coins,
            stars
        }, client);

        // Баланс после начисления.
        const balanceResult = await client.query(
            'SELECT coins, stars FROM players WHERE id = $1',
            [playerId]
        );

        return {
            message: `Награда за «${ach.name}» получена${coins > 0 ? ` (+${coins} монет)` : ''}${stars > 0 ? ` (+${stars} ★)` : ''}`,
            new_balance: {
                coins: Number(balanceResult.rows[0]?.coins || 0),
                stars: Number(balanceResult.rows[0]?.stars || 0)
            }
        };
    });
}

/**
 * Инициализация таблицы достижений (заполнение из seed/scheme).
 * @returns {Promise<number>} количество достижений
 */
async function initAchievementsTable() {
    const countResult = await query('SELECT COUNT(*) as cnt FROM achievements');
    const count = Number(countResult.rows[0]?.cnt || 0);

    if (count === 0) {
        logger.warn('[achievements] Таблица achievements пуста — заполните её из db/schema.js (миграция/seed).');
    }
    return count;
}

// ==========================================
// Инвентарь (выброс/потребление)
// ==========================================

/**
 * Потребление одного предмета из инвентаря (уменьшение количества на 1 или удаление).
 * @param {Array} inventory - массив предметов инвентаря
 * @param {number} itemIndex - индекс предмета
 * @returns {Object} { updatedInventory, item, quantityLeft }
 */
function consumeInventoryItem(inventory, itemIndex) {
    const item = inventory[itemIndex];
    if (!item) {
        return { updatedInventory: inventory, item: null, quantityLeft: 0 };
    }

    const rawQty = Number(item.quantity);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
        return { updatedInventory: inventory, item: null, quantityLeft: 0 };
    }
    const currentQty = rawQty;
    const remainingQty = currentQty - 1;

    const updatedInventory = [...inventory];

    if (remainingQty > 0) {
        updatedInventory[itemIndex] = { ...item, quantity: remainingQty };
    } else {
        updatedInventory.splice(itemIndex, 1);
    }

    return { updatedInventory, item, quantityLeft: remainingQty };
}

/**
 * Загрузка инвентаря из таблицы player_inventory (JSONB + таблица).
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @returns {Promise<Array|null>} массив предметов или null (fallback на JSONB)
 */
async function loadInventoryFromTable(client, playerId) {
    if (!client || !playerId) return null;
    try {
        const result = await client.query(
            'SELECT pi.item_id, pi.quantity, pi.durability, pi.max_durability, pi.upgrade_level, pi.modifications, pi.stats, i.name, i.type, i.category, i.rarity, i.icon, i.slot, i.price, i.ammo_type, i.max_stack, i.stackable, i.set_id FROM player_inventory pi JOIN items i ON i.id = pi.item_id WHERE pi.player_id = $1',
            [playerId]
        );
        if (result.rows.length === 0) return null; // fallback на JSONB
        return result.rows.map((row) => ({
            id: row.item_id,
            name: row.name,
            type: row.type,
            category: row.category,
            rarity: row.rarity,
            icon: row.icon,
            slot: row.slot,
            price: row.price,
            ammo_type: row.ammo_type,
            max_stack: row.max_stack,
            stackable: row.stackable,
            set_id: row.set_id,
            quantity: Number(row.quantity) || 0,
            durability: Number(row.durability) || 100,
            max_durability: Number(row.max_durability) || 100,
            upgrade_level: Number(row.upgrade_level) || 0,
            modifications: safeJsonParse(row.modifications, {}),
            stats: safeJsonParse(row.stats, {})
        }));
    } catch (e) {
        return null; // fallback на JSONB
    }
}

/**
 * Сохранение инвентаря и в JSONB, и в таблицу player_inventory.
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {Array} inventory - массив предметов
 */
async function saveInventoryBoth(client, playerId, inventory) {
    if (!client || !playerId || !Array.isArray(inventory)) return;
    // JSONB
    await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);
    // player_inventory
    await syncInventoryToTable(client, playerId, inventory);
}

/**
 * Синхронизация инвентаря в таблицу player_inventory.
 * @param {object} client - клиент БД
 * @param {number} playerId - ID игрока
 * @param {Array} inventory - массив предметов
 */
async function syncInventoryToTable(client, playerId, inventory) {
    if (!client || !playerId || !Array.isArray(inventory)) return;
    try {
        // Очистка таблицы.
        await client.query('DELETE FROM player_inventory WHERE player_id = $1', [playerId]);
        // Вставка предметов.
        for (const item of inventory) {
            if (!item || typeof item !== 'object') continue;
            const itemId = Number.isSafeInteger(Number(item.id)) ? Number(item.id) : null;
            if (itemId === null) continue;
            const qty = Math.max(0, Number(item.quantity) || 0);
            if (qty <= 0) continue;
            await client.query(
                `INSERT INTO player_inventory (player_id, item_id, quantity, durability, max_durability, upgrade_level, modifications, stats)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
                ON CONFLICT (player_id, item_id, upgrade_level, durability) DO UPDATE SET
                    quantity = player_inventory.quantity + EXCLUDED.quantity,
                    modifications = EXCLUDED.modifications,
                    stats = EXCLUDED.stats
            `, [
                playerId, itemId, qty,
                Number(item.durability) || 100,
                Number(item.max_durability) || 100,
                Number(item.upgrade_level) || 0,
                JSON.stringify(item.modifications || {}),
                JSON.stringify(item.stats || {})
            ]);
        }
    } catch (e) {
        // Ошибка синхронизации — не блокирующая.
    }
}

module.exports = {
    // SELL_FLOOR_BY_RARITY и SELL_RATE — публичные константы продажи,
    // их читает db/schema.js (repairPlayerInventories) и другие модули.
    SELL_FLOOR_BY_RARITY,
    SELL_RATE,
    // Нормализация состояния игрока.
    safeJsonParse,
    normalizeInventory,
    syncInventoryToTable,
    loadInventoryFromTable,
    saveInventoryBoth,
    createInventoryItem,
    normalizeRadiation,
    getActiveBuffs,
    buildPlayerStatus,
    recalcEnergy,
    regenerateHealth,
    normalizeEquipment,
    calculateSellPrice,
    addItemToInventory,

    // Нормализация предметов инвентаря и бонусы наборов.
    equipmentRules,
    getSetBonuses,
    wearEquipmentSlots,
    trackCollectedItems,
    progressDailyTask,
    progressContract,
    CONTRACT_TYPES,
    consumeInventoryItem,

    // Начисление валюты.
    grantCurrencyReward,

    // Система достижений.
    getAchievementCurrentValue,
    getAchievementTargetValue,
    getAchievementRuntimeContext,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    claimAchievementReward,
    initAchievementsTable
};
