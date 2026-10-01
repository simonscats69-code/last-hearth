/**
 * Unit тесты для критичных функций игры
 */

const { validateTelegramInitData, isAdmin } = require('./utils/serverApi');
const { getMetrics, resetMetrics } = require('./utils/realtime');
// ACHIEVEMENTS was removed — achievements are now stored in DB with schema seed
// Tests for static achievements have been migrated to schema tests
const { calculateLocationRiskProfile } = require('./utils/gameConstants');
const { calculateCoinsToSteal, calculatePVPRewardExperience, calculatePVPDamage, getRandomItemsToSteal } = require('./db/pvp');
const { calculateDropChance, calculateDebuffModifiers, getDebuffTier, calculateRadiationDefense } = require('./utils/gameConstants');
const { normalizeInventory, createInventoryItem, getInventoryItemCategory, getActiveBuffs, isBuffActive, normalizeEquipment, calculateSellPrice, addItemToInventory, recalcEnergy } = require('./utils/game-helpers');
const { getExpForLevel, getTotalExpForLevel } = require('./utils/gameConstants');

// Общие правила экипировки: сервер и браузер читают один и тот же файл
// (public/shared/equipment.js). Если эти тесты падают — значит клиент и
// сервер считают защиту по-разному и игрок увидит одно, а получит другое.
const sharedEquipment = require('./public/shared/equipment.js');

// =============================================================================
// Тесты telegramAuth
// =============================================================================

describe('telegramAuth', () => {
    describe('validateTelegramInitData', () => {
        test('должен вернуть null для пустых данных', () => {
            expect(validateTelegramInitData(null, 'token')).toBeNull();
            expect(validateTelegramInitData('', 'token')).toBeNull();
            expect(validateTelegramInitData('data', null)).toBeNull();
        });
        
        test('должен вернуть null для данных без hash', () => {
            const initData = 'user={"id":123}&auth_date=1234567890';
            expect(validateTelegramInitData(initData, 'token')).toBeNull();
        });
    });
    
    describe('isAdmin', () => {
        test('должен вернуть true для админа в списке', () => {
            expect(isAdmin('123', ['123', '456'])).toBe(true);
        });

        test('должен вернуть false для не-админа', () => {
            expect(isAdmin('789', ['123', '456'])).toBe(false);
        });

        test('должен вернуть false для пустого списка', () => {
            expect(isAdmin('123', [])).toBe(false);
            expect(isAdmin('123', null)).toBe(false);
        });
    });
});

// =============================================================================
// Тесты metrics
// =============================================================================

describe('metrics', () => {
    beforeEach(() => {
        resetMetrics();
    });
    
    describe('getMetrics', () => {
        test('должен вернуть корректную структуру метрик', () => {
            const metrics = getMetrics();
            
            expect(metrics).toHaveProperty('uptime');
            expect(metrics).toHaveProperty('requests');
            expect(metrics).toHaveProperty('performance');
            expect(metrics).toHaveProperty('system');
            expect(metrics).toHaveProperty('endpoints');
        });
        
        test('должен показывать 0 запросов при старте', () => {
            const metrics = getMetrics();
            
            expect(metrics.requests.total).toBe(0);
            expect(metrics.requests.success).toBe(0);
            expect(metrics.requests.errors).toBe(0);
        });
    });
});

// =============================================================================
// Тесты achievements
// =============================================================================

// Достижения теперь хранятся в БД (таблица achievements)
// Статические тесты ACHIEVEMENTS больше не актуальны
// Все тесты достижений перенесены в schema.test.js

// =============================================================================
// Тесты игровой логики
// =============================================================================

describe('Игровая логика', () => {
    describe('Профиль риска локации', () => {
        test('должен считать зону безопасной при достаточной защите', () => {
            const profile = calculateLocationRiskProfile(
                { radiation: 10, infection: 10 },
                {
                    armor: { stats: { radiation_resist: 10, infection_resist: 10 } }
                }
            );

            expect(profile.tier).toBe('safe');
            expect(profile.isPrepared).toBe(true);
            expect(profile.riskScore).toBe(0);
        });

        test('должен повышать риск для опасной зоны без экипировки', () => {
            const profile = calculateLocationRiskProfile(
                { radiation: 80, infection: 40 },
                {}
            );

            expect(profile.riskScore).toBeGreaterThan(7);
            expect(profile.tier).toBe('deadly');
            expect(profile.isPrepared).toBe(false);
        });
    });

    describe('Расчёт опыта для уровня', () => {
        test('должен требовать больше опыта для высоких уровней', () => {
            // Базовый расчёт: 100 * level^1.5
            const exp1 = Math.floor(100 * Math.pow(1, 1.5));
            const exp5 = Math.floor(100 * Math.pow(5, 1.5));
            const exp10 = Math.floor(100 * Math.pow(10, 1.5));
            
            expect(exp5).toBeGreaterThan(exp1);
            expect(exp10).toBeGreaterThan(exp5);
        });
    });
    
    describe('Расчёт max_energy', () => {
        test('должен увеличиваться с уровнем', () => {
            // Формула: 50 + Math.floor(level / 10) * 5, max 150
            const maxEnergy1 = Math.min(150, 50 + Math.floor(1 / 10) * 5);
            const maxEnergy10 = Math.min(150, 50 + Math.floor(10 / 10) * 5);
            const maxEnergy50 = Math.min(150, 50 + Math.floor(50 / 10) * 5);
            
            expect(maxEnergy10).toBeGreaterThanOrEqual(maxEnergy1);
            expect(maxEnergy50).toBeGreaterThanOrEqual(maxEnergy10);
        });
        
        test('не должен превышать 100 по текущей формуле', () => {
            const maxEnergy100 = Math.min(150, 50 + Math.floor(100 / 10) * 5);
            expect(maxEnergy100).toBe(100);
        });
    });
    
    describe('Расчёт max_health', () => {
        test('должен увеличиваться с уровнем', () => {
            // Формула: 100 + Math.floor(level / 5) * 10, max 200
            const maxHealth1 = Math.min(200, 100 + Math.floor(1 / 5) * 10);
            const maxHealth10 = Math.min(200, 100 + Math.floor(10 / 5) * 10);
            
            expect(maxHealth10).toBeGreaterThanOrEqual(maxHealth1);
        });
    });

    describe('PvP награды', () => {
        test('должен давать больше опыта за победу над более сильным противником', () => {
            const equalReward = calculatePVPRewardExperience(10, 10);
            const harderReward = calculatePVPRewardExperience(15, 10);

            expect(harderReward).toBeGreaterThan(equalReward);
        });

        test('не должен красть монеты у пустого кошелька', () => {
            expect(calculateCoinsToSteal(0, 10)).toBe(0);
        });

        test('не должен красть больше половины монет', () => {
            const stolen = calculateCoinsToSteal(1000, 999);
            expect(stolen).toBeLessThanOrEqual(500);
        });
    });
});

// =============================================================================
// Тесты валидации
// =============================================================================

describe('Валидация', () => {
    describe('Проверка ID игрока', () => {
        test('должен принимать положительные целые числа', () => {
            const validIds = [1, 100, 999999];
            for (const id of validIds) {
                expect(Number.isInteger(id) && id > 0).toBe(true);
            }
        });
        
        test('должен отклонять невалидные ID', () => {
            const invalidIds = [0, -1, 1.5, null, undefined, 'abc'];
            for (const id of invalidIds) {
                const isValid = Number.isInteger(id) && id > 0;
                expect(isValid).toBe(false);
            }
        });
    });
    
    describe('Проверка количества энергии', () => {
        test('должен принимать значения от 1 до 100', () => {
            const validAmounts = [1, 50, 100];
            for (const amount of validAmounts) {
                const isValid = Number.isInteger(amount) && amount >= 1 && amount <= 100;
                expect(isValid).toBe(true);
            }
        });
        
        test('должен отклонять значения вне диапазона', () => {
            const invalidAmounts = [0, -1, 101, 1.5];
            for (const amount of invalidAmounts) {
                const isValid = Number.isInteger(amount) && amount >= 1 && amount <= 100;
                expect(isValid).toBe(false);
            }
        });
    });
});

// =============================================================================
// Тесты нормализации состояния
// =============================================================================

describe('Нормализация состояния', () => {
    describe('normalizeInventory', () => {
        test('должен сохранять массив инвентаря как есть', () => {
            const inventory = [{ id: 1, name: 'Нож' }];
            expect(normalizeInventory(inventory)).toEqual(inventory);
        });

        test('должен преобразовывать объектный инвентарь в массив', () => {
            const inventoryObject = {
                a: { id: 1, name: 'Нож' },
                b: { id: 2, name: 'Аптечка' }
            };

            expect(normalizeInventory(inventoryObject)).toEqual([
                { id: 1, name: 'Нож' },
                { id: 2, name: 'Аптечка' }
            ]);
        });

        test('должен отбрасывать мусорные значения из объектного инвентаря', () => {
            const inventoryObject = {
                a: { id: 1, name: 'Нож', type: 'weapon' },
                b: null,
                c: 'bad',
                d: 12
            };

            expect(normalizeInventory(inventoryObject)).toEqual([
                { id: 1, name: 'Нож', type: 'weapon' }
            ]);
        });
    });

    describe('createInventoryItem', () => {
        test('должен собирать предмет с унифицированными полями из stats', () => {
            const item = createInventoryItem({
                id: 7,
                name: 'Армейская аптечка',
                type: 'medicine',
                icon: '🩹',
                stats: { health: 35, radiation_cure: 2 }
            });

            expect(item.heal).toBe(35);
            expect(item.rad_removal).toBe(2);
            expect(item.quantity).toBe(1);
            expect(item.modifications).toEqual({});
            expect(item.stats).toEqual({ health: 35, radiation_cure: 2 });
        });

        test('должен сохранять категорию и количество из overrides', () => {
            const item = createInventoryItem({
                id: 11,
                name: 'Самодельный дробовик',
                type: 'weapon'
            }, {
                category: 'weapon',
                quantity: 3,
                damage: 14
            });

            expect(item.category).toBe('weapon');
            expect(item.quantity).toBe(3);
            expect(item.damage).toBe(14);
        });
    });

    describe('getInventoryItemCategory', () => {
        test('должен брать category как основной источник', () => {
            expect(getInventoryItemCategory({ category: 'Medicine', type: 'food' })).toBe('medicine');
        });

        test('должен fallback на type', () => {
            expect(getInventoryItemCategory({ type: 'weapon' })).toBe('weapon');
            expect(getInventoryItemCategory(null)).toBe('misc');
        });
    });

    describe('баффы', () => {
        test('должен возвращать только активные баффы', () => {
            const now = Date.now();
            const buffs = {
                loot_x2: { expires_at: new Date(now + 60_000).toISOString() },
                exp_x2: { expires_at: new Date(now - 60_000).toISOString() }
            };

            const activeBuffs = getActiveBuffs(buffs, now);

            expect(activeBuffs).toHaveProperty('loot_x2');
            expect(activeBuffs).not.toHaveProperty('exp_x2');
        });

        test('должен корректно определять активность конкретного баффа', () => {
            const now = Date.now();
            const buffs = {
                free_energy: { expires_at: new Date(now + 60_000).toISOString() }
            };

            expect(isBuffActive(buffs, 'free_energy', now)).toBe(true);
            expect(isBuffActive(buffs, 'loot_x2', now)).toBe(false);
        });
    });
});

// =============================================================================
// Тесты улучшений (P0-P2)
// =============================================================================

describe('P0-P2 улучшения', () => {
    describe('recalcEnergy (P0-1)', () => {
        test('должен восстанавливать энергию за прошедшее время', async () => {
            // Мокируем клиента/игрока
            const player = {
                id: 1,
                energy: 5,
                max_energy: 10,
                last_energy_update: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 минут назад
            };
            
            // Проверка: за 5 минут должно восстановиться 5 энергии
            const elapsedMs = Date.now() - new Date(player.last_energy_update).getTime();
            const restored = Math.floor(elapsedMs / 60000);
            const expectedEnergy = Math.min(player.max_energy, player.energy + restored);
            
            expect(expectedEnergy).toBeGreaterThan(player.energy);
            expect(expectedEnergy).toBeLessThanOrEqual(player.max_energy);
        });

        test('не должен превышать max_energy', () => {
            const player = {
                energy: 8,
                max_energy: 10,
                last_energy_update: new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 часа назад
            };
            
            const elapsedMs = Date.now() - new Date(player.last_energy_update).getTime();
            const restored = Math.floor(elapsedMs / 60000);
            const expectedEnergy = Math.min(player.max_energy, player.energy + restored);
            
            expect(expectedEnergy).toBe(10);
        });
    });

    describe('getExpForLevel (P0-3)', () => {
        test('должен возвращать положительное число для любого уровня', () => {
            expect(getExpForLevel(1)).toBeGreaterThan(0);
            expect(getExpForLevel(50)).toBeGreaterThan(0);
            expect(getExpForLevel(100)).toBeGreaterThan(0);
        });

        test('должен возрастать с уровнем', () => {
            const exp1 = getExpForLevel(1);
            const exp10 = getExpForLevel(10);
            const exp50 = getExpForLevel(50);
            
            expect(exp10).toBeGreaterThan(exp1);
            expect(exp50).toBeGreaterThan(exp10);
        });

        test('должен рассчитывать по формуле 500*level*(1+level/25)', () => {
            // Ожидаемая формула: Math.round(500 * level * (1 + level / 25))
            const expected = (level) => Math.round(500 * level * (1 + level / 25));
            
            expect(getExpForLevel(1)).toBe(expected(1));
            expect(getExpForLevel(25)).toBe(expected(25));
            expect(getExpForLevel(50)).toBe(expected(50));
        });
    });

    describe('getTotalExpForLevel', () => {
        test('должен корректно суммировать опыт для достижения уровня', () => {
            const totalTo10 = getTotalExpForLevel(10);
            expect(totalTo10).toBeGreaterThan(0);
            expect(totalTo10).toBeGreaterThan(getExpForLevel(9));
        });
    });

    describe('normalizeEquipment (P2-13)', () => {
        test('должен нормализовать JSON строку в объект', () => {
            const json = '{"weapon":{"id":5,"damage":10},"armor":{"id":3,"defense":5}}';
            const result = normalizeEquipment(json);
            
            expect(result).toHaveProperty('weapon');
            expect(result).toHaveProperty('armor');
            expect(result.weapon.damage).toBe(10);
        });

        test('должен возвращать пустой объект для null/undefined', () => {
            expect(normalizeEquipment(null)).toEqual({});
            expect(normalizeEquipment(undefined)).toEqual({});
        });

        test('должен возвращать объект как есть', () => {
            const obj = { weapon: { id: 1 } };
            expect(normalizeEquipment(obj)).toEqual(obj);
        });
    });
});

// =============================================================================
// Регрессионные тесты: world.js / pvp.js логика
// =============================================================================

describe('Регрессия: мир и PvP', () => {
    describe('calculateDropChance (world)', () => {
        test('должен возвращать 5% при нулевой/отрицательной удаче', () => {
            expect(calculateDropChance(0)).toBe(5);
            expect(calculateDropChance(-10)).toBe(5);
        });

        test('должен монотонно расти с удачей', () => {
            const c1 = calculateDropChance(1);
            const c30 = calculateDropChance(30);
            const c60 = calculateDropChance(60);
            const c100 = calculateDropChance(100);

            expect(c30).toBeGreaterThan(c1);
            expect(c60).toBeGreaterThan(c30);
            expect(c100).toBeGreaterThan(c60);
        });

        test('не должен превышать MAX_DROP_CHANCE (60%)', () => {
            expect(calculateDropChance(150)).toBeLessThanOrEqual(60);
            expect(calculateDropChance(1000)).toBeLessThanOrEqual(60);
        });
    });

    describe('getDebuffTier (world)', () => {
        test('должен корректно определять тиры по уровню', () => {
            expect(getDebuffTier(0)).toBe('safe');
            expect(getDebuffTier(1)).toBe('active');
            expect(getDebuffTier(3)).toBe('warning');
            expect(getDebuffTier(5)).toBe('danger');
            expect(getDebuffTier(8)).toBe('critical');
        });
    });

    describe('calculateRadiationDefense (world)', () => {
        test('должен суммировать защиту из экипировки', () => {
            const equipment = {
                armor: { stats: { radiation_resist: 30 } },
                helmet: { stats: { radiation_resist: 20 } }
            };
            // 30+20 = 50, /10 = 5 очков защиты
            expect(calculateRadiationDefense(equipment)).toBe(5);
        });

        test('должен возвращать 0 без экипировки', () => {
            expect(calculateRadiationDefense(null)).toBe(0);
            expect(calculateRadiationDefense({})).toBe(0);
        });
    });

    describe('calculateDebuffModifiers (world)', () => {
        test('должен снижать удачу при радиации', () => {
            const modifiers = calculateDebuffModifiers({
                radiation: JSON.stringify({ level: 5 }),
                infections: '[]'
            });
            // -4% за уровень * 5 = -20% → 0.8
            expect(modifiers.luck).toBeCloseTo(0.8, 5);
            expect(modifiers.dropChance).toBeCloseTo(0.8, 5);
        });

        test('должен возвращать базовые множители без дебаффов', () => {
            const modifiers = calculateDebuffModifiers({});
            expect(modifiers.damage).toBe(1);
            expect(modifiers.luck).toBe(1);
            expect(modifiers.dropChance).toBe(1);
            expect(modifiers.endurance).toBe(1);
        });
    });

    describe('calculatePVPDamage (pvp)', () => {
        test('должен наносить минимум 1 урон', () => {
            const result = calculatePVPDamage(
                { strength: 1, agility: 1, luck: 0, equipment: {} },
                { equipment: {}, agility: 0 }
            );
            expect(result.damage).toBeGreaterThanOrEqual(1);
        });

        test('сильный игрок наносит больше урона', () => {
            const weak = calculatePVPDamage(
                { strength: 5, agility: 5, luck: 1, equipment: {} },
                { equipment: {}, agility: 1 }
            );
            const strong = calculatePVPDamage(
                { strength: 50, agility: 50, luck: 10, equipment: {} },
                { equipment: {}, agility: 1 }
            );
            expect(strong.damage).toBeGreaterThanOrEqual(weak.damage);
        });
    });

    describe('getRandomItemsToSteal (pvp)', () => {
        test('должен красть только предметы с quantity > 0', () => {
            const inventory = [
                { id: 1, quantity: 5 },
                { id: 2, quantity: 0 },
                { id: 3, quantity: 2 }
            ];
            const stolen = getRandomItemsToSteal(inventory, 5);
            expect(stolen.length).toBeLessThanOrEqual(3);
            for (const item of stolen) {
                expect(item.quantity).toBeGreaterThan(0);
            }
        });

        test('не должен красть больше maxItems', () => {
            const inventory = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, quantity: 3 }));
            const stolen = getRandomItemsToSteal(inventory, 2);
            expect(stolen.length).toBeLessThanOrEqual(2);
        });

        test('должен возвращать пустой массив при пустом инвентаре', () => {
            expect(getRandomItemsToSteal([], 3)).toEqual([]);
            expect(getRandomItemsToSteal(null, 3)).toEqual([]);
        });
    });
});

// =============================================================================
// Экономика инвентаря: продажа предметов и стакование
// =============================================================================

describe('Экономика инвентаря', () => {
    const dbFood = { id: 1, type: 'food', category: 'food', stackable: true, max_stack: 99 };
    const makeFood = (quantity = 1) => ({
        id: 1, name: 'Яблоко', type: 'food', category: 'food',
        rarity: 'common', quantity, upgrade_level: 0
    });

    describe('calculateSellPrice', () => {
        test('считает долю от цены магазина', () => {
            expect(calculateSellPrice({ id: 1, type: 'food', rarity: 'common', price: 100 }, {})).toBe(35);
        });

        test('даёт минимум 1 монету за дешёвый предмет', () => {
            expect(calculateSellPrice({ id: 1, type: 'food', rarity: 'common', price: 2 }, {})).toBe(1);
        });

        test('ключи боссов продавать нельзя', () => {
            // Иначе монеты фармились бы по кругу: купил ключ -> продал.
            expect(calculateSellPrice({ id: 9, type: 'key', rarity: 'epic', price: 500 }, {})).toBe(0);
        });

        test('для добычи без price берётся минимум по редкости', () => {
            expect(calculateSellPrice({ id: 5, type: 'medicine', rarity: 'common', price: 0 }, {})).toBe(3);
            expect(calculateSellPrice({ id: 6, type: 'medicine', rarity: 'rare', price: 0 }, {})).toBe(20);
            expect(calculateSellPrice({ id: 7, type: 'medicine', rarity: 'legendary', price: 0 }, {})).toBe(100);
        });

        test('неизвестный предмет не продаётся', () => {
            expect(calculateSellPrice(null, { id: 999, type: 'food' })).toBe(0);
        });
    });

    describe('addItemToInventory', () => {
        test('расходники складываются в один слот', () => {
            const inv = [];
            addItemToInventory(inv, makeFood(1), dbFood);
            addItemToInventory(inv, makeFood(4), dbFood);

            expect(inv).toHaveLength(1);
            expect(inv[0].quantity).toBe(5);
        });

        test('учитывает max_stack и создаёт новый слот при переполнении', () => {
            const inv = [];
            const db = { ...dbFood, max_stack: 5 };
            addItemToInventory(inv, makeFood(4), db);
            addItemToInventory(inv, makeFood(4), db);

            expect(inv).toHaveLength(2);
            expect(inv[0].quantity).toBe(5);
            expect(inv[1].quantity).toBe(3);
        });

        test('оружие НИКОГДА не стакается', () => {
            // Два одинаковых меча в одном слоте — поломанный предмет.
            const inv = [];
            const db = { id: 2, type: 'weapon', category: 'weapon', stackable: true, max_stack: 99 };
            const sword = { id: 2, name: 'Меч', type: 'weapon', category: 'weapon', rarity: 'rare', quantity: 1 };

            addItemToInventory(inv, { ...sword }, db);
            addItemToInventory(inv, { ...sword }, db);

            expect(inv).toHaveLength(2);
        });

        test('броня не стакается даже с пустым slot в БД', () => {
            // items.slot nullable — часть брони идёт без слота.
            const inv = [];
            const db = { id: 3, type: 'armor', category: 'armor', stackable: true, slot: null };
            const armor = { id: 3, name: 'Куртка', type: 'armor', category: 'armor', rarity: 'common', quantity: 1 };

            addItemToInventory(inv, { ...armor }, db);
            addItemToInventory(inv, { ...armor }, db);

            expect(inv).toHaveLength(2);
        });

        test('ключи не стакаются', () => {
            const inv = [];
            const db = { id: 4, type: 'key', rarity: 'epic', stackable: true, max_stack: 99 };
            const key = { id: 4, name: 'Ключ', type: 'key', rarity: 'epic', quantity: 1 };

            addItemToInventory(inv, { ...key }, db);
            addItemToInventory(inv, { ...key }, db);

            expect(inv).toHaveLength(2);
        });

        test('апгрейженные предметы не смешиваются с обычными', () => {
            const inv = [];
            addItemToInventory(inv, makeFood(1), dbFood);
            addItemToInventory(inv, { ...makeFood(1), upgrade_level: 2 }, dbFood);

            expect(inv).toHaveLength(2);
        });

        test('возвращает 1 при создании нового слота, 0 при стаке', () => {
            const inv = [];
            expect(addItemToInventory(inv, makeFood(1), dbFood)).toBe(1);
            expect(addItemToInventory(inv, makeFood(1), dbFood)).toBe(0);
        });
    });
});

// =============================================================================
// Регрессия: «поиск не тратит энергию» — реген при полном баре
// =============================================================================

describe('Регрессия: энергия не возвращается сама', () => {
    const makeClient = () => {
        const queries = [];
        return {
            queries,
            client: {
                query: async (sql, params) => {
                    queries.push({ sql, params });
                    return { rows: [] };
                }
            }
        };
    };

    test('при полной энергии last_energy_update всё равно двигается', async () => {
        // Корневая причина бага: baseline застывал на момент заполнения,
        // и клиент возвращал только что потраченную энергию.
        const { queries, client } = makeClient();
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const player = { id: 7, energy: 100, max_energy: 100, last_energy_update: twoHoursAgo };

        await recalcEnergy(client, player);

        expect(queries.length).toBe(1);
        expect(queries[0].sql).toContain('last_energy_update');
        const newStamp = new Date(player.last_energy_update).getTime();
        expect(Date.now() - newStamp).toBeLessThan(2000);
    });

    test('частичный реген двигает метку ровно на восстановленное время', async () => {
        // Иначе игрок терял бы дробный прогресс регена при каждом действии.
        const { client } = makeClient();
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const player = { id: 8, energy: 50, max_energy: 100, last_energy_update: fiveMinutesAgo };

        await recalcEnergy(client, player);

        expect(player.energy).toBe(55);
        const expected = new Date(fiveMinutesAgo).getTime() + 5 * 60000;
        expect(Math.abs(new Date(player.last_energy_update).getTime() - expected)).toBeLessThan(2000);
    });
});
// =============================================================================
// Общие правила экипировки (public/shared/equipment.js)
// =============================================================================

describe('shared equipment rules', () => {

    describe('getEquipmentStatValue', () => {
        test('берёт стат из объекта stats', () => {
            expect(sharedEquipment.getEquipmentStatValue(
                { stats: { radiation_resist: 25 } },
                sharedEquipment.RADIATION_KEYS
            )).toBe(25);
        });

        test('берёт стат с верхнего уровня (синоним поля)', () => {
            expect(sharedEquipment.getEquipmentStatValue(
                { radiationDefense: 40 },
                sharedEquipment.RADIATION_KEYS
            )).toBe(40);
        });

        test('приоритет: верхний уровень раньше вложенного stats', () => {
            expect(sharedEquipment.getEquipmentStatValue(
                { radiationDefense: 10, stats: { radiation_resist: 99 } },
                sharedEquipment.RADIATION_KEYS
            )).toBe(10);
        });

        test('возвращает 0 для пустого и невалидного предмета', () => {
            expect(sharedEquipment.getEquipmentStatValue(null, sharedEquipment.RADIATION_KEYS)).toBe(0);
            expect(sharedEquipment.getEquipmentStatValue({}, sharedEquipment.RADIATION_KEYS)).toBe(0);
            expect(sharedEquipment.getEquipmentStatValue('строка', sharedEquipment.RADIATION_KEYS)).toBe(0);
        });

        test('игнорирует нули, отрицательные и мусорные значения', () => {
            expect(sharedEquipment.getEquipmentStatValue(
                { radiation_resist: 0, radiation_resistance: -5, radiationDefense: 'abc' },
                sharedEquipment.RADIATION_KEYS
            )).toBe(0);
        });
    });

    describe('normalizeResistanceToThreatPoints', () => {
        test('делит на 10 и округляет', () => {
            expect(sharedEquipment.normalizeResistanceToThreatPoints(50)).toBe(5);
            expect(sharedEquipment.normalizeResistanceToThreatPoints(54)).toBe(5);
            expect(sharedEquipment.normalizeResistanceToThreatPoints(55)).toBe(6);
        });

        test('не даёт отрицательных значений', () => {
            expect(sharedEquipment.normalizeResistanceToThreatPoints(-100)).toBe(0);
            expect(sharedEquipment.normalizeResistanceToThreatPoints(null)).toBe(0);
        });
    });

    describe('normalizeThreatLevelToPoints', () => {
        test('округляет вверх — игрок видит худший случай', () => {
            expect(sharedEquipment.normalizeThreatLevelToPoints(1)).toBe(1);
            expect(sharedEquipment.normalizeThreatLevelToPoints(11)).toBe(2);
            expect(sharedEquipment.normalizeThreatLevelToPoints(30)).toBe(3);
        });

        test('не даёт отрицательных значений', () => {
            expect(sharedEquipment.normalizeThreatLevelToPoints(-5)).toBe(0);
            expect(sharedEquipment.normalizeThreatLevelToPoints(undefined)).toBe(0);
        });
    });

    describe('calculateRadiationDefense / calculateInfectionDefense', () => {
        test('суммирует по всем слотам и делит на 10', () => {
            const equipment = {
                armor: { stats: { radiation_resist: 30 } },
                helmet: { stats: { radiation_resist: 20 } }
            };
            expect(sharedEquipment.calculateRadiationDefense(equipment)).toBe(5);
            expect(sharedEquipment.calculateInfectionDefense(equipment)).toBe(0);
        });

        test('учитывает все слоты, а не только существующие', () => {
            const equipment = {
                armor: { stats: { radiation_resist: 10 } },
                boots: { stats: { radiation_resist: 10 } },
                accessory: { radiationDefense: 10 }
            };
            expect(sharedEquipment.calculateRadiationDefense(equipment)).toBe(3);
        });

        test('без экипировки — 0', () => {
            expect(sharedEquipment.calculateRadiationDefense(null)).toBe(0);
            expect(sharedEquipment.calculateInfectionDefense(undefined)).toBe(0);
            expect(sharedEquipment.calculateRadiationDefense({})).toBe(0);
        });
    });

    // Ключевой тест: клиент (game.js) и сервер (gameConstants.js) обязаны
    // давать одинаковый результат. При рассинхроне игрок увидит в интерфейсе
    // одну защиту, а сервер начислит другую.
    describe('клиент и сервер считают одинаково', () => {
        test('gameConstants переиспользует общие правила, а не свои копии', () => {
            const cases = [
                null,
                {},
                { armor: { stats: { radiation_resist: 30 } } },
                {
                    armor: { stats: { radiation_resist: 30, infection_resist: 15 } },
                    helmet: { radiationDefense: 12, infectionDefense: 7 },
                    boots: { stats: { radiation_resistance: 3 } }
                }
            ];

            for (const equipment of cases) {
                expect(calculateRadiationDefense(equipment))
                    .toBe(sharedEquipment.calculateRadiationDefense(equipment));
                expect(sharedEquipment.calculateInfectionDefense(equipment))
                    .toBe(require('./utils/gameConstants').calculateInfectionDefense(equipment));
            }
        });

        test('лимит слотов инвентаря один на клиент и сервер', () => {
            expect(sharedEquipment.MAX_INVENTORY_SLOTS).toBe(100);
        });
    });
});

// Run tests with: npm test
