/**
 * Модуль подключения к PostgreSQL
 * Включает функции для транзакций, валидации и логирования
 */

const { Pool } = require('pg');

// Локальная переменная для логгера - инициализируется позже
let logger;

// Функция для установки логгера после инициализации
function setLogger(log) {
    logger = log;
}

// Инициализация БД - вызывать при старте приложения
async function initDatabase() {
    const schema = require('./schema');
    try {
        await schema.createTables();
        await schema.runMigrations();
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
// ФУНКЦИИ РЫНКА
// ============================================

async function getActiveListingsCount(playerId) {
    const result = await queryOne(
        `SELECT COUNT(*) as count FROM market_listings 
         WHERE seller_id = (SELECT telegram_id FROM players WHERE id = $1) AND status = 'active' AND expires_at > NOW()`,
        [playerId]
    );
    return parseInt(result?.count || 0);
}

function getMarketListingLimit(level) {
    if (level >= 50) return 50;
    if (level >= 40) return 40;
    if (level >= 30) return 30;
    if (level >= 20) return 20;
    if (level >= 10) return 10;
    return 10;
}

async function createMarketListing(sellerId, itemData, quantity, price, starsPrice, durationHours) {
    return await transaction(async (client) => {
        const playerResult = await client.query('SELECT id, level FROM players WHERE telegram_id = $1', [sellerId]);
        const player = playerResult.rows[0];
        if (!player) return { success: false, error: 'Игрок не найден' };
        
        const limit = getMarketListingLimit(player.level);
        const countResult = await client.query(
            'SELECT COUNT(*) as cnt FROM market_listings WHERE seller_id = $1 AND status = \'active\' AND expires_at > NOW()',
            [sellerId]
        );
        const currentCount = parseInt(countResult.rows[0].cnt);
        if (currentCount >= limit) {
            return { success: false, error: `Достигнут лимит объявлений (${limit}). Отмените или дождитесь окончания существующих.` };
        }
        
        const playerDataResult = await client.query('SELECT inventory FROM players WHERE id = $1', [player.id]);
        const playerData = playerDataResult.rows[0];
        const inventory = playerData.inventory || {};
        const itemKey = itemData.id.toString();
        
        if (!inventory[itemKey] || inventory[itemKey] < quantity) {
            return { success: false, error: 'Недостаточно предметов в инвентаре' };
        }
        
        inventory[itemKey] -= quantity;
        if (inventory[itemKey] <= 0) {
            delete inventory[itemKey];
        }
        
        await client.query('UPDATE players SET inventory = $1 WHERE id = $2', [inventory, player.id]);
        
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + durationHours);
        
        const result = await client.query(
            `INSERT INTO market_listings 
             (seller_id, item_id, item_data, quantity, price, stars_price, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [sellerId, itemData.id, JSON.stringify(itemData), quantity, price, starsPrice, expiresAt]
        );
        
        return {
            success: true,
            listingId: result.rows[0].id,
            message: `Объявление создано на ${durationHours} часов`
        };
    });
}

async function buyFromMarket(buyerId, listingId) {
    return await transaction(async (client) => {
        const listingResult = await client.query(
            `SELECT ml.*, p.username, p.first_name 
             FROM market_listings ml 
             LEFT JOIN players p ON ml.seller_id = p.telegram_id
             WHERE ml.id = $1`,
            [listingId]
        );
        
        const listing = listingResult.rows[0];
        if (!listing) {
            return { success: false, error: 'Объявление не найдено' };
        }
        if (listing.status !== 'active') {
            return { success: false, error: 'Объявление уже неактивно' };
        }
        if (new Date(listing.expires_at) < new Date()) {
            return { success: false, error: 'Срок объявления истёк' };
        }
        if (listing.seller_id === buyerId) {
            return { success: false, error: 'Нельзя купить свой товар' };
        }
        
        const buyerResult = await client.query('SELECT * FROM players WHERE telegram_id = $1', [buyerId]);
        const buyer = buyerResult.rows[0];
        if (!buyer) return { success: false, error: 'Игрок не найден' };
        
        const totalPrice = listing.price * listing.quantity;
        const totalStarsPrice = listing.stars_price * listing.quantity;
        
        if (buyer.coins < totalPrice) {
            return { success: false, error: 'Недостаточно монет' };
        }
        if (buyer.stars < totalStarsPrice) {
            return { success: false, error: 'Недостаточно звёзд' };
        }
        
        const commission = Math.floor(totalPrice * 0.05);
        const sellerGets = totalPrice - commission;
        
        // Списание с покупателя
        await client.query(
            'UPDATE players SET coins = coins - $1, stars = stars - $2 WHERE id = $3',
            [totalPrice, totalStarsPrice, buyer.id]
        );
        
        // Начисление продавцу
        await client.query(
            'UPDATE players SET coins = coins + $1 WHERE telegram_id = $2',
            [sellerGets, listing.seller_id]
        );
        
        // Добавление предмета покупателю
        const itemData = listing.item_data;
        const inventory = buyer.inventory || {};
        const itemKey = itemData.id.toString();
        
        if (inventory[itemKey]) {
            inventory[itemKey] += listing.quantity;
        } else {
            inventory[itemKey] = listing.quantity;
        }
        
        await client.query('UPDATE players SET inventory = $1 WHERE id = $2', [inventory, buyer.id]);
        
        // Обновление статуса объявления
        await client.query(
            `UPDATE market_listings 
             SET status = 'sold', sold_at = NOW() 
             WHERE id = $1`,
            [listingId]
        );
        
        // Запись в историю (продавец)
        await client.query(
            `INSERT INTO market_history 
             (listing_id, seller_id, buyer_id, item_id, item_data, quantity, price, stars_price, commission, transaction_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sale')`,
            [listingId, listing.seller_id, buyerId, listing.item_id, listing.item_data, listing.quantity, listing.price, listing.stars_price, commission]
        );
        
        // Запись в историю (покупатель)
        await client.query(
            `INSERT INTO market_history 
             (listing_id, seller_id, buyer_id, item_id, item_data, quantity, price, stars_price, commission, transaction_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'purchase')`,
            [listingId, listing.seller_id, buyerId, listing.item_id, listing.item_data, listing.quantity, listing.price, listing.stars_price, 0]
        );
        
        return {
            success: true,
            message: `Куплено ${listing.quantity}x ${itemData.name} за ${totalPrice} монет`,
            item: itemData,
            quantity: listing.quantity,
            totalPrice: totalPrice,
            commission: commission,
            sellerGets: sellerGets
        };
    });
}

async function cancelMarketListing(sellerId, listingId) {
    return await transaction(async (client) => {
        const listing = await client.query(
            'SELECT * FROM market_listings WHERE id = $1 AND seller_id = $2',
            [listingId, sellerId]
        );
        
        if (!listing.rows[0]) {
            return { success: false, error: 'Объявление не найдено или не принадлежит вам' };
        }
        if (listing.rows[0].status !== 'active') {
            return { success: false, error: 'Объявление уже неактивно' };
        }
        
        const player = await client.query('SELECT inventory FROM players WHERE telegram_id = $1', [sellerId]);
        if (!player.rows[0]) return { success: false, error: 'Игрок не найден' };
        
        const inventory = player.rows[0].inventory || {};
        const itemData = listing.rows[0].item_data;
        const itemKey = itemData.id.toString();
        
        if (inventory[itemKey]) {
            inventory[itemKey] += listing.rows[0].quantity;
        } else {
            inventory[itemKey] = listing.rows[0].quantity;
        }
        
        await client.query('UPDATE players SET inventory = $1 WHERE telegram_id = $2', [inventory, sellerId]);
        
        await client.query(
            `UPDATE market_listings SET status = 'cancelled' WHERE id = $1`,
            [listingId]
        );
        
        return {
            success: true,
            message: 'Объявление отменено, предметы возвращены в инвентарь'
        };
    });
}

async function renewMarketListing(sellerId, listingId, hours) {
    const listing = await queryOne(
        'SELECT * FROM market_listings WHERE id = $1 AND seller_id = $2',
        [listingId, sellerId]
    );
    
    if (!listing) {
        return { success: false, error: 'Объявление не найдено или не принадлежит вам' };
    }
    if (listing.status !== 'active') {
        return { success: false, error: 'Объявление уже неактивно' };
    }
    if (listing.times_renewed >= 3) {
        return { success: false, error: 'Достигнут лимит продлений (максимум 3)' };
    }
    
    let currentExpires = new Date(listing.expires_at);
    if (currentExpires < new Date()) {
        currentExpires = new Date();
    }
    currentExpires.setHours(currentExpires.getHours() + hours);
    
    await query(
        `UPDATE market_listings 
         SET expires_at = $1, times_renewed = times_renewed + 1 
         WHERE id = $2`,
        [currentExpires, listingId]
    );
    
    return {
        success: true,
        message: `Объявление продлено на ${hours} часов`,
        newExpiresAt: currentExpires
    };
}

async function getMarketListings(filters = {}) {
    let queryText = `
        SELECT ml.*, 
               p.username as seller_username, 
               p.first_name as seller_name,
               p.level as seller_level
        FROM market_listings ml
        LEFT JOIN players p ON ml.seller_id = p.telegram_id
        WHERE ml.status = 'active' AND ml.expires_at > NOW()
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (filters.itemType) {
        queryText += ` AND item_data->>'type' = $${paramIndex}`;
        params.push(filters.itemType);
        paramIndex++;
    }
    
    if (filters.search) {
        queryText += ` AND item_data->>'name' ILIKE $${paramIndex}`;
        params.push(`%${filters.search}%`);
        paramIndex++;
    }
    
    if (filters.minPrice) {
        queryText += ` AND (ml.price * ml.quantity) >= $${paramIndex}`;
        params.push(filters.minPrice);
        paramIndex++;
    }
    
    if (filters.maxPrice) {
        queryText += ` AND (ml.price * ml.quantity) <= $${paramIndex}`;
        params.push(filters.maxPrice);
        paramIndex++;
    }
    
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = ['ASC', 'DESC'].includes(filters.sortOrder?.toUpperCase()) 
        ? filters.sortOrder.toUpperCase() 
        : 'DESC';
    
    const sortMap = {
        'price_asc': 'ml.price ASC',
        'price_desc': 'ml.price DESC',
        'date': `ml.created_at ${sortOrder}`,
        'popularity': 'ml.views DESC',
        'expires': 'ml.expires_at ASC'
    };
    
    queryText += ` ORDER BY ${sortMap[sortBy] || 'ml.created_at DESC'}`;
    
    const limit = filters.limit || 50;
    queryText += ` LIMIT $${paramIndex}`;
    params.push(limit);
    
    return await queryAll(queryText, params);
}

async function getMyMarketListings(sellerId) {
    return await queryAll(
        `SELECT ml.* 
         FROM market_listings ml
         WHERE ml.seller_id = $1 
         ORDER BY ml.created_at DESC`,
        [sellerId]
    );
}

async function incrementListingViews(listingId) {
    await query(
        'UPDATE market_listings SET views = views + 1 WHERE id = $1',
        [listingId]
    );
}

async function getMarketHistory(playerId, type = 'all') {
    let queryText = `
        SELECT mh.*, 
               p1.first_name as seller_name,
               p2.first_name as buyer_name
        FROM market_history mh
        LEFT JOIN players p1 ON mh.seller_id = p1.telegram_id
        LEFT JOIN players p2 ON mh.buyer_id = p2.telegram_id
        WHERE mh.seller_id = $1 OR mh.buyer_id = $1
    `;
    
    const params = [playerId];
    
    if (type === 'sales') {
        queryText += ' AND mh.transaction_type = \'sale\'';
    } else if (type === 'purchases') {
        queryText += ' AND mh.transaction_type = \'purchase\'';
    }
    
    queryText += ' ORDER BY mh.created_at DESC LIMIT 50';
    
    return await queryAll(queryText, params);
}

async function cleanupExpiredListings() {
    const result = await query(
        `UPDATE market_listings 
         SET status = 'expired' 
         WHERE status = 'active' AND expires_at < NOW() 
         RETURNING id`
    );
    return result.rowCount;
}

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
                case 'items_crafted':
                    currentValue = player.items_crafted || 0;
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
    
    const codePattern = /^LH-[A-Z0-9]{8}$/;
    if (!codePattern.test(newCode)) {
        return { success: false, error: 'Неверный формат кода. Пример: LH-ABCD1234' };
    }
    
    const exists = await queryOne('SELECT id FROM players WHERE referral_code = $1 AND id != $2', [newCode, playerId]);
    if (exists) {
        return { success: false, error: 'Этот код уже используется' };
    }
    
    await query('UPDATE players SET referral_code = $1, referral_code_changed = true WHERE id = $2', [newCode, playerId]);
    return { success: true, code: newCode };
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
        [referrer.telegram_id]
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
        [referrer.telegram_id, playerId]
    );
    await query(
        'UPDATE players SET referred_by = $1, referral_bonus_claimed = false WHERE id = $2',
        [referrer.telegram_id, playerId]
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
    
    const referrerTelegramId = referred.referred_by;
    const levels = [
        { lvl: 5, bonus: { coins: 100 }, col: 'level_5_bonus' },
        { lvl: 10, bonus: { coins: 200, stars: 5 }, col: 'level_10_bonus' },
        { lvl: 20, bonus: { coins: 500, stars: 10 }, col: 'level_20_bonus' }
    ];
    
    for (const { lvl, bonus, col } of levels) {
        if (newLevel >= lvl) {
            const allowedColumns = ['level_5_bonus', 'level_10_bonus', 'level_20_bonus'];
            if (!allowedColumns.includes(col)) {
                continue;
            }
            
            const referral = await queryOne(`SELECT ${col} FROM referrals WHERE referrer_id = $1 AND referred_id = $2`, [referrerTelegramId, referredPlayerId]);
            if (referral && !referral[col]) {
                let updateQuery;
                let params;
                
                if (bonus.coins && bonus.stars) {
                    updateQuery = 'UPDATE players SET coins = coins + $1, stars = stars + $2 WHERE telegram_id = $3';
                    params = [bonus.coins, bonus.stars, referrerTelegramId];
                } else if (bonus.coins) {
                    updateQuery = 'UPDATE players SET coins = coins + $1 WHERE telegram_id = $2';
                    params = [bonus.coins, referrerTelegramId];
                } else {
                    updateQuery = 'UPDATE players SET stars = stars + $1 WHERE telegram_id = $2';
                    params = [bonus.stars, referrerTelegramId];
                }
                
                await query(updateQuery, params);
                await query(`UPDATE referrals SET ${col} = true, ${col}_claimed_at = NOW() WHERE referrer_id = $1 AND referred_id = $2`, [referrerTelegramId, referredPlayerId]);
                bonuses.push({ level: lvl, bonus });
            }
        }
    }
    return bonuses;
}

async function getReferralsList(telegramId) {
    const referrals = await queryAll(`
        SELECT r.id, r.referred_id, r.created_at, r.level_5_bonus, r.level_10_bonus, r.level_20_bonus,
               p.first_name, p.username, p.level, p.experience
        FROM referrals r
        JOIN players p ON r.referred_id = p.telegram_id
        WHERE r.referrer_id = $1
        ORDER BY r.created_at DESC
    `, [telegramId]);
    return referrals;
}

async function getReferralStats(telegramId) {
    const totalReferrals = await queryOne(
        'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1',
        [telegramId]
    );
    
    const referrals = await queryAll(`
        SELECT p.level, 
               r.level_5_bonus, r.level_10_bonus, r.level_20_bonus
        FROM referrals r
        JOIN players p ON r.referred_id = p.telegram_id
        WHERE r.referrer_id = $1
    `, [telegramId]);
    
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
// ЕЖЕДНЕВНЫЕ ЗАДАНИЯ
// ============================================

const DAILY_TASK_TEMPLATES = [
    { type: 'kill_enemies', target: 10, reward: { coins: 100, exp: 50 }, event_bonus: {} },
    { type: 'kill_enemies', target: 25, reward: { coins: 250, exp: 100 }, event_bonus: {} },
    { type: 'collect_resources', target: 15, reward: { coins: 150, exp: 75 }, event_bonus: {} },
    { type: 'craft_items', target: 5, reward: { coins: 200, exp: 100 }, event_bonus: {} },
    { type: 'pvp_battles', target: 3, reward: { coins: 300, exp: 150 }, event_bonus: {} },
    { type: 'explore_locations', target: 5, reward: { coins: 100, exp: 50 }, event_bonus: {} },
    { type: 'trade_items', target: 10, reward: { coins: 150, exp: 50 }, event_bonus: {} },
    { type: 'boss_kills', target: 1, reward: { coins: 500, exp: 250 }, event_bonus: {} }
];

async function createDailyTasks(playerId) {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 1);
    
    const shuffled = [...DAILY_TASK_TEMPLATES].sort(() => Math.random() - 0.5);
    const selectedTasks = shuffled.slice(0, 3);
    const createdTasks = [];
    
    for (const template of selectedTasks) {
        
        const reward = {
            coins: Math.floor(template.reward.coins * rewardMultiplier),
            exp: Math.floor(template.reward.exp * rewardMultiplier)
        };
        
        if (season) {
            const result = await query(
                `INSERT INTO season_daily_tasks 
                 (season_id, player_id, task_type, target_value, reward, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (season_id, player_id, task_type, expires_at) DO NOTHING
                 RETURNING *`,
                [season.id, playerId, template.type, template.target, JSON.stringify(reward), expiresAt]
            );
            if (result.rows[0]) createdTasks.push(result.rows[0]);
        } else {
            const result = await query(
                `INSERT INTO daily_tasks 
                 (player_id, task_type, target_value, reward, expires_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (player_id, task_type, expires_at) DO NOTHING
                 RETURNING *`,
                [playerId, template.type, template.target, JSON.stringify(reward), expiresAt]
            );
            if (result.rows[0]) createdTasks.push(result.rows[0]);
        }
    }
    return createdTasks;
}

async function getDailyTasks(playerId) {
    const season = await getCurrentSeason();
    const now = new Date();
    
    if (season) {
        let tasks = await queryAll(
            `SELECT * FROM season_daily_tasks 
             WHERE player_id = $1 AND season_id = $2 AND expires_at > $3 
             ORDER BY id`,
            [playerId, season.id, now]
        );
        
        if (tasks.length === 0) {
            tasks = await createDailyTasks(playerId);
        }
        
        if (tasks.length === 0) {
            tasks = await queryAll(
                `SELECT * FROM daily_tasks 
                 WHERE player_id = $1 AND expires_at > $2 
                 ORDER BY id`,
                [playerId, now]
            );
            if (tasks.length === 0) {
                tasks = await createDailyTasks(playerId);
            }
        }
        return tasks;
    } else {
        let tasks = await queryAll(
            `SELECT * FROM daily_tasks 
             WHERE player_id = $1 AND expires_at > $2 
             ORDER BY id`,
            [playerId, now]
        );
        
        if (tasks.length === 0) {
            tasks = await createDailyTasks(playerId);
        }
        return tasks;
    }
}

async function updateDailyTaskProgress(playerId, taskType, amount) {
    const season = await getCurrentSeason();
    
    if (season) {
        const task = await queryOne(
            `UPDATE season_daily_tasks 
             SET current_value = LEAST(current_value + $1, target_value)
             WHERE player_id = $2 AND season_id = $3 AND task_type = $4 
             AND completed = false AND expires_at > NOW()
             RETURNING *`,
            [amount, playerId, season.id, taskType]
        );
        
        if (task && task.current_value >= task.target_value) {
            await query(
                'UPDATE season_daily_tasks SET completed = true WHERE id = $1',
                [task.id]
            );
            await addSeasonPoints(playerId, season.id, 10);
            await query(
                'UPDATE season_participants SET tasks_completed = tasks_completed + 1 WHERE player_id = $1 AND season_id = $2',
                [playerId, season.id]
            );
            return { ...task, completed: true };
        }
        return task;
    } else {
        return queryOne(
            `UPDATE daily_tasks 
             SET current_value = LEAST(current_value + $1, target_value)
             WHERE player_id = $2 AND task_type = $3 
             AND completed = false AND expires_at > NOW()
             RETURNING *`,
            [amount, playerId, taskType]
        );
    }
}

async function claimDailyTaskReward(playerId, taskId) {
    const season = await getCurrentSeason();
    
    if (season) {
        const task = await queryOne(
            'SELECT * FROM season_daily_tasks WHERE id = $1 AND player_id = $2 AND completed = true AND expires_at > NOW()',
            [taskId, playerId]
        );
        
        if (!task) {
            return { success: false, error: 'Задание не найдено или не выполнено' };
        }
        
        const reward = task.reward || {};
        
        if (reward.coins) {
            await query('UPDATE players SET coins = coins + $1 WHERE id = $2', [reward.coins, playerId]);
        }
        if (reward.exp) {
            await query('UPDATE players SET experience = experience + $1 WHERE id = $2', [reward.exp, playerId]);
        }
        
        await query('DELETE FROM season_daily_tasks WHERE id = $1', [taskId]);
        
        return { success: true, reward };
    } else {
        const task = await queryOne(
            'SELECT * FROM daily_tasks WHERE id = $1 AND player_id = $2 AND completed = true AND expires_at > NOW()',
            [taskId, playerId]
        );
        
        if (!task) {
            return { success: false, error: 'Задание не найдено или не выполнено' };
        }
        
        const reward = task.reward || {};
        
        if (reward.coins) {
            await query('UPDATE players SET coins = coins + $1 WHERE id = $2', [reward.coins, playerId]);
        }
        if (reward.exp) {
            await query('UPDATE players SET experience = experience + $1 WHERE id = $2', [reward.exp, playerId]);
        }
        
        await query('DELETE FROM daily_tasks WHERE id = $1', [taskId]);
        
        return { success: true, reward };
    }
}

// ============================================
// ЗАВЕРШЕНИЕ
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
    getActiveListingsCount,
    getMarketListingLimit,
    createMarketListing,
    buyFromMarket,
    cancelMarketListing,
    renewMarketListing,
    getMarketListings,
    getMyMarketListings,
    incrementListingViews,
    getMarketHistory,
    cleanupExpiredListings,
    generateReferralCode,
    createReferralCode,
    changeReferralCode,
    applyReferralCode,
    giveReferralRegistrationBonus,
    checkReferralLevelBonuses,
    getReferralsList,
    getReferralStats,
    DAILY_TASK_TEMPLATES,
    createDailyTasks,
    getDailyTasks,
    updateDailyTaskProgress,
    claimDailyTaskReward,
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
