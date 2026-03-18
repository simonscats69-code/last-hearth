/**
 * Схема базы данных - единственный источник правды по DDL
 * Все CREATE TABLE, INDEX, ALTER TABLE здесь
 */

const { query } = require('./database');

/**
 * Создание всех таблиц
 */
async function createTables() {
    // Таблица игроков
    await query(`
        CREATE TABLE IF NOT EXISTS players (
            id SERIAL PRIMARY KEY,
            telegram_id BIGINT UNIQUE NOT NULL,
            username VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            strength INTEGER DEFAULT 1,
            endurance INTEGER DEFAULT 1,
            agility INTEGER DEFAULT 1,
            intelligence INTEGER DEFAULT 1,
            luck INTEGER DEFAULT 1,
            crafting INTEGER DEFAULT 1,
            health INTEGER DEFAULT 100,
            max_health INTEGER DEFAULT 100,
            radiation JSONB DEFAULT '{"level": 0}',
            fatigue INTEGER DEFAULT 0,
            energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,
            infections JSONB DEFAULT '[]',
            current_location_id INTEGER DEFAULT 1,
            inventory JSONB DEFAULT '{}',
            equipment JSONB DEFAULT '{}',
            coins INTEGER DEFAULT 0,
            stars INTEGER DEFAULT 0,
            base JSONB DEFAULT '{"level": 1, "buildings": [], "storage": {}}',
            clan_id INTEGER,
            clan_role VARCHAR(50) DEFAULT 'member',
            total_actions INTEGER DEFAULT 0,
            bosses_killed INTEGER DEFAULT 0,
            days_played INTEGER DEFAULT 1,
            last_energy_update TIMESTAMP DEFAULT NOW(),
            last_action_time TIMESTAMP DEFAULT NOW(),
            last_daily_bonus TIMESTAMP,
            daily_streak INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            pvp_wins INTEGER DEFAULT 0,
            pvp_losses INTEGER DEFAULT 0,
            pvp_draws INTEGER DEFAULT 0,
            pvp_streak INTEGER DEFAULT 0,
            pvp_max_streak INTEGER DEFAULT 0,
            pvp_rating INTEGER DEFAULT 1000,
            pvp_total_damage_dealt INTEGER DEFAULT 0,
            pvp_total_damage_taken INTEGER DEFAULT 0,
            coins_stolen_from_me INTEGER DEFAULT 0,
            items_stolen_from_me INTEGER DEFAULT 0,
            broken_leg BOOLEAN DEFAULT false,
            broken_arm BOOLEAN DEFAULT false,
            infection_count INTEGER DEFAULT 0,
            radiation_poisoning BOOLEAN DEFAULT false,
            items_crafted INTEGER DEFAULT 0,
            unique_items JSONB DEFAULT '[]',
            locations_visited JSONB DEFAULT '[]',
            clans_joined INTEGER DEFAULT 0,
            referral_code VARCHAR(20),
            referral_code_changed BOOLEAN DEFAULT false,
            referred_by INTEGER,
            referral_bonus_claimed BOOLEAN DEFAULT false,
            clan_donated INTEGER DEFAULT 0
        );
    `);

    // Миграция: добавить active_boss_id если не существует
    // Примечание: эта миграция перенесена после создания таблицы bosses
    // и выполняется в runMigrations()

    // Таблица локаций
    await query(`
        CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            radiation INTEGER DEFAULT 0,
            min_luck INTEGER DEFAULT 0,
            danger_level INTEGER DEFAULT 1,
            loot_table JSONB DEFAULT '[]',
            is_available BOOLEAN DEFAULT true,
            icon VARCHAR(50),
            color VARCHAR(20)
        );
    `);

    // Таблица сетов предметов
    await query(`
        CREATE TABLE IF NOT EXISTS item_sets (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            icon VARCHAR(50),
            bonus_2 JSONB DEFAULT '{"health": 10, "damage": 2}',
            bonus_3 JSONB DEFAULT '{"health": 25, "damage": 5, "crit_chance": 2}',
            bonus_4 JSONB DEFAULT '{"health": 50, "damage": 10, "crit_chance": 5, "crit_damage": 10}'
        );
    `);

    // Таблица предметов
    await query(`
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            type VARCHAR(50) NOT NULL,
            category VARCHAR(50),
            rarity VARCHAR(20) DEFAULT 'common',
            stackable BOOLEAN DEFAULT true,
            max_stack INTEGER DEFAULT 99,
            effects JSONB DEFAULT '{}',
            slot VARCHAR(50),
            stats JSONB DEFAULT '{}',
            durability INTEGER DEFAULT 100,
            max_durability INTEGER DEFAULT 100,
            set_id INTEGER REFERENCES item_sets(id),
            piece_number INTEGER DEFAULT 0,
            upgrade_level INTEGER DEFAULT 0,
            max_upgrade_level INTEGER DEFAULT 10,
            modifications JSONB DEFAULT '[]',
            craftable BOOLEAN DEFAULT false,
            recipe JSONB,
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            icon VARCHAR(50),
            image_url VARCHAR(500),
            UNIQUE(name, type)
        );
    `);

    // Связь предметов с сетами
    await query(`
        CREATE TABLE IF NOT EXISTS item_set_items (
            id SERIAL PRIMARY KEY,
            set_id INTEGER REFERENCES item_sets(id),
            item_id INTEGER REFERENCES items(id),
            piece_number INTEGER DEFAULT 1,
            UNIQUE(set_id, item_id)
        );
    `);

    // Таблица боссов
    await query(`
        CREATE TABLE IF NOT EXISTS bosses (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            level INTEGER NOT NULL DEFAULT 1,
            max_health INTEGER NOT NULL DEFAULT 100,
            damage INTEGER NOT NULL DEFAULT 10,
            reward_experience INTEGER DEFAULT 100,
            reward_coins INTEGER DEFAULT 50,
            reward_items JSONB DEFAULT '[]',
            key_drop_chance REAL DEFAULT 0.5,
            required_key_id INTEGER,
            keys_required INTEGER DEFAULT 1,
            is_group_boss BOOLEAN DEFAULT false,
            min_clan_level INTEGER DEFAULT 1,
            icon VARCHAR(50),
            image_url VARCHAR(500)
        );
    `);

    // Таблица кланов
    await query(`
        CREATE TABLE IF NOT EXISTS clans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            leader_id BIGINT NOT NULL,
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 0,
            is_public BOOLEAN DEFAULT true,
            is_open BOOLEAN DEFAULT true,
            invite_code VARCHAR(20) UNIQUE,
            total_members INTEGER DEFAULT 1,
            bosses_killed INTEGER DEFAULT 0,
            loot_bonus INTEGER DEFAULT 0,
            total_donated INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // Таблица чата клана
    await query(`
        CREATE TABLE IF NOT EXISTS clan_chat (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
            player_id BIGINT NOT NULL,
            player_name VARCHAR(255),
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // Таблица заявок в клан
    await query(`
        CREATE TABLE IF NOT EXISTS clan_applications (
            id SERIAL PRIMARY KEY,
            clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
            player_id BIGINT NOT NULL,
            player_name VARCHAR(255),
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(clan_id, player_id)
        );
    `);

    // Таблица ключей от боссов
    await query(`
        CREATE TABLE IF NOT EXISTS boss_keys (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            quantity INTEGER DEFAULT 1,
            obtained_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, boss_id)
        );
    `);

    // Таблица мастерства боссов
    await query(`
        CREATE TABLE IF NOT EXISTS boss_mastery (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            kills INTEGER DEFAULT 0,
            last_killed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, boss_id)
        );
    `);
    
    // Таблица прогресса боя с боссом (для одиночной игры)
    // Оптимизация: добавлено поле mastery_cache для кэширования мастерства
    await query(`
        CREATE TABLE IF NOT EXISTS player_boss_progress (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            boss_id INTEGER REFERENCES bosses(id),
            current_hp INTEGER NOT NULL,
            max_hp INTEGER NOT NULL,
            last_attack TIMESTAMP DEFAULT NOW(),
            started_at TIMESTAMP DEFAULT NOW(),
            mastery_cache JSONB DEFAULT '{}',
            UNIQUE(player_id, boss_id)
        );
    `);

    // Миграция: добавить mastery_cache если не существует
    await query(`
        DO $do$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'player_boss_progress' AND column_name = 'mastery_cache') THEN
                ALTER TABLE player_boss_progress ADD COLUMN mastery_cache JSONB DEFAULT '{}';
            END IF;
        END $do$
    `);

    // Таблица сессий рейдовых боссов
    await query(`
        CREATE TABLE IF NOT EXISTS boss_sessions (
            id SERIAL PRIMARY KEY,
            boss_id INTEGER REFERENCES bosses(id),
            player_id INTEGER REFERENCES players(id),
            raid_id INTEGER,
            damage_dealt INTEGER DEFAULT 0,
            rewards_earned BOOLEAN DEFAULT false,
            joined_at TIMESTAMP DEFAULT NOW(),
            last_hit_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(boss_id, player_id)
        );
    `);

    // Таблица прогресса рейда
    await query(`
        CREATE TABLE IF NOT EXISTS raid_progress (
            id SERIAL PRIMARY KEY,
            boss_id INTEGER REFERENCES bosses(id),
            current_health INTEGER NOT NULL,
            max_health INTEGER NOT NULL,
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            is_active BOOLEAN DEFAULT true,
            is_raid BOOLEAN DEFAULT false,
            leader_id INTEGER REFERENCES players(id),
            leader_name VARCHAR(255),
            is_clan_raid BOOLEAN DEFAULT false,
            clan_id INTEGER REFERENCES clans(id),
            UNIQUE(boss_id, is_active)
        );
    `);

    // Миграция: добавить leader_id если не существует
    await query(`
        DO $do$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'raid_progress' AND column_name = 'leader_id') THEN
                ALTER TABLE raid_progress ADD COLUMN leader_id INTEGER REFERENCES players(id);
            END IF;
        END $do$
    `);

    // Таблица достижений
    await query(`
        CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            category VARCHAR(50) NOT NULL DEFAULT 'survival',
            condition JSONB NOT NULL,
            reward JSONB DEFAULT '{"coins": 0, "stars": 0}',
            icon VARCHAR(50),
            rarity VARCHAR(20) DEFAULT 'common',
            UNIQUE(name, category)
        );
    `);

    // Таблица прогресса игрока в достижениях
    await query(`
        CREATE TABLE IF NOT EXISTS player_achievements (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id),
            achievement_id INTEGER REFERENCES achievements(id),
            progress JSONB DEFAULT '{}',
            progress_value INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT false,
            completed_at TIMESTAMP,
            reward_claimed BOOLEAN DEFAULT false,
            claimed_at TIMESTAMP,
            UNIQUE(player_id, achievement_id)
        );
    `);

    // Достижения боссов - начальные достижения
    // Оптимизация: добавляем только если таблица пуста
    await query(`
        INSERT INTO achievements (name, description, category, condition, reward, icon, rarity) 
        SELECT 
            'Первое убийство', 
            'Убить босса впервые', 
            'bosses', 
            '{"type": "first_boss_kill"}', 
            '{"coins": 100, "stars": 0}', 
            '🎯', 
            'common'
        WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'Первое убийство');
    `);

    await query(`
        INSERT INTO achievements (name, description, category, condition, reward, icon, rarity) 
        SELECT 
            'Охотник на боссов', 
            'Убить 10 боссов', 
            'bosses', 
            '{"type": "bosses_killed", "count": 10}', 
            '{"coins": 500, "stars": 2}', 
            '🏅', 
            'uncommon'
        WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'Охотник на боссов');
    `);

    await query(`
        INSERT INTO achievements (name, description, category, condition, reward, icon, rarity) 
        SELECT 
            'Мастер боссов', 
            'Убить босса 50 раз', 
            'bosses', 
            '{"type": "single_boss_kills", "count": 50}', 
            '{"coins": 2000, "stars": 10}', 
            '👑', 
            'epic'
        WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'Мастер боссов');
    `);

    await query(`
        INSERT INTO achievements (name, description, category, condition, reward, icon, rarity) 
        SELECT 
            'Доминатор', 
            'Убить всех боссов', 
            'bosses', 
            '{"type": "all_bosses_killed"}', 
            '{"coins": 10000, "stars": 50}', 
            '💀', 
            'legendary'
        WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = 'Доминатор');
    `);

    // Таблица ежедневных заданий
    await query(`
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
    `);

    // Таблица клановых боссов
    await query(`
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
    `);

    // Таблица рефералов
    await query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER NOT NULL,
            referred_id INTEGER NOT NULL,
            bonus_claimed BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW(),
            level_5_bonus BOOLEAN DEFAULT false,
            level_10_bonus BOOLEAN DEFAULT false,
            level_20_bonus BOOLEAN DEFAULT false,
            level_5_bonus_claimed_at TIMESTAMP,
            level_10_bonus_claimed_at TIMESTAMP,
            level_20_bonus_claimed_at TIMESTAMP,
            UNIQUE(referred_id)
        );
    `);

    // Таблица рынка/барахолки
    await query(`
        CREATE TABLE IF NOT EXISTS market_listings (
            id SERIAL PRIMARY KEY,
            seller_id BIGINT NOT NULL,
            item_id INTEGER REFERENCES items(id),
            item_data JSONB NOT NULL,
            quantity INTEGER DEFAULT 1,
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            views INTEGER DEFAULT 0,
            times_renewed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP,
            sold_at TIMESTAMP
        );
    `);

    // Таблица истории сделок рынка
    await query(`
        CREATE TABLE IF NOT EXISTS market_history (
            id SERIAL PRIMARY KEY,
            listing_id INTEGER,
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
    `);

    // Таблица PvP матчей
    await query(`
        CREATE TABLE IF NOT EXISTS pvp_matches (
            id SERIAL PRIMARY KEY,
            attacker_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            defender_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            location_id INTEGER REFERENCES locations(id),
            winner_id INTEGER REFERENCES players(id),
            loser_id INTEGER REFERENCES players(id),
            is_draw BOOLEAN DEFAULT false,
            coins_stolen INTEGER DEFAULT 0,
            items_stolen JSONB DEFAULT '[]',
            experience_gained INTEGER DEFAULT 0,
            attacker_damage_dealt INTEGER DEFAULT 0,
            attacker_damage_taken INTEGER DEFAULT 0,
            defender_damage_dealt INTEGER DEFAULT 0,
            defender_damage_taken INTEGER DEFAULT 0,
            total_hits INTEGER DEFAULT 0,
            battle_duration INTEGER DEFAULT 0,
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // Таблица PvP кулдаунов
    await query(`
        CREATE TABLE IF NOT EXISTS pvp_cooldowns (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            cooldown_type VARCHAR(50) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            reason TEXT,
            UNIQUE(player_id, cooldown_type)
        );
    `);

    // Таблица зданий
    await query(`
        CREATE TABLE IF NOT EXISTS buildings (
            id SERIAL PRIMARY KEY,
            code VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            type VARCHAR(50) NOT NULL,
            max_level INTEGER DEFAULT 10,
            base_cost_coins INTEGER DEFAULT 100,
            base_cost_resources JSONB DEFAULT '{}',
            bonuses JSONB DEFAULT '[]',
            icon VARCHAR(50),
            color VARCHAR(20),
            required_level INTEGER DEFAULT 1,
            required_building_code VARCHAR(50)
        );
    `);

    // Таблица построек игроков
    await query(`
        CREATE TABLE IF NOT EXISTS player_buildings (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            building_code VARCHAR(50) NOT NULL,
            level INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT true,
            built_at TIMESTAMP DEFAULT NOW(),
            last_upgraded_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, building_code)
        );
    `);

    // Таблица рецептов крафта
    await query(`
        CREATE TABLE IF NOT EXISTS crafting_recipes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            result_item_id INTEGER REFERENCES items(id),
            result_quantity INTEGER DEFAULT 1,
            ingredients JSONB NOT NULL,
            required_level INTEGER DEFAULT 1,
            required_base_building VARCHAR(50),
            craft_time INTEGER DEFAULT 5,
            rarity VARCHAR(20) DEFAULT 'common',
            UNIQUE(name, result_item_id)
        );
    `);

    // Создание индексов для players
    await query(`CREATE INDEX IF NOT EXISTS idx_players_telegram_id ON players(telegram_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_clan_id ON players(clan_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_coins ON players(coins DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_last_action ON players(last_action_time)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_daily_bonus ON players(last_daily_bonus)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_referral_code ON players(referral_code)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_players_referred_by ON players(referred_by)`);

    // Индексы для boss_keys
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_keys_player ON boss_keys(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_keys_boss ON boss_keys(boss_id)`);

    // Индексы для daily_tasks
    await query(`CREATE INDEX IF NOT EXISTS idx_daily_tasks_player ON daily_tasks(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_daily_tasks_expires ON daily_tasks(expires_at)`);

    // Индексы для clan_chat
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_chat_clan ON clan_chat(clan_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_chat_created ON clan_chat(created_at DESC)`);

    // Индексы для clan_applications
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_applications_clan ON clan_applications(clan_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_applications_player ON clan_applications(player_id)`);

    // Индексы для market_listings
    await query(`CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_market_listings_expires ON market_listings(expires_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_market_listings_item_type ON market_listings((item_data->>'type'))`);

    // Индексы для market_history
    await query(`CREATE INDEX IF NOT EXISTS idx_market_history_buyer ON market_history(buyer_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_market_history_seller ON market_history(seller_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_market_history_created ON market_history(created_at DESC)`);

    // Индексы для pvp_matches
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_defender ON pvp_matches(defender_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_winner ON pvp_matches(winner_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_location ON pvp_matches(location_id)`);

    // Индексы для pvp_cooldowns
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_player ON pvp_cooldowns(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_expires ON pvp_cooldowns(expires_at)`);

    // Индексы для player_buildings
    await query(`CREATE INDEX IF NOT EXISTS idx_player_buildings_player ON player_buildings(player_id)`);

    // Индексы для player_boss_progress
    await query(`CREATE INDEX IF NOT EXISTS idx_player_boss_progress_player ON player_boss_progress(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_player_boss_progress_boss ON player_boss_progress(boss_id)`);

    // Индексы для boss_mastery
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_mastery_player ON boss_mastery(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_mastery_boss ON boss_mastery(boss_id)`);

    // Индексы для player_achievements
    await query(`CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_player_achievements_achievement ON player_achievements(achievement_id)`);

    // Индексы для referrals
    await query(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id)`);

    // Foreign key для referrer_id
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'referrals' AND column_name = 'referrer_id' AND data_type = 'integer'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'fk_referrals_referrer'
            ) THEN
                ALTER TABLE referrals ADD CONSTRAINT fk_referrals_referrer
                FOREIGN KEY (referrer_id) REFERENCES players(id) ON DELETE CASCADE;
            END IF;
        END $do$
    `);

    // Foreign key для referred_id
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'referrals' AND column_name = 'referred_id' AND data_type = 'integer'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'fk_referrals_referred'
            ) THEN
                ALTER TABLE referrals ADD CONSTRAINT fk_referrals_referred
                FOREIGN KEY (referred_id) REFERENCES players(id) ON DELETE CASCADE;
            END IF;
        END $do$
    `);

    // Индексы для raid_progress
    await query(`CREATE INDEX IF NOT EXISTS idx_raid_progress_boss ON raid_progress(boss_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_raid_progress_active ON raid_progress(is_active) WHERE is_active = true`);

    // Индексы для boss_sessions
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_sessions_boss ON boss_sessions(boss_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_sessions_player ON boss_sessions(player_id)`);

    // Индексы для clan_bosses
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_bosses_clan ON clan_bosses(clan_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_clan_bosses_active ON clan_bosses(is_active) WHERE is_active = true`);
}

/**
 * Миграции - добавление колонок в существующие таблицы
 */
async function runMigrations() {
    // Миграция: добавить active_boss_id после создания таблицы bosses
    await query(`
        DO $do$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'players' AND column_name = 'active_boss_id') THEN
                ALTER TABLE players ADD COLUMN active_boss_id INTEGER REFERENCES bosses(id);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'players' AND column_name = 'active_boss_started_at') THEN
                ALTER TABLE players ADD COLUMN active_boss_started_at TIMESTAMP;
            END IF;
        END $do$
    `);

    // Миграции для players - клановые поля
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS clan_donated INTEGER DEFAULT 0`);

    // Миграции для bosses - доводим старые инсталляции до актуальной схемы
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS max_health INTEGER DEFAULT 100`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS damage INTEGER DEFAULT 10`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS reward_experience INTEGER DEFAULT 100`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS reward_coins INTEGER DEFAULT 50`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS reward_items JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS key_drop_chance REAL DEFAULT 0.5`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS required_key_id INTEGER`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS keys_required INTEGER DEFAULT 1`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS is_group_boss BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS min_clan_level INTEGER DEFAULT 1`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS icon VARCHAR(50)`);
    await query(`ALTER TABLE bosses ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`);

    // Миграции для clans - поля уже используются API и фронтендом
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS experience INTEGER DEFAULT 0`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT true`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20)`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS total_members INTEGER DEFAULT 1`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS bosses_killed INTEGER DEFAULT 0`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS loot_bonus INTEGER DEFAULT 0`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS total_donated INTEGER DEFAULT 0`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    // Миграция: добавить FK для boss_sessions.raid_id после создания raid_progress
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'boss_sessions' AND column_name = 'raid_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_boss_sessions_raid'
            ) THEN
                ALTER TABLE boss_sessions
                ADD CONSTRAINT fk_boss_sessions_raid
                FOREIGN KEY (raid_id) REFERENCES raid_progress(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);

    // Миграции для players - метки времени
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    // Миграции для PvP
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_wins INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_losses INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_draws INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_streak INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_max_streak INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_rating INTEGER DEFAULT 1000`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_total_damage_dealt INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_total_damage_taken INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS coins_stolen_from_me INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS items_stolen_from_me INTEGER DEFAULT 0`);

    // Миграции для дебаффов
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS broken_leg BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS broken_arm BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS infection_count INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS infections JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS radiation_poisoning BOOLEAN DEFAULT false`);

    // Миграции для крафта и исследования
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS items_crafted INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS unique_items JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS locations_visited JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS clans_joined INTEGER DEFAULT 0`);

    // Миграции для рефералов
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20)`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code_changed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by INTEGER`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_bonus_claimed BOOLEAN DEFAULT false`);

    // Миграция: преобразование referred_by из BIGINT в INTEGER (для существующих данных)
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'players' AND column_name = 'referred_by' AND data_type = 'bigint'
            ) THEN
                ALTER TABLE players ALTER COLUMN referred_by TYPE INTEGER USING referred_by::integer;
            END IF;
        END $do$
    `);

    // Миграция: преобразование referred_id в referrals из BIGINT в INTEGER
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'referrals' AND column_name = 'referred_id' AND data_type = 'bigint'
            ) THEN
                ALTER TABLE referrals ALTER COLUMN referred_id TYPE INTEGER USING referred_id::integer;
            END IF;
        END $do$
    `);

    // Миграция: преобразование referrer_id в referrals из BIGINT в INTEGER
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'referrals' AND column_name = 'referrer_id' AND data_type = 'bigint'
            ) THEN
                ALTER TABLE referrals ALTER COLUMN referrer_id TYPE INTEGER USING referrer_id::integer;
            END IF;
        END $do$
    `);

    // Добавить FK для referred_by (ссылка на id того же игрока)
    await query(`
        DO $do$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'fk_players_referred_by'
            ) THEN
                ALTER TABLE players ADD CONSTRAINT fk_players_referred_by 
                FOREIGN KEY (referred_by) REFERENCES players(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);

    // Добавить FK для referrer_id после нормализации типов
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'referrals' AND column_name = 'referrer_id' AND data_type = 'integer'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_referrals_referrer'
            ) THEN
                ALTER TABLE referrals ADD CONSTRAINT fk_referrals_referrer
                FOREIGN KEY (referrer_id) REFERENCES players(id) ON DELETE CASCADE;
            END IF;
        END $do$
    `);

    // Добавить FK для referred_id после нормализации типов
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'referrals' AND column_name = 'referred_id' AND data_type = 'integer'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_referrals_referred'
            ) THEN
                ALTER TABLE referrals ADD CONSTRAINT fk_referrals_referred
                FOREIGN KEY (referred_id) REFERENCES players(id) ON DELETE CASCADE;
            END IF;
        END $do$
    `);

    // Миграции для таблицы рефералов
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_5_bonus BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_10_bonus BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_20_bonus BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_5_bonus_claimed_at TIMESTAMP`);
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_10_bonus_claimed_at TIMESTAMP`);
    await query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS level_20_bonus_claimed_at TIMESTAMP`);

    // Миграции для achievements
    await query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'survival'`);
    await query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common'`);

    // Миграции для player_achievements
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS progress_value INTEGER DEFAULT 0`);
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);

    // CHECK constraints для бизнес-правил
    // PostgreSQL не поддерживает синтаксис ADD CONSTRAINT IF NOT EXISTS,
    // поэтому добавляем ограничения через явную проверку в information_schema.
    const checkConstraints = [
        ['players', 'chk_players_level', 'CHECK (level >= 1)', ['level']],
        ['players', 'chk_players_coins', 'CHECK (coins >= 0)', ['coins']],
        ['players', 'chk_players_stars', 'CHECK (stars >= 0)', ['stars']],
        ['players', 'chk_players_health', 'CHECK (health >= 0)', ['health']],
        ['players', 'chk_players_max_health', 'CHECK (max_health > 0)', ['max_health']],
        ['players', 'chk_players_energy', 'CHECK (energy >= 0)', ['energy']],
        ['players', 'chk_players_max_energy', 'CHECK (max_energy > 0)', ['max_energy']],
        ['players', 'chk_players_strength', 'CHECK (strength >= 1)', ['strength']],
        ['players', 'chk_players_endurance', 'CHECK (endurance >= 1)', ['endurance']],
        ['players', 'chk_players_agility', 'CHECK (agility >= 1)', ['agility']],
        ['players', 'chk_players_intelligence', 'CHECK (intelligence >= 1)', ['intelligence']],
        ['players', 'chk_players_luck', 'CHECK (luck >= 1)', ['luck']],
        ['players', 'chk_players_crafting', 'CHECK (crafting >= 1)', ['crafting']],
        ['players', 'chk_players_pvp_rating', 'CHECK (pvp_rating >= 0)', ['pvp_rating']],
        ['locations', 'chk_locations_danger_level', 'CHECK (danger_level >= 1 AND danger_level <= 10)', ['danger_level']],
        ['locations', 'chk_locations_radiation', 'CHECK (radiation >= 0)', ['radiation']],
        ['items', 'chk_items_price', 'CHECK (price >= 0)', ['price']],
        ['items', 'chk_items_rarity', "CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary'))", ['rarity']],
        ['bosses', 'chk_bosses_level', 'CHECK (level >= 1)', ['level']],
        ['bosses', 'chk_bosses_max_health', 'CHECK (max_health > 0)', ['max_health']],
        ['bosses', 'chk_bosses_damage', 'CHECK (damage >= 0)', ['damage']],
        ['bosses', 'chk_bosses_key_drop', 'CHECK (key_drop_chance >= 0 AND key_drop_chance <= 1)', ['key_drop_chance']],
        ['clans', 'chk_clans_level', 'CHECK (level >= 1)', ['level']],
        ['clans', 'chk_clans_experience', 'CHECK (experience >= 0)', ['experience']],
        ['clans', 'chk_clans_coins', 'CHECK (coins >= 0)', ['coins']],
        ['clans', 'chk_clans_total_members', 'CHECK (total_members >= 1)', ['total_members']],
        ['buildings', 'chk_buildings_max_level', 'CHECK (max_level >= 1)', ['max_level']],
        ['buildings', 'chk_buildings_base_cost', 'CHECK (base_cost_coins >= 0)', ['base_cost_coins']],
        ['crafting_recipes', 'chk_crafting_result_quantity', 'CHECK (result_quantity >= 1)', ['result_quantity']],
        ['crafting_recipes', 'chk_crafting_required_level', 'CHECK (required_level >= 1)', ['required_level']],
        ['crafting_recipes', 'chk_crafting_craft_time', 'CHECK (craft_time >= 1)', ['craft_time']],
        ['daily_tasks', 'chk_daily_tasks_target', 'CHECK (target_value >= 1)', ['target_value']],
        ['daily_tasks', 'chk_daily_tasks_current', 'CHECK (current_value >= 0)', ['current_value']],
        ['market_listings', 'chk_market_price', 'CHECK (price >= 0)', ['price']],
        ['market_listings', 'chk_market_quantity', 'CHECK (quantity >= 1)', ['quantity']]
    ];

    for (const [tableName, constraintName, definition, requiredColumns] of checkConstraints) {
        const requiredColumnsList = requiredColumns.map((columnName) => `'${columnName}'`).join(', ');

        await query(`
            DO $do$
            BEGIN
                IF (
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = '${tableName}'
                      AND column_name IN (${requiredColumnsList})
                ) = ${requiredColumns.length}
                AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = current_schema()
                      AND table_name = '${tableName}'
                      AND constraint_name = '${constraintName}'
                ) THEN
                    ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition};
                END IF;
            END $do$
        `);
    }
}

/**
 * Заполнение базовых данных (локации, сеты, боссы, предметы, здания, рецепты)
 * Вызывается внутри createTables
 */
async function seedDatabase() {
    // Локации
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
            ON CONFLICT (name) DO NOTHING
        `, [loc.name, loc.description, loc.radiation, loc.min_luck, loc.danger_level, loc.icon, loc.color]);
    }

    // Сеты предметов
    const itemSets = [
        { name: 'Военный сет', description: 'Армейская экипировка выжившего', icon: '🎖️', bonus_2: { damage: 3, defense: 2 }, bonus_3: { damage: 7, defense: 5, health: 20 }, bonus_4: { damage: 15, defense: 10, health: 50, crit_chance: 3 } },
        { name: 'Медицинский сет', description: 'Оборудование для выживания', icon: '🏥', bonus_2: { health: 15, medicine_effect: 5 }, bonus_3: { health: 35, medicine_effect: 10, radiation_resist: 5 }, bonus_4: { health: 75, medicine_effect: 20, radiation_resist: 15, infection_resist: 10 } },
        { name: 'Сталкерский сет', description: 'Экипировка для исследования зоны', icon: '🎒', bonus_2: { luck: 3, agility: 2 }, bonus_3: { luck: 7, agility: 5, energy: 10 }, bonus_4: { luck: 15, agility: 10, energy: 25, radiation_resist: 10 } },
        { name: 'Бандитский сет', description: 'Оружие и защита мародёра', icon: '💣', bonus_2: { damage: 4, crit_chance: 2 }, bonus_3: { damage: 9, crit_chance: 5, crit_damage: 10 }, bonus_4: { damage: 18, crit_chance: 10, crit_damage: 25, pvp_damage: 5 } }
    ];
    for (const set of itemSets) {
        await query(`
            INSERT INTO item_sets (name, description, icon, bonus_2, bonus_3, bonus_4)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (name) DO NOTHING
        `, [set.name, set.description, set.icon, JSON.stringify(set.bonus_2), JSON.stringify(set.bonus_3), JSON.stringify(set.bonus_4)]);
    }

    // Боссы
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
        const requiredKeyId = i > 0 ? i + 1 : null;
        await query(`
            INSERT INTO bosses (name, description, max_health, reward_experience, reward_coins, required_key_id, icon)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (name) DO NOTHING
        `, [boss.name, boss.description, boss.max_health, boss.reward_experience, boss.reward_coins, requiredKeyId, boss.icon]);
    }

    // Предметы
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
            ON CONFLICT (name, type) DO NOTHING
        `, [
            item.name, item.description, item.type, item.category, item.rarity || 'common',
            item.stackable !== false, item.slot || null, JSON.stringify(item.stats || {}),
            item.durability || 100, item.max_durability || 100, item.price, item.icon
        ]);
    }

    // Здания
    const buildings = [
        { code: 'wall', name: 'Стена', description: 'Защитная стена вашей базы', type: 'structure', max_level: 10, base_cost_coins: 50, base_cost_resources: { scrap: 10 }, bonuses: [{ storage: 5 }], icon: '🧱', color: '#8B4513', required_level: 1 },
        { code: 'floor', name: 'Пол', description: 'Укреплённый пол базы', type: 'structure', max_level: 10, base_cost_coins: 30, base_cost_resources: { scrap: 5 }, bonuses: [{ storage: 2 }], icon: '⬜', color: '#808080', required_level: 1 },
        { code: 'storage', name: 'Склад', description: 'Увеличивает лимит инвентаря', type: 'production', max_level: 10, base_cost_coins: 100, base_cost_resources: { scrap: 20, wood: 10 }, bonuses: [{ inventory_limit: 20 }], icon: '📦', color: '#FFD700', required_level: 1 },
        { code: 'workbench', name: 'Верстак', description: 'Позволяет крафтить сложные предметы', type: 'production', max_level: 10, base_cost_coins: 150, base_cost_resources: { scrap: 30, wood: 15 }, bonuses: [{ craft_level: 1 }], icon: '🔧', color: '#C0C0C0', required_level: 1 },
        { code: 'forge', name: 'Кузня', description: 'Ремонт и создание оружия', type: 'production', max_level: 10, base_cost_coins: 200, base_cost_resources: { scrap: 50, iron: 20 }, bonuses: [{ repair_bonus: 10, weapon_craft: 1 }], icon: '⚒️', color: '#FF4500', required_level: 3 },
        { code: 'lab', name: 'Химлаборатория', description: 'Создание медикаментов', type: 'production', max_level: 10, base_cost_coins: 250, base_cost_resources: { scrap: 40, chemicals: 15 }, bonuses: [{ medicine_craft: 1 }], icon: '🧪', color: '#00FF00', required_level: 5 },
        { code: 'living_room', name: 'Жилая комната', description: 'Пассивная регенерация здоровья', type: 'living', max_level: 10, base_cost_coins: 80, base_cost_resources: { wood: 20, cloth: 10 }, bonuses: [{ health_regen: 1 }], icon: '🛏️', color: '#4169E1', required_level: 2 },
        { code: 'farm', name: 'Ферма', description: 'Выращивание еды', type: 'production', max_level: 10, base_cost_coins: 120, base_cost_resources: { wood: 15, seeds: 5 }, bonuses: [{ food_production: 1 }], icon: '🌾', color: '#32CD32', required_level: 1 }
    ];
    for (const b of buildings) {
        await query(`
            INSERT INTO buildings (code, name, description, type, max_level, base_cost_coins, base_cost_resources, bonuses, icon, color, required_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (code) DO NOTHING
        `, [b.code, b.name, b.description, b.type, b.max_level, b.base_cost_coins, JSON.stringify(b.base_cost_resources), JSON.stringify(b.bonuses), b.icon, b.color, b.required_level]);
    }

    // Рецепты крафта
    const recipes = [
        { name: 'Нож', description: 'Простой нож из металлолома', result_item_id: 1, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 3 }], required_level: 1, craft_time: 5, rarity: 'common' },
        { name: 'Бита', description: 'Бейсбольная бита', result_item_id: 2, result_quantity: 1, ingredients: [{ item_id: 22, quantity: 2 }], required_level: 1, craft_time: 5, rarity: 'common' },
        { name: 'Кожаная куртка', description: 'Простая защита', result_item_id: 17, result_quantity: 1, ingredients: [{ item_id: 23, quantity: 5 }], required_level: 1, craft_time: 10, rarity: 'common' },
        { name: 'Бинт', description: 'Бинт из ткани', result_item_id: 6, result_quantity: 2, ingredients: [{ item_id: 23, quantity: 3 }], required_level: 1, craft_time: 3, rarity: 'common' },
        { name: 'Пистолет', description: 'Травматический пистолет', result_item_id: 13, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 5 }, { item_id: 28, quantity: 2 }], required_level: 5, craft_time: 30, rarity: 'uncommon' },
        { name: 'Бронежилет', description: 'Военный бронежилет', result_item_id: 18, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 10 }, { item_id: 23, quantity: 5 }], required_level: 10, craft_time: 45, rarity: 'rare' },
        { name: 'Противогаз', description: 'Защита от радиации', result_item_id: 19, result_quantity: 1, ingredients: [{ item_id: 28, quantity: 3 }, { item_id: 17, quantity: 2 }], required_level: 8, craft_time: 20, rarity: 'uncommon' },
        { name: 'Аптечка', description: 'Полная аптечка', result_item_id: 7, result_quantity: 1, ingredients: [{ item_id: 6, quantity: 3 }, { item_id: 22, quantity: 2 }], required_level: 5, craft_time: 15, rarity: 'uncommon' },
        { name: 'Автомат', description: 'Автоматическое оружие', result_item_id: 14, result_quantity: 1, ingredients: [{ item_id: 13, quantity: 1 }, { item_id: 21, quantity: 8 }, { item_id: 28, quantity: 3 }], required_level: 15, craft_time: 60, rarity: 'rare' },
        { name: 'Дробовик', description: 'Охотничий дробовик', result_item_id: 15, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 6 }, { item_id: 17, quantity: 2 }], required_level: 12, craft_time: 45, rarity: 'rare' },
        { name: 'Армейская каска', description: 'Защита головы', result_item_id: 20, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 4 }, { item_id: 23, quantity: 2 }], required_level: 8, craft_time: 20, rarity: 'uncommon' },
        { name: 'Антидот', description: 'Лекарство от инфекций', result_item_id: 8, result_quantity: 1, ingredients: [{ item_id: 22, quantity: 3 }, { item_id: 2, quantity: 2 }], required_level: 10, craft_time: 25, rarity: 'rare' },
        { name: 'Антирадин', description: 'Препарат от радиации', result_item_id: 9, result_quantity: 1, ingredients: [{ item_id: 22, quantity: 5 }, { item_id: 19, quantity: 1 }], required_level: 15, craft_time: 30, rarity: 'rare' },
        { name: 'Снайперка', description: 'Снайперская винтовка', result_item_id: 16, result_quantity: 1, ingredients: [{ item_id: 21, quantity: 15 }, { item_id: 28, quantity: 5 }, { item_id: 22, quantity: 3 }], required_level: 25, craft_time: 120, rarity: 'epic' },
        { name: 'Патроны', description: 'Патроны для оружия', result_item_id: 28, result_quantity: 10, ingredients: [{ item_id: 21, quantity: 2 }], required_level: 3, craft_time: 10, rarity: 'uncommon' }
    ];
    for (const r of recipes) {
        await query(`
            INSERT INTO crafting_recipes (name, description, result_item_id, result_quantity, ingredients, required_level, craft_time, rarity)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (name, result_item_id) DO NOTHING
        `, [r.name, r.description, r.result_item_id, r.result_quantity, JSON.stringify(r.ingredients), r.required_level, r.craft_time, r.rarity]);
    }
}

/**
 * Заполнение достижений
 * Вызывается внутри createTables
 */
async function seedAchievements() {
    const achievements = [
        // Выживание
        { name: 'Новичок', description: 'Достигни 2 уровня', category: 'survival', condition: { type: 'level', value: 2 }, reward: { coins: 50, stars: 0 }, icon: '🌱', rarity: 'common' },
        { name: 'Выживший', description: 'Достигни 5 уровня', category: 'survival', condition: { type: 'level', value: 5 }, reward: { coins: 100, stars: 1 }, icon: '🌿', rarity: 'common' },
        { name: 'Опытный', description: 'Достигни 10 уровня', category: 'survival', condition: { type: 'level', value: 10 }, reward: { coins: 250, stars: 2 }, icon: '🌳', rarity: 'uncommon' },
        { name: 'Ветеран', description: 'Достигни 20 уровня', category: 'survival', condition: { type: 'level', value: 20 }, reward: { coins: 500, stars: 5 }, icon: '🏅', rarity: 'rare' },
        { name: 'Мастер выживания', description: 'Достигни 30 уровня', category: 'survival', condition: { type: 'level', value: 30 }, reward: { coins: 1000, stars: 10 }, icon: '👑', rarity: 'epic' },
        { name: 'Легенда зоны', description: 'Достигни 50 уровня', category: 'survival', condition: { type: 'level', value: 50 }, reward: { coins: 5000, stars: 25 }, icon: '🌟', rarity: 'legendary' },
        
        // Боссы
        { name: 'Первая кровь', description: 'Убей первого босса', category: 'bosses', condition: { type: 'boss_kills', value: 1 }, reward: { coins: 100, stars: 1 }, icon: '⚔️', rarity: 'common' },
        { name: 'Охотник', description: 'Убей 10 боссов', category: 'bosses', condition: { type: 'boss_kills', value: 10 }, reward: { coins: 300, stars: 3 }, icon: '🎯', rarity: 'uncommon' },
        { name: 'Убийца монстров', description: 'Убей 50 боссов', category: 'bosses', condition: { type: 'boss_kills', value: 50 }, reward: { coins: 1000, stars: 10 }, icon: '💀', rarity: 'rare' },
        { name: 'Повелитель боссов', description: 'Убей 100 боссов', category: 'bosses', condition: { type: 'boss_kills', value: 100 }, reward: { coins: 2500, stars: 25 }, icon: '👹', rarity: 'epic' },
        
        // PvP
        { name: 'Нокаут', description: 'Выиграй 1 PvP бой', category: 'pvp', condition: { type: 'pvp_wins', value: 1 }, reward: { coins: 50, stars: 1 }, icon: '🥊', rarity: 'common' },
        { name: 'Боец', description: 'Выиграй 10 PvP боёв', category: 'pvp', condition: { type: 'pvp_wins', value: 10 }, reward: { coins: 200, stars: 3 }, icon: '🥋', rarity: 'uncommon' },
        { name: 'Чемпион', description: 'Выиграй 50 PvP боёв', category: 'pvp', condition: { type: 'pvp_wins', value: 50 }, reward: { coins: 750, stars: 10 }, icon: '🏆', rarity: 'rare' },
        { name: 'Легенда арены', description: 'Выиграй 100 PvP боёв', category: 'pvp', condition: { type: 'pvp_wins', value: 100 }, reward: { coins: 2000, stars: 25 }, icon: '⚡', rarity: 'epic' },
        
        // Крафт
        { name: 'Начинающий крафтер', description: 'Скрафти 10 предметов', category: 'craft', condition: { type: 'items_crafted', value: 10 }, reward: { coins: 100, stars: 1 }, icon: '🔨', rarity: 'common' },
        { name: 'Мастер крафта', description: 'Скрафти 50 предметов', category: 'craft', condition: { type: 'items_crafted', value: 50 }, reward: { coins: 400, stars: 5 }, icon: '⚒️', rarity: 'uncommon' },
        { name: 'Инженер', description: 'Скрафти 100 предметов', category: 'craft', condition: { type: 'items_crafted', value: 100 }, reward: { coins: 1000, stars: 10 }, icon: '🛠️', rarity: 'rare' },
        
        // Исследование
        { name: 'Путешественник', description: 'Посети 3 локации', category: 'exploration', condition: { type: 'locations_visited', value: 3 }, reward: { coins: 75, stars: 1 }, icon: '🗺️', rarity: 'common' },
        { name: 'Искатель', description: 'Посети все локации', category: 'exploration', condition: { type: 'locations_visited', value: 7 }, reward: { coins: 500, stars: 10 }, icon: '🧭', rarity: 'rare' },
        
        // Социальные
        { name: 'Новичок клана', description: 'Вступи в клан', category: 'social', condition: { type: 'clan_joined', value: 1 }, reward: { coins: 50, stars: 0 }, icon: '🤝', rarity: 'common' },
        { name: 'Лидер', description: 'Создай клан', category: 'social', condition: { type: 'clan_created', value: 1 }, reward: { coins: 200, stars: 5 }, icon: '👑', rarity: 'uncommon' },
        
        // Коллекция
        { name: 'Коллекционер', description: 'Собери 10 уникальных предметов', category: 'collection', condition: { type: 'unique_items', value: 10 }, reward: { coins: 200, stars: 3 }, icon: '📦', rarity: 'uncommon' },
        { name: 'Хранитель', description: 'Собери 25 уникальных предметов', category: 'collection', condition: { type: 'unique_items', value: 25 }, reward: { coins: 750, stars: 10 }, icon: '💎', rarity: 'rare' },
        
        // Ежедневные
        { name: 'Ежедневная победа', description: 'Выполни 1 ежедневное задание', category: 'daily', condition: { type: 'daily_tasks', value: 1 }, reward: { coins: 25, stars: 0 }, icon: '📅', rarity: 'common' },
        { name: 'Настойчивый', description: 'Выполни 25 ежедневных заданий', category: 'daily', condition: { type: 'daily_tasks', value: 25 }, reward: { coins: 300, stars: 5 }, icon: '📆', rarity: 'uncommon' }
    ];
    
    for (const a of achievements) {
        await query(`
            INSERT INTO achievements (name, description, category, condition, reward, icon, rarity)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (name, category) DO NOTHING
        `, [a.name, a.description, a.category, JSON.stringify(a.condition), JSON.stringify(a.reward), a.icon, a.rarity]);
    }
}

module.exports = {
    createTables,
    runMigrations,
    seedDatabase,
    seedAchievements
};
