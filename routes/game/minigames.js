/**
 * Объединённый модуль мини-игр
 * Колесо удачи, покупки за Stars, таблица лидеров
 * 
 * Объединённые модули:
 * - wheel.js (колесо удачи)
 * - purchase.js (покупка за Stars)
 * - leaderboard.js (таблица лидеров)
 */

const express = require('express');
const router = express.Router();
const { pool, query } = require('../../db/database');
const { logger, handleError } = require('../../utils/serverApi');

// ==========================================
// КОЛЕСО УДАЧИ (из wheel.js)
// ==========================================

/**
 * Призы колеса удачи (должны совпадать с клиентом)
 */
const WHEEL_PRIZES = [
    { type: 'coins', value: 10, text: '10 монет', weight: 20 },
    { type: 'coins', value: 25, text: '25 монет', weight: 15 },
    { type: 'coins', value: 50, text: '50 монет', weight: 10 },
    { type: 'coins', value: 100, text: '100 монет', weight: 5 },
    { type: 'multiplier', value: 2, text: 'x2 к монетам', weight: 3 },
    { type: 'energy', value: 20, text: '20 энергии', weight: 12 },
];

// Время между бесплатными вращениями (24 часа)
const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Выбор приза на сервере (с весами)
 */
function selectPrize() {
    const totalWeight = WHEEL_PRIZES.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const prize of WHEEL_PRIZES) {
        random -= prize.weight;
        if (random <= 0) {
            return prize;
        }
    }
    return WHEEL_PRIZES[0];
}

/**
 * GET /wheel - получить информацию о колесе
 */
router.get('/wheel', async (req, res) => {
    const playerId = req.player?.id;
    
    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    
    try {
        // Получаем время последнего вращения
        const result = await query(
            'SELECT last_wheel_spin FROM players WHERE id = $1',
            [playerId]
        );
        
        const lastSpin = result.rows[0]?.last_wheel_spin;
        const now = Date.now();
        
        // Проверяем, можно ли крутить бесплатно
        let canSpinFree = false;
        if (!lastSpin) {
            canSpinFree = true;
        } else {
            const timeSinceLastSpin = now - new Date(lastSpin).getTime();
            canSpinFree = timeSinceLastSpin >= FREE_SPIN_COOLDOWN_MS;
        }
        
        // Время до следующего бесплатного вращения
        let nextFreeSpin = null;
        if (!canSpinFree && lastSpin) {
            const nextSpinTime = new Date(lastSpin).getTime() + FREE_SPIN_COOLDOWN_MS;
            nextFreeSpin = Math.max(0, nextSpinTime - now);
        }
        
        res.json({
            success: true,
            data: {
                can_spin_free: canSpinFree,
                next_free_spin: nextFreeSpin,
                prizes: WHEEL_PRIZES.map(p => ({ type: p.type, value: p.value, text: p.text }))
            }
        });
    } catch (error) {
        return handleError(res, error, 'wheel_info');
    }
});

/**
 * POST /wheel/spin - крутить колесо
 */
router.post('/wheel/spin', async (req, res) => {
    const playerId = req.player?.id;
    // Валидация: преобразуем к boolean
    const is_paid = req.body?.is_paid === true || req.body?.is_paid === 'true';
    
    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем игрока
        const playerResult = await client.query(
            'SELECT id, coins, stars, energy, max_energy, last_wheel_spin FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        const player = playerResult.rows[0];
        
        if (!player) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }
        
        // Проверяем возможность вращения
        const now = Date.now();
        const lastSpin = player.last_wheel_spin;
        
        let canSpinFree = false;
        if (!lastSpin) {
            canSpinFree = true;
        } else {
            const timeSinceLastSpin = now - new Date(lastSpin).getTime();
            canSpinFree = timeSinceLastSpin >= FREE_SPIN_COOLDOWN_MS;
        }
        
        // Проверка платного вращения
        if (is_paid) {
            if ((player.stars || 0) < 1) {
                await client.query('ROLLBACK');
                return res.json({ success: false, error: 'Недостаточно Stars', code: 'NO_STARS' });
            }
            // Списываем Stars (без изменения last_wheel_spin для платных вращений)
            await client.query(
                'UPDATE players SET stars = stars - 1 WHERE id = $1',
                [playerId]
            );
        } else {
            // Бесплатное вращение - проверяем кулдаун
            if (!canSpinFree) {
                const nextSpinTime = new Date(lastSpin).getTime() + FREE_SPIN_COOLDOWN_MS;
                const timeLeft = Math.ceil((nextSpinTime - now) / 1000 / 60);
                await client.query('ROLLBACK');
                return res.json({ 
                    success: false, 
                    error: `Следующее бесплатное вращение через ${timeLeft} мин.`,
                    code: 'COOLDOWN',
                    next_free_spin: nextSpinTime - now
                });
            }
        }
        
        // Выбираем приз на сервере
        const prize = selectPrize();
        
        // Применяем приз - обновляем last_wheel_spin только при бесплатном вращении
        if (prize.type === 'coins') {
            const updateCooldown = !is_paid ? ', last_wheel_spin = NOW()' : '';
            await client.query(
                `UPDATE players SET coins = coins + $1${updateCooldown} WHERE id = $2`,
                [prize.value, playerId]
            );
        } else if (prize.type === 'energy') {
            const newEnergy = Math.min(player.max_energy || 100, (player.energy || 0) + prize.value);
            const updateCooldown = !is_paid ? ', last_wheel_spin = NOW()' : '';
            await client.query(
                `UPDATE players SET energy = $1${updateCooldown} WHERE id = $2`,
                [newEnergy, playerId]
            );
        } else if (prize.type === 'multiplier') {
            // Умножаем монеты (от текущего значения)
            const newCoins = Math.floor((player.coins || 0) * prize.value);
            const bonus = newCoins - (player.coins || 0);
            const updateCooldown = !is_paid ? ', last_wheel_spin = NOW()' : '';
            
            if (bonus > 0) {
                await client.query(
                    `UPDATE players SET coins = coins + $1${updateCooldown} WHERE id = $2`,
                    [bonus, playerId]
                );
            } else if (!is_paid) {
                await client.query(
                    'UPDATE players SET last_wheel_spin = NOW() WHERE id = $1',
                    [playerId]
                );
            }
            // При is_paid и отсутствии бонуса ничего не делаем
        }
        
        await client.query('COMMIT');
        
        logger.info({ playerId, prize: prize.type, value: prize.value, is_paid }, 'wheel_spin');
        
        res.json({
            success: true,
            data: {
                prize: prize,
                is_paid: is_paid || false
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        return handleError(res, error, 'wheel_spin');
    } finally {
        client.release();
    }
});

// ==========================================
// ПОКУПКИ ЗА STARS (из purchase.js)
// ==========================================

const BUFFS_CONFIG = {
    'buff_loot_1h': { name: 'x2 Добыча', duration: 3600, effect: 'loot_x2', stars: 5 },
    'buff_energy_1h': { name: 'Бесплатная энергия', duration: 3600, effect: 'free_energy', stars: 3 },
    'buff_radiation_1h': { name: 'Анти-rad', duration: 3600, effect: 'no_radiation', stars: 2 },
    'buff_exp_1h': { name: 'x2 Опыт', duration: 3600, effect: 'exp_x2', stars: 4 },
    'buff_loot_daily': { name: 'x2 Добыча (24ч)', duration: 86400, effect: 'loot_x2', stars: 20 },
};

const COSMETICS_CONFIG = {
    'cosm_glow_gold': { name: 'Золотое свечение', effect: 'glow_gold', stars: 50 },
    'cosm_glow_blue': { name: 'Синее свечение', effect: 'glow_blue', stars: 30 },
    'cosm_frame_elite': { name: 'Элитная рамка', effect: 'frame_elite', stars: 100 },
    'cosm_title_veteran': { name: 'Звание: Ветеран', effect: 'title_veteran', stars: 25 },
    'cosm_particles_fire': { name: 'Огненные частицы', effect: 'particles_fire', stars: 40 },
};

function getItemConfig(itemId) {
    return BUFFS_CONFIG[itemId] || COSMETICS_CONFIG[itemId] || null;
}

/**
 * Добавить бафф игроку (использует уже полученные данные)
 * @param {object} client - клиент транзакции
 * @param {number} playerId - ID игрока
 * @param {string} effect - эффект баффа
 * @param {string} expiresAtISO - дата истечения в ISO формате
 * @param {object} existingBuffs - уже полученные buffs игрока
 */
async function grantPlayerBuff(client, playerId, effect, expiresAtISO, existingBuffs) {
    const buffs = { ...existingBuffs };
    buffs[effect] = { expires_at: expiresAtISO };
    
    await client.query(
        'UPDATE players SET buffs = $1 WHERE id = $2',
        [JSON.stringify(buffs), playerId]
    );
}

/**
 * Добавить косметику игроку (использует уже полученные данные)
 * @param {object} client - клиент транзакции
 * @param {number} playerId - ID игрока
 * @param {string} effect - эффект косметики
 * @param {Array} existingCosmetics - уже полученные cosmetics игрока
 */
async function grantPlayerCosmetic(client, playerId, effect, existingCosmetics) {
    let cosmetics = existingCosmetics ? [...existingCosmetics] : [];
    
    if (!cosmetics.includes(effect)) {
        cosmetics.push(effect);
    }
    
    await client.query(
        'UPDATE players SET cosmetics = $1 WHERE id = $2',
        [JSON.stringify(cosmetics), playerId]
    );
}

/**
 * Парсинг JSON поля с fallback
 */
function parseJsonField(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * POST /purchase - покупка товара за Stars
 */
router.post('/purchase', async (req, res) => {
    // Валидируем до получения клиента из пула
    const { item_id, currency = 'stars' } = req.body;
    const playerId = req.player.id;
    
    if (currency !== 'stars') {
        return res.status(400).json({
            success: false,
            error: 'Этот endpoint принимает только Stars',
            code: 'INVALID_CURRENCY'
        });
    }
    
    const itemConfig = getItemConfig(item_id);
    if (!itemConfig) {
        return res.status(404).json({
            success: false,
            error: 'Товар не найден',
            code: 'ITEM_NOT_FOUND'
        });
    }
    
    const price = itemConfig.stars;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем игрока со всеми необходимыми данными одним запросом
        const playerResult = await client.query(
            'SELECT stars, buffs, cosmetics FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        const player = playerResult.rows[0];
        const playerStars = player?.stars || 0;
        
        if (playerStars < price) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Недостаточно Stars',
                code: 'INSUFFICIENT_STARS',
                stars: playerStars,
                required: price
            });
        }
        
        // Списываем Stars
        await client.query(
            'UPDATE players SET stars = stars - $1 WHERE id = $2',
            [price, playerId]
        );
        
        // Парсим существующие buffs и cosmetics
        const existingBuffs = parseJsonField(player?.buffs, {});
        const existingCosmetics = parseJsonField(player?.cosmetics, []);
        
        let reward = null;
        
        if (BUFFS_CONFIG[item_id]) {
            const expiresAt = new Date(Date.now() + itemConfig.duration * 1000);
            await grantPlayerBuff(client, playerId, itemConfig.effect, expiresAt.toISOString(), existingBuffs);
            reward = {
                type: 'buff',
                effect: itemConfig.effect,
                expires_at: expiresAt.toISOString()
            };
        } else if (COSMETICS_CONFIG[item_id]) {
            await grantPlayerCosmetic(client, playerId, itemConfig.effect, existingCosmetics);
            reward = {
                type: 'cosmetic',
                effect: itemConfig.effect
            };
        }
        
        await client.query('COMMIT');
        
        logger.info(`[purchase] Игрок ${playerId} купил ${item_id} за ${price} Stars`);
        
        res.json({
            success: true,
            message: `Куплено: ${itemConfig.name}`,
            purchased_item: {
                id: item_id,
                name: itemConfig.name,
                reward: reward
            },
            new_stars: playerStars - price,
            balance: playerStars - price
        });
    } catch (error) {
        await client.query('ROLLBACK');
        return handleError(res, error, 'purchase');
    } finally {
        client.release();
    }
});

// ==========================================
// ТАБЛИЦА ЛИДЕРОВ (из leaderboard.js)
// ==========================================

/**
 * Получить топ игроков с гибкой сортировкой
 * GET /leaderboard/players?sort=level|strength|bosses|pvp&limit=10
 */
router.get('/leaderboard/players', async (req, res) => {
    try {
        const sort = req.query.sort || 'level';
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        // Определяем поле сортировки и дополнительные поля
        let orderBy, whereClause, selectFields;
        
        switch (sort) {
            case 'strength':
                orderBy = 'strength DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, level, strength';
                break;
            case 'bosses':
                orderBy = 'bosses_killed DESC';
                whereClause = 'WHERE banned = false AND bosses_killed > 0';
                selectFields = 'telegram_id, username, level, bosses_killed';
                break;
            case 'pvp':
                orderBy = 'pvp_wins DESC';
                whereClause = 'WHERE banned = false AND (pvp_wins > 0 OR pvp_losses > 0)';
                selectFields = 'telegram_id, username, level, pvp_wins, pvp_losses';
                break;
            case 'level':
            default:
                orderBy = 'level DESC, experience DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, level, strength, experience';
                break;
        }
        
        // Оптимизировано: COUNT(*) OVER() вместо подзапроса
        const result = await query(
            `SELECT ${selectFields}, COUNT(*) OVER() as total_players
             FROM players 
             ${whereClause}
             ORDER BY ${orderBy} 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => {
            const entry = {
                rank: index + 1,
                telegram_id: player.telegram_id,
                username: player.username,
                level: player.level,
                total_players: parseInt(player.total_players, 10)
            };
            
            // Добавляем специфичные поля в зависимости от сортировки
            switch (sort) {
                case 'strength':
                    // strength сортировка - только strength
                    entry.strength = player.strength;
                    break;
                case 'level':
                    // level сортировка - и strength, и experience
                    entry.strength = player.strength;
                    entry.experience = player.experience;
                    break;
                case 'bosses':
                    entry.bosses_killed = player.bosses_killed;
                    break;
                case 'pvp': {
                    const total = player.pvp_wins + player.pvp_losses;
                    entry.pvp_wins = player.pvp_wins;
                    entry.pvp_losses = player.pvp_losses;
                    entry.win_rate = total > 0 ? Math.round((player.pvp_wins / total) * 100) : 0;
                    break;
                }
            }
            
            return entry;
        });
        
        res.json({ success: true, leaderboard, sort });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения рейтинга игроков', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ кланов
router.get('/leaderboard/clans', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT c.id,
                    c.name,
                    c.leader_id,
                    c.level,
                    COUNT(p.id) AS members_count,
                    COALESCE(SUM(p.level), 0) as total_levels,
                    COUNT(*) OVER() as total_clans
              FROM clans c
             LEFT JOIN players p ON p.clan_id = c.id AND p.banned = false
             GROUP BY c.id
             ORDER BY c.level DESC, total_levels DESC
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((clan, index) => ({
            rank: index + 1,
            id: clan.id,
            name: clan.name,
            leader_id: clan.leader_id,
            level: clan.level,
            members_count: clan.members_count,
            total_levels: parseInt(clan.total_levels, 10),
            total_clans: parseInt(clan.total_clans, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения рейтинга кланов', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить позицию игрока в рейтингах - оптимизированная версия
router.get('/leaderboard/my-position/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Сначала получаем статы целевого игрока одним запросом
        const playerResult = await query(
            'SELECT level, experience, strength, bosses_killed FROM players WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (!playerResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }
        
        const { level, experience, strength, bosses_killed } = playerResult.rows[0];
        
        // Затем вычисляем ранги без подзапросов
        const [levelRankResult, strengthRankResult, bossRankResult] = await Promise.all([
            // Уровень (с учётом опыта при равном уровне)
            query(
                `SELECT COUNT(*) + 1 as rank 
                 FROM players 
                 WHERE banned = false AND (level > $1 OR (level = $1 AND experience > $2))`,
                [level, experience]
            ),
            // Сила
            query(
                'SELECT COUNT(*) + 1 as rank FROM players WHERE banned = false AND strength > $1',
                [strength]
            ),
            // Боссы
            query(
                'SELECT COUNT(*) + 1 as rank FROM players WHERE banned = false AND bosses_killed > $1',
                [bosses_killed]
            )
        ]);
        
        res.json({
            success: true,
            position: {
                level_rank: parseInt(levelRankResult.rows[0].rank, 10),
                strength_rank: parseInt(strengthRankResult.rows[0].rank, 10),
                boss_rank: parseInt(bossRankResult.rows[0].rank, 10)
            }
        });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения позиции', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения позиции' });
    }
});

// ==========================================
// ЭКСПОРТ
// ==========================================

module.exports = router;