/**
 * 0?CA: <83@0F89 : AE5<=K5 87<5=5=8O + 25@A8>=8@>20==K5 SQL-<83@0F88 +
 * @5<>=B=K5 ?@>F54C@K (?5@58<5=>20=8O, A2>@0G820=85 4C1;59 8 B.4.).
 *
 * K45;5= 87 db/init.js, GB>1K @0745;8BL:
 * - +!" + AB0@B ?@8;>65=8O (createTables + seedDatabase  845<?>B5=B=>, 157>?0A=>)
 * - "/+ <83@0F88 (ALTER TABLE, DROP, DELETE, @5<>=B 40==KE  >B45;L=0O :><0=40)
 *
 * A?>;L7>20=85:
 *   node db/migrate.js          # ?@8<5=8BL 2A5 =5?@8<5=Q==K5 <83@0F88
 *   node db/migrate.js --help   # A?@02:0
 *
 * 83@0F88 845<?>B5=B=K: :0640O 70?8AL 2 schema_migrations 30@0=B8@C5B,
 * GB> <83@0F8O 2K?>;=5=0 @>2=> >48= @07.
 */

const fs = require('fs');
const path = require('path');
const { pool, transaction, describeError, isConnectionError } = require('./database');
const { logger } = require('../utils/log');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * "01;8F0 schema_migrations E@0=8B 25@A88 ?@8<5=Q==KE <83@0F89.
 */
async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
}

/**
 * >;CG8BL A?8A>: C65 ?@8<5=Q==KE <83@0F89.
 */
async function getAppliedMigrations(client) {
    const result = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
    );
    return new Set(result.rows.map((row) => row.version));
}

/**
 * >;CG8BL A?8A>: 4>ABC?=KE D09;>2 <83@0F89 (.sql), >BA>@B8@>20==KE ?> 8<5=8.
 */
function getAvailableMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        return [];
    }
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.sql') && fs.statSync(path.join(MIGRATIONS_DIR, file)).isFile())
        .sort();
}

/**
 * @8<5=8BL >4=C <83@0F8N 87 SQL-D09;0.
 */
async function applyMigration(client, migrationFile, version) {
    const sql = fs.readFileSync(
        path.join(MIGRATIONS_DIR, migrationFile),
        'utf-8'
    );
    if (!sql.trim()) {
        logger.info(`[migrate] 83@0F8O ${version} ?CAB0O, ?@>?CA:05<`);
        await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
            [version]
        );
        return;
    }
    await client.query(sql);
    await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [version]
    );
    logger.info(`[migrate] @8<5=5=0 <83@0F8O: ${version}`);
}

/**
 * 0?CAB8BL 2A5 =5?@8<5=Q==K5 SQL-<83@0F88 2 B@0=70:F88.
 */
async function runSqlMigrations() {
    const files = getAvailableMigrations();
    if (files.length === 0) {
        logger.info('[migrate] SQL-<83@0F88 =5 =0945=K, ?@>?CA:05<');
        return;
    }

    const applied = await transaction(async (client) => {
        await ensureMigrationsTable(client);
        const appliedSet = await getAppliedMigrations(client);

        let count = 0;
        for (const file of files) {
            const version = file.replace(/\.sql$/, '');
            if (appliedSet.has(version)) {
                continue;
            }
            await applyMigration(client, file, version);
            count++;
        }
        return { total: files.length, applied: count };
    });

    logger.info(`[migrate] SQL-<83@0F88: ${applied.applied} 87 ${applied.total} ?@8<5=5=K`);
}

/**
 * 0?CAB8BL AE5<=K5 <83@0F88 (845<?>B5=B=K5 ALTER TABLE ADD COLUMN IF NOT EXISTS 8 B.?.).
 * K45;5=K 2 >B45;L=CN DC=:F8N 4;O C4>1AB20 B5AB8@>20=8O.
 */
async function runSchemaMigrations() {
    // 5=82K9 require: schema.js BO6Q;0O 8 =C6=0 B>;L:> ?@8 <83@0F88
    const { createTables, runMigrations } = require('./schema');
    await createTables();
    await runMigrations();
    logger.info('[migrate] !E5<=K5 <83@0F88 ?@8<5=5=K');
}

/**
 * 0?CAB8BL @5<>=B=K5 ?@>F54C@K 40==KE.
 */
async function runDataRepairs() {
    const {
        applyItemRenames,
        repairPlayerInventories,
        mergeDuplicateInventoryStacks
    } = require('./schema');

    // 5@58<5=>20=8O  A@07C ?>A;5 AE5<K: =>2K5 ?@54<5BK C65 A>740=K,
    // AB0@K5 AB@>:8 :0B0;>30 5IQ 5ABL, ?@54<5BK 83@>:>2 =0 =8E AAK;0NBAO.
    await applyItemRenames();
    logger.info('[migrate] 5@58<5=>20=8O ?@54<5B>2 ?@8<5=5=K');

    // =20;848@C5< :MH ;CB0: ?>A;5 ?5@58<5=>20=8O ?@54<5B>2 AB0@K5 id
    // 2 lootPoolCache AB0=>2OBAO =520;84=K<8, =>2K5  >BACBAB2CNB.
    try {
        const lootCache = require('../utils/lootCache');
        lootCache.clearLootCache();
        logger.info('[migrate] MH ;CB0 A1@>H5= ?>A;5 ?5@58<5=>20=89');
    } catch (cacheError) {
        logger.warn('[migrate] 5 C40;>AL A1@>A8BL :MH ;CB0: ' + cacheError.message);
    }

    //  5<>=B 84QB 4> A;8O=8O AB5:>2: >= G8=8B A>AB02 8=25=B0@O
    // (D0=B><=K5 id, :;NG8 2 boss_keys), 0 C65 ?>B>< AB5:8 A2>@0G820NBAO.
    await repairPlayerInventories();
    logger.info('[migrate]  5<>=B 83@>:>2 7025@HQ=');

    await mergeDuplicateInventoryStacks();
    logger.info('[migrate] !2>@0G820=85 4C1;59 8=25=B0@O 7025@H5=>');
}

/**
 * >;=K9 F8:; <83@0F89.
 */
async function runAllMigrations() {
    // @>25@:0 4>ABC?=>AB8 
    await pool.query({ text: 'SELECT 1', timeout: 5000 });

    // 1. !E5<=K5 <83@0F88 (845<?>B5=B=K5 ALTER TABLE)
    await runSchemaMigrations();

    // 2. 5@A8>=8@>20==K5 SQL-<83@0F88 (DROP TABLE, DELETE, 8 B.?.)
    await runSqlMigrations();

    // 3.  5<>=B=K5 ?@>F54C@K 40==KE (?5@58<5=>20=8O, A2>@0G820=85 4C1;59)
    await runDataRepairs();
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('A?>;L7>20=85: node db/migrate.js [--help]');
    console.log('@8<5=O5B 2A5 =5?@8<5=Q==K5 <83@0F88 .');
    process.exit(0);
}

// ">G:0 2E>40: 5A;8 70?CI5= =0?@O<CN (=5 G5@57 require)
if (require.main === module) {
    runAllMigrations()
        .then(async () => {
            logger.info('[migrate] A5 <83@0F88 CA?5H=> ?@8<5=5=K');
            try { await pool.end(); } catch { /* ignore */ }
            process.exit(0);
        })
        .catch(async (error) => {
            logger.error(`[migrate] H81:0 <83@0F88: ${describeError(error)}`);
            if (isConnectionError(error)) {
                logger.error('[migrate] H81:0 ?>4:;NG5=8O : . @>25@LB5 =0AB@>9:8.');
            }
            try { await pool.end(); } catch { /* ignore */ }
            process.exit(1);
        });
}

// C1;8G=K9 API  B>;L:> B>, GB> 2K7K205BAO A=0@C68 (index.js, db/migrate.js :0:
// CLI, B5ABK). "@8 A;C651=K5 DC=:F88 (A>740=85 B01;8FK <83@0F89, GB5=85
// ?@8<5=Q==KE 8 A?8A>: D09;>2) 8A?>;L7CNBAO ", 2=CB@8 MB>3> D09;0 8 87
// M:A?>@B>2 C1@0=K: verify-dead-exports.js ?>:07K20; 8E :0: <Q@B2K5.
module.exports = {
    runAllMigrations,
    runSchemaMigrations,
    runSqlMigrations,
    runDataRepairs
};
