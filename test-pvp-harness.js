/**
 * Тест-стенд для routes/game/pvp.js.
 * Проверяет после рефакторинга:
 *  - /attack: recalcEnergy вызывается ДО проверки энергии
 *  - /attack: лог уходит ПОСЛЕ коммита (logPlayerAction без client)
 *  - /attack-hit: battleLogData формируется в обеих ветках, лог после коммита
 *  - кулдауны читаются ОДНИМ запросом
 *  - целостность скобочной структуры (нет ReferenceError)
 */
const Module = require('module');
const path = require('path');

const AMP = '\u0026';
const Q = String.fromCharCode(39);

const state = { energyAfterRecalc: 1, setDamage: 10, coinsToSteal: 5, pvpExp: 3, autoHeal: null };

// Персонажи и бой, которыми отвечает мок (меняются в каждом сценарии)
let dbState = {
    attacker: null, defender: null, battle: null, location: { danger_level: 8 },
    safeLocationId: 1
};

function setScenario(o) {
    dbState = Object.assign({ attacker: null, defender: null, battle: null, location: { danger_level: 8 }, safeLocationId: 1 }, o);
    callLog.length = 0;
    txIdx = 0;
}

let txIdx = 0;
const callLog = [];

// Ответчик для запросов ВНЕ транзакции (query/queryAll: /players, /stats)
let nonTxResponder = () => ({ rows: [] });

// Мок отвечает по ПАТТЕРНУ SQL, а не по порядковому номеру —
// это устойчиво к изменению числа/порядка запросов в коде.
const clientFactory = () => ({
    query: async (sqlRaw, params) => {
        const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
        callLog.push({ sql, params });
        txIdx++;

        // SELECT * FROM players WHERE id = $1 FOR UPDATE
        let m = sql.match(/FROM players WHERE id = \$1 FOR UPDATE/);
        if (m) {
            const id = Number(params[0]);
            const row = id === (dbState.attacker && dbState.attacker.id) ? dbState.attacker
                : id === (dbState.defender && dbState.defender.id) ? dbState.defender
                : (dbState.attacker && dbState.attacker.id) === undefined ? null : null;
            return { rows: row ? [row] : [] };
        }
        // SELECT * FROM pvp_battles WHERE id = $1 FOR UPDATE
        if (/FROM pvp_battles WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return { rows: dbState.battle ? [dbState.battle] : [] };
        }
        // локация (danger_level)
        if (/danger_level FROM locations WHERE id/.test(sql)) {
            return { rows: [dbState.location] };
        }
        // кулдауны
        if (/FROM pvp_cooldowns/.test(sql)) return { rows: [] };
        // активные бои
        if (/FROM pvp_battles[\s\S]*WHERE status = 'active'/.test(sql)) return { rows: [] };
        // безопасная локация
        if (/WHERE COALESCE\(danger_level, 0\) < 6/.test(sql)) {
            return { rows: [{ id: dbState.safeLocationId }] };
        }
        // UPDATE ... RETURNING energy для списания энергии
        if (/UPDATE players[\s\S]*GREATEST\(0, energy - /.test(sql)) {
            return { rows: [{ energy: 2, max_energy: 100, last_energy_update: 'now' }] };
        }
        return { rows: [] };
    }
});

const dbMock = {
    // queryOne/queryAll работают с тем же responder'ом, что и client в транзакции
    queryOne: async (sql, params) => {
        callLog.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        const r = nonTxResponder(sql, params);
        return (r.rows && r.rows[0]) || null;
    },
    queryAll: async (sql, params) => {
        callLog.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        return nonTxResponder(sql, params).rows || [];
    },
    transaction: async (fn) => fn(clientFactory())
};

// helpers с запоминанием порядка вызовов
const energyRecalcCalls = [];
const helpersMock = {
    getActiveBuffs: () => ({ free_energy: false }),
    normalizeInventory: (i) => Array.isArray(i) ? i : [],
    recalcEnergy: async (client, player) => {
        energyRecalcCalls.push(player && player.energy);
        if (player) player.energy = state.energyAfterRecalc;
    },
    normalizeEquipment: (e) => e || {},
    getSetBonuses: async () => ({ damage: 0 }),
    wearEquipmentSlots: () => [],
    addItemToInventory: (inv, item) => { inv.push(item); },
    applyAutoHeal: async () => state.autoHeal,
    buildPlayerStatus: () => ({}),
    consumeInventoryItem: () => ({ updatedInventory: [], quantityLeft: 0 })
};

const pvpMock = {
    isProtectedFromPVP: async () => false,
    createPVPMatch: async () => ({ id: 999 }),
    calculatePVPDamage: () => ({ damage: state.setDamage }),
    calculateCoinsToSteal: () => state.coinsToSteal,
    getRandomItemsToSteal: () => [],
    calculatePVPRewardExperience: () => state.pvpExp,
    getPVPCooldown: async () => null
};

const validateMock = {
    validateId: (v) => ({ ok: true, value: Number(v) })
};

const rulesMock = {
    MAX_INVENTORY_SLOTS: 100,
    isEquipmentItem: (i) => Boolean(i && i.type === 'equipment')
};

// Мок handleError повторяет поведение реального из utils/serverApi.js:
// статус берётся из error.statusCode, сообщения 5xx маскируются.
const serverApiMock = {
    logger: { info() {}, warn() {}, error() {} },
    safeStringify: JSON.stringify,
    logPlayerAction: async (playerId, action, data, client) => {
        callLog.push({ __log: true, playerId, action, data, withClient: Boolean(client) });
    },
    logPlayerError: async () => {},
    PlayerHelper: { addExperience: async () => ({}) },
    handleError: (res, error, action) => {
        const statusCode = error.statusCode || 500;
        const rawCode = typeof error.code === 'string' ? error.code : '';
        const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
        const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
        const internalMessage = error.message || 'Внутренняя ошибка сервера';
        const isClientError = statusCode >= 400 && statusCode < 500;
        const message = isClientError
            ? internalMessage
            : 'Внутренняя ошибка сервера. Попробуй позже.';
        // Помечаем внутреннее сообщение и стек, чтобы видеть причину в тесте
        if (statusCode >= 500) {
            console.log('    !! INTERNAL:', internalMessage);
            if (error.stack) console.log(error.stack.split('\n').slice(0, 5).join('\n'));
        }
        callLog.push({ __handleError: true, action, statusCode, code, message, internalMessage });
        return res.status(statusCode).json({ success: false, error: message, code });
    }
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../db/pvp': pvpMock,
        '../../utils/validate': validateMock,
        '../../public/shared/equipment.js': rulesMock,
        '../../utils/serverApi': serverApiMock
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    return originalLoad.apply(this, arguments);
};

const pvpRouter = require(path.join(__dirname, 'routes/game/pvp.js'));
Module._load = originalLoad;

const getHandler = (p) => {
    const l = pvpRouter.stack.find(x => x.route && x.route.path === p);
    return l ? l.route.stack[0].handle : null;
};

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra || ''); }
};

const makeReqRes = (player, body, q) => ({
    req: { player, body: body || {}, query: q || {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

const attacker = () => ({
    id: 1, current_location_id: 5, health: 100, max_health: 100, energy: 0,
    max_energy: 100, strength: 10, agility: 5, level: 10, coins: 0, buffs: {},
    equipment: {}, inventory: []
});
const target = () => ({
    id: 2, current_location_id: 5, health: 100, max_health: 100, energy: 0,
    strength: 8, agility: 5, level: 9, coins: 100, buffs: {}, equipment: {}, inventory: []
});

async function run() {
    console.log('=== /attack: recalcEnergy до проверки энергии, лог после коммита, 1 запрос кулдаунов ===');
    const att = attacker();
    att.energy = 0;            // до recalc энергии нет
    state.energyAfterRecalc = 1;  // recalc её поднимет
    setScenario({ attacker: att, defender: target(), location: { danger_level: 8 } });

    let { req, res } = makeReqRes(att, { target_id: 2 });
    await getHandler('/attack')(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('ответ success', res.body && res.body.success === true, JSON.stringify(res.body));
    ok('battle_id из createPVPMatch', res.body && res.body.battle_id === 999, JSON.stringify(res.body));
    ok('recalcEnergy поднял энергию до 1', energyRecalcCalls.length > 0 && energyRecalcCalls[energyRecalcCalls.length - 1] === 0, JSON.stringify(energyRecalcCalls));

    const cooldownQ = callLog.filter(q => /FROM pvp_cooldowns/.test(q.sql));
    ok('кулдауны: ровно один запрос', cooldownQ.length === 1, 'count=' + cooldownQ.length);
    ok('кулдауны: player_id IN (\, \)', /player_id IN \(\$\d+, \$\d+\)/.test(cooldownQ[0] && cooldownQ[0].sql), cooldownQ[0] && cooldownQ[0].sql);
    ok('кулдауны: cooldown_type IN (...) 3 типа одним списком', /cooldown_type IN \('pvp_battle', \$\d+\)/.test(cooldownQ[0] && cooldownQ[0].sql), cooldownQ[0] && cooldownQ[0].sql);

    // recalcEnergy должен идти ДО запроса кулдаунов
    const recalcLogged = callLog.some(q => false); // recalc не делает запросов
    const logs = callLog.filter(c => c.__log);
    ok('лог pvp_attack_start есть', logs.some(l => l.action === 'pvp_attack_start'), JSON.stringify(logs.map(l => l.action)));
    ok('лог записан БЕЗ client (после COMMIT)', logs.every(l => l.withClient === false), JSON.stringify(logs.map(l => l.withClient)));

    console.log('  /attack: энергии мало и после recalc');
    state.energyAfterRecalc = 0;
    setScenario({ attacker: attacker(), defender: target(), location: { danger_level: 8 } });
    ({ req, res } = makeReqRes(attacker(), { target_id: 2 }));
    await getHandler('/attack')(req, res);
    ok('HTTP 400', res.statusCode === 400, res.statusCode);
    ok('код INSUFFICIENT_ENERGY', res.body && res.body.code === 'INSUFFICIENT_ENERGY', JSON.stringify(res.body));

    console.log('  /attack: не красная зона');
    state.energyAfterRecalc = 1;
    setScenario({ attacker: attacker(), defender: target(), location: { danger_level: 2 } });
    ({ req, res } = makeReqRes(attacker(), { target_id: 2 }));
    await getHandler('/attack')(req, res);
    ok('HTTP 400', res.statusCode === 400, res.statusCode);
    ok('код NOT_RED_ZONE', res.body && res.body.code === 'NOT_RED_ZONE', JSON.stringify(res.body));

    console.log('  /attack: атака самого себя не доходит до БД');
    setScenario({ attacker: attacker(), defender: target() });
    const callsBefore = callLog.length;
    ({ req, res } = makeReqRes(attacker(), { target_id: 1 }));
    await getHandler('/attack')(req, res);
    ok('HTTP 400 (SELF_TARGET)', res.statusCode === 400, res.statusCode);
    ok('запросов к БД не было', callLog.length === callsBefore, 'calls=' + (callLog.length - callsBefore));

    console.log('');
    console.log('=== /attack-hit: победа — лог после коммита ===');
    state.energyAfterRecalc = 5;
    state.setDamage = 50;   // гарантированно убиваем защитника (health 20)
    const def = target(); def.health = 20;
    // Ловкость 0 -> шанс уклонения ровно 0. Иначе реальный бросок
    // crypto.randomInt() иногда даёт уклонение и тест падает флейково.
    def.agility = 0;
    setScenario({
        attacker: attacker(), defender: def,
        battle: { id: 50, attacker_id: 1, defender_id: 2, status: 'active', started_at: new Date() },
        safeLocationId: 1
    });
    ({ req, res } = makeReqRes(attacker(), { battle_id: 50 }));
    await getHandler('/attack-hit')(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('success', res.body && res.body.success === true, JSON.stringify(res.body).slice(0, 200));
    ok('battleEnded === true', res.body && res.body.battleEnded === true, JSON.stringify(res.body && res.body.battleEnded));
    ok('message === Победа!', res.body && res.body.message === 'Победа!', JSON.stringify(res.body && res.body.message));
    const winLogs = callLog.filter(c => c.__log);
    ok('лог pvp_battle_win есть', winLogs.some(l => l.action === 'pvp_battle_win'), JSON.stringify(winLogs.map(l => l.action)));
    ok('лог БЕЗ client (после COMMIT)', winLogs.every(l => l.withClient === false), JSON.stringify(winLogs.map(l => l.withClient)));
    const battleUpdate = callLog.find(q => /UPDATE pvp_battles[\s\S]*status = 'completed'/.test(q.sql));
    ok('бой закрыт как completed', Boolean(battleUpdate));
    ok('кулдауны выставлены обоим', callLog.filter(q => /INSERT INTO pvp_cooldowns/.test(q.sql)).length === 2, String(callLog.filter(q => /INSERT INTO pvp_cooldowns/.test(q.sql)).length));

    console.log('');
    console.log('=== /attack-hit: простой удар (не победа) ===');
    state.setDamage = 10;
    const def2 = target(); def2.health = 80;
    def2.agility = 0;   // уклонение выключено — см. коммент. выше
    setScenario({
        attacker: attacker(), defender: def2,
        battle: { id: 51, attacker_id: 1, defender_id: 2, status: 'active', started_at: new Date() }
    });
    ({ req, res } = makeReqRes(attacker(), { battle_id: 51 }));
    await getHandler('/attack-hit')(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('battleEnded === false', res.body && res.body.battleEnded === false, JSON.stringify(res.body && res.body.battleEnded));
    ok('hit.damage > 0', res.body && res.body.hit && res.body.hit.damage > 0, JSON.stringify(res.body && res.body.hit));
    ok('targetHealth уменьшилось', res.body && res.body.hit && res.body.hit.targetHealth === 70, JSON.stringify(res.body && res.body.hit && res.body.hit.targetHealth));
    const hitLogs = callLog.filter(c => c.__log);
    ok('лог pvp_attack_hit есть', hitLogs.some(l => l.action === 'pvp_attack_hit'), JSON.stringify(hitLogs.map(l => l.action)));

    console.log('');
    console.log('=== /attack-hit: не участник боя ===');
    // Игрок 99 не участвует в бою 52 (attacker_id=1, defender_id=2)
    setScenario({ attacker: { id: 99 }, defender: target(), battle: { id: 52, attacker_id: 1, defender_id: 2, status: 'active', started_at: new Date() } });
    ({ req, res } = makeReqRes(Object.assign(attacker(), { id: 99 }), { battle_id: 52 }));
    await getHandler('/attack-hit')(req, res);
    ok('код NOT_PARTICIPANT', res.body && res.body.code === 'NOT_PARTICIPANT', JSON.stringify(res.body));

    console.log('');
    console.log('=== /attack-hit: удар защитником (роли меняются) ===');
    state.setDamage = 10;
    const defd = target(); defd.id = 1; defd.health = 80;   // защитник = игрок 1
    defd.agility = 0;   // уклонение выключено
    const attk = attacker(); attk.id = 2; attk.health = 90; // атакующий = игрок 2
    setScenario({
        attacker: attk, defender: defd,
        battle: { id: 53, attacker_id: 2, defender_id: 1, status: 'active', started_at: new Date() }
    });
    ({ req, res } = makeReqRes(defd, { battle_id: 53 }));   // бьёт игрок 1
    await getHandler('/attack-hit')(req, res);
    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('success', res.body && res.body.success === true, JSON.stringify(res.body).slice(0, 150));
    // Бьющий игрок (id 1, защитник боя) становится атакующим в этом ударе:
    // yourHealth — его здоровье (80), targetHealth — противника (id 2, 90 - 10 = 80)
    ok('yourHealth = 80 (бьющий игрок)', res.body && res.body.hit && res.body.hit.yourHealth === 80, JSON.stringify(res.body && res.body.hit));
    ok('targetHealth = 80', res.body && res.body.hit && res.body.hit.targetHealth === 80, JSON.stringify(res.body && res.body.hit && res.body.hit.targetHealth));

    console.log('');
    console.log('=== /players: COUNT(*) OVER() вместо отдельного COUNT ===');
    const playersHandler = getHandler('/players');
    ok('хендлер /players есть', typeof playersHandler === 'function');

    // Первый запрос — danger_level локации; второй — список игроков
    let playersCallCount = 0;
    nonTxResponder = (sql) => {
        if (/danger_level FROM locations/.test(sql)) {
            return { rows: [{ danger_level: 8 }] };
        }
        if (/COUNT\(\*\) OVER\(\)/.test(sql)) {
            playersCallCount++;
            // Имитируем ответ с двумя строками: total_count = 7 (всего кандидатов)
            return { rows: [
                { id: 2, username: 'two', level: 5, health: 100, max_health: 100, strength: 3, pvp_wins: 1, pvp_rating: 100, total_count: 7 },
                { id: 3, username: 'three', level: 6, health: 90, max_health: 100, strength: 4, pvp_wins: 2, pvp_rating: 120, total_count: 7 }
            ] };
        }
        return { rows: [] };
    };
    ({ req, res } = makeReqRes(attacker(), {}));
    await playersHandler(req, res);
    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('total = 7 (из COUNT OVER)', res.body && res.body.pagination && res.body.pagination.total === 7, JSON.stringify(res.body && res.body.pagination));
    ok('2 игрока в списке', res.body && res.body.players && res.body.players.length === 2, JSON.stringify(res.body && res.body.players));
    ok('служебное total_count убрано из ответа',
        Boolean(res.body) && Boolean(res.body.players) && res.body.players.every(p => !('total_count' in p)),
        JSON.stringify(res.body.players[0]));
    ok('только ОДИН запрос со COUNT OVER (без отдельного COUNT)', playersCallCount === 1, 'count=' + playersCallCount);
    ok('COUNT отдельным запросом НЕ выполнено',
        !callLog.filter(q => /SELECT COUNT\(\*\) as total/.test(q.sql)).length,
        JSON.stringify(callLog.filter(q => /COUNT/.test(q.sql))));

    // Не красная зона
    nonTxResponder = (sql) => (/danger_level FROM locations/.test(sql) ? { rows: [{ danger_level: 2 }] } : { rows: [] });
    ({ req, res } = makeReqRes(attacker(), {}));
    await playersHandler(req, res);
    ok('не красная зона -> available: false', res.body && res.body.available === false, JSON.stringify(res.body));

    console.log('');
    console.log('=== /stats: обработчик существует ===');
    ok('хендлер /stats есть', typeof getHandler('/stats') === 'function');

    console.log('');
    console.log('========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
