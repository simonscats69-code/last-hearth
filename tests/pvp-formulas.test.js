/**
 * PvP-формулы из db/pvp.js — чистые функции, БД не нужна.
 *
 * Шапка db/pvp.js утверждала, что они покрыты unit-тестами (game.test.js),
 * но тот файл удалили вместе с dev-инструментами в e8911bd — покрытие
 * исчезло вместе с ним. Формулы боя — то место, где ошибка стоит игроку
 * здоровья, поэтому тесты возвращены явно.
 *
 * db/database замокан: модуль требует его при загрузке (pg.Pool).
 */
jest.mock('../db/database', () => require('./helpers/mocks').databaseMock());

const pvp = require('../db/pvp');
const equipmentRules = require('../public/shared/equipment');

/** Боец без снаряжения: базовый урон = сила×2 + ловкость×0.8. */
const fighter = (overrides = {}) => ({
    strength: 10,
    agility: 10,
    endurance: 0,
    level: 1,
    equipment: {},
    ...overrides
});

describe('Урон в PvP', () => {
    test('без оружия: сила×2 + ловкость×0.8, защиты нет', () => {
        expect(pvp.calculatePVPDamage(fighter(), fighter()).damage).toBe(28);
    });

    /**
     * Регрессия: rollVarianceDamage(0, 0) возвращал Math.max(1, 0) === 1,
     * то есть боец без оружия получал 29 урона вместо 28 — урон из ничего.
     * «Минимум 1» нужен для результата удара, а не для отсутствия оружия.
     */
    test('отсутствие оружия не добавляет урона', () => {
        expect(equipmentRules.rollVarianceDamage(0, 0)).toBe(0);
        expect(pvp.calculatePVPDamage(fighter(), fighter()).damage).toBe(28);
    });

    test('нулевое оружие не бьёт, но настоящий удар остаётся минимум 1', () => {
        expect(equipmentRules.rollVarianceDamage(0, 25)).toBe(0);
        expect(equipmentRules.rollVarianceDamage(1, 0)).toBe(1);
        expect(equipmentRules.rollVarianceDamage(0.4, 25)).toBe(1);
    });

    test('выносливость защищает, но не обнуляет урон', () => {
        const weak = pvp.calculatePVPDamage(fighter(), fighter({ endurance: 0 })).damage;
        const tanky = pvp.calculatePVPDamage(fighter(), fighter({ endurance: 100 })).damage;

        expect(tanky).toBeLessThan(weak);
        expect(tanky).toBeGreaterThanOrEqual(1);
    });

    /**
     * Регрессия аудита: защита была min(75%, endurance×0.5) — при endurance
     * ≥ 150 всегда 75%. Теперь мягкий потолок 60%: танк давит, но не
     * становится неуязвимым.
     */
    test('мягкий потолок защиты: 60% недостижимы даже на высокой выносливости', () => {
        const attacker = fighter({ strength: 100, agility: 0, endurance: 0 });
        const base = pvp.calculatePVPDamage(attacker, fighter({ endurance: 0 })).damage;
        const jacked = pvp.calculatePVPDamage(attacker, fighter({ endurance: 100000 })).damage;

        // Остаток урона стремится к 40% от базы и не опускается ниже.
        expect(jacked).toBeGreaterThanOrEqual(Math.floor(base * 0.4));
        expect(jacked).toBeLessThan(base);
    });

    test('урон оружия учитывается, сломанное оружие даёт 0', () => {
        const weapon = { type: 'weapon', damage: 50, durability: 10, max_durability: 10 };
        const withWeapon = pvp.calculatePVPDamage(fighter({ equipment: { weapon } }), fighter()).damage;
        const broken = pvp.calculatePVPDamage(
            fighter({ equipment: { weapon: { ...weapon, durability: 0 } } }),
            fighter()
        ).damage;

        expect(withWeapon).toBeGreaterThan(28);
        expect(broken).toBe(28); // столько же, сколько без оружия
    });

    test('бонус дальнего боя учитывается (pvp_bonus)', () => {
        const plain = pvp.calculatePVPDamage(fighter({ equipment: { weapon: { type: 'weapon', damage: 100 } } }), fighter()).damage;
        const ranged = pvp.calculatePVPDamage(fighter({
            equipment: { weapon: { type: 'weapon', damage: 100, stats: { pvp_bonus: 25 } } }
        }), fighter()).damage;

        expect(ranged).toBeGreaterThan(plain);
    });
/**
     * Разброс (stats.variance) применяется ТОЛЬКО к урону оружия.
     * Если бы он применялся ко всему урону бойца, дробовик в PvP ломал бы
     * расчёт боя: 25% от 28 HP бойца — это ±7 HP мимо оружия.
     */
    test('разброс оружия не трогает урон от характеристик', () => {
        const shotgun = { type: 'weapon', damage: 100, stats: { variance: 25 } };
        const values = new Set();
        for (let i = 0; i < 50; i++) {
            values.add(pvp.calculatePVPDamage(fighter({ equipment: { weapon: shotgun } }), fighter()).damage);
        }

        // 28 (бойца) + 75…125 (оружие с разбросом ±25%)
        const min = Math.min(...values);
        const max = Math.max(...values);
        expect(min).toBeGreaterThanOrEqual(28 + 75);
        expect(max).toBeLessThanOrEqual(28 + 125);
        expect(values.size).toBeGreaterThan(1); // разброс действительно работает
    });

    test('разница уровней даёт ±1% за уровень', () => {
        const equal = pvp.calculatePVPDamage(fighter({ level: 10 }), fighter({ level: 10 })).damage;
        const stronger = pvp.calculatePVPDamage(fighter({ level: 20 }), fighter({ level: 10 })).damage;

        expect(stronger).toBeGreaterThan(equal);
    });

    test('бронированный противник всё равно получает урон', () => {
        const armor = { type: 'armor', defense: 500, durability: 100, max_durability: 100 };
        const damage = pvp.calculatePVPDamage(fighter(), fighter({ equipment: { armor } })).damage;
        expect(damage).toBeGreaterThanOrEqual(1);
    });

    test('пустые объекты и мусорные поля не роняют расчёт', () => {
        expect(() => pvp.calculatePVPDamage(null, null)).not.toThrow();
        expect(pvp.calculatePVPDamage({}, {}).damage).toBeGreaterThanOrEqual(1);
        expect(pvp.calculatePVPDamage({ strength: 'abc' }, {}).damage).toBeGreaterThanOrEqual(1);
        expect(pvp.calculatePVPDamage(fighter(), { equipment: 'не объект' }).damage).toBeGreaterThanOrEqual(1);
    });
describe('Награды PvP', () => {
    test('кража: 10% монет, не больше 10000', () => {
        expect(pvp.calculateCoinsToSteal(1000)).toBe(100);
        expect(pvp.calculateCoinsToSteal(999)).toBe(99);
        expect(pvp.calculateCoinsToSteal(500000)).toBe(10000);
    });

    test('кража не уходит в минус и не ломается на мусоре', () => {
        expect(pvp.calculateCoinsToSteal(-100)).toBe(0);
        expect(pvp.calculateCoinsToSteal(null)).toBe(0);
        // Регрессия: Number('abc' || 0) === NaN (строка истинна), и NaN уезжал
        // в UPDATE coins = coins - $1.
        expect(pvp.calculateCoinsToSteal('abc')).toBe(0);
        expect(pvp.calculateCoinsToSteal(NaN)).toBe(0);
        // Бесконечные монеты — тоже мусор, а не повод выдать максимум:
        // Number.isFinite(Infinity) ложно, поэтому награда 0.
        expect(pvp.calculateCoinsToSteal(Infinity)).toBe(0);
    });

    test('опыт: 50 + 5 за уровень разницы, знак разницы не важен', () => {
        expect(pvp.calculatePVPRewardExperience(1, 1)).toBe(50);
        expect(pvp.calculatePVPRewardExperience(10, 5)).toBe(75);
        expect(pvp.calculatePVPRewardExperience(5, 10)).toBe(75);
    });
});

describe('Кража предметов', () => {
    const inventory = [
        { id: 1, quantity: 2 },
        { id: 2, quantity: 0 },   // пустой стак — красть нечего
        { id: 3, quantity: 1 },
        { id: 4, quantity: 5 }
    ];

    test('берёт не больше лимита и игнорирует пустые стаки', () => {
        const stolen = pvp.getRandomItemsToSteal(inventory, 2);
        expect(stolen).toHaveLength(2);
        expect(stolen.every((item) => item.quantity > 0)).toBe(true);
    });

    test('пустой инвентарь и нечисловой лимит дают пустой результат', () => {
        expect(pvp.getRandomItemsToSteal([], 3)).toEqual([]);
        expect(pvp.getRandomItemsToSteal(null, 3)).toEqual([]);
        expect(pvp.getRandomItemsToSteal(inventory, 0)).toEqual([]);
        expect(pvp.getRandomItemsToSteal(inventory, 'abc')).toEqual([]);
    });

    test('не больше, чем есть предметов со стаком', () => {
        expect(pvp.getRandomItemsToSteal(inventory, 99)).toHaveLength(3);
    });
});

describe('Бой считается по общим правилам снаряжения', () => {
    test('PvP использует те же функции, что бой с боссами', () => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(path.join(__dirname, '..', 'db', 'pvp.js'), 'utf8');

        expect(source).toMatch(/equipmentRules\.getEffectiveStatValue/);
        expect(source).toMatch(/equipmentRules\.rollVarianceDamage/);
        expect(source).toMatch(/equipmentRules\.applyDefenseReduction/);
        expect(source).toMatch(/equipmentRules\.calculateDefenseTotal/);
    });

    test('функции общего модуля доступны', () => {
        expect(typeof equipmentRules.calculateDefenseTotal).toBe('function');
        expect(typeof equipmentRules.rollVarianceDamage).toBe('function');
        expect(typeof equipmentRules.applyDefenseReduction).toBe('function');
    });
});

    test('сломанная броня защитника не снижает урон', () => {
        const attacker = fighter({ strength: 20 });
        const armor = { type: 'armor', defense: 80, durability: 50, max_durability: 50 };
        const intact = pvp.calculatePVPDamage(attacker, fighter({ equipment: { armor } })).damage;
        const broken = pvp.calculatePVPDamage(attacker, fighter({
            equipment: { armor: { ...armor, durability: 0 } }
        })).damage;

        expect(intact).toBeLessThan(broken);
    });
});