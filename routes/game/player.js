/**
 * Профиль игрока, достижения и энергия
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction } = require('../../db/database');
const { logger, safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');

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
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress, regenerateHealth } = helpers;
const equipmentRules = require('../../public/shared/equipment.js');
// Правила лечения (реген, порог автолечения) — из общего файла, который
// читает и браузер.


// C-6: Whitelist разрешённых полей для обновления профиля
const ALLOWED_UPDATE_FIELDS = ['username', 'first_name', 'last_name', 'avatar'];

function filterAllowedUpdateFields(body) {
    const updates = {};
    if (!body || typeof body !== 'object') return updates;
    for (const field of ALLOWED_UPDATE_FIELDS) {
        if (body[field] !== undefined) {
            updates[field] = body[field];
        }
    }
    return updates;
}

/**
 * GET /profile — полный профиль игрока
 * Поддерживает и /profile (через алиас /profile), и корневой путь (через /player)
 */
router.get(['/', '/profile'], async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        // Пассивный реген здоровья при каждом заходе в профиль: иначе
        // игрок не видел бы восстановления, пока не зайдёт в поиск.
        const updatedPlayer = await transaction(async (client) => {
            const locked = await client.query(
                'SELECT id, health, max_health, last_hp_regen FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            return locked.rows[0] ? await regenerateHealth(client, locked.rows[0]) : 0;
        }).catch(() => 0);
        if (updatedPlayer > 0) {
            player.health = Math.min(Number(player.max_health || 0), Number(player.health || 0) + updatedPlayer);
        }

        const achievements = await getPlayerAchievements(playerId);
        const progress = await getPlayerProgress(playerId);
        const status = buildPlayerStatus(player);

        res.json({
            success: true,
            data: {
                player: {
                    id: player.id,
                    telegram_id: player.telegram_id,
                    username: player.username,
                    first_name: player.first_name,
                    last_name: player.last_name,
                    level: player.level,
                    experience: player.experience,
                    coins: player.coins,
                    stars: player.stars,
                    energy: status.energy,
                    max_energy: status.max_energy,
                    health: status.health,
                    max_health: status.max_health,
                    radiation: status.radiation,
                    infections: status.infections,
                    infections_list: status.infections_list,
                    clan_id: player.clan_id,
                    clan_role: player.clan_role,
                    daily_streak: player.daily_streak,
                    bosses_killed: player.bosses_killed,
                    pvp_wins: player.pvp_wins,
                    pvp_losses: player.pvp_losses,
                    pvp_rating: player.pvp_rating,
                    created_at: player.created_at,
                    last_daily_bonus: player.last_daily_bonus,
                    // Поля, используемые клиентом для UI (статы, энергия, локация)
                    last_energy_update: player.last_energy_update,
                    current_location_id: player.current_location_id,
                },
                achievements: achievements || [],
                progress: progress || {},
                inventory: normalizeInventory(player.inventory),
                equipment: safeJsonParse(player.equipment, {}),
                active_buffs: getActiveBuffs(player.buffs || '{}')
            }
        });
    } catch (err) {
        logger.error({ type: 'profile_error', message: err.message });
        res.status(500).json({ error: 'Ошибка получения профиля' });
    }
});

/**
 * PUT /update — обновление профиля (только разрешённые поля)
 */
router.put('/update', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const updates = filterAllowedUpdateFields(req.body);
        const fieldNames = Object.keys(updates);

        if (fieldNames.length === 0) {
            return res.status(400).json({ error: 'Нет разрешённых полей для обновления' });
        }

        const setClauses = fieldNames.map((field, i) => `${field} = $${i + 2}`);
        const values = fieldNames.map(f => updates[f]);
        values.unshift(playerId);

        await query(
            `UPDATE players SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
            values
        );

        const updatedPlayer = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);

        res.json({
            success: true,
            data: {
                username: updatedPlayer.username,
                first_name: updatedPlayer.first_name,
                last_name: updatedPlayer.last_name
            }
        });
    } catch (err) {
        logger.error({ type: 'update_profile_error', message: err.message });
        res.status(500).json({ error: 'Ошибка обновления профиля' });
    }
});

/**
 * GET /energy — текущая энергия
 */
router.get('/energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const player = await queryOne('SELECT energy, max_energy, last_energy_update FROM players WHERE id = $1', [playerId]);
        if (!player) return res.status(404).json({ error: 'Игрок не найден' });

        const status = buildPlayerStatus(player);

        res.json({
            success: true,
            data: {
                energy: status.energy,
                max_energy: status.max_energy,
                regen_interval_ms: 60000
            }
        });
    } catch (err) {
        handleError(res, err, 'get_energy');
    }
});

/**
 * POST /buy-energy — покупка энергии за звёзды
 */
router.post('/buy-energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        // Цена и объём — из общего файла правил, тем же файлом пользуется
        // клиент (public/game.js, restoreEnergy). Раньше «5» и «25» были
        // записаны здесь отдельно, а клиент держал свою копию цены.
        const STARS_COST = equipmentRules.ENERGY_PURCHASE_STARS_COST;
        const ENERGY_PER_PURCHASE = equipmentRules.ENERGY_PER_PURCHASE;

        const result = await transaction(async (client) => {
            const player = await client.query(
                'SELECT stars, energy, max_energy FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            const p = player.rows[0];
            if (!p) throw { message: 'Игрок не найден', code: 'NOT_FOUND' };
            if (p.stars < STARS_COST) throw { message: 'Недостаточно звёзд', code: 'INSUFFICIENT_STARS' };
            if (p.energy >= p.max_energy) throw { message: 'Энергия уже полная', code: 'ENERGY_FULL' };

            const newEnergy = Math.min(p.energy + ENERGY_PER_PURCHASE, p.max_energy);

            await client.query(
                // Энергия покупается, а не тратится, поэтому last_energy_update
                // двигать нельзя: сценарий energy=0, max=50, метка 40 мин
                // назад — игрок получил бы 20 энергии вместо 50, теряя 40.
                'UPDATE players SET stars = GREATEST(0, stars - $1), energy = $2 WHERE id = $3',
                [STARS_COST, newEnergy, playerId]
            );

            await logPlayerAction(playerId, 'buy_energy', { cost: STARS_COST, gained: ENERGY_PER_PURCHASE }, client);

            return { energy: newEnergy, stars: p.stars - STARS_COST };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        if (err.code === 'INSUFFICIENT_STARS' || err.code === 'ENERGY_FULL' || err.code === 'NOT_FOUND') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        handleError(res, err, 'buy_energy');
    }
});

/**
 * POST /daily-bonus — ежедневный бонус (раз в 24 часа).
 * 
 * Награда растёт с серией (+25 монет/день, макс. 7 дней).
 * Каждые 3 дня — одна звезда. Пропуск >48 часов обнуляет серию.
 */
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_BONUS_STREAK_LIMIT = 7;

router.post('/daily-bonus', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const result = await transaction(async (client) => {
            const result = await client.query(
                `SELECT id, coins, stars, daily_streak, last_daily_bonus
                   FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            const player = result.rows[0];
            if (!player) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const now = Date.now();
            const lastBonus = player.last_daily_bonus ? new Date(player.last_daily_bonus).getTime() : 0;

            if (lastBonus && now - lastBonus < DAILY_BONUS_COOLDOWN_MS) {
                const nextIn = Math.ceil((DAILY_BONUS_COOLDOWN_MS - (now - lastBonus)) / 60000);
                throw {
                    message: `Бонус уже получен. Следующий через ${nextIn} мин.`,
                    code: 'DAILY_BONUS_ALREADY_CLAIMED',
                    statusCode: 400,
                    next_in_minutes: nextIn,
                    daily_streak: Number(player.daily_streak || 0)
                };
            }

            // Серия сохраняется, только если прошлый бонус был не более двух
            // суток назад; иначе игрок начинает заново с первого дня.
            const keepsStreak = lastBonus && (now - lastBonus) <= 2 * DAILY_BONUS_COOLDOWN_MS;
            const streak = keepsStreak ? Number(player.daily_streak || 0) + 1 : 1;
            const cappedDay = Math.min(streak, DAILY_BONUS_STREAK_LIMIT);

            const coins = 25 + (cappedDay - 1) * 25;
            const stars = streak % 3 === 0 ? 1 : 0;

            await client.query(
                `UPDATE players
                    SET coins = coins + $1,
                        stars = stars + $2,
                        daily_streak = $3,
                        last_daily_bonus = NOW()
                  WHERE id = $4`,
                [coins, stars, streak, playerId]
            );

            await logPlayerAction(playerId, 'daily_bonus', { coins, stars, streak }, client);

            return {
                success: true,
                message: `День ${streak}: +${coins} монет${stars ? ` и +${stars} ⭐` : ''}`,
                coins: coins,
                stars: stars,
                daily_streak: streak,
                coins_total: Number(player.coins || 0) + coins,
                stars_total: Number(player.stars || 0) + stars,
                next_claim_at: new Date(now + DAILY_BONUS_COOLDOWN_MS).toISOString()
            };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        if (err.code === 'DAILY_BONUS_ALREADY_CLAIMED' || err.code === 'PLAYER_NOT_FOUND') {
            return res.status(err.statusCode || 400).json({
                success: false,
                error: err.message,
                code: err.code,
                next_in_minutes: err.next_in_minutes,
                daily_streak: err.daily_streak
            });
        }
        handleError(res, err, 'daily_bonus');
    }
});

/**
 * POST /auto-heal — настройка автолечения.
 * body: { enabled: boolean, threshold: 10..90 }
 *
 * Автолечение: при падении здоровья ниже порога игра сама расходует самый
 * экономный лечащий предмет из инвентаря. Игроку не нужно в панике искать
 * аптечку посреди боя с боссом.
 */
router.post('/auto-heal', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return res.status(401).json({ error: 'Требуется авторизация' });

        const { enabled, threshold } = req.body || {};
        const rules = equipmentRules;

        const result = await transaction(async (client) => {
            const current = await client.query(
                'SELECT auto_heal_enabled, auto_heal_threshold FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            if (!current.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            // Поля не заданы — оставляем как есть (частичное обновление).
            const nextEnabled = enabled === undefined
                ? current.rows[0].auto_heal_enabled !== false
                : Boolean(enabled);
            // getAutoHealThreshold(100, x) возвращает процент напрямую:
            // пустое значение (null/'') и мусор вроде 'abc' дают дефолт 35,
            // число зажимается в 10..90. Своя цепочка с Math.round(Number(...))
            // на нечисловом входе давала NaN, и UPDATE падал пятисоткой.
            const currentThreshold = Number(current.rows[0].auto_heal_threshold)
                || rules.DEFAULT_AUTO_HEAL_THRESHOLD;
            const nextThreshold = threshold === undefined
                ? currentThreshold
                : rules.getAutoHealThreshold(100, threshold);

            await client.query(
                'UPDATE players SET auto_heal_enabled = $1, auto_heal_threshold = $2 WHERE id = $3',
                [nextEnabled, nextThreshold, playerId]
            );

            await logPlayerAction(playerId, 'auto_heal_settings', {
                enabled: nextEnabled,
                threshold: nextThreshold
            }, client);

            return {
                enabled: nextEnabled,
                threshold: nextThreshold,
                threshold_min: rules.AUTO_HEAL_THRESHOLD_MIN,
                threshold_max: rules.AUTO_HEAL_THRESHOLD_MAX
            };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        if (err.code === 'PLAYER_NOT_FOUND') {
            return res.status(404).json({ success: false, error: err.message, code: err.code });
        }
        handleError(res, err, 'auto_heal_settings');
    }
});

/**
 * GET /achievements — достижения игрока
 */
router.get('/achievements', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const achievements = await getPlayerAchievements(playerId);
        res.json({ success: true, data: achievements || [] });
    } catch (err) {
        handleError(res, err, 'get_achievements');
    }
});

/**
 * POST /achievements/claim — получить награду за достижение
 */
router.post('/achievements/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const { achievement_id } = req.body || {};
        
        if (!achievement_id) {
            return res.status(400).json({ success: false, error: 'Не указан ID достижения', code: 'MISSING_ACHIEVEMENT_ID' });
        }
        
        const helpers = getGameHelpers();
        const { claimAchievementReward } = helpers;
        
        const result = await claimAchievementReward(playerId, Number(achievement_id));
        
        res.json({ success: true, data: result });
    } catch (err) {
        handleError(res, err, 'claim_achievement');
    }
});

/**
 * GET /progress — прогресс игрока
 */
router.get('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const progress = await getPlayerProgress(playerId);
        res.json({ success: true, data: progress || {} });
    } catch (err) {
        handleError(res, err, 'get_progress');
    }
});

module.exports = router;
