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
            health INTEGER DEFAULT 100,
            max_health INTEGER DEFAULT 100,
            radiation JSONB DEFAULT '{"level": 0}',
            energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,
            infections JSONB DEFAULT '[]',
            current_location_id INTEGER DEFAULT 1,
            inventory JSONB DEFAULT '[]',
            equipment JSONB DEFAULT '{}',
            coins INTEGER DEFAULT 0,
            stars INTEGER DEFAULT 0,
            clan_id INTEGER,
            clan_role VARCHAR(50) DEFAULT 'member',
            total_actions INTEGER DEFAULT 0,
            bosses_killed INTEGER DEFAULT 0,
            days_played INTEGER DEFAULT 1,
            last_energy_update TIMESTAMP DEFAULT NOW(),
            last_action_time TIMESTAMP DEFAULT NOW(),
            active_boss_mode VARCHAR(20),
            active_raid_id INTEGER,
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
            infection INTEGER DEFAULT 0,
            min_luck INTEGER DEFAULT 0,
            danger_level INTEGER DEFAULT 1,
            loot_table JSONB DEFAULT '[]',
            is_available BOOLEAN DEFAULT true,
            icon VARCHAR(50),
            color VARCHAR(20)
        );
    `);
    
    // Миграция: добавить колонку infection если не существует
    await query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS infection INTEGER DEFAULT 0`);
    
    // Миграция: добавить колонку min_level если не существует (вместо min_luck для входа на локации)
    await query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS min_level INTEGER DEFAULT 1`);
    
    // Обновляем min_level на основе min_luck для существующих локаций, если min_level ещё не установлен
    await query(`
        UPDATE locations 
        SET min_level = 
            CASE 
                WHEN min_luck >= 90 THEN 25
                WHEN min_luck >= 65 THEN 18
                WHEN min_luck >= 50 THEN 12
                WHEN min_luck >= 35 THEN 8
                WHEN min_luck >= 20 THEN 5
                WHEN min_luck >= 10 THEN 3
                ELSE 1
            END
        WHERE min_level IS NULL OR min_level = 1
    `);

    // УДАЛЕНО: Таблица сетов предметов (не используется)
    // УДАЛЕНО: Таблица связи предметов с сетами (не используется)

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
            upgrade_level INTEGER DEFAULT 0,
            max_upgrade_level INTEGER DEFAULT 10,
            modifications JSONB DEFAULT '[]',
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            icon VARCHAR(50),
            image_url VARCHAR(500),
            UNIQUE(name, type)
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id),
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
            player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
            cooldown_type VARCHAR(50) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            reason TEXT,
            UNIQUE(player_id, cooldown_type)
        );
    `);

    // Таблица сессий игроков
    await query(`
        CREATE TABLE IF NOT EXISTS player_sessions (
            id SERIAL PRIMARY KEY,
            player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
            session_token VARCHAR(255) NOT NULL,
            ip_address VARCHAR(45),
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP NOT NULL,
            last_activity TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id)
        );
    `);

    // Таблица PvP сражений
    await query(`
        CREATE TABLE IF NOT EXISTS pvp_battles (
            id SERIAL PRIMARY KEY,
            attacker_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
            defender_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
            winner_id BIGINT REFERENCES players(id),
            loser_id BIGINT REFERENCES players(id),
            attacker_damage INTEGER DEFAULT 0,
            defender_damage INTEGER DEFAULT 0,
            attacker_reward INTEGER DEFAULT 0,
            defender_reward INTEGER DEFAULT 0,
            location_id INTEGER DEFAULT 0,
            battle_duration INTEGER DEFAULT 0,
            started_at TIMESTAMP DEFAULT NOW(),
            ended_at TIMESTAMP,
            status VARCHAR(20) DEFAULT 'active'
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

    // Индексы для pvp_matches
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_defender ON pvp_matches(defender_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_winner ON pvp_matches(winner_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_matches_location ON pvp_matches(location_id)`);

    // Индексы для pvp_cooldowns
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_player ON pvp_cooldowns(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_expires ON pvp_cooldowns(expires_at)`);

    // Индексы для player_sessions
    await query(`CREATE INDEX IF NOT EXISTS idx_player_sessions_player ON player_sessions(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_player_sessions_token ON player_sessions(session_token)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_player_sessions_expires ON player_sessions(expires_at)`);

    // Индексы для pvp_battles
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_battles_attacker ON pvp_battles(attacker_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_battles_defender ON pvp_battles(defender_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_battles_winner ON pvp_battles(winner_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pvp_battles_status ON pvp_battles(status)`);

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
}

/**
 * Миграции - добавление колонок в существующие таблицы
 */
async function runMigrations() {
    // Миграция: преобразование player_id из INTEGER в BIGINT для поддержки больших Telegram ID
    // Сначала удаляем старую функцию (если есть), т.к. CREATE OR REPLACE не меняет имена параметров
    await query(`DROP FUNCTION IF EXISTS convert_player_id_to_bigint(TEXT)`);
    
    // Создаём новую функцию
    await query(`
        CREATE FUNCTION convert_player_id_to_bigint(tbl_name TEXT) RETURNS void AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = tbl_name
                AND column_name = 'player_id' AND data_type = 'integer'
            ) THEN
                EXECUTE format('ALTER TABLE %I ALTER COLUMN player_id TYPE BIGINT', tbl_name);
            END IF;
        END $$ LANGUAGE plpgsql;
    `);
    
    const tablesWithPlayerId = [
        'boss_keys', 'boss_mastery', 'player_boss_progress', 'boss_sessions',
        'player_achievements', 'daily_tasks', 'pvp_cooldowns'
    ];
    
    for (const table of tablesWithPlayerId) {
        await query(`SELECT convert_player_id_to_bigint($1)`, [table]);
    }
    
    // Удаляем временную функцию
    await query(`DROP FUNCTION IF EXISTS convert_player_id_to_bigint(TEXT)`);

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
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'players' AND column_name = 'active_boss_mode') THEN
                ALTER TABLE players ADD COLUMN active_boss_mode VARCHAR(20);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'players' AND column_name = 'active_raid_id') THEN
                ALTER TABLE players ADD COLUMN active_raid_id INTEGER;
            END IF;
        END $do$
    `);

    // Миграция: добавить FK для active_raid_id после создания raid_progress
    await query(`
        DO $do$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'players' AND column_name = 'active_raid_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_players_active_raid'
            ) THEN
                ALTER TABLE players
                ADD CONSTRAINT fk_players_active_raid
                FOREIGN KEY (active_raid_id) REFERENCES raid_progress(id) ON DELETE SET NULL;
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
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS infections JSONB DEFAULT '[]'`);

    // УДАЛЕНО: миграции для крафта (items_crafted, unique_items)
    // Миграции для исследования
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS locations_visited JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS clans_joined INTEGER DEFAULT 0`);

    // Миграции для рефералов
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20)`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code_changed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by INTEGER`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_bonus_claimed BOOLEAN DEFAULT false`);

    // Миграции для магазина Stars
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS buffs JSONB DEFAULT '{}'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS cosmetics JSONB DEFAULT '[]'`);

    // Миграции для колеса удачи
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_wheel_spin TIMESTAMP`);
    
    // Миграции для бонусного урона по боссам
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS boss_damage INTEGER DEFAULT 0`);

    // Миграция: исправление типов данных для больших Telegram ID
    // В Supabase нужно отключить RLS или удалить политики перед изменением
    // Это делается вручную через SQL:
    // ALTER TABLE boss_keys ALTER COLUMN player_id TYPE BIGINT;
    // ALTER TABLE player_boss_progress ALTER COLUMN player_id TYPE BIGINT;
    // ALTER TABLE player_boss_mastery ALTER COLUMN player_id TYPE BIGINT;
    // ALTER TABLE player_achievements ALTER COLUMN player_id TYPE BIGINT;
    // ALTER TABLE player_tasks ALTER COLUMN player_id TYPE BIGINT;
    // ALTER TABLE player_cooldowns ALTER COLUMN player_id TYPE BIGINT;

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

    // Миграции для daily_tasks в таблице players
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_tasks_completed INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_tasks_reset_at TIMESTAMP`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0`);

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
        // УДАЛЕНО: chk_players_crafting - система крафта удалена
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
        ['daily_tasks', 'chk_daily_tasks_target', 'CHECK (target_value >= 1)', ['target_value']],
        ['daily_tasks', 'chk_daily_tasks_current', 'CHECK (current_value >= 0)', ['current_value']]
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

    // Миграция: удаление таблиц баз и крафта (системы удалены)
    await query(`DROP TABLE IF EXISTS player_buildings CASCADE`);
    await query(`DROP TABLE IF EXISTS buildings CASCADE`);
    await query(`DROP TABLE IF EXISTS crafting_recipes CASCADE`);

    // Миграция: полное удаление достижений крафта
    await query(`
        DELETE FROM player_achievements
        WHERE achievement_id IN (
            SELECT id FROM achievements WHERE category = 'craft'
        )
    `);
    await query(`DELETE FROM achievements WHERE category = 'craft'`);
}

/**
 * Заполнение базовых данных (локации, сеты, боссы, предметы)
 * Вызывается внутри createTables
 */
async function seedDatabase() {
    // Локации
    const locations = [
        { name: 'Спальный район', description: 'Тихий жилой комплекс на окраине города', radiation: 0, infection: 0, min_level: 1, danger_level: 1, icon: '🏠', color: '#4CAF50' },
        { name: 'Рынок', description: 'Центральный рынок, кишащий мародёрами', radiation: 5, infection: 5, min_level: 3, danger_level: 2, icon: '🛒', color: '#FF9800' },
        { name: 'Больница', description: 'Заброшенная больница с радиоактивными очагами', radiation: 15, infection: 25, min_level: 5, danger_level: 3, icon: '🏥', color: '#E91E63' },
        { name: 'Промзона', description: 'Промышленный район с токсичными отходами', radiation: 30, infection: 35, min_level: 8, danger_level: 4, icon: '🏭', color: '#9C27B0' },
        { name: 'Центр города', description: 'Сердце мёртвого города', radiation: 50, infection: 50, min_level: 12, danger_level: 5, icon: '🌆', color: '#F44336' },
        { name: 'Военная база', description: 'Захваченная военная база', radiation: 70, infection: 65, min_level: 18, danger_level: 6, icon: '🎖️', color: '#607D8B' },
        { name: 'Бункер', description: 'Секретный бункер выживших', radiation: 100, infection: 80, min_level: 25, danger_level: 7, icon: '🔒', color: '#000000' }
    ];
    for (const loc of locations) {
        await query(`
            INSERT INTO locations (name, description, radiation, infection, min_level, danger_level, icon, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (name) DO NOTHING
        `, [loc.name, loc.description, loc.radiation, loc.infection, loc.min_level, loc.danger_level, loc.icon, loc.color]);
    }

    // УДАЛЕНО: Сеты предметов (не используются)

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
        { name: 'Консервы', description: 'Просроченные консервы', type: 'food', category: 'consumable', rarity: 'common', price: 10, icon: '🥫', stats: { energy: 5 } },
        { name: 'Вода', description: 'Бутылка чистой воды', type: 'food', category: 'consumable', rarity: 'common', price: 15, icon: '💧', stats: { energy: 3 } },
        { name: 'Спирт', description: 'Медицинский спирт', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 25, icon: '🍺', stats: { health: 15 } },
        { name: 'Снеки', description: 'Сухие пайки', type: 'food', category: 'consumable', rarity: 'common', price: 8, icon: '🍪', stats: { energy: 2 } },
        { name: 'Энергетик', description: 'Баночка энергетика', type: 'food', category: 'consumable', rarity: 'uncommon', price: 20, icon: '⚡', stats: { energy: 10 } },
        { name: 'Бинт', description: 'Обычный бинт', type: 'medicine', category: 'medicine', rarity: 'common', price: 20, icon: '🩹', stats: { health: 10 } },
        { name: 'Аптечка', description: 'Полная аптечка', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 50, icon: '💊', stats: { health: 30 } },
        { name: 'Антидот', description: 'Лекарство от инфекций', type: 'medicine', category: 'medicine', rarity: 'rare', price: 100, icon: '💉', stats: { infection_cure: 2 } },
        { name: 'Антирадин', description: 'Препарат от радиации', type: 'medicine', category: 'medicine', rarity: 'rare', price: 150, icon: '☢️', stats: { radiation_cure: 3 } },
        { name: 'Витамины', description: 'Комплекс витаминов', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 35, icon: '💊', stats: { health: 15 } },
        { name: 'Нож', description: 'Простой нож выживания', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', stats: { damage: 5 }, durability: 50, max_durability: 50, price: 30, icon: '🔪' },
        { name: 'Бита', description: 'Бейсбольная бита', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', stats: { damage: 8 }, durability: 30, max_durability: 30, price: 25, icon: '🏏' },
        { name: 'Пистолет', description: 'Травматический пистолет', type: 'weapon', category: 'ranged', rarity: 'uncommon', slot: 'weapon', stats: { damage: 20, ammo: 8 }, durability: 100, max_durability: 100, price: 200, icon: '🔫' },
        { name: 'Автомат', description: 'Автоматическое оружие', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', stats: { damage: 40, ammo: 30 }, durability: 200, max_durability: 200, price: 500, icon: '⚔️' },
        { name: 'Дробовик', description: 'Охотничий дробовик', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', stats: { damage: 60, ammo: 5 }, durability: 150, max_durability: 150, price: 750, icon: '🔫' },
        { name: 'Снайперка', description: 'Снайперская винтовка', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', stats: { damage: 100, ammo: 5 }, durability: 300, max_durability: 300, price: 1500, icon: '🔭' },
        { name: 'Кожаная куртка', description: 'Простая защита', type: 'armor', category: 'body', rarity: 'common', slot: 'body', stats: { defense: 5, infection_resist: 3 }, durability: 50, max_durability: 50, price: 40, icon: '🧥' },
        { name: 'Бронежилет', description: 'Военный бронежилет', type: 'armor', category: 'body', rarity: 'rare', slot: 'body', stats: { defense: 25, radiation_resist: 6, infection_resist: 4 }, durability: 150, max_durability: 150, price: 300, icon: '🦺' },
        { name: 'Противогаз', description: 'Защита от радиации', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', stats: { radiation_resist: 20, infection_resist: 12 }, durability: 100, max_durability: 100, price: 100, icon: '😷' },
        { name: 'Армейская каска', description: 'Защита головы', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', stats: { defense: 10, infection_resist: 5 }, durability: 80, max_durability: 80, price: 80, icon: '⛑️' },
        // УДАЛЕНО: материалы для крафта (Металлолом, Древесина, Ткань, Пластик, Электроника, Провода, Химикаты, Титан, Уран, Кристалл силы, Ядерный элемент)
        { name: 'Патроны', description: 'Патроны для оружия', type: 'resource', category: 'ammo', rarity: 'uncommon', stackable: true, price: 20, icon: '📦' },
        // Ключи для боссов (1 = не требуется, 2-10 = нужны ключи)
        { name: 'Ключ от Бездомного психа', description: 'Ключ для разблокировки босса 2', type: 'key', category: 'key', rarity: 'uncommon', stackable: true, price: 0, icon: '🗝️', boss_level: 2 },
        { name: 'Ключ от Медведя-мутанта', description: 'Ключ для разблокировки босса 3', type: 'key', category: 'key', rarity: 'rare', stackable: true, price: 0, icon: '🗝️', boss_level: 3 },
        { name: 'Ключ от Военного дрона', description: 'Ключ для разблокировки босса 4', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️', boss_level: 4 },
        { name: 'Ключ от Главаря мародёров', description: 'Ключ для разблокировки босса 5', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️', boss_level: 5 },
        { name: 'Клюш от Биологического ужаса', description: 'Ключ для разблокировки босса 6', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️', boss_level: 6 },
        { name: 'Ключ от Офицера-нежить', description: 'Ключ для разблокировки босса 7', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️', boss_level: 7 },
        { name: 'Ключ от Гигантского монстра', description: 'Ключ для разблокировки босса 8', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️', boss_level: 8 },
        { name: 'Ключ от Профессора безумия', description: 'Ключ для разблокировки босса 9', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️', boss_level: 9 },
        { name: 'Ключ от Последнего стража', description: 'Ключ для разблокировки финального босса 10', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️', boss_level: 10 },
        { name: 'Нейроимплант', description: 'Улучшает реакцию и интеллект', type: 'food', category: 'consumable', rarity: 'epic', price: 500, icon: '🧠', stats: { energy: 25 } },
        { name: 'Стимулятор', description: 'Мощный допинг', type: 'food', category: 'consumable', rarity: 'epic', price: 600, icon: '💥', stats: { energy: 30 } },
        { name: 'Нано-аптечка', description: 'Мгновенное лечение', type: 'medicine', category: 'medicine', rarity: 'epic', price: 800, icon: '🏥', stats: { health: 50 } },
        { name: 'Радиа-кур', description: 'Полная защита от радиации', type: 'medicine', category: 'medicine', rarity: 'epic', price: 1000, icon: '🛡️', stats: { radiation_cure: 5 } },
        { name: 'Плазменный пистолет', description: 'Экспериментальное оружие', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', stats: { damage: 80, ammo: 12 }, durability: 250, max_durability: 250, price: 2500, icon: '🔮' },
        { name: 'Экзо-костюм', description: 'Тяжёлая броня', type: 'armor', category: 'body', rarity: 'epic', slot: 'body', stats: { defense: 50, radiation_resist: 30 }, durability: 300, max_durability: 300, price: 3000, icon: '🤖' },
        // УДАЛЕНО: материалы для крафта (Титан, Уран)
        { name: 'Сыворотка мутанта', description: 'Даёт сверхспособности', type: 'food', category: 'consumable', rarity: 'legendary', price: 2000, icon: '🧬', stats: { energy: 50 } },
        { name: 'Эликсир бессмертия', description: 'Полное воскрешение', type: 'medicine', category: 'medicine', rarity: 'legendary', price: 5000, icon: '⭐', stats: { health: 100 } },
        { name: 'Лазерная винтовка', description: 'Оружие из будущего', type: 'weapon', category: 'ranged', rarity: 'legendary', slot: 'weapon', stats: { damage: 150, ammo: 20 }, durability: 500, max_durability: 500, price: 10000, icon: '⚡' },
        { name: 'Броня стражей', description: 'Легендарная броня', type: 'armor', category: 'body', rarity: 'legendary', slot: 'body', stats: { defense: 80, radiation_resist: 50 }, durability: 500, max_durability: 500, price: 15000, icon: '👑' }
        // УДАЛЕНО: материалы для крафта (Кристалл силы, Ядерный элемент)
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
