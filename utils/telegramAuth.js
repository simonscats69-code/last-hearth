/**
 * Утилиты для валидации Telegram Web App данных
 * Проверяет подпись initData от Telegram Mini App
 */

const crypto = require('crypto');

// Используем console для логирования - простой и надёжный способ
const log = {
    info: (...args) => console.log('[telegramAuth]', ...args),
    warn: (...args) => console.warn('[telegramAuth]', ...args),
    error: (...args) => console.error('[telegramAuth]', ...args)
};

/**
 * Проверяет подпись initData от Telegram
 * @param {string} initData - строка initData из Telegram Web App
 * @param {string} botToken - токен бота
 * @returns {object|null} - распарсенные данные или null если валидация не прошла
 */
function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) {
        log.warn('Отсутствуют параметры', { hasInitData: !!initData, hasBotToken: !!botToken });
        return null;
    }

    try {
        // Разбираем initData через URLSearchParams
        const params = new URLSearchParams(initData);
        
        // Получаем hash и удаляем его из параметров
        const hash = params.get('hash');
        if (!hash) {
            log.warn('Отсутствует hash');
            return null;
        }
        params.delete('hash');

        // Создаём dataCheckString из отсортированных параметров
        // Используем entries() напрямую - это сохраняет правильные значения
        const entries = [...params.entries()];
        const dataCheckString = entries
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Логируем информацию о запросе для отладки
        log.info('Валидация initData', {
            hasDataHash: !!hash,
            paramsCount: entries.length,
            dataCheckStringLength: dataCheckString.length
        });

        // Проверяем наличие обязательных полей
        const authDateStr = params.get('auth_date');
        const userStr = params.get('user');
        if (!authDateStr || !userStr) {
            log.warn('Отсутствуют обязательные поля', { 
                hasAuthDate: !!authDateStr, 
                hasUser: !!userStr,
                keys: [...params.keys()]
            });
            return null;
        }

        // Проверяем время (Telegram рекомендует 24 часа для Mini Apps)
        // Защита от отрицательного age (когда время клиента вперёд)
        const authDate = parseInt(authDateStr, 10);
        const now = Math.floor(Date.now() / 1000);
        const age = now - authDate;
        if (age < -300 || age > 86400) { // 5 минут допустимого drift + 24 часа
            log.warn('initData истёк или время не синхронизировано', { age, authDate, now });
            return null;
        }

        // Парсим данные пользователя для логирования
        let userId = null;
        try {
            const userData = JSON.parse(userStr);
            userId = userData.id;
        } catch (e) {
            log.warn('Ошибка парсинга user', { error: e.message });
        }

        // Создаём секретный ключ по алгоритму Telegram
        // secret_key = HMAC_SHA256("WebAppData", bot_token)
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        log.info('Проверка подписи', {
            userId,
            dataKeys: [...params.keys()].sort(),
            dataCheckStringLength: dataCheckString.length
        });

        // Вычисляем подпись: hash = HMAC_SHA256(secret_key, data_check_string)
        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        // Безопасное сравнение хешей
        let isValid = false;
        try {
            const hashBuf = Buffer.from(computedHash, 'hex');
            const dataHashBuf = Buffer.from(hash, 'hex');
            
            log.info('Сравнение хешей', {
                userId,
                hashMatch: computedHash === hash,
                computedLength: hashBuf.length,
                receivedLength: dataHashBuf.length
            });
            
            if (hashBuf.length === dataHashBuf.length) {
                isValid = crypto.timingSafeEqual(hashBuf, dataHashBuf);
            } else {
                log.warn('Разная длина хешей', { expectedLength: hashBuf.length, actualLength: dataHashBuf.length });
            }
        } catch (e) {
            log.warn({ type: 'ws_auth_failed', reason: 'hash_compare_error', userId, error: e.message });
            return null;
        }
        
        if (!isValid) {
            log.warn({ type: 'ws_auth_failed', reason: 'hash_mismatch', userId });
            return null;
        }

        // Парсим данные пользователя
        let user;
        try {
            user = JSON.parse(userStr);
        } catch(e) {
            log.error('Ошибка парсинга user', { error: e.message });
            return null;
        }
        
        return {
            user: user,
            auth_date: authDate,
            chat_instance: params.get('chat_instance'),
            chat_type: params.get('chat_type'),
            start_param: params.get('start_param'),
            raw: Object.fromEntries(params),
            rawInitData: initData
        };
    } catch (err) {
        console.error('[telegramAuth] Ошибка валидации', err.message, err.stack);
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
