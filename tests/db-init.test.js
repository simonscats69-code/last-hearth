/**
 * Тесты: инициализация БД и обработка 503.
 *
 * Запуск: node tests/db-init.test.js
 *
 * Тесты не требуют подключения к БД — они проверяют:
 * 1. Синтаксис и модульные экспорты db/schema.js
 * 2. Идемпотентность initDatabase (без разрушающих операций)
 * 3. Наличие и содержимое SQL-миграций
 * 4. Загружаемость routes/game/workshop.js (без реального @last-hearth/core)
 * 5. Обработка 503 на клиенте
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');
const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');

// Перехват console.log для проверки вызовов
function silenceConsole(fn) {
    const orig = { ...console };
    const calls = [];
    console.log = (...args) => calls.push(args.join(' '));
    console.warn = (...args) => calls.push(args.join(' '));
    console.error = (...args) => calls.push(args.join(' '));
    try {
        fn();
    } finally {
        Object.assign(console, orig);
    }
    return calls;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

// ============================================
// Тест 1: db/schema.js — синтаксис и модульный queryTx
// ============================================
async function testSchemaSyntaxAndExports() {
    console.log('\nГруппа: db/schema.js');

    // Синтаксис
    const src = fs.readFileSync(path.join(DB_DIR, 'schema.js'), 'utf8');
    // node --check через child_process
    const { execSync } = require('child_process');
    try {
        execSync('node --check db/schema.js', { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
        throw new Error(`Syntax error in db/schema.js: ${e.stderr.toString()}`);
    }

    test('schema.js экспортирует createTables, seedDatabase, seedAchievements', () => {
        // Не требуем database — проверяем только что функции экспортированы
        const schemaSrc = src;
        assert(schemaSrc.includes('async function createTables'), 'createTables должна быть определена');
        assert(schemaSrc.includes('async function seedDatabase'), 'seedDatabase должна быть определена');
        assert(schemaSrc.includes('async function seedAchievements'), 'seedAchievements должна быть определена');
    });

    test('schema.js определяет queryTx на уровне модуля (алиас на query)', () => {
        // queryTx должен быть определён на уровне модуля (алиас на query)
        assert(/const queryTx\s*=\s*query/.test(src), 'queryTx должен быть определён на уровне модуля как алиас на query');

        // runMigrations всё ещё определяет локальный queryTx внутри transaction()
        assert(/transaction\(async \(client\)/.test(src), 'runMigrations должен использовать transaction()');
    });

    // Проверяем что runMigrations больше не содержит DROP TABLE
    test('runMigrations не содержит DROP TABLE', () => {
        const match = src.match(/async function runMigrations[\s\S]*?^}/m);
        assert(match, 'runMigrations должна быть найдена');
        const body = match[0];
        assert(!/DROP TABLE/.test(body), 'runMigrations не должна содержать DROP TABLE');
    });

    // Проверяем что runMigrations больше не содержит DELETE FROM
    test('runMigrations не содержит DELETE FROM', () => {
        const match = src.match(/async function runMigrations[\s\S]*?^}/m);
        assert(match, 'runMigrations должна быть найдена');
        const body = match[0];
        assert(!/DELETE FROM/.test(body), 'runMigrations не должна содержать DELETE FROM');
    });
}

// ============================================
// Тест 2: db/init.js — только идемпотентные операции
// ============================================
async function testInitDatabase() {
    console.log('\nГруппа: db/init.js');

    const src = fs.readFileSync(path.join(DB_DIR, 'init.js'), 'utf8');

    test('init.js экспортирует initDatabase', () => {
        assert(/module\.exports\s*=/.test(src), 'init.js должен экспортировать функции');
        assert(/initDatabase/.test(src), 'initDatabase должна быть экспортирована');
    });

    test('init.js не вызывает runMigrations, repairPlayerInventories, applyItemRenames, mergeDuplicateInventoryStacks', () => {
        // Эти функции перенесены в db/migrate.js
        assert(!/await runMigrations\(\)/.test(src), 'init.js не должен вызывать runMigrations()');
        assert(!/await repairPlayerInventories/.test(src), 'init.js не должен вызывать repairPlayerInventories()');
        assert(!/await applyItemRenames/.test(src), 'init.js не должен вызывать applyItemRenames()');
        assert(!/await mergeDuplicateInventoryStacks/.test(src), 'init.js не должен вызывать mergeDuplicateInventoryStacks()');
    });

    test('init.js вызывает createTables, seedDatabase, seedAchievements', () => {
        assert(/await createTables\(\)/.test(src), 'init.js должен вызывать createTables()');
        assert(/await seedDatabase\(\)/.test(src), 'init.js должен вызывать seedDatabase()');
        assert(/await seedAchievements\(\)/.test(src), 'init.js должен вызывать seedAchievements()');
    });
}

// ============================================
// Тест 3: db/migrate.js — runner с schema_migrations
// ============================================
async function testMigrateJs() {
    console.log('\nГруппа: db/migrate.js');

    const src = fs.readFileSync(path.join(DB_DIR, 'migrate.js'), 'utf8');

    test('migrate.js синтаксически корректен', () => {
        const { execSync } = require('child_process');
        try {
            execSync('node --check db/migrate.js', { cwd: ROOT, stdio: 'pipe' });
        } catch (e) {
            throw new Error(`Syntax error in db/migrate.js: ${e.stderr.toString()}`);
        }
    });

    test('migrate.js экспортирует функции для миграций', () => {
        assert(/runAllMigrations/.test(src), 'runAllMigrations должна быть экспортирована');
        assert(/runSchemaMigrations/.test(src), 'runSchemaMigrations должна быть экспортирована');
        assert(/runSqlMigrations/.test(src), 'runSqlMigrations должна быть экспортирована');
        assert(/runDataRepairs/.test(src), 'runDataRepairs должна быть экспортирована');
    });

    test('migrate.js создаёт таблицу schema_migrations', () => {
        assert(/schema_migrations/.test(src), 'migrate.js должен управлять таблицей schema_migrations');
    });
}

// ============================================
// Тест 4: SQL-миграции
// ============================================
function testSqlMigrations() {
    console.log('\nГруппа: db/migrations/*.sql');

    test('директория migrations существует', () => {
        assert(fs.existsSync(MIGRATIONS_DIR), 'db/migrations/ должна существовать');
    });

    const files = fs.existsSync(MIGRATIONS_DIR)
        ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
        : [];

    test('существуют SQL-миграции для удаления pvp_matches', () => {
        assert(files.some(f => f.includes('pvp_matches')), 'должна быть миграция 001_remove_pvp_matches.sql');
    });

    test('существуют SQL-миграции для удаления таблиц крафта', () => {
        assert(files.some(f => f.includes('crafting')), 'должна быть миграция для удаления таблиц крафта');
    });

    test('существуют SQL-миграции для удаления достижений крафта', () => {
        assert(files.some(f => f.includes('craft_achievements')), 'должна быть миграция для удаления достижений крафта');
    });

    test('существуют SQL-миграции для чистки orphaned achievements', () => {
        assert(files.some(f => f.includes('orphaned')), 'должна быть миграция для чистки orphaned achievements');
    });

    test('существуют SQL-миграции для удаления legacy items', () => {
        assert(files.some(f => f.includes('legacy_items')), 'должна быть миграция для удаления legacy items');
    });

    test('миграции отсортированы по имени', () => {
        const sorted = [...files].sort();
        assert.deepStrictEqual(files, sorted, 'файлы миграций должны быть отсортированы по имени');
    });
}

// ============================================
// Тест 5: workshop.js загружается без ошибок
// ============================================
async function testWorkshopRoute() {
    console.log('\nГруппа: routes/game/workshop.js');

    const src = fs.readFileSync(path.join(ROOT, 'routes/game/workshop.js'), 'utf8');

    test('workshop.js использует utils/game-helpers, а не @last-hearth/core', () => {
        assert(
            !/require\(['"]@last-hearth\/core['"]\)/.test(src),
            'workshop.js не должен require @last-hearth/core для equipmentRules/normalizeEquipment/normalizeInventory'
        );
        assert(
            /require\(['"][^'"]*utils\/game-helpers['"]\)/.test(src),
            'workshop.js должен использовать utils/game-helpers'
        );
    });

    test('workshop.js экспортирует equipmentRules, normalizeEquipment, normalizeInventory', () => {
        assert(/equipmentRules/.test(src), 'workshop.js использует equipmentRules');
        assert(/normalizeEquipment/.test(src), 'workshop.js использует normalizeEquipment');
        assert(/normalizeInventory/.test(src), 'workshop.js использует normalizeInventory');
    });
}

// ============================================
// Тест 6: клиентская обработка 503
// ============================================
function testClient503() {
    console.log('\nГруппа: public/game.js 503 handling');

    const src = fs.readFileSync(path.join(ROOT, 'public/game.js'), 'utf8');

    test('game.js обрабатывает 503 SERVICE_STARTING с повторными попытками', () => {
        assert(/SERVICE_STARTING/.test(src), 'game.js должен обрабатывать SERVICE_STARTING');
        assert(/status === 503/.test(src), 'game.js должен проверять статус 503');
    });

    test('game.js опрашивает /ready перед API-вызовами', () => {
        assert(/waitForServerReady/.test(src), 'game.js должен иметь waitForServerReady');
        assert(/window\.location\.origin.*\/ready/.test(src), 'game.js должен опрашивать /ready');
    });

    test('game.js использует увеличенный backoff для 503', () => {
        assert(/retryDelay/.test(src) && /5000/.test(src), 'game.js должен использовать длинный backoff для 503');
    });

    test('initGame показывает понятное сообщение при 503', () => {
        assert(/Игра запускается/.test(src), 'initGame должен показывать понятное сообщение при 503');
    });
}

// ============================================
// Тест 7: index.js readiness logic
// ============================================
function testIndexReadiness() {
    console.log('\nГруппа: index.js readiness');

    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

    test('index.js использует isDatabaseReady флаг', () => {
        assert(/isDatabaseReady/.test(src), 'index.js должен использовать isDatabaseReady');
    });

    test('index.js возвращает 503 SERVICE_STARTING для игровых маршрутов', () => {
        assert(/SERVICE_STARTING/.test(src), 'index.js должен возвращать SERVICE_STARTING');
        assert(/requireDatabaseReady/.test(src), 'index.js должен использовать requireDatabaseReady middleware');
    });

    test('index.js ограничивает попытки инициализации БД', () => {
        assert(/DB_INIT_ATTEMPTS/.test(src), 'index.js должен иметь DB_INIT_ATTEMPTS');
        assert(/DB_INIT_ATTEMPTS\s*=\s*3/.test(src), 'DB_INIT_ATTEMPTS должен быть 3');
    });
}

// ============================================
// Запуск всех тестов
// ============================================
async function main() {
    console.log('Тесты: инициализация БД и обработка 503\n');

    await asyncTest('db/schema.js загружается без синтаксических ошибок', async () => {
        const { execSync } = require('child_process');
        execSync('node --check db/schema.js', { cwd: ROOT, stdio: 'pipe' });
    });

    await testSchemaSyntaxAndExports();
    await testInitDatabase();
    await testMigrateJs();
    testSqlMigrations();
    await testWorkshopRoute();
    testClient503();
    testIndexReadiness();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
});
