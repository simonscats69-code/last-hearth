/**
 * Утилиты для валидации Telegram Web App данных
 * Проверяет подпись initData от Telegram Mini App
 */

const crypto = require('crypto');
const logger = require('./logger');

/**
 * Проверяет подпись initData от Telegram
 * @param {string} initData - строка initData из Telegram Web App
 * @param {string} botToken - токен бота
 * @returns {object|null} - распарсенные данные или null если валидация не прошла
 */
function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) {
        return null;
    }

    try {
        // Разбираем initData
        const urlSearchParams = new URLSearchParams(initData);
        const data = {};
        for (const [key, value] of urlSearchParams) {
            data[key] = value;
        }

        // Проверяем наличие обязательных полей
        if (!data.hash || !data.user || !data.auth_date) {
            return null;
        }

        // Проверяем время (не старше 24 часов)
        const authDate = parseInt(data.auth_date, 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            return null;
        }

        // Проверяем подпись
        const secretKey = crypto
            .createHash('sha256')
            .update(botToken)
            .digest();
        
        // Парсим данные пользователя для логирования
        let userId = null;
        try {
            const userData = JSON.parse(data.user);
            userId = userData.id;
        } catch (e) {
            console.error('JSON.parse user failed:', typeof data.user, data.user?.toString?.().substring(0, 100));
        }
        
        // Сортируем данные (кроме hash) и создаём строку
        const dataCheckString = Object.keys(data)
            .filter(key => key !== 'hash')
            .sort()
            .map(key => `${key}=${data[key]}`)
            .join('\n');

        const hash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        // Безопасное сравнение хешей с использованием timingSafeEqual
        let isValid = false;
        try {
            const hashBuf = Buffer.from(hash);
            const dataHashBuf = Buffer.from(data.hash);
            
            if (hashBuf.length === dataHashBuf.length) {
                isValid = crypto.timingSafeEqual(hashBuf, dataHashBuf);
            }
        } catch (e) {
            // Ошибка при сравнении - считаем невалидным
            logger.warn({ type: 'ws_auth_failed', reason: 'hash_compare_error', userId, error: e.message });
            return null;
        }
        
        if (!isValid) {
            logger.warn({ type: 'ws_auth_failed', reason: 'hash_mismatch', userId });
            return null;
        }

        // Парсим данные пользователя
        let user;
        try {
            user = JSON.parse(data.user);
        } catch(e) {
            console.error('JSON.parse user failed:', typeof data.user, data.user?.toString?.().substring(0, 100));
            throw e;
        }
        
        return {
            user: user,
            auth_date: authDate,
            chat_instance: data.chat_instance,
            chat_type: data.chat_type,
            start_param: data.start_param,
            raw: data
        };
    } catch (err) {
        return null;
    }
}

/**
 * Middleware для Express - проверяет Telegram initData
 */
function telegramAuthMiddleware(req, res, next) {
    const initData = req.headers['x-init-data'] || req.body.initData;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        // Если токен не настроен - пропускаем (для разработки)
        return next();
    }

    if (!initData) {
        return res.status(401).json({ error: 'Требуется initData' });
    }

    const validated = validateTelegramInitData(initData, botToken);
    
    if (!validated) {
        return res.status(401).json({ error: 'Неверная подпись initData' });
    }

    // Добавляем данные пользователя в запрос
    req.telegramUser = validated.user;
    req.telegramAuth = validated;
    
    next();
}

/**
 * Проверяет является ли пользователь админом
 */
function isAdmin(telegramId, adminIds) {
    if (!adminIds || !Array.isArray(adminIds)) {
        return false;
    }
    return adminIds.includes(String(telegramId));
}

module.exports = {
    validateTelegramInitData,
    telegramAuthMiddleware,
    isAdmin
};
