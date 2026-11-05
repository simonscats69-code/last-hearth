// Единый сервис прогрессии (utils/progression.js)
// Все источники XP/уровней/достижений должны идти через этот модуль.
// Запрещается писать experience = experience + ... напрямую в роутах.
'use strict';

const { PlayerHelper } = require('./serverApi');
const { checkAchievements } = require('./game-helpers');

/**
 * Начислить опыт игроку с учётом level-up и проверки достижений.
 * @param {number} playerId
 * @param {number} amount — количество XP (положительное)
 * @param {string} source — источник ('search', 'boss_kill', 'raid_kill', 'pvp', 'daily_task', 'daily_bonus', 'achievement', 'admin', ...)
 * @param {object|null} client — клиент транзакции (если внутри транзакции)
 * @returns {Promise<{level, experience, leveled_up, levels_gained, logData}>}
 */
async function grantExperience(playerId, amount, source, client) {
    const exp = Math.max(0, Math.floor(Number(amount) || 0));
    if (exp <= 0) return { level: null, experience: null, leveled_up: false, levels_gained: 0, logData: null };

    const result = await PlayerHelper.addExperience(playerId, exp, client);

    // Событийная проверка достижений (мгновенная обратная связь).
    // Fire-and-forget, чтобы не блокировать транзакцию.
    try {
        if (typeof checkAchievements === 'function') {
            checkAchievements(playerId, client).catch(() => {});
        }
    } catch (e) {
        // Не роняем основной поток из-за ошибки проверки достижений.
    }

// Аудит-лог XP (если есть logPlayerAction).
    // Всегда fire-and-forget через пул (не внутри транзакции), чтобы
    // медленный INSERT не прерывал транзакцию и не вызывал rollback.
    try {
        const { logPlayerAction } = require('./log');
        if (typeof logPlayerAction === 'function') {
            logPlayerAction(playerId, 'grant_experience', { amount: exp, source, leveled_up: result.leveled_up, new_level: result.level }).catch(() => {});
        }
    } catch (_) { /* ignore */ }

    return result;
}

module.exports = { grantExperience };
