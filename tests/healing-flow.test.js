/**
 * Поток лечения: пассивный реген и автолечение — на fake-клиенте БД.
 *
 * Порт оставшихся проверок удалённого verify-heal-fixes.js:
 *  - метка last_hp_regen двигается на фактически начисленное время;
 *  - автолечение тратит ровно одну штуку самого экономного предмета;
 *  - NULL-порог читается как дефолтные 35%, а не как «лечиться ниже 10%»;
 *  - контракты маршрутов боя (SELECT-колонки, порядок записи, форма ответа).
 *
 * db/database и utils/serverApi подменены заглушками из helpers/mocks.js:
 * реальный database создаёт pg.Pool, а serverApi — вечный setInterval,
 * поэтому без моков jest не завершился бы.
 */
jest.mock('../db/database', () => require('./helpers/mocks').databaseMock());
jest.mock('../utils/serverApi', () => require('./helpers/mocks').serverApiMock());

const { regenerateHealth, applyAutoHeal } = require('../utils/game-helpers');
const equipmentRules = require('../public/shared/equipment');

const INTERVAL = equipmentRules.HEALTH_REGEN_INTERVAL_MS;

/**
 * Fake-клиент БД: пишет вызовы в calls, на SELECT каталога предметов
 * возвращает подготовленные строки, на остальные запросы — пустой результат.
 */
function fakeClient(catalogRows = []) {
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            calls.push({ sql: String(sql), params });
            return { rows: String(sql).includes('FROM items') ? catalogRows : [] };
        }
    };
}

describe('Пассивный реген: метка last_hp_regen', () => {
    test('первый запуск — только метка, без начислений', async () => {
        const client = fakeClient();
        const player = { id: 7, health: 30, max_health: 100, last_hp_regen: null };

        const restored = await regenerateHealth(client, player);

        expect(restored).toBe(0);
        expect(player.health).toBe(30);
        expect(client.calls).toHaveLength(1);
        expect(client.calls[0].sql).toContain('UPDATE players SET last_hp_regen');
        expect(Number.isFinite(Date.parse(player.last_hp_regen))).toBe(true);
    });

    test('на потолке метка всё равно двигается, здоровье не растёт', async () => {
        const old = new Date(Date.now() - 5 * INTERVAL).toISOString();
        const client = fakeClient();
        const player = { id: 7, health: 60, max_health: 100, last_hp_regen: old };

        const restored = await regenerateHealth(client, player);

        // 60 HP — потолок регена (60% от 100). Метку двигаем: иначе время
        // «застынет» и накопится к моменту, когда игрок получит урон.
        expect(restored).toBe(0);
        expect(player.health).toBe(60);
        expect(Date.parse(player.last_hp_regen)).toBeGreaterThan(Date.parse(old));
        expect(client.calls).toHaveLength(1);
    });

    test('полные интервалы начисляются, дробь не сгорает', async () => {
        const lastMs = Date.now() - 3 * INTERVAL - INTERVAL / 2; // 3.5 интервала
        const client = fakeClient();
        const player = { id: 7, health: 30, max_health: 100, last_hp_regen: new Date(lastMs).toISOString() };

        const restored = await regenerateHealth(client, player);

        expect(restored).toBe(3);
        expect(player.health).toBe(33);
        // Метка сдвинулась ровно на 3 интервала, а не на «сейчас»:
        // оставшиеся полшага сохранятся для следующего запуска.
        expect(Date.parse(player.last_hp_regen)).toBe(lastMs + 3 * INTERVAL);
        expect(client.calls[0].params[0]).toBe(33);
    });

    test('потолок ограничивает начисление, лишнее время не копится', async () => {
        const lastMs = Date.now() - 5 * INTERVAL;
        const client = fakeClient();
        // health 59 при потолке 60 — регенерируемо ровно 1 HP.
        const player = { id: 7, health: 59, max_health: 100, last_hp_regen: new Date(lastMs).toISOString() };

        const restored = await regenerateHealth(client, player);

        expect(restored).toBe(1);
        expect(player.health).toBe(60);
        // Списано ровно одно начисленное время: остальной запас остаётся
        // на метке и сработает позже, а не «выстрелит» пачкой HP.
        expect(Date.parse(player.last_hp_regen)).toBe(lastMs + INTERVAL);
    });

    test('неполный интервал — ни начисления, ни записи в БД', async () => {
        const last = new Date(Date.now() - 1000).toISOString();
        const client = fakeClient();
        const player = { id: 7, health: 30, max_health: 100, last_hp_regen: last };

        const restored = await regenerateHealth(client, player);

        expect(restored).toBe(0);
        expect(player.last_hp_regen).toBe(last);
        expect(client.calls).toHaveLength(0);
    });
});

describe('Автолечение: расход ровно одной штуки', () => {
    // Строки каталога items — в том виде, как их отдаёт SELECT в applyAutoHeal.
    const bandageRow = { id: 2, name: 'Бинт', icon: '🩹', price: 20, stars_price: 0, rarity: 'common', heal: 15 };
    const nanoRow = { id: 1, name: 'Нано-аптечка', icon: '💉', price: 100, stars_price: 5, rarity: 'epic', heal: 60 };

    test('одна штука из стака: количество уменьшается, здоровье растёт', async () => {
        const client = fakeClient([bandageRow]);
        const player = {
            id: 7, health: 20, max_health: 100,
            auto_heal_enabled: true, auto_heal_threshold: 35,
            inventory: [{ id: 2, name: 'Бинт', quantity: 3, stats: { health: 15 } }]
        };

        const result = await applyAutoHeal(client, 7, player);

        expect(result).toEqual({ used: 'Бинт', heal: 15, health: 35 });
        expect(player.health).toBe(35);
        expect(player.inventory[0].quantity).toBe(2);

        const update = client.calls.find((call) => call.sql.startsWith('UPDATE players'));
        expect(update.params[0]).toBe(35);
        expect(JSON.parse(update.params[1])[0].quantity).toBe(2);
        expect(update.params[2]).toBe(7);
    });

    test('последняя штука исчезает из инвентаря целиком', async () => {
        const client = fakeClient([bandageRow]);
        const player = {
            id: 7, health: 20, max_health: 100,
            auto_heal_enabled: true, auto_heal_threshold: 35,
            inventory: [{ id: 2, name: 'Бинт', quantity: 1, stats: { health: 15 } }]
        };

        await applyAutoHeal(client, 7, player);

        expect(player.inventory).toEqual([]);
    });

    test('звёздный предмет не трогается, пока есть обычное лекарство', async () => {
        const client = fakeClient([nanoRow, bandageRow]);
        const player = {
            id: 7, health: 20, max_health: 100,
            auto_heal_enabled: true, auto_heal_threshold: 35,
            inventory: [
                { id: 1, name: 'Нано-аптечка', quantity: 1, stats: { health: 60 } },
                { id: 2, name: 'Бинт', quantity: 5, stats: { health: 15 } }
            ]
        };

        const result = await applyAutoHeal(client, 7, player);

        expect(result.used).toBe('Бинт');
        expect(player.inventory[0].quantity).toBe(1); // награда за звёзды цела
        expect(player.inventory[1].quantity).toBe(4);
    });

    test('auto_heal_threshold = NULL — дефолтные 35%, а не «лечиться ниже 10%»', async () => {
        // 30 HP при пороге 35 лечатся; старый баг с Number(null) → 10
        // оставлял игрока без аптечки, хотя UI показывал 35%.
        const client = fakeClient([bandageRow]);
        const player = {
            id: 7, health: 30, max_health: 100,
            auto_heal_enabled: true, auto_heal_threshold: null,
            inventory: [{ id: 2, name: 'Бинт', quantity: 2, stats: { health: 15 } }]
        };

        const result = await applyAutoHeal(client, 7, player);

        expect(result).not.toBeNull();
        expect(result.health).toBe(45);
    });

    test('выключено / полное здоровье / выше порога / нет лекарств → null', async () => {
        const stock = [{ id: 2, name: 'Бинт', quantity: 1, stats: { health: 15 } }];
        const base = { id: 7, max_health: 100, inventory: stock };

        expect(await applyAutoHeal(fakeClient(), 7,
            { ...base, health: 10, auto_heal_enabled: false })).toBeNull();
        expect(await applyAutoHeal(fakeClient(), 7,
            { ...base, health: 100, auto_heal_enabled: true })).toBeNull();
        expect(await applyAutoHeal(fakeClient(), 7,
            { ...base, health: 80, auto_heal_enabled: true, auto_heal_threshold: 35 })).toBeNull();

        const noMedicine = {
            id: 7, health: 20, max_health: 100, auto_heal_enabled: true,
            inventory: [{ id: 3, name: 'Сухарик', quantity: 1, stats: { food: 5 } }]
        };
        expect(await applyAutoHeal(fakeClient(), 7, noMedicine)).toBeNull();
    });
});

describe('Контракты маршрутов боя (порт verify-heal-fixes)', () => {
    const fs = require('fs');
    const path = require('path');
    const readSource = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    const bosses = readSource('routes/game/bosses.js');
    const world = readSource('routes/game/world.js');

    /** Вырезать тело функции: от `from` до следующего `to` (исключая его) */
    const between = (source, from, to) => {
        const start = source.indexOf(from);
        const end = source.indexOf(to, start + from.length);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    };

    test('getPlayerBaseState выбирает настройки автолечения (P0-2)', () => {
        const body = between(bosses, 'async function getPlayerBaseState', 'async function clearPlayerActiveBattle');

        expect(body).toMatch(/auto_heal_enabled,\s*auto_heal_threshold/);
        expect(body).toMatch(/max_health/);
        expect(body).toMatch(/FOR UPDATE/);
        expect(body).not.toMatch(/SELECT\s+\*/i);
    });

    test('applyBossCounterHit фиксирует урон до автолечения', () => {
        const body = between(bosses, 'async function applyBossCounterHit', 'async function getBossById');

        const damageWrite = body.indexOf('UPDATE players');
        const healCall = body.indexOf('applyAutoHeal(');
        // Обратный порядок приводил к тому, что UPDATE урона перезаписывал
        // вылеченное здоровье: аптечка списывалась, HP оставались низкими.
        expect(damageWrite).toBeGreaterThan(-1);
        expect(healCall).toBeGreaterThan(damageWrite);
        expect(body).toMatch(/auto_heal:\s*autoHealed\s*\?/);
        expect(body).toMatch(/auto_heal:\s*null/);
    });

    test('каждый боевой ответ прокидывает auto_heal клиенту', () => {
        // Без этих полей клиент не рисует строку «❤️ Автолечение» в логе боя.
        const forwarded = bosses.match(/auto_heal:\s*counterHit\.auto_heal/g) || [];
        expect(forwarded.length).toBeGreaterThanOrEqual(4);
    });

    test('POST /world/search выбирает поля регена и вызывает его (P1-4)', () => {
        // Без max_health и last_hp_regen в SELECT поиск лута не лечил,
        // а ветка «на потолке» обнуляла накопленное время регена.
        expect(world).toMatch(/max_health,\s*last_hp_regen/);
        expect(world).toMatch(/regenerateHealth\(client,\s*updatedPlayer\)/);
    });
});

/**
 * Порог автолечения: серверная нормализация и клиентский лейбл должны
 * использовать одно правило из shared/equipment.js — иначе игрок видит
 * один порог, а сервер лечит по другому (регрессия класса P0-2).
 */
describe('Порог автолечения: сервер и клиент', () => {
    const fs = require('fs');
    const path = require('path');
    const readSource = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

    test('POST /auto-heal нормализует порог общим правилом', () => {
        const route = readSource('routes/game/player.js');
        // Своя цепочка Math.round(Number(threshold)) на мусорном входе давала
        // NaN, и UPDATE падал 500-й. getAutoHealThreshold(100, x) зажимает
        // 10..90 и решает NULL/'' как дефолтные 35.
        expect(route).toMatch(/rules\.getAutoHealThreshold\(100,\s*threshold\)/);
        expect(route).not.toMatch(/Math\.round\(Number\(threshold\)\)/);
    });

    test('клиент показывает порог в HP той же формулой, что сервер', () => {
        const client = readSource('public/game.js');
        // Math.round(maxHealth * % / 100) против серверного floor: надпись
        // «сработает при X HP» обещала на 1 HP больше на дробных процентах.
        expect(client).toMatch(/shared\.getAutoHealThreshold\(maxHealth/);
        expect(client).not.toMatch(/Math\.round\(\(maxHealth \* /);
    });
});
