/**
 * API дебаффов — получение, лечение и модификаторы дебаффов.
 *
 * Эндпоинты:
 * - наложение дебаффа (радиация, инфекция)
 * - получение дебаффа по NPC
 * - лечение дебаффа предметами
 * - модификаторы дебаффов для игрока
 */

const express = require('express');
const router = express.Router();
const { transaction, queryOne } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
// Логирование działa внутри serverApi; DebuffAPI не отвечает за HTTP-ответы.
const { safeJsonParse, logPlayerAction, handleError, unauthorized, notFound } = require('../../utils/serverApi');

// Загрузка игровых хелперов из utils/game-helpers.js (инвентарь и т.д.).
// Работа с БД — через db/database, исключаем циклы зависимостей.
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Экземпляр хелперов (создаётся один раз при загрузке модуля).
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
     * Наложение дебаффа на игрока.
     * @param {number} playerId - ID игрока
     * @param {string} type - тип дебаффа (radiation или infection)
     * @param {number} level - уровень дебаффа
     * @param {object} options - доп. опции {source, client}
     *   client — существующий клиент транзакции; если не передан, создаётся новая.
     */
    async apply(playerId, type, level, options = {}) {
        const config = DEBUFF_CONFIG[type];
        if (!config) {
            throw { message: `Неизвестный тип дебаффа: ${type}`, code: 'UNKNOWN_DEBUFF', statusCode: 400 };
        }

        // Уровень ограничивается minLevel/maxLevel из конфига.
        // На вход undefined/NaN/{} — Math.min/Max даст NaN, и expiresAt станет невалидным.
        // Поэтому проверяем Number.isFinite перед использованием.
        const numericLevel = Number(level);
        if (!Number.isFinite(numericLevel)) {
            throw { message: `Некорректный уровень дебаффа: ${level}`, code: 'INVALID_DEBUFF_LEVEL', statusCode: 400 };
        }
        level = Math.min(config.maxLevel, Math.max(config.minLevel, numericLevel));

        const executor = async (client) => {
            // Блокировка игрока по строгому порядку ID (защита от deadlock).
            const player = await lockPlayer(playerId, client, 'radiation');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const now = new Date();
            const baseDuration = config.baseDurationMs;
            const durationPerLevel = config.durationPerLevelMs;
            const expiresAt = new Date(now.getTime() + baseDuration + (level - 1) * durationPerLevel);

            if (type === DEBUFF_TYPES.RADIATION) {
                // Накопление уровня радиации.
                const currentLevel = normalizeRadiationLevel(player.radiation);
                const newLevel = Math.min(config.maxLevel, currentLevel + Number(level || 0));

                await client.query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [JSON.stringify({
                        level: newLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString()
                    }), playerId]
                );

                await logPlayerAction(playerId, 'debuff_radiation_apply', {
                    oldLevel: currentLevel,
                    newLevel,
                    source: options.source
                }, client);

                return { type, oldLevel: currentLevel, newLevel, expiresAt };
            }

            // Остальные типы дебаффов пока не реализованы.
            throw { message: `Неизвестный тип дебаффа: ${type}`, code: 'UNKNOWN_DEBUFF', statusCode: 400 };
        };

        if (options.client) {
            return executor(options.client);
        }

        return await transaction(executor);
    },

    /**
     * Проверка активных дебаффов игрока (с учётом истечения срока).
     * @param {number} playerId - ID игрока
     * @returns {Promise<object>} данные по дебаффам
     */
    async check(playerId) {
        return await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'radiation, health');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const now = new Date();
            const expired = [];
            const active = [];
            const warnings = [];

            // Проверка радиации.
            const radiation = safeJsonParse(player.radiation, { level: 0, expires_at: null, applied_at: null });
            const radiationLevel = normalizeRadiationLevel(radiation);
            if (radiationLevel > 0 && radiation.expires_at) {
                const expiresAt = new Date(radiation.expires_at);
                if (!Number.isFinite(expiresAt.getTime())) {
                    await client.query(`UPDATE players SET radiation = $1 WHERE id = $2`, [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]);
                    expired.push('radiation');
                } else if (expiresAt <= now) {
                    // Дебафф истёк — сбрасываем.
                    await client.query(
                        `UPDATE players SET radiation = $1 WHERE id = $2`,
                        [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]
                    );
                    expired.push('radiation');
                } else {
                    // Естественное затухание: decaySteps раз по regenRateMs (30 сек).
                    const config = DEBUFF_CONFIG.radiation;
                    const lastDecay = radiation.last_decay_at ? new Date(radiation.last_decay_at) : (radiation.applied_at ? new Date(radiation.applied_at) : now);
                    const elapsedMs = now - lastDecay;
                    const decaySteps = Math.floor(elapsedMs / config.regenRateMs);

                    if (decaySteps > 0) {
                        const newLevel = Math.max(0, radiationLevel - decaySteps);
                        let newExpiresAt = null;
                        if (newLevel > 0) {
                            // Пересчитываем expires_at от applied_at, а не от now,
                            // иначе затухание будет сдвигать срок действия вперёд.
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

                        // Предупреждение: осталось меньше 30 минут.
                        const timeLeft = new Date(radiation.expires_at) - now;
                        if (timeLeft < 30 * 60 * 1000) {
                            warnings.push('radiation_expiring');
                        }
                    } else {
                        expired.push('radiation');
                    }
                }
            }

            // Проверка инфекции (хранится в players.infections).
            // Расчёт урона от дебаффов.
            const totalDamage = DebuffAPI.calculateDebuffDamage(active);
            if (totalDamage > 0) {
                await client.query(
                    `UPDATE players SET health = GREATEST(0, COALESCE(health,0) - $1) WHERE id = $2`,
                    [totalDamage, playerId]
                );
            }

            return { expired, active, warnings, damage: totalDamage };
        });
    },

    /**
     * Расчёт общего урона от активных дебаффов.
     *
     * Формула радиации: (level - 4) * damagePerLevel (минимум 10% от максимума HP).
     * Урон от инфекции считается отдельно.
     *
     * @param {Array} activeDebuffs - список активных дебаффов
     * @returns {number} общий урон
     */
    calculateDebuffDamage(activeDebuffs) {
        if (!activeDebuffs) return 0;
        let damage = 0;
        const now = new Date();

        for (const debuff of activeDebuffs) {
            if (!debuff.expiresAt) continue;

            const expiresAt = new Date(debuff.expiresAt);
            if (!Number.isFinite(expiresAt.getTime())) continue;

            // Дебафф истёк — урона нет.
            if (expiresAt <= now) continue;

            if (debuff.type !== DEBUFF_TYPES.RADIATION) continue;

            const config = DEBUFF_CONFIG.radiation;
            if (!config) continue;

            // Урон считается как в status.js /check:
            // см. calculateRadiationDamage в utils/gameConstants.js.
            damage += calculateRadiationDamage(debuff.level, config.damagePerLevel);
        }

        return Math.floor(damage);
    },

    /**
     * Активные дебаффы игрока для отображения.
     *
     * Для отображения: радиация — единственный показанный тип.
     */
    getActive(player) {
        if (!player) return [];
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
     * Лечение дебаффа предметом.
     */
    async cure(playerId, cureType, itemId, itemIndex = null, options = {}) {
        const consumeItem = options.consumeItem !== false;
        const externalClient = options.client || null;

        const executor = async (client) => {
            // Блокировка игрока и инвентаря.
            const player = await lockPlayer(playerId, client, 'radiation, inventory');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            // Поиск предмета в инвентаре.
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

            // Авто-определение типа лечения по свойствам предмета.
            // Если cureType 'auto' или 'debuff', ищем подходящий cure по radiation_cure / rad_removal.
            if (!cure && (resolvedCureType === 'auto' || resolvedCureType === 'debuff')) {
                resolvedCureType = 'auto';
                cure = {
                    contaminationReduction: Number(itemStats.radiation_cure || item.rad_removal || 0)
                };
            }

            if (!cure) {
                throw createDebuffError(`Неизвестный тип лечения: ${cureType}`, 'INVALID_TYPE', 400);
            }

            // Силa лечения: contaminationReduction или radiationReduction.
            const curePower = Number(
                cure.contaminationReduction !== undefined
                    ? cure.contaminationReduction
                    : cure.radiationReduction
            ) || 0;

            // Сила самого предмета.
            const itemPower = Number(itemStats.radiation_cure || item.rad_removal || 0);
            if (!(curePower > 0) || !(itemPower > 0)) {
                throw createDebuffError('Предмет не лечит дебафф', 'INVALID_ITEM_TYPE', 400);
            }

            const radiation = safeJsonParse(player.radiation, { level: 0 });
            const radiationLevel = normalizeRadiationLevel(radiation);

            // Лечение только если есть активный дебафф.
            if (radiationLevel <= 0) {
                throw { message: 'Активный дебафф для лечения не найден', code: 'NO_ACTIVE_DEBUFF', statusCode: 400 };
            }

            // Эффективное затухание: минимум из силы лечения и предмета.
            {
                const effectiveCure = Math.min(curePower, itemPower);
                const newLevel = Math.max(0, radiationLevel - effectiveCure);

                let newExpiresAt = null;
                if (newLevel > 0 && radiation.expires_at && radiationLevel > 0) {
                    const oldExpires = new Date(radiation.expires_at);
                    const now = new Date();
                    if (Number.isFinite(oldExpires.getTime())) {
                        // Безопасный уровень ≥ 1, чтобы не делить на ноль.
                        const safeLevel = Math.max(1, radiationLevel);
                        const reductionRatio = effectiveCure / safeLevel;
                        const reduction = (oldExpires.getTime() - now.getTime()) * reductionRatio;
                        newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                    }
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
                    oldLevel: radiationLevel,
                    newLevel
                }, client);
            }

            if (consumeItem) {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, resolvedItemIndex);

                await client.query(
                    `UPDATE players SET inventory = $1 WHERE id = $2`,
                    [JSON.stringify(updatedInventory), playerId]
                );

                // Синхронизация инвентаря в таблицу player_inventory.
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, updatedInventory);
                } catch (_) { /* ignore */ }

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
     * Модификаторы дебаффов игрока.
     */
    getModifiers(player) {
        return calculateDebuffModifiers(player);
    }
};

// ============================================
// HTTP-маршруты (DebuffAPI + роутер)
// ============================================

/**
 * POST /debuffs/apply — наложение дебаффа на игрока (радиация).
 * Тело: { type, level, source }
 */
router.post('/apply', async (req, res) => {
    const playerId = req.player?.id;
    const { type, level, source } = req.body || {};
    try {
        if (!playerId) {
            return unauthorized(res, 'Нет авторизации');
        }
        const result = await DebuffAPI.apply(playerId, type || DEBUFF_TYPES.RADIATION, Number(level) || 1, { source });
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_apply', playerId);
    }
});

/**
 * POST /debuffs/check — проверка активных дебаффов игрока.
 * Поддерживает Idempotency-Key.
 */
router.post('/check', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return unauthorized(res, 'Нет авторизации');
        }
        const result = await DebuffAPI.check(playerId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_check', playerId);
    }
});

/**
 * GET /debuffs/active — список активных дебаффов игрока.
 */
router.get('/active', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return unauthorized(res, 'Нет авторизации');
        }
        const playerResult = await queryOne('SELECT radiation FROM players WHERE id = $1', [playerId]);
        if (!playerResult) {
            return notFound(res, 'Игрок не найден', 'PLAYER_NOT_FOUND');
        }
        const active = DebuffAPI.getActive(playerResult);
        return res.json({ success: true, data: { active } });
    } catch (error) {
        return handleError(res, error, 'debuff_active', playerId);
    }
});

/**
 * POST /debuffs/cure — лечение дебаффа предметом.
 * Тело: { cureType, itemId, itemIndex }
 */
router.post('/cure', async (req, res) => {
    const playerId = req.player?.id;
    const { cureType, itemId, itemIndex } = req.body || {};
    try {
        if (!playerId) {
            return unauthorized(res, 'Нет авторизации');
        }
        const result = await DebuffAPI.cure(playerId, cureType || 'auto', itemId, itemIndex);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_cure', playerId);
    }
});

// Экспорт DebuffAPI и роутера для подключения в index.js.
module.exports = { DebuffAPI, router };
