/**
 * POST /world/search — экономика поиска лута на fake-клиенте БД.
 *
 * Обработчик длинный и транзакционный: энергия, радиация, инфекция, ключи,
 * дроп, лимит инвентаря, XP и счётчики. Юнит-тесты gameConstants его не видели,
 * а регрессии здесь стоили прогрессии игроков (см. комментарии P0-1/P0-2/P2-10).
 *
 * db/database замокан: модуль при загрузке строит кэш лута и держит пул.
 * Фейковый пул живёт в holder, который каждый тест наполняет заново.
 */
const holder = { client: null };

jest.mock('../db/database', () => {
    const { databaseMock } = require('./helpers/mocks');
    return {
        ...databaseMock(),
        // Кэш лута строится при загрузке модуля — пустой список отправляет
        // getRandomLootItem в fallback-ветку (ORDER BY random()).
        queryAll: async () => [],
        pool: {
            connect: async () => holder.client,
            query: async () => ({ rows: [] })
        }
    };
});
jest.mock('../utils/serverApi', () => require('./helpers/mocks').serverApiMock());
jest.mock('../routes/game/debuffs', () => ({
    DebuffAPI: {
        apply: jest.fn(async () => ({ applied: true })),
        cure: jest.fn(async () => ({ cured: true }))
    }
}));

const worldRouter = require('../routes/game/world');
const MAX_SLOTS = require('../public/shared/equipment').MAX_INVENTORY_SLOTS;

/**
 * Fake-клиент БД: отвечает подготовленными строками по кускам SQL и пишет
 * все запросы в calls — по ним проверяем порядок и параметры.
 */
function fakeClient({ player, location, items = [], bosses = [] } = {}) {
    const calls = [];
    return {
        calls,
        query: async (sql, params = []) => {
            const text = String(sql);
            calls.push({ sql: text, params });

            if (text.includes('FROM players WHERE id = $1 FOR UPDATE')) {
                return { rows: player ? [player] : [] };
            }
            if (text.includes('FROM locations')) {
                return { rows: location ? [location] : [] };
            }
            if (text.includes('FROM bosses')) {
                return { rows: bosses };
            }
            if (text.includes('FROM items')) {
                return { rows: items };
            }
            if (text.includes('RETURNING energy')) {
                return {
                    rows: [{
                        energy: Math.max(0, (player?.energy ?? 10) - 1),
                        max_energy: player?.max_energy ?? 50,
                        last_energy_update: new Date().toISOString()
                    }]
                };
            }
            return { rows: [] };
        },
        release: () => {}
    };
}

/** res.json/res.status с записью тела — для проверки контракта ответа. */
function fakeRes() {
    const res = { body: null, statusCode: 200 };
    res.json = (body) => { res.body = body; return res; };
    res.status = (code) => { res.statusCode = code; return res; };
    return res;
}

/** Игрок по умолчанию: здоров, с энергией, в безопасной локации. */
function makePlayer(overrides = {}) {
    return {
        id: 7,
        energy: 10,
        max_energy: 50,
        current_location_id: 1,
        radiation: null,
        inventory: '[]',
        equipment: '{}',
        luck: 10,
        health: 80,
        max_health: 100,
        last_hp_regen: new Date().toISOString(),
        level: 1,
        experience: 0,
        buffs: null,
        total_actions: 0,
        ...overrides
    };
}

const SAFE_LOCATION = { id: 1, name: 'Спальный район', radiation: 0, infection: 0 };

/** Обработчик POST /search из стека роутера. */
const searchHandler = worldRouter.stack
    .find((layer) => layer.route && layer.route.path === '/search')
    .route.stack[0].handle;

/** Прогоняет POST /search и возвращает fake-клиент с ответом. */
async function runSearch({ player, location, items, bosses } = {}) {
    const resolved = player === null ? null : (player || makePlayer());
    const client = fakeClient({
        player: resolved,
        location: location === undefined ? SAFE_LOCATION : location,
        items,
        bosses
    });
    holder.client = client;

    const res = fakeRes();
    await searchHandler(
        { player: { id: resolved ? resolved.id : 7 }, body: {}, headers: {} },
        res
    );

    return { client, res, body: res.body };
}

/** Запросы, SQL которых содержит фрагмент. */
const callsMatching = (client, fragment) =>
    client.calls.filter((call) => call.sql.includes(fragment));

/** Предмет-жертва: гарантированный дроп при Math.random = 0. */
const KNIFE = {
    id: 1, name: 'Нож', type: 'weapon', category: 'weapon',
    rarity: 'common', icon: '🔪', stats: { damage: 10 }
};
describe('POST /world/search: отказы до логики лута', () => {
    test('игрок не найден → PLAYER_NOT_FOUND', async () => {
        const { client, body } = await runSearch({ player: null });

        expect(body.code).toBe('PLAYER_NOT_FOUND');
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
        expect(callsMatching(client, 'FROM locations')).toHaveLength(0);
    });

    /**
     * Регрессия P0-2: при нулевом здоровье поиск не должен доходить до логики
     * лута — ни чтения локации, ни списания энергии.
     */
    test('нулевое здоровье → NO_HEALTH, локация даже не читается', async () => {
        const { client, body } = await runSearch({ player: makePlayer({ health: 0 }) });

        expect(body.code).toBe('NO_HEALTH');
        expect(body.max_health).toBe(100);
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
        expect(callsMatching(client, 'RETURNING energy')).toHaveLength(0);
        expect(callsMatching(client, 'FROM locations')).toHaveLength(0);
    });

    test('недостаточно энергии → INSUFFICIENT_ENERGY', async () => {
        const { client, body } = await runSearch({ player: makePlayer({ energy: 0 }) });

        expect(body.code).toBe('INSUFFICIENT_ENERGY');
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
        expect(callsMatching(client, 'RETURNING energy')).toHaveLength(0);
    });

    test('несуществующая локация → LOCATION_NOT_FOUND', async () => {
        const { client, body } = await runSearch({ location: null });

        expect(body.code).toBe('LOCATION_NOT_FOUND');
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
    });
});
describe('POST /world/search: энергия и баффы', () => {
    test('энергия списывается ровно на 1', async () => {
        const { client, body } = await runSearch();

        expect(body.success).toBe(true);
        expect(callsMatching(client, 'RETURNING energy')[0].params[0]).toBe(1);
    });

    /**
     * Регрессия P0-1: при трате энергии двигался last_energy_update, и
     * накопленный реген обнулялся каждым действием.
     */
    test('таймер регена энергии не двигается при трате', async () => {
        const { client } = await runSearch();

        expect(callsMatching(client, 'RETURNING energy')[0].sql)
            .not.toMatch(/last_energy_update\s*=/);
    });

    test('бафф free_energy делает поиск бесплатным', async () => {
        const buffs = JSON.stringify({
            free_energy: { expires_at: new Date(Date.now() + 3600_000).toISOString() }
        });
        const { client, body } = await runSearch({ player: makePlayer({ buffs }) });

        expect(body.success).toBe(true);
        expect(callsMatching(client, 'RETURNING energy')[0].params[0]).toBe(0);
    });

    test('истёкший бафф не действует', async () => {
        const buffs = JSON.stringify({
            free_energy: { expires_at: new Date(Date.now() - 1000).toISOString() }
        });
        const { client } = await runSearch({ player: makePlayer({ buffs }) });

        expect(callsMatching(client, 'RETURNING energy')[0].params[0]).toBe(1);
    });

    test('бафф no_radiation гасит накопление радиации', async () => {
        const buffs = JSON.stringify({
            no_radiation: { expires_at: new Date(Date.now() + 3600_000).toISOString() }
        });
        const { body } = await runSearch({
            player: makePlayer({ buffs }),
            location: { id: 4, name: 'Промзона', radiation: 30, infection: 0 }
        });

        expect(body.radiation.gained).toBe(0);
    });

    test('радиация копится в опасной зоне и пишется в БД', async () => {
        const { client, body } = await runSearch({
            location: { id: 4, name: 'Промзона', radiation: 30, infection: 0 }
        });

        expect(body.radiation.gained).toBeGreaterThan(0);
        expect(body.radiation.defense).toBe(0);
        expect(callsMatching(client, 'SET radiation =')).toHaveLength(1);
    });
});
/** Прогон с гарантированным дропом: Math.random = 0 обходит и шанс дропа, и ключ. */
async function runSearchWithDrop(options = {}) {
    const original = Math.random;
    try {
        Math.random = () => 0;
        return await runSearch({ items: [KNIFE], ...options });
    } finally {
        Math.random = original;
    }
}

describe('POST /world/search: лимит инвентаря', () => {
    /**
     * Регрессия P2-10: инвентарь без ограничения раздувался до мегабайт.
     * При полном инвентаре поиск обязан откатиться, а не выдать 101-й слот.
     */
    test(`полный инвентарь (${MAX_SLOTS} слотов) → INVENTORY_FULL`, async () => {
        const full = JSON.stringify(Array.from({ length: MAX_SLOTS }, (_, i) => ({
            id: 900 + i, name: `Хлам ${i}`, rarity: 'common', type: 'resource', quantity: 1
        })));
        const { client, body } = await runSearchWithDrop({
            player: makePlayer({ inventory: full })
        });

        expect(body.code).toBe('INVENTORY_FULL');
        expect(body.error).toContain(String(MAX_SLOTS));
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
        expect(callsMatching(client, 'RETURNING energy')).toHaveLength(0);
    });

    /**
     * Регрессия P2-10 (вторая): проверка до лота не защищала от баффа x2 —
     * при 99 слотах он добавлял ещё два, и лимит молча превышался.
     */
    test('бафф x2 не пробивает лимит слотов', async () => {
        const nearlyFull = JSON.stringify(Array.from({ length: MAX_SLOTS - 1 }, (_, i) => ({
            id: 900 + i, name: `Хлам ${i}`, rarity: 'common', type: 'weapon', quantity: 1
        })));
        const buffs = JSON.stringify({
            loot_x2: { expires_at: new Date(Date.now() + 3600_000).toISOString() }
        });
        const { client, body } = await runSearchWithDrop({
            player: makePlayer({ inventory: nearlyFull, buffs })
        });

        // Оружие не стакуется: x2 добавил бы два слота к 99 → 101.
        expect(body.code).toBe('INVENTORY_FULL');
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(1);
    });
});

describe('POST /world/search: опыт за лут', () => {
    test('опыт по формуле (6 + бонус редкости) × локация × комбо', async () => {
        const { body } = await runSearchWithDrop();

        // Локация 1 → locBonus 1, common → +0, total_actions 0 → комбо 1.
        expect(body.exp_gained).toBe(6);
        expect(body.found_item).toMatchObject({ name: 'Нож', rarity: 'common' });
    });

    test('комбо-бонус ×1.5 на десятом действии', async () => {
        const { body } = await runSearchWithDrop({
            player: makePlayer({ total_actions: 9 })
        });

        expect(body.exp_gained).toBe(9); // floor(6 × 1 × 1.5)
    });

    test('бонус локации повышает опыт', async () => {
        const { body } = await runSearchWithDrop({
            player: makePlayer({ current_location_id: 7 }),
            location: { id: 7, name: 'Бункер', radiation: 0, infection: 0 }
        });

        // Локация 7 → locBonus = 1 + 6 × 0.15 = 1.9 → floor(6 × 1.9) = 11.
        expect(body.exp_gained).toBe(11);
    });

    /**
     * Регрессия: total_actions мог быть NULL у старых записей (колонка
     * добавлена позже). Комбо не срабатывало, и игрок терял треть опыта.
     */
    test('NULL total_actions не ломает расчёт опыта', async () => {
        const { body } = await runSearchWithDrop({
            player: makePlayer({ total_actions: null })
        });

        expect(body.success).toBe(true);
        expect(body.exp_gained).toBeGreaterThan(0);
    });

    test('без дропа опыта нет', async () => {
        const original = Math.random;
        let body;
        try {
            Math.random = () => 0.999; // выше любого dropChance
            ({ body } = await runSearch());
        } finally {
            Math.random = original;
        }

        expect(body.success).toBe(true);
        expect(body.found_item).toBeNull();
        expect(body.exp_gained).toBe(0);
    });
});
describe('POST /world/search: контракт ответа', () => {
    test('ответ содержит всё, что рисует клиент', async () => {
        const { body } = await runSearch();

        expect(body).toMatchObject({
            success: true,
            search_performed: true,
            found_item: null,
            found_key: null,
            energy: { current: expect.any(Number), max: expect.any(Number), restored: 0 },
            radiation: { level: expect.any(Number), gained: expect.any(Number), defense: expect.any(Number) },
            infection: { gained: expect.any(Number), defense: expect.any(Number) },
            location: { name: expect.any(String), infection: 0 },
            drop_chance: expect.any(Number),
            rolled: expect.any(String),
            exp_gained: expect.any(Number)
        });
    });

    /**
     * risk_profile в ответе обязан совпадать с тирами из общего файла правил:
     * клиент рисует подпись отсюда, и раньше у него были свои пороги 2/5/8.
     */
    test('risk_profile соответствует общим тирам риска', async () => {
        const { body } = await runSearch({
            location: { id: 7, name: 'Бункер', radiation: 100, infection: 0 }
        });

        // Бункер без защиты: давление 10 очков → смертельный тир.
        expect(body.risk_profile.tier).toBe('deadly');
        expect(body.risk_profile.score).toBe(10);
        expect(body.risk_profile.is_prepared).toBe(false);
    });

    test('счётчик действий растёт на каждом поиске', async () => {
        const { client } = await runSearch();

        expect(callsMatching(client, 'total_actions = COALESCE(total_actions, 0) + 1')).toHaveLength(1);
    });

    test('транзакция завершается COMMIT', async () => {
        const { client } = await runSearch();

        expect(callsMatching(client, 'COMMIT')).toHaveLength(1);
        expect(callsMatching(client, 'ROLLBACK')).toHaveLength(0);
    });
});
