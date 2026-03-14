/**
 * Last Hearth - Постапокалиптический survival RPG Telegram Mini App
 * 
 * Точка входа сервера
 */

// Сначала подключаем logger
const logger = require('./utils/logger');

// Глобальные обработчики ошибок для отладки
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason, reason?.stack);
    process.exit(1);
});

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

// Пробуем загрузить dotenv, но не критично если его нет (на продакшене может не быть)
try {
    require('dotenv').config();
} catch (e) {
    // dotenv не доступен - используем переменные окружения напрямую
    logger.info('ℹ️ dotenv не загружен, используем переменные окружения системы');
}

const { logger, requestMiddleware } = require('./utils/logger');
const { startScheduler } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/achievements');
const { initWebSocket, getMetrics, updateWebSocketMetrics } = require('./utils/realtime');
const { telegramAuthMiddleware } = require('./utils/telegramAuth');
const { initDatabase, query } = require('./db/database');
const { setupWebhook } = require('./bot/webhook');
const gameRouter = require('./routes/game');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');
const leaderboardRouter = require('./routes/leaderboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для логирования ошибок
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        // Логируем только ошибки
        if (res.statusCode >= 400) {
            logger.error(`[REQUEST] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// Middleware для обработки ошибок
app.use((err, req, res, next) => {
    logger.error(`[ERROR] ${req.method} ${req.path}:`, err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
});

// Разрешённые источники для CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://last-hearth.bothost.ru';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me',
    FRONTEND_URL,
    'https://last-hearth.bothost.ru',
    'null'
];

// Проверка CORS с поддержкой telegram поддоменов
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return true;
    
    // Точное совпадение
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    
    // Проверяем FRONTEND_URL
    if (origin === FRONTEND_URL) return true;
    
    // GitHub Pages поддомены
    if (origin.startsWith('https://simonscats69-code.github.io')) return true;
    
    // BotHost поддомены
    if (origin.startsWith('https://last-hearth.bothost.ru')) return true;
    
    // Telegram поддомены (web.telegram.org, web.telegram.me и т.д.)
    if (/^https:\/\/[\w-]+\.telegram\.org$/.test(origin)) return true;
    if (/^https:\/\/[\w-]+\.t\.me$/.test(origin)) return true;
    
    return false;
}
const jsonParser = express.json({ limit: '1mb' });

// Таймаут для всех запросов - защита от зависаний
app.use((req, res, next) => {
    // Устанавливаем таймаут на ответ (15 секунд)
    res.setTimeout(15000, () => {
        logger.error(`[TIMEOUT] Запрос превысил время ожидания: ${req.method} ${req.path}`);
        if (!res.headersSent) {
            res.status(503).json({
                success: false,
                error: 'Сервер временно занят. Попробуйте позже.',
                code: 'SERVER_TIMEOUT'
            });
        }
    });
    next();
});

// Middleware для логирования JSON ошибок
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(data) {
        logger.debug('[RES.JSON]', req.method, req.originalUrl, typeof data);
        return originalJson(data);
    };
    next();
});

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
    // CSP для Telegram Mini App - разрешаем unsafe-inline для совместимости
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
            fontSrc: ["'self'", 'https:'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'sameorigin' }
}));

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Слишком много запросов. Попробуй позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-telegram-id'] || req.ip
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'API лимит превышен' },
    keyGenerator: (req) => req.headers['x-telegram-id'] || req.ip
});

app.use(limiter);
app.use('/api', apiLimiter);
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        // Парсим JSON
        return jsonParser(req, res, (err) => {
            if (err) {
                logger.error('[JSON PARSER ERROR]', err.message);
                return res.status(400).json({ error: 'Неверный JSON' });
            }
            next();
        });
    }
    next();
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, res, next) => {
    if (req.url.length > 2048) {
        return res.status(414).end();
    }
    next();
});

app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Разрешаем только конкретный frontend для Mini App
    if (!origin) {
        // Нет origin (прямой запрос) - разрешаем
        return next();
    }
    const isAllowed = isOriginAllowed(origin);
    if (!isAllowed) {
        logger.warn({ type: 'cors_rejected', origin, ip: req.ip, method: req.method });
        // Добавляем заголовки CORS даже для запрещённых origin чтобы браузер получил ответ
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Telegram-ID, X-Init-Data');
        return res.status(403).json({ error: 'Origin не разрешён', origin });
    }
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Telegram-ID, X-Init-Data');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
});

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            logger.warn({
                type: 'slow_request',
                requestId: req.requestId,
                url: req.originalUrl,
                duration,
                method: req.method,
                ip: req.ip,
                telegramId: req.headers['x-telegram-id']
            });
        }
    });
    next();
});

app.use(requestMiddleware);

// Роутеры
app.use('/api/game', gameRouter);
app.use('/api/admin', adminRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api', apiRouter);

// Статика
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    cacheControl: true
}));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Health checks
const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много запросов' }
});

app.get('/health', healthLimiter, (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

app.get('/ready', healthLimiter, async (req, res) => {
    try {
        await query('SELECT 1');
        res.json({ status: 'ready', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'not_ready', db: 'error' });
    }
});

// Метрики сервера (только для админов)
// Требуется валидная авторизация Telegram через x-init-data
app.get('/metrics', telegramAuthMiddleware, (req, res) => {
    // Проверяем что пользователь прошёл валидацию Telegram
    if (!req.telegramUser) {
        return res.status(401).json({ error: 'Требуется авторизация Telegram' });
    }
    
    const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
    const telegramId = String(req.telegramUser.id);
    
    // Разрешаем только админам по их Telegram ID
    if (!adminIds.includes(telegramId)) {
        logger.warn({ type: 'metrics_access_denied', telegramId, ip: req.ip });
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    // Получаем метрики
    const metrics = getMetrics();
    
    res.json(metrics);
});

// 404 обработчик - В САМОМ КОНЦЕ
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    logger.error({
        type: 'server_error',
        requestId: req.requestId,
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method
    });
    res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId
    });
});

let server;
let isShuttingDown = false;

function shutdown(signal) {
    logger.info(`Получен сигнал ${signal}. Завершаем сервер...`);
    
    if (isShuttingDown) {
        logger.warn('Процесс завершения уже запущен');
        return;
    }
    isShuttingDown = true;
    
    // Останавливаем heartbeat
    try {
        const { stopHeartbeat } = require('./utils/realtime');
        stopHeartbeat();
        logger.info('WebSocket heartbeat остановлен');
    } catch (err) {
        logger.warn('Ошибка остановки heartbeat:', err.message);
    }
    
    if (server) {
        server.close(async () => {
            logger.info('HTTP сервер остановлен');
            // Закрываем подключение к БД
            try {
                const { closePool } = require('./db/database');
                await closePool();
                logger.info('Подключение к БД закрыто');
            } catch (err) {
                logger.error('Ошибка закрытия БД:', err);
            }
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('Graceful shutdown не завершился, принудительный exit');
            process.exit(1);
        }, 10000);
    } else {
        // Сервер ещё не запущен, ждём завершения инициализации
        const checkServerInterval = setInterval(() => {
            if (server) {
                clearInterval(checkServerInterval);
                shutdown(signal);
            }
        }, 100);
        // Таймаут если сервер так и не запустится
        setTimeout(() => {
            clearInterval(checkServerInterval);
            logger.error('Сервер не был инициализирован, принудительный exit');
            process.exit(1);
        }, 30000);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
    logger.error({ type: 'uncaughtException', message: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error({ type: 'unhandledRejection', reason: String(reason) });
    process.exit(1);
});

async function startServer() {
    try {
        await initDatabase();
        logger.info('База данных инициализирована');
        
        // Инициализация таблицы достижений
        await initAchievementsTable();
        logger.info('Таблица достижений инициализирована');
        
        await setupWebhook(app);
        logger.info('Webhook настроен');
        
        // Запуск планировщика задач
        startScheduler();
        logger.info('Планировщик задач запущен');
        
        server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Сервер запущен на порту ${PORT}`);
            
            // Инициализация WebSocket
            initWebSocket(server);
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.warn(`Порт ${PORT} уже используется, пробуем порт ${PORT + 1}`);
                server = app.listen(PORT + 1, '0.0.0.0', () => {
                    logger.info(`Сервер запущен на порту ${PORT + 1}`);
                    initWebSocket(server);
                });
            } else {
                logger.error({ type: 'server_error', message: err.message });
            }
        });
    } catch (err) {
        logger.error({ type: 'startup_error', message: err.message, stack: err.stack });
        process.exit(1);
    }
}

startServer();
