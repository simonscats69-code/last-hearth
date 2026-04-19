/**
 * API дебаффов - система управления дебаффами
 * 
 * Функционал:
 * - Применение дебаффов (радиация, инфекции)
 * - Проверка дебаффов по таймеру
 * - Лечение дебаффов предметами
 * - Расчёт влияния на статы
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction: tx } = require('../../db/database');
const { logger, safeJsonParse, logPlayerAction } = require('../../utils/serverApi');
const { normalizeInventory } = require('../../utils/game-helpers');
const { 
    DEBUFF_TYPES, 
    DEBUFF_CONFIG, 
    DEBUFF_CURES,
    calculateDebuffModifiers,
    getDebuffTier
} = require('../../utils/gameConstants');

function createDebuffError(message, code, statusCode = 400) {
    return { message, code, statusCode };
}



/**
 * Safe JSON parse с fallback
 * Теперь импортируется из utils/jsonHelper.js
 */
// safeJsonParse теперь импортируется




const DebuffAPI = {
    /**
     * Применить дебафф к игроку
     * @param {number} playerId - ID игрока
     * @param {string} type - тип дебаффа (radiation, zombie_infection)
     * @param {number} level - уровень дебаффа
     * @param {object} options - дополнительные опции {source}
     */
    async apply(playerId, type, level, options = {}) {
        const config = DEBUFF_CONFIG[type];
        if (!config) {
            throw new Error(`Неизвестный тип дебаффа: ${type}`);
        }
        
        // Ограничиваем уровень
        level = Math.min(config.maxLevel, Math.max(config.minLevel, level));
        
        // playerId здесь - это внутренний id игрока (не telegram_id)
        return await tx(async (client) => {
            // Блокируем строку игрока по внутреннему id
            const playerResult = await client.query(
                `SELECT radiation, infections FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            const player = playerResult.rows[0];
            
            if (!player) {
                throw new Error('Игрок не найден');
            }
            
            const now = new Date();
            const baseDuration = config.baseDurationMs;
            const durationPerLevel = config.durationPerLevelMs;
            const expiresAt = new Date(now.getTime() + baseDuration + (level - 1) * durationPerLevel);
            
            if (type === DEBUFF_TYPES.RADIATION) {
                // Применяем/увеличиваем радиацию
                const currentRadiation = safeJsonParse(player.radiation, { level: 0 });
                const newLevel = Math.min(config.maxLevel, currentRadiation.level + level);
                
                await client.query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [JSON.stringify({
                        level: newLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString()
                    }), playerId]
                );
                
                await logPlayerAction(client, playerId, 'debuff_radiation_apply', {
                    oldLevel: currentRadiation.level,
                    newLevel,
                    source: options.source
                });
                
                return { type, oldLevel: currentRadiation.level, newLevel, expiresAt };
                
            } else if (type === DEBUFF_TYPES.INFECTION) {
                // Добавляем инфекцию в массив
                const infections = safeJsonParse(player.infections, []);
                
                // Проверяем, есть ли уже такая инфекция
                const existingIndex = infections.findIndex(i => i.type === type);
                let newInfections = [...infections];
                
                if (existingIndex >= 0) {
                    // Увеличиваем уровень существующей
                    const existing = newInfections[existingIndex];
                    const newLevel = Math.min(config.maxLevel, existing.level + level);
                    newInfections[existingIndex] = {
                        ...existing,
                        level: newLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString(),
                        source: options.source
                    };
                } else {
                    // Добавляем новую
                    newInfections.push({
                        type,
                        level,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString(),
                        source: options.source
                    });
                }
                
                await client.query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(newInfections), playerId]
                );
                
                await logPlayerAction(client, playerId, 'debuff_infection_apply', {
                    type,
                    level,
                    totalInfections: newInfections.reduce((s, i) => s + i.level, 0),
                    source: options.source
                });
                
                return { type, level, newInfections, expiresAt };
            }
        });
    },
    
    /**
     * Проверить дебаффы игрока (очистить истёкшие)
     * @param {number} playerId - ID игрока
     * @returns {Promise<object>} статус дебаффов
     */
    async check(playerId) {
        return await tx(async (client) => {
            const playerResult = await client.query(
                `SELECT radiation, infections, health FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            const player = playerResult.rows[0];
            
            if (!player) {
                throw new Error('Игрок не найден');
            }
            
            const now = new Date();
            const expired = [];
            const active = [];
            const warnings = [];
            
            // Проверяем радиацию
            const radiation = safeJsonParse(player.radiation, { level: 0, expires_at: null });
            if (radiation.level > 0 && radiation.expires_at) {
                const expiresAt = new Date(radiation.expires_at);
                if (expiresAt <= now) {
                    // Дебафф истёк
                    await client.query(
                        `UPDATE players SET radiation = $1 WHERE id = $2`,
                        [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]
                    );
                    expired.push('radiation');
                } else {
                    active.push({ type: 'radiation', level: radiation.level, expiresAt: radiation.expires_at });
                    
                    // Предупреждение если осталось менее 30 минут
                    const timeLeft = expiresAt - now;
                    if (timeLeft < 30 * 60 * 1000) {
                        warnings.push('radiation_expiring');
                    }
                }
            }
            
            // Проверяем инфекции
            const infections = safeJsonParse(player.infections, []);
            const validInfections = [];
            
            for (const inf of infections) {
                if (inf.expires_at) {
                    const expiresAt = new Date(inf.expires_at);
                    if (expiresAt <= now) {
                        expired.push(`infection_${inf.type}`);
                    } else {
                        validInfections.push(inf);
                        active.push({ type: inf.type, level: inf.level, expiresAt: inf.expires_at });
                        
                        // Предупреждение
                        const timeLeft = expiresAt - now;
                        if (timeLeft < 30 * 60 * 1000) {
                            warnings.push(`infection_${inf.type}_expiring`);
                        }
                    }
                } else {
                    validInfections.push(inf);
                    active.push({ type: inf.type, level: inf.level, expiresAt: null });
                }
            }
            
            // Обновляем инфекции если есть изменения
            if (validInfections.length !== infections.length) {
                await client.query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(validInfections), playerId]
                );
            }
            
            // Расчёт урона от дебаффов
            const totalDamage = this.calculateDebuffDamage(active);
            if (totalDamage > 0) {
                await client.query(
                    `UPDATE players SET health = GREATEST(0, health - $1) WHERE id = $2`,
                    [totalDamage, playerId]
                );
            }
            
            return { expired, active, warnings, damage: totalDamage };
        });
    },
    
    /**
     * Рассчитать урон от дебаффов
     * @param {Array} activeDebuffs - массив активных дебаффов
     * @returns {number} суммарный урон
     */
    calculateDebuffDamage(activeDebuffs) {
        let damage = 0;
        const now = new Date();
        
        for (const debuff of activeDebuffs) {
            if (!debuff.expiresAt) continue;
            
            const expiresAt = new Date(debuff.expiresAt);
            
            // Дебафф истёк - пропускаем (урон не наносится)
            if (expiresAt <= now) continue;
            
            const configKey = debuff.type === DEBUFF_TYPES.INFECTION ? 'infection' : debuff.type;
            const config = DEBUFF_CONFIG[configKey];
            if (!config) continue;

            if (debuff.type === DEBUFF_TYPES.RADIATION && debuff.level >= 5) {
                damage += Math.max(0, debuff.level - 4) * config.damagePerLevel;
            }

            if (debuff.type === DEBUFF_TYPES.INFECTION && debuff.level > 0 && Math.random() < 0.1) {
                damage += debuff.level * config.damagePerLevel;
            }
        }
        
        return Math.floor(damage);
    },
    
    /**
     * Получить активные дебаффы игрока
     */
    getActive(player) {
        const radiation = safeJsonParse(player.radiation, { level: 0, expires_at: null });
        const infections = safeJsonParse(player.infections, []);
        
        const active = [];
        
        if (radiation.level > 0) {
            active.push({
                type: 'radiation',
                level: radiation.level,
                expiresAt: radiation.expires_at,
                severity: getDebuffTier(radiation.level),
                name: 'Радиация',
                icon: '☢'
            });
        }
        
        const totalInfection = infections.reduce((sum, i) => sum + (i.level || 0), 0);
        if (totalInfection > 0) {
            active.push({
                type: 'zombie_infection',
                level: totalInfection,
                expiresAt: infections.reduce((max, i) => {
                    if (!i.expires_at) return max;
                    const exp = new Date(i.expires_at);
                    return exp > max ? exp : max;
                }, new Date(0)).toISOString(),
                severity: getDebuffTier(totalInfection),
                name: 'Инфекция',
                icon: '🦠'
            });
        }
        
        return active;
    },
    
    /**
     * Лечить дебафф предметом
     */
    async cure(playerId, cureType, itemId, itemIndex = null, options = {}) {
        const consumeItem = options.consumeItem !== false;
        const externalClient = options.client || null;

        const executor = async (client) => {
            // Получаем игрока и инвентарь
            const playerResult = await client.query(
                `SELECT radiation, infections, inventory FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            const player = playerResult.rows[0];
            
            if (!player) {
                throw createDebuffError('Игрок не найден', 'PLAYER_NOT_FOUND', 404);
            }
            
            // Ищем предмет в инвентаре
            const inventory = normalizeInventory(player.inventory);
            const resolvedItemIndex = Number.isInteger(itemIndex)
                ? itemIndex
                : inventory.findIndex(i => Number(i?.id) === Number(itemId));
            
            if (resolvedItemIndex < 0 || resolvedItemIndex >= inventory.length) {
                throw createDebuffError('Предмет не найден в инвентаре', 'ITEM_NOT_FOUND', 404);
            }
            
            const item = inventory[resolvedItemIndex];
            const itemStats = safeJsonParse(item.stats, item.stats && typeof item.stats === 'object' ? item.stats : {}) || {};

            let resolvedCureType = cureType;
            let cure = DEBUFF_CURES[resolvedCureType] || null;

            // Авто-режим подбирает силу лечения из реального предмета,
            // чтобы не завышать эффект при предметах со слабыми статами.
            if (!cure && (resolvedCureType === 'auto' || resolvedCureType === 'debuff')) {
                resolvedCureType = 'auto';
                cure = {
                    radiationReduction: Number(itemStats.radiation_cure || item.rad_removal || 0),
                    infectionReduction: Number(itemStats.infection_cure || item.infection_cure || 0)
                };
            }

            if (!cure) {
                throw createDebuffError(`Неизвестный тип лечения: ${cureType}`, 'INVALID_TYPE', 400);
            }
            
            // Проверяем, что предмет подходит для лечения
            const canCure = (cure.radiationReduction && Number(itemStats.radiation_cure || item.rad_removal || 0) > 0) ||
                           (cure.infectionReduction && Number(itemStats.infection_cure || item.infection_cure || 0) > 0);
            
            if (!canCure) {
                throw createDebuffError('Этот предмет не лечит дебаффы', 'INVALID_ITEM_TYPE', 400);
            }
            
            // Лечим радиацию
            if (cure.radiationReduction && Number(itemStats.radiation_cure || item.rad_removal || 0) > 0) {
                const radiation = safeJsonParse(player.radiation, { level: 0 });
                const newLevel = Math.max(0, radiation.level - cure.radiationReduction);
                
                // Пересчитываем время истечения
                let newExpiresAt = null;
                if (newLevel > 0 && radiation.expires_at && radiation.level > 0) {
                    const oldExpires = new Date(radiation.expires_at);
                    const now = new Date();
                    // Защита от деления на ноль: используем Math.max(1, ...) для уровня
                    const safeLevel = Math.max(1, radiation.level);
                    const reductionRatio = cure.radiationReduction / safeLevel;
                    const reduction = (oldExpires - now) * reductionRatio;
                    newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                }
                
                await client.query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [JSON.stringify({
                        level: newLevel,
                        expires_at: newExpiresAt,
                        applied_at: radiation.applied_at
                    }), playerId]
                );
                
                await logPlayerAction(client, playerId, 'debuff_cure_radiation', {
                    cureType: resolvedCureType,
                    oldLevel: radiation.level,
                    newLevel
                });
            }
            
            // Лечим инфекции
            if (cure.infectionReduction && Number(itemStats.infection_cure || item.infection_cure || 0) > 0) {
                const infections = safeJsonParse(player.infections, []);
                const remaining = [];
                
                for (const inf of infections) {
                    const newLevel = Math.max(0, inf.level - cure.infectionReduction);
                    if (newLevel > 0) {
                        // Пересчитываем время
                        let newExpiresAt = inf.expires_at;
                        if (inf.expires_at && inf.level > 0) {
                            const oldExpires = new Date(inf.expires_at);
                            const now = new Date();
                            // Защита от деления на ноль: используем Math.max(1, ...) для уровня
                            const safeLevel = Math.max(1, inf.level);
                            const reduction = (oldExpires - now) * (cure.infectionReduction / safeLevel);
                            newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                        }
                        remaining.push({ ...inf, level: newLevel, expires_at: newExpiresAt });
                    }
                }
                
                await client.query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(remaining), playerId]
                );
                
                await logPlayerAction(client, playerId, 'debuff_cure_infection', {
                    cureType: resolvedCureType,
                    removed: infections.length - remaining.length
                });
            }
            
            // Удаляем использованный предмет (по умолчанию),
            // опционально можно пропустить списание при внешней оркестрации.
            if (consumeItem) {
                inventory.splice(resolvedItemIndex, 1);
                await client.query(
                    `UPDATE players SET inventory = $1 WHERE id = $2`,
                    [JSON.stringify(inventory), playerId]
                );
            }
            
            return {
                success: true,
                cured: resolvedCureType,
                itemUsed: item.name
            };
        };

        if (externalClient) {
            return executor(externalClient);
        }

        return await tx(executor);
    },
    
    /**
     * Рассчитать модификаторы для игрока
     */
    getModifiers(player) {
        return calculateDebuffModifiers(player);
    }
};



/**
 * GET /debuffs/status - получить статус дебаффов
 */
router.get('/status', async (req, res) => {
    try {
        const player = req.player;

        // Получаем активные дебаффы
        const active = DebuffAPI.getActive(player);

        // Получаем модификаторы
        const modifiers = DebuffAPI.getModifiers(player);

        const warnings = active
            .filter((debuff) => debuff.expiresAt)
            .filter((debuff) => (new Date(debuff.expiresAt).getTime() - Date.now()) < 30 * 60 * 1000)
            .map((debuff) => `${debuff.type}_expiring`);
        
        res.json({
            success: true,
            debuffs: {
                radiation: safeJsonParse(player.radiation, { level: 0 }),
                infections: safeJsonParse(player.infections, []),
                active,
                modifiers,
                warnings,
                damage: 0
            }
        });
    } catch (error) {
        logger.error('[debuffs] Ошибка получения статуса', { error: error.message });
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * POST /debuffs/check - принудительная проверка дебаффов
 */
router.post('/check', async (req, res) => {
    try {
        const player = req.player;
        const result = await DebuffAPI.check(player.id);
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        logger.error('[debuffs] Ошибка проверки', { error: error.message });
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * POST /debuffs/cure - лечить дебафф предметом
 */
router.post('/cure', async (req, res) => {
    try {
        const { cureType, itemId, item_index } = req.body;
        const playerId = req.player.id;
        const normalizedItemIndex = item_index === undefined ? null : Number(item_index);
        
        // Валидация
        if (!cureType || (itemId === undefined && item_index === undefined)) {
            return res.status(400).json({
                success: false,
                error: 'cureType и itemId/item_index обязательны'
            });
        }

        const normalizedCureType = cureType === 'debuff' ? 'auto' : cureType;
        
        if (normalizedCureType !== 'auto' && !DEBUFF_CURES[normalizedCureType]) {
            return res.status(400).json({
                success: false,
                error: `Неверный тип лечения. Доступно: ${Object.keys(DEBUFF_CURES).join(', ')}`
            });
        }

        if (item_index !== undefined && !Number.isInteger(normalizedItemIndex)) {
            return res.status(400).json({
                success: false,
                error: 'item_index должен быть целым числом'
            });
        }
        
        const result = await DebuffAPI.cure(playerId, normalizedCureType, itemId, normalizedItemIndex);
        
        res.json({
            success: true,
            ...result,
            message: `Использован ${result.itemUsed}!`
        });
    } catch (error) {
        logger.error('[debuffs] Ошибка лечения', { error: error.message, code: error.code });
        // Различаем типы ошибок: валидация - 400, внутренние - 500
        const statusCode = error.statusCode || ((error.code && ['INVALID_TYPE', 'MISSING_ITEM_ID', 'ITEM_NOT_FOUND'].includes(error.code)) ? 400 : 500);
        res.status(statusCode).json({ success: false, error: error.message });
    }
});

/**
 * Внутренний API: применить дебафф
 * 
 * ВНИМАНИЕ: Этот endpoint УДАЛЕН из публичного API, так как позволяет
 * игрокам самостоятельно накладывать дебаффы, что нарушает игровой баланс.
 * 
 * Для применения дебаффов используйте DebuffAPI.apply() напрямую:
 * 
 *   const { DebuffAPI } = require('./debuffs');
 *   await DebuffAPI.apply(playerId, 'radiation', 3, { source: 'location_123' });
 * 
 * или вызывайте из других модулей:
 * 
 *   const { DebuffAPI } = require('./debuffs');
 *   await DebuffAPI.apply(playerId, 'zombie_infection', 2, { source: 'zombie_456' });
 */


// Экспорт для использования в других модулях
module.exports = { router, DebuffAPI };
