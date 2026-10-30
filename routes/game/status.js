/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { transaction, queryOne } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { DEBUFF_CONFIG, getDebuffTier, normalizeRadiationLevel, calculateRadiationDamage } = require('../../utils/gameConstants');
// Порог урона от заражения больше не нужен здесь: нормализация уровня и
// сама формула урона теперь в utils/gameConstants.js (debuffs.js считает
// тем же путем) — раньше «5» было вписано и здесь, и в debuffs.js.
const { handleError, logPlayerAction, unauthorized, ok, safeJsonParse } = require('../../utils/serverApi');
const { validateId } = require('../../utils/validate');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей). Общий загрузчик — utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { buildPlayerStatus, normalizeInventory, consumeInventoryItem } = helpers;



/**
 * Универсальная функция получения статуса игрока
 * @param {object} player - Объект игрока из БД
 * @returns {object} Статус игрока
 */
function getPlayerStatus(player) {
    return {
        success: true,
        ...buildPlayerStatus(player)
    };
}

async function runStatusCheck(client, playerId) {
    const p = await lockPlayer(playerId, client, 'health, radiation');

    if (!p) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const radConfig = DEBUFF_CONFIG?.radiation || { damagePerLevel: 5, maxLevel: 10 };
    const now = new Date();

    let radiationLevel = normalizeRadiationLevel(p.radiation);
    const radiation = safeJsonParse(p.radiation, { level: 0, expires_at: null });
    if (radiation.expires_at) {
        const expiresAt = new Date(radiation.expires_at);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
            radiationLevel = 0;
            await client.query(`UPDATE players SET radiation = $1 WHERE id = $2`, [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]);
        }
    }
    radiationLevel = Math.min(radiationLevel, radConfig.maxLevel || 10);

    const radDamage = calculateRadiationDamage(radiationLevel, radConfig.damagePerLevel);

    const totalDamage = radDamage;

    let newHealth = p.health;
    if (totalDamage > 0) {
        const result = await client.query(
            `UPDATE players
             SET health = GREATEST(0, COALESCE(health, 0) - $1),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING health`,
            [totalDamage, playerId]
        );
        newHealth = result.rows[0]?.health ?? newHealth;
    }

    return {
        totalDamage,
        health: newHealth,
        effects: {
            radiation: radDamage
        },
        states: {
            radiation: getDebuffTier(radiationLevel),
            overall: getDebuffTier(radiationLevel)
        },
        radiationLevel
    };
}



/**
 * Проверка состояния (ежедневный эффект)
 * POST /status/check → POST /api/game/status/check
 * Путь: /check (внутри роутера)
 */
router.post('/check', async (req, res) => {
    try {
        const player = req.player;
        const playerId = player?.id;
        
        if (!playerId) {
            return unauthorized(res);
        }
        
        // Используем транзакцию с блокировкой строки
        const result = await transaction(async (client) => runStatusCheck(client, playerId));
        
        // Логируем действие
        await logPlayerAction(playerId, 'status_check', {
            damage: result.totalDamage,
            effects: result.effects
        });
        
        res.json({
            success: true,
            checked: true,
            damage: result.totalDamage,
            health: result.health,
            effects: result.effects,
            states: result.states,
            message: result.radiationLevel > 0 ? 'Получено урона от дебаффов!' : 'Всё в порядке'
        });
        
    } catch (error) {
        return handleError(res, error, 'STATUS_CHECK');
    }
});

module.exports = router;
