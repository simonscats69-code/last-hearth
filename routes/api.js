/**
 * Дополнительные API роутеры
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction } = require('../db/database');
const { logger, safeJsonParse, safeJsonParse: parseAchievementCondition, validateTelegramInitData, getPlayerByTelegramId } = require('../utils/serverApi');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../utils/game-helpers');
    }
    return gameHelpers;
}

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { getAchievementCurrentValue, getAchievementTargetValue, getAchievementRuntimeContext, grantCurrencyReward } = helpers;

/**
 * Типы ежедневных заданий: цель + награда.
 *
 * Ключи task_type использует utils/game-helpers.js → progressDailyTask(),
 * поэтому новый тип задание нужно сюда же, а не только в обработчик выдачи.
 */
const DAILY_TASK_TYPES = [
    { type: 'search', target: 10, reward: { coins: 50, stars: 1 } },
    { type: 'boss_damage', target: 100, reward: { coins: 100, stars: 2 } },
    { type: 'collect_items', target: 5, reward: { coins: 75, stars: 1 } }
];

module.exports = router;