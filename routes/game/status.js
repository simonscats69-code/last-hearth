/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { transaction } = require('../../db/database');
const { DEBUFF_CONFIG, getDebuffTier } = require('../../utils/gameConstants');
// Порог урона от заражения — единое место правды (раньше «5» было вписано
// и здесь, и в debuffs.js).
const CONTAMINATION_DAMAGE_FROM_LEVEL = require('../../public/shared/equipment.js').CONTAMINATION_DAMAGE_FROM_LEVEL;
const { safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { validateId } = require('../../utils/validate');
const { DebuffAPI } = require('./debuffs');

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
    const lockResult = await client.query(
        `SELECT health, radiation
         FROM players WHERE id = $1 FOR UPDATE`,
        [playerId]
    );

    if (!lockResult.rows.length) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const p = lockResult.rows[0];

    let radDamage = 0;
    const radConfig = DEBUFF_CONFIG.radiation;
    
    // Обрабатываем оба формата хранения радиации (JSON и число)
    let radiationLevel = 0;
    const rawRadiation = p.radiation;
    
    if (typeof rawRadiation === 'object' && rawRadiation !== null) {
        radiationLevel = rawRadiation.level || 0;
    } else if (typeof rawRadiation === 'number') {
        radiationLevel = rawRadiation;
    } else if (typeof rawRadiation === 'string') {
        const parsed = safeJsonParse(rawRadiation, { level: 0 });
        radiationLevel = typeof parsed === 'object' ? (parsed.level || 0) : (parseInt(parsed) || 0);
    }
    
    // Порог урона — из общего файла правил, одно место на весь проект.
    if (radiationLevel >= CONTAMINATION_DAMAGE_FROM_LEVEL) {
        radDamage = (radiationLevel - (CONTAMINATION_DAMAGE_FROM_LEVEL - 1)) * radConfig.damagePerLevel;
    }

    // Инфекции объединены с радиацией: урон один, отдельного слагаемого
    // от players.infections больше нет. Прежняя строка второго урона
    // (10% шанс × уровень × 2) удалена вместе с ним.

    const totalDamage = radDamage;

    if (totalDamage > 0) {
        await client.query(
            `UPDATE players
             SET health = GREATEST(0, health - $1)
             WHERE id = $2`,
            [totalDamage, playerId]
        );
    }

    return {
        totalDamage,
        effects: {
            radiation: radDamage
        },
        states: {
            radiation: getDebuffTier(radiationLevel),
            overall: getDebuffTier(radiationLevel)
        }
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
        const playerId = player.id;
        
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
            effects: result.effects,
            states: result.states,
            message: result.totalDamage > 0 ? 'Получено урона от дебаффов!' : 'Всё в порядке'
        });
        
    } catch (error) {
        handleError(res, error, 'STATUS_CHECK');
    }
});

module.exports = router;
