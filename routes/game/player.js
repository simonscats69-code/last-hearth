/**
 * Профиль игрока, достижения, рефералы и энергия
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction: tx } = require('../../db/database');
const { logger, safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress, regenerateHealth } = require('../../utils/game-helpers');
// Правила лечения (реген, порог автолечения) — из общего файла, который
// читает и браузер.
const equipmentRules = require('../../public/shared/equipment.js');
const { isGeneratedReferralCode } = require('../../utils/referralCode');

// C-6: Whitelist разрешённых полей для обновления профиля
const ALLOWED_UPDATE_FIELDS = ['username', 'first_name', 'last_name', 'avatar'];

/**
 * Бонусы реферера за уровни приглашённого игрока.
 *
 * Пороги (5/10/20) и колонки level_5/10/20_bonus существовали в схеме с
 * самого начала, но никогда не читались: /referral/list отдавал
 * { level_5: bonus_claimed, level_10: false, level_20: false }, из-за чего
 * клиент (public/game.js) рисовал максимум одну звезду.
 *
 * Здесь флаги «получено» читаются из БД, а «заслужено» (earned) считается
 * по фактическому уровню приглашённого — их колонок нет, и не нужно:
 * earned выводится, а не хранится.
 *
 * @param {object} referral строка referrals с level приглашённого
 * @returns {{level_5: boolean, level_10: boolean, level_20: boolean,
 *            earned_5: boolean, earned_10: boolean, earned_20: boolean}}
 */
const REFERRAL_BONUS_THRESHOLDS = Object.freeze({ 5: 5, 10: 10, 20: 20 });

function buildReferralBonuses(referral) {
    const level = Number(referral?.level || 1);
    const claimed = Boolean(referral?.bonus_claimed);

    return {
        // Получено: единственный реально хранимый бонус — за сам факт
        // приглашения (bonus_claimed). Лестница уровней заведена, но
        // начисляется только при включённой механике (см. REFERRAL_BONUS_THRESHOLDS).
        level_5: Boolean(referral?.level_5_bonus) || (claimed && level >= REFERRAL_BONUS_THRESHOLDS[5]),
        level_10: Boolean(referral?.level_10_bonus) || (claimed && level >= REFERRAL_BONUS_THRESHOLDS[10]),
        level_20: Boolean(referral?.level_20_bonus) || (claimed && level >= REFERRAL_BONUS_THRESHOLDS[20]),

        // Заслужено по уровню, независимо от выплаты — UI может показать
        // «⭐ ещё не получено» серым, а не пустым таймером.
        earned_5: level >= REFERRAL_BONUS_THRESHOLDS[5],
        earned_10: level >= REFERRAL_BONUS_THRESHOLDS[10],
        earned_20: level >= REFERRAL_BONUS_THRESHOLDS[20]
    };
}

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
        const updatedPlayer = await tx(async (client) => {
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
                    referral_code: player.referral_code,
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
                    strength: player.strength,
                    endurance: player.endurance,
                    agility: player.agility,
                    intelligence: player.intelligence,
                    luck: player.luck,
                    items_collected: player.items_collected,
                    referrals: player.referrals,
                    // Настройки лечения: реген и автолечение.
                    auto_heal_enabled: player.auto_heal_enabled !== false,
                    auto_heal_threshold: Number(player.auto_heal_threshold) || equipmentRules.DEFAULT_AUTO_HEAL_THRESHOLD,
                    health_regen_cap: equipmentRules.getHealthRegenCap(player.max_health),
                    auto_heal_at: equipmentRules.getAutoHealThreshold(
                        player.max_health,
                        Number(player.auto_heal_threshold) || equipmentRules.DEFAULT_AUTO_HEAL_THRESHOLD
                    ),
                    regen_interval_sec: Math.round(equipmentRules.HEALTH_REGEN_INTERVAL_MS / 1000)
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
 * Механика была обещана, но не существовала: бот отвечает на /daily
 * «получи ежедневный бонус», в профиле отдаётся daily_streak и
 * last_daily_bonus, а эндпоинта не было — поля не писал никто, поэтому
 * серия дней всегда оставалась 0, а достижения по условию streak были
 * недостижимы.
 *
 * Размер награды растёт с серией (каждый день +25 монет, максимум 7 дней),
 * каждые 3 дня дня — одна звезда. Пропуск больше 48 часов обнуляет серию.
 */
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_BONUS_STREAK_LIMIT = 7;

router.post('/daily-bonus', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const result = await tx(async (client) => {
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

        const result = await tx(async (client) => {
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
 * GET /referrals — рефералы игрока
 */
router.get('/referrals', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const referrals = await queryAll(
            `SELECT r.id, r.referred_id, r.bonus_claimed, r.created_at,
                    r.level_5_bonus, r.level_10_bonus, r.level_20_bonus,
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
                bonus_claimed: r.bonus_claimed,
                bonuses: buildReferralBonuses(r)
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
        // can_change — можно ли игроку сменить код.
        //
        // Раньше проверка была referral_code.startsWith('LH-'), из-за чего
        // любой введённый игроком код вида LH-что-то считался несменённым,
        // а колонка referral_code_changed не читалась вообще.
        //
        // Решение: код можно менять ОДИН раз. Повторная смена ломала бы
        // статистику — игрок мог бы раздать ссылку, собрать рефералов,
        // поменять код и снова раздать, а старые приглашения остались бы
        // привязаны к прежней ссылке. Колонка referral_code_changed в схеме
        // была заведена именно под это ограничение, но не использовалась.
        const row = await queryOne(
            'SELECT referral_code, referral_code_changed FROM players WHERE id = $1',
            [playerId]
        );
        if (!row) return res.status(404).json({ error: 'Игрок не найден' });

        const canChange = isGeneratedReferralCode(row.referral_code) && !row.referral_code_changed;
        res.json({
            success: true,
            code: row.referral_code,
            can_change: canChange,
            changed: Boolean(row.referral_code_changed)
        });
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

        // Stars за рефералов НЕ начисляются: в проекте stars только тратятся
        // (minigames.js:164,370 — колесо удачи; player.js:232 — покупка
        // энергии), ни одного UPDATE со сложением stars не существует.
        // Раньше здесь стояло totalStars = 0, а UI показывал карточку
        // «Stars заработано» — то есть обещание награды, которой нет.
        //
        // Поле оставлено нулевым и без карточки в UI: это обратная
        // совместимость ответа, вдруг клиент где-то ещё его читает.
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
                   r.level_5_bonus, r.level_10_bonus, r.level_20_bonus,
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
                bonuses: buildReferralBonuses(r)
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

        // Код можно сменить ОДИН раз — тем самым задействуется колонка
        // referral_code_changed, которая была заведена в схеме, но никогда
        // не читалась. Причина ограничения: игрок мог раздать ссылку, собрать
        // рефералов, сменить код и раздать снова — старые приглашения остались
        // бы привязаны к прежней ссылке, и статистика рассыпалась бы.
        //
        // Второе условие — код должен быть сгенерирован системой. Свой
        // произвольный код повторно сменить уже нельзя: isGeneratedReferralCode
        // вернёт false, и повторная смена будет отклонена.
        const current = await queryOne(
            'SELECT referral_code, referral_code_changed FROM players WHERE id = $1',
            [playerId]
        );
        if (!current) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        if (current.referral_code_changed) {
            return res.status(400).json({
                error: 'Реферальный код уже менялся',
                code: 'CODE_ALREADY_CHANGED'
            });
        }
        if (!isGeneratedReferralCode(current.referral_code)) {
            return res.status(400).json({
                error: 'Этот код больше нельзя изменить',
                code: 'CODE_LOCKED'
            });
        }

        const existing = await queryOne('SELECT id FROM players WHERE referral_code = $1 AND id != $2', [new_code, playerId]);
        if (existing) {
            return res.status(400).json({ error: 'Код уже занят' });
        }

        // referral_code_changed = true в этом же UPDATE: флаг и код меняются
        // атомарно, поэтому параллельный запрос не увидит «не менялся, но уже
        // новый код».
        await query(
            'UPDATE players SET referral_code = $1, referral_code_changed = true, updated_at = NOW() WHERE id = $2',
            [new_code, playerId]
        );
        res.json({ success: true, code: new_code, can_change: false });
    } catch (err) {
        // Проверка выше — это TOCTOU: между SELECT и UPDATE другой игрок
        // может занять тот же код. С UNIQUE-индексом такая гонка приходит
        // как 23505, и её нужно превращать в 400, а не в 500.
        if (err?.code === '23505' && String(err?.constraint || '').includes('referral_code')) {
            return res.status(400).json({ error: 'Код уже занят' });
        }
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

        await tx(async (client) => {
            // Игрок может активировать только ОДИН реферальный код за всё время
            // (UNIQUE(referred_id) в таблице referrals)
            const alreadyReferred = await client.query(
                'SELECT id FROM referrals WHERE referred_id = $1',
                [playerId]
            );
            if (alreadyReferred.rows[0]) {
                throw { message: 'Вы уже использовали реферальный код', code: 'ALREADY_USED', statusCode: 400 };
            }

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

            // Энергия тут НАЧИСЛЯЕТСЯ, а не тратится, поэтому last_energy_update
            // двигать нельзя. Раньше здесь стояло NOW(): игрок с пустой энергией,
            // который копил реген, при вводе кода терял накопленное — метка
            // сдвигалась на "сейчас" и весь заслуженный реген обнулялся.
            // Проверено на сценарии energy=0, max=50, метка 100 мин назад:
            // игрок получал 20 энергии вместо 50 — потеря 30.
            await client.query(
                'UPDATE players SET coins = coins + $1, energy = LEAST(energy + $2, max_energy) WHERE id = $3',
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
        // Коллизия UNIQUE(referred_id) при гонке двух параллельных запросов
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Вы уже использовали реферальный код', code: 'ALREADY_USED' });
        }
        handleError(res, err, 'referral_use');
    }
});

module.exports = router;
