/**
 * Схема базы данных - все CREATE TABLE
 */

const { query } = require('./database');

/**
 * Создание всех таблиц
 */
async function createTables() {
    // Основные таблицы
    await query(`
        CREATE TABLE IF NOT EXISTS players (
            id SERIAL PRIMARY KEY,
            telegram_id VARCHAR(50) UNIQUE NOT NULL,
            username VARCHAR(255),
            first_name VARCHAR(255),
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 100,
            stars INTEGER DEFAULT 0,
            inventory JSONB DEFAULT '[]',
            equipment JSONB DEFAULT '{}',
            
            -- Статы
            strength INTEGER DEFAULT 5,
            endurance INTEGER DEFAULT 5,
            agility INTEGER DEFAULT 5,
            intelligence INTEGER DEFAULT 5,
            luck INTEGER DEFAULT 5,
            crafting INTEGER DEFAULT 1,
            
            -- Состояние
            health INTEGER DEFAULT 100,
            max_health INTEGER DEFAULT 100,
            -- hunger/thirst удалены в миграции дебаффов
            radiation JSONB DEFAULT '{"level": 0}',
            fatigue INTEGER DEFAULT 0,
            energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,
            -- infection_count удалён, используется infections JSONB
            infections JSONB DEFAULT '[]',
            -- broken_bones, broken_leg, broken_arm удалены в миграции
            
            -- Локация
            current_location_id INTEGER DEFAULT 1,
            
            -- База
            base JSONB DEFAULT '{}',
            max_inventory INTEGER DEFAULT 30,
            
            -- Клан
            clan_id INTEGER,
            clan_role VARCHAR(50),
            clan_donated INTEGER DEFAULT 0,
            
            -- Рефералы
            referral_code VARCHAR(20),
            referred_by INTEGER,
            referrals_used INTEGER DEFAULT 0,
            referral_bonus_claimed BOOLEAN DEFAULT false,
            
            -- PvP
            pvp_wins INTEGER DEFAULT 0,
            pvp_losses INTEGER DEFAULT 0,
            pvp_damage_dealt INTEGER DEFAULT 0,
            pvp_damage_taken INTEGER DEFAULT 0,
            
            -- Статистика
            total_actions INTEGER DEFAULT 0,
            bosses_killed INTEGER DEFAULT 0,
            days_played INTEGER DEFAULT 1,
            last_action_time TIMESTAMP DEFAULT NOW(),
            last_energy_update TIMESTAMP DEFAULT NOW(),
            
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Локации
    await query(`
        CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            radiation INTEGER DEFAULT 0,
            required_luck INTEGER DEFAULT 0,
            is_red_zone BOOLEAN DEFAULT false,
            loot_table JSONB DEFAULT '[]'
        )
    `);

    // Наборы предметов
    await query(`
        CREATE TABLE IF NOT EXISTS item_sets (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            bonus_2 JSONB DEFAULT '{}',
            bonus_3 JSONB DEFAULT '{}',
            bonus_4 JSONB DEFAULT '{}'
        )
    `);

    // Предметы
    await query(`
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            type VARCHAR(50) NOT NULL,
            rarity VARCHAR(20) DEFAULT 'common',
            damage INTEGER DEFAULT 0,
            defense INTEGER DEFAULT 0,
            description TEXT,
            set_id INTEGER REFERENCES item_sets(id)
        )
    `);

    // Боссы
    await query(`
        CREATE TABLE IF NOT EXISTS bosses (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            hp INTEGER DEFAULT 100,
            max_hp INTEGER DEFAULT 100,
            reward_coins INTEGER DEFAULT 0,
            reward_exp INTEGER DEFAULT 0,
            reward_items JSONB DEFAULT '[]'
        )
    `);

    // Ключи боссов
    await query(`
        CREATE TABLE IF NOT EXISTS boss_keys (
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            quantity INTEGER DEFAULT 0,
            PRIMARY KEY (player_id, boss_id)
        )
    `);

    // Сессии боссов (для рейдов)
    await query(`
        CREATE TABLE IF NOT EXISTS boss_sessions (
            id SERIAL PRIMARY KEY,
            boss_id INTEGER REFERENCES bosses(id),
            hp INTEGER DEFAULT 0,
            max_hp INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP
        )
    `);

    // Прогресс рейда
    await query(`
        CREATE TABLE IF NOT EXISTS raid_progress (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES boss_sessions(id),
            player_id INTEGER REFERENCES players(id),
            damage INTEGER DEFAULT 0,
            UNIQUE(session_id, player_id)
        )
    `);

    // Кланы
    await query(`
        CREATE TABLE IF NOT EXISTS clans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            leader_id VARCHAR(50),
            total_donated INTEGER DEFAULT 0,
            is_open BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Сообщения кланового чата
    await query(`
        CREATE TABLE IF NOT EXISTS clan_messages (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id),
            player_id INTEGER REFERENCES players(id),
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Клановые боссы
    await query(`
        CREATE TABLE IF NOT EXISTS clan_bosses (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id),
            hp INTEGER DEFAULT 0,
            max_hp INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP
        )
    `);

    // Рынок
    await query(`
        CREATE TABLE IF NOT EXISTS market_listings (
            id SERIAL PRIMARY KEY,
            seller_id INTEGER REFERENCES players(id),
            buyer_id INTEGER REFERENCES players(id),
            item_data JSONB,
            item_type VARCHAR(50),
            item_rarity VARCHAR(20),
            price INTEGER NOT NULL,
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            sold_at TIMESTAMP
        )
    `);

    // Сезоны
    await query(`
        CREATE TABLE IF NOT EXISTS seasons (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            start_date TIMESTAMP,
            end_date TIMESTAMP,
            is_active BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Участники сезонов
    await query(`
        CREATE TABLE IF NOT EXISTS season_participants (
            season_id INTEGER REFERENCES seasons(id),
            player_id INTEGER REFERENCES players(id),
            points INTEGER DEFAULT 0,
            rank INTEGER,
            joined_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (season_id, player_id)
        )
    `);

    // События сезонов
    await query(`
        CREATE TABLE IF NOT EXISTS season_events (
            id SERIAL PRIMARY KEY,
            season_id INTEGER REFERENCES seasons(id),
            name VARCHAR(100) NOT NULL,
            description TEXT,
            event_type VARCHAR(50),
            target_value INTEGER,
            reward_type VARCHAR(50),
            reward_value INTEGER,
            reward_data JSONB,
            start_date TIMESTAMP,
            end_date TIMESTAMP
        )
    `);

    // Награды сезонов
    await query(`
        CREATE TABLE IF NOT EXISTS season_rewards (
            id SERIAL PRIMARY KEY,
            season_id INTEGER REFERENCES seasons(id),
            rank_from INTEGER,
            rank_to INTEGER,
            reward_type VARCHAR(50),
            reward_value INTEGER,
            reward_data JSONB
        )
    `);

    // Полученные награды сезонов
    await query(`
        CREATE TABLE IF NOT EXISTS season_rewards_claimed (
            player_id INTEGER REFERENCES players(id),
            reward_id INTEGER REFERENCES season_rewards(id),
            claimed_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (player_id, reward_id)
        )
    `);

    // Ежедневные задания
    await query(`
        CREATE TABLE IF NOT EXISTS daily_tasks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            task_type VARCHAR(50),
            target INTEGER,
            reward_type VARCHAR(50),
            reward_value INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Прогресс ежедневных заданий
    await query(`
        CREATE TABLE IF NOT EXISTS daily_task_progress (
            player_id INTEGER REFERENCES players(id),
            task_id INTEGER REFERENCES daily_tasks(id),
            progress INTEGER DEFAULT 0,
            claimed BOOLEAN DEFAULT false,
            updated_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (player_id, task_id)
        )
    `);

    // Рецепты крафта
    await query(`
        CREATE TABLE IF NOT EXISTS crafting_recipes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            requirements JSONB NOT NULL,
            difficulty INTEGER DEFAULT 1,
            success_chance INTEGER DEFAULT 100,
            result_item_id VARCHAR(50),
            result_item_name VARCHAR(100),
            result_item_type VARCHAR(50),
            result_item_damage INTEGER,
            result_item_defense INTEGER,
            result_item_rarity VARCHAR(20),
            result_item_set_id INTEGER,
            building_required VARCHAR(50)
        )
    `);

    // Магазин
    await query(`
        CREATE TABLE IF NOT EXISTS shop_items (
            id SERIAL PRIMARY KEY,
            item_id VARCHAR(50) NOT NULL,
            item_name VARCHAR(100) NOT NULL,
            item_type VARCHAR(50),
            item_damage INTEGER,
            item_defense INTEGER,
            item_rarity VARCHAR(20),
            price_coins INTEGER,
            price_stars INTEGER,
            description TEXT
        )
    `);

    console.log('✓ Таблицы БД созданы');
}

module.exports = { createTables };
