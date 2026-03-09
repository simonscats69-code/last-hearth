/**
 * Скрипт миграции базы данных
 * Создаёт БД и таблицы
 * 
 * Запуск: npm run migrate
 */

require('dotenv').config();
const { Pool } = require('pg');

// Для Supabase сразу подключаемся к БД postgres
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: 'postgres', // Supabase использует БД postgres
    ssl: { rejectUnauthorized: false } // Для Supabase нужен SSL
});

async function createDatabase() {
    // Supabase уже имеет БД "postgres" - пропускаем создание
    console.log('ℹ️ Используем существующую базу данных Supabase');
}

async function createTables() {
    // Подключаемся к нашей БД
    const gamePool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: 'postgres', // Supabase использует БД postgres
        ssl: { rejectUnauthorized: false }
    });

    const tables = [
        // Основная таблица игроков
        `CREATE TABLE IF NOT EXISTS players (
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
            hunger INTEGER DEFAULT 100,
            thirst INTEGER DEFAULT 100,
            radiation INTEGER DEFAULT 0,
            fatigue INTEGER DEFAULT 0,
            energy INTEGER DEFAULT 50,
            max_energy INTEGER DEFAULT 50,
            infection_count INTEGER DEFAULT 0,
            infections JSONB DEFAULT '[]',
            broken_bones BOOLEAN DEFAULT false,
            broken_leg BOOLEAN DEFAULT false,
            broken_arm BOOLEAN DEFAULT false,
            
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
        )`,
        
        // Локации
        `CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            radiation INTEGER DEFAULT 0,
            required_luck INTEGER DEFAULT 0,
            is_red_zone BOOLEAN DEFAULT false,
            loot_table JSONB DEFAULT '[]'
        )`,
        
        // Предметы
        `CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            type VARCHAR(50),
            rarity VARCHAR(20) DEFAULT 'common',
            stats JSONB DEFAULT '{}',
            craftable BOOLEAN DEFAULT false,
            craft_recipe JSONB DEFAULT '[]',
            sell_price INTEGER DEFAULT 0,
            buy_price INTEGER DEFAULT 0
        )`,
        
        // Рецепты
        `CREATE TABLE IF NOT EXISTS recipes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            result_item_id INTEGER,
            result_quantity INTEGER DEFAULT 1,
            ingredients JSONB DEFAULT '[]',
            required_level INTEGER DEFAULT 1,
            station VARCHAR(50) DEFAULT 'hand'
        )`,
        
        // Боссы
        `CREATE TABLE IF NOT EXISTS bosses (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            health INTEGER DEFAULT 1000,
            damage INTEGER DEFAULT 50,
            rewards JSONB DEFAULT '{}',
            required_keys INTEGER DEFAULT 0,
            boss_order INTEGER DEFAULT 0,
            is_clan_boss BOOLEAN DEFAULT false
        )`,
        
        // Кланы
        `CREATE TABLE IF NOT EXISTS clans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            leader_id VARCHAR(50) NOT NULL,
            members JSONB DEFAULT '[]',
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            resources JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        
        // Барахолка
        `CREATE TABLE IF NOT EXISTS market_listings (
            id SERIAL PRIMARY KEY,
            seller_id VARCHAR(50) NOT NULL,
            item_id INTEGER NOT NULL,
            item_data JSONB DEFAULT '{}',
            quantity INTEGER DEFAULT 1,
            price INTEGER DEFAULT 0,
            stars_price INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            expires_at TIMESTAMP
        )`,
        
        // Достижения
        `CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            player_id VARCHAR(50) NOT NULL,
            achievement_id VARCHAR(50) NOT NULL,
            progress INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT false,
            completed_at TIMESTAMP,
            UNIQUE(player_id, achievement_id)
        )`,
        
        // Сезоны
        `CREATE TABLE IF NOT EXISTS seasons (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            start_date TIMESTAMP NOT NULL,
            end_date TIMESTAMP NOT NULL,
            rewards JSONB DEFAULT '{}',
            active BOOLEAN DEFAULT false
        )`,
        
        // Статистика сезона
        `CREATE TABLE IF NOT EXISTS season_rating (
            id SERIAL PRIMARY KEY,
            season_id INTEGER NOT NULL,
            player_id VARCHAR(50) NOT NULL,
            points INTEGER DEFAULT 0,
            last_updated TIMESTAMP DEFAULT NOW(),
            UNIQUE(season_id, player_id)
        )`,
        
        // Ежедневные задания
        `CREATE TABLE IF NOT EXISTS daily_tasks (
            id SERIAL PRIMARY KEY,
            player_id VARCHAR(50) NOT NULL,
            task_type VARCHAR(50) NOT NULL,
            target INTEGER DEFAULT 1,
            progress INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT false,
            claimed BOOLEAN DEFAULT false,
            date DATE DEFAULT CURRENT_DATE,
            UNIQUE(player_id, task_type, date)
        )`,
        
        // PvP матчи
        `CREATE TABLE IF NOT EXISTS pvp_matches (
            id SERIAL PRIMARY KEY,
            attacker_id VARCHAR(50) NOT NULL,
            defender_id VARCHAR(50) NOT NULL,
            attacker_damage INTEGER DEFAULT 0,
            defender_damage INTEGER DEFAULT 0,
            winner_id VARCHAR(50),
            timestamp TIMESTAMP DEFAULT NOW()
        )`,
        
        // Индексы
        `CREATE INDEX IF NOT EXISTS idx_players_telegram_id ON players(telegram_id)`,
        `CREATE INDEX IF NOT EXISTS idx_locations_radiation ON locations(radiation)`,
        `CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id)`,
        `CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id)`,
        `CREATE INDEX IF NOT EXISTS idx_daily_tasks_player_date ON daily_tasks(player_id, date)`
    ];

    for (const sql of tables) {
        try {
            await gamePool.query(sql);
            console.log(`✅ Таблица создана`);
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
        }
    }

    // Заполняем начальными данными
    await seedData(gamePool);
    
    await gamePool.end();
}

async function seedData(pool) {
    console.log('📦 Заполнение начальными данными...');
    
    // Локации
    const locations = [
        { name: 'Спальный район', description: 'Тихий район с покинутыми домами', radiation: 0, required_luck: 1 },
        { name: 'Рынок', description: 'Оживлённая торговая площадь', radiation: 5, required_luck: 10 },
        { name: 'Больница', description: 'Заброшенная больница с медикаментами', radiation: 15, required_luck: 20 },
        { name: 'Промзона', description: 'Опасная промышленная зона', radiation: 30, required_luck: 35 },
        { name: 'Центр города', description: 'Сердце мёртвого города', radiation: 50, required_luck: 50 },
        { name: 'Военная база', description: 'Секретная военная база', radiation: 70, required_luck: 65 },
        { name: 'Бункер', description: 'Подземное убежище выживших', radiation: 100, required_luck: 90 }
    ];
    
    for (const loc of locations) {
        await pool.query(
            `INSERT INTO locations (name, description, radiation, required_luck) 
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [loc.name, loc.description, loc.radiation, loc.required_luck]
        );
    }
    console.log('✅ Локации созданы');
    
    // Предметы
    const items = [
        // Еда
        { name: 'Консервы', description: 'Протухшие консервы', type: 'food', rarity: 'common', sell_price: 5, buy_price: 10 },
        { name: 'Вода', description: 'Бутылка воды', type: 'drink', rarity: 'common', sell_price: 3, buy_price: 7 },
        { name: 'Антибиотики', description: 'Лекарство от инфекций', type: 'medicine', rarity: 'rare', sell_price: 50, buy_price: 100 },
        { name: 'Антирад', description: 'Препарат от радиации', type: 'medicine', rarity: 'rare', sell_price: 75, buy_price: 150 },
        
        // Оружие
        { name: 'Нож', description: 'Простой нож', type: 'weapon', rarity: 'common', stats: { damage: 10 }, sell_price: 20, buy_price: 40 },
        { name: 'Кастет', description: 'Стальной кастет', type: 'weapon', rarity: 'common', stats: { damage: 15 }, sell_price: 35, buy_price: 70 },
        { name: 'Бита', description: 'Бейсбольная бита', type: 'weapon', rarity: 'common', stats: { damage: 20 }, sell_price: 45, buy_price: 90 },
        { name: 'Пистолет', description: '9мм пистолет', type: 'weapon', rarity: 'rare', stats: { damage: 35 }, sell_price: 200, buy_price: 400 },
        { name: 'Автомат', description: 'Автоматическая винтовка', type: 'weapon', rarity: 'epic', stats: { damage: 50 }, sell_price: 500, buy_price: 1000 },
        
        // Броня
        { name: 'Кожаная куртка', description: 'Простая защита', type: 'armor', rarity: 'common', stats: { defense: 5 }, sell_price: 30, buy_price: 60 },
        { name: 'Бронежилет', description: 'Военный бронежилет', type: 'armor', rarity: 'rare', stats: { defense: 20 }, sell_price: 250, buy_price: 500 },
        
        // Материалы
        { name: 'Дрова', description: 'Горючие дрова', type: 'material', rarity: 'common', sell_price: 2, buy_price: 5 },
        { name: 'Металлолом', description: 'Кусок металла', type: 'material', rarity: 'common', sell_price: 5, buy_price: 10 },
        { name: 'Ткань', description: 'Обрывки ткани', type: 'material', rarity: 'common', sell_price: 3, buy_price: 7 },
        { name: 'Проволока', description: 'Моток проволоки', type: 'material', rarity: 'common', sell_price: 8, buy_price: 15 }
    ];
    
    for (const item of items) {
        await pool.query(
            `INSERT INTO items (name, description, type, rarity, stats, sell_price, buy_price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
            [item.name, item.description, item.type, item.rarity, JSON.stringify(item.stats || {}), item.sell_price, item.buy_price]
        );
    }
    console.log('✅ Предметы созданы');
    
    // Боссы
    const bosses = [
        { name: 'Крыса-мутант', description: 'Огромная крыса', health: 100, damage: 10, required_keys: 0, boss_order: 1 },
        { name: 'Бродяга', description: 'Опасный мародёр', health: 500, damage: 25, required_keys: 1, boss_order: 2 },
        { name: 'Собака-мутант', description: 'Стая мутировавших собак', health: 1000, damage: 40, required_keys: 2, boss_order: 3 },
        { name: 'Охотник', description: 'Безжалостный наёмник', health: 2500, damage: 60, required_keys: 3, boss_order: 4 },
        { name: 'Медведь-мутант', description: 'Гигантский медведь', health: 5000, damage: 80, required_keys: 4, boss_order: 5 },
        { name: 'Военный робот', description: 'Сломанный боевой дрон', health: 10000, damage: 100, required_keys: 5, boss_order: 6 },
        { name: 'Генерал', description: 'Командующий группировкой', health: 20000, damage: 150, required_keys: 6, boss_order: 7 },
        { name: 'Чумной доктор', description: 'Безумный учёный', health: 35000, damage: 200, required_keys: 7, boss_order: 8 },
        { name: 'Мегазомби', description: 'Гигантский зомби', health: 50000, damage: 250, required_keys: 8, boss_order: 9 },
        { name: 'Эпицентр', description: 'Источник заражения', health: 100000, damage: 350, required_keys: 9, boss_order: 10 }
    ];
    
    for (const boss of bosses) {
        await pool.query(
            `INSERT INTO bosses (name, description, health, damage, required_keys, boss_order) 
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [boss.name, boss.description, boss.health, boss.damage, boss.required_keys, boss.boss_order]
        );
    }
    console.log('✅ Боссы созданы');
    
    console.log('🎉 Миграция завершена!');
}

async function main() {
    console.log('🚀 Начало миграции базы данных...\n');
    
    try {
        await createDatabase();
        await createTables();
        console.log('\n✅ Миграция успешно завершена!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Миграция не удалась:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
