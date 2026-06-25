/**
 * Профиль игрока, достижения, рефералы и энергия
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction: tx } = require('../../db/database');
const { getExpForLevel, getTotalExpForLevel } = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress } = require('../../utils/game-helpers');

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
 */
router.get('/profile', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
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
                    referral_code: player.referral_code,
                    daily_streak: player.daily_streak,
                    bosses_killed: player.bosses_killed,
                    pvp_wins: player.pvp_wins,
                    pvp_losses: player.pvp_losses,
                    pvp_rating: player.pvp_rating,
                    created_at: player.created_at,
                    last_daily_bonus: player.last_daily_bonus
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
        const ENERGY_PER_PURCHASE = 25;
        const STARS_COST = 5;

        const result = await tx(async (client) => {
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
                'UPDATE players SET stars = GREATEST(0, stars - $1), energy = $2, last_energy_update = NOW() WHERE id = $3',
                [STARS_COST, newEnergy, playerId]
            );

            await logPlayerAction(client, playerId, 'buy_energy', { cost: STARS_COST, gained: ENERGY_PER_PURCHASE });

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
 * GET /referrals — рефералы игрока
 */
router.get('/referrals', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const referrals = await queryAll(
            `SELECT r.id, r.referred_id, r.bonus_claimed, r.created_at,
                    p.username, p.first_name, p.level
             FROM referrals r
             LEFT JOIN players p ON p.id = r.referred_id
             WHERE r.referrer_id = $1
             ORDER BY r.created_at DESC`,
            [playerId]
        );

        res.json({
            success: true,
            data: referrals.map(r => ({
                id: r.id,
                player_id: r.referred_id,
                username: r.username,
                first_name: r.first_name,
                level: r.level,
                created_at: r.created_at,
                bonus_claimed: r.bonus_claimed
            }))
        });
    } catch (err) {
        handleError(res, err, 'get_referrals');
    }
});

/**
 * POST /claim-referral-bonus — забрать бонус за реферала
 */
router.post('/claim-referral-bonus', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const { referralId } = req.body;

        if (!referralId || !Number.isInteger(Number(referralId)) || Number(referralId) <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID реферала', code: 'INVALID_REFERRAL_ID' });
        }

        const result = await tx(async (client) => {
            const player = await client.query('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            const referral = await client.query(
                'SELECT * FROM referrals WHERE id = $1 AND referrer_id = $2 AND bonus_claimed = false',
                [referralId, playerId]
            );
            if (!referral.rows[0]) throw { message: 'Бонус уже получен или реферал не найден', code: 'BONUS_ALREADY_CLAIMED' };

            const BONUS_COINS = 50;
            await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [BONUS_COINS, playerId]);
            await client.query('UPDATE referrals SET bonus_claimed = true WHERE id = $1', [referralId]);

            return { coins: player.rows[0].coins + BONUS_COINS };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        if (err.code === 'BONUS_ALREADY_CLAIMED') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        handleError(res, err, 'claim_referral_bonus');
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

/**
 * GET /referral/code — получить реферальный код
 */
router.get('/referral/code', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const player = await queryOne('SELECT referral_code FROM players WHERE id = $1', [playerId]);
        if (!player) return res.status(404).json({ error: 'Игрок не найден' });

        const canChange = player.referral_code && player.referral_code.startsWith('LH-');
        res.json({ success: true, code: player.referral_code, can_change: canChange });
    } catch (err) {
        handleError(res, err, 'referral_code_get');
    }
});

/**
 * GET /referral/stats — статистика рефералов
 */
router.get('/referral/stats', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const referrals = await queryAll(
            'SELECT id FROM referrals WHERE referrer_id = $1 AND bonus_claimed = true',
            [playerId]
        );
        const totalReferrals = referrals.length;
        const totalCoins = totalReferrals * 50;
        const totalStars = 0;

        res.json({
            success: true,
            stats: {
                total_referrals: totalReferrals,
                total_coins_earned: totalCoins,
                total_stars_earned: totalStars
            }
        });
    } catch (err) {
        handleError(res, err, 'referral_stats');
    }
});

/**
 * GET /referral/list — список рефералов
 */
router.get('/referral/list', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const referrals = await queryAll(`
            SELECT r.id, r.referred_id, r.bonus_claimed, r.created_at,
                   p.username, p.first_name, p.level
            FROM referrals r
            LEFT JOIN players p ON p.id = r.referred_id
            WHERE r.referrer_id = $1
            ORDER BY r.created_at DESC
        `, [playerId]);

        res.json({
            success: true,
            referrals: referrals.map(r => ({
                id: r.id,
                player_id: r.referred_id,
                first_name: r.first_name,
                username: r.username,
                level: r.level || 1,
                joined_at: r.created_at,
                bonuses: { level_5: r.bonus_claimed, level_10: false, level_20: false }
            }))
        });
    } catch (err) {
        handleError(res, err, 'referral_list');
    }
});

/**
 * PUT /referral/code — изменить реферальный код
 */
router.put('/referral/code', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const { new_code } = req.body;

        if (!new_code || new_code.length < 3 || new_code.length > 20 || !/^[A-Z0-9_]+$/i.test(new_code)) {
            return res.status(400).json({ error: 'Некорректный код' });
        }

        const existing = await queryOne('SELECT id FROM players WHERE referral_code = $1 AND id != $2', [new_code, playerId]);
        if (existing) {
            return res.status(400).json({ error: 'Код уже занят' });
        }

        await query('UPDATE players SET referral_code = $1 WHERE id = $2', [new_code, playerId]);
        res.json({ success: true, code: new_code });
    } catch (err) {
        handleError(res, err, 'referral_code_put');
    }
});

/**
 * POST /referral/use — использовать реферальный код
 */
router.post('/referral/use', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const { code } = req.body;

        if (!code) return res.status(400).json({ error: 'Введите код' });

        const BONUS_COINS = 50;
        const BONUS_ENERGY = 20;

        const result = await tx(async (client) => {
            // Блокируем referrer и ищем по коду внутри транзакции
            const referrerResult = await client.query(
                'SELECT id FROM players WHERE referral_code = $1 FOR UPDATE',
                [code]
            );
            if (!referrerResult.rows[0]) {
                throw { message: 'Код не найден', code: 'NOT_FOUND', statusCode: 400 };
            }
            if (referrerResult.rows[0].id === playerId) {
                throw { message: 'Нельзя использовать свой код', code: 'SELF_REFERRAL', statusCode: 400 };
            }

            // Проверяем существование реферала в той же транзакции
            const existingResult = await client.query(
                'SELECT id FROM referrals WHERE referrer_id = $1 AND referred_id = $2',
                [referrerResult.rows[0].id, playerId]
            );
            if (existingResult.rows[0]) {
                throw { message: 'Код уже использован', code: 'ALREADY_USED', statusCode: 400 };
            }

            await client.query(
                'UPDATE players SET coins = coins + $1, energy = LEAST(energy + $2, max_energy), last_energy_update = NOW() WHERE id = $3',
                [BONUS_COINS, BONUS_ENERGY, playerId]
            );
            await client.query(
                'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
                [referrerResult.rows[0].id, playerId]
            );

            return { coins: BONUS_COINS, energy: BONUS_ENERGY };
        });

        res.json({
            success: true,
            bonus: { coins: BONUS_COINS, energy: BONUS_ENERGY }
        });
    } catch (err) {
        if (err.code === 'NOT_FOUND' || err.code === 'SELF_REFERRAL' || err.code === 'ALREADY_USED') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        handleError(res, err, 'referral_use');
    }
});

module.exports = router;
