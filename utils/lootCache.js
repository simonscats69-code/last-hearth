/**
 * Кэш пула предметов для быстрого случайного выбора лута
 * Используется world.js для поиска лута в локациях
 */

const { queryAll, describeError } = require('../db/database');
const { logger } = require('./serverApi');

// Кэш пула предметов по rarity:type для быстрого случайного выбора
const lootPoolCache = {};
let lootCacheReady = false;

const LOOT_CACHE_MAX_ATTEMPTS = 10;
let lootCacheAttempts = 0;

function getLootTypePool(locationId) {
    const normalizedLocationId = Number(locationId || 1);

    if (normalizedLocationId <= 1) {
        return ['food', 'medicine', 'resource', 'weapon'];
    }

    if (normalizedLocationId <= 3) {
        return ['food', 'medicine', 'resource', 'weapon', 'armor'];
    }

    if (normalizedLocationId <= 5) {
        return ['weapon', 'armor', 'medicine', 'resource', 'food'];
    }

    return ['weapon', 'armor', 'medicine', 'resource', 'food'];
}

async function buildLootCache() {
    try {
        const rows = await queryAll(`SELECT id, rarity, type FROM items WHERE type != 'key'`);
        for (const r of rows) {
            const key = `${r.rarity}:${r.type}`;
            if (!lootPoolCache[key]) lootPoolCache[key] = [];
            lootPoolCache[key].push(r.id);
        }
        lootCacheReady = true;
        lootCacheAttempts = 0;
        logger.info('[lootCache] pool built', { size: rows.length });
    } catch (err) {
        lootCacheAttempts++;
        logger.error('[lootCache] build failed', {
            attempt: lootCacheAttempts,
            error: describeError(err)
        });
        if (lootCacheAttempts < LOOT_CACHE_MAX_ATTEMPTS) {
            const delay = Math.min(5000 * Math.pow(2, lootCacheAttempts - 1), 60000);
            setTimeout(buildLootCache, delay);
        } else {
            logger.error('[lootCache] max attempts exceeded, pool empty');
        }
    }
}

function getRandomLootItemFromPool(rarity, locationId) {
    if (!lootCacheReady) return null;

    const preferredTypes = getLootTypePool(locationId);
    const candidates = [];
    for (const t of preferredTypes) {
        const pool = lootPoolCache[`${rarity}:${t}`];
        if (pool && pool.length) candidates.push(...pool);
    }

    if (!candidates.length) {
        // Fallback: любой тип этой редкости
        for (const pool of Object.values(lootPoolCache)) {
            if (pool.length) candidates.push(...pool);
        }
    }

    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function clearLootCache() {
    for (const key of Object.keys(lootPoolCache)) {
        delete lootPoolCache[key];
    }
    lootCacheReady = false;
    lootCacheAttempts = 0;
}

/**
 * Инициализация кэша лута.
 * Вызывать ПОСЛЕ подключения к БД (initDatabase()).
 * @returns {Promise<void>}
 */
async function init() {
    await buildLootCache();
}

module.exports = {
    lootPoolCache,
    getLootCacheReady: () => lootCacheReady,
    buildLootCache,
    init,
    getLootTypePool,
    getRandomLootItemFromPool,
    clearLootCache
};