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
// transaction() вместо ручного pool.connect()/BEGIN/COMMIT/ROLLBACK:
// в прежней записи catch выполнял ROLLBACK даже если транзакция уже
// была закоммичена (например, если res.json бросил исключение после
// COMMIT) — лишний запрос на закрытой транзакции.
const { query, transaction } = require('../../db/database');
const { logger, handleError, safeJsonParse, unauthorized } = require('../../utils/serverApi');

// ==========================================
// КОЛЕСО УДАЧИ (из wheel.js)
// ==========================================

/**
 * Призы колеса удачи — единый источник с клиентом (public/shared/equipment.js).
 *
 * Было: копия здесь с весами и копия в public/game.js без весов. Набор
 * призов менялся в одном месте, а анимация клиента продолжала подсвечивать
 * сектор, который сервер уже не выдаёт.
 */
const { WHEEL_PRIZES, WHEEL_FREE_SPIN_COOLDOWN_MS: FREE_SPIN_COOLDOWN_MS } = require('../../public/shared/equipment.js');

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
 * GET /wheel или GET / - получить информацию о колесе
 */
router.get(['/wheel', '/'], async (req, res) => {
    logger.info('[minigames/wheel] Начало запроса', { playerId: req.player?.id });
    const playerId = req.player?.id;

    if (!playerId) {
        logger.warn('[minigames/wheel] Нет playerId');
        return unauthorized(res, 'Не авторизован');
    }

    try {
        logger.info('[minigames/wheel] Запрос к БД для playerId', playerId);
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
            const lastSpinTime = new Date(lastSpin).getTime();
            if (isNaN(lastSpinTime)) {
                canSpinFree = true; // Если дата corrupted, разрешаем
            } else {
                const timeSinceLastSpin = now - lastSpinTime;
                canSpinFree = timeSinceLastSpin >= FREE_SPIN_COOLDOWN_MS;
            }
        }

        // Время до следующего бесплатного вращения
        let nextFreeSpin = null;
        if (!canSpinFree && lastSpin) {
            const lastSpinTime = new Date(lastSpin).getTime();
            if (!isNaN(lastSpinTime)) {
                const nextSpinTime = lastSpinTime + FREE_SPIN_COOLDOWN_MS;
                nextFreeSpin = Math.max(0, nextSpinTime - now);
            }
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
 * POST /wheel/spin или POST /spin - крутить колесо
 */
router.post(['/wheel/spin', '/spin'], async (req, res) => {
    const playerId = req.player?.id;
    // Валидация: преобразуем к boolean
    const is_paid = req.body?.is_paid === true || req.body?.is_paid === 'true';
    
    if (!playerId) {
        return unauthorized(res, 'Не авторизован');
    }
    
    // Раньше здесь вручную бралось соединение, а ветки «игрок не найден»,
    // «не хватает Stars» и «кулдаун» вызывали ROLLBACK и отвечали прямо
    // из try. С transaction() тело возвращает результат, а HTTP-ответ
    // отправляется один раз после завершения транзакции — заодно чинится
    // случай, когда ROLLBACK выполнялся уже после успешного COMMIT.
    try {
        const outcome = await transaction(async (client) => {
            // Получаем игрока
            const playerResult = await client.query(
                'SELECT id, coins, stars, energy, max_energy, last_wheel_spin FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            const player = playerResult.rows[0];

            if (!player) {
                return { status: 404, body: { success: false, error: 'Игрок не найден' } };
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
                    return { status: 200, body: { success: false, error: 'Недостаточно Stars', code: 'NO_STARS' } };
                }
                // Списываем Stars (без изменения last_wheel_spin для платных вращений).
                // GREATEST(0, ...): колонка под CHECK (stars >= 0), поэтому простое
                // "stars - 1" при гонке двух платных вращений дало бы 500 с
                // нарушением constraint вместо понятной бизнес-ошибки.
                await client.query(
                    'UPDATE players SET stars = GREATEST(0, stars - 1) WHERE id = $1',
                    [playerId]
                );
            } else {
                // Бесплатное вращение - проверяем кулдаун
                if (!canSpinFree) {
                    const nextSpinTime = new Date(lastSpin).getTime() + FREE_SPIN_COOLDOWN_MS;
                    const timeLeft = Math.ceil((nextSpinTime - now) / 1000 / 60);
                    return {
                        status: 200,
                        body: {
                            success: false,
                            error: `Следующее бесплатное вращение через ${timeLeft} мин.`,
                            code: 'COOLDOWN',
                            next_free_spin: nextSpinTime - now
                        }
                    };
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
            // «x2 к монетам» = удвоение баланса, значит выплата равна САМОМУ
            // балансу (coins * (value - 1)), а не новому значению.
            //
            // Регрессия: стояло newCoins = coins * value, и при value=2 это
            // ровно то же самое по модулю, но при любом value > 2 выплата
            // становилась coins*value, то есть прибавлялось в 3-4 раза больше
            // баланса за одно платное вращение. Плюс выплата неограниченно
            // росла вместе с балансом — множитель позволял фармить монеты
            // быстрее любого источника в игре.
            //
            // Ограничиваем: не более +2000 монет за одно вращение.
            const MAX_MULTIPLIER_BONUS = 2000;
            const multiplier = Math.max(2, Math.floor(prize.value) || 2);
            const rawBonus = Math.floor((player.coins || 0) * (multiplier - 1));
            const bonus = Math.max(0, Math.min(rawBonus, MAX_MULTIPLIER_BONUS));
            const updateCooldown = !is_paid ? ', last_wheel_spin = NOW()' : '';
            
            if (bonus > 0) {
                await client.query(
                    `UPDATE players SET coins = coins + $1${updateCooldown} WHERE id = $2`,
                    [bonus, playerId]
                );
            } else if (!is_paid) {
                // Нулевые монеты: удвоение нечего, но бесплатное вращение
                // всё равно потрачено — кулдаун обязан обновиться.
                await client.query(
                    'UPDATE players SET last_wheel_spin = NOW() WHERE id = $1',
                    [playerId]
                );
            }
            // При is_paid и отсутствии бонуса ничего не делаем
            }

            // Успешный путь: результат возвращаем, транзакция закоммитится
            // сама. Ответ уходит ниже, уже после COMMIT.
            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        prize: prize,
                        is_paid: is_paid || false
                    }
                }
            };
        });

        // Логируем только при выданном призе, как и раньше: в ветках с
        // отказом (нет Stars, кулдаун) приз не выбирался.
        if (outcome.body.success) {
            const prize = outcome.body.data.prize;
            logger.info('wheel_spin', { playerId, prize: prize.type, value: prize.value, is_paid });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // ROLLBACK выполняет transaction() — вручную он не нужен и раньше
        // мог сработать уже после успешного COMMIT.
        return handleError(res, error, 'wheel_spin');
    }
});

// ==========================================
// ПОКУПКИ ЗА STARS (из purchase.js)
// ==========================================

// Каталог покупок за Stars — в public/shared/equipment.js, том же файле,
// что читает браузер. Раньше он жил здесь и в SHOP_ITEMS клиента: цены
// совпадали случайно, любая правка одной стороны показывала бы игроку одну
// цену и списывала другую.
const { getStarShopItem } = require('../../public/shared/equipment.js');

function getItemConfig(itemId) {
    return getStarShopItem(itemId);
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

const parseJsonField = safeJsonParse;
/**
 * POST /purchase - покупка товара за Stars
 */
router.post(['/purchase', '/'], async (req, res) => {
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
    
    const price = itemConfig.price;

    // Как и в колесе: transaction() вместо ручного соединения, ответ
    // отправляется один раз после завершения транзакции.
    try {
        const outcome = await transaction(async (client) => {
            // Получаем игрока со всеми необходимыми данными одним запросом
            const playerResult = await client.query(
                'SELECT stars, buffs, cosmetics FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            const player = playerResult.rows[0];
            const playerStars = player?.stars || 0;

            if (playerStars < price) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Недостаточно Stars',
                        code: 'INSUFFICIENT_STARS',
                        stars: playerStars,
                        required: price
                    }
                };
            }

            // Списываем Stars. GREATEST(0, ...) по той же причине, что и в колесе:
            // колонка под CHECK (stars >= 0). Проверка playerStars < price выше
            // защищает при одиночном запросе, GREATEST — страховка от гонки.
            await client.query(
                'UPDATE players SET stars = GREATEST(0, stars - $1) WHERE id = $2',
                [price, playerId]
            );

            // Парсим существующие buffs и cosmetics
            const existingBuffs = parseJsonField(player?.buffs, {});
            const existingCosmetics = parseJsonField(player?.cosmetics, []);

            let reward = null;

            if (itemConfig.category === 'buffs') {
                const expiresAt = new Date(Date.now() + itemConfig.duration * 1000);
                await grantPlayerBuff(client, playerId, itemConfig.effect, expiresAt.toISOString(), existingBuffs);
                reward = {
                    type: 'buff',
                    effect: itemConfig.effect,
                    expires_at: expiresAt.toISOString()
                };
            } else if (itemConfig.category === 'cosmetics') {
                await grantPlayerCosmetic(client, playerId, itemConfig.effect, existingCosmetics);
                reward = {
                    type: 'cosmetic',
                    effect: itemConfig.effect
                };
            }

            return {
                status: 200,
                body: {
                    success: true,
                    message: `Куплено: ${itemConfig.name}`,
                    purchased_item: {
                        id: item_id,
                        name: itemConfig.name,
                        reward: reward
                    },
                    new_stars: playerStars - price,
                    balance: playerStars - price
                }
            };
        });

        if (outcome.body.success) {
            logger.info(`[purchase] Игрок ${playerId} купил ${item_id} за ${price} Stars`);
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        return handleError(res, error, 'purchase');
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
        // P2: limit принудительно ограничиваем снизу. Было
        // Math.min(parseInt(req.query.limit, 10) || 10, 50) — при limit=-5
        // parseInt даёт -5 (не falsy, || не срабатывает), Math.min(-5, 50)
        // даёт -5, и уходит `LIMIT -5` -> ошибка Postgres -> 500.
        const rawLimit = parseInt(req.query.limit, 10);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10, 1), 50);

        // Определяем поле сортировки и дополнительные поля
        let orderBy, whereClause, selectFields;

        switch (sort) {
            case 'strength':
                orderBy = 'strength DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, first_name, level, strength';
                break;
            case 'bosses':
                orderBy = 'bosses_killed DESC';
                whereClause = 'WHERE banned = false AND bosses_killed > 0';
                selectFields = 'telegram_id, username, first_name, level, bosses_killed';
                break;
            case 'pvp':
                orderBy = 'pvp_wins DESC';
                whereClause = 'WHERE banned = false AND (pvp_wins > 0 OR pvp_losses > 0)';
                selectFields = 'telegram_id, username, first_name, level, pvp_wins, pvp_losses';
                break;
            case 'level':
            default:
                orderBy = 'level DESC, experience DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, first_name, level, strength, experience';
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
                // P2: без first_name клиент показывал «Игрок» всем, у кого
                // не заполнен username (а такое в Telegram — норма).
                first_name: player.first_name || null,
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
        // Тот же clamp, что и в /leaderboard/players: LIMIT -5 давал 500.
        const rawLimit = parseInt(req.query.limit, 10);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10, 1), 50);
        
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

// Получить позицию игрока в рейтингах - оптимизированная версия.
// БЕЗОПАСНОСТЬ: позиция считается только для авторизованного игрока из req.player,
// параметр :telegramId игнорируется, чтобы нельзя было смотреть чужие позиции.
router.get('/leaderboard/my-position/:telegramId?', async (req, res) => {
    try {
        const telegramId = req.player?.telegram_id;

        if (!telegramId) {
            return unauthorized(res, 'Требуется авторизация');
        }

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