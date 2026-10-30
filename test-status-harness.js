/**
 * Тест-стенд для routes/game/status.js (/check) и routes/game/items.js (/use-item).
 *
 * ЗДЕСЬ БЫЛ СЛОМАННЫЙ ТЕСТ: он мокировал routes/game/status.js и звал
 * getHandler('/heal'), но /heal в status.js больше не существует — лечение
 * переехало в items.js ('/use', '/use-item') ещё при слиянии разделов.
 * Из-за этого файл падал на строке 156 с "getHandler(...) is not a function",
 * а покрытие было нулевым: /check и все остальные проверки не запускались.
 *
 * Теперь используется POST /api/game/inventory/use-item с телом
 * { item_index, equip } — тем же, что шлёт клиент (game.js:4115).
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
    transaction: async (fn) => fn(clientFactory()),
    queryOne: async () => null,
    queryAll: async () => [],
    query: async () => ({ rows: [] })
};

const helpersMock = {
    buildPlayerStatus: () => ({ health: 100, max_health: 100, radiation: 0 }),
    normalizeInventory: (i) => {
        if (Array.isArray(i)) return i;
        if (typeof i === 'string') { try { const p = JSON.parse(i); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
        return [];
    },
    normalizeEquipment: (e) => {
        if (typeof e === 'string') { try { return JSON.parse(e) || {}; } catch { return {}; } }
        return e && typeof e === 'object' ? e : {};
    },
    createInventoryItem: (item, opts) => Object.assign({}, item, opts),
    // normalizeRadiation: level всегда число, строки/числа на входе тоже ок
    normalizeRadiation: (r) => {
        if (r === null || r === undefined) return { level: 0, expires_at: null, applied_at: null };
        if (typeof r === 'number') return { level: r, expires_at: null, applied_at: null };
        if (typeof r === 'string') {
            try { const p = JSON.parse(r); return Object.assign({ level: 0, expires_at: null, applied_at: null }, p); }
            catch { return { level: 0, expires_at: null, applied_at: null }; }
        }
        return Object.assign({ level: 0, expires_at: null, applied_at: null }, r);
    },
    calculateSellPrice: (item) => Number(item?.price || 0),
    addItemToInventory: (inv, item) => { inv.push(item); return inv; },
    trackCollectedItems: () => {},
    consumeInventoryItem: (inventory, index) => {
        const inv = inventory.slice();
        const item = inv[index];
        if (!item) return { updatedInventory: inv, quantityLeft: 0 };
        const q = Number(item.quantity || 1);
        if (q > 1) inv[index] = { ...item, quantity: q - 1 };
        else inv.splice(index, 1);
        return { updatedInventory: inv, quantityLeft: Math.max(0, q - 1) };
    },
    // Бонусы сетов: без предметов сета — пусто
    getSetBonuses: async () => ({}),
    equipmentRules: {
        resolveEquipmentSlot: (item) => {
            // Канон public/shared/equipment.js: armor/helmet/face/body/hands/
            // legs/boots/accessory/weapon. 'head' удалён (был алиасом helmet),
            // 'face' — маски и противогазы.
            const slots = { weapon: 'weapon', armor: 'armor', helmet: 'helmet', face: 'face', body: 'body', hands: 'hands', legs: 'legs', boots: 'boots', accessory: 'accessory' };
            return slots[item?.slot] || slots[item?.type] || null;
        }
    }
};

const gameConstantsMock = {
    DEBUFF_CONFIG: {
        radiation: { damagePerLevel: 3 },
        infection: { damagePerLevel: 2 }
    },
    getDebuffTier: (n) => (n >= 10 ? 'critical' : n >= 5 ? 'danger' : n > 0 ? 'minor' : 'none'),
    // Те же функции, что экспортирует настоящий utils/gameConstants.js:
    // status.js берёт парсинг уровня и формулу урона оттуда, поэтому
    // мок обязан их предоставить (порог 5, damagePerLevel из конфига).
    CONTAMINATION_DAMAGE_FROM_LEVEL: 5,
    normalizeRadiationLevel: (raw) => {
        if (typeof raw === 'number') return raw > 0 ? Math.floor(raw) : 0;
        if (typeof raw === 'object' && raw !== null) return Math.max(0, Math.floor(Number(raw.level) || 0));
        if (typeof raw === 'string') {
            try { const p = JSON.parse(raw); return typeof p === 'object' && p ? Math.max(0, Math.floor(Number(p.level) || 0)) : Math.max(0, parseInt(p, 10) || 0); } catch { return 0; }
        }
        return 0;
    },
    calculateRadiationDamage: (level, perLevel) => {
        const lvl = Number(level), per = Number(perLevel);
        if (!(lvl >= 5) || !Number.isFinite(per)) return 0;
        return Math.max(0, (lvl - 4) * per);
    }
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
        }
        const message = isClientError ? internalMessage : 'Внутренняя ошибка сервера. Попробуй позже.';
        callLog.push({ __handleError: true, action, statusCode, code });
        return res.status(statusCode).json({ success: false, error: message, code });
    },
    logPlayerAction: async (playerId, action, data, client) => {
        callLog.push({ __log: true, playerId, action, data, withClient: Boolean(client) });
    },
    fail: (res, message, code) => res.status(400).json({ success: false, error: message, code })
};

const validateMock = {
    validateId: (v, name) => {
        const n = Number(v);
        return (Number.isInteger(n) && n > 0) ? { ok: true, value: n } : { ok: false, error: name + ': ожидается число > 0', code: 'VALIDATION_ERROR' };
    },
    validateQuantity: (v) => ({ valid: true, value: 1 }),
    validateItemIndex: (v) => {
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n < 0) return { ok: false, error: 'индекс предмета должен быть целым числом >= 0', code: 'INVALID_INDEX' };
        return { ok: true, value: n };
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
    // status.js:11 тянет отсюда CONTAMINATION_DAMAGE_FROM_LEVEL. Без него
    // порог был undefined, сравнение всегда false и /check всегда отвечал
    // damage: 0 — тест проверял бы неработающую логику. Реальное значение — 5.
    if (request.includes('shared/equipment')) return { MAX_INVENTORY_SLOTS: 100, CONTAMINATION_DAMAGE_FROM_LEVEL: 5 };
    return originalLoad.apply(this, arguments);
};

const statusRouter = require(path.join(__dirname, 'routes/game/status.js'));
const itemsRouter = require(path.join(__dirname, 'routes/game/items.js'));
Module._load = originalLoad;

// Ищет обработчик по пути в конкретном роутере (учитывает массивы путей)
const getHandler = (router, p) => {
    for (const l of router.stack) {
        if (!l.route) continue;
        const rp = l.route.path;
        const match = Array.isArray(rp) ? rp.includes(p) : rp === p;
        if (match) return l.route.stack[0].handle;
    }
    return null;
};
// /use-item зарегистрирован массивом путей (router.post(['/use', '/use-item'])),
// поэтому Express кладёт в route.path МАССИВ, а не строку.
const getRouterHandler = (router, wantedPath) => {
    for (const l of router.stack) {
        if (!l.route) continue;
        const p = l.route.path;
        const match = Array.isArray(p) ? p.includes(wantedPath) : p === wantedPath;
        if (match) return l.route.stack[0].handle;
    }
    return null;
};

const getUseItemHandler = () => getRouterHandler(itemsRouter, '/use-item');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK  ', name); }
    else { failed++; console.log('  FAIL', name, extra !== undefined ? String(extra) : ''); }
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
    const useItem = getUseItemHandler();
    ok('хендлер /use-item найден', typeof useItem === 'function');

    console.log('\n=== /use-item: аптечка лечит и расходуется ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100, radiation: { level: 0 }, infections: '[]',
            inventory: JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', stats: { healing: 30 }, quantity: 3 }]),
            equipment: '{}'
        }
    });
    let { req, res } = makeReqRes(player(), { item_index: 0 });
    await useItem(req, res);

    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('success', res.body && res.body.success === true, JSON.stringify(res.body));

    // Лечение: Math.min считает потолок в JS, SQL получает готовое значение
    const healUpd = callLog.filter(q => /health = \$\d+/.test(q.sql));
    ok('UPDATE health = $N выполнен', healUpd.length === 1, String(healUpd.length));
    ok('новое здоровье = 70 (40 + 30)', healUpd[0] && healUpd[0].params.some(p => p === 70), JSON.stringify(healUpd[0] && healUpd[0].params));

    console.log('\n=== /use-item: аптечка не перелечивает выше максимума ===');
    reset({
        player: {
            id: 5, health: 90, max_health: 100, radiation: { level: 0 }, infections: '[]',
            inventory: JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', stats: { healing: 30 }, quantity: 1 }]),
            equipment: '{}'
        }
    });
    ({ req, res } = makeReqRes(player(), { item_index: 0 }));
    await useItem(req, res);
    // Потолок считает Math.min в JS: min(100, 90+30) = 100
    const capped = callLog.filter(q => /health = \$\d+/.test(q.sql));
    ok('здоровье зажато в максимум 100', capped.length === 1 && capped[0].params.some(p => p === 100), JSON.stringify(capped[0] && capped[0].params));

    console.log('\n=== /use-item: антирад снижает уровень до нуля и чистит expires_at ===');
    reset({
        player: {
            id: 5, health: 100, max_health: 100,
            radiation: { level: 2, expires_at: '2030-05-05', applied_at: '2024-02-02' },
            infections: '[]',
            inventory: JSON.stringify([{ id: 202, name: 'Антирад', type: 'medicine', stats: { radiation_cure: 10 }, quantity: 1 }]),
            equipment: '{}'
        }
    });
    ({ req, res } = makeReqRes(player(), { item_index: 0 }));
    await useItem(req, res);

    const radUpd = callLog.filter(q => /radiation = \$\d+::jsonb/.test(q.sql));
    ok('UPDATE radiation через ::jsonb выполнен', radUpd.length === 1, String(radUpd.length));

    // params содержит JSON-строку радиации; ищем подстроку только в строках
    const radPayload = () => radUpd[0] ? radUpd[0].params.filter(p => typeof p === 'string' && p.includes('"level"')).join('') : '';
    ok('уровень зажат в 0', radPayload().includes('"level":0'), radPayload());
    ok('expires_at обнулён при level=0', radPayload().includes('"expires_at":null'), radPayload());

    console.log('\n=== /use-item: антирад сохраняет expires_at при уровне > 0 ===');
    reset({
        player: {
            id: 5, health: 100, max_health: 100,
            radiation: { level: 12, expires_at: '2030-05-05', applied_at: '2024-02-02' },
            infections: '[]',
            inventory: JSON.stringify([{ id: 202, name: 'Антирад', type: 'medicine', stats: { radiation_cure: 5 }, quantity: 1 }]),
            equipment: '{}'
        }
    });
    ({ req, res } = makeReqRes(player(), { item_index: 0 }));
    await useItem(req, res);
    const radUpd2 = callLog.filter(q => /radiation = \$\d+::jsonb/.test(q.sql));
    const radPayload2 = () => radUpd2[0] ? radUpd2[0].params.filter(p => typeof p === 'string' && p.includes('"level"')).join('') : '';
    ok('новый уровень = 7 (12 - 5)', radPayload2().includes('"level":7'), radPayload2());
    ok('expires_at сохранён', radPayload2().includes('"expires_at":"2030-05-05"'), radPayload2());

    console.log('\n=== /use-item: валидация индекса ===');
    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), {}));
    await useItem(req, res);
    ok('без item_index -> INVALID_INDEX', res.body && res.body.code === 'INVALID_INDEX', JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { item_index: 'abc' }));
    await useItem(req, res);
    ok('нечисловой item_index -> INVALID_INDEX', res.body && res.body.code === 'INVALID_INDEX', JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { item_index: 2.5 }));
    await useItem(req, res);
    ok('дробный индекс -> INVALID_INDEX', res.body && res.body.code === 'INVALID_INDEX', JSON.stringify(res.body));

    reset({ player: player() });
    ({ req, res } = makeReqRes(player(), { item_index: -1 }));
    await useItem(req, res);
    ok('отрицательный индекс -> INVALID_INDEX', res.body && res.body.code === 'INVALID_INDEX', JSON.stringify(res.body));

    console.log('\n=== /use-item: индекс вне инвентаря ===');
    reset({
        player: {
            id: 5, health: 40, max_health: 100, radiation: { level: 0 }, infections: '[]',
            inventory: JSON.stringify([{ id: 101, name: 'Аптечка', type: 'medicine', stats: { healing: 30 }, quantity: 1 }]),
            equipment: '{}'
        }
    });
    ({ req, res } = makeReqRes(player(), { item_index: 99 }));
    await useItem(req, res);
    ok('ITEM_NOT_IN_INVENTORY', res.body && res.body.code === 'ITEM_NOT_IN_INVENTORY', JSON.stringify(res.body));

    console.log('\n=== /check: урон от радиации ===');
    reset({
        player: {
            id: 5, health: 100, max_health: 100,
            radiation: JSON.stringify({ level: 8 }),
            infections: JSON.stringify([{ level: 0 }])
        }
    });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler(statusRouter, '/check')(req, res);
    ok('HTTP 200', res.statusCode === 200, res.statusCode);
    ok('radiation damage = (8-4)*3 = 12', res.body && res.body.damage === 12, JSON.stringify(res.body));
    ok('уменьшение здоровья в БД', callLog.some(q => /UPDATE players[\s\S]*GREATEST\(0, COALESCE\(health/.test(q.sql)));

    console.log('\n=== /check: радиации ниже порога -> урона нет ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: { level: 3 }, infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler(statusRouter, '/check')(req, res);
    ok('damage === 0', res.body && res.body.damage === 0, JSON.stringify(res.body));
    ok('UPDATE здоровья НЕ выполнен', !callLog.some(q => /UPDATE players[\s\S]*health - /.test(q.sql)));

    console.log('\n=== /check: радиация числом (старый формат) ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: 9, infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler(statusRouter, '/check')(req, res);
    ok('damage = (9-4)*3 = 15', res.body && res.body.damage === 15, JSON.stringify(res.body));

    console.log('\n=== /check: радиация строкой JSON ===');
    reset({ player: { id: 5, health: 100, max_health: 100, radiation: '{"level":6}', infections: '[]' } });
    ({ req, res } = makeReqRes(player(), {}));
    await getHandler(statusRouter, '/check')(req, res);
    ok('damage = (6-4)*3 = 6', res.body && res.body.damage === 6, JSON.stringify(res.body));

    console.log('\n=== Состав маршрутов status.js ===');
    // ЗДЕСЬ БЫЛА ОСИРОТЕВШАЯ ПРОВЕРКА: тест искал обработчик GET / в status.js,
    // но этот роут переехал в player.js при разделении профиля и статуса
    // (сейчас GET /profile). Проверка проходила лишь потому что find возвращал
    // undefined, а typeof undefined === 'undefined'... на самом деле она падала
    // вместе с остальным файлом ещё раньше. Теперь проверяем реальный состав.
    const statusPaths = statusRouter.stack
        .filter(l => l.route)
        .map(l => Array.isArray(l.route.path) ? l.route.path.join('/') : l.route.path);
    ok('в status.js только /check', statusPaths.length === 1 && statusPaths[0] === '/check', statusPaths.join(', '));
    ok('/heal в status.js отсутствует (переехал в /use-item)',
        statusPaths.every(p => p !== '/heal'), statusPaths.join(', '));

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('ИСКЛЮЧЕНИЕ:', e); process.exit(1); });
