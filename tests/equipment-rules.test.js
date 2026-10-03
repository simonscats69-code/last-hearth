/**
 * Правила экипировки и лечения — чистые функции без зависимостей от БД.
 *
 * Файл public/shared/equipment.js читают и сервер, и браузер, поэтому
 * расхождение правил здесь ломает обе стороны сразу.
 */
const rules = require('../public/shared/equipment');

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

