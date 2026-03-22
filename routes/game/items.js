/**
 * Улучшение и модификация предметов
 * @module game/items
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { withPlayerLock, validateId, validateIndex, validateBoolean, validatePositiveInt, ok, fail, error, badRequest, guard, wrap, logPlayerAction, serializeJSONField, logger } = require('../../utils/serverApi');

/**
 * Улучшение предмета
 * Использует withPlayerLock для автоматического управления транзакцией
 */
router.post('/upgrade-item', async (req, res) => {
    try {
        const { item_index, use_protection = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        const playerInventory = req.player.inventory || [];
        const indexValidation = validateIndex(item_index, playerInventory.length, 'индекс предмета');
        if (!indexValidation.valid) {
            return badRequest(res, indexValidation.error, indexValidation.code);
        }
        
        const booleanValidation = validateBoolean(use_protection, 'use_protection');
        if (!booleanValidation.valid) {
            return badRequest(res, booleanValidation.error, booleanValidation.code);
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            const inventory = serializeJSONField(lockedPlayer.inventory) || [];
            
            if (item_index < 0 || item_index >= inventory.length) {
                throw { message: 'Неверный индекс предмета', code: 'INVALID_INDEX', statusCode: 400 };
            }
            
            const item = inventory[item_index];
            
            // Проверяем, что предмет можно улучшать
            if (!item.damage && !item.defense) {
                throw { message: 'Этот предмет нельзя улучшить', code: 'ITEM_NOT_UPGRADEABLE', statusCode: 400 };
            }
            
            const currentLevel = item.upgrade_level || 0;
            const maxLevel = 10;
            
            if (currentLevel >= maxLevel) {
                throw { message: 'Максимальный уровень улучшения достигнут', code: 'MAX_LEVEL_REACHED', statusCode: 400 };
            }
            
            // Стоимость улучшения
            const upgradeCost = (currentLevel + 1) * 50;
            
            const coins = parseInt(lockedPlayer.coins) || 0;
            
            if (coins < upgradeCost) {
                throw { 
                    message: 'Недостаточно монет', 
                    code: 'INSUFFICIENT_COINS', 
                    statusCode: 400,
                    required: upgradeCost,
                    have: coins
                };
            }
            
            // Шанс успеха (уменьшается с каждым уровнем)
            let successChance = 100 - (currentLevel * 8);
            if (use_protection) {
                successChance += 20;
            }
            
            const rolled = Math.random() * 100;
            let upgradeSuccess = false;
            let itemBroken = false;
            
            if (rolled <= successChance) {
                // Успех!
                upgradeSuccess = true;
                item.upgrade_level = currentLevel + 1;
                
                // Увеличиваем статы
                if (item.damage) {
                    item.damage = Math.floor(item.damage * 1.2);
                }
                if (item.defense) {
                    item.defense = Math.floor(item.defense * 1.2);
                }
                
                // Обновляем инвентарь и списываем монеты
                await queryOne(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                    RETURNING *
                `, [inventory, upgradeCost, playerId]);
                
            } else {
                // Неудача
                if (use_protection) {
                    // Защита сработала - предмет не сломался
                    await queryOne(`
                        UPDATE players SET coins = coins - $1 WHERE id = $2
                        RETURNING *
                    `, [upgradeCost, playerId]);
                    
                } else {
                    // Предмет сломался
                    itemBroken = true;
                    inventory.splice(item_index, 1);
                    
                    await queryOne(`
                        UPDATE players 
                        SET inventory = $1, coins = coins - $2
                        WHERE id = $3
                        RETURNING *
                    `, [inventory, upgradeCost, playerId]);
                }
            }
            
            // Возвращаем результат для логирования после транзакции
            return {
                item,
                upgradeSuccess,
                itemBroken,
                successChance,
                rolled: rolled.toFixed(2),
                use_protection
            };
        });
        
        // Логируем действие после успешной транзакции
        try {
            await logPlayerAction(pool, playerId, 'item_upgrade', {
                item_index: item_index,
                item_type: result.item?.type,
                success: result.upgradeSuccess,
                item_broken: result.itemBroken,
                new_level: result.item?.upgrade_level,
                success_chance: result.successChance,
                rolled: result.rolled,
                use_protection: result.use_protection
            });
        } catch (logErr) {
            logger.error({ type: 'items_upgrade_log_error', message: logErr.message });
        }
        
        // Отправляем ответ
        if (result.upgradeSuccess) {
            ok(res, {
                message: 'Улучшение успешно!',
                item: result.item,
                new_level: result.item.upgrade_level,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else if (result.use_protection) {
            ok(res, {
                message: 'Улучшение не удалось, но защита сработала!',
                item_protected: true,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else {
            ok(res, {
                message: 'Улучшение не удалось! Предмет сломан.',
                item_broken: true,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        }
        
    } catch (err) {
        // Обработка ошибок from withPlayerLock
        if (err.code && err.statusCode) {
            return fail(res, err.message, err.code, err.statusCode);
        }
        logger.error('[items] Ошибка улучшения:', err);
        error(res, 'Ошибка улучшения', 'UPGRADE_ERROR', 500);
    }
});

/**
 * Модификация предмета (заточка, укрепление)
 * Использует withPlayerLock для автоматического управления транзакцией
 */
router.post('/modify-item', async (req, res) => {
    try {
        const { item_index, modification_type } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        const playerInventory = req.player.inventory || [];
        const indexValidation = validateIndex(item_index, playerInventory.length, 'индекс предмета');
        if (!indexValidation.valid) {
            return badRequest(res, indexValidation.error, indexValidation.code);
        }
        
        if (!modification_type || typeof modification_type !== 'string') {
            return badRequest(res, 'Укажите тип модификации', 'INVALID_MODIFICATION_TYPE');
        }
        
        const validTypes = ['sharpening', 'reinforcement'];
        if (!validTypes.includes(modification_type)) {
            return badRequest(res, 'Неверный тип модификации', 'INVALID_TYPE');
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            const inventory = serializeJSONField(lockedPlayer.inventory) || [];
            
            if (item_index < 0 || item_index >= inventory.length) {
                throw { message: 'Неверный индекс предмета', code: 'INVALID_INDEX', statusCode: 400 };
            }
            
            const item = inventory[item_index];
            
            // Инициализируем модификации
            if (!item.modifications) {
                item.modifications = {};
            }
            
            const currentMod = item.modifications[modification_type] || 0;
            
            if (currentMod >= 5) {
                throw { message: 'Максимальный уровень модификации', code: 'MAX_MODIFICATION_LEVEL', statusCode: 400 };
            }
            
            // Проверяем соответствие типа модификации типу предмета
            if (modification_type === 'sharpening' && !item.damage) {
                throw { message: 'Заточка только для оружия', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
            }
            
            if (modification_type === 'reinforcement' && !item.defense) {
                throw { message: 'Укрепление только для брони', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
            }
            
            // Стоимость
            const modCost = (currentMod + 1) * 30;
            
            const coins = parseInt(lockedPlayer.coins) || 0;
            
            if (coins < modCost) {
                throw { 
                    message: 'Недостаточно монет', 
                    code: 'INSUFFICIENT_COINS', 
                    statusCode: 400,
                    required: modCost,
                    have: coins
                };
            }
            
            // Шанс успеха
            const successChance = 90 - (currentMod * 10);
            const rolled = Math.random() * 100;
            
            if (rolled <= successChance) {
                // Применяем модификацию
                item.modifications[modification_type] = currentMod + 1;
                
                if (modification_type === 'sharpening') {
                    item.damage = (item.damage || 0) + 5;
                } else if (modification_type === 'reinforcement') {
                    item.defense = (item.defense || 0) + 5;
                }
                
                await queryOne(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                    RETURNING *
                `, [inventory, modCost, playerId]);
                
                // Возвращаем результат успеха
                return {
                    success: true,
                    item,
                    currentMod: currentMod + 1,
                    successChance,
                    rolled: rolled.toFixed(2),
                    modification_type
                };
                
            } else {
                // Неудача - монеты все равно списываются
                await queryOne(`
                    UPDATE players SET coins = coins - $1 WHERE id = $2
                    RETURNING *
                `, [modCost, playerId]);
                
                // Возвращаем результат неудачи
                return {
                    success: false,
                    currentMod,
                    successChance,
                    rolled: rolled.toFixed(2),
                    modification_type
                };
            }
        });
        
        // Логируем действие после успешной транзакции
        try {
            await logPlayerAction(pool, playerId, 'item_modification', {
                item_index: item_index,
                item_type: result.item?.type,
                modification_type: result.modification_type,
                success: result.success,
                new_level: result.currentMod,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } catch (logErr) {
            logger.error({ type: 'items_modify_log_error', message: logErr.message });
        }
        
        // Отправляем ответ
        if (result.success) {
            ok(res, {
                message: 'Модификация применена!',
                item: result.item,
                modification: result.modification_type,
                new_level: result.currentMod,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else {
            ok(res, {
                message: 'Модификация не удалась!',
                success: false,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        }
        
    } catch (err) {
        // Обработка ошибок from withPlayerLock
        if (err.code && err.statusCode) {
            return fail(res, err.message, err.code, err.statusCode);
        }
        logger.error('[items] Ошибка модификации:', err);
        error(res, 'Ошибка модификации', 'MODIFICATION_ERROR', 500);
    }
});

/**
 * Получение списка предметов (справочник)
 * GET /api/game/items или GET /api/game/items/
 */
router.get('/items', async (req, res) => {
    try {
        // Валидация пагинации
        let limit = parseInt(req.query.limit) || 50;
        let offset = parseInt(req.query.offset) || 0;
        
        // Ограничения
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);
        
        // Получаем все предметы из справочника
        const items = await queryAll(`
            SELECT * FROM items ORDER BY type, rarity LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Получаем общее количество
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM items
        `);
        
        const total = parseInt(countResult?.total) || 0;
        
        ok(res, {
            items: items,
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + items.length < total
            }
        });
        
    } catch (err) {
        logger.error({ type: 'items_get_error', message: err.message });
        error(res, 'Ошибка получения предметов', 'ITEMS_ERROR', 500);
    }
});



// =============================================================================
// ИНВЕНТАРЬ
// =============================================================================

/**
 * Получение инвентаря игрока
 * GET /api/game/inventory (через алиас) или GET /api/game/items/inventory
 */
router.get('/', async (req, res) => {
    try {
        const player = req.player;
        
        const inventory = safeJsonParse(player.inventory, []);
        const equipment = safeJsonParse(player.equipment, {});
        
        const itemsByType = {};
        inventory.forEach((item, index) => {
            if (!itemsByType[item.type]) {
                itemsByType[item.type] = [];
            }
            itemsByType[item.type].push({
                index: index,
                ...item
            });
        });
        
        res.json({
            success: true,
            data: {
                inventory: inventory.map((item, index) => ({
                    index: index,
                    ...item
                })),
                equipment: equipment,
                items_by_type: itemsByType,
                total_items: inventory.length,
                max_inventory: player.max_inventory || 30
            }
        });
        
    } catch (err) {
        handleError(res, err, 'inventory_view');
    }
});

/**
 * Использование предмета из инвентаря
 * POST /api/game/inventory/use-item (через алиас) или POST /api/game/items/use
 */
router.post('/use-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { item_index, equip = false } = req.body;
        const playerId = req.player.id;
        
        if (item_index === undefined || item_index === null) {
            return res.status(400).json({
                success: false,
                error: 'Укажите индекс предмета',
                code: 'MISSING_ITEM_INDEX'
            });
        }
        
        if (!Number.isInteger(item_index)) {
            return res.status(400).json({
                success: false,
                error: 'Индекс предмета должен быть целым числом',
                code: 'INVALID_ITEM_INDEX_TYPE'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);
            
            const player = playerResult.rows[0];
            
            if (!player) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Игрок не найден',
                    code: 'PLAYER_NOT_FOUND'
                });
            }
            
            const inventory = safeJsonParse(player.inventory, []);
            
            if (item_index < 0 || item_index >= inventory.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный индекс предмета',
                    code: 'INVALID_ITEM_INDEX'
                });
            }
            
            const item = inventory[item_index];
            
            if (!item || typeof item !== 'object' || !item.id || !item.name) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Некорректная структура предмета',
                    code: 'INVALID_ITEM_STRUCTURE'
                });
            }
            
            if (equip) {
                const equipment = safeJsonParse(player.equipment, {});
                const slot = item.type === 'weapon' ? 'weapon' :
                            item.type === 'armor' ? 'armor' :
                            item.type === 'helmet' ? 'helmet' :
                            item.type === 'boots' ? 'boots' :
                            item.type === 'accessory' ? 'accessory' : null;
                
                if (!slot) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Этот предмет нельзя экипировать',
                        code: 'INVALID_EQUIP_TYPE'
                    });
                }
                
                const oldItem = equipment[slot];
                if (oldItem) {
                    inventory.push(oldItem);
                }
                
                equipment[slot] = item;
                inventory.splice(item_index, 1);
                
                await client.query(`
                    UPDATE players 
                    SET equipment = $1, inventory = $2
                    WHERE id = $3
                `, [JSON.stringify(equipment), JSON.stringify(inventory), playerId]);
                
                await client.query('COMMIT');
                
                logger.info(`[items] Экипировка предмета`, {
                    playerId,
                    itemName: item.name,
                    slot
                });
                
                res.json({
                    success: true,
                    data: {
                        message: `Экипирован ${item.name}`,
                        equipped: slot,
                        item: item
                    }
                });
                
            } else {
                let message = '';
                let updated = false;
                
                const newInventory = inventory.filter((_, i) => i !== item_index);
                
                if (item.type === 'medicine') {
                    const healthRestored = item.heal ?? 20;
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else if (item.type === 'antirad') {
                    const radiationCure = item.stats?.radiation_cure || item.rad_removal || 2;
                    
                    let currentRadiation = { level: 0 };
                    if (player.radiation) {
                        if (typeof player.radiation === 'object') {
                            currentRadiation = player.radiation;
                        } else if (typeof player.radiation === 'number') {
                            currentRadiation = { level: player.radiation };
                        }
                    }
                    
                    const newLevel = Math.max(0, currentRadiation.level - radiationCure);
                    
                    let newExpiresAt = null;
                    if (newLevel > 0 && currentRadiation.expires_at && currentRadiation.level > 0) {
                        const oldExpires = new Date(currentRadiation.expires_at);
                        const now = new Date();
                        const safeLevel = Math.max(1, currentRadiation.level);
                        const reductionRatio = radiationCure / safeLevel;
                        const reduction = (oldExpires - now) * reductionRatio;
                        newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                    }
                    
                    await client.query(`
                        UPDATE players 
                        SET radiation = $1,
                            inventory = $2
                        WHERE id = $3
                    `, [JSON.stringify({ level: newLevel, expires_at: newExpiresAt, applied_at: currentRadiation.applied_at }), JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Радиация снижена с ${currentRadiation.level} до ${newLevel}`;
                    updated = true;
                    
                } else if (item.type === 'bandage') {
                    const healthRestored = item.heal || item.stats?.health_restore || 10;
                    
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Этот предмет нельзя использовать',
                        code: 'UNUSABLE_ITEM'
                    });
                }
                
                await client.query('COMMIT');
                
                if (updated) {
                    logger.info(`[items] Использование предмета`, {
                        playerId,
                        itemName: item.name,
                        itemType: item.type
                    });
                    
                    res.json({
                        success: true,
                        data: {
                            message: message,
                            item: item
                        }
                    });
                }
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'use_item');
    } finally {
        client.release();
    }
});



// =============================================================================
// КРАФТ
// =============================================================================

const { randomInt } = require('crypto');
const { calculateCraftSuccess } = require('../../utils/gameConstants');

/**
 * Получение списка рецептов
 * GET /items/recipes → GET /api/game/items/recipes
 */
router.get('/recipes', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        let limit = parseInt(req.query.limit) || 20;
        let offset = parseInt(req.query.offset) || 0;
        
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);

        const inventory = safeJsonParse(player.inventory, []);

        const recipes = await queryAll(`
            SELECT * FROM crafting_recipes 
            ORDER BY difficulty ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM crafting_recipes
        `);
        const total = parseInt(countResult?.total || 0);

        const recipesWithStatus = recipes.map(recipe => {
            const requirements = safeJsonParse(recipe.requirements, []);
            const canCraft = requirements.every(req => {
                const count = inventory.filter(item => item.id === req.item_id).length;
                return count >= req.quantity;
            });

            let baseRequirement = null;
            if (recipe.building_required) {
                const base = safeJsonParse(player.base, {});
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

        logger.info(`[items] Просмотр рецептов`, {
            playerId,
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

    } catch (err) {
        logger.error('[items] Ошибка получения рецептов:', err);
        error(res, 'Ошибка получения рецептов', 'RECIPES_ERROR', 500);
    }
});

/**
 * Крафт предмета
 * POST /items/craft → POST /api/game/items/craft
 */
router.post('/craft', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        const { recipe_id } = req.body;
        
        if (!Number.isInteger(recipe_id) || recipe_id <= 0) {
            return fail(res, 'Укажите корректный ID рецепта (число > 0)', 'INVALID_RECIPE_ID');
        }

        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            const recipe = await queryOne(`
                SELECT * FROM crafting_recipes WHERE id = $1
            `, [recipe_id]);

            if (!recipe) {
                throw new Error('Рецепт не найден');
            }

            const inventory = safeJsonParse(lockedPlayer.inventory, []);
            const requirements = safeJsonParse(recipe.requirements, []);

            for (const reqItem of requirements) {
                const count = inventory.filter(item => item.id === reqItem.item_id).length;
                if (count < reqItem.quantity) {
                    throw new Error(`Недостаточно материалов для ${recipe.name}`);
                }
            }

            if (recipe.building_required) {
                const base = safeJsonParse(lockedPlayer.base, {});
                if (!base[recipe.building_required]) {
                    throw new Error(`Нужна постройка: ${recipe.building_required}`);
                }
            }

            const currentCrafting = lockedPlayer.crafting || 1;
            if (currentCrafting < recipe.difficulty) {
                throw new Error(`Нужен навык крафта ${recipe.difficulty}, у вас ${currentCrafting}`);
            }

            const energyCost = recipe.difficulty * 2;
            if (lockedPlayer.energy < energyCost) {
                throw new Error('Недостаточно энергии. Нужно: ' + energyCost);
            }
            
            const rarity = recipe.result_item_rarity || 'common';
            const successChance = calculateCraftSuccess(currentCrafting, rarity);
            const rolled = randomInt(0, 10000) / 100;
            const isSuccess = rolled <= successChance;

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
                
                newInventory.push(newItem);

                const expGained = recipe.difficulty * 10;
                const newCraftingLevel = Math.min(100, currentCrafting + Math.floor(expGained / 100));

                await query(`
                    UPDATE players 
                    SET inventory = $1, crafting = $2, energy = GREATEST(0, energy - $3)
                    WHERE id = $4
                `, [safeStringify(newInventory), newCraftingLevel, energyCost, playerId]);

                await logPlayerActionSimple(query, playerId, 'craft_success', {
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
                await query(`
                    UPDATE players 
                    SET energy = GREATEST(0, energy - $1)
                    WHERE id = $2
                `, [energyCost, playerId]);

                await logPlayerActionSimple(query, playerId, 'craft_failed', {
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

    } catch (err) {
        logger.error('[items] Ошибка крафта:', err);
        error(res, err.message || 'Ошибка крафта', 'CRAFT_ERROR', 500);
    }
});

module.exports = router;
