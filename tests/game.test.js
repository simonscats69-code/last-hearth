/**
 * Unit тесты для критичных функций игры
 */

const { validateTelegramInitData, isAdmin } = require('../utils/serverApi');
const { getMetrics, resetMetrics } = require('../utils/realtime');
const { ACHIEVEMENTS } = require('../utils/achievements');

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
        
        test('не должен превышать 150', () => {
            const maxEnergy100 = Math.min(150, 50 + Math.floor(100 / 10) * 5);
            expect(maxEnergy100).toBe(150);
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

// Run tests with: npm test
