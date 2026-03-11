/**
 * Скрипт миграции базы данных
 * Создаёт БД и таблицы
 * 
 * Запуск: npm run migrate
 * 
 * Примечание: Не требует dotenv - использует переменные окружения BotHost напрямую
 */

const { Pool } = require('pg');

// Подключение к PostgreSQL
// Используем DATABASE_URL если доступна (BotHost), иначе отдельные переменные
let poolConfig;

if (process.env.DATABASE_URL) {
    // DATABASE_URL уже содержит все параметры подключения
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Для Supabase нужен SSL
    };
    console.log('ℹ️ Используем DATABASE_URL для подключения');
} else {
    // Используем отдельные переменные окружения
    poolConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    console.log('ℹ️ Используем отдельные переменные DB_* для подключения');
}

// Для Supabase сразу подключаемся к БД postgres
const pool = new Pool(poolConfig);

async function createDatabase() {
    // Supabase уже имеет БД "postgres" - пропускаем создание
    // Также поддерживаем DATABASE_URL напрямую
    if (process.env.DATABASE_URL) {
        console.log('ℹ️ Подключаемся к базе данных через DATABASE_URL');
    } else {
        console.log('ℹ️ Подключаемся к базе данных через DB_* переменные');
    }
}

async function createTables() {
    // Используем тот же пул для createTables
    const gamePool = new Pool(poolConfig);

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
        `CREATE INDEX IF NOT EXISTS idx_daily_tasks_player_date ON daily_tasks(player_id, date)`,
        `CREATE INDEX IF NOT EXISTS idx_players_radiation_expires ON players((radiation->>'expires_at')) WHERE radiation IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_players_infections_expires ON players((infections[0]->>'expires_at')) WHERE infections IS NOT NULL AND jsonb_array_length(infections) > 0`
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
    
    // Таблица достижений игроков
    await pool.query(`
        CREATE TABLE IF NOT EXISTS player_achievements (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            achievement_key VARCHAR(50) NOT NULL,
            rewarded_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, achievement_key)
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_achievements_player ON player_achievements(player_id)
    `);
    console.log('✅ Таблица достижений создана');
    
    // Таблица логов игроков
    await pool.query(`
        CREATE TABLE IF NOT EXISTS player_logs (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            action VARCHAR(100) NOT NULL,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_player_logs_player ON player_logs(player_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_player_logs_action ON player_logs(action)
    `);
    console.log('✅ Таблица логов создана');
    
    console.log('🎉 Миграция завершена!');
}

async function main() {
    console.log('🚀 Начало миграции базы данных...\n');
    
    try {
        await createDatabase();
        await createTables();
        
        // Миграция дебаффов
        await migrateDebuffs();
        
        console.log('\n✅ Миграция успешно завершена!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Миграция не удалась:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

/**
 * Миграция системы дебаффов
 * - Удаление старых полей: hunger, thirst, broken_bones, broken_leg, broken_arm
 * - Изменение radiation: INTEGER -> JSONB
 * - Конвертация infection_count в массив infections
 */
async function migrateDebuffs() {
    console.log('\n🔄 Миграция системы дебаффов...');
    
    const gamePool = new Pool(poolConfig);
    
    try {
        // 1. Удаляем старые поля состояния
        console.log('📝 Удаление старых полей состояния...');
        
        const oldFields = [
            'hunger',
            'thirst', 
            'broken_bones',
            'broken_leg',
            'broken_arm'
        ];
        
        for (const field of oldFields) {
            try {
                await gamePool.query(`ALTER TABLE players DROP COLUMN IF EXISTS ${field}`);
                console.log(`   ✅ ${field} удалён`);
            } catch (err) {
                console.log(`   ⚠️ ${field}: ${err.message}`);
            }
        }
        
        // 2. Конвертируем radiation из INTEGER в JSONB
        console.log('📝 Конвертация radiation в JSONB...');
        
        const radCheck = await gamePool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'players' AND column_name = 'radiation'
        `);
        
        if (radCheck.rows.length > 0 && radCheck.rows[0].data_type === 'integer') {
            // Конвертируем INTEGER -> JSONB
            await gamePool.query(`
                UPDATE players 
                SET radiation = jsonb_build_object(
                    'level',
                    CASE 
                        WHEN radiation > 10 THEN 10 
                        WHEN radiation < 0 THEN 0 
                        ELSE radiation 
                    END,
                    'expires_at',
                    CASE 
                        WHEN radiation > 0 THEN NOW() + INTERVAL '6 hours'
                        ELSE NULL
                    END,
                    'applied_at',
                    CASE 
                        WHEN radiation > 0 THEN NOW()
                        ELSE NULL
                    END
                )
                WHERE radiation > 0 OR radiation IS NOT NULL
            `);
            console.log('   ✅ radiation конвертирован в JSONB');
        } else {
            console.log('   ✅ radiation уже в формате JSONB');
        }
        
        // 3. Конвертируем infection_count в массив infections
        console.log('📝 Конвертация infection_count в infections...');
        
        const infCheck = await gamePool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'players' AND column_name = 'infection_count'
        `);
        
        if (infCheck.rows.length > 0) {
            // Переносим infection_count в infections как первый элемент
            await gamePool.query(`
                UPDATE players 
                SET infections = jsonb_build_array(
                    jsonb_build_object(
                        'type', 'zombie_infection',
                        'level', GREATEST(0, infection_count),
                        'expires_at', CASE WHEN infection_count > 0 THEN NOW() + INTERVAL '12 hours' ELSE NULL END,
                        'applied_at', CASE WHEN infection_count > 0 THEN NOW() ELSE NULL END
                    )
                )
                WHERE infection_count > 0
            `);
            
            // Удаляем колонку infection_count
            await gamePool.query(`ALTER TABLE players DROP COLUMN IF EXISTS infection_count`);
            console.log('   ✅ infection_count конвертирован в infections');
        } else {
            console.log('   ✅ infections уже в правильном формате');
        }
        
        // 4. Обновляем предметы для лечения дебаффов
        console.log('📝 Обновление предметов лечения дебаффов...');
        
        // Антибиотики (от инфекций)
        await gamePool.query(`
            UPDATE items 
            SET stats = stats || '{"infection_cure": 2}'::jsonb
            WHERE name = 'Антибиотики' AND (stats->>'infection_cure') IS NULL
        `);
        
        // Аптечка (от радиации + здоровье)
        await gamePool.query(`
            UPDATE items 
            SET stats = COALESCE(stats, '{}'::jsonb) || '{"radiation_cure": 2, "heal": 30}'::jsonb
            WHERE name = 'Аптечка' 
        `);
        
        // Антирад (мощное средство от радиации)
        await gamePool.query(`
            UPDATE items 
            SET stats = stats || '{"radiation_cure": 4}'::jsonb
            WHERE name = 'Антирад' AND (stats->>'radiation_cure') IS NULL
        `);
        
        // Добавляем укол если его нет
        const injectionExists = await gamePool.query(
            `SELECT id FROM items WHERE name = 'Укол' LIMIT 1`
        );
        
        if (injectionExists.rows.length === 0) {
            await gamePool.query(`
                INSERT INTO items (name, description, type, rarity, stats, sell_price, buy_price)
                VALUES ('Укол', 'Инъекция от инфекций', 'medicine', 'epic', '{"infection_cure": 3}', 150, 300)
            `);
            console.log('   ✅ Добавлен предмет: Укол');
        }
        
        console.log('✅ Миграция дебаффов завершена!');
        
    } finally {
        await gamePool.end();
    }
}

main();
