/**
 * Модуль PvP системы
 * Управление PvP боями, кулдаунами и статистикой
 */

const { query, queryOne, queryAll, updateAchievementProgress } = require('./database');

/**
 * Проверка, является ли локация красной зоной (PvP разрешено)
 * @param {number} locationId - ID локации
 * @returns {Promise<boolean>} true если красная зона
 */
async function isRedZone(locationId) {
    const location = await queryOne(
        'SELECT danger_level FROM locations WHERE id = $1',
        [locationId]
    );
    return location && location.danger_level >= 6;
}

/**
 * Проверка, защищён ли игрок от PvP (уровень < 5)
 * @param {number} playerId - ID игрока
 * @returns {Promise<boolean>} true если защищён
 */
async function isProtectedFromPVP(playerId) {
    const player = await queryOne(
        'SELECT level FROM players WHERE id = $1',
        [playerId]
    );
    return player && player.level < 5;
}

/**
 * Проверка кулдауна PvP для игрока
 * @param {number} playerId - ID игрока
 * @returns {Promise<object|null>} Информация о кулдауне или null
 */
async function getPVP_cooldown(playerId) {
    return await queryOne(
        `SELECT * FROM pvp_cooldowns 
         WHERE player_id = $1 AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`,
        [playerId]
    );
}

/**
 * Установка кулдауна PvP для игрока
 * @param {number} playerId - ID игрока
 * @param {number} minutes - Длительность в минутах
 * @param {string} type - Тип кулдауна
 * @param {string} reason - Причина
 */
async function setPVP_cooldown(playerId, minutes, type = 'pvp_battle', reason = 'После PvP боя') {
    await query(
        `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at, reason)
         VALUES ($1, $2, NOW() + INTERVAL '${minutes} minutes', $3)
         ON CONFLICT (player_id, cooldown_type) 
         DO UPDATE SET expires_at = NOW() + INTERVAL '${minutes} minutes', reason = $3`,
        [playerId, type, reason]
    );
}

/**
 * Получение игроков в текущей локации (для PvP)
 * @param {number} locationId - ID локации
 * @param {number} excludePlayerId - ID игрока для исключения
 * @returns {Promise<Array>} Массив игроков в локации
 */
async function getPlayersInLocation(locationId, excludePlayerId = null) {
    let sql = `
        SELECT p.id, p.telegram_id, p.username, p.first_name, p.last_name,
               p.level, p.health, p.max_health, p.energy, p.max_energy,
               p.current_location_id, p.pvp_wins, p.pvp_losses, p.pvp_streak,
               p.pvp_rating, p.equipment
        FROM players p
        WHERE p.current_location_id = $1 
        AND p.health > 0
    `;
    
    const params = [locationId];
    
    if (excludePlayerId) {
        sql += ' AND p.id != $2';
        params.push(excludePlayerId);
    }
    
    sql += ' ORDER BY p.pvp_rating DESC NULLS LAST';
    
    return await queryAll(sql, params);
}

/**
 * Получение статистики PvP игрока
 * @param {number} playerId - ID игрока
 * @returns {Promise<object>} Статистика PvP
 */
async function getPVPStats(playerId) {
    const player = await queryOne(
        `SELECT p.pvp_wins, p.pvp_losses, p.pvp_draws, p.pvp_streak, 
                p.pvp_max_streak, p.pvp_rating, p.pvp_total_damage_dealt,
                p.pvp_total_damage_taken, p.coins_stolen_from_me, p.items_stolen_from_me,
                p.level
         FROM players p WHERE p.id = $1`,
        [playerId]
    );
    
    if (!player) return null;
    
    // Получаем последние бои
    const recentMatches = await queryAll(
        `SELECT pm.*, 
                attacker.username as attacker_name,
                defender.username as defender_name,
                winner.username as winner_name
         FROM pvp_matches pm
         LEFT JOIN players attacker ON pm.attacker_id = attacker.id
         LEFT JOIN players defender ON pm.defender_id = defender.id
         LEFT JOIN players winner ON pm.winner_id = winner.id
         WHERE pm.attacker_id = $1 OR pm.defender_id = $1
         ORDER BY pm.started_at DESC
         LIMIT 10`,
        [playerId]
    );
    
    return {
        wins: player.pvp_wins || 0,
        losses: player.pvp_losses || 0,
        draws: player.pvp_draws || 0,
        streak: player.pvp_streak || 0,
        maxStreak: player.pvp_max_streak || 0,
        rating: player.pvp_rating || 1000,
        totalDamageDealt: player.pvp_total_damage_dealt || 0,
        totalDamageTaken: player.pvp_total_damage_taken || 0,
        coinsStolenFromMe: player.coins_stolen_from_me || 0,
        itemsStolenFromMe: player.items_stolen_from_me || 0,
        level: player.level,
        recentMatches: recentMatches || []
    };
}

/**
 * Создание нового PvP матча
 * @param {number} attackerId - ID атакующего
 * @param {number} defenderId - ID защищающегося
 * @param {number} locationId - ID локации
 * @returns {Promise<object>} Созданный матч
 */
async function createPVPMatch(attackerId, defenderId, locationId) {
    const match = await queryOne(
        `INSERT INTO pvp_matches (attacker_id, defender_id, location_id, started_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [attackerId, defenderId, locationId]
    );
    
    // Устанавливаем кулдаун обоим игрокам
    await setPVP_cooldown(attackerId, 5, 'pvp_battle', 'Участие в PvP бое');
    await setPVP_cooldown(defenderId, 5, 'pvp_battle', 'Участие в PvP бое');
    
    return match;
}

/**
 * Завершение PvP матча
 * @param {number} matchId - ID матча
 * @param {number} winnerId - ID победителя
 * @param {number} loserId - ID проигравшего
 * @param {object} rewards - Награды
 */
async function finishPVPMatch(matchId, winnerId, loserId, rewards) {
    const client = await require('./database').pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { coinsStolen, itemsStolen, experienceGained, 
                attackerDamageDealt, attackerDamageTaken,
                defenderDamageDealt, defenderDamageTaken } = rewards;
        
        // Обновляем матч
        await client.query(
            `UPDATE pvp_matches SET 
                winner_id = $1, 
                loser_id = $2,
                coins_stolen = $3,
                items_stolen = $4,
                experience_gained = $5,
                attacker_damage_dealt = $6,
                attacker_damage_taken = $7,
                defender_damage_dealt = $8,
                defender_damage_taken = $9,
                ended_at = NOW()
             WHERE id = $10`,
            [winnerId, loserId, coinsStolen, JSON.stringify(itemsStolen), 
             experienceGained, attackerDamageDealt, attackerDamageTaken,
             defenderDamageDealt, defenderDamageTaken, matchId]
        );
        
        // Обновляем статистику победителя
        const winner = await client.query(
            `UPDATE players SET 
                pvp_wins = pvp_wins + 1,
                pvp_streak = pvp_streak + 1,
                pvp_max_streak = GREATEST(pvp_max_streak, pvp_streak + 1),
                pvp_rating = pvp_rating + 25,
                pvp_total_damage_dealt = pvp_total_damage_dealt + $1,
                experience = experience + $2,
                coins = coins + $3,
                inventory = inventory || $4::jsonb
             WHERE id = $5
             RETURNING *`,
            [attackerDamageDealt + defenderDamageDealt, experienceGained, 
             coinsStolen, JSON.stringify(itemsStolen), winnerId]
        );

        // Обновляем прогресс достижений для победителя
        await updateAchievementProgress(winnerId, 'pvp_wins');
        
        // Обновляем статистику проигравшего
        const loser = await client.query(
            `UPDATE players SET 
                pvp_losses = pvp_losses + 1,
                pvp_streak = 0,
                pvp_rating = GREATEST(500, pvp_rating - 15),
                pvp_total_damage_taken = pvp_total_damage_taken + $1,
                coins = GREATEST(0, coins - $2),
                coins_stolen_from_me = coins_stolen_from_me + $2,
                current_location_id = 1  -- Телепорт в безопасную локацию
             WHERE id = $3
             RETURNING *`,
            [attackerDamageTaken + defenderDamageTaken, coinsStolen, loserId]
        );
        
        // Забираем предмет у проигравшего
        if (itemsStolen && itemsStolen.length > 0) {
            const loserInventory = loser.rows[0].inventory || {};
            for (const item of itemsStolen) {
                if (loserInventory[item.itemId]) {
                    const qty = Math.min(loserInventory[item.itemId], item.quantity);
                    loserInventory[item.itemId] -= qty;
                    if (loserInventory[item.itemId] <= 0) {
                        delete loserInventory[item.itemId];
                    }
                }
            }
            
            await client.query(
                'UPDATE players SET inventory = $1 WHERE id = $2',
                [JSON.stringify(loserInventory), loserId]
            );
            
            // Добавляем предметы победителю
            const winnerInventory = winner.rows[0].inventory || {};
            for (const item of itemsStolen) {
                winnerInventory[item.itemId] = (winnerInventory[item.itemId] || 0) + item.quantity;
            }
            
            await client.query(
                'UPDATE players SET inventory = $1 WHERE id = $2',
                [JSON.stringify(winnerInventory), winnerId]
            );
        }
        
        await client.query('COMMIT');
        
        return {
            matchId,
            winnerId,
            loserId,
            rewards: {
                coinsStolen,
                itemsStolen,
                experienceGained
            }
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Расчёт урона в PvP
 * @param {object} attacker - Атакующий игрок
 * @param {object} defender - Защищающийся игрок
 * @returns {object} { damage, isCritical, counterDamage }
 */
function calculatePVPDamage(attacker, defender) {
    // Базовая формула урона
    const baseDamage = attacker.strength || 1;
    const weaponBonus = attacker.equipment?.weapon?.stats?.damage || 0;
    const agilityBonus = Math.floor((attacker.agility || 1) / 5);
    const luckBonus = Math.floor(Math.random() * (attacker.luck || 1));
    
    // Шанс критического удара (ловкость / 100)
    const critChance = (attacker.agility || 1) / 100;
    const isCritical = Math.random() < critChance;
    
    let damage = baseDamage + weaponBonus + agilityBonus + luckBonus;
    if (isCritical) {
        damage = Math.floor(damage * 1.5);
    }
    
    // Защита брони
    const defense = defender.equipment?.body?.stats?.defense || 0;
    defense += defender.equipment?.head?.stats?.defense || 0;
    damage = Math.max(1, damage - defense);
    
    // Контратака защищающегося (шанс зависит от ловкости)
    const counterChance = (defender.agility || 1) / 200;
    const counterDamage = Math.random() < counterChance ? Math.floor(damage * 0.3) : 0;
    
    return { damage, isCritical, counterDamage };
}

/**
 * Получение списка предметов для кражи
 * @param {object} inventory - Инвентарь игрока
 * @param {number} maxItems - Максимальное количество предметов
 * @returns {Array} Массив предметов для кражи
 */
function getRandomItemsToSteal(inventory, maxItems = 3) {
    const items = Object.entries(inventory)
        .filter(([itemId, qty]) => qty > 0)
        .map(([itemId, quantity]) => ({ itemId: parseInt(itemId), quantity }));
    
    // Перемешиваем и выбираем случайные предметы
    const shuffled = items.sort(() => Math.random() - 0.5);
    const count = Math.min(maxItems, shuffled.length);
    
    const stolenItems = [];
    for (let i = 0; i < count; i++) {
        const item = shuffled[i];
        const stealQty = Math.min(item.quantity, Math.floor(Math.random() * 2) + 1);
        stolenItems.push({ itemId: item.itemId, quantity: stealQty });
    }
    
    return stolenItems;
}

/**
 * Расчёт монет для кражи
 * @param {number} loserCoins - Монеты проигравшего
 * @param {number} attackerLuck - Удача атакующего
 * @returns {number} Количество украденных монет
 */
function calculateCoinsToSteal(loserCoins, attackerLuck) {
    if (loserCoins <= 0) return 0;
    
    // Базовая формула: 10-30% от монет + бонус от удачи
    const basePercent = 0.1 + Math.random() * 0.2;
    const luckBonus = (attackerLuck || 1) * 0.005;
    const percent = Math.min(0.5, basePercent + luckBonus);
    
    return Math.floor(loserCoins * percent);
}

/**
 * Расчёт опыта за победу в PvP
 * @param {number} loserLevel - Уровень проигравшего
 * @param {number} winnerLevel - Уровень победителя
 * @returns {number} Количество опыта
 */
function calculatePVPRewardExperience(loserLevel, winnerLevel) {
    // Больше опыта за победу над более сильным противником
    const levelDiff = loserLevel - winnerLevel;
    const baseExp = 50;
    const levelBonus = Math.max(0, levelDiff * 10);
    
    return baseExp + levelBonus;
}

module.exports = {
    isRedZone,
    isProtectedFromPVP,
    getPVP_cooldown,
    setPVP_cooldown,
    getPlayersInLocation,
    getPVPStats,
    createPVPMatch,
    finishPVPMatch,
    calculatePVPDamage,
    getRandomItemsToSteal,
    calculateCoinsToSteal,
    calculatePVPRewardExperience
};
