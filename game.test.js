/**
 * Unit тесты для критичных функций игры
 */

const { validateTelegramInitData, isAdmin } = require('./utils/serverApi');
const { getMetrics, resetMetrics } = require('./utils/realtime');
const { ACHIEVEMENTS } = require('./utils/game-helpers');
const { calculateLocationRiskProfile } = require('./utils/gameConstants');
const { calculateCoinsToSteal, calculatePVPRewardExperience } = require('./db/pvp');
const { normalizeInventory, createInventoryItem, getInventoryItemCategory, getActiveBuffs, isBuffActive } = require('./utils/game-helpers');

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

describe('achievements', () => {
    describe('ACHIEVEMENTS', () => {
        test('должен содержать достижения уровня', () => {
            expect(ACHIEVEMENTS).toHaveProperty('level_5');
            expect(ACHIEVEMENTS).toHaveProperty('level_10');
            expect(ACHIEVEMENTS.level_5.type).toBe('level');
        });
        
        test('должен содержать достижения боссов', () => {
            expect(ACHIEVEMENTS).toHaveProperty('boss_1');
            expect(ACHIEVEMENTS).toHaveProperty('boss_5');
            expect(ACHIEVEMENTS.boss_1.type).toBe('boss');
        });
        
        test('должен содержать PvP достижения', () => {
            expect(ACHIEVEMENTS).toHaveProperty('pvp_1');
            expect(ACHIEVEMENTS.pvp_1.type).toBe('pvp');
        });
        
        test('все достижения должны иметь required и reward', () => {
            for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
                expect(ach).toHaveProperty('req');
                expect(ach).toHaveProperty('reward');
                expect(typeof ach.req).toBe('number');
                expect(typeof ach.reward).toBe('number');
            }
        });
    });
});

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

// Run tests with: npm test
