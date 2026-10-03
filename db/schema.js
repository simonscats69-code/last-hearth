/**
 * Схема базы данных - единственный источник правды по DDL
 * Все CREATE TABLE, INDEX, ALTER TABLE здесь
 */

const { query } = require('./database');
const pg = require('pg');
// Нужен миграции уникальности реферального кода: дубликатам выдаются
// новые коды тем же генератором, что и при регистрации.
const { generateReferralCode } = require('../utils/referralCode');

/**
 * Безопасное экранирование идентификаторов PostgreSQL
 * Использует pg.escapeIdentifier с fallback-валидацией
 */
function safeId(name) {
    try {
        return pg.escapeIdentifier(name);
    } catch {
        // Если escapeIdentifier недоступен, валидируем вручную
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            throw new Error(`Invalid SQL identifier: ${name}`);
        }
        return `"${name}"`;
    }
}

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
            banned BOOLEAN DEFAULT false,
            ban_reason TEXT,
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
            clan_donated INTEGER DEFAULT 0,
            active_boss_id INTEGER
        );
    `);
    
    // Миграция: добавить active_boss_id если не существует (для существующих БД)
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
            ammo_type VARCHAR(20) DEFAULT 'none',
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

    // Сеты снаряжения. На проде таблицы были созданы вручную и в схеме
    // отсутствовали: свежий деплой получал код, который к ним обращается,
    // на БД без этих таблиц. Источник правды для бонусов — items.set_id,
    // item_set_items — список частей для UI.
    await query(`
        CREATE TABLE IF NOT EXISTS item_sets (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(50),
            bonus_2 JSONB DEFAULT '{}'::jsonb,
            bonus_3 JSONB DEFAULT '{}'::jsonb,
            bonus_4 JSONB DEFAULT '{}'::jsonb
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS item_set_items (
            id SERIAL PRIMARY KEY,
            set_id INTEGER NOT NULL REFERENCES item_sets(id) ON DELETE CASCADE,
            item_id INTEGER NOT NULL,
            piece_number INTEGER DEFAULT 1,
            UNIQUE (set_id, item_id)
        )
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

    // Таблица PvP матчей — УДАЛЕНА: используется pvp_battles
    // Для обратной совместимости удаляем старую таблицу если существует
    await query(`DROP TABLE IF EXISTS pvp_matches CASCADE`);

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

    // Миграция: FK player_boss_progress.player_id должен ссылаться на players(id),
    // а НЕ на players(telegram_id).
    // На проде (Supabase) ограничение оказалось создано вручную со ссылкой на
    // telegram_id, тогда как приложение везде передаёт req.player.id === players.id
    // (см. buildRequestPlayer в routes/game/index.js). Из-за этого INSERT ... ON CONFLICT
    // падал с ошибкой 23503 (FK violation) -> 500 на POST /api/game/bosses/start.
    // Приводим и ограничение, и данные к схеме CREATE TABLE (REFERENCES players(id)).
    await query(`
        DO $do$
        DECLARE r record;
        BEGIN
            -- 1. Убираем FK на players, ссылающийся на любую колонку кроме id.
            FOR r IN
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_class frel ON frel.oid = con.confrelid
                JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
                JOIN pg_namespace n ON n.oid = rel.relnamespace
                WHERE n.nspname = current_schema()
                  AND rel.relname = 'player_boss_progress'
                  AND con.contype = 'f'
                  AND frel.relname = 'players'
                  AND fa.attname <> 'id'
            LOOP
                EXECUTE format('ALTER TABLE player_boss_progress DROP CONSTRAINT %I', r.conname);
            END LOOP;

            -- 2. Строки, где player_id хранит telegram_id, переводим в players.id.
            --    Если по тому же боссу уже есть запись с правильным id — лишнюю убираем,
            --    иначе нарушится UNIQUE (player_id, boss_id).
            DELETE FROM player_boss_progress pbp
            USING players p
            WHERE pbp.player_id = p.telegram_id
              AND pbp.player_id IS DISTINCT FROM p.id
              AND EXISTS (
                  SELECT 1 FROM player_boss_progress x
                  WHERE x.player_id = p.id AND x.boss_id = pbp.boss_id
              );

            UPDATE player_boss_progress pbp
            SET player_id = p.id
            FROM players p
            WHERE pbp.player_id = p.telegram_id
              AND pbp.player_id IS DISTINCT FROM p.id
              AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.id = pbp.player_id);

            -- 3. Корректный FK (добавляем только если его ещё нет).
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_class frel ON frel.oid = con.confrelid
                JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
                WHERE rel.relname = 'player_boss_progress'
                  AND con.contype = 'f'
                  AND frel.relname = 'players'
                  AND fa.attname = 'id'
            ) THEN
                ALTER TABLE player_boss_progress
                    ADD CONSTRAINT player_boss_progress_player_id_fkey
                    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
            END IF;
        END $do$
    `);

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

    // Миграция: достижения исследования
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS locations_visited JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS clans_joined INTEGER DEFAULT 0`);

    // Миграции для рефералов
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20)`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code_changed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by INTEGER`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_bonus_claimed BOOLEAN DEFAULT false`);

    // Миграция: уникальность реферального кода.
    //
    // Раньше UNIQUE не было, при этом:
    //   - webhook.js ловил 23505 по referral_code, но constraint не мог
    //     сработать (retry-цикл был мёртвым);
    //   - POST /referral/use делает SELECT id ... WHERE referral_code = $1
    //     и берёт rows[0], то есть при дублях бонус уходил наугад.
    //
    // Прежде чем добавить индекс, у дубликатов (кроме самой ранней записи,
    // id = MIN, чей код мог уже быть роздан) выдаём новые коды — иначе
    // CREATE UNIQUE INDEX упал бы и миграция не прошла бы.
    const duplicates = await query(`
        SELECT referral_code
        FROM players
        WHERE referral_code IS NOT NULL AND referral_code <> ''
        GROUP BY referral_code
        HAVING COUNT(*) > 1
        ORDER BY MIN(id)
    `);

    for (const dup of duplicates.rows) {
        const conflictRows = await query(
            `SELECT id FROM players WHERE referral_code = $1 AND id <> (
                SELECT MIN(id) FROM players WHERE referral_code = $1
            )`,
            [dup.referral_code]
        );

        for (const row of conflictRows.rows) {
            let newCode = generateReferralCode();
            let attempts = 0;
            // Крайне маловероятно, но проверяем, что новый код тоже свободен
            while (attempts < 10) {
                const taken = await query('SELECT id FROM players WHERE referral_code = $1', [newCode]);
                if (taken.rows.length === 0) break;
                newCode = generateReferralCode();
                attempts++;
            }
            await query('UPDATE players SET referral_code = $1 WHERE id = $2', [newCode, row.id]);
        }

        console.warn(`[migrate] Дубликаты реферального кода «${dup.referral_code}»: перевыдано кодов — ${conflictRows.rows.length}`);
    }

    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_referral_code_unique ON players(referral_code)`);

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

    // ==========================================
    // ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ (H-10)
    // ==========================================
    // Таблица игроков-логов (для логирования действий)
    await query(`
        CREATE TABLE IF NOT EXISTS player_logs (
            id SERIAL PRIMARY KEY,
            player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
            action VARCHAR(100) NOT NULL,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
await query(`CREATE INDEX IF NOT EXISTS idx_player_logs_player_id ON player_logs(player_id)`);
     await query(`CREATE INDEX IF NOT EXISTS idx_player_logs_created_at ON player_logs(created_at)`);
     await query(`CREATE INDEX IF NOT EXISTS idx_clans_leader_id ON clans(leader_id)`);
     // Индексы idx_players_telegram_id и idx_players_clan_id уже созданы в createTables()
     await query(`CREATE INDEX IF NOT EXISTS idx_player_achievements_player_id ON player_achievements(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_boss_mastery_player_id ON boss_mastery(player_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_daily_tasks_player_id ON daily_tasks(player_id)`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_tasks_reset_at TIMESTAMP`);

    // Миграция для wheel в таблице players
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_wheel_spin TIMESTAMP`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS items_collected INTEGER DEFAULT 0`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ban_reason TEXT`);

    // Миграции для achievements
    await query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'survival'`);
    await query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common'`);

    // Достижения: строки без достижения (achievement_id IS NULL) — наследие
    // старой схемы, где ключом был achievement_key. UNIQUE в Postgres считает
    // NULL разными значениями, поэтому такие строки свободно копились, но
    // никогда не находились запросами `WHERE achievement_id = $1`. Удаляем
    // их и записи-сироты. Идемпотентно: повторный запуск ничего не делает.
    await query(`
        DELETE FROM player_achievements pa
         WHERE pa.achievement_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM achievements a WHERE a.id = pa.achievement_id)
    `);

    // Миграции для player_achievements
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS progress_value INTEGER DEFAULT 0`);
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);

    // Тип боеприпасов оружия: none / ammo / rockets. Мастерская знает по нему,
// что тратить на улучшение — патроны или реактивные гранаты.
    await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS ammo_type VARCHAR(20) DEFAULT 'none'`);

    // key_drop_chance переводим в проценты (0..100): сид задаёт 2.5% на ключ от
    // второго босса, а старое ограничение (0..1) такую запись отклоняло.
    // DROP делаем ДО checkConstraints ниже, чтобы новое ограничение создалось.
    await query(`ALTER TABLE bosses DROP CONSTRAINT IF EXISTS chk_bosses_key_drop`);

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
        ['players', 'chk_players_pvp_rating', 'CHECK (pvp_rating >= 0)', ['pvp_rating']],
        ['locations', 'chk_locations_danger_level', 'CHECK (danger_level >= 1 AND danger_level <= 10)', ['danger_level']],
        ['locations', 'chk_locations_radiation', 'CHECK (radiation >= 0)', ['radiation']],
        ['items', 'chk_items_price', 'CHECK (price >= 0)', ['price']],
        ['items', 'chk_items_rarity', "CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary'))", ['rarity']],
        ['bosses', 'chk_bosses_level', 'CHECK (level >= 1)', ['level']],
        ['bosses', 'chk_bosses_max_health', 'CHECK (max_health > 0)', ['max_health']],
        ['bosses', 'chk_bosses_damage', 'CHECK (damage >= 0)', ['damage']],
        // key_drop_chance трактуется как ПРОЦЕНТ от дропа (0..100), а не доля:
// шанс 2.5% на ключ от второго босса читается из world.js напрямую.
// Старое ограничение (0..1) не давало записать такие значения.
['bosses', 'chk_bosses_key_drop', 'CHECK (key_drop_chance >= 0 AND key_drop_chance <= 100)', ['key_drop_chance']],
        ['clans', 'chk_clans_level', 'CHECK (level >= 1)', ['level']],
        ['clans', 'chk_clans_experience', 'CHECK (experience >= 0)', ['experience']],
        ['clans', 'chk_clans_coins', 'CHECK (coins >= 0)', ['coins']],
        ['clans', 'chk_clans_total_members', 'CHECK (total_members >= 1)', ['total_members']],
        ['daily_tasks', 'chk_daily_tasks_target', 'CHECK (target_value >= 1)', ['target_value']],
        ['daily_tasks', 'chk_daily_tasks_current', 'CHECK (current_value >= 0)', ['current_value']]
    ];

    for (const [tableName, constraintName, definition, requiredColumns] of checkConstraints) {
        // ВАЖНО: внутри WHERE это СТРОКОВЫЕ литералы, а не идентификаторы.
        // pg.escapeIdentifier даёт "name" (двойные кавычки), что Postgres
        // парсит как ссылку на колонку -> 'column "players" does not exist'.
        const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
        const safeTableName = sqlLiteral(tableName);
        const safeConstraintName = sqlLiteral(constraintName);
        const requiredColumnsList = requiredColumns
            .map((columnName) => {
                // Для IN-списка нужны строковые литералы имён колонок, а не идентификаторы
                return `'${columnName}'`;
            })
            .join(', ');

        await query(`
            DO $do$
            BEGIN
                IF (
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = ${safeTableName}
                      AND column_name IN (${requiredColumnsList})
                ) = ${requiredColumns.length}
                AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = current_schema()
                      AND table_name = ${safeTableName}
                      AND constraint_name = ${safeConstraintName}
                ) THEN
                    ALTER TABLE ${safeId(tableName)} ADD CONSTRAINT ${safeId(constraintName)} ${definition};
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

    // Чистка легаси-строк каталога.
    // 1) «Спирт» существует в проде дважды: старый (type=food, stats={}) и
    //    новый (type=medicine, stats={health,infection_cure}). Старый в магазине
    //    выглядел как еда, но /use его игнорировал. Оставляем medicine.
    // 2) «Клюш от Биологического ужаса» — опечатка, из-за которой на проде
    //    было два ключа от одного босса, а бой открывался «не тем» ключом.
    // 3) «Ключ от босса» — безымянный ключ из ранних сборок: он не отвечает
    //    ни одному боссу, поэтому раздавался только как мусор в инвентаре.
    // Ключи из инвентарей переезжают в boss_keys (repairPlayerInventories),
    // а не теряются вместе с удалённой строкой каталога.
    await query(`
        DELETE FROM items
         WHERE (type = 'food' AND name = 'Спирт')
            OR (type = 'key' AND name IN ('Клюш от босса', 'Клюш от босса.', 'Клюш от Биологического ужаса'))
    `);

    // Supabase Advisor: включение Row Level Security на всех таблицах public.
    // - Приложение подключается ролью postgres (владелец таблиц): RLS владельцу
    //   не применяется без FORCE, поэтому доступ приложения не меняется.
    // - Закрывается анонимный доступ к данным через PostgREST (anon/authenticated)
    //   без явных политик: RLS без политик -> ни одной строки для не-владельцев.
    // - Идемпотентно: включаем только там, где RLS ещё выключен (rowsecurity = false).
    // - Ошибка на одной таблице (нет прав владельца) не прерывает миграцию.
    await query(`
        DO $$
        DECLARE tbl record;
        BEGIN
            FOR tbl IN
                SELECT c.relname
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind IN ('r', 'p')
                  AND NOT c.relrowsecurity
            LOOP
                BEGIN
                    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.relname);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'RLS: не удалось включить на % (%): пропуск', tbl.relname, SQLERRM;
                END;
            END LOOP;
        END $$;
    `);
}

/**
 * Миграция данных: сворачиваем старые дубли предметов в инвентарях игроков.
 *
 * До появления стакования (utils/game-helpers.js → addItemToInventory) каждый
 * дроп и каждая покупка создавали отдельный слот, поэтому в players.inventory
 * накопились дубли (например, 4 слота «Древесины» по 1 шт. вместо стека).
 * Рантайм теперь стакает новые предметы, но старые записи остаются разбитыми —
 * эта миграция приводит их к текущим правилам.
 *
 * Правила берём из того же addItemToInventory, чтобы миграция не разошлась с
 * игрой. Идемпотентно: если сворачивать нечего, запись не трогается.
 *
 * ВАЖНО: вызывается ПОСЛЕ seedDatabase() — нужны метаданные items
 * (stackable/max_stack/slot), чтобы уважать настройки предметов.
 *
 * @returns {Promise<number>} сколько инвентарей реально изменилось
 */
async function mergeDuplicateInventoryStacks() {
    // Ленивый require: game-helpers тянет db/database, который к этому моменту
    // уже загружен, поэтому цикла зависимостей не возникает.
    const { addItemToInventory } = require('../utils/game-helpers');

    const metaResult = await query(
        'SELECT id, name, type, category, slot, stackable, max_stack FROM items');
    const meta = new Map(metaResult.rows.map((row) => [String(row.id), row]));
    if (meta.size === 0) return 0;

    const players = await query(`
        SELECT id, inventory FROM players
        WHERE jsonb_typeof(inventory) = 'array'
          AND jsonb_array_length(inventory) > 1
    `);

    let updated = 0;
    for (const playerRow of players.rows) {
        let inventory = playerRow.inventory;
        if (typeof inventory === 'string') {
            try {
                inventory = JSON.parse(inventory);
            } catch {
                continue;
            }
        }
        if (!Array.isArray(inventory)) continue;

        const merged = [];
        for (const entry of inventory) {
            if (!entry || typeof entry !== 'object') continue;
            addItemToInventory(merged, entry, meta.get(String(entry.id)) || null);
        }

        if (merged.length < inventory.length) {
            await query('UPDATE players SET inventory = $1::jsonb WHERE id = $2',
                [JSON.stringify(merged), playerRow.id]);
            updated += 1;
        }
    }

    if (updated > 0) {
        console.warn(`[migrate] Свернули дубли предметов в инвентарях: инвентарей изменено — ${updated}`);
    }

    return updated;
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
        // UPSERT, а не DO NOTHING: на проде у всех локаций min_level = 1
        // (миграция выводила его из min_luck, который везде был 0), из-за
        // чего карта фактически не имела прогрессии — доступна была сразу.
        await query(`
            INSERT INTO locations (name, description, radiation, infection, min_level, danger_level, icon, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (name) DO UPDATE SET
                description = EXCLUDED.description,
                radiation = EXCLUDED.radiation,
                infection = EXCLUDED.infection,
                min_level = EXCLUDED.min_level,
                danger_level = EXCLUDED.danger_level,
                icon = EXCLUDED.icon,
                color = EXCLUDED.color
        `, [loc.name, loc.description, loc.radiation, loc.infection, loc.min_level, loc.danger_level, loc.icon, loc.color]);
    }

    // Боссы сидируются ПОСЛЕ каталога предметов: их reward_items и
    // required_key_id ссылаются на items по имени, и без предметов в БД
    // ссылки не разрешить (см. seedBosses ниже).

    // Предметы
    const items = [
        { name: 'Консервы', description: 'Просроченные консервы', type: 'food', category: 'consumable', rarity: 'common', price: 10, icon: '🥫', stats: { energy: 5 } },
        { name: 'Вода', description: 'Бутылка чистой воды', type: 'food', category: 'consumable', rarity: 'common', price: 15, icon: '💧', stats: { energy: 3 } },
        { name: 'Спирт', description: 'Медицинский спирт: обеззараживает раны', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 25, icon: '🍺', stats: { health: 15, infection_cure: 1 } },
        { name: 'Снеки', description: 'Сухие пайки', type: 'food', category: 'consumable', rarity: 'common', price: 8, icon: '🍪', stats: { energy: 2 } },
        { name: 'Энергетик', description: 'Баночка энергетика', type: 'food', category: 'consumable', rarity: 'uncommon', price: 20, icon: '⚡', stats: { energy: 10 } },
        { name: 'Бинт', description: 'Обычный бинт', type: 'medicine', category: 'medicine', rarity: 'common', price: 20, icon: '🩹', stats: { health: 10 } },
        { name: 'Аптечка', description: 'Полная аптечка', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 50, icon: '💊', stats: { health: 30 } },
        { name: 'Антидот', description: 'Лекарство от инфекций', type: 'medicine', category: 'medicine', rarity: 'rare', price: 100, icon: '💉', stats: { infection_cure: 2 } },
        { name: 'Антирадин', description: 'Препарат от радиации', type: 'medicine', category: 'medicine', rarity: 'rare', price: 150, icon: '☢️', stats: { radiation_cure: 3 } },
        { name: 'Витамины', description: 'Комплекс витаминов', type: 'medicine', category: 'medicine', rarity: 'uncommon', price: 35, icon: '💊', stats: { health: 15 } },
        // Оружие: только то, что реально встречается в постапокалипсисе.
        // Никаких плазменных стволов и лазерных винтовок — прошлая версия
        // сида содержала «Плазменный пистолет» и «Лазерную винтовку», они
        // переименованы в applyItemRenames() (см. конец файла).
        //
        // Два типа боя с разными ролями (stats.boss_bonus / stats.pvp_bonus):
        //   ближний бой  — +40% урона по боссам (подойти вплотную);
        //   дальний бой  — +25% урона в PvP.
        // Раньше тип оружия ничего не значил: ближний бай был просто слабее.
        //
        // Экономика: цена за удар = price / durability, а урон за удар = stats.damage.
        // Энергия тратится на каждый удар, поэтому «дёшево за выстрел» важнее
        // общего урона оружия.
        { name: 'Нож', description: 'Складной нож выжившего: тихо, дёшево, всегда с собой', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', ammo_type: 'none', stats: { damage: 5, boss_bonus: 40 }, durability: 50, max_durability: 50, price: 20, icon: '🔪' },
        { name: 'Бита', description: 'Бейсбольная бита: крепче ножа, но изнашивается быстрее', type: 'weapon', category: 'melee', rarity: 'common', slot: 'weapon', set_id: 4, ammo_type: 'none', stats: { damage: 9, boss_bonus: 40 }, durability: 35, max_durability: 35, price: 45, icon: '🏏' },
        { name: 'Пистолет', description: 'Пистолет Макарова: 8 патронов и никаких проблем', type: 'weapon', category: 'ranged', rarity: 'common', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 16, pvp_bonus: 25 }, durability: 60, max_durability: 60, price: 90, icon: '🔫' },
        { name: 'Пистолет ТТ', description: 'Трофейный пистолет: точнее и кучнее «Макарова»', type: 'weapon', category: 'ranged', rarity: 'uncommon', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 24, pvp_bonus: 25 }, durability: 90, max_durability: 90, price: 170, icon: '🔫' },
        { name: 'Обрез', description: 'Двустволка, перерезанная из охотничьего ружья', type: 'weapon', category: 'ranged', rarity: 'uncommon', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 34, pvp_bonus: 25 }, durability: 40, max_durability: 40, price: 240, icon: '🔫' },
        { name: 'Топор', description: 'Тяжёлый топор: рубит вблизи, но управляться тяжело', type: 'weapon', category: 'melee', rarity: 'uncommon', slot: 'weapon', ammo_type: 'none', stats: { damage: 15, boss_bonus: 40 }, durability: 70, max_durability: 70, price: 130, icon: '🪓' },
        { name: 'Автомат', description: 'Автомат из армейских запасов: универсальное оружие', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 48, pvp_bonus: 25 }, durability: 160, max_durability: 160, price: 320, icon: '⚔️' },
        { name: 'Винтовка Мосина', description: 'Старая магазинная винтовка: дёшево в обслуживании', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 52, pvp_bonus: 25 }, durability: 120, max_durability: 120, price: 380, icon: '🎯' },
        { name: 'Дробовик', description: 'Охотничий дробовик: разброс урона ±25%', type: 'weapon', category: 'ranged', rarity: 'rare', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 62, variance: 25, pvp_bonus: 25 }, durability: 130, max_durability: 130, price: 360, icon: '🔫' },
        { name: 'Снайперская винтовка', description: 'Снайперская винтовка: один выстрел решает', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 95, pvp_bonus: 25 }, durability: 200, max_durability: 200, price: 850, stars_price: 40, icon: '🔭' },
        { name: 'Пулемёт', description: 'Станковый пулемёт: тяжёлый, зверский, с чашей патронов', type: 'weapon', category: 'ranged', rarity: 'epic', slot: 'weapon', ammo_type: 'ammo', stats: { damage: 85, pvp_bonus: 25 }, durability: 260, max_durability: 260, price: 1100, stars_price: 55, icon: '🔧' },
        { name: 'Реактивная пушка', description: 'Реактивная пушка: снос любого босса, но зарядов мало', type: 'weapon', category: 'ranged', rarity: 'legendary', slot: 'weapon', ammo_type: 'rockets', stats: { damage: 240, variance: 20, pvp_bonus: 25 }, durability: 35, max_durability: 35, price: 2500, stars_price: 150, icon: '🚀' },
        // Броня. Слоты hands/boots/accessory не закрывал НИ ОДИН предмет —
        // 3 из 9 слотов экипировки были пустыми. Новые предметы закрывают
        // слоты и одновременно собирают 4 сета (items.set_id + item_sets).
        { name: 'Кожаная куртка', description: 'Простая защита от холода и царапин', type: 'armor', category: 'body', rarity: 'common', slot: 'body', stats: { defense: 5, infection_resist: 3 }, durability: 60, max_durability: 60, price: 40, icon: '🧥' },
        { name: 'Бронежилет', description: 'Военный бронежилет', type: 'armor', category: 'body', rarity: 'rare', slot: 'body', set_id: 1, stats: { defense: 25, radiation_resist: 6, infection_resist: 4 }, durability: 150, max_durability: 150, price: 300, icon: '🦺' },
        { name: 'Армейская каска', description: 'Защита головы', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', set_id: 1, stats: { defense: 10, infection_resist: 5 }, durability: 90, max_durability: 90, price: 80, icon: '⛑️' },
        { name: 'Военные перчатки', description: 'Перчатки пехоты: защита рук', type: 'armor', category: 'hands', rarity: 'uncommon', slot: 'hands', set_id: 1, stats: { defense: 6 }, durability: 100, max_durability: 100, price: 110, icon: '🧤' },
        { name: 'Военные ботинки', description: 'Армейские ботинки: защита ног', type: 'armor', category: 'boots', rarity: 'uncommon', slot: 'boots', set_id: 1, stats: { defense: 8 }, durability: 100, max_durability: 100, price: 120, icon: '🥾' },
        { name: 'Противогаз', description: 'Респиратор: защита от радиации и инфекций', type: 'armor', category: 'head', rarity: 'uncommon', slot: 'head', set_id: 2, stats: { radiation_resist: 18, infection_resist: 12 }, durability: 100, max_durability: 100, price: 100, icon: '😷' },
        { name: 'Медицинский халат', description: 'Халат полевого медика', type: 'armor', category: 'body', rarity: 'uncommon', slot: 'body', set_id: 2, stats: { defense: 4, radiation_resist: 5, heal_bonus: 10 }, durability: 90, max_durability: 90, price: 140, icon: '🥼' },
        { name: 'Медицинские перчатки', description: 'Перчатки с антисептиком', type: 'armor', category: 'hands', rarity: 'uncommon', slot: 'hands', set_id: 2, stats: { defense: 4, infection_resist: 10, heal_bonus: 10 }, durability: 90, max_durability: 90, price: 130, icon: '🧤' },
        { name: 'Медицинский рюкзак', description: 'Рюкзак с аптечками', type: 'armor', category: 'accessory', rarity: 'uncommon', slot: 'accessory', set_id: 2, stats: { defense: 3, infection_resist: 5, heal_bonus: 10 }, durability: 90, max_durability: 90, price: 150, icon: '🎒' },
        { name: 'Сталкерский плащ', description: 'Плащ сталкера: защита от радиации', type: 'armor', category: 'body', rarity: 'rare', slot: 'body', set_id: 3, stats: { defense: 15, radiation_resist: 25 }, durability: 140, max_durability: 140, price: 400, icon: '🧥' },
        { name: 'Сталкерские сапоги', description: 'Сапоги для долгих переходов', type: 'armor', category: 'boots', rarity: 'rare', slot: 'boots', set_id: 3, stats: { defense: 12, radiation_resist: 5 }, durability: 130, max_durability: 130, price: 350, icon: '🥾' },
        { name: 'Сталкерский пояс', description: 'Пояс с карго: повышает удачу', type: 'armor', category: 'accessory', rarity: 'rare', slot: 'accessory', set_id: 3, stats: { defense: 4, luck: 5, radiation_resist: 5 }, durability: 120, max_durability: 120, price: 380, icon: '🧭' },
        { name: 'Сталкерские перчатки', description: 'Перчатки с защитой от радиации', type: 'armor', category: 'hands', rarity: 'rare', slot: 'hands', set_id: 3, stats: { defense: 10, radiation_resist: 15 }, durability: 130, max_durability: 130, price: 360, icon: '🧤' },
        { name: 'Бандитская куртка', description: 'Куртка мародёра', type: 'armor', category: 'body', rarity: 'common', slot: 'body', set_id: 4, stats: { defense: 8 }, durability: 70, max_durability: 70, price: 90, icon: '🧥' },
        { name: 'Бандитская бандана', description: 'Маска бандита', type: 'armor', category: 'head', rarity: 'common', slot: 'head', set_id: 4, stats: { defense: 4 }, durability: 60, max_durability: 60, price: 60, icon: '🥷' },
        { name: 'Бандитские наручи', description: 'Наручи из подручных материалов', type: 'armor', category: 'hands', rarity: 'uncommon', slot: 'hands', set_id: 4, stats: { defense: 7 }, durability: 90, max_durability: 90, price: 110, icon: '🧤' },
        // Боеприпасы. Патроны — расходник для улучшения любого стрелкового оружия,
        // реактивные гранаты — только для реактивной пушки. Дорогие и редкие:
        // их выдают боссы 7-10 и рейды, поэтому пушка остаётся «козырной».
        { name: 'Патроны', description: 'Патроны для стрелкового оружия', type: 'resource', category: 'ammo', rarity: 'uncommon', stackable: true, price: 20, icon: '🔩' },
        { name: 'Реактивные гранаты', description: 'Реактивные гранаты для трубы', type: 'resource', category: 'ammo', rarity: 'rare', stackable: true, price: 120, icon: '🚀' },
        // Ключи боссов. Имя предмета — «Ключ от <имя босса>», и именно
        // bosses.required_key_id ссылается на предмет с таким именем
        // (см. wireBossKeys ниже). Хранятся ключи в boss_keys, а не в
        // инвентаре: это валюта прогрессии, а не вещь, которая занимает слот.
        { name: 'Ключ от Бездомного психа', description: 'Открывает бой с Бездомным психом', type: 'key', category: 'key', rarity: 'uncommon', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Медведя-мутанта', description: 'Открывает бой с Медведем-мутантом', type: 'key', category: 'key', rarity: 'rare', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Военного дрона', description: 'Открывает бой с Военным дроном', type: 'key', category: 'key', rarity: 'rare', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Главаря мародёров', description: 'Открывает бой с Главой мародёров', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Биологического ужаса', description: 'Открывает бой с Биологическим ужасом', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Офицера-нежить', description: 'Открывает бой с Офицером-нежитью', type: 'key', category: 'key', rarity: 'epic', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Гигантского монстра', description: 'Открывает бой с Гигантским монстром', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Профессора безумия', description: 'Открывает бой с Профессором безумия', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️' },
        { name: 'Ключ от Последнего стража', description: 'Открывает финальный бой с Последним стражем', type: 'key', category: 'key', rarity: 'legendary', stackable: true, price: 0, icon: '🗝️' },
        // Товары за звёзды (stars_price): монеты и звёзды — две валюты,
        // иначе звёзды из достижений и заданий некуда тратить.
        { name: 'Нейроимплант', description: 'Улучшает реакцию и интеллект', type: 'food', category: 'consumable', rarity: 'epic', price: 500, stars_price: 5, icon: '🧠', stats: { energy: 25 } },
        { name: 'Стимулятор', description: 'Мощный допинг', type: 'food', category: 'consumable', rarity: 'epic', price: 600, stars_price: 6, icon: '💥', stats: { energy: 30 } },
        { name: 'Нано-аптечка', description: 'Мгновенное лечение', type: 'medicine', category: 'medicine', rarity: 'epic', price: 800, stars_price: 8, icon: '🏥', stats: { health: 50 } },
        { name: 'Радиа-кур', description: 'Полная защита от радиации', type: 'medicine', category: 'medicine', rarity: 'epic', price: 1000, stars_price: 10, icon: '🛡️', stats: { radiation_cure: 5 } },
        { name: 'Сыворотка мутанта', description: 'Мутантная сыворотка: энергия как у зверя', type: 'food', category: 'consumable', rarity: 'legendary', price: 2000, icon: '🧬', stats: { energy: 50 } },
        { name: 'Реаниматор', description: 'Полное восстановление здоровья из госзапаса', type: 'medicine', category: 'medicine', rarity: 'legendary', price: 5000, stars_price: 50, icon: '💉', stats: { health: 100 } },
        { name: 'Экзо-костюм', description: 'Тяжёлая броня из армейского склада', type: 'armor', category: 'body', rarity: 'epic', slot: 'body', stats: { defense: 50, radiation_resist: 30 }, durability: 300, max_durability: 300, price: 3000, stars_price: 60, icon: '🤖' },
        { name: 'Броня стражей', description: 'Легендарная броня последнего убежища', type: 'armor', category: 'body', rarity: 'legendary', slot: 'body', stats: { defense: 80, radiation_resist: 50 }, durability: 500, max_durability: 500, price: 15000, stars_price: 200, icon: '👑' }
    ];

    // UPSERT, а не DO NOTHING. Именно из-за DO NOTHING на проде оставались
    // stats = {}, price и category первых версий сида: у всех расходников
    // /use не находил ни одного обновления («этот предмет нельзя
    // использовать»), а защита брони нигде не учитывалась. Теперь каталог —
    // единый источник правды и на новой БД, и на существующей.
    for (const item of items) {
        await query(`
            INSERT INTO items (name, description, type, category, rarity, stackable, max_stack,
                               slot, set_id, stats, durability, max_durability, ammo_type, price, stars_price, icon)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (name, type) DO UPDATE SET
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                rarity = EXCLUDED.rarity,
                stackable = EXCLUDED.stackable,
                max_stack = EXCLUDED.max_stack,
                slot = EXCLUDED.slot,
                set_id = EXCLUDED.set_id,
                stats = EXCLUDED.stats,
                durability = EXCLUDED.durability,
                max_durability = EXCLUDED.max_durability,
                ammo_type = EXCLUDED.ammo_type,
                price = EXCLUDED.price,
                stars_price = EXCLUDED.stars_price,
                icon = EXCLUDED.icon
        `, [
            item.name, item.description, item.type, item.category, item.rarity || 'common',
            item.stackable !== false, Math.max(1, Number(item.max_stack) || 99),
            item.slot || null, item.set_id || null, JSON.stringify(item.stats || {}),
            item.durability || 100, item.max_durability || 100, item.ammo_type || 'none',
            item.price || 0, item.stars_price || 0, item.icon
        ]);
    }

    // Сеты предметов (бонус за 2/3/4 надетых части) и связь items.set_id.
    await seedSets();

    // Боссы — последними: они ссылаются на предметы по имени.
    await seedBosses();
}

/**
 * Сеты снаряжения.
 *
 * Поля bonus_2/bonus_3/bonus_4 — бонус за 2/3/4 надетых предмета сета.
 * Поддерживаемые ключи (остальные игнорируются):
 *   damage, defense — урон и защита;
 *   luck — прибавка к удаче (шанс находки);
 *   radiation_resist / infection_resist — стойкость к зоне;
 *   heal_bonus — процент к лечению расходниками;
 *   energy_bonus — плоская прибавка к энергии из расходников.
 * Считает их public/shared/equipment.js → calculateSetBonuses().
 */
async function seedSets() {
    const sets = [
        {
            id: 1,
            name: 'Военный сет',
            description: 'Армейская экипировка выжившего',
            icon: '🎖️',
            bonus_2: { defense: 6, radiation_resist: 4 },
            bonus_3: { defense: 12, infection_resist: 6, radiation_resist: 8 },
            bonus_4: { defense: 18, infection_resist: 10, radiation_resist: 12, heal_bonus: 10 }
        },
        {
            id: 2,
            name: 'Медицинский сет',
            description: 'Оборудование для выживания',
            icon: '🏥',
            bonus_2: { heal_bonus: 10, infection_resist: 6 },
            bonus_3: { heal_bonus: 20, infection_resist: 10 },
            bonus_4: { heal_bonus: 30, infection_resist: 14, radiation_resist: 10 }
        },
        {
            id: 3,
            name: 'Сталкерский сет',
            description: 'Экипировка для исследования зоны',
            icon: '🎒',
            bonus_2: { luck: 3, defense: 4 },
            bonus_3: { luck: 7, radiation_resist: 10 },
            bonus_4: { luck: 12, radiation_resist: 18, defense: 10, heal_bonus: 10 }
        },
        {
            id: 4,
            name: 'Бандитский сет',
            description: 'Оружие и защита мародёра',
            icon: '💣',
            bonus_2: { damage: 4, defense: 4 },
            bonus_3: { damage: 9, defense: 6 },
            bonus_4: { damage: 15, defense: 10, heal_bonus: 10 }
        }
    ];

    // Сначала убираем возможные дубли по имени (старые сиды могли добавить
    // копию), иначе ON CONFLICT (id) оставил бы две строки с одним именем.
    await query(`
        DELETE FROM item_sets newer
         USING item_sets older
         WHERE newer.name = older.name
           AND newer.id > older.id
    `);

    for (const set of sets) {
        await query(`
            INSERT INTO item_sets (id, name, description, icon, bonus_2, bonus_3, bonus_4)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                icon = EXCLUDED.icon,
                bonus_2 = EXCLUDED.bonus_2,
                bonus_3 = EXCLUDED.bonus_3,
                bonus_4 = EXCLUDED.bonus_4
        `, [
            set.id, set.name, set.description, set.icon,
            JSON.stringify(set.bonus_2), JSON.stringify(set.bonus_3), JSON.stringify(set.bonus_4)
        ]);
    }

    // Связь «предмет -> сет» живёт в items.set_id (источник правды для бонусов).
    // Таблицу item_set_items тоже наполняем, чтобы она не была пустой
    // декорацией: по ней видно, какие предметы входят в сет.
    await query(`
        INSERT INTO item_set_items (set_id, item_id, piece_number)
        SELECT i.set_id, i.id,
               ROW_NUMBER() OVER (PARTITION BY i.set_id ORDER BY i.id)
          FROM items i
         WHERE i.set_id IS NOT NULL
        ON CONFLICT DO NOTHING
    `);
}

/**
 * Боссы: параметры боя, ключи и награды предметами.
 *
 * damage — процент от max_health игрока за один удар босса (ретралиация).
 * Раньше колонка была мёртвой: бой с боссом вообще не стоил здоровья.
 * key_drop_chance — шанс (в процентах от дропа), что найденная в луте
 * находка окажется ключом от этого босса (routes/game/world.js).
 * keys_required — сколько ключей ЭТОГО босса нужно, чтобы открыть следующего.
 */
// damage — процент от max_health игрока за ответный удар босса.
// Кривая подобрана так, чтобы первый бой (500 HP, ~50 ударов ножом) проходил
// с одной аптечкой, а финальный босс реально угрожал: броня срезает максимум
// 60%, поэтому 12% у «Последнего стража» — это ~2-4 удара без защиты.
async function seedBosses() {
    // key — имя предмета-ключа, который открывает бой с этим боссом.
    // Склеивать его из имени босса нельзя: ключи названы в родительном падеже
    // («Ключ от Бездомного психа»), а bosses.name — в именительном.
    const bosses = [
        { name: 'Крысиный король', key: null, description: 'Огромная радиоактивная крыса', max_health: 500, damage: 2, key_drop_chance: 2.5, reward_experience: 50, reward_coins: 25, icon: '🐀', loot: ['Металлолом', 'Консервы', 'Ткань'] },
        { name: 'Бездомный псих', key: 'Ключ от Бездомного психа', description: 'Сумасшедший выживший с монтировкой', max_health: 2000, damage: 3, key_drop_chance: 1.25, reward_experience: 100, reward_coins: 50, icon: '🔪', loot: ['Пластик', 'Бинт', 'Спирт', 'Топор'] },
        { name: 'Медведь-мутант', key: 'Ключ от Медведя-мутанта', description: 'Радиоактивный медведь', max_health: 5000, damage: 4, key_drop_chance: 0.625, reward_experience: 200, reward_coins: 100, icon: '🐻', loot: ['Ткань', 'Аптечка', 'Пистолет', 'Обрез'] },
        { name: 'Военный дрон', key: 'Ключ от Военного дрона', description: 'Боевой дрон с системой охраны', max_health: 10000, damage: 5, key_drop_chance: 0.3125, reward_experience: 400, reward_coins: 200, icon: '🤖', loot: ['Патроны', 'Электроника', 'Армейская каска', 'Автомат'] },
        { name: 'Главарь мародёров', key: 'Ключ от Главаря мародёров', description: 'Лидер банды радиоактивных бандитов', max_health: 20000, damage: 6, key_drop_chance: 0.15625, reward_experience: 800, reward_coins: 400, icon: '💀', loot: ['Провода', 'Дробовик', 'Бандитская куртка'] },
        { name: 'Биологический ужас', key: 'Ключ от Биологического ужаса', description: 'Мутировавшее существо из лаборатории', max_health: 40000, damage: 7, key_drop_chance: 0.078125, reward_experience: 1500, reward_coins: 750, icon: '👾', loot: ['Химикаты', 'Антидот', 'Бронежилет', 'Винтовка Мосина'] },
        { name: 'Офицер-нежить', key: 'Ключ от Офицера-нежить', description: 'Бывший военный офицер', max_health: 70000, damage: 8, key_drop_chance: 0.0390625, reward_experience: 3000, reward_coins: 1500, icon: '💂', loot: ['Титан', 'Реактивные гранаты', 'Нано-аптечка', 'Военные перчатки'] },
        { name: 'Гигантский монстр', key: 'Ключ от Гигантского монстра', description: 'Колоссальное существо', max_health: 100000, damage: 9, key_drop_chance: 0.01953125, reward_experience: 6000, reward_coins: 3000, icon: '🦖', loot: ['Титан', 'Снайперская винтовка', 'Сталкерский плащ', 'Реактивные гранаты'] },
        { name: 'Профессор безумия', key: 'Ключ от Профессора безумия', description: 'Учёный, сошедший с ума', max_health: 150000, damage: 10, key_drop_chance: 0.009765625, reward_experience: 12000, reward_coins: 6000, icon: '🧑‍🔬', loot: ['Уран', 'Радиа-кур', 'Пулемёт', 'Экзо-костюм'] },
        { name: 'Последний страж', key: 'Ключ от Последнего стража', description: 'Последний защитник бункера', max_health: 250000, damage: 12, key_drop_chance: 0.0048828125, reward_experience: 25000, reward_coins: 12500, icon: '🛡️', loot: ['Кристалл силы', 'Реактивная пушка', 'Броня стражей', 'Реактивные гранаты'] }
    ];

    for (const boss of bosses) {
        // reward_items хранит item_id, поэтому предметы должны уже существовать:
        // отсюда порядок вызовов в seedDatabase().
        const rewardItems = await resolveLootItemIds(boss.loot);
        const keyItemId = boss.key ? await resolveKeyItemId(boss.key) : null;

        await query(`
            INSERT INTO bosses (name, description, max_health, damage, key_drop_chance,
                                keys_required, required_key_id, reward_experience, reward_coins, reward_items, icon)
            VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)
            ON CONFLICT (name) DO UPDATE SET
                description = EXCLUDED.description,
                max_health = EXCLUDED.max_health,
                damage = EXCLUDED.damage,
                key_drop_chance = EXCLUDED.key_drop_chance,
                keys_required = EXCLUDED.keys_required,
                required_key_id = EXCLUDED.required_key_id,
                reward_experience = EXCLUDED.reward_experience,
                reward_coins = EXCLUDED.reward_coins,
                reward_items = EXCLUDED.reward_items,
                icon = EXCLUDED.icon
        `, [
            boss.name, boss.description, boss.max_health, boss.damage, boss.key_drop_chance,
            keyItemId, boss.reward_experience, boss.reward_coins, JSON.stringify(rewardItems), boss.icon
        ]);
    }

    // Если ссылка указывает на несуществующий предмет (ключ ещё не засеян или
    // строку каталога удалили) — обнуляем: UI не должен показывать ключ,
    // который получить невозможно.
    await query(`
        UPDATE bosses
           SET required_key_id = NULL
         WHERE required_key_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM items k WHERE k.id = bosses.required_key_id)
    `);
}

/** id предмета-ключа по имени (null, если такого ключа нет в каталоге) */
async function resolveKeyItemId(name) {
    const result = await query(
        `SELECT id FROM items WHERE type = 'key' AND name = $1 LIMIT 1`,
        [name]
    );
    return result.rows[0]?.id ?? null;
}

/**
 * Превратить список имён предметов в [{item_id, quantity}].
 * Неизвестные имена пропускаем, а не падаем: сид не должен ронять старт.
 */
async function resolveLootItemIds(names) {
    if (!Array.isArray(names) || names.length === 0) return [];

    const result = await query(
        'SELECT id, name FROM items WHERE name = ANY($1::text[])',
        [names]
    );
    const byName = new Map(result.rows.map((row) => [row.name, row.id]));

    const items = [];
    for (const name of names) {
        const itemId = byName.get(name);
        if (itemId) items.push({ item_id: itemId, quantity: 1 });
    }
    return items;
}

/**
 * Переименования предметов: переносит инвентари игроков и удаляет старые строки.
 *
 * Зачем: сид работает по (name, type), поэтому переименование создало бы НОВУЮ
 * строку каталога, а старая осталась бы жить второй «Снайперкой» — у игроков
 * в инвентарях остались бы предметы, которых больше нет в магазине и которые
 * нельзя ни починить, ни улучшить по новым правилам.
 *
 * Порядок: вызывается ПОСЛЕ seedDatabase() (новые предметы уже созданы)
 * и ДО repairPlayerInventories().
 *
 * Идемпотентно: если старой строки нет — ничего не делаем.
 *
 * @returns {Promise<number>} сколько предметов перенесено
 */
async function applyItemRenames() {
    const renames = [
        // Фантастика заменена реальным арсеналом постапокалипсиса.
        { from: ['Плазменный пистолет', 'weapon'], to: ['Пистолет ТТ', 'weapon'] },
        { from: ['Лазерная винтовка', 'weapon'], to: ['Реактивная пушка', 'weapon'] },
        { from: ['Снайперка', 'weapon'], to: ['Снайперская винтовка', 'weapon'] },
        { from: ['Эликсир бессмертия', 'medicine'], to: ['Реаниматор', 'medicine'] }
    ];

    let moved = 0;

    for (const rename of renames) {
        const [fromName, fromType] = rename.from;
        const [toName, toType] = rename.to;

        const source = await query(
            'SELECT id FROM items WHERE name = $1 AND type = $2',
            [fromName, fromType]
        );
        const target = await query(
            'SELECT id FROM items WHERE name = $1 AND type = $2',
            [toName, toType]
        );

        const oldId = source.rows[0]?.id;
        const newId = target.rows[0]?.id;

        // Переименование уже применено (или целевого предмета нет) — пропускаем.
        if (!oldId || !newId || oldId === newId) continue;

        // Инвентарь: меняем id, сохраняя количество, прочность и улучшения.
        const players = await query(`
            SELECT id, inventory, equipment
              FROM players
             WHERE jsonb_typeof(inventory) = 'array'
                OR jsonb_typeof(equipment) = 'object'
        `);

        for (const playerRow of players.rows) {
            const inventory = normalizeInventoryForRepair(playerRow.inventory);
            const equipment = normalizeEquipmentForRepair(playerRow.equipment);

            let playerMoved = 0;
            const nextInventory = inventory.map((entry) => {
                if (!entry || Number(entry.id) !== Number(oldId)) return entry;
                playerMoved++;
                return { ...entry, id: Number(newId), name: toName };
            });

            let equipmentMoved = 0;
            for (const slot of Object.keys(equipment)) {
                const item = equipment[slot];
                if (!item || Number(item.id) !== Number(oldId)) continue;
                equipment[slot] = { ...item, id: Number(newId), name: toName };
                equipmentMoved++;
            }

            if (playerMoved === 0 && equipmentMoved === 0) continue;

            await query(
                'UPDATE players SET inventory = $1::jsonb, equipment = $2::jsonb WHERE id = $3',
                [JSON.stringify(nextInventory), JSON.stringify(equipment), playerRow.id]
            );
            moved += playerMoved + equipmentMoved;
        }

        // Старая строка больше не нужна: предмет живёт под новым именем.
        await query('DELETE FROM items WHERE id = $1', [oldId]);
        console.warn(`[migrate] Переименование «${fromName}» -> «${toName}», перенесено предметов: ${moved}`);
    }

    return moved;
}

/**
 * Ремонт данных игроков: инвентари и экипировка приводятся к каталогу.
 *
 * Что чинит (по данным аудита прод-базы):
 * 1) Фантомные предметы `{"id": 1}` / `{"id": 2}` из webhook.js — таких id в
 *    таблице items нет, поэтому предмет нельзя было ни продать, ни применить
 *    (в них лежали hunger/thirst — поля другой версии игры). Переводим на
 *    настоящие «Консервы»/«Воду» по имени.
 * 2) Ключи боссов лежали в инвентаре обычными предметами, хотя бой открывает
 *    только boss_keys. Переносим количество в boss_keys, предмет убираем.
 * 3) Предметы, чей id исчез из каталога (удалённые легаси-строки),
 *    компенсируем монетами по редкости — иначе игрок терял предмет молча.
 * 4) Дописываем в предметы поля каталога, которых в старых записях нет:
 *    price (нужен для цены ремонта), set_id (бонусы сетов), rarity, stats и
 *    прочность. Старое снаряжение без них получало «вечную» прочность.
 * 5) Восстанавливаем счётчики прогресса: unique_items (достижения
 *    «Коллекционер»/«Хранитель») и locations_visited («Путешественник») —
 *    их никто не обновлял, прогресс всегда был 0.
 *
 * Идемпотентно: если чинить нечего — UPDATE не выполняется.
 * ВАЖНО: вызывается ПОСЛЕ seedDatabase()/seedSets() (нужен актуальный каталог)
 * и ДО mergeDuplicateInventoryStacks().
 *
 * @returns {Promise<number>} сколько игроков реально изменилось
 */
async function repairPlayerInventories() {
    // Ленивый require: game-helpers тянет db/database, который к этому моменту
    // уже загружен, поэтому цикла зависимостей не возникает.
    const { SELL_FLOOR_BY_RARITY } = require('../utils/game-helpers');

    const itemRows = await query(`
        SELECT id, name, type, category, rarity, icon, slot, set_id, price, stats,
               stackable, max_stack, durability, max_durability
          FROM items
    `);
    if (itemRows.rows.length === 0) return 0;

    const catalog = new Map(itemRows.rows.map((row) => [String(row.id), row]));
    // Поиск по имени — единственный способ опознать предмет без валидного id.
    const byName = new Map(itemRows.rows.map((row) => [String(row.name), row]));

    // item_id ключа -> id босса, чей ключ это (владелец ключа = предыдущий
    // босс: ключ от N открывает бой с N+1).
    const keyOwners = new Map();
    const bossRows = await query('SELECT id, required_key_id FROM bosses WHERE required_key_id IS NOT NULL');
    for (const boss of bossRows.rows) {
        keyOwners.set(String(boss.required_key_id), Math.max(1, Number(boss.id) - 1));
    }

    const players = await query(`
        SELECT id, inventory, equipment FROM players
         WHERE jsonb_typeof(inventory) = 'array'
            OR jsonb_typeof(equipment) = 'object'
    `);

    let changed = 0;
    for (const playerRow of players.rows) {
        const inventory = normalizeInventoryForRepair(playerRow.inventory);
        const equipment = normalizeEquipmentForRepair(playerRow.equipment);

        const keyGrants = new Map();
        let coins = 0;
        const repaired = [];

        for (const entry of inventory) {
            if (!entry || typeof entry !== 'object') continue;

            const row = resolveCatalogRow(entry, catalog, byName);
            if (!row) {
                // Предмета больше нет в каталоге: компенсируем монетами.
                const rarity = String(entry.rarity || 'common');
                coins += SELL_FLOOR_BY_RARITY[rarity] || SELL_FLOOR_BY_RARITY.common;
                continue;
            }

            const quantity = Math.max(1, Number(entry.quantity) || 1);

            if (String(row.type) === 'key') {
                const ownerBossId = keyOwners.get(String(row.id));
                if (ownerBossId && ownerBossId > 0) {
                    keyGrants.set(ownerBossId, (keyGrants.get(ownerBossId) || 0) + quantity);
                    continue; // ключ уходит в boss_keys, слот освобождается
                }
            }

            repaired.push(mergeInventoryEntryWithCatalog(entry, row));
        }

        for (const slot of Object.keys(equipment)) {
            const entry = equipment[slot];
            if (!entry || typeof entry !== 'object') {
                delete equipment[slot];
                continue;
            }
            const row = resolveCatalogRow(entry, catalog, byName);
            equipment[slot] = row ? mergeInventoryEntryWithCatalog(entry, row) : entry;
        }

        const inventoryChanged = JSON.stringify(repaired) !== JSON.stringify(inventory);
        const equipmentChanged = JSON.stringify(equipment) !== JSON.stringify(playerRow.equipment || {});

        if (!inventoryChanged && !equipmentChanged && coins === 0 && keyGrants.size === 0) {
            continue;
        }

        for (const [bossId, quantity] of keyGrants) {
            await query(`
                INSERT INTO boss_keys (player_id, boss_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (player_id, boss_id)
                DO UPDATE SET quantity = boss_keys.quantity + EXCLUDED.quantity
            `, [playerRow.id, bossId, quantity]);
        }

        if (coins > 0) {
            await query('UPDATE players SET coins = coins + $1 WHERE id = $2', [coins, playerRow.id]);
        }

        if (inventoryChanged || equipmentChanged) {
            await query(
                'UPDATE players SET inventory = $1::jsonb, equipment = $2::jsonb WHERE id = $3',
                [JSON.stringify(repaired), JSON.stringify(equipment), playerRow.id]
            );
        }

        await syncProgressCounters(playerRow.id);
        changed += 1;
    }

    if (changed > 0) {
        console.warn(`[migrate] Починено инвентарей игроков: ${changed}`);
    }
    return changed;
}

/** Привести инвентарь к массиву объектов (значение может быть JSON-строкой) */
function normalizeInventoryForRepair(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return [];
        }
    }
    if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === 'object');
    if (parsed && typeof parsed === 'object') return Object.values(parsed).filter((item) => item && typeof item === 'object');
    return [];
}

/** Привести экипировку к объекту «слот -> предмет» */
function normalizeEquipmentForRepair(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return {};
        }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/**
 * Найти строку каталога для предмета игрока: сначала по id, затем по имени.
 * Смена id не должна ломать предмет — фантомные «id: 1» опознаются по имени.
 */
function resolveCatalogRow(entry, catalog, byName) {
    const rawId = Number(entry.id);
    if (Number.isFinite(rawId) && catalog.has(String(rawId))) {
        return catalog.get(String(rawId));
    }

    const name = String(entry.name || '').trim();
    return name && byName.has(name) ? byName.get(name) : null;
}

/**
 * Дописать в предмет игрока поля каталога, которых в нём нет.
 *
 * price и прочность берём ИЗ КАТАЛОГА, а не из записи игрока: старые записи
 * хранят цену и прочность первой версии сида (Бита 25/30 вместо 45/35), из-за
 * чего ремонт стоил бы не по каталожной цене, а изношенный предмет считался бы
 * «вечно новым». Уровень улучшения (upgrade_level) сохраняем: его задаёт игрок.
 */
function mergeInventoryEntryWithCatalog(entry, row) {
    const hasStats = entry.stats && typeof entry.stats === 'object' && Object.keys(entry.stats).length > 0;
    const stats = hasStats ? entry.stats : (row.stats || {});

    const catalogMax = Math.max(1, Number(row.max_durability) || Number(row.durability) || 100);
    const entryMax = Math.max(1, Number(entry.max_durability || entry.durability) || catalogMax);
    const rawDurability = entry.durability === undefined || entry.durability === null
        ? catalogMax
        : Number(entry.durability) || 0;

    // Предмет, который раньше не изнашивался (прочность == своему максимуму),
    // считаем новым: прочность как механика появилась только сейчас.
    const wasUnused = rawDurability >= entryMax;
    const durability = wasUnused ? catalogMax : Math.max(0, Math.min(catalogMax, rawDurability));

    return {
        ...entry,
        id: Number(row.id),
        name: entry.name || row.name,
        type: row.type,
        category: entry.category || row.category || row.type,
        rarity: entry.rarity || row.rarity,
        icon: entry.icon || row.icon || '📦',
        slot: entry.slot || row.slot || null,
        set_id: entry.set_id || row.set_id || null,
        price: Number(row.price) || 0,
        stats,
        durability,
        max_durability: catalogMax
    };
}

/**
 * Обновить unique_items и locations_visited.
 * Достижения «Коллекционер»/«Хранитель»/«Путешественник» читали эти поля,
 * но никто их не наполнял — прогресс всегда оставался 0.
 */
async function syncProgressCounters(playerId) {
    await query(`
        UPDATE players p
           SET unique_items = COALESCE((
                   SELECT jsonb_agg(DISTINCT entry->'id')
                     FROM jsonb_array_elements(COALESCE(p.inventory, '[]'::jsonb)) entry
                    WHERE entry->'id' IS NOT NULL
               ), '[]'::jsonb),
               locations_visited = CASE
                   WHEN p.current_location_id IS NULL
                       THEN COALESCE(p.locations_visited, '[]'::jsonb)
                   ELSE (
                       SELECT jsonb_agg(DISTINCT visited_id)
                         FROM jsonb_array_elements_text(
                             COALESCE(p.locations_visited, '[]'::jsonb)
                             || jsonb_build_array(p.current_location_id::text)
                         ) AS visited_id
                   )
               END
         WHERE p.id = $1
    `, [playerId]);
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
    seedAchievements,
    mergeDuplicateInventoryStacks,
    applyItemRenames,
    repairPlayerInventories
};
