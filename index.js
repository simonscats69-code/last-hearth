/**
 * Last Hearth - Постапокалиптический survival RPG Telegram Mini App
 * 
 * Точка входа сервера
 */
require('express-async-errors');

// Сначала загружаем dotenv - ДО любых других require
try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ENOENT') {
        throw e; // Перебрасываем неизвестные ошибки
    }
}

// ADMIN_IDS парсится один раз при старте
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
const DEV_MODE = process.env.DEV_MODE === 'true';
const MAX_INIT_DATA_AGE_SECONDS = parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '172800', 10); // 48 часов по умолчанию

const { logger, requestMiddleware, telegramAuthMiddleware, getTelegramIdFromHeaders } = require('./utils/serverApi');

let server;
let isShuttingDown = false;

function handleFatalRuntimeError(kind, error) {
    try {
        logger.error({
            type: 'fatal_runtime_error',
            kind,
            message: error?.message || String(error),
            stack: error?.stack || null
        });
    } catch {
        console.error(kind, error?.message);
    }

    if (server && !isShuttingDown) {
        shutdown(kind);
        return;
    }

    setTimeout(() => process.exit(1), 100);
}

// Глобальные обработчики ошибок для отладки
process.on('uncaughtException', (err) => {
    handleFatalRuntimeError('UNCAUGHT EXCEPTION', err);
});

// unhandledRejection НЕ убивает сервер: одиночный отклонённый промис
// (например, ошибка БД при деплое) не должен ронять весь игровой процесс.
process.on('unhandledRejection', (reason) => {
    try {
        logger.error({
            type: 'unhandled_rejection',
            message: reason?.message || String(reason),
            stack: reason?.stack || null
        });
    } catch {
        console.error('UNHANDLED REJECTION:', reason?.message || reason);
    }
});

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { startScheduler } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/game-helpers');
const { initWebSocket, getMetrics, stopHeartbeat } = require('./utils/realtime');
const { initDatabase, query, closePool, setLogger } = require('./db/database');
const { setupWebhook, bot } = require('./webhook');
const gameRouter = require('./routes/game');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

function getRateLimitKey(req) {
    return getTelegramIdFromHeaders(req.headers) || req.ip;
}

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

// Конфигурация парсеров
const jsonParser = express.json({ limit: '1mb' });

// Разрешённые источники для CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://last-hearth.bothost.ru';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me'
];

// Проверка CORS с поддержкой telegram поддоменов
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return false;
    
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

// Генератор nonce для CSP
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('hex');
    next();
});

// Таймаут для всех запросов - защита от зависаний
app.use((req, res, next) => {
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
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                (req, res) => `'nonce-${res.locals.nonce}'`,
                'https://cdn.jsdelivr.net',
                'https://telegram.org',
                'https://sad.adsgram.ai'
            ],
            scriptSrcAttr: [(req, res) => `'nonce-${res.locals.nonce}'`],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
            fontSrc: ["'self'", 'https:'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            frameAncestors: [
                "'self'",
                'https://web.telegram.org',
                'https://*.telegram.org',
                'https://*.t.me'
            ],
        },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false
}));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    message: { error: 'API лимит превышен' },
    keyGenerator: getRateLimitKey
});

const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много запросов' }
});

app.use('/api', apiLimiter);
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
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
    if (!origin) {
        return next();
    }
    const isAllowed = isOriginAllowed(origin);
    if (!isAllowed) {
        logger.warn({ type: 'cors_rejected', origin, ip: req.ip, method: req.method });
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

// Роутеры
logger.info('[index] gameRouter загружен:', gameRouter ? 'OK' : 'NULL');
if (gameRouter?.stack) {
    logger.info('[index] gameRouter routes:', gameRouter.stack.filter(l => l.route).map(l => l.route?.path));
}
app.use('/api/game', gameRouter);
app.use('/api/admin', adminRouter);
app.use('/api/leaderboard', (req, res, next) => {
    req.url = '/minigames' + req.url;
    gameRouter(req, res, next);
});
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
app.get('/metrics', telegramAuthMiddleware, (req, res) => {
    const telegramId = String(req.telegramUser.id);
    
    if (!ADMIN_IDS.includes(telegramId)) {
        logger.warn({ type: 'metrics_access_denied', telegramId, ip: req.ip });
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const metrics = getMetrics();
    res.json(metrics);
});

// 404 обработчик
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Глобальный обработчик ошибок
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

function shutdown(signal) {
    logger.info(`Получен сигнал ${signal}. Завершаем сервер...`);
    
    if (isShuttingDown) {
        logger.warn('Процесс завершения уже запущен');
        return;
    }
    isShuttingDown = true;
    
    try {
        stopHeartbeat();
        logger.info('WebSocket heartbeat остановлен');
    } catch (err) {
        logger.warn('Ошибка остановки heartbeat:', err.message);
    }

    try {
        if (bot && typeof bot.stop === 'function') {
            bot.stop(signal);
            logger.info('Telegram bot polling остановлен');
        }
    } catch (err) {
        logger.warn('Ошибка остановки Telegram bot:', err.message);
    }
    
    if (server) {
        server.close(async () => {
            logger.info('HTTP сервер остановлен');
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
        logger.warn('SIGTERM получен до старта сервера');
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function startHttpServer(port) {
    return new Promise((resolve, reject) => {
        const srv = app.listen(port, '0.0.0.0', () => {
            logger.info(`Сервер запущен на порту ${port}`);
            try {
                initWebSocket(srv);
            } catch (wsError) {
                logger.error('Ошибка инициализации WebSocket:', wsError.message);
            }
            resolve(srv);
        });
        srv.on('error', reject);
    });
}

async function startServer() {
    setLogger(logger);

    // HTTP-сервер стартует ПЕРВЫМ. За reverse-прокси Bothost приложение
    // обязано слушать порт как можно раньше: пока порт не открыт,
    // прокси отвечает "404 page not found" на все запросы.
    // БД/бот/планировщик инициализируются в фоне и не могут заблокировать listen.
    try {
        server = await startHttpServer(PORT);
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            // Нельзя молча переезжать на PORT+1 за прокси:
            // прокси продолжит слать трафик на исходный порт -> вечный 404.
            logger.error({
                type: 'port_in_use',
                message: `Порт ${PORT} занят другим процессом. Завершаемся — платформа перезапустит контейнер.`
            });
        } else {
            logger.error({ type: 'server_error', message: err.message });
        }
        process.exit(1);
        return;
    }

    try {
        await initDatabase();
        logger.info('База данных инициализирована');
    } catch (dbError) {
        logger.error('Ошибка инициализации БД, продолжаем без БД:', dbError.message);
    }

    try {
        await initAchievementsTable();
        logger.info('Таблица достижений инициализирована');
    } catch (achError) {
        logger.error('Ошибка инициализации таблицы достижений (продолжаем):', achError.message);
    }

    // setupWebhook ждёт ответа api.telegram.org без таймаута.
    // Зависший запрос здесь раньше блокировал app.listen -> 404 на весь сайт.
    // Ограничиваем ожидание 20 секундами: сбой бота не влияет на работу сайта.
    await Promise.race([
        setupWebhook(app).then(
            () => logger.info('Webhook настроен'),
            (botError) => logger.error('Ошибка настройки бота (сервер работает):', botError.message)
        ),
        new Promise((resolve) => setTimeout(() => {
            logger.warn('Настройка бота превысила 20 секунд — пропускаем');
            resolve();
        }, 20000))
    ]);

    try {
        startScheduler();
    } catch (schedError) {
        logger.error('Ошибка запуска планировщика:', schedError.message);
    }
}

startServer();