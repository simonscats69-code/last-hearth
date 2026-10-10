/**
 * Тест P0-2: двойное начисление награды за достижение.
 *
 * Модель БД: snapshot на BEGIN / restore на ROLLBACK, записи применяются
 * НЕМЕДЛЕННО (эмуляция блокировки строки) — тогда параллельный запрос
 * видит результат первого и получает 0 строк от атомарного UPDATE.
 *
 * Также проверяет найденный по пути P0-2 баг: logPlayerAction использовался
 * в game-helpers.js, но не был импортирован -> ReferenceError -> /achievements/claim
 * всегда отвечал 500.
 */
const Module = require('module');
const path = require('path');

// --- In-memory «БД» -------------------------------------------------------
const db = {
    players: [{ id: 5, coins: 100, stars: 0 }],
    achievements: [
        { id: 3, name: 'Первое убийство', reward: { coins: 500, stars: 2 }, category: 'boss' },
        { id: 9, name: 'Незавершённое', reward: { coins: 100, stars: 0 }, category: 'test' },
        { id: 11, name: 'Сломаная награда', reward: { coins: 777, stars: 0 }, category: 'test' }
    ],
    player_achievements: [
        { id: 1, player_id: 5, achievement_id: 3, completed: true, reward_claimed: false },
        { id: 2, player_id: 5, achievement_id: 9, completed: false, reward_claimed: false },
        { id: 3, player_id: 5, achievement_id: 11, completed: true, reward_claimed: false }
    ],
    grantLog: [],
    breakGrant: false
};

const snapshots = [];

function snapshot() {
    snapshots.push(JSON.parse(JSON.stringify({
        players: db.players,
        player_achievements: db.player_achievements,
        grantLog: db.grantLog
    })));
}
function restore() {
    const s = snapshots.pop();
    if (s) {
        db.players = s.players;
        db.player_achievements = s.player_achievements;
        db.grantLog = s.grantLog;
    }
}

const sqlLog = [];

function makeClient() {
    // Журнал отмены ЭТОЙ транзакции: ROLLBACK откатывает только свои
    // изменения. Общий снапшот неверен — провал параллельной
    // транзакции стёр бы успешные записи победителя.
    const undo = [];

    const setField = (obj, key, value) => {
        undo.push({ obj, key, old: obj[key] });
        obj[key] = value;
    };

    return {
        applyRollback: () => {
            for (let i = undo.length - 1; i >= 0; i--) {
                const u = undo[i];
                if (u.pop) { u.array.pop(); continue; }
                u.obj[u.key] = u.old;
            }
            undo.length = 0;
        },
        query: async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();
            sqlLog.push(s);

            // SELECT достижения + прогресса (LEFT JOIN)
            if (/FROM achievements a[\s\S]*LEFT JOIN player_achievements/.test(s)) {
                const pa = db.player_achievements.find(p => p.player_id === params[0] && p.achievement_id === params[1]);
                const a = db.achievements.find(x => x.id === params[1]);
                if (!a) return { rows: [] };
                return {
                    rows: [{
                        id: a.id, name: a.name, reward: a.reward, category: a.category,
                        completed: pa ? pa.completed : null,
                        reward_claimed: pa ? pa.reward_claimed : null
                    }]
                };
            }

            // АТОМАРНАЯ пометка: применяется немедленно, поэтому параллельный
            // запрос увидит reward_claimed = true и получит 0 строк.
            if (/UPDATE player_achievements\s+SET reward_claimed = true[\s\S]*AND reward_claimed = false/.test(s)) {
                const row = db.player_achievements.find(p => p.player_id === params[0]
                    && p.achievement_id === params[1]
                    && p.completed === true
                    && p.reward_claimed === false);
                if (!row) return { rows: [], rowCount: 0 };
                setField(row, 'reward_claimed', true);
                setField(row, 'claimed_at', new Date());
                return { rows: [{ achievement_id: params[1] }], rowCount: 1 };
            }

            // Перечитывание для точного сообщения об ошибке
            if (/SELECT completed, reward_claimed[\s\S]*FROM player_achievements/.test(s)) {
                const pa = db.player_achievements.find(p => p.player_id === params[0] && p.achievement_id === params[1]);
                return { rows: pa ? [{ completed: pa.completed, reward_claimed: pa.reward_claimed }] : [] };
            }

            // Начисление валюты: grantCurrencyReward собирает coins И stars
            // в ОДИН UPDATE с параметрами [playerId, coins, stars].
            if (/UPDATE players SET (coins = coins \+ \$2|stars = stars \+ \$3)/.test(s)) {
                if (db.breakGrant) {
                    const err = new Error('Boom: начисление упало');
                    err.simulated = true;
                    throw err;
                }
                const pl = db.players.find(x => x.id === params[0]);
                if (/coins = coins \+ \$2/.test(s)) {
                    setField(pl, 'coins', pl.coins + params[1]);
                    db.grantLog.push({ playerId: params[0], coins: params[1] });
                    undo.push({ array: db.grantLog, pop: true });
                }
                // $3 = звёзды (params[2]); если звёзд нет, ветки в SQL не будет
                if (/stars = stars \+ \$3/.test(s)) {
                    setField(pl, 'stars', pl.stars + params[2]);
                    db.grantLog.push({ playerId: params[0], stars: params[2] });
                    undo.push({ array: db.grantLog, pop: true });
                }
                return { rows: [], rowCount: 1 };
            }

            // Баланс
            if (/SELECT coins, stars FROM players WHERE id = \$1/.test(s)) {
                const pl = db.players.find(x => x.id === params[0]);
                return { rows: [{ coins: pl ? pl.coins : 0, stars: pl ? pl.stars : 0 }] };
            }

            if (/INSERT INTO player_logs/.test(s)) return { rows: [] };
            return { rows: [] };
        }
    };
}

const dbMock = {
    query: async () => ({ rows: [] }),
    queryOne: async () => null,
    queryAll: async () => [],
    describeError: (e) => e && e.message,
    transaction: async (fn) => {
        const client = makeClient();
        try {
            return await fn(client);
        } catch (e) {
            // ROLLBACK отменяет ТОЛЬКО изменения этой транзакции:
            // общий снапшот откатил бы и успешные записи параллельной tx.
            client.applyRollback();
            throw e;
        }
    }
};

const serverApiMock = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    safeJsonParse: (v, d) => (typeof v === 'string' ? JSON.parse(v) : (v == null ? d : v)),
    safeStringify: JSON.stringify,
    logPlayerAction: async () => {},
    logPlayerError: async () => {},
    handleError: (res, e) => {
        res.statusCode = e.statusCode || 500;
        res.body = { success: false, error: e.message, code: e.code };
    }
};

const originalLoad = Module._load;
Module._load = function (request) {
    // utils/game-helpers.js лежит в utils/, поэтому его пути — относительно utils/
    if (request === '../db/database') return dbMock;
    if (request === './serverApi') return serverApiMock;
    if (request === '../public/shared/equipment.js') {
        return require(path.join(__dirname, 'public/shared/equipment.js'));
    }
    return originalLoad.apply(this, arguments);
};

const helpers = require(path.join(__dirname, 'utils/game-helpers.js'));
Module._load = originalLoad;

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

async function run() {
    console.log('=== P0-2a: два ПАРАЛЛЕЛЬНЫХ claim одного достижения ===');
    console.log('  старт: coins =', db.players[0].coins, '| reward_claimed =', db.player_achievements[0].reward_claimed);

    const results = await Promise.allSettled([
        helpers.claimAchievementReward(5, 3),
        helpers.claimAchievementReward(5, 3)
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    fulfilled.forEach(r => console.log('    + ' + r.value.message));
    rejected.forEach(r => console.log('    - ' + (r.reason && r.reason.message) + ' [' + (r.reason && r.reason.code) + ']'));

    ok('ровно ОДИН запрос получил награду', fulfilled.length === 1, fulfilled.length);
    ok('второй отклонён с ALREADY_CLAIMED',
        rejected.length === 1 && rejected[0].reason && rejected[0].reason.code === 'ALREADY_CLAIMED',
        rejected.map(r => r.reason && r.reason.code).join(','));
    ok('начислено 500 монет, а не 1000', db.players[0].coins === 600, db.players[0].coins);
    ok('начислено 2 звезды, а не 4', db.players[0].stars === 2, db.players[0].stars);
    ok('reward_claimed = true', db.player_achievements[0].reward_claimed === true);
    ok('в журнале начислений одно событие (монеты+звёзды одной выдачи)',
        db.grantLog.filter(g => g.coins === 500).length === 1, JSON.stringify(db.grantLog));
    ok('Нет ReferenceError: logPlayerAction (регресс!)',
        rejected.every(r => !/logPlayerAction/.test(String(r.reason && r.reason.message))),
        rejected.map(r => r.reason && r.reason.message).join(';'));

    console.log('\n=== P0-2b: повторный claim после успешного ===');
    let err = null;
    try { await helpers.claimAchievementReward(5, 3); } catch (e) { err = e; }
    ok('отклонён с ALREADY_CLAIMED', err && err.code === 'ALREADY_CLAIMED', err && err.code);
    ok('монеты не изменились', db.players[0].coins === 600, db.players[0].coins);

    console.log('\n=== P0-2c: claim невыполненного достижения ===');
    err = null;
    try { await helpers.claimAchievementReward(5, 9); } catch (e) { err = e; }
    ok('отклонён с NOT_COMPLETED', err && err.code === 'NOT_COMPLETED', err && err.code);

    console.log('\n=== P0-2d: несуществующее достижение ===');
    err = null;
    try { await helpers.claimAchievementReward(5, 99999); } catch (e) { err = e; }
    ok('отклонён с ACHIEVEMENT_NOT_FOUND', err && err.code === 'ACHIEVEMENT_NOT_FOUND', err && err.code);

    console.log('\n=== P0-2e: ROLLBACK -> reward_claimed сбрасывается, повтор возможен ===');
    const before = db.players[0].coins;
    db.breakGrant = true;
    err = null;
    try { await helpers.claimAchievementReward(5, 11); } catch (e) { err = e; }
    db.breakGrant = false;
    ok('начисление упало -> ошибка', err !== null, err && err.message);
    ok('монеты не изменились после откатa', db.players[0].coins === before, db.players[0].coins);
    ok('reward_claimed остался false (можно забрать снова)',
        db.player_achievements.find(p => p.achievement_id === 11).reward_claimed === false);

    err = null;
    try { await helpers.claimAchievementReward(5, 11); } catch (e) { err = e; }
    ok('повторная попытка успешна', err === null, err && err.message);
    ok('монеты начислены ровно один раз (777)', db.players[0].coins === before + 777, db.players[0].coins);

    console.log('\n=== P0-2f: три параллельных claim ===');
    const rows3 = [
        { id: 3, player_id: 5, achievement_id: 3, completed: true, reward_claimed: true }
    ];
    db.player_achievements = rows3;
    db.players[0].coins = 100;
    db.breakGrant = false;
    db.achievements.push({ id: 20, name: 'Тройная награда', reward: { coins: 300, stars: 0 }, category: 'test' });
    db.player_achievements.push({ id: 7, player_id: 5, achievement_id: 20, completed: true, reward_claimed: false });
    const r3 = await Promise.allSettled([
        helpers.claimAchievementReward(5, 20),
        helpers.claimAchievementReward(5, 20),
        helpers.claimAchievementReward(5, 20)
    ]);
    const okCount = r3.filter(r => r.status === 'fulfilled').length;
    ok('из трёх параллельных — ровно один успех', okCount === 1, okCount);
    ok('начислено 300, а не 600/900', db.players[0].coins === 400, db.players[0].coins);

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
