/**
 * Тест-стенд для routes/game/status.js.
 * Проверяет:
 *  - /heal health: лечение, расход предмета, лог ПОСЛЕ коммита
 *  - /heal radiation: jsonb_set (уровень обновляется, expires_at не теряется)
 *  - /heal: валидация type / item_id
 *  - /check: урон от радиации/инфекций
 *  - граничные случаи
 */
const Module = require('module');
const path = require('path');

const callLog = [];
let dbRows = { player: null };

function reset(o) {
    callLog.length = 0;
    dbRows = Object.assign({ player: null }, o);
}

// Мок клиента отвечает по паттерну SQL
const clientFactory = () => ({
    query: async (sqlRaw, params) => {
        const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
        callLog.push({ sql, params });

        // SELECT ... FROM players WHERE id = $1 FOR UPDATE
        if (/FROM players WHERE id = \$1 FOR UPDATE/.test(sql)) {
            return { rows: dbRows.player ? [dbRows.player] : [] };
        }
        // UPDATE с RETURNING
        if (/^UPDATE players/.test(sql)) return { rows: [{ health: 100, energy: 50, coins: 10 }] };
        // выборка локаций
        if (/FROM locations/.test(sql)) return { rows: [{ id: 1 }] };
        return { rows: [] };
    }
});

const dbMock = {
    transaction: async (fn) => fn(clientFactory())
};

const helpersMock = {
    buildPlayerStatus: () => ({ health: 100, max_health: 100, radiation: 0 }),
    // Настоящий normalizeInventory парсит JSON-строку из БД через safeJsonParse
    normalizeInventory: (i) => {
        if (Array.isArray(i)) return i;
        if (typeof i === 'string') { try { const p = JSON.parse(i); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
        return [];
    },
    // consumeInventoryItem: уменьшает количество, при 0 — удаляет слот
    consumeInventoryItem: (inventory, index) => {
        const inv = inventory.slice();
        const item = inv[index];
        if (!item) return { updatedInventory: inv, quantityLeft: 0 };
        const q = Number(item.quantity || 1);
        if (q > 1) inv[index] = { ...item, quantity: q - 1 };
        else inv.splice(index, 1);
        return { updatedInventory: inv, quantityLeft: Math.max(0, q - 1) };
    }
};

const gameConstantsMock = {
    DEBUFF_CONFIG: {
        radiation: { damagePerLevel: 3 },
        infection: { damagePerLevel: 2 }
    },
    getDebuffTier: (n) => (n >= 10 ? 'critical' : n >= 5 ? 'danger' : n > 0 ? 'minor' : 'none')
};

const debuffApiMock = {
    DebuffAPI: { cure: async () => ({ itemUsed: 'Аптечка', used: true, heal: 10 }) }
};

const serverApiMock = {
    safeJsonParse: (v, d) => {
        if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } }
        return v == null ? d : v;
    },
    handleError: (res, error, action) => {
        const statusCode = error.statusCode || 500;
        const rawCode = typeof error.code === 'string' ? error.code : '';
        const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
        const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
        const internalMessage = error.message || 'Внутренняя ошибка сервера';
        const isClientError = statusCode >= 400 && statusCode < 500;
        if (statusCode >= 500) {
            console.log('    !! INTERNAL:', internalMessage);
            if (error.stack) console.log(error.stack.split('\n').slice(0, 5).join('\n'));
        }
        const message = isClientError ? internalMessage : 'Внутренняя ошибка сервера. Попробуй позже.';
        callLog.push({ __handleError: true, action, statusCode, code });
        return res.status(statusCode).json({ success: false, error: message, code });
    },
    logPlayerAction: async (playerId, action, data, client) => {
        callLog.push({ __log: true, playerId, action, data, withClient: Boolean(client) });
    }
};

const validateMock = {
    validateId: (v, name) => {
        const n = Number(v);
        return (Number.isInteger(n) && n > 0) ? { ok: true, value: n } : { ok: false, error: name + ': ожидается число > 0', code: 'VALIDATION_ERROR' };
    }
};

const originalLoad = Module._load;
Module._load = function (request) {
    const map = {
        '../../db/database': dbMock,
        '../../utils/gameConstants': gameConstantsMock,
        '../../utils/serverApi': serverApiMock,
        '../../utils/validate': validateMock
    };
    if (map[request]) return map[request];
    if (request.includes('game-helpers')) return helpersMock;
    if (request === './debuffs') return debuffApiMock;
    if (request.includes('gameConstants')) return gameConstantsMock;
    return originalLoad.apply(this, arguments);
};

const router = require(path.join(__dirname, 'routes/game/status.js'));
Module._load = originalLoad;

const getHandler = (p) => {
    const l = router.stack.find(x => x.route && x.route.path === p);
    return l ? l.route.stack[0].handle : null;
};

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra || ''); }
};

const makeReqRes = (player, body) => ({
    req: { player, body: body || {} },
    res: { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }
});

const player = () => ({
    id: 5, health: 40, max_health: 100, radiation: { level: 12, expires_at: '2030-01-01', applied_at: '2020-01-01' },
    infections: '[]', inventory: '[]', equipment: '{}'
});

async function run() {
    console.log('=== /heal health: лечение + расход + лог после коммита ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100, radiation: { level: 12, expires_at: 'x', applied_at: 'y' },
            infections: '[]',
            inventory: JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', heal: 30, quantity: 3 }])
        }
    });
    let { req, res } = makeReqRes(player(), { type: 'health', item_id: 101 });
    await getHandler('/heal')(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('success', res.body && res.body.success === true, JSON.stringify(res.body));
    ok('quantity_left === 2', res.body && res.body.quantity_left === 2, JSON.stringify(res.body && res.body.quantity_left));

    const upd = callLog.filter(q => /^UPDATE players SET health/.test(q.sql));
    ok('UPDATE health выполнен', upd.length === 1, String(upd.length));
    ok('healAmount = 30 передан в UPDATE', upd[0] && upd[0].params[0] === 30, JSON.stringify(upd[0] && upd[0].params));

    const invUpd = callLog.filter(q => /^UPDATE players SET inventory/.test(q.sql));
    ok('UPDATE inventory выполнен', invUpd.length === 1, String(invUpd.length));
    ok('в инвентаре осталось количество 2', invUpd[0] && invUpd[0].params[0] === JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', heal: 30, quantity: 2 }]), JSON.stringify(invUpd[0] && invUpd[0].params));

    const logs = callLog.filter(c => c.__log);
    ok('лог status_heal есть', logs.some(l => l.action === 'status_heal'), JSON.stringify(logs.map(l => l.action)));
    ok('лог БЕЗ client (после коммита)', logs.length > 0 && logs.every(l => l.withClient === false), JSON.stringify(logs.map(l => l.withClient)));

    console.log('');
    console.log('=== /heal radiation: jsonb_set сохраняет expires_at/applied_at ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100,
            radiation: { level: 12, expires_at: '2030-05-05', applied_at: '2024-02-02' },
            infections: '[]',
            inventory: JSON.stringify([{ id: 202, name: 'Антирад', type: 'medicine', rad_removal: 5, quantity: 1 }])
        }
    });
    ({ req, res } = makeReqRes(player(), { type: 'radiation', item_id: 202 }));
    await getHandler('/heal')(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('success', res.body && res.body.success === true, JSON.stringify(res.body));

    const radUpd = callLog.filter(q => /radiation = jsonb_set/.test(q.sql));
    ok('UPDATE использует jsonb_set', radUpd.length === 1, String(radUpd.length));
    ok('новый уровень = 7 (12 - 5)', radUpd[0] && radUpd[0].params[0] === 7, JSON.stringify(radUpd[0] && radUpd[0].params));
    ok('в SQL обновляется только {level}',
        radUpd[0] && /\{level\}/.test(radUpd[0].sql) && /to_jsonb\(\$1\)/.test(radUpd[0].sql),
        radUpd[0] && radUpd[0].sql);
    ok('весь объект радиации НЕ перезаписывается', radUpd[0] && !/SET radiation = \$1 WHERE/.test(radUpd[0].sql), radUpd[0] && radUpd[0].sql);

    console.log('');
    console.log('=== /heal radiation: уровень не уходит ниже нуля ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100, radiation: { level: 2, expires_at: 'x', applied_at: 'y' }, infections: '[]',
            inventory: JSON.stringify([{ id: 202, name: 'Антирад', type: 'medicine', rad_removal: 10, quantity: 1 }])
        }
    });
    ({ req, res } = makeReqRes(player(), { type: 'radiation', item_id: 202 }));
    await getHandler('/heal')(req, res);
    const radUpd2 = callLog.filter(q => /radiation = jsonb_set/.test(q.sql));
    ok('уровень зажат в 0', radUpd2[0] && radUpd2[0].params[0] === 0, JSON.stringify(radUpd2[0] && radUpd2[0].params));

    console.log('');
    console.log('=== /heal: валидация ===');
    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { type: 'health' }));
    await getHandler('/heal')(req, res);
    ok('без item_id/item_index -> MISSING_ITEM_ID', res.body && res.body.code === 'MISSING_ITEM_ID', JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { type: 'health', item_id: '' }));
    await getHandler('/heal')(req, res);
    ok('пустой item_id -> MISSING_ITEM_ID', res.body && res.body.code === 'MISSING_ITEM_ID', JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { type: 'health', item_id: 'abc' }));
    await getHandler('/heal')(req, res);
    ok('нечисловой item_id -> ошибка валидации', res.body && res.body.success === false && res.statusCode >= 400, JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { type: 'неверно', item_id: 101 }));
    await getHandler('/heal')(req, res);
    ok('неизвестный type -> INVALID_TYPE', res.body && res.body.code === 'INVALID_TYPE', JSON.stringify(res.body));

    console.log('');
    console.log('=== /heal: предмета нет в инвентаре ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100, radiation: { level: 0 }, infections: '[]',
            inventory: JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', heal: 30, quantity: 1 }])
        }
    });
    ({ req, res } = makeReqRes(player(), { type: 'health', item_id: 999 }));
    await getHandler('/heal')(req, res);
    ok('код ITEM_NOT_FOUND', res.body && res.body.code === 'ITEM_NOT_FOUND', JSON.stringify(res.body));

    console.log('');
    console.log('=== /check: урон от радиации ===');
    reset({
        player: {
            id: 5, health: 100, max_health: 100,
            radiation: JSON.stringify({ level: 8 }),
            infections: JSON.stringify([{ level: 0 }])
        }
    });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler('/check')(req, res);
    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('radiation damage = (8-4)*3 = 12', res.body && res.body.damage === 12, JSON.stringify(res.body));
    ok('уменьшение здоровья в БД', callLog.some(q => /UPDATE players[\s\S]*GREATEST\(0, health - /.test(q.sql)));

    console.log('');
    console.log('=== /check: радиации ниже порога -> урона нет ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: { level: 3 }, infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler('/check')(req, res);
    ok('damage === 0', res.body && res.body.damage === 0, JSON.stringify(res.body));
    ok('UPDATE здоровья НЕ выполнен', !callLog.some(q => /UPDATE players[\s\S]*health - /.test(q.sql)));

    console.log('');
    console.log('=== /check: радиация числом (старый формат) ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: 9, infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler('/check')(req, res);
    ok('damage = (9-4)*3 = 15', res.body && res.body.damage === 15, JSON.stringify(res.body));

    console.log('');
    console.log('=== /check: радиация строкой JSON ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: '{"level":6}', infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler('/check')(req, res);
    ok('damage = (6-4)*3 = 6', res.body && res.body.damage === 6, JSON.stringify(res.body));

    console.log('');
    console.log('=== GET / ===');
    ok('хендлер / есть', typeof getHandler('/') === 'function');

    console.log('');
    console.log('========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
