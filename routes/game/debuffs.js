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
const { transaction, queryOne } = require('../../db/database');
// logger раньше использовался только в удалённых HTTP-роутах. Ошибки из
// DebuffAPI ловит вызывающий: world.js отдаёт их в handleError.
const { safeJsonParse, logPlayerAction, handleError } = require('../../utils/serverApi');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { normalizeInventory, consumeInventoryItem } = helpers;
const {
    DEBUFF_TYPES,
    DEBUFF_CONFIG,
    DEBUFF_CURES,
    calculateDebuffModifiers,
    getDebuffTier,
    normalizeRadiationLevel,
    calculateRadiationDamage
} = require('../../utils/gameConstants');

function createDebuffError(message, code, statusCode = 400) {
    return { message, code, statusCode };
}



const DebuffAPI = {
    /**
     * Применить дебафф к игроку
     * @param {number} playerId - ID игрока
     * @param {string} type - тип дебаффа (только radiation — инфекции объединены с ним)
     * @param {number} level - уровень дебаффа
     * @param {object} options - дополнительные опции {source, client}
     *   client — внешний клиент транзакции; если передан, новая транзакция
     *   не открывается (защита от вложенных блокировок строки игрока)
     */
    async apply(playerId, type, level, options = {}) {
        const config = DEBUFF_CONFIG[type];
        if (!config) {
            throw new Error(`Неизвестный тип дебаффа: ${type}`);
        }

        // P2: уровень приводим к конечному числу ДО арифметики.
        //
        // Было: level = Math.min(config.maxLevel, Math.max(config.minLevel, level)).
        // При level = undefined/NaN/{} Math.min/Max c NaN дают NaN, далее
        // (level - 1) * durationPerLevel = NaN, expiresAt = Invalid Date,
        // и в JSONB уходит expires_at: null — радиация висит вечно,
        // а инфекция даёт 0 урона навсегда.
        const numericLevel = Number(level);
        if (!Number.isFinite(numericLevel)) {
            throw new Error(`Некорректный уровень дебаффа: ${level}`);
        }
        level = Math.min(config.maxLevel, Math.max(config.minLevel, numericLevel));

        const executor = async (client) => {
            // Блокируем строку игрока по внутреннему id
            const playerResult = await client.query(
                `SELECT radiation FROM players WHERE id = $1 FOR UPDATE`,
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
                
                await logPlayerAction(playerId, 'debuff_radiation_apply', {
                    oldLevel: currentRadiation.level,
                    newLevel,
                    source: options.source
                }, client);
                
                return { type, oldLevel: currentRadiation.level, newLevel, expiresAt };
            }

            // Единственный тип дебаффа — радиация. Прежняя ветка
            // DEBUFF_TYPES.INFECTION писала в players.infections отдельным
            // массивом; теперь зона даёт одно заражение в players.radiation.
            throw new Error(`Неизвестный тип дебаффа: ${type}`);
        };

        if (options.client) {
            return executor(options.client);
        }

        return await transaction(executor);
    },
    
    /**
     * Проверить дебаффы игрока (очистить истёкшие)
     * @param {number} playerId - ID игрока
     * @returns {Promise<object>} статус дебаффов
     */
    async check(playerId) {
        return await transaction(async (client) => {
            const playerResult = await client.query(
                `SELECT radiation, health FROM players WHERE id = $1 FOR UPDATE`,
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
            const radiation = safeJsonParse(player.radiation, { level: 0, expires_at: null, applied_at: null });
            if (radiation.level > 0 && radiation.expires_at) {
                const expiresAt = new Date(radiation.expires_at);
                if (expiresAt <= now) {
                    // Дебафф истёк по времени
                    await client.query(
                        `UPDATE players SET radiation = $1 WHERE id = $2`,
                        [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]
                    );
                    expired.push('radiation');
                } else {
                    // Естественное затухание: снижаем уровень на 1 каждые regenRateMs (30 мин)
                    const config = DEBUFF_CONFIG.radiation;
                    const lastDecay = radiation.last_decay_at ? new Date(radiation.last_decay_at) : (radiation.applied_at ? new Date(radiation.applied_at) : now);
                    const elapsedMs = now - lastDecay;
                    const decaySteps = Math.floor(elapsedMs / config.regenRateMs);
                    
                    if (decaySteps > 0) {
                        const newLevel = Math.max(0, radiation.level - decaySteps);
                        let newExpiresAt = null;
                        if (newLevel > 0) {
                            // Считаем expires_at от исходного applied_at, а не от now,
                            // чтобы затухание не продлевало общий срок жизни радиации.
                            const appliedAt = radiation.applied_at ? new Date(radiation.applied_at) : now;
                            const totalDurationMs = config.baseDurationMs + (newLevel - 1) * config.durationPerLevelMs;
                            const newExpires = new Date(appliedAt.getTime() + totalDurationMs);
                            newExpiresAt = newExpires.toISOString();
                        }
                        
                        await client.query(
                            `UPDATE players SET radiation = $1 WHERE id = $2`,
                            [JSON.stringify({
                                level: newLevel,
                                expires_at: newExpiresAt,
                                applied_at: radiation.applied_at,
                                last_decay_at: now.toISOString()
                            }), playerId]
                        );
                        radiation.level = newLevel;
                        radiation.expires_at = newExpiresAt;
                    }
                    
                    if (radiation.level > 0) {
                        active.push({ type: 'radiation', level: radiation.level, expiresAt: radiation.expires_at });
                        
                        // Предупреждение если осталось менее 30 минут
                        const timeLeft = new Date(radiation.expires_at) - now;
                        if (timeLeft < 30 * 60 * 1000) {
                            warnings.push('radiation_expiring');
                        }
                    } else {
                        expired.push('radiation');
                    }
                }
            }
            
            // Проверяем заражение: единственный дебафф — радиация.
            // Прежний блок проверки players.infections (массив с expires_at
            // по каждому элементу) удалён вместе с инфекциями.
            
            // Расчёт урона от дебаффа.
            // P2: this.calculateDebuffDamage(...) ломался при деструктуризации
            // (`const { apply } = require('./debuffs').DebuffAPI`) — this терялся
            // и метод был недоступен. Вызываем через DebuffAPI явно.
            const totalDamage = DebuffAPI.calculateDebuffDamage(active);
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
     *
     * Единственный дебафф — радиация. Урон начинается с 5 уровня:
     * (level - 4) * damagePerLevel. Прежняя ветка инфекции (10% шанс ×
     * уровень × 2) удалена вместе с infection: порог и коэффициент
     * захардкоживались в двух местах статуса и здесь.
     *
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
            
            if (debuff.type !== DEBUFF_TYPES.RADIATION) continue;

            const config = DEBUFF_CONFIG.radiation;
            if (!config) continue;

            // Формула и порог урона — та же, что в status.js /check:
            // обе вынесены в utils/gameConstants.js calculateRadiationDamage.
            damage += calculateRadiationDamage(debuff.level, config.damagePerLevel);
        }
        
        return Math.floor(damage);
    },
    
    /**
     * Получить активные дебаффы игрока
     *
     * Только радиация: инфекции объединены с ней.
     */
    getActive(player) {
        // Тот же парсер, что и в status.js /check: три формата хранения
        // радиации (объект/число/строка-JSON) живут в одной функции
        // utils/gameConstants.js.
        const radiationObj = typeof player.radiation === 'object' && player.radiation !== null
            ? player.radiation
            : safeJsonParse(player.radiation, {});
        const level = normalizeRadiationLevel(player.radiation);

        const active = [];

        if (level > 0) {
            active.push({
                type: DEBUFF_TYPES.RADIATION,
                level,
                expiresAt: radiationObj.expires_at || null,
                severity: getDebuffTier(level),
                name: 'Радиация',
                icon: '☢'
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
                `SELECT radiation, inventory FROM players WHERE id = $1 FOR UPDATE`,
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
            //
            // Один источник силы лечения: contamination_cure (radiation_cure /
            // rad_removal). Прежняя пара radiationReduction /
            // infectionReduction склеена в одно, поэтому Антидот и всё
            // остальное лечит радиацию одинаково.
            if (!cure && (resolvedCureType === 'auto' || resolvedCureType === 'debuff')) {
                resolvedCureType = 'auto';
                cure = {
                    contaminationReduction: Number(itemStats.radiation_cure || item.rad_removal || 0)
                };
            }

            if (!cure) {
                throw createDebuffError(`Неизвестный тип лечения: ${cureType}`, 'INVALID_TYPE', 400);
            }

            // Нормализуем поле: у auto-режима contaminationReduction,
            // у таблицы DEBUFF_CURES — radiationReduction.
            const curePower = Number(
                cure.contaminationReduction !== undefined
                    ? cure.contaminationReduction
                    : cure.radiationReduction
            );
            
            // Проверяем, что предмет подходит для лечения
            const itemPower = Number(itemStats.radiation_cure || item.rad_removal || 0);
            if (!(curePower > 0) || !(itemPower > 0)) {
                throw createDebuffError('Этот предмет не лечит дебаффы', 'INVALID_ITEM_TYPE', 400);
            }
            
            // Лечим заражение: снижаем уровень и пропорционально укорачиваем
            // срок действия. Один блок вместо прежних «лечим радиацию» и
            // «лечим инфекции».
            {
                const radiation = safeJsonParse(player.radiation, { level: 0 });
                const newLevel = Math.max(0, radiation.level - curePower);
                
                // Пересчитываем время истечения
                let newExpiresAt = null;
                if (newLevel > 0 && radiation.expires_at && radiation.level > 0) {
                    const oldExpires = new Date(radiation.expires_at);
                    const now = new Date();
                    // Защита от деления на ноль: используем Math.max(1, ...) для уровня
                    const safeLevel = Math.max(1, radiation.level);
                    const reductionRatio = curePower / safeLevel;
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
                
                await logPlayerAction(playerId, 'debuff_cure_radiation', {
                    cureType: resolvedCureType,
                    oldLevel: radiation.level,
                    newLevel
                }, client);
            }
            
            if (consumeItem) {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, resolvedItemIndex);

                await client.query(
                    `UPDATE players SET inventory = $1 WHERE id = $2`,
                    [JSON.stringify(updatedInventory), playerId]
                );

                return {
                    success: true,
                    cured: resolvedCureType,
                    itemUsed: item.name,
                    quantityLeft: quantityLeft
                };
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

        return await transaction(executor);
    },
    
    /**
     * Рассчитать модификаторы для игрока
     */
    getModifiers(player) {
        return calculateDebuffModifiers(player);
    }
};

// ============================================
// HTTP-МАРШРУТЫ ДЕБАФФОВ
// ============================================

/**
 * POST /debuffs/apply — применить дебафф к игроку (радиация)
 * Тело: { type, level, source }
 */
router.post('/apply', async (req, res) => {
    const playerId = req.player?.id;
    const { type, level, source } = req.body || {};
    try {
        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Не авторизован', code: 'UNAUTHORIZED' });
        }
        const result = await DebuffAPI.apply(playerId, type || DEBUFF_TYPES.RADIATION, Number(level) || 1, { source });
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_apply', playerId);
    }
});

/**
 * GET /debuffs/check — проверить дебаффы игрока (очистить истёкшие, применить урон)
 */
router.get('/check', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Не авторизован', code: 'UNAUTHORIZED' });
        }
        const result = await DebuffAPI.check(playerId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_check', playerId);
    }
});

/**
 * GET /debuffs/active — получить активные дебаффы игрока
 */
router.get('/active', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Не авторизован', code: 'UNAUTHORIZED' });
        }
        const playerResult = await queryOne('SELECT radiation FROM players WHERE id = $1', [playerId]);
        if (!playerResult) {
            return res.status(404).json({ success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' });
        }
        const active = DebuffAPI.getActive(playerResult);
        return res.json({ success: true, data: { active } });
    } catch (error) {
        return handleError(res, error, 'debuff_active', playerId);
    }
});

/**
 * POST /debuffs/cure — вылечить дебафф предметом
 * Тело: { cureType, itemId, itemIndex }
 */
router.post('/cure', async (req, res) => {
    const playerId = req.player?.id;
    const { cureType, itemId, itemIndex } = req.body || {};
    try {
        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Не авторизован', code: 'UNAUTHORIZED' });
        }
        const result = await DebuffAPI.cure(playerId, cureType || 'auto', itemId, itemIndex);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_cure', playerId);
    }
});

// Экспорт: DebuffAPI для внутренних модулей, router для подключения в index.js
module.exports = { DebuffAPI, router };
