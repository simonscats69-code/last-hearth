/**
 * Маршруты для работы с инвентарём и предметами
 * GET /api/game/items — список предметов в магазине
 * GET /api/game/inventory — инвентарь игрока
 * POST /api/game/items/buy — покупка предмета
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction } = require('../../db/database');
const { safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
// validateQuantity: единая проверка количества для /buy и /buy-stars.
// Без неё Math.max/min с NaN пропускали проверку баланса (см. коммент. в роутах).
const { validateQuantity } = require('../../utils/validate');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();

// Импортируемые функции
const { normalizeInventory, normalizeEquipment, createInventoryItem, normalizeRadiation, normalizeInfections, calculateSellPrice, addItemToInventory, equipmentRules, getSetBonuses, trackCollectedItems, consumeInventoryItem } = helpers;

/**
 * Лимит слотов инвентаря.
 *
 * Берётся из public/shared/equipment.js — того же файла, что читает клиент.
 * Расхождение значений означало бы либо переполнение инвентаря, либо
 * вечную блокировку добычи.
 */
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;

/**
 * Получить список предметов в магазине
 * GET /items/shop (основной), GET /items (обратная совместимость)
 */
router.get(['/shop', '/items'], async (req, res) => {
    try {
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity, 
                   price, stars_price, icon, slot, stats, stackable
            FROM items 
            WHERE price > 0 OR stars_price > 0
            ORDER BY rarity, type, name
        `);

        res.json({
            success: true,
            items: items.map(item => ({
                ...item,
                stats: safeJsonParse(item.stats, {})
            }))
        });
    } catch (error) {
        handleError(res, error, 'items_list');
    }
});

/**
 * Получить инвентарь игрока
 * GET /api/game/inventory (через алиас /inventory), GET /inventory (обратная совместимость)
 */
router.get(['/', '/inventory'], async (req, res) => {
    try {
        const playerId = req.player.id;

        const player = await queryOne(
            'SELECT inventory, equipment FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }

        const inventory = normalizeInventory(player.inventory);
        const equipment = safeJsonParse(player.equipment, {});

        // Цены продажи считаем по таблице items, а не берём из JSON инвентаря.
        // Одним запросом на все id, чтобы не делать N+1.
        const ids = [...new Set(inventory.map(i => i.id).filter(id => id != null))];
        const catalog = new Map();
        if (ids.length > 0) {
            const rows = await queryAll(
                'SELECT id, type, rarity, price FROM items WHERE id = ANY($1::int[])',
                [ids]
            );
            for (const row of rows) catalog.set(row.id, row);
        }

        const items = inventory.map(item => ({
            ...item,
            sell_price: calculateSellPrice(catalog.get(item.id) || null, item)
        }));

        res.json({
            success: true,
            inventory: items,
            equipment
        });
    } catch (error) {
        handleError(res, error, 'inventory_view');
    }
});

/**
 * Купить предмет за монеты
 * POST /items/buy
 */
router.post('/buy', async (req, res) => {
    try {
        const playerId = req.player.id;

        // P1-5: quantity валидируется ДО арифметики.
        //
        // Было: Math.max(1, Math.min(99, Number(req.body?.quantity || 1))).
        // При quantity = {} или "abc" Number() -> NaN, Math.min/max c NaN тоже
        // дают NaN. Дальше totalPrice = price * NaN -> NaN, и проверка
        // `player.coins < NaN` всегда ложна — оплата молча «проходила»,
        // а UPDATE уходил с NaN в колонку.
        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        // itemId тоже целое: раньше `!itemId || itemId <= 0` пропускало 2.5.
        const itemId = Number(req.body?.item_id);

        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите ID предмета', code: 'INVALID_ITEM_ID' });
        }

        const result = await transaction(async (client) => {
            const item = await client.query(
                'SELECT * FROM items WHERE id = $1 AND price > 0',
                [itemId]
            );

            if (!item.rows[0]) {
                throw { message: 'Предмет не найден или не продаётся', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItem = item.rows[0];
            const totalPrice = shopItem.price * quantity;

            const playerResult = await client.query(
                'SELECT coins, inventory FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!playerResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const player = playerResult.rows[0];

            if (player.coins < totalPrice) {
                throw {
                    message: `Недостаточно монет. Требуется: ${totalPrice}, у вас: ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = normalizeInventory(player.inventory);

            const newItem = createInventoryItem(shopItem, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItem);

            // Лимит слотов. Проверяем ПОСЛЕ стакования: если предмет влез
            // в существующий стек, новый слот не создаётся и лимит не трогаем.
            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET coins = coins - $1, inventory = $2 WHERE id = $3',
                [totalPrice, JSON.stringify(inventory), playerId]
            );

            // P2: покупка тоже идёт в уникальный collection-tracker, иначе
            // достижение «Коллекционер» считало только лутом и звёздным
            // магазином, а купленные предметы в него не попадали.
            // Вызов безопасен: пустой/невалидный id функция сама отфильтрует.
            await trackCollectedItems(client, playerId, [shopItem.id]);

            await logPlayerAction(playerId, 'item_bought', {
                item_id: itemId,
                item_name: shopItem.name,
                quantity,
                price: totalPrice
            }, client);

            return {
                success: true,
                item: {
                    id: shopItem.id,
                    name: shopItem.name,
                    icon: shopItem.icon || '📦',
                    quantity
                },
                coins_spent: totalPrice,
                coins_remaining: player.coins - totalPrice
            };
        });

        res.json(result);
    } catch (error) {
        // Игровые коды ошибок ловим здесь и отдаём как 4xx. Всё остальное —
        // в handleError -> 500 с общим текстом, и клиент показывает
        // «ошибка сервера» вместо «недостаточно монет» или «инвентарь полон».
        if (['INSUFFICIENT_COINS', 'ITEM_NOT_FOUND', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy');
    }
});

/**
 * POST /items/use — использовать/экипировать предмет
 */
router.post(['/use', '/use-item'], async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemIndex = Number(req.body?.item_index);
        const equip = Boolean(req.body?.equip);

        // P2: 2.5 — не NaN и >= 0, поэтому старая проверка его пропускала,
        // а inventory[2.5] === undefined давал TypeError -> 500.
        if (!Number.isInteger(itemIndex) || itemIndex < 0) {
            return res.status(400).json({ success: false, error: 'Укажите корректный индекс предмета', code: 'INVALID_INDEX' });
        }

        const result = await transaction(async (client) => {
            const player = await client.query(
                'SELECT inventory, equipment, health, max_health, radiation, infections FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!player.rows[0]) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const inventory = normalizeInventory(player.rows[0].inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (equip) {
                // Слот определяет единственный источник правил
                // (public/shared/equipment.js). Слот типа item.type (например
                // «food» у еды) не участвует ни в защите, ни в износе: предмет
                // исчез бы из инвентаря и молча не дал бы бонусов.
                const slot = equipmentRules.resolveEquipmentSlot(item);
                if (!slot) {
                    throw {
                        message: `«${item.name || 'Предмет'}» нельзя надеть — у него нет слота экипировки`,
                        code: 'NOT_EQUIPMENT',
                        statusCode: 400
                    };
                }

                const equipment = safeJsonParse(player.rows[0].equipment, {});
                const oldItem = equipment[slot] || null;

                // Снаряжение не стакается: если в слоте предмет уже лежит,
                // старый возвращается в инвентарь отдельной записью.
                inventory.splice(itemIndex, 1);
                equipment[slot] = item;
                if (oldItem) inventory.push(oldItem);

                await client.query(
                    'UPDATE players SET equipment = $1, inventory = $2 WHERE id = $3',
                    [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
                );

                await logPlayerAction(playerId, 'item_equip', { slot, item_id: item.id }, client);

                return { success: true, message: 'Предмет экипирован', item: { id: item.id, name: item.name } };
            }

            // Расходный предмет
            const stats = item.stats || {};
            const updates = [];
            const params = [playerId];
            const playerRadiation = normalizeRadiation(player.rows[0].radiation);
            const playerInfections = normalizeInfections(player.rows[0].infections);

            // Бонусы сетов: heal_bonus (процент к лечению) и energy_bonus
            // (плоская прибавка к энергии). Без них Медицинский сет был
            // просто набором дорогих вещей без преимущества.
            const setBonuses = await getSetBonuses(safeJsonParse(player.rows[0].equipment, {}));

            if (stats.healing || stats.health) {
                const baseHeal = Number(stats.healing || stats.health || 0);
                const healPercent = Number(stats.heal_bonus || 0) + Number(setBonuses.heal_bonus || 0);
                const healAmount = Math.max(1, Math.round(baseHeal * (1 + healPercent / 100)));
                const curHealth = Number(player.rows[0].health || 0);
                const maxHealth = Number(player.rows[0].max_health || 100);
                const newHealth = Math.min(maxHealth, curHealth + healAmount);
                updates.push(`health = $${params.length + 1}`);
                params.push(newHealth);
            }

            // Еда/вода восстанавливают энергию (стартовый инвентарь содержит stats.energy)
            if (stats.energy) {
                const energyAmount = Number(stats.energy) + Number(setBonuses.energy_bonus || 0);
                if (energyAmount > 0) {
                    updates.push(`energy = LEAST(max_energy, energy + $${params.length + 1})`);
                    params.push(energyAmount);
                }
            }

            if (stats.radiation_cure) {
                const cureAmount = Number(stats.radiation_cure);
                const curRad = playerRadiation.level;
                const newRad = Math.max(0, curRad - cureAmount);
                // radiation — JSONB-колонка ({ level, expires_at, applied_at }).
                // Голое число сюда писать нельзя: Postgres ответит
                // "column radiation is of type jsonb but expression is of type
                // integer" и любое использование антирада упадёт с 500.
                const radPayload = JSON.stringify({
                    level: newRad,
                    expires_at: newRad > 0 ? playerRadiation.expires_at : null,
                    applied_at: newRad > 0 ? playerRadiation.applied_at : null
                });
                updates.push(`radiation = $${params.length + 1}::jsonb`);
                params.push(radPayload);
            }

            if (stats.infection_cure) {
                // infections — JSONB-массив объектов {type, level, expires_at};
                // снижаем уровень каждой инфекции, полностью вылеченные удаляем
                const cureAmount = Number(stats.infection_cure);
                const remaining = [];
                for (const inf of playerInfections) {
                    const newLevel = Math.max(0, Number(inf?.level || 0) - cureAmount);
                    if (newLevel > 0) {
                        remaining.push({ ...inf, level: newLevel });
                    }
                }
                updates.push(`infections = $${params.length + 1}`);
                params.push(JSON.stringify(remaining));
            }

            if (updates.length > 0) {
                // Расходник может лежать стопкой (quantity > 1): эффект применяется один
                // раз, а из стека уходит ровно одна штука.
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, itemIndex);

                await client.query(
                    `UPDATE players SET ${updates.join(', ')}, inventory = $${params.length + 1} WHERE id = $1`,
                    [...params, JSON.stringify(updatedInventory)]
                );

                await logPlayerAction(playerId, 'item_use', { item_id: item.id, item_name: item.name }, client);

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: quantityLeft
                };
            }

            return { success: false, message: 'Этот предмет нельзя использовать' };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'NOT_EQUIPMENT'].includes(error.code)) {
            // statusCode может отсутствовать — res.status(undefined) дал бы
            // невалидный HTTP-код. Фоллбэк 404 соответствует смыслу ошибки.
            const status = Number(error.statusCode) || 404;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_use');
    }
});

/**
 * POST /items/sell — продать предмет за монеты
 *
 * Закрывает петлю экономики: раньше предметы можно было только тратить,
 * а при заполнении 100 слотов игра предлагала «продать лишнее» —
 * функции продажи не существовало.
 */
router.post('/sell', async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemIndex = Number(req.body?.item_index);

        if (!Number.isInteger(itemIndex) || itemIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный индекс предмета',
                code: 'INVALID_INDEX'
            });
        }

        const result = await transaction(async (client) => {
            const playerResult = await client.query(
                'SELECT inventory, coins FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!playerResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = normalizeInventory(playerResult.rows[0].inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            // Цену берём из таблицы items, а не из JSON инвентаря —
            // иначе цену можно было бы подделать на клиенте.
            const dbItemResult = await client.query(
                'SELECT id, name, type, rarity, price, stackable FROM items WHERE id = $1',
                [item.id]
            );
            const dbItem = dbItemResult.rows[0] || null;

            const unitPrice = calculateSellPrice(dbItem, item);
            if (unitPrice <= 0) {
                throw {
                    message: 'Этот предмет нельзя продать',
                    code: 'ITEM_NOT_SELLABLE',
                    statusCode: 400
                };
            }

            // За одну операцию продаём весь стек — это осознанно:
            // слот занимает место, а монеты компактнее. Клиент может
            // попросить quantity: 1, чтобы продать одну штуку из стека.
            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requestedQuantity = Number(req.body?.quantity);
            const soldQuantity = (Number.isInteger(requestedQuantity) && requestedQuantity > 0)
                ? Math.min(stackQuantity, requestedQuantity)
                : stackQuantity;
            const earned = unitPrice * soldQuantity;

            if (soldQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - soldQuantity };
            }

            const newCoins = Number(playerResult.rows[0].coins || 0) + earned;

            await client.query(
                'UPDATE players SET coins = $1, inventory = $2 WHERE id = $3',
                [newCoins, JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_sell', {
                item_id: item.id,
                item_name: item.name,
                quantity: soldQuantity,
                price_earned: earned
            }, client);

            return {
                success: true,
                message: `Продано: ${item.name} ×${soldQuantity}`,
                item: { id: item.id, name: item.name, icon: item.icon || '📦', rarity: item.rarity },
                quantity_sold: soldQuantity,
                unit_price: unitPrice,
                coins_earned: earned,
                coins_total: newCoins
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'ITEM_NOT_SELLABLE'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_sell');
    }
});

/**
 * Разобрать предмет на материалы (POST /items/drop).
 *
 * Закрывает тупик с лимитом инвентаря: раньше предмет можно было только
 * продать за 35% цены или использовать, поэтому 100 слотов забивались
 * испорченным снаряжением и ненужными расходниками, которые некуда было деть.
 *
 * Снаряжение даёт материалы по редкости (calculateScrapYield), остальные
 * предметы просто выбрасываются: «разбирать» еду бессмысленно.
 */
router.post('/drop', async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemIndex = Number(req.body?.item_index);

        if (!Number.isInteger(itemIndex) || itemIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный индекс предмета',
                code: 'INVALID_INDEX'
            });
        }

        const result = await transaction(async (client) => {
            const playerResult = await client.query(
                'SELECT inventory FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            if (!playerResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = normalizeInventory(playerResult.rows[0].inventory);
            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];
            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requested = Number(req.body?.quantity);
            const dropQuantity = (Number.isInteger(requested) && requested > 0)
                ? Math.min(stackQuantity, requested)
                : stackQuantity;

            // Мест может не хватить. Нужное считаем ДО удаления предмета, и при
            // нехватке мест бросаем ошибку: транзакция откатывается, и игрок
            // ничего не теряет.
            const scrapYield = equipmentRules.calculateScrapYield(item, 1);
            const materialNames = Object.keys(scrapYield);
            let materials = [];
            if (materialNames.length > 0) {
                const materialResult = await client.query(
                    'SELECT id, name, type, category, rarity, icon, stats, stackable, max_stack FROM items WHERE name = ANY($1::text[])',
                    [materialNames]
                );
                materials = materialResult.rows;
                if (materials.length === 0) {
                    throw {
                        message: 'Материалы разбора недоступны',
                        code: 'MATERIAL_MISSING',
                        statusCode: 500
                    };
                }
            }

            // Мест может не хватить: считаем это ДО удаления предмета.
            if (materials.length > 0) {
                const projected = inventory.slice();
                for (const material of materials) {
                    const quantity = Number(scrapYield[material.name] || 0);
                    if (quantity <= 0) continue;
                    addItemToInventory(
                        projected,
                        createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                        material
                    );
                }

                const slotsNeeded = Math.max(0, projected.length - inventory.length);
                const freeSlots = MAX_INVENTORY_SLOTS - inventory.length;
                if (slotsNeeded > freeSlots) {
                    throw {
                        message: `Нужно свободных слотов: ${slotsNeeded}, доступно: ${freeSlots}. Продай или разбери что-нибудь.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }
            }

            if (dropQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - dropQuantity };
            }

            const granted = [];
            for (const material of materials) {
                const quantity = Number(scrapYield[material.name] || 0);
                if (quantity <= 0) continue;

                addItemToInventory(
                    inventory,
                    createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                    material
                );
                granted.push({ id: material.id, name: material.name, quantity, icon: material.icon || '📦' });
            }

            await client.query(
                'UPDATE players SET inventory = $1 WHERE id = $2',
                [JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_drop', {
                item_id: item.id,
                item_name: item.name,
                quantity: dropQuantity,
                materials: granted
            }, client);

            return {
                success: true,
                message: `Разобрано: ${item.name}`,
                item: { id: item.id, name: item.name, icon: item.icon || '📦' },
                quantity_dropped: dropQuantity,
                materials: granted
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL', 'MATERIAL_MISSING'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_drop');
    }
});

/**
 * POST /items/unequip — снять предмет из слота в инвентарь.
 * body: { slot }
 *
 * Снятие отсутствовало вообще: слот можно было только ЗАМЕНИТЬ другим
 * предметом. Если игрок надел не тот каску, вернуть предыдущий уже нельзя,
 * а сет/бонус от неудачного предмета может мешать до конца сессии.
 */
router.post('/unequip', async (req, res) => {
    try {
        const playerId = req.player.id;
        const slot = String(req.body?.slot || '');

        const result = await transaction(async (client) => {
            const playerResult = await client.query(
                'SELECT equipment, inventory FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В этом слоте ничего нет', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const inventory = normalizeInventory(player.inventory);
            if (inventory.length >= MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Инвентарь полон (макс. ${MAX_INVENTORY_SLOTS}). Продай или разбери что-нибудь.`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            // Снаряжение не стакуется, поэтому возвращаем его отдельной записью.
            inventory.push(item);
            delete equipment[slot];

            await client.query(
                'UPDATE players SET equipment = $1::jsonb, inventory = $2 WHERE id = $3',
                [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_unequip', {
                slot,
                item_id: item.id ?? null,
                item_name: item.name || null
            }, client);

            return {
                success: true,
                message: `${item.name || 'Предмет'} снят`,
                slot,
                item: { id: item.id ?? null, name: item.name || 'Предмет', icon: item.icon || '📦' },
                inventory_slots: inventory.length
            };
        });

        res.json(result);
    } catch (error) {
        if (['SLOT_EMPTY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_unequip');
    }
});

/**
 * POST /items/buy-stars — купить предмет за звёзды (POST /items/buy-stars).
 *
 * Звёзды выдаются за достижения и ежедневные задания, а тратить их было
 * негде: колонка items.stars_price читалась только витриной магазина.
 */
router.post('/buy-stars', async (req, res) => {
    try {
        const playerId = req.player.id;

        // P1-5: та же валидация количества, что и в /buy — см. комментарий там.
        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        const itemId = Number(req.body?.item_id);

        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите ID предмета', code: 'INVALID_ITEM_ID' });
        }

        const result = await transaction(async (client) => {
            const shopItem = await client.query(
                'SELECT * FROM items WHERE id = $1 AND stars_price > 0',
                [itemId]
            );
            if (!shopItem.rows[0]) {
                throw { message: 'Предмет не найден или не продаётся за звёзды', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItemRow = shopItem.rows[0];
            const totalStars = Number(shopItemRow.stars_price) * quantity;

            const playerResult = await client.query(
                'SELECT stars, inventory FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            if (Number(player.stars || 0) < totalStars) {
                throw {
                    message: `Недостаточно звёзд. Нужно: ${totalStars}, у вас: ${player.stars}`,
                    code: 'INSUFFICIENT_STARS',
                    statusCode: 400
                };
            }

            const inventory = normalizeInventory(player.inventory);
            const newItem = createInventoryItem(shopItemRow, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItemRow);

            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET stars = stars - $1, inventory = $2 WHERE id = $3',
                [totalStars, JSON.stringify(inventory), playerId]
            );

            await trackCollectedItems(client, playerId, [shopItemRow.id]);
            await logPlayerAction(playerId, 'item_bought_stars', {
                item_id: itemId,
                item_name: shopItemRow.name,
                quantity,
                stars_spent: totalStars
            }, client);

            return {
                success: true,
                message: `Куплено за звёзды: ${shopItemRow.name} ×${quantity}`,
                item: { id: shopItemRow.id, name: shopItemRow.name, icon: shopItemRow.icon || '📦', quantity },
                stars_spent: totalStars,
                stars_total: Number(player.stars || 0) - totalStars
            };
        });

        res.json(result);
    } catch (error) {
        if (['INSUFFICIENT_STARS', 'ITEM_NOT_FOUND', 'INVENTORY_FULL', 'PLAYER_NOT_FOUND'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy_stars');
    }
});

module.exports = router;
