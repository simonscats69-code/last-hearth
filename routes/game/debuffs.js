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
const { query, queryOne, tx } = require('../../db/database');
const { logger } = require('../../utils/logger');
const { 
    DEBUFF_TYPES, 
    DEBUFF_CONFIG, 
    DEBUFF_EFFECTS, 
    DEBUFF_CURES,
    calculateDebuffModifiers,
    calculateRadiationDefense 
} = require('../../utils/gameConstants');

// =============================================================================
// УТИЛИТЫ
// =============================================================================

/**
 * Safe JSON parse с fallback
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        console.error('JSON.parse failed:', typeof value, String(value).substring(0, 100));
        return fallback;
    }
}

/**
 * Логирование действия игрока
 */
async function logPlayerAction(playerId, action, metadata = {}) {
    try {
        await query(
            `INSERT INTO player_logs (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, JSON.stringify(metadata)]
        );
    } catch (err) {
        logger.warn(`[debuffs] Логирование не удалось: ${err.message}`);
    }
}

// =============================================================================
// API ДЕБАФФОВ
// =============================================================================

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
        
        return await tx(async () => {
            // Блокируем строку игрока
            const player = await queryOne(
                `SELECT radiation, infections FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
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
                
                await query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [{
                        level: newLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString()
                    }, playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_radiation_apply', {
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
                
                await query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(newInfections), playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_infection_apply', {
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
        return await tx(async () => {
            const player = await queryOne(
                `SELECT radiation, infections, health FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
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
                    await query(
                        `UPDATE players SET radiation = $1 WHERE id = $2`,
                        [{ level: 0, expires_at: null, applied_at: null }, playerId]
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
                await query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(validInfections), playerId]
                );
            }
            
            // Расчёт урона от дебаффов
            const totalDamage = this.calculateDebuffDamage(active, player.health);
            if (totalDamage > 0) {
                await query(
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
            
            // Дебафф активен - наносим урон если уровень >= 5
            const config = DEBUFF_CONFIG[debuff.type];
            if (config && debuff.level >= 5) {
                damage += config.damagePerLevel;
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
                name: 'Инфекция',
                icon: '🦠'
            });
        }
        
        return active;
    },
    
    /**
     * Лечить дебафф предметом
     */
    async cure(playerId, cureType, itemId) {
        const cure = DEBUFF_CURES[cureType];
        if (!cure) {
            throw new Error(`Неизвестный тип лечения: ${cureType}`);
        }
        
        return await tx(async () => {
            // Получаем игрока и инвентарь
            const player = await queryOne(
                `SELECT radiation, infections, inventory FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!player) {
                throw new Error('Игрок не найден');
            }
            
            // Ищем предмет в инвентаре
            const inventory = safeJsonParse(player.inventory, []);
            const itemIndex = inventory.findIndex(i => i.id === itemId);
            
            if (itemIndex < 0) {
                throw new Error('Предмет не найден в инвентаре');
            }
            
            const item = inventory[itemIndex];
            
            // Проверяем, что предмет подходит для лечения
            const canCure = (cure.radiationReduction && item.stats?.radiation_cure) ||
                           (cure.infectionReduction && item.stats?.infection_cure);
            
            if (!canCure) {
                throw new Error('Этот предмет не лечит дебаффы');
            }
            
            // Лечим радиацию
            if (cure.radiationReduction && item.stats?.radiation_cure) {
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
                
                await query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [{
                        level: newLevel,
                        expires_at: newExpiresAt,
                        applied_at: radiation.applied_at
                    }, playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_cure_radiation', {
                    cureType,
                    oldLevel: radiation.level,
                    newLevel
                });
            }
            
            // Лечим инфекции
            if (cure.infectionReduction && item.stats?.infection_cure) {
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
                
                await query(
                    `UPDATE players SET infections = $1 WHERE id = $2`,
                    [JSON.stringify(remaining), playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_cure_infection', {
                    cureType,
                    removed: infections.length - remaining.length
                });
            }
            
            // Удаляем использованный предмет
            inventory.splice(itemIndex, 1);
            await query(
                `UPDATE players SET inventory = $1 WHERE id = $2`,
                [JSON.stringify(inventory), playerId]
            );
            
            return {
                success: true,
                cured: cureType,
                itemUsed: item.name
            };
        });
    },
    
    /**
     * Рассчитать модификаторы для игрока
     */
    getModifiers(player) {
        return calculateDebuffModifiers(player);
    }
};

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /debuffs/status - получить статус дебаффов
 */
router.get('/status', async (req, res) => {
    try {
        const player = req.player;
        
        // Проверяем дебаффы
        const checkResult = await DebuffAPI.check(player.id);
        
        // Получаем активные дебаффы
        const active = DebuffAPI.getActive(player);
        
        // Получаем модификаторы
        const modifiers = DebuffAPI.getModifiers(player);
        
        res.json({
            success: true,
            debuffs: {
                radiation: safeJsonParse(player.radiation, { level: 0 }),
                infections: safeJsonParse(player.infections, []),
                active,
                modifiers,
                warnings: checkResult.warnings,
                damage: checkResult.damage
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
        const { cureType, itemId } = req.body;
        const playerId = req.player.id;
        
        // Валидация
        if (!cureType || !itemId) {
            return res.status(400).json({
                success: false,
                error: 'cureType и itemId обязательны'
            });
        }
        
        if (!DEBUFF_CURES[cureType]) {
            return res.status(400).json({
                success: false,
                error: `Неверный тип лечения. Доступно: ${Object.keys(DEBUFF_CURES).join(', ')}`
            });
        }
        
        const result = await DebuffAPI.cure(playerId, cureType, itemId);
        
        res.json({
            success: true,
            ...result,
            message: `Использован ${result.itemUsed}!`
        });
    } catch (error) {
        logger.error('[debuffs] Ошибка лечения', { error: error.message, code: error.code });
        // Различаем типы ошибок: валидация - 400, внутренние - 500
        const statusCode = error.statusCode || (error.code && ['INVALID_TYPE', 'MISSING_ITEM_ID', 'ITEM_NOT_FOUND'].includes(error.code)) ? 400 : 500;
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
// router.post('/apply', ...) - УДАЛЕН: см. комментарий выше

// Экспорт для использования в других модулях
module.exports = { router, DebuffAPI };
