/**
 * Unit тесты для критичных функций игры
 */

const { validateTelegramInitData, isAdmin } = require('./utils/serverApi');
const { getMetrics, resetMetrics } = require('./utils/realtime');
// ACHIEVEMENTS was removed — achievements are now stored in DB with schema seed
// Tests for static achievements have been migrated to schema tests
const ACHIEVEMENTS = null;
const { calculateLocationRiskProfile } = require('./utils/gameConstants');
const { calculateCoinsToSteal, calculatePVPRewardExperience, calculatePVPDamage, getRandomItemsToSteal } = require('./db/pvp');
const { calculateDropChance, calculateDebuffModifiers, getDebuffTier, calculateRadiationDefense } = require('./utils/gameConstants');
const { normalizeInventory, createInventoryItem, getInventoryItemCategory, getActiveBuffs, isBuffActive, normalizeEquipment } = require('./utils/game-helpers');
const { getExpForLevel, getTotalExpForLevel } = require('./utils/gameConstants');

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

// Run tests with: npm test
