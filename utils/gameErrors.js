// utils/gameErrors.js
// Единая фабрика игровых ошибок.
// Все роуты должны использовать createGameError(code) вместо инлайн-литералов
// { message, code, statusCode }.
'use strict';

const GAME_ERROR_CODES = Object.freeze({
    // Общие
    PLAYER_NOT_FOUND: { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 },
    UNAUTHORIZED: { message: 'Не авторизован', code: 'UNAUTHORIZED', statusCode: 401 },
    FORBIDDEN: { message: 'Доступ запрещён', code: 'FORBIDDEN', statusCode: 403 },
    INVALID_ID: { message: 'Неверный ID', code: 'INVALID_ID', statusCode: 400 },
    INVALID_AMOUNT: { message: 'Неверное количество', code: 'INVALID_AMOUNT', statusCode: 400 },
    NOT_FOUND: { message: 'Не найдено', code: 'NOT_FOUND', statusCode: 404 },
    SERVER_ERROR: { message: 'Внутренняя ошибка сервера', code: 'INTERNAL_ERROR', statusCode: 500 },

    // Инвентарь
    INVENTORY_FULL: { message: 'Инвентарь переполнен', code: 'INVENTORY_FULL', statusCode: 400 },
    ITEM_NOT_FOUND: { message: 'Предмет не найден', code: 'ITEM_NOT_FOUND', statusCode: 404 },
    ITEM_BROKEN: { message: 'Предмет сломан', code: 'ITEM_BROKEN', statusCode: 400 },
    NOT_ENOUGH_COINS: { message: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS', statusCode: 400 },
    NOT_ENOUGH_STARS: { message: 'Недостаточно звёзд', code: 'NOT_ENOUGH_STARS', statusCode: 400 },
    NOT_ENOUGH_MATERIALS: { message: 'Недостаточно материалов', code: 'NOT_ENOUGH_MATERIALS', statusCode: 400 },
    NOT_ENOUGH_ENERGY: { message: 'Недостаточно энергии', code: 'NOT_ENOUGH_ENERGY', statusCode: 400 },
    NOT_ENOUGH_HEALTH: { message: 'Недостаточно здоровья', code: 'NOT_ENOUGH_HEALTH', statusCode: 400 },

    // Боссы
    BOSS_NOT_FOUND: { message: 'Босс не найден', code: 'BOSS_NOT_FOUND', statusCode: 404 },
    BOSS_ALREADY_ACTIVE: { message: 'Босс уже активен', code: 'BOSS_ALREADY_ACTIVE', statusCode: 400 },
    BOSS_NOT_ACTIVE: { message: 'Босс не активен', code: 'BOSS_NOT_ACTIVE', statusCode: 400 },
    INSUFFICIENT_KEYS: { message: 'Недостаточно ключей', code: 'INSUFFICIENT_KEYS', statusCode: 400 },
    ACTIVE_BATTLE_IN_PROGRESS: { message: 'Активный бой уже идёт', code: 'ACTIVE_BATTLE_IN_PROGRESS', statusCode: 409 },
    RAID_NOT_FOUND: { message: 'Рейд не найден', code: 'RAID_NOT_FOUND', statusCode: 404 },
    RAID_FINISHED: { message: 'Рейд завершён', code: 'RAID_FINISHED', statusCode: 400 },
    RAID_ALREADY_ACTIVE: { message: 'Рейд уже активен', code: 'RAID_ALREADY_ACTIVE', statusCode: 400 },

    // Кланы
    ALREADY_IN_CLAN: { message: 'Вы уже состоите в клане', code: 'ALREADY_IN_CLAN', statusCode: 400 },
    NOT_IN_CLAN: { message: 'Вы не состоите в клане', code: 'NOT_IN_CLAN', statusCode: 400 },
    CLAN_NOT_FOUND: { message: 'Клан не найден', code: 'CLAN_NOT_FOUND', statusCode: 404 },
    CLAN_CLOSED: { message: 'Клан закрыт', code: 'CLAN_CLOSED', statusCode: 400 },
    CLAN_INVITE_CODE_INVALID: { message: 'Неверный код приглашения', code: 'CLAN_INVITE_CODE_INVALID', statusCode: 400 },
    INVALID_TARGET_ID: { message: 'Укажите корректный ID участника', code: 'INVALID_TARGET_ID', statusCode: 400 },
    NO_NEXT_LEADER: { message: 'Нет участников для передачи лидерства', code: 'NO_NEXT_LEADER', statusCode: 403 },

    // Мастерская
    NO_EQUIPMENT: { message: 'Нет экипировки для ремонта', code: 'NO_EQUIPMENT', statusCode: 400 },
    MAX_UPGRADE_LEVEL: { message: 'Максимальный уровень улучшения', code: 'MAX_UPGRADE_LEVEL', statusCode: 400 },
    MAX_MODIFICATION_LEVEL: { message: 'Максимальный уровень модификации', code: 'MAX_MODIFICATION_LEVEL', statusCode: 400 },

    // Контракты
    CONTRACT_NOT_FOUND: { message: 'Контракт не найден', code: 'CONTRACT_NOT_FOUND', statusCode: 404 },
    CONTRACT_LOCKED: { message: 'Контракт уже принят или завершён', code: 'CONTRACT_LOCKED', statusCode: 400 },
    CONTRACT_EXPIRED: { message: 'Контракт просрочен', code: 'CONTRACT_EXPIRED', statusCode: 400 },
    CONTRACT_NOT_COMPLETED: { message: 'Контракт не выполнен', code: 'CONTRACT_NOT_COMPLETED', statusCode: 400 },
    CONTRACT_ALREADY_CLAIMED: { message: 'Награда уже получена', code: 'CONTRACT_ALREADY_CLAIMED', statusCode: 400 },
    CONTRACT_COMPLETED: { message: 'Нельзя отказаться от выполненного контракта', code: 'CONTRACT_COMPLETED', statusCode: 400 },
    CONTRACT_CLAIMED: { message: 'Нельзя отказаться от полученного контракта', code: 'CONTRACT_CLAIMED', statusCode: 400 },
    REROLL_LIMIT: { message: 'Лимит reroll исчерпан', code: 'REROLL_LIMIT', statusCode: 400 },
    NO_AVAILABLE_TYPES: { message: 'Нет доступных типов для замены', code: 'NO_AVAILABLE_TYPES', statusCode: 400 },

    // Крафт
    RECIPE_NOT_FOUND: { message: 'Рецепт не найден', code: 'RECIPE_NOT_FOUND', statusCode: 404 },
    RESULT_NOT_FOUND: { message: 'Результат крафта не найден', code: 'RESULT_NOT_FOUND', statusCode: 404 },
    LEVEL_TOO_LOW: { message: 'Недостаточный уровень', code: 'LEVEL_TOO_LOW', statusCode: 400 },
    INVALID_QUANTITY: { message: 'Количество должно быть целым числом >= 1', code: 'INVALID_QUANTITY', statusCode: 400 },
    INVALID_MATERIALS: { message: 'Неверный формат материалов', code: 'INVALID_MATERIALS', statusCode: 400 },
    MATERIAL_NOT_FOUND: { message: 'Материал не найден', code: 'MATERIAL_NOT_FOUND', statusCode: 400 },
    REFINEMENT_NOT_FOUND: { message: 'Рафинирование недоступно', code: 'REFINEMENT_NOT_FOUND', statusCode: 404 },

    // POI
    POI_NOT_FOUND: { message: 'Точка интереса не найдена', code: 'POI_NOT_FOUND', statusCode: 404 },
    WRONG_LOCATION: { message: 'Вы не в этой локации', code: 'WRONG_LOCATION', statusCode: 400 },
    MISSING_REQUIRED_ITEM: { message: 'Нужен специальный предмет', code: 'MISSING_REQUIRED_ITEM', statusCode: 400 },
    POI_COOLDOWN: { message: 'Точка интереса на кулдауне', code: 'POI_COOLDOWN', statusCode: 400 },
    POI_DAILY_LIMIT: { message: 'Лимит использований на сегодня исчерпан', code: 'POI_DAILY_LIMIT', statusCode: 400 },

    // Ежедневные задания
    TASK_NOT_FOUND: { message: 'Задание не найдено', code: 'TASK_NOT_FOUND', statusCode: 404 },
    TASK_NOT_COMPLETED: { message: 'Задание не выполнено', code: 'TASK_NOT_COMPLETED', statusCode: 400 },
    TASK_ALREADY_CLAIMED: { message: 'Награда уже получена', code: 'TASK_ALREADY_CLAIMED', statusCode: 400 },
    TASK_LOCKED: { message: 'Нельзя заменить выполненное/полученное задание', code: 'TASK_LOCKED', statusCode: 400 },
    NO_AVAILABLE_TYPES: { message: 'Нет доступных типов для замены', code: 'NO_AVAILABLE_TYPES', statusCode: 400 },
    REROLL_LIMIT: { message: 'Лимит reroll исчерпан', code: 'REROLL_LIMIT', statusCode: 400 },

    // PvP
    BANNED: { message: 'Игрок заблокирован', code: 'BANNED', statusCode: 403 },
    TARGET_DEAD: { message: 'Противник мёртв', code: 'TARGET_DEAD', statusCode: 400 },
    TARGET_PROTECTED: { message: 'Цель защищена до 5 уровня', code: 'TARGET_PROTECTED', statusCode: 400 },
});

/**
 * Создать игровую ошибку по коду.
 * @param {string} code — ключ из GAME_ERROR_CODES
 * @param {object} [overrides] — переопределения (message, statusCode, data)
 * @returns {Error}
 */
function createGameError(code, overrides) {
    const base = GAME_ERROR_CODES[code] || GAME_ERROR_CODES.SERVER_ERROR;
    const err = new Error((overrides && overrides.message) || base.message);
    err.code = (overrides && overrides.code) || base.code;
    err.statusCode = (overrides && overrides.statusCode) || base.statusCode;
    if (overrides && overrides.data) err.data = overrides.data;
    return err;
}

/**
 * Проверить, является ли ошибка игровой (имеет буквенно-цифровой код).
 */
function isGameError(err) {
    if (!err || !err.code) return false;
    return /^[A-Z][A-Z0-9_]{2,}$/.test(err.code);
}

module.exports = {
    GAME_ERROR_CODES,
    createGameError,
    isGameError
};
