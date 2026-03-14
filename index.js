/**
 * Last Hearth - Постапокалиптический survival RPG Telegram Mini App
 * 
 * Точка входа сервера
 */

// Сначала загружаем dotenv - ДО любых других require
try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        throw e; // Перебрасываем неизвестные ошибки
    }
}

// ADMIN_IDS парсится один раз при старте
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

const { logger } = require('./utils/logger');

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

const { requestMiddleware } = require('./utils/logger');
const { startScheduler } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/achievements');
const { initWebSocket, getMetrics, stopHeartbeat } = require('./utils/realtime');
const { telegramAuthMiddleware } = require('./utils/telegramAuth');
const { initDatabase, query, closePool } = require('./db/database');
const { setupWebhook } = require('./bot/webhook');
const gameRouter = require('./routes/game');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');
const leaderboardRouter = require('./routes/leaderboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Базовая конфигурация приложения
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Проверка длины URL - самая первая (до любых тяжёлых middleware)
app.use((req, res, next) => {
    if (req.url.length > 2048) {
        return res.status(414).end();
    }
    next();
});

// requestMiddleware - первый в цепочке для точного времени начала запроса
app.use(requestMiddleware);

// Middleware для логирования ответов и ошибок
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
        // Логируем ошибки и медленные запросы
        if (res.statusCode >= 400) {
            logger.error(`[REQUEST] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
        } else if (duration > 1000) {
            logger.warn({
                type: 'slow_request',
                url: req.originalUrl,
                duration,
                method: req.method,
                ip: req.ip
            });
        }
    });
    next();
});

// Конфигурация парсеров
const jsonParser = express.json({ limit: '1mb' });

// Разрешённые источники для CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://last-hearth.bothost.ru';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me',
    'null'
];

// Проверка CORS с поддержкой telegram поддоменов
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return true;
    
    // Точное совпадение
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    
    // FRONTEND_URL и его поддомены (точно или subdomain)
    const base = FRONTEND_URL.replace(/\/$/, '');
    if (origin === base || origin.startsWith(base + '.') || origin.startsWith(base + '/')) return true;
    
    // GitHub Pages поддомены
    const githubBase = 'https://simonscats69-code.github.io';
    if (origin === githubBase || origin.startsWith(githubBase + '.')) return true;
    
    // Telegram поддомены (web.telegram.org, web.telegram.me и т.д.)
    if (/^https:\/\/[\w-]+\.telegram\.org$/.test(origin)) return true;
    if (/^https:\/\/[\w-]+\.t\.me$/.test(origin)) return true;
    
    return false;
}

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
            frameSrc: ["'self'", 'https://last-hearth.bothost.ru', 'https://*.bothost.ru'],
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

const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много запросов' }
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
    const origin = req.headers.origin;
    // Разрешаем только конкретный frontend для Mini App
    if (!origin) {
        // Нет origin (прямой запрос) - разрешаем
        return next();
    }
    const isAllowed = isOriginAllowed(origin);
    if (!isAllowed) {
        logger.warn({ type: 'cors_rejected', origin, ip: req.ip, method: req.method });
        // Для запрещённых origin не отправляем CORS заголовки - браузер сам заблокирует
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
    // telegramAuthMiddleware гарантирует наличие req.telegramUser
    const telegramId = String(req.telegramUser.id);
    
    // Разрешаем только админам по их Telegram ID
    if (!ADMIN_IDS.includes(telegramId)) {
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
        // Сервер ещё не запущен - штатная ситуация
        logger.warn('SIGTERM получен до старта сервера');
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
                }).on('error', (fallbackErr) => {
                    logger.error({ type: 'server_fallback_error', message: fallbackErr.message });
                    process.exit(1);
                });
            } else {
                logger.error({ type: 'server_error', message: err.message });
            }
        });
    } catch (err) {
        console.error('Ошибка инициализации БД:', err.message);
        process.exit(1);
    }
}

startServer();
