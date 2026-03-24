/**
 * Модуль подключения к PostgreSQL
 * Включает функции для транзакций, валидации и логирования
 */

const { Pool } = require('pg');

// Локальная переменная для логгера - инициализируется позже.
// До инициализации используем безопасный fallback, чтобы модуль не падал
// при ранних ошибках и прямом запуске.
let logger = {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
};

// Функция для установки логгера после инициализации
function setLogger(log) {
    logger = log || logger;
}

// Инициализация БД - вызывать при старте приложения
async function initDatabase() {
    const schema = require('./schema');
    try {
        await schema.createTables();
        await schema.runMigrations();
        // Заполнение базовых данных после миграций
        await schema.seedDatabase();
        await schema.seedAchievements();
        if (logger) logger.info('✓ База данных инициализирована');
        else console.log('✓ База данных инициализирована');
    } catch (error) {
        if (logger) logger.error('Ошибка инициализации БД:', { error: error.message });
        else console.error('Ошибка инициализации БД:', error.message);
        throw error;
    }
}

const poolConfig = {};
if (process.env.DATABASE_URL) {
    poolConfig.connectionString = process.env.DATABASE_URL;
    poolConfig.ssl = { rejectUnauthorized: false };
} else {
    poolConfig.host = process.env.DB_HOST || 'localhost';
    poolConfig.port = process.env.DB_PORT || 5432;
    poolConfig.database = process.env.DB_NAME || 'postgres';
    poolConfig.user = process.env.DB_USER || 'postgres';
    poolConfig.password = process.env.DB_PASSWORD || 'postgres';
    poolConfig.ssl = process.env.DB_HOST?.includes('supabase') ? { rejectUnauthorized: false } : false;
}
const pool = new Pool({
    ...poolConfig,
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000, // 30 секунд на выполнение запроса
});
pool.on('error', (err) => {
    logger.error('Ошибка пула PostgreSQL:', { error: err.message, stack: err.stack });
});

/**
 * Централизованный обработчик ошибок БД
 * @param {Error} error - Объект ошибки
 * @param {string} context - Контекст ошибки
 * @param {object} params - Параметры запроса
 */
function handleDbError(error, context, params = null) {
    logger.error(`[DB:${context}] Ошибка SQL: ${error.message}`, {
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        params,
        stack: error.stack
    });
    throw error;
}

/**
 * Выполнение запроса к базе данных
 * @param {string} text - SQL запрос
 * @param {array} params - Параметры запроса
 * @returns {Promise<object>} Результат запроса
 */
async function query(text, params = []) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 2000) {
            logger.warn('Медленный SQL запрос', { 
                query: text.substring(0, 100), 
                duration, 
                rows: res.rowCount 
            });
        }
        return res;
    } catch (error) {
        handleDbError(error, 'QUERY', params);
    }
}

/**
 * Получение одного результата
 * @param {string} text - SQL запрос
 * @param {array} params - Параметры запроса
 * @returns {Promise<object|null>} Одна строка или null
 */
async function queryOne(text, params) {
    const res = await query(text, params);
    return res.rows[0];
}

/**
 * Получение всех результатов
 * @param {string} text - SQL запрос
 * @param {array} params - Параметры запроса
 * @returns {Promise<array>} Массив строк
 */
async function queryAll(text, params) {
    const res = await query(text, params);
    return res.rows;
}

/**
 * Выполнение транзакции
 * @param {Function} fn - Функция-обработчик транзакции
 * @returns {Promise<any>} Результат функции
 */
async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Выборка с блокировкой строки (SELECT FOR UPDATE)
 * @param {string} text - SQL запрос
 * @param {array} params - Параметры
 * @returns {Promise<object|null>} Заблокированная строка
 */
async function queryForUpdate(text, params) {
    const enhancedText = text.includes('FOR UPDATE') ? text : text + ' FOR UPDATE';
    const res = await query(enhancedText, params);
    return res.rows[0];
}

// ============================================
// ============================================
// ДОСТИЖЕНИЯ
// ============================================

async function updateAchievementProgress(playerId, achievementType, value = 1) {
    try {
        const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!player) return;
        
        const achievements = await queryAll(`
            SELECT * FROM achievements WHERE condition->>'type' = $1
        `, [achievementType]);
        
        if (achievements.length === 0) return;
        
        // ОПТИМИЗАЦИЯ: Получаем ВСЕ player_achievements одним запросом вместо N
        const achievementIds = achievements.map(a => a.id);
        const playerAchievements = await queryAll(`
            SELECT * FROM player_achievements 
            WHERE player_id = $1 AND achievement_id = ANY($2)
        `, [playerId, achievementIds]);
        
        // Создаём Map для быстрого поиска
        const playerAchievementsMap = new Map(
            playerAchievements.map(pa => [pa.achievement_id, pa])
        );
        
        const toInsert = [];
        const toUpdate = [];
        
        for (const achievement of achievements) {
            let condition;
            try {
                condition = typeof achievement.condition === 'string' 
                    ? JSON.parse(achievement.condition) 
                    : achievement.condition;
            } catch(e) {
                logger.error('[database] JSON.parse condition failed:', achievement.condition);
                continue;
            }
            
            const targetValue = condition.value;
            let currentValue = 0;
            
            switch (achievementType) {
                case 'days_played':
                    currentValue = player.days_played || 1;
                    break;
                case 'bosses_killed':
                    currentValue = player.bosses_killed || 0;
                    break;
                case 'pvp_wins':
                    currentValue = player.pvp_wins || 0;
                    break;
                case 'unique_items':
                    currentValue = (player.unique_items || []).length;
                    break;
                case 'locations_visited':
                    currentValue = (player.locations_visited || []).length;
                    break;
                case 'in_clan':
                    currentValue = player.clan_id ? 1 : 0;
                    break;
                case 'clan_leader':
                    currentValue = player.clan_role === 'leader' ? 1 : 0;
                    break;
                case 'clans_joined':
                    currentValue = player.clans_joined || 0;
                    break;
            }
            
            const existingAchievement = playerAchievementsMap.get(achievement.id);
            
            if (!existingAchievement) {
                toInsert.push({ achievementId: achievement.id, currentValue, completed: currentValue >= targetValue });
            } else if (!existingAchievement.completed && currentValue >= targetValue) {
                toUpdate.push({ achievementId: achievement.id, currentValue, completed: true });
            } else if (!existingAchievement.completed) {
                toUpdate.push({ achievementId: achievement.id, currentValue, completed: false });
            }
        }
        
        // Batch INSERT
        if (toInsert.length > 0) {
            const insertValues = toInsert.map((item, idx) => 
                `($1, ${idx * 3 + 2}, ${idx * 3 + 3}, ${idx * 3 + 4})`
            ).join(', ');
            const insertParams = toInsert.flatMap(item => 
                [playerId, item.achievementId, item.currentValue, item.completed]
            );
            await query(`
                INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed)
                VALUES ${insertValues}
            `, insertParams);
        }
        
        // Batch UPDATE
        if (toUpdate.length > 0) {
            for (const item of toUpdate) {
                if (item.completed) {
                    await query(`
                        UPDATE player_achievements 
                        SET progress_value = $3, completed = true, completed_at = NOW()
                        WHERE player_id = $1 AND achievement_id = $2
                    `, [playerId, item.achievementId, item.currentValue]);
                } else {
                    await query(`
                        UPDATE player_achievements 
                        SET progress_value = $3
                        WHERE player_id = $1 AND achievement_id = $2
                    `, [playerId, item.achievementId, item.currentValue]);
                }
            }
        }
    } catch (error) {
        logger.error('Ошибка updateAchievementProgress', { error: error.message, playerId });
    }
}

// ============================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// ============================================

function getRankByLevel(level) {
    const ranks = [
        { min: 1, max: 5, name: 'Новичок', icon: '🌱' },
        { min: 6, max: 10, name: 'Выживший', icon: '🏃' },
        { min: 11, max: 20, name: 'Охотник', icon: '🎯' },
        { min: 21, max: 30, name: 'Страж', icon: '🛡️' },
        { min: 31, max: 50, name: 'Ветеран', icon: '⚔️' },
        { min: 51, max: 75, name: 'Мастер', icon: '🏆' },
        { min: 76, max: 100, name: 'Легенда', icon: '👑' }
    ];
    
    for (const rank of ranks) {
        if (level >= rank.min && level <= rank.max) {
            return {
                name: rank.name,
                icon: rank.icon,
                level_range: `${rank.min}-${rank.max}`,
                current_level: level
            };
        }
    }
    
    return {
        name: 'Легенда',
        icon: '👑',
        level_range: '100+',
        current_level: level
    };
}

function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LH-';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function createReferralCode(playerId) {
    let code = generateReferralCode();
    let exists = await queryOne('SELECT id FROM players WHERE referral_code = $1', [code]);
    while (exists) {
        code = generateReferralCode();
        exists = await queryOne('SELECT id FROM players WHERE referral_code = $1', [code]);
    }
    await query('UPDATE players SET referral_code = $1 WHERE id = $2', [code, playerId]);
    return code;
}

async function changeReferralCode(playerId, newCode) {
    const player = await queryOne('SELECT referral_code_changed FROM players WHERE id = $1', [playerId]);
    if (!player) {
        return { success: false, error: 'Игрок не найден' };
    }
    if (player.referral_code_changed === true) {
        return { success: false, error: 'Вы уже меняли реферальный код' };
    }
    
    const normalizedCode = String(newCode || '').trim().toUpperCase();
    const codeWithPrefix = normalizedCode.startsWith('LH-') ? normalizedCode : `LH-${normalizedCode}`;
    const codePattern = /^LH-[A-Z0-9]{8}$/;
    if (!codePattern.test(codeWithPrefix)) {
        return { success: false, error: 'Неверный формат кода. Пример: LH-ABCD1234' };
    }
    
    const exists = await queryOne('SELECT id FROM players WHERE referral_code = $1 AND id != $2', [codeWithPrefix, playerId]);
    if (exists) {
        return { success: false, error: 'Этот код уже используется' };
    }
    
    await query('UPDATE players SET referral_code = $1, referral_code_changed = true WHERE id = $2', [codeWithPrefix, playerId]);
    return { success: true, code: codeWithPrefix };
}

async function applyReferralCode(playerId, referralCode) {
    const codePattern = /^LH-[A-Z0-9]{8}$/;
    if (!codePattern.test(referralCode)) {
        return { success: false, error: 'Неверный формат реферального кода' };
    }
    
    const referrer = await queryOne('SELECT id, telegram_id FROM players WHERE referral_code = $1', [referralCode]);
    if (!referrer) {
        return { success: false, error: 'Реферальный код не найден' };
    }
    if (referrer.id === playerId) {
        return { success: false, error: 'Нельзя использовать свой собственный код' };
    }
    
    const player = await queryOne('SELECT referred_by, referral_bonus_claimed FROM players WHERE id = $1', [playerId]);
    if (player.referred_by) {
        return { success: false, error: 'Вы уже использовали реферальный код' };
    }
    
    const referralCount = await queryOne(
        'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1',
        [referrer.id]
    );
    if (referralCount && referralCount.count >= 50) {
        return { success: false, error: 'У пригласившего игрока уже максимум рефералов (50)' };
    }
    
    const existingReferral = await queryOne(
        'SELECT id FROM referrals WHERE referred_id = $1',
        [playerId]
    );
    if (existingReferral) {
        return { success: false, error: 'Этот аккаунт уже является чьим-то рефералом' };
    }
    
    await query(
        'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
        [referrer.id, playerId]
    );
    await query(
        'UPDATE players SET referred_by = $1, referral_bonus_claimed = false WHERE id = $2',
        [referrer.id, playerId]
    );
    
    return { 
        success: true, 
        referrer_id: referrer.telegram_id,
        bonus: { coins: 50, energy: 1 }
    };
}

async function giveReferralRegistrationBonus(playerId) {
    const player = await queryOne('SELECT referral_bonus_claimed FROM players WHERE id = $1', [playerId]);
    if (!player || player.referral_bonus_claimed) {
        return { success: false, error: 'Бонус уже получен' };
    }
    
    await query(
        'UPDATE players SET coins = coins + 50, energy = energy + 1, referral_bonus_claimed = true WHERE id = $1',
        [playerId]
    );
    
    return { success: true, bonus: { coins: 50, energy: 1 } };
}

async function checkReferralLevelBonuses(referredPlayerId, newLevel) {
    const bonuses = [];
    const referred = await queryOne('SELECT referred_by FROM players WHERE id = $1', [referredPlayerId]);
    if (!referred || !referred.referred_by) return bonuses;
    
    const referrerId = referred.referred_by;
    const levels = [
        { lvl: 5, bonus: { coins: 100 }, col: 'level_5_bonus' },
        { lvl: 10, bonus: { coins: 200, stars: 5 }, col: 'level_10_bonus' },
        { lvl: 20, bonus: { coins: 500, stars: 10 }, col: 'level_20_bonus' }
    ];
    const allowedColumns = ['level_5_bonus', 'level_10_bonus', 'level_20_bonus'];
    
    for (const { lvl, bonus, col } of levels) {
        if (newLevel < lvl || !allowedColumns.includes(col)) {
            continue;
        }

        const referral = await queryOne(
            `SELECT ${col} FROM referrals WHERE referrer_id = $1 AND referred_id = $2`,
            [referrerId, referredPlayerId]
        );

        if (!referral || referral[col]) {
            continue;
        }

        if (bonus.coins && bonus.stars) {
            await query(
                'UPDATE players SET coins = coins + $1, stars = stars + $2 WHERE id = $3',
                [bonus.coins, bonus.stars, referrerId]
            );
        } else if (bonus.coins) {
            await query(
                'UPDATE players SET coins = coins + $1 WHERE id = $2',
                [bonus.coins, referrerId]
            );
        } else if (bonus.stars) {
            await query(
                'UPDATE players SET stars = stars + $1 WHERE id = $2',
                [bonus.stars, referrerId]
            );
        }

        await query(
            `UPDATE referrals SET ${col} = true, ${col}_claimed_at = NOW() WHERE referrer_id = $1 AND referred_id = $2`,
            [referrerId, referredPlayerId]
        );

        bonuses.push({ level: lvl, bonus });
    }

    return bonuses;
}

async function getReferralsList(playerId) {
    const referrals = await queryAll(`
        SELECT r.id,
               r.referred_id,
               r.created_at AS joined_at,
               r.level_5_bonus,
               r.level_10_bonus,
               r.level_20_bonus,
               p.first_name, p.username, p.level, p.experience
        FROM referrals r
        JOIN players p ON r.referred_id = p.id
        WHERE r.referrer_id = $1
        ORDER BY r.created_at DESC
    `, [playerId]);

    return referrals.map((referral) => ({
        id: referral.id,
        referred_id: referral.referred_id,
        joined_at: referral.joined_at,
        first_name: referral.first_name,
        username: referral.username,
        level: referral.level,
        experience: referral.experience,
        bonuses: {
            level_5: referral.level_5_bonus,
            level_10: referral.level_10_bonus,
            level_20: referral.level_20_bonus
        }
    }));
}

async function getReferralStats(playerId) {
    const totalReferrals = await queryOne(
        'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1',
        [playerId]
    );
    
    const referrals = await queryAll(`
        SELECT p.level, 
               r.level_5_bonus, r.level_10_bonus, r.level_20_bonus
        FROM referrals r
        JOIN players p ON r.referred_id = p.id
        WHERE r.referrer_id = $1
    `, [playerId]);
    
    let totalCoins = 0;
    let totalStars = 0;
    let maxLevelReached = 0;
    
    for (const ref of referrals) {
        if (ref.level_5_bonus) totalCoins += 100;
        if (ref.level_10_bonus) {
            totalCoins += 200;
            totalStars += 5;
        }
        if (ref.level_20_bonus) {
            totalCoins += 500;
            totalStars += 10;
        }
        if (ref.level > maxLevelReached) {
            maxLevelReached = ref.level;
        }
    }
    
    return {
        total_referrals: totalReferrals ? parseInt(totalReferrals.count, 10) : 0,
        max_referrals: 50,
        total_coins_earned: totalCoins,
        total_stars_earned: totalStars,
        max_level_reached: maxLevelReached
    };
}



// ============================================
// ЗАВЕРШЕН
// ============================================

async function closePool() {
    if (pool) {
        await pool.end();
    }
}

module.exports = {
    pool,
    query,
    queryOne,
    queryAll,
    transaction,
    queryForUpdate,
    initDatabase,
    setLogger,  // Добавлено для решения циклической зависимости
    getRankByLevel,
    updateAchievementProgress,
    generateReferralCode,
    createReferralCode,
    changeReferralCode,
    applyReferralCode,
    giveReferralRegistrationBonus,
    checkReferralLevelBonuses,
    getReferralsList,
    getReferralStats,
    closePool
};

// Запуск миграции при прямом выполнении: node db/database.js
if (require.main === module) {
    (async () => {
        try {
            logger.info('🚀 Запуск миграции базы данных...');
            await initDatabase();
            logger.info('✅ Миграция завершена');
            process.exit(0);
        } catch (error) {
            logger.error('❌ Ошибка миграции:', error);
            process.exit(1);
        }
    })();
}
