/**
 * Игрок: профиль, обновление полей, энергия, daily-bonus, достижения.
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { logger, safeJsonParse, handleError, logPlayerAction, validateId, ok, unauthorized, notFound } = require('../../utils/serverApi');

// Загрузка игровых хелперов из utils/game-helpers.js (инвентарь, регенерация и т.д.).
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
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress, regenerateHealth, recalcEnergy } = helpers;
// Daily bonus: базовая сумма, лимит серии и стоимость (2 public/shared/equipment.js).
const equipmentRules = require('../../public/shared/equipment.js');
const { DAILY_BONUS_COOLDOWN_MS, DAILY_BONUS_STREAK_LIMIT, DAILY_BONUS_BASE_COINS, DAILY_BONUS_COINS_PER_DAY, DAILY_BONUS_STAR_EVERY } = equipmentRules;

// Whitelist полей, доступных для обновления профиля.
//
// 'avatar' не входит — players.avatar есть в db/schema.js, но обновление через
// этот эндпоинт не поддерживается (иначе возможна ошибка 42703 и 500).
// Для остальных полей — только простые строки.
const ALLOWED_UPDATE_FIELDS = ['username', 'first_name', 'last_name'];

const UPDATE_FIELD_RULES = {
    username: { type: 'string', max: 64, nullable: true },
    first_name: { type: 'string', max: 128, nullable: true },
    last_name: { type: 'string', max: 128, nullable: true }
};

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
 * Валидация полей для обновления профиля.
 * @param {Object} updates поля для обновления
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function validateUpdateValues(updates) {
    for (const [field, value] of Object.entries(updates)) {
        const rule = UPDATE_FIELD_RULES[field];
        if (!rule) continue;

        if (value === null) {
            if (!rule.nullable) {
                return { ok: false, error: `Поле «${field}» не может быть null` };
            }
            continue;
        }

        if (typeof value !== rule.type) {
            return { ok: false, error: `Поле «${field}» должно быть ${rule.type}` };
        }

        if (value.length > rule.max) {
            return { ok: false, error: `Поле «${field}» слишком длинное (макс. ${rule.max})` };
        }
    }
    return { ok: true };
}

/**
 * GET /profile — получение профиля игрока.
 * Алиас: / (через /profile), и /player (отдельный маршрут).
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

        // Обновление HP и энергии внутри транзакции с блокировкой игрока.
        // Если игрок не найден в транзакции — выбрасываем PLAYER_NOT_FOUND.
        // regenerateHealth и recalcEnergy работают с last_hp_regen / last_energy_update.
        const locked = await transaction(async (client) => {
            const l = await lockPlayer(playerId, client, 'id, health, max_health, last_hp_regen, energy, max_energy, last_energy_update');
            if (!l) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            await regenerateHealth(client, l);
            await recalcEnergy(client, l);
            return l;
        }).catch((err) => {
            logger.warn('[player] Не удалось обновить HP и энергию игрока', {
                playerId, error: err && err.message
            });
            throw err;
        });
        if (locked) {
            player.health = locked.health;
            player.energy = locked.energy;
            player.last_energy_update = locked.last_energy_update;
        }

        let achievements = [];
        let progress = null;
        try {
            achievements = await getPlayerAchievements(playerId);
        } catch (_) { /* ignore */ }
        try {
            progress = await getPlayerProgress(playerId);
        } catch (_) { /* ignore */ }
        const status = buildPlayerStatus(player);

        // Количество убитых боссов: приоритет boss_mastery (сумма kills),
        // fallback — players.bosses_killed.
        let bossesKilled = Number(player.bosses_killed || 0);
        try {
            const bossKillsRow = await queryOne(
                `SELECT COALESCE(SUM(kills), 0) AS total FROM boss_mastery WHERE player_id = $1`,
                [playerId]
            );
            if (bossKillsRow) bossesKilled = Number(bossKillsRow.total || 0);
        } catch (_) { /* fallback to players.bosses_killed */ }

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
                    // Текущий уровень радиации. Инфекции — отдельно в infections / infections_list.
                    radiation: status.radiation,
                    clan_id: player.clan_id,
                    clan_role: player.clan_role,
                    daily_streak: player.daily_streak,
                    bosses_killed: bossesKilled,
                    pvp_wins: player.pvp_wins,
                    pvp_losses: player.pvp_losses,
                    pvp_rating: player.pvp_rating,
                    created_at: player.created_at,
                    last_daily_bonus: player.last_daily_bonus,
                    // Для UI: время последнего обновления энергии, текущая локация.
                    last_energy_update: player.last_energy_update,
                    current_location_id: player.current_location_id
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
        if (err?.code === 'PLAYER_NOT_FOUND') {
            return res.status(404).json({ success: false, error: err.message, code: err.code });
        }
        res.status(500).json({ error: 'Ошибка загрузки профиля' });
    }
});

/**
 * PUT /update — обновление полей профиля (только из белого списка).
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
            return res.status(400).json({ error: 'Нет полей для обновления' });
        }

        // Валидация значений перед UPDATE, чтобы избежать ошибок Postgres
        // (например, username: 42 или first_name: { a: 1 }).
        const valuesCheck = validateUpdateValues(updates);
        if (!valuesCheck.ok) {
            return res.status(400).json({ success: false, error: valuesCheck.error, code: 'VALIDATION_ERROR' });
        }

        const setClauses = fieldNames.map((field, i) => `${field} = $${i + 2}`);
        const values = fieldNames.map(f => updates[f]);
        values.unshift(playerId);

        await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'id');

            if (!playerRow) {
                throw { message: 'Игрок не найден', code: 'NOT_FOUND' };
            }
            await client.query(
                `UPDATE players SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
                values
            );
        });

        await logPlayerAction(playerId, 'profile_update', { fields: fieldNames }).catch(() => {});

        const updatedPlayer = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!updatedPlayer) return notFound(res, 'Игрок не найден', 'PLAYER_NOT_FOUND');

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
        if (err?.code === 'NOT_FOUND' || err?.code === 'PLAYER_NOT_FOUND') {
            return res.status(404).json({ success: false, error: err.message, code: err.code });
        }
        res.status(500).json({ error: 'Ошибка обновления профиля' });
    }
});

/**
 * POST /buy-energy — покупка энергии за звёзды.
 */
router.post('/buy-energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        // Стоимость и количество энергии берутся из public/shared/equipment.js
        // (восстановление энергии в restoreEnergy).
        const STARS_COST = Number.isFinite(equipmentRules.ENERGY_PURCHASE_STARS_COST) ? equipmentRules.ENERGY_PURCHASE_STARS_COST : 5;
        const ENERGY_PER_PURCHASE = Number.isFinite(equipmentRules.ENERGY_PER_PURCHASE) ? equipmentRules.ENERGY_PER_PURCHASE : 25;

        const result = await transaction(async (client) => {
            const p = await lockPlayer(playerId, client, 'stars, energy, max_energy');

            if (!p) throw { message: 'Игрок не найден', code: 'NOT_FOUND', statusCode: 404 };
            const stars = Number(p.stars || 0);
            const energy = Number(p.energy || 0);
            const maxEnergy = Number(p.max_energy ?? 50);
            if (stars < STARS_COST) throw { message: 'Недостаточно звёзд', code: 'INSUFFICIENT_STARS' };
            if (energy >= maxEnergy) throw { message: 'Энергия уже полна', code: 'ENERGY_FULL' };

            const newEnergy = Math.min(energy + ENERGY_PER_PURCHASE, maxEnergy);

            await client.query(
                'UPDATE players SET stars = GREATEST(0, COALESCE(stars,0) - $1), energy = $2 WHERE id = $3',
                [STARS_COST, newEnergy, playerId]
            );

            return {
                energy: newEnergy,
                stars: stars - STARS_COST,
                log: { action: 'buy_energy', playerId, data: { cost: STARS_COST, gained: ENERGY_PER_PURCHASE } }
            };
        });

        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // Логирование не блокирует ответ.
            }
        }

        res.json({ success: true, data: { energy: result.energy, stars: result.stars } });
    } catch (err) {
        if (err.code === 'INSUFFICIENT_STARS' || err.code === 'ENERGY_FULL' || err.code === 'NOT_FOUND') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        handleError(res, err, 'buy_energy');
    }
});

/**
 * POST /daily-bonus — получение ежедневного бонуса (раз в 24 часа).
 *
 * Награда: монеты (+25 за каждый день, максимум за лимит серии) и звёзды.
 * Серия сбрасывается, если прошло больше 48 часов.
 * Константы из equipment.js (Daily bonus rules).
 */
router.post('/daily-bonus', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'id, coins, stars, daily_streak, last_daily_bonus');

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

            // Серия сохраняется, если последний бонус был не позднее 48 часов назад.
            const keepsStreak = lastBonus && (now - lastBonus) <= 2 * DAILY_BONUS_COOLDOWN_MS;
            const streak = keepsStreak ? Number(player.daily_streak || 0) + 1 : 1;
            const cappedDay = Math.min(streak, DAILY_BONUS_STREAK_LIMIT);

            const coins = DAILY_BONUS_BASE_COINS + (cappedDay - 1) * DAILY_BONUS_COINS_PER_DAY;
            const stars = cappedDay % DAILY_BONUS_STAR_EVERY === 0 ? 1 : 0;

            await client.query(
                `UPDATE players
                    SET coins = COALESCE(coins,0) + $1,
                        stars = COALESCE(stars,0) + $2,
                        daily_streak = $3,
                        last_daily_bonus = NOW()
                  WHERE id = $4`,
                [coins, stars, streak, playerId]
            );

            try {
                const h = getGameHelpers();
                if (h && typeof h.checkAchievements === 'function') h.checkAchievements(playerId, client).catch(() => {});
            } catch (_) { /* ignore */ }

            return {
                success: true,
                message: `День ${streak}: +${coins} монет${stars ? ` и +${stars} ★` : ''}`,
                coins: coins,
                stars: stars,
                daily_streak: streak,
                coins_total: Number(player.coins || 0) + coins,
                stars_total: Number(player.stars || 0) + stars,
                next_claim_at: new Date(now + DAILY_BONUS_COOLDOWN_MS).toISOString(),
                log: { action: 'daily_bonus', playerId, data: { coins, stars, streak } }
            };
        });

        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // Логирование не блокирует ответ.
            }
        }

        const { log: _log, ...responseData } = result;
        res.json({ success: true, data: responseData });
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

// GET /auto-heal — авто-лечение (внутренний вызов из других маршрутов).
// Включается автоматически при regeneration HP / energía.

/**
 * GET /achievements — список достижений игрока.
 */
router.get('/achievements', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        const achievements = await getPlayerAchievements(playerId);
        res.json({ success: true, data: achievements || [] });
    } catch (err) {
        handleError(res, err, 'get_achievements');
    }
});

/**
 * GET /achievements/progress — прогресс достижений игрока.
 *
 * В отличие от GET /achievements, здесь для каждого достижения вычисляются
 * progress / target / percent / completed и catégorie.
 * Поля: id/key/desc/req/reward (отдельно reward.coins / reward.stars).
 * См. renderAchievementsList (reward.coins и reward.stars).
 *
 * target/current — "текущее / целевое" (например, 3/5).
 * Для first_boss_kill цель — 1, current — count.
 */
router.get('/achievements/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const helpers = getGameHelpers();
        const {
            getAchievementRuntimeContext,
            getAchievementTargetValue,
            getAchievementCurrentValue,
            safeJsonParse: parseJson
        } = helpers;

        // Достижения игрока + условие каждого.
        const rowsResult = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
              FROM achievements a
              LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
             ORDER BY a.category, a.id
        `, [playerId]);

        // Текущий прогресс игрока: level, pvp_wins, items_collected и т.д.
        const playerResult = await queryOne(
            'SELECT level, pvp_wins, items_collected, clan_id, clan_role, daily_streak, unique_items, locations_visited FROM players WHERE id = $1',
            [playerId]
        );
        const player = playerResult || {};
        const runtimeContext = await getAchievementRuntimeContext(null, playerId);

        const progress = (rowsResult.rows || []).map(row => {
            const condition = parseJson(row.condition, {}) || {};
            const target = Math.max(0, Number(getAchievementTargetValue(condition, runtimeContext)) || 0);
            const stored = Math.max(0, Number(row.progress_value) || 0);
            const computed = Number(getAchievementCurrentValue(condition, player, runtimeContext)) || 0;
            // Берём максимум из сохранённого progress_value и вычисленного.
            // Если сервер перезагружен, computed может быть 0 — тогда берём stored.
            const current = Math.max(stored, computed);
            const reward = parseJson(row.reward, {}) || {};

            return {
                id: row.id,
                name: row.name,
                description: row.description || '',
                category: row.category,
                icon: row.icon,
                rarity: row.rarity,
                current: current,
                target: target,
                percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
                completed: Boolean(row.completed) || (target > 0 && current >= target),
                reward_claimed: Boolean(row.reward_claimed),
                // reward — {coins, stars}: используются reward.coins / reward.stars.
                reward: {
                    coins: Number(reward.coins) || 0,
                    stars: Number(reward.stars) || 0
                }
            };
        });

        // Статистика по категориям: сколько выполнено из скольких.
        const categories = {};
        for (const item of progress) {
            const key = item.category || 'other';
            if (!categories[key]) categories[key] = { completed: 0, total: 0 };
            categories[key].total += 1;
            if (item.completed) categories[key].completed += 1;
        }

        res.json({ success: true, data: { progress, categories } });
    } catch (err) {
        logger.error({ type: 'achievements_progress_error', message: err.message });
        res.status(500).json({ error: 'Ошибка загрузки достижений' });
    }
});

/**
 * POST /achievements/claim — получение награды за достижение.
 */
router.post('/achievements/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const achievement_id = req.body?.achievement_id;

        // Валидация ID достижения: пустая строка, null, 0, 'abc', '1.5' — отклоняются.
        // validateId защищает от инъекций (как в /clan/join и serverApi).
        const idCheck = validateId(achievement_id, 'ID достижения');
        if (!idCheck.ok) {
            return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });
        }

        const helpers = getGameHelpers();
        const { claimAchievementReward } = helpers;

        const result = await claimAchievementReward(playerId, idCheck.value);

        res.json({ success: true, data: result });
    } catch (err) {
        handleError(res, err, 'claim_achievement');
    }
});

/**
 * GET /progress — прогресс игрока.
 */
router.get('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        const progress = await getPlayerProgress(playerId);
        res.json({ success: true, data: progress || {} });
    } catch (err) {
        handleError(res, err, 'get_progress');
    }
});

/**
 * GET /energy — энергия игрока.
 * GET /api/game/profile/energy (через /profile, routes/game/index.js:375)
 * Ответ: { success: true, data: { energy, max_energy, last_energy_update } }
 */
router.get('/energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return unauthorized(res);
        }

        const player = await queryOne(
            'SELECT energy, max_energy, last_energy_update FROM players WHERE id = $1',
            [playerId]
        );
        if (!player) {
            return notFound(res, 'Игрок не найден');
        }

        return ok(res, {
            energy: Number(player.energy),
            max_energy: Number(player.max_energy),
            last_energy_update: player.last_energy_update
        });
    } catch (err) {
        logger.error({ type: 'player_energy_error', message: err.message });
        return handleError(res, err, 'get_player_energy');
    }
});

module.exports = router;
