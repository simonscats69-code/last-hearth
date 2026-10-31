/**
 * Профиль игрока, достижения и энергия
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { logger, safeJsonParse, handleError, logPlayerAction, validateId, ok, unauthorized, notFound } = require('../../utils/serverApi');

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
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress, regenerateHealth, recalcEnergy } = helpers;
// Общий файл правил с клиентом: цены покупки энергии (в звёздах), ежедневный бонус.
const equipmentRules = require('../../public/shared/equipment.js');
const { DAILY_BONUS_COOLDOWN_MS, DAILY_BONUS_STREAK_LIMIT, DAILY_BONUS_BASE_COINS, DAILY_BONUS_COINS_PER_DAY, DAILY_BONUS_STAR_EVERY } = equipmentRules;


// C-6: Whitelist разрешённых полей для обновления профиля
//
// P2: 'avatar' убран. Колонки players.avatar нет в db/schema.js, поэтому
// запрос с ней всегда падал на БД (42703) -> 500 вместо понятного ответа.
// Вернуть поле можно вместе с миграцией, добавив колонку.
const ALLOWED_UPDATE_FIELDS = ['username', 'first_name', 'last_name'];

/**
 * Тип/ограничения для каждого поля профиля.
 * Значения из тела запроса без проверки уходили прямиком в UPDATE.
 */
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
 * Проверка значений перед UPDATE: тип и длина.
 * @param {Object} updates отфильтрованные поля
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function validateUpdateValues(updates) {
    for (const [field, value] of Object.entries(updates)) {
        const rule = UPDATE_FIELD_RULES[field];
        if (!rule) continue;

        if (value === null) {
            if (!rule.nullable) {
                return { ok: false, error: `Поле «${field}» не может быть пустым` };
            }
            continue;
        }

        if (typeof value !== rule.type) {
            return { ok: false, error: `Поле «${field}» должно быть строкой` };
        }

        if (value.length > rule.max) {
            return { ok: false, error: `Поле «${field}» слишком длинное (макс. ${rule.max})` };
        }
    }
    return { ok: true };
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
        // P2: .catch(() => 0) глотал ошибку совсем — рассинхрон показанного
        // и фактического HP оставался невидимым. Логируем причину.
        const locked = await transaction(async (client) => {
            const l = await lockPlayer(playerId, client, 'id, health, max_health, last_hp_regen, energy, max_energy, last_energy_update');
            if (!l) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            await regenerateHealth(client, l);
            await recalcEnergy(client, l);
            return l;
        }).catch((err) => {
            logger.warn('[player] Не удалось обновить реген здоровья в профиле', {
                playerId, error: err && err.message
            });
            throw err;
        });
        if (locked) {
            player.health = locked.health;
            player.energy = locked.energy;
            player.last_energy_update = locked.last_energy_update;
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
                    // Заражение зоны одно — radiation. Инфекции объединены
                    // с ним, полей infections / infections_list в ответе нет.
                    radiation: status.radiation,
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

        // P2: значения теперь проверяются по типу и длине ДО запроса.
        // Раньше { username: 42 } или { first_name: { a: 1 } } уходили в UPDATE,
        // pg падал с 22P02, и игрок получал «Ошибка обновления профиля».
        const valuesCheck = validateUpdateValues(updates);
        if (!valuesCheck.ok) {
            return res.status(400).json({ success: false, error: valuesCheck.error, code: 'VALIDATION_ERROR' });
        }

        const setClauses = fieldNames.map((field, i) => `${field} = $${i + 2}`);
        const values = fieldNames.map(f => updates[f]);
        values.unshift(playerId);

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'id');

            if (!playerRow) {
                throw { message: 'Игрок не найден', code: 'NOT_FOUND' };
            }
            await client.query(
                `UPDATE players SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
                values
            );
        });

        await logPlayerAction(playerId, 'profile_update', { fields: fieldNames });

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
 * POST /buy-energy — покупка энергии за звёзды
 */
router.post('/buy-energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        // Цена и объём — из общего файла правил, тем же файлом пользуется
        // клиент (public/game.js, restoreEnergy). Раньше «5» и «25» были
        // записаны здесь отдельно, а клиент держал свою копию цены.
        const STARS_COST = equipmentRules.ENERGY_PURCHASE_STARS_COST;
        const ENERGY_PER_PURCHASE = equipmentRules.ENERGY_PER_PURCHASE;

        const result = await transaction(async (client) => {
            const p = await lockPlayer(playerId, client, 'stars, energy, max_energy');

            if (!p) throw { message: 'Игрок не найден', code: 'NOT_FOUND', statusCode: 404 };
            const stars = Number(p.stars || 0);
            const energy = Number(p.energy || 0);
            const maxEnergy = Number(p.max_energy || 0) || 50;
            if (stars < STARS_COST) throw { message: 'Недостаточно звёзд', code: 'INSUFFICIENT_STARS' };
            if (energy >= maxEnergy) throw { message: 'Энергия уже полная', code: 'ENERGY_FULL' };

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

        // Логируем ПОСЛЕ коммита транзакции
        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // не влияем на ответ
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
 * POST /daily-bonus — ежедневный бонус (раз в 24 часа).
 * 
 * Награда растёт с серией (+25 монет/день, макс. 7 дней).
 * Каждые 3 дня — одна звезда. Пропуск >48 часов обнуляет серию.
 * Константы берутся из equipment.js (единый источник правды с клиентом).
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

            // Серия сохраняется, только если прошлый бонус был не более двух
            // суток назад; иначе игрок начинает заново с первого дня.
            const keepsStreak = lastBonus && (now - lastBonus) <= 2 * DAILY_BONUS_COOLDOWN_MS;
            const streak = keepsStreak ? Number(player.daily_streak || 0) + 1 : 1;
            const cappedDay = Math.min(streak, DAILY_BONUS_STREAK_LIMIT);

            const coins = DAILY_BONUS_BASE_COINS + (cappedDay - 1) * DAILY_BONUS_COINS_PER_DAY;
            const stars = streak % DAILY_BONUS_STAR_EVERY === 0 ? 1 : 0;

            await client.query(
                `UPDATE players
                    SET coins = COALESCE(coins,0) + $1,
                        stars = COALESCE(stars,0) + $2,
                        daily_streak = $3,
                        last_daily_bonus = NOW()
                  WHERE id = $4`,
                [coins, stars, streak, playerId]
            );

            return {
                success: true,
                message: `День ${streak}: +${coins} монет${stars ? ` и +${stars} ⭐` : ''}`,
                coins: coins,
                stars: stars,
                daily_streak: streak,
                coins_total: Number(player.coins || 0) + coins,
                stars_total: Number(player.stars || 0) + stars,
                next_claim_at: new Date(now + DAILY_BONUS_COOLDOWN_MS).toISOString(),
                log: { action: 'daily_bonus', playerId, data: { coins, stars, streak } }
            };
        });

        // Логируем ПОСЛЕ коммита транзакции
        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // не влияем на ответ
            }
        }

        const { log, ...responseData } = result;
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

// Роут POST /auto-heal удалён вместе с автоиспользованием лекарств:
// настраивать порог и включение больше не нужно — лечение только ручное,
// кнопками на панели лечения главного экрана.

/**
 * GET /achievements — достижения игрока
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
 * GET /achievements/progress — достижения в формате экрана достижений.
 *
 * Зачем отдельно от GET /achievements: тот отдаёт «плоский» список для
 * профиля (id/key/desc/req/reward-числом), а экран достижений ждёт
 * { progress: [...], categories: { key: {completed, total} } } с полями
 * description/current/target/percent/completed и reward-ОБЪЕКТОМ
 * (renderAchievementsList читает reward.coins и reward.stars).
 *
 * Клиент звал /api/achievements/progress, которого не существовало:
 * 404 Not found и пустой экран достижений.
 *
 * target/current считаем ТЕМИ ЖЕ функциями, что и /progress
 * (getAchievementTargetValue / getAchievementCurrentValue): условие в БД
 * хранит цель в count, в value, или не хранит вовсе (first_boss_kill),
 * и собственный разбор разошёлся бы с экраном прогресса.
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

        // Достижения + прогресс игрока
        const rowsResult = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
              FROM achievements a
              LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
             ORDER BY a.category, a.id
        `, [playerId]);

        // Статы игрока: нужны getAchievementCurrentValue (level, pvp_wins, ...)
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
            // Берём большее из двух: progress_value обновляется фоновым
            // обработчиком, computed — живой расчёт. Иначе прогресс-бар
            // показывал бы 0 у только что выполненного достижения.
            const current = Math.max(stored, computed);
            const reward = parseJson(row.reward, {}) || {};

            return {
                id: row.id,
                name: row.name,
                // Клиентский renderAchievementsList читает именно description
                description: row.description || '',
                category: row.category,
                icon: row.icon,
                rarity: row.rarity,
                current: current,
                target: target,
                percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
                completed: Boolean(row.completed) || (target > 0 && current >= target),
                reward_claimed: Boolean(row.reward_claimed),
                // reward — ОБЪЕКТ {coins, stars}: клиент читает reward.coins/stars.
                reward: {
                    coins: Number(reward.coins) || 0,
                    stars: Number(reward.stars) || 0
                }
            };
        });

        // Группировка для кнопок категорий: «👾 Боссы (3/5)»
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
        res.status(500).json({ error: 'Ошибка получения достижений' });
    }
});

/**
 * POST /achievements/claim — получить награду за достижение
 */
router.post('/achievements/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        // Валидация типа ID, а не только «не пустой».
        //
        // ЗДЕСЬ БЫЛ БАГ: проверялось только `!achievement_id`, которое
        // отсекает '' / null / 0, но пропускает 'abc' и '1.5'. Дальше
        // Number(achievement_id) давал NaN / 1.5, claimAchievementReward
        // отдавал это в `WHERE a.id = $2` и Postgres отвечал 22P02
        // (invalid input syntax for integer) — 500 вместо 400.
        // Тот же validateId уже используется в /clan/join и в serverApi.
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
 * GET /progress — прогресс игрока
 */
router.get('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        res.json({ success: true, data: progress || {} });
    } catch (err) {
        handleError(res, err, 'get_progress');
    }
});

/**
 * GET /energy — текущая энергия игрока
 * GET /api/game/profile/energy (через алиас /profile в routes/game/index.js:375)
 * Возвращает { success: true, data: { energy, max_energy, last_energy_update } }
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
