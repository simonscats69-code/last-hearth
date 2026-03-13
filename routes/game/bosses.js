/**
 * Боссы и война с боссами (механика как в Тюряге)
 * Namespace: player, bosses
 * 
 * Основные механики:
 * - Вход на босса: Босс 1 бесплатно, Босс N - 3 ключа от босса N-1
 * - Атака: каждый клик тратит 1 энергию
 * - Урон = 1 (базовый) + мастерство_босса + уровень_игрока + бонус_оружия + бонус_сетов
 * - Мастерство: при каждом убийстве босса мастерство++
 * - Награды: +1 ключ для следующего босса + монеты + опыт
 * 
 * Критерии продакшна:
 * - Транзакции и атомарность для операций записи
 * - Валидация входных данных
 * - Логирование действий игрока
 * - Единый формат ответов {success, data}
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const { logger } = require('../../utils/logger');

// Константы
const KEYS_REQUIRED_FOR_NEXT_BOSS = 3; // Ключей нужно для следующего босса

// Константы для расчёта бонуса урона
const DAMAGE_PER_KILL = 0.1;       // +0.1 урона за 1 убийство (10 убийств = +1 урон)
const DAMAGE_PER_PREV_KILL = 0.1;   // +0.1 урона за 1 убийство предыдущего босса
const KILL_DECAY_FACTOR = 0.1;      // Каждый следующий босс получает в 10 раз меньше
const ATTACK_COOLDOWN_MS = 500;     // 500ms между атаками

/**
 * Рассчитать бонус урона игрока против конкретного босса
 * 
 * Формула:
 * - kills босса N × 0.1 → бонус к боссу N
 * - kills босса N × 0.01 → бонус к боссу N+1
 * - kills босса N × 0.001 → бонус к боссу N+2
 * - и так далее (каждый следующий босс в 10 раз меньше)
 * 
 * @param {number} playerLevel - Уровень игрока
 * @param {number} bossId - ID босса (1-10)
 * @param {Array} masteries - Массив {boss_id, kills} всех убийств игрока
 * @returns {number} Бонус урона
 */
function calculateDamageBonus(playerLevel, bossId, masteries) {
    // Создаём map для быстрого доступа к kills
    const masteryMap = {};
    for (const m of masteries) {
        masteryMap[m.boss_id] = m.kills;
    }
    
    // Рассчитываем бонус от убийств всех предыдущих боссов
    let killBonus = 0;
    
    // Для каждого босса от 1 до bossId-1
    for (let i = 1; i < bossId; i++) {
        const kills = masteryMap[i] || 0;
        const distance = bossId - i; // Расстояние до целевого босса
        const multiplier = Math.pow(KILL_DECAY_FACTOR, distance); // 0.1^distance
        // Используем DAMAGE_PER_KILL = 0.1 для убийств предыдущих боссов
        killBonus += kills * DAMAGE_PER_KILL * multiplier;
    }
    
    // Бонус за убийства текущего босса
    const currentKills = masteryMap[bossId] || 0;
    killBonus += currentKills * DAMAGE_PER_KILL;
    
    return Math.floor(killBonus);
}

/**
 * Универсальный обработчик ошибок
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие, в котором произошла ошибка
 */
function handleError(res, error, action = 'unknown') {
    logger.error(`[bosses] ${action}`, {
        error: error.message,
        stack: error.stack
    });
    
    return res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        code: 'INTERNAL_ERROR'
    });
}

/**
 * Safe JSON parsing с fallback
 * @param {any} value - значение для парсинга
 * @param {object} fallback - значение по умолчанию
 * @returns {object} распарсенный объект
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) {
        return fallback;
    }
    
    if (typeof value === 'object') {
        return value;
    }
    
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            logger.warn('[bosses] Ошибка парсинга JSON', { value: value.substring(0, 100) });
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * Валидация ID босса
 * @param {any} bossId - ID для валидации
 * @returns {boolean} результат валидации
 */
function validateBossId(bossId) {
    return Number.isInteger(bossId) && bossId > 0;
}

/**
 * Получение бонусов от экипировки игрока
 * @param {object} player - объект игрока
 * @returns {object} бонусы {weaponBonus, setBonus}
 */
function getEquipmentBonuses(player) {
    const equipment = safeJsonParse(player.equipment, {});
    
    let weaponBonus = 0;
    let setBonus = 0;
    
    // Бонус от оружия
    if (equipment.weapon && equipment.weapon.damage) {
        weaponBonus = equipment.weapon.damage;
        
        // Модификации оружия
        if (equipment.weapon.modifications?.sharpening) {
            weaponBonus += equipment.weapon.modifications.sharpening * 2;
        }
    }
    
    // Бонус от сетов
    if (equipment.set_id) {
        // Проверяем set_items - это может быть массив или JSON-строка
        let setItems = [];
        if (equipment.set_items) {
            if (Array.isArray(equipment.set_items)) {
                setItems = equipment.set_items;
            } else if (typeof equipment.set_items === 'string') {
                setItems = safeJsonParse(equipment.set_items, []);
            }
        }
        
        if (setItems.length > 0) {
            const setItemCount = setItems.length;
            
            // Бонус за каждый предмет из сета (по 5% за предмет)
            setBonus = setItemCount * Math.floor(player.level * 0.05);
        }
    }
    
    return { weaponBonus, setBonus };
}

/**
 * Вычисление урона по формуле
 * урон = 1 (базовый) + бонус_убийств + уровень_игрока + бонус_оружия + бонус_сетов
 * 
 * Бонус убийств:
 * - +0.1 за каждое убийство текущего босса (10 убийств = +1 урон)
 * - +0.01 за каждое убийство предыдущего босса (100 убийств = +1 урон)
 * 
 * @param {number} bossId - ID босса
 * @param {number} playerLevel - уровень игрока
 * @param {object} player - объект игрока
 * @param {Array} masteries - массив {boss_id, kills} всех убийств
 * @returns {number} итоговый урон
 */
function calculateDamage(bossId, playerLevel, player, masteries = []) {
    const { weaponBonus, setBonus } = getEquipmentBonuses(player);
    
    // Рассчитываем бонус от убийств
    const killBonus = calculateDamageBonus(playerLevel, bossId, masteries);
    
    // Формула урона: 1 + бонус_убийств + уровень + бонус оружия + бонус сетов
    const damage = 1 + killBonus + playerLevel + weaponBonus + setBonus;
    
    return Math.floor(damage);
}

/**
 * Получить бонусы урона игрока против всех боссов
 * GET /boss-bonuses
 * 
 * Показывает:
 * - Бонус за уровень игрока
 * - Бонус за убийства каждого босса
 * - Итоговый бонус для каждого босса
 */
/**
 * Вход на босса (списание ключей и начало боя)
 * POST /boss/start
 * 
 * Тело запроса:
 * {
 *   boss_id: 1
 * }
 * 
 * Ключи списываются здесь, а не при каждой атаке!
 */
router.post('/start', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { boss_id } = req.body;
        const playerId = req.player.id;
        
        // Валидация
        if (!validateBossId(boss_id)) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID босса',
                code: 'MISSING_BOSS_ID'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            // Получаем босса
            const bossResult = await client.query(`
                SELECT * FROM bosses WHERE id = $1
            `, [boss_id]);
            
            if (bossResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Босс не найден',
                    code: 'BOSS_NOT_FOUND'
                });
            }
            
            const boss = bossResult.rows[0];
            
            // Проверяем доступность босса (нужные ключи)
            if (boss_id > 1) {
                const keyRecord = await client.query(`
                    SELECT quantity FROM boss_keys 
                    WHERE player_id = $1 AND boss_id = $2
                `, [playerId, boss_id - 1]);
                
                const keyCount = keyRecord.rows[0]?.quantity || 0;
                
                if (keyCount < KEYS_REQUIRED_FOR_NEXT_BOSS) {
                    await client.query('ROLLBACK');
                    return res.json({
                        success: false,
                        error: `Нужно ${KEYS_REQUIRED_FOR_NEXT_BOSS} ключей от босса ${boss_id - 1}`,
                        code: 'INSUFFICIENT_KEYS',
                        keys_owned: keyCount,
                        keys_required: KEYS_REQUIRED_FOR_NEXT_BOSS
                    });
                }
                
                // Списываем ключи при входе (только один раз!)
                await client.query(`
                    UPDATE boss_keys SET quantity = quantity - $1
                    WHERE player_id = $2 AND boss_id = $3
                `, [KEYS_REQUIRED_FOR_NEXT_BOSS, playerId, boss_id - 1]);
            }
            
            // Создаём или обновляем прогресс игрока с боссом
            // Если босс уже был начат - используем существующий HP
            const existingProgress = await client.query(`
                SELECT current_hp, max_hp FROM player_boss_progress
                WHERE player_id = $1 AND boss_id = $2
            `, [playerId, boss_id]);
            
            let currentHp, maxHp;
            
            if (existingProgress.rows.length > 0) {
                // Используем сохранённый HP
                currentHp = existingProgress.rows[0].current_hp;
                maxHp = existingProgress.rows[0].max_hp;
            } else {
                // Новый бой - полное HP
                currentHp = boss.max_health;
                maxHp = boss.max_health;
                
                // Создаём запись прогресса
                await client.query(`
                    INSERT INTO player_boss_progress (player_id, boss_id, current_hp, max_hp, last_attack)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (player_id, boss_id) 
                    DO UPDATE SET current_hp = $3, max_hp = $4, last_attack = NOW()
                `, [playerId, boss_id, currentHp, maxHp]);
            }
            
            await client.query('COMMIT');
            
            // Логируем
            logger.info(`[bosses] Вход на босса`, {
                playerId,
                bossId: boss_id,
                bossName: boss.name,
                keysSpent: boss_id > 1 ? KEYS_REQUIRED_FOR_NEXT_BOSS : 0
            });
            
            res.json({
                success: true,
                data: {
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        hp: currentHp,
                        max_hp: maxHp
                    },
                    keys_spent: boss_id > 1 ? KEYS_REQUIRED_FOR_NEXT_BOSS : 0,
                    is_new_fight: existingProgress.rows.length === 0
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'boss_start');
    } finally {
        client.release();
    }
});

/**
 * Получить бонусы урона игрока против всех боссов
 * GET /boss-bonuses
 * 
 * Показывает:
 * - Бонус за уровень игрока
 * - Бонус за убийства каждого босса
 * - Итоговый бонус для каждого босса
 */
router.get('/bonuses', async (req, res) => {
    try {
        const player = req.player;
        
        // Получаем все убийства игрока
        const masteriesResult = await queryAll(`
            SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1
        `, [player.id]);
        
        const masteries = masteriesResult;
        const masteryMap = {};
        for (const m of masteries) {
            masteryMap[m.boss_id] = m.kills;
        }
        
        // Получаем всех боссов
        const bossesResult = await queryAll(`
            SELECT id, name FROM bosses ORDER BY id
        `);
        
        // Рассчитываем бонус для каждого босса
        const bonuses = bossesResult.map(boss => {
            const bonus = calculateDamageBonus(player.level, boss.id, masteries);
            const currentKills = masteryMap[boss.id] || 0;
            const prevKills = boss.id > 1 ? (masteryMap[boss.id - 1] || 0) : 0;
            
            return {
                boss_id: boss.id,
                boss_name: boss.name,
                kills: currentKills,
                prev_boss_kills: prevKills,
                level_bonus: player.level,
                kill_bonus: Math.floor(currentKills * DAMAGE_PER_KILL),
                prev_kill_bonus: Math.floor(prevKills * DAMAGE_PER_PREV_KILL),
                total_bonus: bonus + player.level // Уровень добавляется отдельно в формуле урона
            };
        });
        
        res.json({
            success: true,
            data: {
                player_level: player.level,
                total_kills: masteries.reduce((sum, m) => sum + m.kills, 0),
                bonuses
            }
        });
        
    } catch (error) {
        handleError(res, error, 'get_boss_bonuses');
    }
});

/**
 * Получение списка боссов с их статусами и мастерством игрока
 * GET /bosses (доступен как /api/game/bosses)
 */
router.get('/', async (req, res) => {
    try {
        const player = req.player;
        
        // Пагинация: параметры limit и offset
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        // ОПТИМИЗАЦИЯ: получаем ключи, мастерство и прогресс в одном запросе
        const playerDataResult = await queryAll(`
            SELECT 
                bk.boss_id as key_boss_id, bk.quantity as key_quantity,
                bm.boss_id as mastery_boss_id, bm.kills as mastery_kills,
                pbp.boss_id as progress_boss_id, pbp.current_hp, pbp.max_hp as progress_max_hp
            FROM bosses b
            LEFT JOIN boss_keys bk ON bk.boss_id = b.id AND bk.player_id = $1
            LEFT JOIN boss_mastery bm ON bm.boss_id = b.id AND bm.player_id = $1
            LEFT JOIN player_boss_progress pbp ON pbp.boss_id = b.id AND pbp.player_id = $1
            WHERE b.id > 0
            ORDER BY b.id
        `, [player.id]);
        
        // Создаём карты для быстрого доступа
        const keyMap = {};
        const masteryMap = {};
        const progressMap = {};
        
        playerDataResult.forEach(row => {
            if (row.key_boss_id) {
                keyMap[row.key_boss_id] = row.key_quantity;
            }
            if (row.mastery_boss_id) {
                masteryMap[row.mastery_boss_id] = row.mastery_kills;
            }
            if (row.progress_boss_id) {
                progressMap[row.progress_boss_id] = {
                    current_hp: row.current_hp,
                    max_hp: row.progress_max_hp
                };
            }
        });
        
        // Получаем общее количество боссов
        const countResult = await query(`
            SELECT COUNT(*) as total FROM bosses
        `);
        const totalBosses = parseInt(countResult.rows[0].total);
        
        // Получаем боссов с пагинацией
        const bosses = await queryAll(`
            SELECT * FROM bosses ORDER BY id ASC LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Определяем доступность боссов и формируем ответ
        const bossList = bosses.map(boss => {
            // Первый босс доступен всегда, остальные - по ключам
            const isUnlocked = boss.id === 1 || (keyMap[boss.id - 1] || 0) >= KEYS_REQUIRED_FOR_NEXT_BOSS;
            
            // Текущее HP босса - из прогресса игрока или полное
            const progress = progressMap[boss.id];
            const currentHp = progress ? progress.current_hp : boss.max_health;
            
            // Мастерство игрока против этого босса
            const mastery = masteryMap[boss.id] || 0;
            
            // Доступен ли босс для атаки (достаточно ли энергии)
            const canAttack = player.energy >= 1 && isUnlocked;
            
            // Босс в бою?
            const inProgress = !!progress;
            
            return {
                id: boss.id,
                name: boss.name,
                description: boss.description,
                hp: currentHp,
                max_hp: boss.max_health,
                damage: boss.damage,
                rewards: {
                    coins: boss.reward_coins,
                    exp: boss.reward_experience,
                    key_boss_id: boss.id + 1 // ID босса, для которого выдаётся ключ
                },
                is_unlocked: isUnlocked,
                in_progress: inProgress,
                keys_required: boss.id > 1 ? KEYS_REQUIRED_FOR_NEXT_BOSS : 0,
                player_keys: keyMap[boss.id] || 0,
                mastery: mastery,
                can_attack: canAttack
            };
        });
        
        // Логируем действие
        logger.info(`[bosses] Получен список боссов`, {
            playerId: player.id,
            bossCount: bossList.length
        });
        
        // Единый формат ответа
        res.json({
            success: true,
            data: {
                bosses: bossList,
                player_keys: keyMap,
                player_energy: player.energy,
                player_max_energy: player.max_energy,
                player_level: player.level,
                pagination: {
                    total: totalBosses,
                    limit: limit,
                    offset: offset,
                    has_more: offset + bosses.length < totalBosses
                }
            }
        });
        
    } catch (error) {
        handleError(res, error, 'bosses_list');
    }
});

/**
 * Атака босса (один клик)
 * POST /attack-boss
 * 
 * Тело запроса:
 * {
 *   boss_id: 1
 * }
 * 
 * ВАЖНО: Ключи НЕ списываются здесь! Они списываются в /boss/start
 * HP босса сохраняется между атаками в player_boss_progress
 */
router.post('/attack-boss', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { boss_id } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        if (boss_id === undefined || boss_id === null) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID босса',
                code: 'MISSING_BOSS_ID'
            });
        }
        
        if (!validateBossId(boss_id)) {
            return res.status(400).json({
                success: false,
                error: 'ID босса должен быть положительным целым числом',
                code: 'INVALID_BOSS_ID'
            });
        }
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // ОПТИМИЗАЦИЯ: объединяем запросы босса и прогресса в один
            const bossProgressResult = await client.query(`
                SELECT 
                    b.id, b.name, b.max_health, b.reward_coins, b.reward_experience,
                    pbp.current_hp, pbp.max_hp as progress_max_hp, pbp.last_attack
                FROM bosses b
                LEFT JOIN player_boss_progress pbp ON pbp.boss_id = b.id AND pbp.player_id = $1
                WHERE b.id = $2
            `, [playerId, boss_id]);
            
            if (bossProgressResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Босс не найден',
                    code: 'BOSS_NOT_FOUND'
                });
            }
            
            const bossData = bossProgressResult.rows[0];
            
            // Проверяем, что игрок начал бой (через /boss/start)
            if (!bossData.current_hp) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Сначала начните бой через /boss/start',
                    code: 'BOSS_NOT_STARTED',
                    hint: 'Вызовите POST /boss/start перед атакой'
                });
            }
            
            const boss = {
                id: bossData.id,
                name: bossData.name,
                max_health: bossData.max_health,
                reward_coins: bossData.reward_coins,
                reward_experience: bossData.reward_experience
            };
            
            const currentHp = bossData.current_hp;
            
            // Проверка cooldown (500ms между атаками)
            if (bossData.last_attack) {
                const lastAttackTime = new Date(bossData.last_attack).getTime();
                const timeSinceLastAttack = Date.now() - lastAttackTime;
                
                if (timeSinceLastAttack < ATTACK_COOLDOWN_MS) {
                    await client.query('ROLLBACK');
                    const remainingMs = ATTACK_COOLDOWN_MS - timeSinceLastAttack;
                    return res.status(429).json({
                        success: false,
                        error: 'Слишком быстро! Подождите немного.',
                        code: 'ATTACK_TOO_FAST',
                        cooldown_remaining_ms: remainingMs,
                        hint: `Подождите ${Math.ceil(remainingMs / 1000)} секунд между атаками`
                    });
                }
            }
            
            // ОПТИМИЗАЦИЯ: получаем игрока и мастерство в одном запросе
            const playerMasteryResult = await client.query(`
                SELECT 
                    p.id, p.level, p.energy, p.equipment,
                    bm.boss_id, bm.kills
                FROM players p
                LEFT JOIN boss_mastery bm ON bm.player_id = p.id AND bm.boss_id = $1
                WHERE p.id = $2
            `, [boss_id, playerId]);
            
            if (playerMasteryResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Игрок не найден',
                    code: 'PLAYER_NOT_FOUND'
                });
            }
            
            const playerData = playerMasteryResult.rows[0];
            const player = {
                id: playerData.id,
                level: playerData.level,
                energy: playerData.energy,
                equipment: playerData.equipment
            };
            const currentMastery = playerData.kills || 0;
            
            // Проверяем энергию
            if (player.energy < 1) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    energy: player.energy,
                    energy_required: 1
                });
            }
            
            // Получаем ВСЕ убийства игрока для расчёта бонуса (нужно для формулы)
            const allMasteriesResult = await client.query(`
                SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1
            `, [playerId]);
            const allMasteries = allMasteriesResult.rows;
            
            // Вычисляем урон по формуле
            const damage = calculateDamage(boss_id, player.level, player, allMasteries);
            
            // Списываем энергию (1 энергия за клик)
            await client.query(`
                UPDATE players SET energy = energy - 1, last_energy_update = NOW()
                WHERE id = $1
            `, [playerId]);
            
            // Вычисляем новое HP босса (используем сохранённый прогресс)
            const newHp = Math.max(0, currentHp - damage);
            
            // Обновляем прогресс игрока с боссом
            await client.query(`
                UPDATE player_boss_progress 
                SET current_hp = $1, last_attack = NOW()
                WHERE player_id = $2 AND boss_id = $3
            `, [newHp, playerId, boss_id]);
            
            // Проверяем, убит ли босс
            let killed = false;
            let rewards = null;
            let newMastery = currentMastery;
            
            if (newHp <= 0) {
                killed = true;
                
                // Выдаём награды
                rewards = {
                    coins: boss.reward_coins || 0,
                    exp: boss.reward_experience || 0,
                    key_boss_id: boss.id + 1
                };
                
                // Выдаём монеты
                if (boss.reward_coins) {
                    await client.query(`
                        UPDATE players SET coins = coins + $1 WHERE id = $2
                    `, [boss.reward_coins, playerId]);
                }
                
                // Выдаём опыт
                if (boss.reward_experience) {
                    await playerHelper.addExperience(playerId, boss.reward_experience, client);
                }
                
                // Увеличиваем мастерство
                newMastery = currentMastery + 1;
                await client.query(`
                    INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                    VALUES ($1, $2, 1, NOW())
                    ON CONFLICT (player_id, boss_id) 
                    DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()
                `, [playerId, boss_id]);
                
                // Выдаём ключ для следующего босса
                const nextBossId = boss.id + 1;
                await client.query(`
                    INSERT INTO boss_keys (player_id, boss_id, quantity)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (player_id, boss_id) 
                    DO UPDATE SET quantity = boss_keys.quantity + 1
                `, [playerId, nextBossId]);
                
                // Обновляем счётчик убитых боссов
                await client.query(`
                    UPDATE players SET bosses_killed = bosses_killed + 1 WHERE id = $1
                `, [playerId]);
                
                // Очищаем прогресс после убийства
                await client.query(`
                    DELETE FROM player_boss_progress WHERE player_id = $1 AND boss_id = $2
                `, [playerId, boss_id]);
            }
            
            await client.query('COMMIT');
            
            // Логируем действие
            logger.info(`[bosses] Атака босса`, {
                playerId,
                bossId: boss_id,
                bossName: boss.name,
                damage,
                mastery: currentMastery,
                newMastery,
                killed,
                energyLeft: player.energy - 1
            });
            
            // Единый формат ответа
            res.json({
                success: true,
                data: {
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        hp: newHp,
                        max_hp: boss.max_health
                    },
                    damage,
                    mastery_before: currentMastery,
                    mastery_after: newMastery,
                    killed,
                    rewards,
                    energy_spent: 1,
                    energy_left: player.energy - 1
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'attack_boss');
    } finally {
        client.release();
    }
});

// =============================================================================
// НОВЫЕ ЭНДПОИНТЫ ДЛЯ РЕЙДОВ (СИСТЕМА МУЛЬТИПЛЕЕРНЫХ БОССОВ)
// =============================================================================

/**
 * Константы для рейдов
 */
const RAID_DURATION_HOURS = 8; // Длительность рейда в часах
const KEYS_REQUIRED_FOR_RAID = 3; // Ключей нужно для начала атаки

/**
 * Получить активные рейды (публичные + клановые для участников клана)
 * GET /raids
 */
router.get('/raids', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const playerClanId = req.player?.clan_id;
        
        // Основной запрос: публичные рейды
        let query = `
            SELECT 
                rp.*,
                b.name as boss_name,
                b.reward_coins,
                b.reward_experience,
                b.icon,
                b.description as boss_description,
                (SELECT COUNT(*) FROM boss_sessions WHERE raid_id = rp.id) as participants_count
            FROM raid_progress rp
            JOIN bosses b ON rp.boss_id = b.id
            WHERE rp.is_active = true 
                AND rp.expires_at > NOW()
        `;
        
        // Если игрок в клане - добавляем клановые рейды
        if (playerClanId) {
            query += ` AND (rp.is_clan_raid = false OR rp.clan_id = $1)`;
        } else {
            query += ` AND rp.is_clan_raid = false`;
        }
        
        query += ` ORDER BY rp.started_at DESC LIMIT 50`;
        
        const raids = await queryAll(query, playerClanId ? [playerClanId] : []);
        
        // Получаем ID боссов, которые уже участвуют у игрока
        let participatingBossIds = [];
        if (playerId) {
            const sessions = await queryAll(`
                SELECT DISTINCT boss_id FROM boss_sessions 
                WHERE player_id = $1 AND raid_id IS NOT NULL
            `, [playerId]);
            participatingBossIds = sessions.map(s => s.boss_id);
        }
        
        res.json({
            success: true,
            data: {
                raids: raids.map(raid => ({
                    id: raid.id,
                    boss: {
                        id: raid.boss_id,
                        name: raid.boss_name,
                        icon: raid.icon,
                        description: raid.boss_description
                    },
                    hp: raid.current_health,
                    max_hp: raid.max_health,
                    hp_percent: Math.round((raid.current_health / raid.max_health) * 100),
                    leader: {
                        id: raid.leader_id,
                        name: raid.leader_name
                    },
                    participants_count: parseInt(raid.participants_count || 0),
                    started_at: raid.started_at,
                    expires_at: raid.expires_at,
                    is_raid: raid.is_raid,
                    is_clan_raid: raid.is_clan_raid,
                    clan_id: raid.clan_id,
                    time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
                })),
                participating_boss_ids: participatingBossIds,
                player_clan_id: playerClanId
            }
        });
        
    } catch (error) {
        handleError(res, error, 'get_raids');
    }
});

/**
 * Начать атаку на босса (одиночную или рейд)
 * POST /raid/start
 * 
 * Тело запроса:
 * {
 *   boss_id: 1,
 *   is_raid: true  // true = мультиплеерный рейд, false = одиночный
 * }
 */
router.post('/raid/start', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { boss_id, is_raid = false } = req.body;
        const playerId = req.player.id;
        const playerName = req.player.first_name || 'Игрок';
        
        // Валидация
        if (!validateBossId(boss_id)) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный ID босса',
                code: 'INVALID_BOSS_ID'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            // Получаем босса
            const bossResult = await client.query(`
                SELECT * FROM bosses WHERE id = $1
            `, [boss_id]);
            
            if (bossResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Босс не найден',
                    code: 'BOSS_NOT_FOUND'
                });
            }
            
            const boss = bossResult.rows[0];
            
            // Проверяем ключи (нужно 3 ключа от предыдущего босса)
            if (boss_id > 1) {
                const keyResult = await client.query(`
                    SELECT quantity FROM boss_keys 
                    WHERE player_id = $1 AND boss_id = $2
                `, [playerId, boss_id - 1]);
                
                const keyCount = keyResult.rows[0]?.quantity || 0;
                
                if (keyCount < KEYS_REQUIRED_FOR_RAID) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Нужно ${KEYS_REQUIRED_FOR_RAID} ключей от босса ${boss_id - 1}`,
                        code: 'INSUFFICIENT_KEYS',
                        keys_owned: keyCount,
                        keys_required: KEYS_REQUIRED_FOR_RAID
                    });
                }
                
                // Списываем ключи
                await client.query(`
                    UPDATE boss_keys SET quantity = quantity - $1
                    WHERE player_id = $2 AND boss_id = $3
                `, [KEYS_REQUIRED_FOR_RAID, playerId, boss_id - 1]);
            }
            
            // Создаём рейд или одиночную атаку
            const expiresAt = new Date(Date.now() + RAID_DURATION_HOURS * 60 * 60 * 1000);
            
            const existingRaid = await client.query(`
                SELECT id FROM raid_progress WHERE boss_id = $1 AND is_active = true
            `, [boss_id]);

            if (existingRaid.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'На этого босса уже идёт активный рейд',
                    code: 'RAID_ALREADY_ACTIVE',
                    raid_id: existingRaid.rows[0].id
                });
            }

            const raidResult = await client.query(`
                INSERT INTO raid_progress 
                (boss_id, current_health, max_health, started_at, expires_at, is_active, is_raid, leader_id, leader_name, is_clan_raid)
                VALUES ($1, $2, $3, NOW(), $4, true, $5, $6, $7, false)
                RETURNING id
            `, [boss_id, boss.max_health, boss.max_health, expiresAt, is_raid, playerId, playerName]);
            
            const raidId = raidResult.rows[0].id;
            
            // Создаём сессию игрока
            await client.query(`
                INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                VALUES ($1, $2, $3, 0, NOW(), NOW())
                ON CONFLICT (boss_id, player_id) 
                DO UPDATE SET raid_id = $3, damage_dealt = 0, last_hit_at = NOW()
            `, [boss_id, playerId, raidId]);
            
            await client.query('COMMIT');
            
            // Логируем
            logger.info(`[raid] Начат рейд/атака`, {
                playerId,
                bossId: boss_id,
                isRaid: is_raid,
                raidId
            });
            
            res.json({
                success: true,
                data: {
                    raid_id: raidId,
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        hp: boss.max_health,
                        max_hp: boss.max_health
                    },
                    is_raid: is_raid,
                    keys_spent: boss_id > 1 ? KEYS_REQUIRED_FOR_RAID : 0,
                    expires_at: expiresAt,
                    time_remaining_ms: RAID_DURATION_HOURS * 60 * 60 * 1000
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'raid_start');
    } finally {
        client.release();
    }
});

/**
 * Присоединиться к существующему рейду
 * POST /raid/:id/join
 */
router.post('/raid/:id/join', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const raidId = parseInt(req.params.id);
        const playerId = req.player.id;
        
        if (!raidId || raidId <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный ID рейда',
                code: 'INVALID_RAID_ID'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            // Получаем рейд
            const raidResult = await client.query(`
                SELECT rp.*, b.name as boss_name, b.max_health
                FROM raid_progress rp
                JOIN bosses b ON rp.boss_id = b.id
                WHERE rp.id = $1 AND rp.is_active = true AND rp.expires_at > NOW()
            `, [raidId]);
            
            if (raidResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Рейд не найден или уже завершён',
                    code: 'RAID_NOT_FOUND'
                });
            }
            
            const raid = raidResult.rows[0];
            
            // Проверка для клановых рейдов - только члены клана могут присоединиться
            if (raid.is_clan_raid) {
                // Получаем ID клана игрока
                const playerClanResult = await client.query(`
                    SELECT clan_id FROM players WHERE id = $1
                `, [playerId]);
                
                const playerClanId = playerClanResult.rows[0]?.clan_id;
                
                if (!playerClanId || playerClanId !== raid.clan_id) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({
                        success: false,
                        error: 'Только члены клана могут присоединиться к клановому рейду',
                        code: 'CLAN_MEMBERSHIP_REQUIRED'
                    });
                }
            }
            
            // Проверяем, что игрок ещё не участвует
            const existingSession = await client.query(`
                SELECT id FROM boss_sessions 
                WHERE player_id = $1 AND raid_id = $2
            `, [playerId, raidId]);
            
            if (existingSession.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Вы уже участвуете в этом рейде',
                    code: 'ALREADY_PARTICIPATING'
                });
            }
            
            // Проверяем ключи для присоединения
            if (raid.boss_id > 1) {
                const keyResult = await client.query(`
                    SELECT quantity FROM boss_keys 
                    WHERE player_id = $1 AND boss_id = $2
                `, [playerId, raid.boss_id - 1]);
                
                const keyCount = keyResult.rows[0]?.quantity || 0;
                
                if (keyCount < KEYS_REQUIRED_FOR_RAID) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Нужно ${KEYS_REQUIRED_FOR_RAID} ключей от босса ${raid.boss_id - 1}`,
                        code: 'INSUFFICIENT_KEYS',
                        keys_owned: keyCount,
                        keys_required: KEYS_REQUIRED_FOR_RAID
                    });
                }
                
                // Списываем ключи
                await client.query(`
                    UPDATE boss_keys SET quantity = quantity - $1
                    WHERE player_id = $2 AND boss_id = $3
                `, [KEYS_REQUIRED_FOR_RAID, playerId, raid.boss_id - 1]);
            }
            
            // Создаём сессию игрока
            await client.query(`
                INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                VALUES ($1, $2, $3, 0, NOW(), NOW())
            `, [raid.boss_id, playerId, raidId]);
            
            await client.query('COMMIT');
            
            // Логируем
            logger.info(`[raid] Игрок присоединился к рейду`, {
                playerId,
                raidId,
                bossId: raid.boss_id
            });
            
            res.json({
                success: true,
                data: {
                    raid_id: raidId,
                    boss: {
                        id: raid.boss_id,
                        name: raid.boss_name,
                        hp: raid.current_health,
                        max_hp: raid.max_health
                    },
                    keys_spent: raid.boss_id > 1 ? KEYS_REQUIRED_FOR_RAID : 0,
                    expires_at: raid.expires_at
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'raid_join');
    } finally {
        client.release();
    }
});

/**
 * Атаковать босса в рейде
 * POST /raid/:id/attack
 */
router.post('/raid/:id/attack', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const raidId = parseInt(req.params.id);
        const playerId = req.player.id;
        
        if (!raidId || raidId <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный ID рейда',
                code: 'INVALID_RAID_ID'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            // Получаем рейд с блокировкой
            const raidResult = await client.query(`
                SELECT rp.*, b.name as boss_name, b.reward_coins, b.reward_experience
                FROM raid_progress rp
                JOIN bosses b ON rp.boss_id = b.id
                WHERE rp.id = $1 AND rp.is_active = true AND rp.expires_at > NOW()
                FOR UPDATE
            `, [raidId]);
            
            if (raidResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Рейд не найден или уже завершён',
                    code: 'RAID_NOT_FOUND'
                });
            }
            
            const raid = raidResult.rows[0];
            const boss = {
                id: raid.boss_id,
                name: raid.boss_name,
                reward_coins: raid.reward_coins,
                reward_experience: raid.reward_experience
            };
            
            // Проверяем участие игрока
            const sessionResult = await client.query(`
                SELECT * FROM boss_sessions 
                WHERE player_id = $1 AND raid_id = $2
                FOR UPDATE
            `, [playerId, raidId]);
            
            if (sessionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Вы не участвуете в этом рейде. Сначала присоединитесь.',
                    code: 'NOT_PARTICIPATING'
                });
            }
            
            const session = sessionResult.rows[0];
            
            // Получаем игрока для расчёта урона
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1
            `, [playerId]);
            
            const player = playerResult.rows[0];
            
            // Рассчитываем урон
            const { weaponBonus, setBonus } = getEquipmentBonuses(player);
            
            // Получаем мастерство
            const masteryResult = await client.query(`
                SELECT kills FROM boss_mastery WHERE player_id = $1 AND boss_id = $2
            `, [playerId, raid.boss_id]);
            const mastery = masteryResult.rows[0]?.kills || 0;
            
            // Получаем ВСЕ убийства игрока для расчёта бонуса
            const allMasteriesResult = await client.query(`
                SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1
            `, [playerId]);
            const allMasteries = allMasteriesResult.rows;
            
            // Используем новую функцию расчёта урона
            const damage = calculateDamage(raid.boss_id, player.level, player, allMasteries);
            
            // Новый HP босса
            const newHp = Math.max(0, raid.current_health - damage);
            
            // Обновляем HP рейда
            await client.query(`
                UPDATE raid_progress SET current_health = $1
                WHERE id = $2
            `, [newHp, raidId]);
            
            // Обновляем урон игрока
            const newTotalDamage = session.damage_dealt + damage;
            await client.query(`
                UPDATE boss_sessions SET damage_dealt = $1, last_hit_at = NOW()
                WHERE player_id = $2 AND raid_id = $3
            `, [newTotalDamage, playerId, raidId]);
            
            // Проверяем, убит ли босс
            let killed = false;
            let rewards = null;
            
            if (newHp <= 0) {
                killed = true;
                
                // Обновляем рейд как завершённый
                await client.query(`
                    UPDATE raid_progress SET is_active = false, ended_at = NOW(), current_health = 0
                    WHERE id = $1
                `, [raidId]);
                
                // Получаем всех участников для выдачи наград
                const participants = await client.query(`
                    SELECT bs.*, p.telegram_id, p.first_name, p.username
                    FROM boss_sessions bs
                    JOIN players p ON bs.player_id = p.id
                    WHERE bs.raid_id = $1 AND bs.damage_dealt > 0
                `, [raidId]);
                
                const totalDamage = participants.rows.reduce((sum, p) => sum + p.damage_dealt, 0);
                const leaderId = raid.leader_id;
                
                // Выдаём награды пропорционально урону
                let playerRewards = null; // Награды для текущего игрока
                for (const participant of participants.rows) {
                    const damagePercent = participant.damage_dealt / totalDamage;
                    const coinsReward = Math.floor(boss.reward_coins * damagePercent);
                    const expReward = Math.floor(boss.reward_experience * damagePercent);
                    
                    // Выдаём монеты
                    if (coinsReward > 0) {
                        await client.query(`
                            UPDATE players SET coins = coins + $1 WHERE id = $2
                        `, [coinsReward, participant.player_id]);
                    }
                    
                    // Выдаём опыт
                    if (expReward > 0) {
                        await playerHelper.addExperience(participant.player_id, expReward, client);
                    }
                    
                    // Выдаём ключ:
                    // - Публичные рейды: только лидеру
                    // - Клановые рейды: ВСЕМ участникам (мотивация вступать в клан)
                    const nextBossId = boss.id + 1;
                    
                    // Сохраняем награды только для текущего игрока (того, кто сделал запрос)
                    const isCurrentPlayer = participant.player_id === playerId;
                    
                    if (raid.is_clan_raid) {
                        // Клановый рейд - все получают ключ
                        await client.query(`
                            INSERT INTO boss_keys (player_id, boss_id, quantity)
                            VALUES ($1, $2, 1)
                            ON CONFLICT (player_id, boss_id) 
                            DO UPDATE SET quantity = boss_keys.quantity + 1
                        `, [participant.player_id, nextBossId]);
                        
                        // Записываем кому выдали ключ (для логов/аналитики)
                        if (isCurrentPlayer) {
                            playerRewards = {
                                coins: coinsReward,
                                exp: expReward,
                                key: { boss_id: nextBossId, quantity: 1 }
                            };
                        }
                    } else if (participant.player_id === leaderId) {
                        // Публичный рейд - только лидер получает ключ
                        await client.query(`
                            INSERT INTO boss_keys (player_id, boss_id, quantity)
                            VALUES ($1, $2, 1)
                            ON CONFLICT (player_id, boss_id) 
                            DO UPDATE SET quantity = boss_keys.quantity + 1
                        `, [leaderId, nextBossId]);
                        
                        if (isCurrentPlayer) {
                            playerRewards = {
                                coins: coinsReward,
                                exp: expReward,
                                key: { boss_id: nextBossId, quantity: 1 }
                            };
                        }
                    } else {
                        // Публичный рейд, не лидер - только монеты и опыт
                        if (isCurrentPlayer) {
                            playerRewards = {
                                coins: coinsReward,
                                exp: expReward
                            };
                        }
                    }
                    
                    // Всем участникам засчитываем убийство
                    await client.query(`
                        INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                        VALUES ($1, $2, 1, NOW())
                        ON CONFLICT (player_id, boss_id) 
                        DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()
                    `, [participant.player_id, boss.id]);
                    
                    // Обновляем счётчик убитых боссов
                    await client.query(`
                        UPDATE players SET bosses_killed = bosses_killed + 1 WHERE id = $1
                    `, [participant.player_id]);
                    
                    // Помечаем, что награда получена
                    await client.query(`
                        UPDATE boss_sessions SET rewards_earned = true 
                        WHERE player_id = $1 AND raid_id = $2
                    `, [participant.player_id, raidId]);
                }
            }
            
            await client.query('COMMIT');
            
            // Логируем
            logger.info(`[raid] Атака в рейде`, {
                playerId,
                raidId,
                bossId: boss.id,
                damage,
                newHp,
                killed
            });
            
            res.json({
                success: true,
                data: {
                    raid: {
                        id: raidId,
                        hp: newHp,
                        max_hp: raid.max_health,
                        hp_percent: Math.round((newHp / raid.max_health) * 100)
                    },
                    damage,
                    your_total_damage: newTotalDamage,
                    killed,
                    rewards: killed ? playerRewards : null
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'raid_attack');
    } finally {
        client.release();
    }
});

// =============================================================================
// КЛАНОВЫЕ РЕЙДЫ (ИНТЕГРАЦИЯ С КЛАНАМИ)
// =============================================================================

/**
 * Получить клановые рейды для текущего игрока
 * GET /clan-raids
 */
router.get('/clan-raids', async (req, res) => {
    try {
        const player = req.player;
        
        if (!player.clan_id) {
            return res.json({
                success: true,
                data: { raids: [] }
            });
        }
        
        // Получаем активные клановые рейды
        const raids = await queryAll(`
            SELECT 
                rp.*,
                b.name as boss_name,
                b.reward_coins,
                b.reward_experience,
                b.icon,
                b.description as boss_description,
                (SELECT COUNT(*) FROM boss_sessions WHERE raid_id = rp.id) as participants_count
            FROM raid_progress rp
            JOIN bosses b ON rp.boss_id = b.id
            WHERE rp.is_active = true 
                AND rp.expires_at > NOW()
                AND rp.is_clan_raid = true
                AND rp.clan_id = $1
            ORDER BY rp.started_at DESC
            LIMIT 50
        `, [player.clan_id]);
        
        res.json({
            success: true,
            data: {
                clan_id: player.clan_id,
                raids: raids.map(raid => ({
                    id: raid.id,
                    boss: {
                        id: raid.boss_id,
                        name: raid.boss_name,
                        icon: raid.icon,
                        description: raid.boss_description
                    },
                    hp: raid.current_health,
                    max_hp: raid.max_health,
                    hp_percent: Math.round((raid.current_health / raid.max_health) * 100),
                    leader: {
                        id: raid.leader_id,
                        name: raid.leader_name
                    },
                    participants_count: parseInt(raid.participants_count || 0),
                    started_at: raid.started_at,
                    expires_at: raid.expires_at,
                    time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
                }))
            }
        });
        
    } catch (error) {
        handleError(res, error, 'get_clan_raids');
    }
});

/**
 * Начать клановый рейд
 * POST /clan-raids/start
 * 
 * Тело запроса:
 * {
 *   boss_id: 1
 * }
 */
router.post('/clan-raids/start', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { boss_id } = req.body;
        const playerId = req.player.id;
        const playerName = req.player.first_name || 'Игрок';
        const clanId = req.player.clan_id;
        
        // Проверяем членство в клане
        if (!clanId) {
            return res.status(403).json({
                success: false,
                error: 'Вы не состоите в клане',
                code: 'NOT_IN_CLAN'
            });
        }
        
        // Проверяем роль лидера
        if (req.player.clan_role !== 'leader') {
            return res.status(403).json({
                success: false,
                error: 'Только лидер клана может начать рейд',
                code: 'NOT_LEADER'
            });
        }
        
        // Начинаем транзакцию ДО проверки и списания ключей
        await client.query('BEGIN');
        
        try {
            // Проверяем ключи
            if (boss_id > 1) {
                const keyResult = await client.query(`
                    SELECT quantity FROM boss_keys 
                    WHERE player_id = $1 AND boss_id = $2
                `, [playerId, boss_id - 1]);
                
                const keyCount = keyResult.rows[0]?.quantity || 0;
                
                if (keyCount < KEYS_REQUIRED_FOR_RAID) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Нужно ${KEYS_REQUIRED_FOR_RAID} ключей от босса ${boss_id - 1}`,
                        code: 'INSUFFICIENT_KEYS',
                        keys_owned: keyCount,
                        keys_required: KEYS_REQUIRED_FOR_RAID
                    });
                }
                
                // Списываем ключи внутри транзакции
                await client.query(`
                    UPDATE boss_keys SET quantity = quantity - $1
                    WHERE player_id = $2 AND boss_id = $3
                `, [KEYS_REQUIRED_FOR_RAID, playerId, boss_id - 1]);
            }
            
            // Получаем босса
            const bossResult = await client.query(`
                SELECT * FROM bosses WHERE id = $1
            `, [boss_id]);
            
            if (bossResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Босс не найден',
                    code: 'BOSS_NOT_FOUND'
                });
            }
            
            const boss = bossResult.rows[0];
            
            // Проверяем, есть ли уже активный клановый рейд
            const existingRaid = await client.query(`
                SELECT id FROM raid_progress 
                WHERE clan_id = $1 AND is_clan_raid = true AND is_active = true
            `, [clanId]);
            
            if (existingRaid.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'У клана уже есть активный рейд',
                    code: 'RAID_ALREADY_ACTIVE'
                });
            }
            
            // Создаём клановый рейд (4 часа)
            const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
            
            const raidResult = await client.query(`
                INSERT INTO raid_progress 
                (boss_id, current_health, max_health, started_at, expires_at, is_active, is_raid, leader_id, leader_name, is_clan_raid, clan_id)
                VALUES ($1, $2, $3, NOW(), $4, true, true, $5, $6, true, $7)
                RETURNING id
            `, [boss_id, boss.max_health, boss.max_health, expiresAt, playerId, playerName, clanId]);
            
            const raidId = raidResult.rows[0].id;
            
            // Создаём сессию лидера
            await client.query(`
                INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                VALUES ($1, $2, $3, 0, NOW(), NOW())
            `, [boss_id, playerId, raidId]);
            
            await client.query('COMMIT');
            
            logger.info(`[clan_raid] Начат клановый рейд`, {
                playerId,
                clanId,
                bossId: boss_id,
                raidId
            });
            
            res.json({
                success: true,
                data: {
                    raid_id: raidId,
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        hp: boss.max_health,
                        max_hp: boss.max_health
                    },
                    keys_spent: boss_id > 1 ? KEYS_REQUIRED_FOR_RAID : 0,
                    expires_at: expiresAt,
                    time_remaining_ms: 4 * 60 * 60 * 1000
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'clan_raid_start');
    } finally {
        client.release();
    }
});

module.exports = router;
