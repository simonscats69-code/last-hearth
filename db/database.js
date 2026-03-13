/**
 * Модуль подключения к PostgreSQL
 * Включает функции для транзакций, валидации и логирования
 */

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

// Инициализация БД - вызывать при старте приложения
async function initDatabase() {
    const schema = require('./schema');
    try {
        await schema.createTables();
        await schema.runMigrations();
        logger.info('✓ База данных инициализирована');
    } catch (error) {
        logger.error('Ошибка инициализации БД:', { error: error.message });
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
 * Safe JSON parse с fallback
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        console.error('JSON.parse failed:', typeof value, String(value).substring(0, 100));
        return fallback;
    }
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
 * Транзакция с использованием client
 * @param {Function} fn - Функция-обработчик с client
 * @returns {Promise<any>} Результат
 */
async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
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

/**
 * Инициализация базы данных и создание таблиц
 */
async function initDatabase() {
    await query(`
        -- Таблица игроков
        CREATE TABLE IF NOT EXISTS players (
            id SERIAL PRIMARY KEY,
            telegram_id BIGINT UNIQUE NOT NULL,
            username VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            -- Характеристики
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            strength INTEGER DEFAULT 1,      -- Сила
            endurance INTEGER DEFAULT 1,     -- Выносливость
            agility INTEGER DEFAULT 1,       -- Ловкость
            intelligence INTEGER DEFAULT 1,  -- Интеллект
            luck INTEGER DEFAULT 1,          -- Удача
            crafting INTEGER DEFAULT 1,       -- Мастерство крафта
            -- Состояния
            health INTEGER DEFAULT 100,
            max_health INTEGER DEFAULT 100,
            radiation JSONB DEFAULT '{"level": 0}',
            fatigue INTEGER DEFAULT 0,
            energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,
            infections JSONB DEFAULT '[]',
            -- Позиция
            current_location_id INTEGER DEFAULT 1,
            -- Инвентарь (JSONB)
            inventory JSONB DEFAULT '{}',
            equipment JSONB DEFAULT '{}',
            -- Деньги
            coins INTEGER DEFAULT 0,
            stars INTEGER DEFAULT 0,
            -- База
            base JSONB DEFAULT '{"level": 1, "buildings": [], "storage": {}}',
            -- Клан
            clan_id INTEGER,
            clan_role VARCHAR(50) DEFAULT 'member',
            -- Статистика
            total_actions INTEGER DEFAULT 0,
            bosses_killed INTEGER DEFAULT 0,
            days_played INTEGER DEFAULT 1,
            -- Временные метки
            last_energy_update TIMESTAMP DEFAULT NOW(),
            last_action_time TIMESTAMP DEFAULT NOW(),
            last_daily_bonus TIMESTAMP,  -- Последний ежедневный бонус
            daily_streak INTEGER DEFAULT 0,  -- Серия ежедневных бонусов
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        -- Таблица локаций
        CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            radiation INTEGER DEFAULT 0,
            min_luck INTEGER DEFAULT 0,
            danger_level INTEGER DEFAULT 1,
            -- Таблица лута (JSONB)
            loot_table JSONB DEFAULT '[]',
            is_available BOOLEAN DEFAULT true,
            icon VARCHAR(50),
            color VARCHAR(20)
        );
        -- Таблица сетов предметов
        CREATE TABLE IF NOT EXISTS item_sets (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(50),
            -- Бонусы сета
            -- 2 предмета = малый бонус
            bonus_2 JSONB DEFAULT '{"health": 10, "damage": 2}',
            -- 3 предмета = средний бонус
            bonus_3 JSONB DEFAULT '{"health": 25, "damage": 5, "crit_chance": 2}',
            -- 4 предмета = большой бонус
            bonus_4 JSONB DEFAULT '{"health": 50, "damage": 10, "crit_chance": 5, "crit_damage": 10}'
        );
        -- Таблица предметов
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            type VARCHAR(50) NOT NULL,
            category VARCHAR(50),
            -- Характеристики
            rarity VARCHAR(20) DEFAULT 'common',
            stackable BOOLEAN DEFAULT true,
            max_stack INTEGER DEFAULT 99,
            -- Эффекты (JSONB)
            effects JSONB DEFAULT '{}',
            -- Для экипировки
            slot VARCHAR(50),
            stats JSONB DEFAULT '{}',
            durability INTEGER DEFAULT 100,
            max_durability INTEGER DEFAULT 100,
            -- Сет (связь с item_sets)
            set_id INTEGER REFERENCES item_sets(id),
            piece_number INTEGER DEFAULT 0,
            -- Апгрейд
            upgrade_level INTEGER DEFAULT 0,
            max_upgrade_level INTEGER DEFAULT 10,
            -- Модификации
            modifications JSONB DEFAULT '[]',
            -- Крафт
            craftable BOOLEAN DEFAULT false,
            recipe JSONB,
            -- Продажа
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            icon VARCHAR(50),
            image_url VARCHAR(500)
        );
        -- Связь предметов с сетами
        CREATE TABLE IF NOT EXISTS item_set_items (
            id SERIAL PRIMARY KEY,
            set_id INTEGER REFERENCES item_sets(id),
            item_id INTEGER REFERENCES items(id),
            piece_number INTEGER DEFAULT 1,
            UNIQUE(set_id, item_id)
        );
        -- Таблица боссов
        CREATE TABLE IF NOT EXISTS bosses (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            -- Характеристики босса
            level INTEGER DEFAULT 1,
            health INTEGER DEFAULT 1000,
            max_health INTEGER DEFAULT 1000,
            damage INTEGER DEFAULT 10,
            -- Награда
            reward_experience INTEGER DEFAULT 100,
            reward_coins INTEGER DEFAULT 50,
            reward_items JSONB DEFAULT '[]',
            key_drop_chance REAL DEFAULT 0.5,
            -- Требования
            required_key_id INTEGER,
            keys_required INTEGER DEFAULT 1,
            -- Дополнительно
            is_group_boss BOOLEAN DEFAULT false,
            min_clan_level INTEGER DEFAULT 1,
            icon VARCHAR(50),
            image_url VARCHAR(500)
        );
        -- Таблица кланов
        CREATE TABLE IF NOT EXISTS clans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            leader_id BIGINT NOT NULL,
            -- Уровень и опыт
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            -- Ресурсы
            coins INTEGER DEFAULT 0,
            -- Настройки
            is_public BOOLEAN DEFAULT true,  -- Открытый или закрытый клан
            invite_code VARCHAR(20),  -- Код приглашения
            -- Статистика
            total_members INTEGER DEFAULT 1,
            bosses_killed INTEGER DEFAULT 0,
            -- Бонусы
            loot_bonus INTEGER DEFAULT 0,  -- % бонуса к добыче
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        -- Таблица чата клана
        CREATE TABLE IF NOT EXISTS clan_chat (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
            player_id BIGINT NOT NULL,
            player_name VARCHAR(255),
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
        -- Таблица заявок в клан
        CREATE TABLE IF NOT EXISTS clan_applications (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
            player_id BIGINT NOT NULL,
            player_name VARCHAR(255),
            status VARCHAR(20) DEFAULT 'pending',  -- pending, accepted, rejected
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(clan_id, player_id)
        );
        -- Таблица ключей от боссов
        CREATE TABLE IF NOT EXISTS boss_keys (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            quantity INTEGER DEFAULT 1,
            obtained_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, boss_id)
        );
        -- Таблица мастерства боссов (сколько раз игрок убил конкретного босса)
        CREATE TABLE IF NOT EXISTS boss_mastery (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            kills INTEGER DEFAULT 0,
            last_killed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, boss_id)
        );
        -- Таблица сессий рейдовых боссов (отслеживает урон игроков)
        CREATE TABLE IF NOT EXISTS boss_sessions (
            id SERIAL PRIMARY KEY,
            boss_id INTEGER REFERENCES bosses(id),
            player_id INTEGER REFERENCES players(id),
            raid_id INTEGER REFERENCES raid_progress(id),  -- Связь с рейдом
            damage_dealt INTEGER DEFAULT 0,
            rewards_earned BOOLEAN DEFAULT false,  -- Получил ли награду
            joined_at TIMESTAMP DEFAULT NOW(),
            last_hit_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(boss_id, player_id)
        );
        -- Таблица прогресса рейда (общий HP босса на время рейда)
        CREATE TABLE IF NOT EXISTS raid_progress (
            id SERIAL PRIMARY KEY,
            boss_id INTEGER REFERENCES bosses(id),
            current_health INTEGER NOT NULL,
            max_health INTEGER NOT NULL,
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,  -- Таймер окончания рейда (8 часов)
            is_active BOOLEAN DEFAULT true,
            is_raid BOOLEAN DEFAULT false,  -- true = мультиплеерный рейд, false = одиночный
            leader_id INTEGER REFERENCES players(id),  -- Игрок, начавший рейд (получит ключ)
            leader_name VARCHAR(255),  -- Имя лидера для отображения
            is_clan_raid BOOLEAN DEFAULT false,  -- true = клановый рейд
            clan_id INTEGER REFERENCES clans(id),  -- ID клана для клановых рейдов
            UNIQUE(boss_id, is_active)
        );
        -- Таблица достижений
        CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            category VARCHAR(50) NOT NULL DEFAULT 'survival',  -- survival, bosses, pvp, craft, collection, exploration, social
            condition JSONB NOT NULL,
            reward JSONB DEFAULT '{"coins": 0, "stars": 0}',
            icon VARCHAR(50),
            rarity VARCHAR(20) DEFAULT 'common'  -- common, rare, epic, legendary
        );
        -- Таблица прогресса игрока в достижениях
        CREATE TABLE IF NOT EXISTS player_achievements (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            achievement_id INTEGER REFERENCES achievements(id),
            progress JSONB DEFAULT '{}',
            progress_value INTEGER DEFAULT 0,  -- Текущее значение прогресса
            completed BOOLEAN DEFAULT false,
            completed_at TIMESTAMP,
            reward_claimed BOOLEAN DEFAULT false,  -- Получена ли награда
            claimed_at TIMESTAMP,
            UNIQUE(player_id, achievement_id)
        );
        -- Таблица ежедневных заданий
        CREATE TABLE IF NOT EXISTS daily_tasks (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            task_type VARCHAR(50) NOT NULL,
            target_value INTEGER NOT NULL,
            current_value INTEGER DEFAULT 0,
            reward JSONB NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            completed BOOLEAN DEFAULT false,
            UNIQUE(player_id, task_type, expires_at)
        );
        -- Таблица клановых боссов
        CREATE TABLE IF NOT EXISTS clan_bosses (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
            boss_name VARCHAR(100) NOT NULL,
            boss_description TEXT,
            boss_icon VARCHAR(10) DEFAULT '👹',
            boss_level INTEGER NOT NULL,
            max_health INTEGER NOT NULL,
            current_health INTEGER NOT NULL,
            damage INTEGER NOT NULL,
            reward_experience INTEGER NOT NULL,
            reward_coins INTEGER NOT NULL,
            reward_stars INTEGER DEFAULT 0,
            spawn_time TIMESTAMP DEFAULT NOW(),
            killed_at TIMESTAMP,
            is_active BOOLEAN DEFAULT true,
            UNIQUE(clan_id, is_active)
        );
        -- Таблица рефералов
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id BIGINT NOT NULL,
            referred_id BIGINT NOT NULL,
            bonus_claimed BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(referred_id)
        );
        -- Таблица рынка/барахолки
        CREATE TABLE IF NOT EXISTS market_listings (
            id SERIAL PRIMARY KEY,
            seller_id BIGINT NOT NULL,
            item_id INTEGER REFERENCES items(id),
            item_data JSONB NOT NULL,  -- Данные о предмете для отображения
            quantity INTEGER DEFAULT 1,
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',  -- active, cancelled, expired
            views INTEGER DEFAULT 0,  -- Количество просмотров
            times_renewed INTEGER DEFAULT 0,  -- Сколько раз продлевалось
            created_at TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP,
            sold_at TIMESTAMP
        );
        -- Таблица истории сделок рынка
        CREATE TABLE IF NOT EXISTS market_history (
            id SERIAL PRIMARY KEY,
            listing_id INTEGER,  -- ID объявления
            seller_id BIGINT NOT NULL,
            buyer_id BIGINT NOT NULL,
            item_id INTEGER REFERENCES items(id),
            item_data JSONB NOT NULL,
            quantity INTEGER DEFAULT 1,
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            commission INTEGER DEFAULT 0,
            transaction_type VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
        -- Индексы для производительности
        CREATE INDEX IF NOT EXISTS idx_players_telegram_id ON players(telegram_id);
        CREATE INDEX IF NOT EXISTS idx_players_clan_id ON players(clan_id);
        CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC);
        CREATE INDEX IF NOT EXISTS idx_players_coins ON players(coins DESC);
        CREATE INDEX IF NOT EXISTS idx_players_last_action ON players(last_action_time);
        CREATE INDEX IF NOT EXISTS idx_players_daily_bonus ON players(last_daily_bonus);
        CREATE INDEX IF NOT EXISTS idx_boss_keys_player ON boss_keys(player_id);
        CREATE INDEX IF NOT EXISTS idx_daily_tasks_player ON daily_tasks(player_id);
        CREATE INDEX IF NOT EXISTS idx_clan_chat_clan ON clan_chat(clan_id);
        CREATE INDEX IF NOT EXISTS idx_clan_chat_created ON clan_chat(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clan_applications_clan ON clan_applications(clan_id);
        CREATE INDEX IF NOT EXISTS idx_clan_applications_player ON clan_applications(player_id);
        -- Индексы для рынка
        CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id);
        CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);
        CREATE INDEX IF NOT EXISTS idx_market_listings_expires ON market_listings(expires_at);
        CREATE INDEX IF NOT EXISTS idx_market_listings_item_type ON market_listings((item_data->>'type'));
        CREATE INDEX IF NOT EXISTS idx_market_history_buyer ON market_history(buyer_id);
        CREATE INDEX IF NOT EXISTS idx_market_history_seller ON market_history(seller_id);
        CREATE INDEX IF NOT EXISTS idx_market_history_created ON market_history(created_at DESC);
        -- Индексы для дебаффов (радиация и инфекции)
        CREATE INDEX IF NOT EXISTS idx_players_radiation_expires ON players((radiation->>'expires_at')) WHERE radiation IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_players_infections_expires ON players(((infections[0]->>'expires_at'))) WHERE infections IS NOT NULL AND jsonb_array_length(infections) > 0;
    `);
    await query(`
        -- Таблица PvP матчей (история боёв)
        CREATE TABLE IF NOT EXISTS pvp_matches (
            id SERIAL PRIMARY KEY,
            attacker_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            defender_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            location_id INTEGER REFERENCES locations(id),
            -- Результат
            winner_id INTEGER REFERENCES players(id),
            loser_id INTEGER REFERENCES players(id),
            is_draw BOOLEAN DEFAULT false,
            -- Награды
            coins_stolen INTEGER DEFAULT 0,
            items_stolen JSONB DEFAULT '[]',
            experience_gained INTEGER DEFAULT 0,
            -- Статистика боя
            attacker_damage_dealt INTEGER DEFAULT 0,
            attacker_damage_taken INTEGER DEFAULT 0,
            defender_damage_dealt INTEGER DEFAULT 0,
            defender_damage_taken INTEGER DEFAULT 0,
            total_hits INTEGER DEFAULT 0,
            battle_duration INTEGER DEFAULT 0,
            -- Временные метки
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP DEFAULT NOW()
        );
        -- Таблица PvP кулдаунов
        CREATE TABLE IF NOT EXISTS pvp_cooldowns (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            cooldown_type VARCHAR(50) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            reason TEXT,
            UNIQUE(player_id, cooldown_type)
        );
        -- Индексы для PvP таблиц
        CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id);
        CREATE INDEX IF NOT EXISTS idx_pvp_matches_defender ON pvp_matches(defender_id);
        CREATE INDEX IF NOT EXISTS idx_pvp_matches_winner ON pvp_matches(winner_id);
        CREATE INDEX IF NOT EXISTS idx_pvp_matches_location ON pvp_matches(location_id);
        CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_player ON pvp_cooldowns(player_id);
        CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_expires ON pvp_cooldowns(expires_at);
    `);
    await query(`
        ALTER TABLE players ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
        ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);
    await query(`
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_wins INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_losses INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_draws INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_streak INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_max_streak INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_rating INTEGER DEFAULT 1000;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_total_damage_dealt INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_total_damage_taken INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS coins_stolen_from_me INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS items_stolen_from_me INTEGER DEFAULT 0;
    `);
    await query(`
        ALTER TABLE players ADD COLUMN IF NOT EXISTS broken_leg BOOLEAN DEFAULT false;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS broken_arm BOOLEAN DEFAULT false;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS infection_count INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS infections JSONB DEFAULT '[]';
        ALTER TABLE players ADD COLUMN IF NOT EXISTS radiation_poisoning BOOLEAN DEFAULT false;
    `);
    await query(`
        ALTER TABLE players ADD COLUMN IF NOT EXISTS items_crafted INTEGER DEFAULT 0;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS unique_items JSONB DEFAULT '[]';
        ALTER TABLE players ADD COLUMN IF NOT EXISTS locations_visited JSONB DEFAULT '[]';
        ALTER TABLE players ADD COLUMN IF NOT EXISTS clans_joined INTEGER DEFAULT 0;
    `);
    await query(`
        ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);
        ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code_changed BOOLEAN DEFAULT false;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by BIGINT;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_bonus_claimed BOOLEAN DEFAULT false;
    `);
    await query(`
        CREATE INDEX IF NOT EXISTS idx_players_referral_code ON players(referral_code);
    `);
    await query(`
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_5_bonus BOOLEAN DEFAULT false;
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_10_bonus BOOLEAN DEFAULT false;
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_20_bonus BOOLEAN DEFAULT false;
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_5_bonus_claimed_at TIMESTAMP;
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_10_bonus_claimed_at TIMESTAMP;
        ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_20_bonus_claimed_at TIMESTAMP;
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS buildings (
            id SERIAL PRIMARY KEY,
            code VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            -- Тип постройки
            type VARCHAR(50) NOT NULL,
            -- Базовые параметры
            max_level INTEGER DEFAULT 10,
            base_cost_coins INTEGER DEFAULT 100,
            base_cost_resources JSONB DEFAULT '{}',
            -- Бонусы по уровням (JSONB массив)
            bonuses JSONB DEFAULT '[]',
            -- Визуал
            icon VARCHAR(50),
            color VARCHAR(20),
            -- Требования
            required_level INTEGER DEFAULT 1,
            required_building_code VARCHAR(50)
        );
        -- Заполнение типов построек
        INSERT INTO buildings (code, name, description, type, max_level, base_cost_coins, base_cost_resources, bonuses, icon, color, required_level) VALUES
        ('wall', 'Стена', 'Защитная стена вашей базы', 'structure', 10, 50, '{"scrap": 10}', '[{"storage": 5}]', '🧱', '#8B4513', 1),
        ('floor', 'Пол', 'Укреплённый пол базы', 'structure', 10, 30, '{"scrap": 5}', '[{"storage": 2}]', '⬜', '#808080', 1),
        ('storage', 'Склад', 'Увеличивает лимит инвентаря', 'production', 10, 100, '{"scrap": 20, "wood": 10}', '[{"inventory_limit": 20}]', '📦', '#FFD700', 1),
        ('workbench', 'Верстак', 'Позволяет крафтить сложные предметы', 'production', 10, 150, '{"scrap": 30, "wood": 15}', '[{"craft_level": 1}]', '🔧', '#C0C0C0', 1),
        ('forge', 'Кузня', 'Ремонт и создание оружия', 'production', 10, 200, '{"scrap": 50, "iron": 20}', '[{"repair_bonus": 10, "weapon_craft": 1}]', '⚒️', '#FF4500', 3),
        ('lab', 'Химлаборатория', 'Создание медикаментов', 'production', 10, 250, '{"scrap": 40, "chemicals": 15}', '[{"medicine_craft": 1}]', '🧪', '#00FF00', 5),
        ('living_room', 'Жилая комната', 'Пассивная регенерация здоровья', 'living', 10, 80, '{"wood": 20, "cloth": 10}', '[{"health_regen": 1}]', '🛏️', '#4169E1', 2),
        ('farm', 'Ферма', 'Выращивание еды', 'production', 10, 120, '{"wood": 15, "seeds": 5}', '[{"food_production": 1}]', '🌾', '#32CD32', 1)
        ON CONFLICT (code) DO NOTHING;
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS player_buildings (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            building_code VARCHAR(50) NOT NULL,
            level INTEGER DEFAULT 1,
            -- Состояние постройки
            is_active BOOLEAN DEFAULT true,
            built_at TIMESTAMP DEFAULT NOW(),
            last_upgraded_at TIMESTAMP DEFAULT NOW(),
            -- Уникальность
            UNIQUE(player_id, building_code)
        );
        CREATE INDEX IF NOT EXISTS idx_player_buildings_player ON player_buildings(player_id);
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS craft_recipes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            -- Результат крафта
            result_item_id INTEGER REFERENCES items(id),
            result_quantity INTEGER DEFAULT 1,
            -- Требуемые ингредиенты (JSONB массив: [{"item_id": 1, "quantity": 5}, ...])
            ingredients JSONB NOT NULL,
            -- Требования
            required_level INTEGER DEFAULT 1,
            required_base_building VARCHAR(50),
            -- Время крафта в секундах
            craft_time INTEGER DEFAULT 5,
            -- Редкость рецепта
            rarity VARCHAR(20) DEFAULT 'common'
        );
        -- Заполнение рецептов крафта
        INSERT INTO craft_recipes (name, description, result_item_id, result_quantity, ingredients, required_level, craft_time, rarity) VALUES
        -- Простые рецепты (в инвентаре)
        ('Нож', 'Простой нож из металлолома', 8, 1, '[{"item_id": 11, "quantity": 3}]', 1, 5, 'common'),
        ('Бита', 'Бейсбольная бита', 9, 1, '[{"item_id": 12, "quantity": 2}]', 1, 5, 'common'),
        ('Кожаная куртка', 'Простая защита', 17, 1, '[{"item_id": 14, "quantity": 5}]', 1, 10, 'common'),
        ('Бинт', 'Бинт из ткани', 4, 2, '[{"item_id": 14, "quantity": 3}]', 1, 3, 'common'),
        -- Средние рецепты
        ('Пистолет', 'Травматический пистолет', 10, 1, '[{"item_id": 11, "quantity": 5}, {"item_id": 15, "quantity": 2}]', 5, 30, 'uncommon'),
        ('Бронежилет', 'Военный бронежилет', 18, 1, '[{"item_id": 11, "quantity": 10}, {"item_id": 14, "quantity": 5}]', 10, 45, 'rare'),
        ('Противогаз', 'Защита от радиации', 19, 1, '[{"item_id": 15, "quantity": 3}, {"item_id": 17, "quantity": 2}]', 8, 20, 'uncommon'),
        ('Аптечка', 'Полная аптечка', 5, 1, '[{"item_id": 4, "quantity": 3}, {"item_id": 21, "quantity": 2}]', 5, 15, 'uncommon'),
        -- Редкие рецепты
        ('Автомат', 'Автоматическое оружие', 11, 1, '[{"item_id": 10, "quantity": 1}, {"item_id": 11, "quantity": 8}, {"item_id": 16, "quantity": 3}]', 15, 60, 'rare'),
        ('Дробовик', 'Охотничий дробовик', 12, 1, '[{"item_id": 11, "quantity": 6}, {"item_id": 17, "quantity": 2}]', 12, 45, 'rare'),
        ('Армейская каска', 'Защита головы', 20, 1, '[{"item_id": 11, "quantity": 4}, {"item_id": 14, "quantity": 2}]', 8, 20, 'uncommon'),
        ('Антидот', 'Лекарство от инфекций', 6, 1, '[{"item_id": 21, "quantity": 3}, {"item_id": 18, "quantity": 2}]', 10, 25, 'rare'),
        ('Антирадин', 'Препарат от радиации', 7, 1, '[{"item_id": 21, "quantity": 5}, {"item_id": 19, "quantity": 1}]', 15, 30, 'rare'),
        -- Эпические рецепты
        ('Снайперка', 'Снайперская винтовка', 13, 1, '[{"item_id": 11, "quantity": 15}, {"item_id": 16, "quantity": 5}, {"item_id": 18, "quantity": 3}]', 25, 120, 'epic'),
        -- Патроны
        ('Патроны', 'Патроны для оружия', 27, 10, '[{"item_id": 11, "quantity": 2}]', 3, 10, 'uncommon')
        ON CONFLICT DO NOTHING;
    `);
    await query(`
        ALTER TABLE achievements ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'survival';
        ALTER TABLE achievements ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common';
    `);
    await query(`
        ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS progress_value INTEGER DEFAULT 0;
        ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN DEFAULT false;
        ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
    `);
    await seedAchievements();
    await seedDatabase();
    logger.info('✓ Таблицы базы данных созданы');
}
async function seedDatabase() {
    const locations = [
        { name: 'Спальный район', description: 'Тихий жилой комплекс на окраине города', radiation: 0, min_luck: 1, danger_level: 1, icon: '🏠', color: '#4CAF50' },
        { name: 'Рынок', description: 'Центральный рынок, кишащий мародёрами', radiation: 5, min_luck: 10, danger_level: 2, icon: '🛒', color: '#FF9800' },
        { name: 'Больница', description: 'Заброшенная больница с радиоактивными очагами', radiation: 15, min_luck: 20, danger_level: 3, icon: '🏥', color: '#E91E63' },
        { name: 'Промзона', description: 'Промышленный район с токсичными отходами', radiation: 30, min_luck: 35, danger_level: 4, icon: '🏭', color: '#9C27B0' },
        { name: 'Центр города', description: 'Сердце мёртвого города', radiation: 50, min_luck: 50, danger_level: 5, icon: '🌆', color: '#F44336' },
        { name: 'Военная база', description: 'Захваченная военная база', radiation: 70, min_luck: 65, danger_level: 6, icon: '🎖️', color: '#607D8B' },
        { name: 'Бункер', description: 'Секретный бункер выживших', radiation: 100, min_luck: 90, danger_level: 7, icon: '🔒', color: '#000000' }
    ];
    for (const loc of locations) {
        await query(`
            INSERT INTO locations (name, description, radiation, min_luck, danger_level, icon, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
        `, [loc.name, loc.description, loc.radiation, loc.min_luck, loc.danger_level, loc.icon, loc.color]);
    }
    const itemSets = [
        { 
            name: 'Военный сет', 
            description: 'Армейская экипировка выжившего', 
            icon: '🎖️',
            bonus_2: { damage: 3, defense: 2 },
            bonus_3: { damage: 7, defense: 5, health: 20 },
            bonus_4: { damage: 15, defense: 10, health: 50, crit_chance: 3 }
        },
        { 
            name: 'Медицинский сет', 
            description: 'Оборудование для выживания', 
            icon: '🏥',
            bonus_2: { health: 15, medicine_effect: 5 },
            bonus_3: { health: 35, medicine_effect: 10, radiation_resist: 5 },
            bonus_4: { health: 75, medicine_effect: 20, radiation_resist: 15, infection_resist: 10 }
        },
        { 
            name: 'Сталкерский сет', 
            description: 'Экипировка для исследования зоны', 
            icon: '🎒',
            bonus_2: { luck: 3, agility: 2 },
            bonus_3: { luck: 7, agility: 5, energy: 10 },
            bonus_4: { luck: 15, agility: 10, energy: 25, radiation_resist: 10 }
        },
        { 
            name: 'Бандитский сет', 
            description: 'Оружие и защита мародёра', 
            icon: '💣',
            bonus_2: { damage: 4, crit_chance: 2 },
            bonus_3: { damage: 9, crit_chance: 5, crit_damage: 10 },
            bonus_4: { damage: 18, crit_chance: 10, crit_damage: 25, pvp_damage: 5 }
        }
    ];
    for (const set of itemSets) {
        await query(`
            INSERT INTO item_sets (name, description, icon, bonus_2, bonus_3, bonus_4)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
        `, [set.name, set.description, set.icon, JSON.stringify(set.bonus_2), JSON.stringify(set.bonus_3), JSON.stringify(set.bonus_4)]);
    }
    const bosses = [
        { name: 'Крысиный король', description: 'Огромная радиоактивная крыса', max_health: 500, reward_experience: 50, reward_coins: 25, icon: '🐀' },
        { name: 'Бездомный псих', description: 'Сумасшедший выживший с монтировкой', max_health: 2000, reward_experience: 100, reward_coins: 50, icon: '🔪' },
        { name: 'Медведь-мутант', description: 'Радиоактивный медведь', max_health: 5000, reward_experience: 200, reward_coins: 100, icon: '🐻' },
        { name: 'Военный дрон', description: 'Боевой дрон с системой охраны', max_health: 10000, reward_experience: 400, reward_coins: 200, icon: '🤖' },
        { name: 'Главарь мародёров', description: 'Лидер банды радиоактивных бандитов', max_health: 20000, reward_experience: 800, reward_coins: 400, icon: '💀' },
        { name: 'Биологический ужас', description: 'Мутировавшее существо из лаборатории', max_health: 40000, reward_experience: 1500, reward_coins: 750, icon: '👾' },
        { name: 'Офицер-нежить', description: 'Бывший военный офицер', max_health: 70000, reward_experience: 3000, reward_coins: 1500, icon: '💂' },
        { name: 'Гигантский монстр', description: 'Колоссальное существо', max_health: 100000, reward_experience: 6000, reward_coins: 3000, icon: '🦖' },
        { name: 'Профессор безумия', description: 'Учёный, сошедший с ума', max_health: 150000, reward_experience: 12000, reward_coins: 6000, icon: '🧑‍🔬' },
        { name: 'Последний страж', description: 'Последний защитник бункера', max_health: 250000, reward_experience: 25000, reward_coins: 12500, icon: '🛡️' }
    ];
    for (let i = 0; i < bosses.length; i++) {
        const boss = bosses[i];
        const requiredKeyId = i > 0 ? i : null;
        await query(`
            INSERT INTO bosses (name, description, max_health, reward_experience, reward_coins, required_key_id, icon)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
        `, [boss.name, boss.description, boss.max_health, boss.reward_experience, boss.reward_coins, requiredKeyId, boss.icon]);
    }
    const items = [
        { name: 'Консервы', description: 'Просроченные консервы', type: 'food', category: 'consumable', rarity: 'common', price: 10, icon: '🥫' },
        { name: 'Вода', description: 'Бутылка чистой воды', type: 'food', category: 'consumable', rarity: 'common', price: 15, icon: '💧' },
        { name: 'Спирт', description: 'Медицинский спирт', type: 'food', category: 'consumable', rarity: 'uncommon', price: 25, icon: '🍺' },
        { name: 'Снеки', description: 'Сухие пайки', type: 'food', category: 'consumable', rarity: 'common', price: 8, icon: '🍪' },
        { name: 'Энергетик', description: 'Баночка энергетика', type: 'food', category: 'consumable', rarity: 'uncommon', price: 20, icon: '⚡' },
        { name: 'Бинт', description: 'Обычный бинт', type: 'medicine', category: 'medicine', rarity: 'common', price: 20, icon: '🩹' },
        { name: 'Аптечка', description: 'Полная аптечка', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 50, icon: '💊' },
        { name: 'Антидот', description: 'Лекарство от инфекций', type: 'medicine', category: 'medicine', rarity: 'rare', price: 100, icon: '💉' },
        { name: 'Антирадин', description: 'Препарат от радиации', type: 'medicine', category: 'medicine', rarity: 'rare', price: 150, icon: '☢️' },
        { name: 'Витамины', description: 'Комплекс витаминов', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 35, icon: '💊' },
        { name: 'Нож', description: 'Простой нож выживания', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', stats: { damage: 5 }, durability: 50, max_durability: 50, price: 30, icon: '🔪' },
        { name: 'Бита', description: 'Бейсбольная бита', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', stats: { damage: 8 }, durability: 30, max_durability: 30, price: 25, icon: '🏏' },
        { name: 'Пистолет', description: 'Травматический пистолет', type: 'weapon', category: 'ranged', rarity: 'uncommon', slot: 'weapon', stats: { damage: 20, ammo: 8 }, durability: 100, max_durability: 100, price: 200, icon: '🔫' },
        { name: 'Автомат', description: 'Автоматическое оружие', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', stats: { damage: 40, ammo: 30 }, durability: 200, max_durability: 200, price: 500, icon: '⚔️' },
        { name: 'Дробовик', description: 'Охотничий дробовик', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', stats: { damage: 60, ammo: 5 }, durability: 150, max_durability: 150, price: 750, icon: '🔫' },
        { name: 'Снайперка', description: 'Снайперская винтовка', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', stats: { damage: 100, ammo: 5 }, durability: 300, max_durability: 300, price: 1500, icon: '🔭' },
        { name: 'Кожаная куртка', description: 'Простая защита', type: 'armor', category: 'body', rarity: 'common', slot: 'body', stats: { defense: 5 }, durability: 50, max_durability: 50, price: 40, icon: '🧥' },
        { name: 'Бронежилет', description: 'Военный бронежилет', type: 'armor', category: 'body', rarity: 'rare', slot: 'body', stats: { defense: 25 }, durability: 150, max_durability: 150, price: 300, icon: '🦺' },
        { name: 'Противогаз', description: 'Защита от радиации', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', stats: { radiation_resist: 15 }, durability: 100, max_durability: 100, price: 100, icon: '😷' },
        { name: 'Армейская каска', description: 'Защита головы', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', stats: { defense: 10 }, durability: 80, max_durability: 80, price: 80, icon: '⛑️' },
        { name: 'Металлолом', description: 'Металлолом для крафта', type: 'resource', category: 'material', rarity: 'common', stackable: true, price: 5, icon: '🔩' },
        { name: 'Древесина', description: 'Дерево для крафта', type: 'resource', category: 'material', rarity: 'common', stackable: true, price: 3, icon: '🪵' },
        { name: 'Ткань', description: 'Ткань для крафта', type: 'resource', category: 'material', rarity: 'common', stackable: true, price: 4, icon: '🧵' },
        { name: 'Пластик', description: 'Пластик для крафта', type: 'resource', category: 'material', rarity: 'uncommon', stackable: true, price: 10, icon: '💳' },
        { name: 'Электроника', description: 'Электронные компоненты', type: 'resource', category: 'material', rarity: 'rare', stackable: true, price: 25, icon: '📟' },
        { name: 'Провода', description: 'Медные провода', type: 'resource', category: 'material', rarity: 'uncommon', stackable: true, price: 15, icon: '〰️' },
        { name: 'Химикаты', description: 'Различные химикаты', type: 'resource', category: 'material', rarity: 'rare', stackable: true, price: 30, icon: '🧪' },
        { name: 'Патроны', description: 'Патроны для оружия', type: 'resource', category: 'ammo', rarity: 'uncommon', stackable: true, price: 20, icon: '📦' },
        { name: 'Ключ от босса', description: 'Ключ для разблокировки босса', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Нейроимплант', description: 'Улучшает реакцию и интеллект', type: 'food', category: 'consumable', rarity: 'epic', price: 500, icon: '🧠' },
        { name: 'Стимулятор', description: 'Мощный допинг', type: 'food', category: 'consumable', rarity: 'epic', price: 600, icon: '💥' },
        { name: 'Нано-аптечка', description: 'Мгновенное лечение', type: 'medicine', category: 'medicine', rarity: 'epic', price: 800, icon: '🏥' },
        { name: 'Радиа-кур', description: 'Полная защита от радиации', type: 'medicine', category: 'medicine', rarity: 'epic', price: 1000, icon: '🛡️' },
        { name: 'Плазменный пистолет', description: 'Экспериментальное оружие', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', stats: { damage: 80, ammo: 12 }, durability: 250, max_durability: 250, price: 2500, icon: '🔮' },
        { name: 'Экзо-костюм', description: 'Тяжёлая броня', type: 'armor', category: 'body', rarity: 'epic', slot: 'body', stats: { defense: 50, radiation_resist: 30 }, durability: 300, max_durability: 300, price: 3000, icon: '🤖' },
        { name: 'Титан', description: 'Редкий металл для крафта', type: 'resource', category: 'material', rarity: 'epic', stackable: true, price: 100, icon: '🔶' },
        { name: 'Уран', description: 'Радиоактивный материал', type: 'resource', category: 'material', rarity: 'epic', stackable: true, price: 150, icon: '☢️' },
        { name: 'Сыворотка мутанта', description: 'Даёт сверхспособности', type: 'food', category: 'consumable', rarity: 'legendary', price: 2000, icon: '🧬' },
        { name: 'Эликсир бессмертия', description: 'Полное воскрешение', type: 'medicine', category: 'medicine', rarity: 'legendary', price: 5000, icon: '⭐' },
        { name: 'Лазерная винтовка', description: 'Оружие из будущего', type: 'weapon', category: 'ranged', rarity: 'legendary', slot: 'weapon', stats: { damage: 150, ammo: 20 }, durability: 500, max_durability: 500, price: 10000, icon: '⚡' },
        { name: 'Броня стражей', description: 'Легендарная броня', type: 'armor', category: 'body', rarity: 'legendary', slot: 'body', stats: { defense: 80, radiation_resist: 50 }, durability: 500, max_durability: 500, price: 15000, icon: '👑' },
        { name: 'Кристалл силы', description: 'Осколок метеорита', type: 'resource', category: 'material', rarity: 'legendary', stackable: true, price: 500, icon: '💎' },
        { name: 'Ядерный элемент', description: 'Сильнейшая энергия', type: 'resource', category: 'material', rarity: 'legendary', stackable: true, price: 1000, icon: '🔥' }
    ];
    for (const item of items) {
        await query(`
            INSERT INTO items (name, description, type, category, rarity, stackable, slot, stats, durability, max_durability, price, icon)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT DO NOTHING
        `, [
            item.name, item.description, item.type, item.category, item.rarity || 'common',
            item.stackable !== false, item.slot || null, JSON.stringify(item.stats || {}),
            item.durability || 100, item.max_durability || 100, item.price, item.icon
        ]);
    }
    logger.info('✓ Начальные данные загружены');
}
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
        await client.query(
            'UPDATE players SET coins = coins - $1, stars = stars - $2 WHERE id = $3',
            [totalPrice, totalStarsPrice, buyer.id]
        );
        await client.query(
            'UPDATE players SET coins = coins + $1 WHERE telegram_id = $2',
            [sellerGets, listing.seller_id]
        );
        const itemData = listing.item_data;
        const inventory = buyer.inventory || {};
        const itemKey = itemData.id.toString();
        if (inventory[itemKey]) {
            inventory[itemKey] += listing.quantity;
        } else {
            inventory[itemKey] = listing.quantity;
        }
        await client.query('UPDATE players SET inventory = $1 WHERE id = $2', [inventory, buyer.id]);
        await client.query(
            `UPDATE market_listings 
             SET status = 'sold', sold_at = NOW() 
             WHERE id = $1`,
            [listingId]
        );
        await client.query(
            `INSERT INTO market_history 
             (listing_id, seller_id, buyer_id, item_id, item_data, quantity, price, stars_price, commission, transaction_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sale')`,
            [listingId, listing.seller_id, buyerId, listing.item_id, listing.item_data, listing.quantity, listing.price, listing.stars_price, commission]
        );
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
    return await tx(async (client) => {
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
        queryText += ` AND item_data->>'type' = ${paramIndex}`;
        params.push(filters.itemType);
        paramIndex++;
    }
    if (filters.search) {
        queryText += ` AND item_data->>'name' ILIKE ${paramIndex}`;
        params.push(`%${filters.search}%`);
        paramIndex++;
    }
    if (filters.minPrice) {
        queryText += ` AND (ml.price * ml.quantity) >= ${paramIndex}`;
        params.push(filters.minPrice);
        paramIndex++;
    }
    if (filters.maxPrice) {
        queryText += ` AND (ml.price * ml.quantity) <= ${paramIndex}`;
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
    queryText += ` LIMIT ${paramIndex}`;
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
/**
 * Устаревшая функция - используйте DebuffAPI из routes/game/debuffs.js
 * Оставлена для обратной совместимости
 * @deprecated
 */
async function addInfection(playerId, infectionType = 'radiation') {
    const player = await queryOne('SELECT infections FROM players WHERE id = $1', [playerId]);
    if (!player) return { success: false, error: 'Игрок не найден' };
    
    // Парсим инфекции (могут быть JSONB строкой или массивом)
    let infections = [];
    if (player.infections) {
        if (typeof player.infections === 'string') {
            try { infections = JSON.parse(player.infections); } catch { infections = []; }
        } else {
            infections = player.infections || [];
        }
    }
    
    // Вычисляем общий уровень инфекций
    const totalInfectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    if (totalInfectionLevel >= 10) {
        return { success: false, error: 'Максимальный уровень инфекций (10) уже достигнут' };
    }
    
    // Проверяем, есть ли уже такая инфекция
    const existingIndex = infections.findIndex(i => i.type === infectionType);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 часов
    
    if (existingIndex >= 0) {
        // Увеличиваем уровень существующей
        infections[existingIndex].level = Math.min(10, (infections[existingIndex].level || 0) + 1);
        infections[existingIndex].expires_at = expiresAt.toISOString();
    } else {
        // Добавляем новую
        infections.push({
            type: infectionType,
            level: 1,
            expires_at: expiresAt.toISOString(),
            applied_at: now.toISOString()
        });
    }
    
    await query(
        'UPDATE players SET infections = $1 WHERE id = $2',
        [JSON.stringify(infections), playerId]
    );
    
    const messages = {
        radiation: '☢️ Радиационная инфекция!',
        zombie: '🧟 Укус зомби!',
        dirty_water: '💧 Инфекция от грязной воды!',
        dirty_food: '🍖 Инфекция от испорченной еды!'
    };
    
    const newTotalLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    return { 
        success: true, 
        message: messages[infectionType] || '🤒 Инфекция получена!',
        infection_level: newTotalLevel
    };
}
/**
 * Устаревшая функция - используйте DebuffAPI из routes/game/debuffs.js
 * @deprecated
 */
async function healInfection(playerId, infectionType = 'all') {
    const player = await queryOne('SELECT infections FROM players WHERE id = $1', [playerId]);
    if (!player) return { success: false, error: 'Игрок не найден' };
    
    // Парсим инфекции
    let infections = [];
    if (player.infections) {
        if (typeof player.infections === 'string') {
            try { infections = JSON.parse(player.infections); } catch { infections = []; }
        } else {
            infections = player.infections || [];
        }
    }
    
    if (infectionType === 'all') {
        await query(
            'UPDATE players SET infections = $1 WHERE id = $2',
            ['[]', playerId]
        );
        return { success: true, message: '💊 Все инфекции излечены!', infection_level: 0 };
    }
    
    const index = infections.findIndex(i => i.type === infectionType);
    if (index === -1) {
        return { success: false, error: 'Такая инфекция не найдена' };
    }
    
    infections.splice(index, 1);
    await query(
        'UPDATE players SET infections = $1 WHERE id = $2',
        [JSON.stringify(infections), playerId]
    );
    
    const newLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    return { success: true, message: '💊 Инфекция излечена!', infection_level: newLevel };
}
/**
 * Устаревшая функция - используйте DebuffAPI из routes/game/debuffs.js
 * @deprecated
 */
async function getInfections(playerId) {
    const player = await queryOne('SELECT infections FROM players WHERE id = $1', [playerId]);
    if (!player) return null;
    
    // Парсим инфекции
    let infections = [];
    if (player.infections) {
        if (typeof player.infections === 'string') {
            try { infections = JSON.parse(player.infections); } catch { infections = []; }
        } else {
            infections = player.infections || [];
        }
    }
    
    const totalLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    return {
        infection_level: totalLevel,
        infections: infections
    };
}
/**
 * Устаревшая функция - используйте DebuffAPI из routes/game/debuffs.js
 * Урон от инфекций теперь рассчитывается в status/check
 * @deprecated
 */
async function processInfections(playerId) {
    const player = await queryOne('SELECT radiation, infections, health FROM players WHERE id = $1', [playerId]);
    if (!player) return null;
    
    // Парсим radiation и infections
    let radiation = { level: 0 };
    if (player.radiation) {
        if (typeof player.radiation === 'object') {
            radiation = player.radiation;
        } else {
            radiation = { level: player.radiation || 0 };
        }
    }
    
    let infections = [];
    if (player.infections) {
        if (typeof player.infections === 'string') {
            try { infections = JSON.parse(player.infections); } catch { infections = []; }
        } else {
            infections = player.infections || [];
        }
    }
    
    const totalInfectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    if (totalInfectionLevel === 0 && radiation.level < 5) return null;
    
    // Урон: инфекции наносят 2 урона за уровень, радиация - 2 урона за уровень при level >= 5
    let damage = 0;
    if (totalInfectionLevel > 0) damage += totalInfectionLevel * 2;
    if (radiation.level >= 5) damage += (radiation.level - 4) * 2;
    
    await query(
        'UPDATE players SET health = GREATEST(0, health - $1) WHERE id = $2',
        [damage, playerId]
    );
    
    return {
        damage: damage,
        new_health: Math.max(0, player.health - damage)
    };
}
async function checkPlayerStatus(playerId) {
    const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
    if (!player) return null;
    
    // Парсим radiation и infections (могут быть JSONB)
    let radiation, infections;
    try {
        radiation = typeof player.radiation === 'object' ? player.radiation : { level: player.radiation || 0 };
    } catch(e) {
        console.error('JSON.parse radiation failed:', player.radiation);
        radiation = { level: player.radiation || 0 };
    }
    try {
        infections = typeof player.infections === 'string' ? JSON.parse(player.infections) : (player.infections || []);
    } catch(e) {
        console.error('JSON.parse infections failed:', player.infections);
        infections = [];
    }
    const totalInfectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    
    return {
        health: player.health,
        max_health: player.max_health,
        energy: player.energy,
        max_energy: player.max_energy,
        radiation: radiation,
        infections: infections,
        is_alive: player.health > 0,
        radiation_death: radiation.level >= 5,
        can_walk: true,
        can_attack: true,
        can_travel: true
    };
}
async function seedAchievements() {
    const survivalAchievements = [
        { name: 'Новичок', description: 'Проведите 1 день в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 1 }), reward: JSON.stringify({ coins: 50, stars: 0 }), icon: '🌅', rarity: 'common' },
        { name: 'Выживший', description: 'Проведите 7 дней в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 7 }), reward: JSON.stringify({ coins: 200, stars: 1 }), icon: '📅', rarity: 'common' },
        { name: 'Опытный выживший', description: 'Проведите 14 дней в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 14 }), reward: JSON.stringify({ coins: 500, stars: 3 }), icon: '⏳', rarity: 'uncommon' },
        { name: 'Мастер выживания', description: 'Проведите 30 дней в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 30 }), reward: JSON.stringify({ coins: 1500, stars: 10 }), icon: '🏆', rarity: 'rare' },
        { name: 'Ветеран пустоши', description: 'Проведите 60 дней в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 60 }), reward: JSON.stringify({ coins: 5000, stars: 25 }), icon: '🎖️', rarity: 'epic' },
        { name: 'Легенда выживания', description: 'Проведите 100 дней в игре', category: 'survival', condition: JSON.stringify({ type: 'days_played', value: 100 }), reward: JSON.stringify({ coins: 15000, stars: 50 }), icon: '👑', rarity: 'legendary' }
    ];
    const bossAchievements = [
        { name: 'Убийца крыс', description: 'Убейте 1 босса', category: 'bosses', condition: JSON.stringify({ type: 'bosses_killed', value: 1 }), reward: JSON.stringify({ coins: 100, stars: 0 }), icon: '🐀', rarity: 'common' },
        { name: 'Охотник на мутантов', description: 'Убейте 5 боссов', category: 'bosses', condition: JSON.stringify({ type: 'bosses_killed', value: 5 }), reward: JSON.stringify({ coins: 500, stars: 3 }), icon: '🎯', rarity: 'uncommon' },
        { name: 'Истребитель тварей', description: 'Убейте 10 боссов', category: 'bosses', condition: JSON.stringify({ type: 'bosses_killed', value: 10 }), reward: JSON.stringify({ coins: 2000, stars: 10 }), icon: '⚔️', rarity: 'rare' },
        { name: 'Повелитель боссов', description: 'Убейте всех 10 боссов', category: 'bosses', condition: JSON.stringify({ type: 'bosses_killed', value: 10 }), reward: JSON.stringify({ coins: 10000, stars: 30 }), icon: '💀', rarity: 'epic' }
    ];
    const pvpAchievements = [
        { name: 'Первая кровь', description: 'Одержите 1 победу в PvP', category: 'pvp', condition: JSON.stringify({ type: 'pvp_wins', value: 1 }), reward: JSON.stringify({ coins: 50, stars: 0 }), icon: '🗡️', rarity: 'common' },
        { name: 'PvP новичок', description: 'Одержите 5 побед в PvP', category: 'pvp', condition: JSON.stringify({ type: 'pvp_wins', value: 5 }), reward: JSON.stringify({ coins: 200, stars: 1 }), icon: '🏃', rarity: 'common' },
        { name: 'Боец', description: 'Одержите 25 побед в PvP', category: 'pvp', condition: JSON.stringify({ type: 'pvp_wins', value: 25 }), reward: JSON.stringify({ coins: 1000, stars: 5 }), icon: '🥊', rarity: 'uncommon' },
        { name: 'PvP мастер', description: 'Одержите 100 побед в PvP', category: 'pvp', condition: JSON.stringify({ type: 'pvp_wins', value: 100 }), reward: JSON.stringify({ coins: 5000, stars: 15 }), icon: '🏅', rarity: 'rare' },
        { name: 'Чемпион арены', description: 'Одержите 500 побед в PvP', category: 'pvp', condition: JSON.stringify({ type: 'pvp_wins', value: 500 }), reward: JSON.stringify({ coins: 20000, stars: 50 }), icon: '👑', rarity: 'legendary' }
    ];
    const craftAchievements = [
        { name: 'Крафтер', description: 'Скрафтите 10 предметов', category: 'craft', condition: JSON.stringify({ type: 'items_crafted', value: 10 }), reward: JSON.stringify({ coins: 100, stars: 0 }), icon: '🔨', rarity: 'common' },
        { name: 'Мастер крафта', description: 'Скрафтите 50 предметов', category: 'craft', condition: JSON.stringify({ type: 'items_crafted', value: 50 }), reward: JSON.stringify({ coins: 500, stars: 3 }), icon: '⚒️', rarity: 'uncommon' },
        { name: 'Изобретатель', description: 'Скрафтите 100 предметов', category: 'craft', condition: JSON.stringify({ type: 'items_crafted', value: 100 }), reward: JSON.stringify({ coins: 1500, stars: 10 }), icon: '🛠️', rarity: 'rare' },
        { name: 'Гений инженерии', description: 'Скрафтите 500 предметов', category: 'craft', condition: JSON.stringify({ type: 'items_crafted', value: 500 }), reward: JSON.stringify({ coins: 10000, stars: 25 }), icon: '💡', rarity: 'epic' }
    ];
    const collectionAchievements = [
        { name: 'Коллекционер', description: 'Соберите 10 уникальных предметов', category: 'collection', condition: JSON.stringify({ type: 'unique_items', value: 10 }), reward: JSON.stringify({ coins: 100, stars: 0 }), icon: '📦', rarity: 'common' },
        { name: 'Собиратель', description: 'Соберите 25 уникальных предметов', category: 'collection', condition: JSON.stringify({ type: 'unique_items', value: 25 }), reward: JSON.stringify({ coins: 500, stars: 3 }), icon: '🎒', rarity: 'uncommon' },
        { name: 'Хранитель сокровищ', description: 'Соберите 50 уникальных предметов', category: 'collection', condition: JSON.stringify({ type: 'unique_items', value: 50 }), reward: JSON.stringify({ coins: 2000, stars: 10 }), icon: '💎', rarity: 'rare' },
        { name: 'Мастер коллекций', description: 'Соберите 100 уникальных предметов', category: 'collection', condition: JSON.stringify({ type: 'unique_items', value: 100 }), reward: JSON.stringify({ coins: 10000, stars: 25 }), icon: '🏆', rarity: 'epic' }
    ];
    const explorationAchievements = [
        { name: 'Путешественник', description: 'Посетите 3 локации', category: 'exploration', condition: JSON.stringify({ type: 'locations_visited', value: 3 }), reward: JSON.stringify({ coins: 100, stars: 0 }), icon: '🗺️', rarity: 'common' },
        { name: 'Исследователь', description: 'Посетите все локации', category: 'exploration', condition: JSON.stringify({ type: 'locations_visited', value: 7 }), reward: JSON.stringify({ coins: 1000, stars: 5 }), icon: '🌍', rarity: 'rare' },
        { name: 'Первооткрыватель', description: 'Посетите все локации 10 раз', category: 'exploration', condition: JSON.stringify({ type: 'locations_visited', value: 70 }), reward: JSON.stringify({ coins: 300, stars: 8 }), icon: '🧭', rarity: 'epic' }
    ];
    const socialAchievements = [
        { name: 'Командный игрок', description: 'Вступите в клан', category: 'social', condition: JSON.stringify({ type: 'in_clan', value: true }), reward: JSON.stringify({ coins: 100, stars: 2 }), icon: '🤝', rarity: 'common' },
        { name: 'Лидер клана', description: 'Станьте лидером клана', category: 'social', condition: JSON.stringify({ type: 'clan_leader', value: true }), reward: JSON.stringify({ coins: 1000, stars: 10 }), icon: '👑', rarity: 'rare' },
        { name: 'Дипломат', description: 'Вступите в 3 разных клана', category: 'social', condition: JSON.stringify({ type: 'clans_joined', value: 3 }), reward: JSON.stringify({ coins: 500, stars: 8 }), icon: '🎭', rarity: 'uncommon' }
    ];
    const allAchievements = [
        ...survivalAchievements,
        ...bossAchievements,
        ...pvpAchievements,
        ...craftAchievements,
        ...collectionAchievements,
        ...explorationAchievements,
        ...socialAchievements
    ];
    for (const ach of allAchievements) {
        await query(`
            INSERT INTO achievements (name, description, category, condition, reward, icon, rarity)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
        `, [ach.name, ach.description, ach.category, ach.condition, ach.reward, ach.icon, ach.rarity]);
    }
    logger.info('✓ Достижения заполнены');
}
async function updateAchievementProgress(playerId, achievementType, value = 1) {
    try {
        const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!player) return;
        const achievements = await queryAll(`
            SELECT * FROM achievements WHERE condition->>'type' = $1
        `, [achievementType]);
        for (const achievement of achievements) {
            let condition;
            try {
                condition = typeof achievement.condition === 'string' 
                    ? JSON.parse(achievement.condition) 
                    : achievement.condition;
            } catch(e) {
                console.error('JSON.parse condition failed:', achievement.condition);
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
            let playerAchievement = await queryOne(`
                SELECT * FROM player_achievements 
                WHERE player_id = $1 AND achievement_id = $2
            `, [playerId, achievement.id]);
            if (!playerAchievement) {
                await query(`
                    INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed)
                    VALUES ($1, $2, $3, $4)
                `, [playerId, achievement.id, currentValue, currentValue >= targetValue]);
            } else if (!playerAchievement.completed && currentValue >= targetValue) {
                await query(`
                    UPDATE player_achievements 
                    SET progress_value = $3, completed = true, completed_at = NOW()
                    WHERE player_id = $1 AND achievement_id = $2
                `, [playerId, achievement.id, currentValue]);
            } else if (!playerAchievement.completed) {
                await query(`
                    UPDATE player_achievements 
                    SET progress_value = $3
                    WHERE player_id = $1 AND achievement_id = $2
                `, [playerId, achievement.id, currentValue]);
            }
        }
    } catch (error) {
        logger.error('Ошибка updateAchievementProgress', { error: error.message, playerId });
    }
}
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
            // Валидация имени колонки для предотвращения SQL-инъекции
            const allowedColumns = ['level_5_bonus', 'level_10_bonus', 'level_20_bonus'];
            if (!allowedColumns.includes(col)) {
                continue; // Пропускаем небезопасные значения
            }
            
            const referral = await queryOne(`SELECT ${col} FROM referrals WHERE referrer_id = $1 AND referred_id = $2`, [referrerTelegramId, referredPlayerId]);
            if (referral && !referral[col]) {
                // Используем параметризованный запрос для безопасности
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
const SEASON_EVENT_TYPES = {
    TREASURE_HUNT: 'treasure_hunt',
    DOUBLE_EXP: 'double_exp',
    PVP_TOURNAMENT: 'pvp_tournament',
    CRAFT_MARATHON: 'craft_marathon',
    RADIATION_STORM: 'radiation_storm',
    BOSS_INVASION: 'boss_invasion',
    TRADE_FESTIVAL: 'trade_festival'
};
const EVENT_MODIFIERS = {
    [SEASON_EVENT_TYPES.TREASURE_HUNT]: {
        drop_multiplier: 2.0,
        rare_drop_bonus: 0.3,
        description: 'Увеличенный дроп с врагов'
    },
    [SEASON_EVENT_TYPES.DOUBLE_EXP]: {
        experience_multiplier: 2.0,
        boss_experience_multiplier: 2.0,
        description: 'Двойной опыт за всё'
    },
    [SEASON_EVENT_TYPES.PVP_TOURNAMENT]: {
        pvp_points_multiplier: 2.0,
        pvp_reward_bonus: 0.5,
        description: 'Двойные очки и награды за PvP'
    },
    [SEASON_EVENT_TYPES.CRAFT_MARATHON]: {
        craft_speed_multiplier: 2.0,
        resource_cost_discount: 0.5,
        description: 'Ускоренный крафт и скидка на ресурсы'
    },
    [SEASON_EVENT_TYPES.RADIATION_STORM]: {
        radiation_multiplier: 2.0,
        radiation_drop_bonus: 1.5,
        rare_radiation_items: true,
        description: 'Повышенная радиация и редкие предметы'
    },
    [SEASON_EVENT_TYPES.BOSS_INVASION]: {
        boss_spawn_rate: 3.0,
        boss_drop_bonus: 2.0,
        boss_experience_multiplier: 2.0,
        description: 'Боссы появляются чаще с увеличенным дропом'
    },
    [SEASON_EVENT_TYPES.TRADE_FESTIVAL]: {
        shop_discount: 0.5,
        market_fee_reduction: 0.5,
        special_items_available: true,
        description: '50% скидка в магазине'
    }
};
async function createSeason(name, description, durationDays = 30) {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);
    const result = await query(
        `INSERT INTO seasons (name, description, start_date, end_date, is_active)
         VALUES ($1, $2, $3, $4, false)
         RETURNING *`,
        [name, description, startDate, endDate]
    );
    return result.rows[0];
}
async function startSeason(seasonId) {
    await query('UPDATE seasons SET is_active = false WHERE is_active = true');
    const result = await query(
        'UPDATE seasons SET is_active = true WHERE id = $1 RETURNING *',
        [seasonId]
    );
    return result.rows[0];
}
async function finishSeason(seasonId) {
    const result = await query(
        'UPDATE seasons SET is_active = false, is_completed = true WHERE id = $1 RETURNING *',
        [seasonId]
    );
    await query(`
        UPDATE season_participants sp
        SET rank = subquery.new_rank
        FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY points DESC) as new_rank
            FROM season_participants
            WHERE season_id = $1
        ) subquery
        WHERE sp.id = subquery.id
    `, [seasonId]);
    return result.rows[0];
}
async function getCurrentSeason() {
    return queryOne(
        'SELECT * FROM seasons WHERE is_active = true ORDER BY start_date DESC LIMIT 1'
    );
}
async function getAllSeasons() {
    return queryAll('SELECT * FROM seasons ORDER BY start_date DESC');
}
async function addSeasonEvent(seasonId, eventType, name, description, durationDays = 7) {
    const modifiers = EVENT_MODIFIERS[eventType] || {};
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);
    const result = await query(
        `INSERT INTO season_events (season_id, event_type, name, description, modifiers, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [seasonId, eventType, name, description, JSON.stringify(modifiers), startDate, endDate]
    );
    return result.rows[0];
}
async function getActiveSeasonEvents() {
    const season = await getCurrentSeason();
    if (!season) return [];
    return queryAll(
        `SELECT * FROM season_events 
         WHERE season_id = $1 AND is_active = true AND start_date <= NOW() AND end_date >= NOW()
         ORDER BY start_date`,
        [season.id]
    );
}
async function getSeasonEvents(seasonId) {
    return queryAll(
        'SELECT * FROM season_events WHERE season_id = $1 ORDER BY start_date',
        [seasonId]
    );
}
async function joinSeason(playerId, seasonId) {
    const result = await query(
        `INSERT INTO season_participants (season_id, player_id, points, rank)
         VALUES ($1, $2, 0, NULL)
         ON CONFLICT (season_id, player_id) DO NOTHING
         RETURNING *`,
        [seasonId, playerId]
    );
    return result.rows[0] || await getSeasonParticipant(playerId, seasonId);
}
async function getSeasonParticipant(playerId, seasonId) {
    return queryOne(
        'SELECT * FROM season_participants WHERE player_id = $1 AND season_id = $2',
        [playerId, seasonId]
    );
}
async function addSeasonPoints(playerId, seasonId, points) {
    await query(
        `UPDATE season_participants 
         SET points = points + $1, last_activity = NOW()
         WHERE player_id = $2 AND season_id = $3`,
        [points, playerId, seasonId]
    );
    return getSeasonParticipant(playerId, seasonId);
}
async function getSeasonRating(seasonId, limit = 100) {
    return queryAll(
        `SELECT sp.*, p.telegram_id, p.username, p.first_name, p.level
         FROM season_participants sp
         JOIN players p ON sp.player_id = p.id
         WHERE sp.season_id = $1
         ORDER BY sp.points DESC
         LIMIT $2`,
        [seasonId, limit]
    );
}
async function getPlayerSeasonRank(playerId, seasonId) {
    const participant = await getSeasonParticipant(playerId, seasonId);
    if (!participant) return null;
    const rankResult = await query(
        `SELECT COUNT(*) as position 
         FROM season_participants 
         WHERE season_id = $1 AND points > $2`,
        [seasonId, participant.points]
    );
    const totalResult = await query(
        'SELECT COUNT(*) as total FROM season_participants WHERE season_id = $1',
        [seasonId]
    );
    return {
        ...participant,
        rank: parseInt(rankResult.rows[0].position) + 1,
        total: parseInt(totalResult.rows[0].total)
    };
}
function getSeasonRankRewards(rank) {
    const rewards = {
        1: { stars: 100, coins: 10000, title: '👑 Чемпион сезона', unique_item: 'crown_of_champion' },
        2: { stars: 75, coins: 7500, title: '🥈 Вице-чемпион', unique_item: 'medal_vice_champion' },
        3: { stars: 50, coins: 5000, title: '🥉 Бронзовый призёр', unique_item: 'medal_bronze' },
        4: { stars: 30, coins: 3000 },
        5: { stars: 25, coins: 2500 },
        6: { stars: 20, coins: 2000 },
        7: { stars: 15, coins: 1500 },
        8: { stars: 12, coins: 1200 },
        9: { stars: 10, coins: 1000 },
        10: { stars: 8, coins: 800 }
    };
    if (rank > 10) {
        const baseStars = Math.max(1, 8 - Math.floor((rank - 10) / 10));
        const baseCoins = Math.max(100, 800 - (rank - 10) * 20);
        return { stars: baseStars, coins: baseCoins };
    }
    return rewards[rank] || { stars: 1, coins: 100 };
}
async function getActiveEventModifiers() {
    const events = await getActiveSeasonEvents();
    const multipliers = ['experience_multiplier', 'drop_multiplier', 'boss_experience_multiplier', 'boss_drop_bonus', 'boss_spawn_rate', 'pvp_points_multiplier', 'craft_speed_multiplier', 'radiation_multiplier', 'radiation_drop_bonus'];
    const additive = ['pvp_reward_bonus', 'resource_cost_discount', 'shop_discount', 'market_fee_reduction'];
    const modifiers = events.reduce((acc, e) => {
        const em = e.modifiers || {};
        multipliers.forEach(k => { if (em[k] > (acc[k] || 1)) acc[k] = em[k]; });
        additive.forEach(k => { if (em[k] > (acc[k] || 0)) acc[k] = em[k]; });
        return acc;
    }, { experience_multiplier: 1, drop_multiplier: 1, boss_experience_multiplier: 1, boss_drop_bonus: 1, boss_spawn_rate: 1, pvp_points_multiplier: 1, pvp_reward_bonus: 0, craft_speed_multiplier: 1, resource_cost_discount: 0, radiation_multiplier: 1, radiation_drop_bonus: 1, shop_discount: 0, market_fee_reduction: 0 });
    return modifiers;
}
const DAILY_TASK_TEMPLATES = [
    { type: 'kill_enemies', target: 10, reward: { coins: 100, exp: 50 }, event_bonus: { [SEASON_EVENT_TYPES.TREASURE_HUNT]: 1.5 } },
    { type: 'kill_enemies', target: 25, reward: { coins: 250, exp: 100 }, event_bonus: { [SEASON_EVENT_TYPES.TREASURE_HUNT]: 1.5 } },
    { type: 'collect_resources', target: 15, reward: { coins: 150, exp: 75 }, event_bonus: { [SEASON_EVENT_TYPES.CRAFT_MARATHON]: 1.5 } },
    { type: 'craft_items', target: 5, reward: { coins: 200, exp: 100 }, event_bonus: { [SEASON_EVENT_TYPES.CRAFT_MARATHON]: 1.5 } },
    { type: 'pvp_battles', target: 3, reward: { coins: 300, exp: 150 }, event_bonus: { [SEASON_EVENT_TYPES.PVP_TOURNAMENT]: 1.5 } },
    { type: 'explore_locations', target: 5, reward: { coins: 100, exp: 50 }, event_bonus: {} },
    { type: 'trade_items', target: 10, reward: { coins: 150, exp: 50 }, event_bonus: { [SEASON_EVENT_TYPES.TRADE_FESTIVAL]: 1.5 } },
    { type: 'boss_kills', target: 1, reward: { coins: 500, exp: 250 }, event_bonus: { [SEASON_EVENT_TYPES.BOSS_INVASION]: 2.0 } }
];
async function createDailyTasks(playerId) {
    const season = await getCurrentSeason();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 1);
    const activeEvents = await getActiveSeasonEvents();
    const activeEventTypes = activeEvents.map(e => e.event_type);
    const shuffled = [...DAILY_TASK_TEMPLATES].sort(() => Math.random() - 0.5);
    const selectedTasks = shuffled.slice(0, 3);
    const createdTasks = [];
    for (const template of selectedTasks) {
        let rewardMultiplier = 1.0;
        for (const eventType of activeEventTypes) {
            if (template.event_bonus[eventType]) {
                rewardMultiplier = Math.max(rewardMultiplier, template.event_bonus[eventType]);
            }
        }
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
const CLAN_BOSS_TEMPLATES = [
    { name: 'Древний мутант', description: 'Монстр из недр земли', icon: '👹', level: 25, health: 5000, damage: 40, exp: 1500, coins: 750, stars: 5 },
    { name: 'Мажор-мутант', description: 'Богатый выживший, сошедший с ума', icon: '💼', level: 35, health: 10000, damage: 70, exp: 3000, coins: 1500, stars: 10 },
    { name: 'Главарь орды', description: 'Лидер армии мародёров', icon: '💀', level: 50, health: 20000, damage: 120, exp: 6000, coins: 3000, stars: 20 },
    { name: 'Мегазомби', description: 'Гигантский зомби', icon: '🧟', level: 65, health: 35000, damage: 180, exp: 10000, coins: 5000, stars: 35 },
    { name: 'Кибер-медведь', description: 'Мутировавший медведь с имплантами', icon: '🐻‍❄️', level: 80, health: 50000, damage: 250, exp: 15000, coins: 7500, stars: 50 },
    { name: 'Бог пустоши', description: 'Практически непобедим', icon: '🌌', level: 100, health: 100000, damage: 400, exp: 30000, coins: 15000, stars: 100 }
];
async function spawnClanBoss(clanId) {
    await query('UPDATE clan_bosses SET is_active = false WHERE clan_id = $1', [clanId]);
    const template = CLAN_BOSS_TEMPLATES[Math.floor(Math.random() * CLAN_BOSS_TEMPLATES.length)];
    const clan = await queryOne('SELECT level FROM clans WHERE id = $1', [clanId]);
    const clanLevel = clan?.level || 1;
    const levelMultiplier = 1 + (clanLevel - 1) * 0.1;
    const health = Math.floor(template.health * levelMultiplier);
    const damage = Math.floor(template.damage * levelMultiplier);
    const exp = Math.floor(template.exp * levelMultiplier);
    const coins = Math.floor(template.coins * levelMultiplier);
    const result = await query(
        `INSERT INTO clan_bosses 
         (clan_id, boss_name, boss_description, boss_icon, boss_level, max_health, current_health, damage, reward_experience, reward_coins, reward_stars, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
         RETURNING *`,
        [clanId, template.name, template.description, template.icon, Math.floor(template.level * levelMultiplier), health, health, damage, exp, coins, template.stars]
    );
    return result.rows[0];
}
async function getClanBoss(clanId) {
    return queryOne(
        'SELECT * FROM clan_bosses WHERE clan_id = $1 AND is_active = true',
        [clanId]
    );
}
async function damageClanBoss(clanId, damage) {
    const boss = await getClanBoss(clanId);
    if (!boss) {
        return { success: false, error: 'Нет активного босса' };
    }
    const newHealth = Math.max(0, boss.current_health - damage);
    await query('UPDATE clan_bosses SET current_health = $1 WHERE id = $2', [newHealth, boss.id]);
    if (newHealth <= 0) {
        await query('UPDATE clan_bosses SET is_active = false, killed_at = NOW() WHERE id = $1', [boss.id]);
        await query('UPDATE clans SET bosses_killed = bosses_killed + 1 WHERE id = $1', [clanId]);
        const members = await queryAll('SELECT id FROM players WHERE clan_id = $1', [clanId]);
        const rewardPerMember = {
            exp: Math.floor(boss.reward_experience / Math.max(1, members.length)),
            coins: Math.floor(boss.reward_coins / Math.max(1, members.length))
        };
        for (const member of members) {
            await query('UPDATE players SET experience = experience + $1, coins = coins + $2 WHERE id = $3', 
                [rewardPerMember.exp, rewardPerMember.coins, member.id]);
        }
        return { 
            success: true, 
            killed: true,
            reward: boss.reward_stars > 0 ? { stars: boss.reward_stars, exp: boss.reward_experience, coins: boss.reward_coins } : { exp: boss.reward_experience, coins: boss.reward_coins },
            members_count: members.length
        };
    }
    return { success: true, killed: false, current_health: newHealth, max_health: boss.max_health };
}
async function getClanBossHistory(clanId, limit = 10) {
    return queryAll(
        'SELECT * FROM clan_bosses WHERE clan_id = $1 AND is_active = false ORDER BY killed_at DESC LIMIT $2',
        [clanId, limit]
    );
}
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
    tx,
    queryForUpdate,
    initDatabase,
    getRankByLevel,
    updateAchievementProgress,
    addInfection,
    healInfection,
    getInfections,
    processInfections,
    checkPlayerStatus,
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
    SEASON_EVENT_TYPES,
    EVENT_MODIFIERS,
    createSeason,
    startSeason,
    finishSeason,
    getCurrentSeason,
    getAllSeasons,
    addSeasonEvent,
    getActiveSeasonEvents,
    getSeasonEvents,
    joinSeason,
    getSeasonParticipant,
    addSeasonPoints,
    getSeasonRating,
    getPlayerSeasonRank,
    getSeasonRankRewards,
    getActiveEventModifiers,
    DAILY_TASK_TEMPLATES,
    createDailyTasks,
    getDailyTasks,
    updateDailyTaskProgress,
    claimDailyTaskReward,
    spawnClanBoss,
    getClanBoss,
    damageClanBoss,
    getClanBossHistory,
    closePool
};

// Запуск миграции при прямом выполнении: node db/database.js
if (require.main === module) {
    (async () => {
        try {
            console.log('🚀 Запуск миграции базы данных...');
            await initDatabase();
            console.log('✅ Миграция завершена');
            process.exit(0);
        } catch (error) {
            console.error('❌ Ошибка миграции:', error);
            process.exit(1);
        }
    })();
}
