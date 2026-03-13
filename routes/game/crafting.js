/**
 * Крафт предметов (production-ready версия)
 * 
 * Улучшения:
 * - Транзакции с SELECT FOR UPDATE для атомарности
 * - Валидация входных данных (ID, строки)
 * - Логирование действий в player_logs
 * - Единый формат ответов { success, data/error, code }
 * - Пагинация для рецептов
 * - Namespace: GameCrafting
 * - Централизованный обработчик ошибок
 */

const express = require('express');
const { randomInt } = require('crypto');
const router = express.Router();
const { query, queryOne, queryAll } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const { calculateCraftSuccess } = require('../../utils/gameConstants');
const { logger, logGameAction, logPlayerError } = require('../../utils/logger');
const { withPlayerLock } = require('../../utils/transactions');

// ============================================================================
// Утилиты
// ============================================================================

/**
 * Валидация ID (Number.isInteger и > 0)
 * @param {any} id - Проверяемое значение
 * @returns {boolean}
 */
const isValidId = (id) => Number.isInteger(id) && id > 0;

/**
 * Безопасная сериализация JSON с fallback
 * @param {any} value - Значение для сериализации
 * @returns {string}
 */
const safeStringify = (value) => {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({});
    }
};

/**
 * Парсинг JSON с fallback
 * @param {string|null} value - JSON строка
 * @param {object} fallback - Значение по умолчанию
 * @returns {object}
 */
const safeParse = (value, fallback = {}) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        console.error('JSON.parse failed:', typeof value, String(value).substring(0, 100));
        return fallback;
    }
};

/**
 * Централизованный обработчик ошибок
 * @param {Response} res - Express response
 * @param {Error} error - Ошибка
 * @param {string} action - Действие для логирования
 * @param {number} playerId - ID игрока
 */
const handleError = (res, error, action, playerId) => {
    // Логируем ошибку
    if (playerId) {
        logPlayerError(playerId, error, { action });
    } else {
        logger.error(`[CRAFTING] ${action}: ${error.message}`, {
            stack: error.stack
        });
    }

    // Определяем код ошибки
    let code = 'INTERNAL_ERROR';
    let statusCode = 500;

    if (error.message.includes('достаточно') || error.message.includes('монет')) {
        code = 'INSUFFICIENT_RESOURCES';
        statusCode = 400;
    } else if (error.message.includes('не найден')) {
        code = 'NOT_FOUND';
        statusCode = 404;
    } else if (error.message.includes('валидация') || error.message.includes('ID')) {
        code = 'VALIDATION_ERROR';
        statusCode = 400;
    }

    return res.status(statusCode).json({
        success: false,
        error: error.message,
        code
    });
};

/**
 * Унифицированный формат успешного ответа
 */
const ok = (res, data = {}) => res.json({ success: true, ...data });

/**
 * Унифицированный формат ошибки
 */
const fail = (res, message, code = 400, statusCode = 400) => 
    res.status(statusCode).json({ success: false, error: message, code });

/**
 * Логирование действия в player_logs
 * @param {number} playerId - ID игрока
 * @param {string} action - Действие
 * @param {object} metadata - Метаданные
 */
const logPlayerAction = async (playerId, action, metadata = {}) => {
    try {
        await query(
            `INSERT INTO player_logs (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, safeStringify(metadata)]
        );
    } catch (error) {
        // Логирование не должно ломать основную логику
        logger.warn('Не удалось залогировать действие игрока', {
            playerId,
            action,
            error: error.message
        });
    }
};

// ============================================================================
// Маршруты
// ============================================================================

/**
 * Получение списка рецептов с пагинацией
 * GET /recipes?limit=20&offset=0
 */
router.get('/recipes', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        // Пагинация: валидация и установка значений по умолчанию
        let limit = parseInt(req.query.limit) || 20;
        let offset = parseInt(req.query.offset) || 0;
        
        // Ограничиваем значения
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);

        // Получаем инвентарь игрока (безопасно)
        const inventory = safeParse(player.inventory, []);

        // Получаем рецепты с пагинацией
        const recipes = await queryAll(`
            SELECT * FROM crafting_recipes 
            ORDER BY difficulty ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        // Общее количество рецептов
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM crafting_recipes
        `);
        const total = parseInt(countResult?.total || 0);

        // Проверяем доступность каждого рецепта
        const recipesWithStatus = recipes.map(recipe => {
            const requirements = safeParse(recipe.requirements, []);
            const canCraft = requirements.every(req => {
                const count = inventory.filter(item => item.id === req.item_id).length;
                return count >= req.quantity;
            });

            // Проверяем требования к базе
            let baseRequirement = null;
            if (recipe.building_required) {
                const base = safeParse(player.base, {});
                baseRequirement = {
                    building: recipe.building_required,
                    has: base[recipe.building_required] || false
                };
            }

            return {
                id: recipe.id,
                name: recipe.name,
                description: recipe.description,
                result_item_id: recipe.result_item_id,
                result_item_name: recipe.result_item_name,
                requirements: requirements,
                difficulty: recipe.difficulty,
                success_chance: recipe.success_chance,
                can_craft: canCraft,
                base_requirement: baseRequirement
            };
        });

        // Фильтруем по доступности
        const availableRecipes = recipesWithStatus.filter(r => r.can_craft);
        const lockedRecipes = recipesWithStatus.filter(r => !r.can_craft);

        // Логируем действие
        await logPlayerAction(playerId, 'view_recipes', {
            limit,
            offset,
            total,
            available_count: availableRecipes.length
        });

        ok(res, {
            recipes: recipesWithStatus,
            available: availableRecipes,
            locked: lockedRecipes,
            crafting_level: player.crafting || 1,
            pagination: {
                limit,
                offset,
                total
            }
        });

    } catch (error) {
        return handleError(res, error, 'view_recipes', playerId);
    }
});

/**
 * Крафт предмета (основная операция с транзакцией)
 * POST /
 */
router.post('/', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация входных данных
        const { recipe_id } = req.body;
        
        if (!isValidId(recipe_id)) {
            return fail(res, 'Укажите корректный ID рецепта (число > 0)', 'INVALID_RECIPE_ID');
        }

        // Выполняем крафт в транзакции с блокировкой игрока
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            // Получаем рецепт
            const recipe = await queryOne(`
                SELECT * FROM crafting_recipes WHERE id = $1
            `, [recipe_id]);

            if (!recipe) {
                throw new Error('Рецепт не найден');
            }

            // Получаем актуальный инвентарь из заблокированной записи
            const inventory = safeParse(lockedPlayer.inventory, []);
            const requirements = safeParse(recipe.requirements, []);

            // Проверяем наличие материалов
            for (const reqItem of requirements) {
                const count = inventory.filter(item => item.id === reqItem.item_id).length;
                if (count < reqItem.quantity) {
                    throw new Error(`Недостаточно материалов для ${recipe.name}`);
                }
            }

            // Проверяем требования к базе
            if (recipe.building_required) {
                const base = safeParse(lockedPlayer.base, {});
                if (!base[recipe.building_required]) {
                    throw new Error(`Нужна постройка: ${recipe.building_required}`);
                }
            }

            // Проверяем навык крафта
            const currentCrafting = lockedPlayer.crafting || 1;
            if (currentCrafting < recipe.difficulty) {
                throw new Error(`Нужен навык крафта ${recipe.difficulty}, у вас ${currentCrafting}`);
            }

            // Проверяем энергию (списывается ВСЕГДА)
            const energyCost = recipe.difficulty * 2;
            if (lockedPlayer.energy < energyCost) {
                throw new Error('Недостаточно энергии. Нужно: ' + energyCost);
            }
            
            // Бросаем успех (используем криптографический RNG)
            const rarity = recipe.result_item_rarity || 'common';
            const successChance = calculateCraftSuccess(currentCrafting, rarity);
            const rolled = randomInt(0, 10000) / 100;
            const isSuccess = rolled <= successChance;

            // Оптимизированное удаление материалов (O(n))
            let newInventory = [...inventory];
            if (isSuccess) {
                for (const reqItem of requirements) {
                    let removeCount = reqItem.quantity;
                    newInventory = newInventory.filter(item => {
                        if (removeCount > 0 && item.id === reqItem.item_id) {
                            removeCount--;
                            return false;
                        }
                        return true;
                    });
                }
            }

            // Создаём и добавляем предмет (только при успехе)
            if (isSuccess) {
                const newItem = {
                    id: recipe.result_item_id,
                    name: recipe.result_item_name,
                    type: recipe.result_item_type,
                    damage: recipe.result_item_damage,
                    defense: recipe.result_item_defense,
                    rarity: recipe.result_item_rarity || 'common',
                    set_id: recipe.result_item_set_id,
                    upgrade_level: 0,
                    modifications: {}
                };
                
                // Добавляем предмет в инвентарь
                newInventory.push(newItem);

                // Повышаем навык крафта (+1 к текущему, макс 100)
                const expGained = recipe.difficulty * 10;
                const newCraftingLevel = Math.min(100, currentCrafting + 1);

                // Обновляем игрока (энергия списывается ВСЕГДА)
                await query(`
                    UPDATE players 
                    SET inventory = $1, crafting = $2, energy = energy - $3
                    WHERE id = $4
                `, [safeStringify(newInventory), newCraftingLevel, energyCost, playerId]);

                // Логируем успешный крафт
                await logPlayerAction(playerId, 'craft_success', {
                    recipe_id,
                    recipe_name: recipe.name,
                    result_item_id: newItem.id,
                    result_item_name: newItem.name,
                    exp_gained: expGained,
                    new_crafting_level: newCraftingLevel,
                    rolled: rolled.toFixed(2),
                    success_chance: successChance
                });

                return {
                    success: true,
                    message: 'Создан предмет: ' + recipe.result_item_name,
                    item: newItem,
                    exp_gained: expGained,
                    new_crafting_level: newCraftingLevel,
                    rolled: rolled.toFixed(2),
                    success_chance: successChance
                };
            } else {
                // Неудача - энергия списывается, материалы сохраняются
                await query(`
                    UPDATE players 
                    SET energy = energy - $1
                    WHERE id = $2
                `, [energyCost, playerId]);

                // Логируем неудачный крафт
                await logPlayerAction(playerId, 'craft_failed', {
                    recipe_id,
                    recipe_name: recipe.name,
                    rolled: rolled.toFixed(2),
                    success_chance: successChance,
                    energy_spent: energyCost,
                    materials_lost: 0
                });

                return {
                    success: false,
                    message: 'Крафт не удался! Энергия потрачена, материалы сохранены.',
                    rolled: rolled.toFixed(2),
                    success_chance: successChance,
                    energy_spent: energyCost
                };
            }
        });

        ok(res, result);

    } catch (error) {
        return handleError(res, error, 'craft', playerId);
    }
});

// ============================================================================
// Обратная совместимость (deprecated маршруты)
// ============================================================================

/**
 * @deprecated Используйте /craft/recipes с параметрами limit и offset
 * Получение списка рецептов (старый формат)
 */
router.get('/recipes/old', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        logger.warn('Используется устаревший маршрут /craft/recipes/old', { playerId });
        
        const inventory = safeParse(player.inventory, []);
        
        const recipes = await queryAll(`
            SELECT * FROM crafting_recipes ORDER BY difficulty ASC
        `);
        
        const recipesWithStatus = recipes.map(recipe => {
            const requirements = safeParse(recipe.requirements, []);
            const canCraft = requirements.every(req => {
                const count = inventory.filter(item => item.id === req.item_id).length;
                return count >= req.quantity;
            });
            
            let baseRequirement = null;
            if (recipe.building_required) {
                const base = safeParse(player.base, {});
                baseRequirement = {
                    building: recipe.building_required,
                    has: base[recipe.building_required] || false
                };
            }
            
            return {
                id: recipe.id,
                name: recipe.name,
                description: recipe.description,
                result_item_id: recipe.result_item_id,
                result_item_name: recipe.result_item_name,
                requirements: requirements,
                difficulty: recipe.difficulty,
                success_chance: recipe.success_chance,
                can_craft: canCraft,
                base_requirement: baseRequirement
            };
        });
        
        const availableRecipes = recipesWithStatus.filter(r => r.can_craft);
        const lockedRecipes = recipesWithStatus.filter(r => !r.can_craft);
        
        res.json({
            recipes: recipesWithStatus,
            available: availableRecipes,
            locked: lockedRecipes,
            crafting_level: player.crafting || 1
        });
        
    } catch (error) {
        return handleError(res, error, 'view_recipes_old', playerId);
    }
});

// ============================================================================
// Namespace экспорт
// ============================================================================

const GameCrafting = {
    router,
    // Экспорт утилит для тестирования
    utils: {
        isValidId,
        safeStringify,
        safeParse,
        handleError,
        withPlayerLock,
        logPlayerAction
    }
};

// Единый экспорт - избегаем перезаписи module.exports
module.exports = Object.assign(router, { GameCrafting });
