/**
 * Правила экипировки и лечения — чистые функции без зависимостей от БД.
 *
 * Файл public/shared/equipment.js читают и сервер, и браузер, поэтому
 * расхождение правил здесь ломает обе стороны сразу.
 */
const rules = require('../public/shared/equipment');
const gameConstants = require('../utils/gameConstants');
const fs = require('fs');
const path = require('path');

/** Прочитать исходник проекта — для проверок «клиент и сервер не разошлись». */
const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('Потолок пассивного регена', () => {
    test('60% от максимума, округление вниз', () => {
        expect(rules.getHealthRegenCap(100)).toBe(60);
        expect(rules.getHealthRegenCap(99)).toBe(59);
        expect(rules.getHealthRegenCap(10)).toBe(6);
    });

    test('деградация: max_health undefined/0 не даёт нуля', () => {
        expect(rules.getHealthRegenCap(undefined)).toBeGreaterThanOrEqual(1);
        expect(rules.getHealthRegenCap(0)).toBeGreaterThanOrEqual(1);
        expect(rules.getHealthRegenCap('abc')).toBeGreaterThanOrEqual(1);
    });

    test('регенерируемо — разница до потолка, но не ниже нуля', () => {
        expect(rules.getRegenerableHealth(30, 100)).toBe(30); // 60 - 30
        expect(rules.getRegenerableHealth(60, 100)).toBe(0);  // уже на потолке
        expect(rules.getRegenerableHealth(90, 100)).toBe(0);  // выше потолка — не снижаем
        expect(rules.getRegenerableHealth(0, 100)).toBe(60);
    });

    /**
     * Регрессия P1-4: в POST /world/search в SELECT не было max_health.
     * Хелпер получал undefined → максимум считался 1 → потолок 1 →
     * регенерируемо всегда 0, и ветка «на потолке» обнуляла метку.
     */
    test('без max_health потолок вырождается в 1 — реген невозможен', () => {
        expect(rules.getRegenerableHealth(40, undefined)).toBe(0);
        expect(rules.getRegenerableHealth(40, null)).toBe(0);
    });
});

describe('Порог автолечения', () => {
    test('процент от максимума', () => {
        expect(rules.getAutoHealThreshold(100, 35)).toBe(35);
        expect(rules.getAutoHealThreshold(200, 35)).toBe(70);
    });

    test('зажим в границы 10..90', () => {
        expect(rules.getAutoHealThreshold(100, 1)).toBe(10);
        expect(rules.getAutoHealThreshold(100, 999)).toBe(90);
    });

    test('не число → дефолт 35%', () => {
        expect(rules.getAutoHealThreshold(100, undefined)).toBe(35);
        expect(rules.getAutoHealThreshold(100, null)).toBe(35);
        expect(rules.getAutoHealThreshold(100, 'abc')).toBe(35);
        expect(rules.getAutoHealThreshold(100, NaN)).toBe(35);
        // Пустое поле формы — та же ловушка Number('') === 0, что и у null:
        // раньше пустое значение зажималось в минимум 10%, а UI показывал 35%.
        expect(rules.getAutoHealThreshold(100, '')).toBe(35);
        expect(rules.getAutoHealThreshold(100, '   ')).toBe(35);
    });

    /**
     * Регрессия P0-2: getPlayerBaseState не выбирал auto_heal_threshold,
     * и порог молча откатывался к дефолту, игнорируя настройку игрока.
     */
    test('явно заданный порог не перекрывается дефолтом', () => {
        expect(rules.getAutoHealThreshold(100, 50)).toBe(50);
        expect(rules.getAutoHealThreshold(100, 10)).toBe(10);
        expect(rules.getAutoHealThreshold(100, 90)).toBe(90);
    });
});

describe('selectHealItem', () => {
    const nano = { id: 1, name: 'Нано-аптечка', heal: 60, price: 100, stars_price: 5, stack: 1 };
    const bandage = { id: 2, name: 'Бинт', heal: 15, price: 20, stars_price: 0, stack: 5 };

    test('обычное лекарство предпочтительнее звёздного', () => {
        const choice = rules.selectHealItem([nano, bandage],
            { health: 10, maxHealth: 100, threshold: 35 });
        expect(choice.id).toBe(bandage.id);
    });

    test('звёздный предмет берётся, когда обычных нет', () => {
        const choice = rules.selectHealItem([nano],
            { health: 10, maxHealth: 100, threshold: 35 });
        expect(choice.id).toBe(nano.id);
    });

    test('выбирается максимальная эффективность (HP за монету)', () => {
        const cheap = { id: 3, name: 'Дешёвый', heal: 30, price: 10, stars_price: 0, stack: 1 };
        const dear = { id: 4, name: 'Дорогой', heal: 50, price: 500, stars_price: 0, stack: 1 };
        const choice = rules.selectHealItem([dear, cheap],
            { health: 1, maxHealth: 100, threshold: 35 });
        expect(choice.id).toBe(cheap.id); // 3.0 против 0.1 HP/монету
    });

    test('пустой список и нулевые стаки → null', () => {
        expect(rules.selectHealItem([], { health: 10, maxHealth: 100 })).toBeNull();
        expect(rules.selectHealItem([{ id: 9, heal: 10, price: 1, stack: 0 }],
            { health: 10, maxHealth: 100 })).toBeNull();
        expect(rules.selectHealItem([{ id: 9, heal: 0, price: 1, stack: 1 }],
            { health: 10, maxHealth: 100 })).toBeNull();
    });

    test('отсутствующий stack — предмет есть, отрицательный — нет', () => {
        const noStack = { id: 10, name: 'Без стека', heal: 10, price: 1 };
        expect(rules.selectHealItem([noStack], { health: 1, maxHealth: 100 }).id).toBe(10);
        expect(rules.selectHealItem([{ id: 11, name: 'Минус', heal: 10, price: 1, stack: -2 }],
            { health: 1, maxHealth: 100 })).toBeNull();
    });

    test('предмет с ценой 0 не падает при расчёте эффективности', () => {
        const free = { id: 5, name: 'Бесплатный', heal: 10, price: 0, stars_price: 0, stack: 1 };
        expect(() => rules.selectHealItem([free], { health: 1, maxHealth: 100 })).not.toThrow();
        expect(rules.selectHealItem([free], { health: 1, maxHealth: 100 }).id).toBe(5);
    });

    test('отмечает covers — влезает ли лечение в максимум', () => {
        const big = { id: 6, heal: 80, price: 10, stars_price: 0, stack: 1 };
        const choice = rules.selectHealItem([big], { health: 30, maxHealth: 100 });
        expect(choice.covers).toBe(true); // 30 + 80 >= 100
    });
});

describe('Слоты экипировки', () => {
    test('resolveEquipmentSlot: явный слот', () => {
        expect(rules.resolveEquipmentSlot({ slot: 'body' })).toBe('body');
        expect(rules.resolveEquipmentSlot({ slot: 'weapon' })).toBe('weapon');
    });

    /**
     * Регрессия: раньше слотом служил item.type, и расходник (food)
     * попадал в несуществующий слот и молча исчезал без эффекта.
     */
    test('расходник без слота → null (вызывающий обязан отказать)', () => {
        expect(rules.resolveEquipmentSlot({ type: 'consumable', name: 'Бинт' })).toBeNull();
        expect(rules.resolveEquipmentSlot({ name: 'Нечто' })).toBeNull();
        expect(rules.resolveEquipmentSlot(null)).toBeNull();
    });

    test('MAX_INVENTORY_SLOTS = 100 — единый лимит', () => {
        expect(rules.MAX_INVENTORY_SLOTS).toBe(100);
    });
});

describe('Тиры риска локаций', () => {
    test('границы тиров 1/4/7 — как считает сервер', () => {
        expect(rules.getRiskTierByScore(0).key).toBe('safe');
        expect(rules.getRiskTierByScore(1).key).toBe('safe');
        expect(rules.getRiskTierByScore(2).key).toBe('warning');
        expect(rules.getRiskTierByScore(4).key).toBe('warning');
        expect(rules.getRiskTierByScore(5).key).toBe('danger');
        expect(rules.getRiskTierByScore(7).key).toBe('danger');
        expect(rules.getRiskTierByScore(8).key).toBe('deadly');
        expect(rules.getRiskTierByScore(99).key).toBe('deadly');
    });

    test('нечисловой или отрицательный score не становится смертельным', () => {
        expect(rules.getRiskTierByScore(NaN).key).toBe('safe');
        expect(rules.getRiskTierByScore(undefined).key).toBe('safe');
        expect(rules.getRiskTierByScore(-5).key).toBe('safe');
    });

    test('подписи и множители тиров на месте', () => {
        expect(rules.RISK_TIERS.map((tier) => tier.label))
            .toEqual(['Стабильно', 'Риск', 'Опасно', 'Смертельно']);
        for (const tier of rules.RISK_TIERS) {
            expect(tier.rewardMultiplier).toBeGreaterThanOrEqual(1);
            expect(tier.expMultiplier).toBeGreaterThanOrEqual(1);
        }
        // Порог «освоено» — часть контракта: его читает gameConstants.
        expect(rules.RISK_PREPARED_MAX_SCORE).toBe(2);
    });
});

describe('Интервал регена энергии', () => {
    test('60 секунд — общая константа клиента и сервера', () => {
        expect(rules.ENERGY_REGEN_INTERVAL_MS).toBe(60000);
    });
});

describe('Магазин за звёзды: один каталог для клиента и сервера', () => {
    test('все товары имеют цену, эффект и категорию', () => {
        expect(rules.STAR_SHOP_ITEMS.length).toBe(10);
        for (const item of rules.STAR_SHOP_ITEMS) {
            expect(item.id).toBeTruthy();
            expect(item.name).toBeTruthy();
            expect(Number.isInteger(item.price)).toBe(true);
            expect(item.price).toBeGreaterThan(0);
            expect(item.effect).toBeTruthy();
            expect(['buffs', 'cosmetics']).toContain(item.category);
            // Бафф живёт ограниченное время, косметика — навсегда.
            if (item.category === 'buffs') expect(item.duration).toBeGreaterThan(0);
        }
    });

    test('id уникальны: иначе сервер спишет цену чужого товара', () => {
        const ids = rules.STAR_SHOP_ITEMS.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('поиск по id и по категории', () => {
        expect(rules.getStarShopItem('buff_loot_1h').price).toBe(5);
        expect(rules.getStarShopItem('cosm_frame_elite').category).toBe('cosmetics');
        expect(rules.getStarShopItem('нет_такого')).toBeNull();
        expect(rules.getStarShopItem(undefined)).toBeNull();
        expect(rules.getStarShopItemsByCategory('buffs')).toHaveLength(5);
        expect(rules.getStarShopItemsByCategory('cosmetics')).toHaveLength(5);
        expect(rules.getStarShopItemsByCategory('unknown')).toHaveLength(0);
    });

    test('клиент и сервер берут один каталог, а не две копии', () => {
        const client = read('public/game.js');
        const server = read('routes/game/minigames.js');
        expect(client).toMatch(/getStarShopItemsByCategory/);
        // Старые копии, из-за которых цены могли разойтись.
        expect(client).not.toMatch(/id:\s*'buff_loot_1h'/);
        expect(server).not.toMatch(/BUFFS_CONFIG|COSMETICS_CONFIG/);
        expect(server).toMatch(/getStarShopItem/);
        // Сервер берёт цену из каталога, а не из своей переменной.
        expect(server).toMatch(/itemConfig\.price/);
        expect(server).not.toMatch(/itemConfig\.stars/);
    });
});

describe('Таблицы лута', () => {
    test('сумма шансов в каждой локации равна 100', () => {
        for (const [id, table] of Object.entries(gameConstants.LOOT_TABLES)) {
            const sum = Object.values(table).reduce((a, b) => a + b, 0);
            expect({ id, sum }).toEqual({ id, sum: 100 });
        }
    });

    test('getLootTable: неизвестная локация даёт безопасную первую', () => {
        expect(gameConstants.getLootTable(1)).toBe(gameConstants.LOOT_TABLES[1]);
        expect(gameConstants.getLootTable(99)).toBe(gameConstants.LOOT_TABLES[1]);
        expect(gameConstants.getLootTable(undefined)).toBe(gameConstants.LOOT_TABLES[1]);
    });

    /**
     * Регрессия: бонус удачи начислялся «в вакуум» — к редкостям уходило
     * 2.5 × luckBonus, из common вычиталось 0.25 × luckBonus. Сумма
     * переваливала за 100, и кумулятивная сумма достигала 100 раньше
     * legendary: при luck ≥ 80 самый редкий дроп не выпадал вообще.
     */
    test('бонус удачи не делает legendary недостижимым', () => {
        const original = Math.random;
        try {
            for (const [id, table] of Object.entries(gameConstants.LOOT_TABLES)) {
                for (const luck of [1, 10, 11, 30, 60, 80, 100, 150, 500]) {
                    Math.random = () => 1 - 1e-9; // максимальный roll
                    const rolled = gameConstants.rollItemRarity(Number(id), luck);
                    // Если legendary есть в базовой таблице, он обязан
                    // оставаться достижимым при любой удаче.
                    if (table.legendary > 0) expect(rolled).toBe('legendary');
                }
            }
        } finally {
            Math.random = original;
        }
    });

    test('rollItemRarity всегда возвращает известную редкость', () => {
        const allowed = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        for (let i = 0; i < 500; i++) {
            const rolled = gameConstants.rollItemRarity(5, 150);
            expect(allowed).toContain(rolled);
        }
    });

    /**
     * Баланс: удача обязана повышать долю редких, а не понижать.
     * Проверяем на большой выборке, чтобы не поймать случайный шум.
     */
    test('удача сдвигает баланс в сторону редких предметов', () => {
        const N = 4000;
        const countRarities = (luck) => {
            const counts = {};
            for (let i = 0; i < N; i++) {
                const rarity = gameConstants.rollItemRarity(5, luck);
                counts[rarity] = (counts[rarity] || 0) + 1;
            }
            return counts;
        };

        const lowLuck = countRarities(1);
        const highLuck = countRarities(150);

        expect(highLuck.legendary).toBeGreaterThan(lowLuck.legendary || 0);
        expect(highLuck.epic).toBeGreaterThan(lowLuck.epic || 0);
        expect(highLuck.common).toBeLessThan(lowLuck.common || 0);
    });
});

/**
 * Карта расхождений «сервер ↔ клиент». Юнит-тесты модуля его не видят:
 * баг появляется, когда одна из сторон забывает общий файл правил и заводит
 * свою копию — так родились регрессии P0-2, P1-4 и пороги риска 2/5/8.
 */
describe('Синхронизация клиента и сервера (статические проверки)', () => {
    const between = (source, from, to) => {
        const start = source.indexOf(from);
        const end = source.indexOf(to, start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    };

    test('клиент спрашивает тир риска у shared, а не считает пороги сам', () => {
        const body = between(read('public/game.js'),
            'function getCurrentZoneRiskProfile', 'function updateZonePreparationUI');
        expect(body).toContain('getRiskTierByScore');
        // Самодельные пороги клиента (2/5/8) не должны вернуться.
        expect(body).not.toMatch(/score >= 9|score >= 6/);
    });

    test('сервер берёт таблицу тиров из shared', () => {
        const source = read('utils/gameConstants.js');
        expect(source).toContain('sharedEquipment');
        expect(source).not.toMatch(/maxScore: Number\.POSITIVE_INFINITY/);
        expect(source).toMatch(/isPrepared: riskScore <= RISK_PREPARED_MAX_SCORE/);
    });

    test('сервер считает реген энергии по общему интервалу', () => {
        const source = read('utils/game-helpers.js');
        expect(source).toMatch(/equipmentRules\.ENERGY_REGEN_INTERVAL_MS/);
        expect(source).not.toMatch(/Math\.floor\(elapsedSec \/ 60\)/);
    });

    test('клиент не хардкодит интервал регена', () => {
        const body = between(read('public/game.js'),
            'function getTimeToNextEnergy', 'function formatTimeMs');
        expect(body).toContain('ENERGY_REGEN_INTERVAL_MS');
        expect(body).not.toContain('60000');
    });

    test('клиент не заводит свои копии редкостей и дефолтных интервалов', () => {
        // RARITY_ORDER в game.js был копией порядка редкостей из общего модуля
        // (ещё и в другой форме — числа весов), и нигде не читался.
        const source = read('public/game.js');
        expect(source).not.toMatch(/RARITY_ORDER:\s*\{/);
        expect(source).not.toMatch(/window\.CONSTANTS/);
        // Порядок редкостей приходит из общего файла.
        expect(source).toMatch(/EquipmentShared\?\.ENERGY_REGEN_INTERVAL_MS/);
    });
});

