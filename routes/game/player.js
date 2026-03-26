/**
 * Профиль игрока, достижения, рефералы и энергия
 * @module game/player
 * 
 * Объединённые модули:
 * - profile.js (профиль игрока)
 * - achievements.js (достижения)
 * - referral.js (реферальная система)
 * - energy.js (энергия и покупки за Stars)
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction: tx } = require('../../db/database');
const { getExpForLevel, getTotalExpForLevel } = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError, logPlayerActionSimple } = require('../../utils/serverApi');
const { buildPlayerStatus, normalizeInventory } = require('../../utils/playerState');
const { getPlayerAchievements, getPlayerProgress } = require('../../utils/achievements');
const {
    createReferralCode,
    changeReferralCode,
    applyReferralCode,
    giveReferralRegistrationBonus,
    getReferralsList,
    getReferralStats
} = require('../../db/database');



// =============================================================================
// УТИЛИТЫ
// =============================================================================

/**
 * Валидация Telegram ID
 */
function validateTelegramId(telegramId) {
    const num = Number(telegramId);
    return Number.isInteger(num) && num > 0;
}

function getRiskLabelByDanger(dangerLevel) {
    if (dangerLevel >= 7) return 'Смертельный риск';
    if (dangerLevel >= 5) return 'Опасный риск';
    if (dangerLevel >= 3) return 'Повышенный риск';
    return 'Стабильный риск';
}

async function buildPlayerJourney(playerId, playerLevel) {
    const [bossMasteries, bosses, locations] = await Promise.all([
        queryAll('SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1 ORDER BY boss_id ASC', [playerId]),
        queryAll('SELECT id, name FROM bosses ORDER BY id ASC'),
        queryAll('SELECT id, name, min_level, danger_level FROM locations ORDER BY min_level ASC, id ASC')
    ]);

    const masteryMap = new Map(bossMasteries.map((mastery) => [Number(mastery.boss_id), Number(mastery.kills || 0)]));
    const defeatedBossIds = bosses.filter((boss) => (masteryMap.get(Number(boss.id)) || 0) > 0).map((boss) => Number(boss.id));
    const lastDefeatedBossId = defeatedBossIds.length ? Math.max(...defeatedBossIds) : 0;

    const currentMainBoss = bosses.find((boss) => Number(boss.id) === lastDefeatedBossId + 1)
        || bosses.find((boss) => Number(boss.id) === lastDefeatedBossId)
        || bosses[0]
        || null;

    const nextZone = locations.find((location) => Number(location.min_level || 1) > Number(playerLevel || 1))
        || locations[locations.length - 1]
        || null;

    const unlockedLocations = locations.filter((location) => Number(playerLevel || 1) >= Number(location.min_level || 1));
    const masteredDangerLevel = unlockedLocations.reduce((max, location) => Math.max(max, Number(location.danger_level || 1)), 1);

    return {
        bosses_killed: bossMasteries.reduce((sum, mastery) => sum + Number(mastery.kills || 0), 0),
        current_main_boss: currentMainBoss ? {
            id: Number(currentMainBoss.id),
            name: currentMainBoss.name,
            defeated: (masteryMap.get(Number(currentMainBoss.id)) || 0) > 0,
            kills: masteryMap.get(Number(currentMainBoss.id)) || 0
        } : null,
        next_zone: nextZone ? {
            id: Number(nextZone.id),
            name: nextZone.name,
            required_level: Number(nextZone.min_level || 1),
            danger_level: Number(nextZone.danger_level || 1)
        } : null,
        mastered_risk: {
            danger_level: masteredDangerLevel,
            label: getRiskLabelByDanger(masteredDangerLevel)
        }
    };
}



// =============================================================================
// ПРОФИЛЬ ИГРОКА
// =============================================================================

// =============================================================================
// ПРОФИЛЬ, ДОСТИЖЕНИЯ, РЕФЕРАЛЫ, ЭНЕРГИЯ
// =============================================================================

/**
 * Получение профиля игрока
 * GET /api/game/profile (через алиас) или GET /api/game/player
 */
router.get('/', async (req, res) => {
    try {
        const telegramId = req.player.telegram_id;
        
        if (!validateTelegramId(telegramId)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный Telegram ID',
                code: 'INVALID_TELEGRAM_ID'
            });
        }
        
        let player = await queryOne(`
            SELECT p.*, l.name as location_name, l.description as location_description,
                   l.radiation as location_radiation, l.infection as location_infection, l.danger_level as location_danger_level,
                   l.icon as location_icon, p.last_energy_update as last_energy_update
            FROM players p
            LEFT JOIN locations l ON p.current_location_id = l.id
            WHERE p.telegram_id = $1
        `, [telegramId]);

        if (!player) {
            // Создаём нового игрока при первом входе
            logger.info(`[player] Создание нового игрока для telegram_id=${telegramId}`);
            
            const referralCode = 'LH-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            
            try {
                const newPlayer = await queryOne(`
                    INSERT INTO players (telegram_id, username, first_name, last_name, referral_code, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    RETURNING *
                `, [telegramId, req.player.username || null, req.player.first_name || 'Новичок', req.player.last_name || null, referralCode]);
                
                if (!newPlayer) {
                    return res.status(500).json({
                        success: false,
                        error: 'Не удалось создать игрока',
                        code: 'CREATE_PLAYER_FAILED'
                    });
                }
                
                player = newPlayer;
                logger.info(`[player] Создан новый игрок id=${player.id}, telegram_id=${telegramId}`);
            } catch (createError) {
                logger.error(`[player] Ошибка создания игрока: ${createError.message}`);
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка при создании игрока',
                    code: 'CREATE_PLAYER_ERROR'
                });
            }
        }

        const keys = await queryAll(`
            SELECT bk.boss_id, b.name as boss_name, bk.quantity
            FROM boss_keys bk
            JOIN bosses b ON bk.boss_id = b.id
            WHERE bk.player_id = $1
        `, [player.id]);
        const journey = await buildPlayerJourney(player.id, player.level);
        
        const expNeeded = getExpForLevel(player.level) || 1;
        const expPercent = Math.min(100, Math.floor((player.experience / expNeeded) * 100));
        const totalExpForNext = getTotalExpForLevel(player.level) + expNeeded;

        const inventory = normalizeInventory(player.inventory);
        const equipment = safeJsonParse(player.equipment, {});
        const status = buildPlayerStatus(player);

        logger.info(`[player] Просмотр профиля`, {
            playerId: player.id,
            level: player.level,
            location_id: player.current_location_id
        });

        res.json({
            success: true,
            data: {
                id: player.id,
                telegram_id: player.telegram_id,
                username: player.username,
                first_name: player.first_name,
                level: player.level,
                experience: player.experience,
                experience_current: Math.max(0, player.experience),
                exp_progress: {
                    current: player.experience,
                    needed: expNeeded,
                    total_for_next_level: totalExpForNext,
                    percent: expPercent
                },
                stats: {
                    strength: player.strength,
                    endurance: player.endurance,
                    agility: player.agility,
                    intelligence: player.intelligence,
                    luck: player.luck
                },
                status,
                location: {
                    id: player.current_location_id,
                    name: player.location_name,
                    description: player.location_description,
                    radiation: player.location_radiation,
                    infection: player.location_infection || 0,
                    danger_level: player.location_danger_level,
                    icon: player.location_icon || '🏠'
                },
                inventory: inventory,
                equipment: equipment,
                coins: player.coins,
                stars: player.stars,
                boss_keys: keys,
                journey,
                stats_ext: {
                    total_actions: player.total_actions,
                    bosses_killed: player.bosses_killed,
                    days_played: player.days_played
                }
            }
        });
        
    } catch (error) {
        handleError(res, error, 'profile_view');
    }
});



// =============================================================================
// ДОСТИЖЕНИЯ
// =============================================================================

/**
 * Получить все достижения
 * GET /player/achievements → GET /api/game/player/achievements
 */
router.get('/achievements', async (req, res) => {
    try {
        const playerId = req.player?.id;
        
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        
        const achievements = await getPlayerAchievements(playerId);
        
        res.json({
            success: true,
            achievements
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения достижений' });
    }
});

/**
 * Получить прогресс достижений
 * GET /player/achievements/progress → GET /api/game/player/achievements/progress
 */
router.get('/achievements/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        
        const progress = await getPlayerProgress(playerId);
        
        if (!progress) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        res.json({
            success: true,
            progress
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения прогресса' });
    }
});



// =============================================================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// =============================================================================

/**
 * Получение реферального кода
 * GET /player/referral/code → GET /api/game/player/referral/code
 */
router.get('/referral/code', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const player = await queryOne(
            'SELECT referral_code, referral_code_changed FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }

        let code = player.referral_code;
        if (!code) {
            code = await createReferralCode(playerId);
        }

        res.json({
            success: true,
            code,
            can_change: player.referral_code_changed !== true
        });
        
    } catch (error) {
        logger.error('[player] Ошибка /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Изменение реферального кода
 * PUT /player/referral/code → PUT /api/game/player/referral/code
 */
router.put('/referral/code', async (req, res) => {
    try {
        const newCode = String(req.body?.new_code || '').trim().toUpperCase();
        const result = await changeReferralCode(req.player.id, newCode);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        logger.error('[player] Ошибка PUT /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Статистика рефералов
 * GET /player/referral/stats → GET /api/game/player/referral/stats
 */
router.get('/referral/stats', async (req, res) => {
    try {
        const stats = await getReferralStats(req.player.id);

        res.json({
            success: true,
            stats
        });
        
    } catch (error) {
        logger.error({ type: 'referral_stats_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Использование реферального кода
 * POST /player/referral/use → POST /api/game/player/referral/use
 */
router.post('/referral/use', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const result = await applyReferralCode(req.player.id, code);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        logger.error({ type: 'referral_use_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Список рефералов
 * GET /player/referral/list → GET /api/game/player/referral/list
 */
router.get('/referral/list', async (req, res) => {
    try {
        const referrals = await getReferralsList(req.player.id);
        
        res.json({
            success: true,
            referrals: referrals
        });
        
    } catch (error) {
        logger.error({ type: 'referral_list_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Получение бонуса за реферала
 * POST /player/referral/claim-bonus → POST /api/game/player/referral/claim-bonus
 */
router.post('/referral/claim-bonus', async (req, res) => {
    try {
        const result = await giveReferralRegistrationBonus(req.player.id);
        res.status(result.success ? 200 : 400).json(result);
        
    } catch (error) {
        logger.error({ type: 'referral_claim_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});



// =============================================================================
// ЭНЕРГИЯ
// =============================================================================

/**
 * Покупка энергии за Stars
 * POST /player/buy-energy → POST /api/game/player/buy-energy
 * @deprecated Используйте EnergyAPI.buyEnergy()
 */
router.post('/buy-energy', async (req, res) => {
    try {
        let amount = req.body.amount;
        if (amount !== undefined && amount !== null) {
            amount = parseInt(amount);
            if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'amount должен быть числом от 1 до 100',
                    code: 'INVALID_AMOUNT'
                });
            }
        } else {
            amount = 50;
        }
        
        const player = req.player;
        const playerId = player.id;
        
        if (player.energy >= player.max_energy) {
            return res.status(400).json({
                success: false,
                message: 'Энергия уже полная',
                code: 'ENERGY_FULL'
            });
        }
        
        const result = await tx(async (client) => {
            const lockResult = await client.query(
                `SELECT energy, stars, max_energy FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );

            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const current = lockResult.rows[0];

            if (current.energy >= current.max_energy) {
                throw { message: 'Энергия уже полная', code: 'ENERGY_FULL', statusCode: 400 };
            }

            const actualAmount = Math.min(amount, current.max_energy - current.energy);
            const actualCost = Math.ceil(actualAmount / 10);

            if (current.stars < actualCost) {
                throw { message: 'Недостаточно Stars', code: 'NOT_ENOUGH_STARS', statusCode: 400 };
            }

            const updateResult = await client.query(
                `UPDATE players
                 SET energy = LEAST(max_energy, energy + $1),
                     stars = GREATEST(0, stars - $2),
                     last_energy_update = NOW()
                 WHERE id = $3
                 RETURNING energy, stars, max_energy, last_energy_update`,
                [actualAmount, actualCost, playerId]
            );

            await logPlayerActionSimple(client, playerId, 'buy_energy', {
                amount: actualAmount,
                stars_spent: actualCost,
                cost_per_unit: 0.1
            });

            return {
                success: true,
                energy: updateResult.rows[0].energy,
                max_energy: updateResult.rows[0].max_energy,
                energy_restored: actualAmount,
                stars_spent: actualCost,
                stars_remaining: updateResult.rows[0].stars,
                last_energy_update: updateResult.rows[0].last_energy_update
            };
        });
        
        res.json({
            message: 'Энергия куплена!',
            ...result
        });
        
    } catch (error) {
        if (error.code === 'NOT_ENOUGH_STARS') {
            return res.status(400).json({
                success: false,
                message: 'Недостаточно Stars',
                code: 'NOT_ENOUGH_STARS'
            });
        }
        if (error.code === 'ENERGY_FULL') {
            return res.status(400).json({
                success: false,
                message: 'Энергия уже полная',
                code: 'ENERGY_FULL'
            });
        }
        handleError(res, error, 'BUY_ENERGY');
    }
});

// ЭКСПОРТ

module.exports = router;
