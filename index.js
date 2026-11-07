/**
 * Last Hearth - point-and-click survival RPG Telegram Mini App
 *
 * Точка входа сервера
 */
require('express-async-errors');

try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ENOENT') {
        throw e;
    }
}

const { getAdminIds, isAdmin } = require('./utils/adminIds');

// Patch logger.error to also notify admin via Telegram (fire-and-forget, rate-limited)
try {
    const { logger } = require('./utils/log');
    const { notifyAdminSync } = require('./utils/telegramNotifier');
    if (logger && typeof logger.error === 'function') {
        const originalError = logger.error.bind(logger);
        logger.error = function (message, meta) {
            originalError(message, meta);
            try {
                const text = typeof message === 'string' ? message : JSON.stringify(message);
                notifyAdminSync(text, meta || {});
            } catch (_) { /* ignore */ }
            return this;
        };
    }
} catch (_) { /* ignore */ }
const DEV_MODE = process.env.DEV_MODE === 'true';
// Валидация initData происходит в utils/serverApi.js (validateTelegramInitData) —
// дубль констант здесь удалён, чтобы избежать расхождений.

const { logger, requestMiddleware, telegramAuthMiddleware } = require('./utils/serverApi');

let server;
let isShuttingDown = false;

// isDatabaseReady управляется флагом: пока БД не готова, /api/* отвечают 503
// SERVICE_STARTING, чтобы BotHost/healthcheck не считал сервер мёртвым.
let isDatabaseReady = false;

async function handleFatalRuntimeError(kind, error) {
    try {
        logger.error({
            type: 'fatal_runtime_error',
            kind,
            message: error?.message || String(error),
            stack: error?.stack || null
        });
        try {
            const { notifyAdminSync } = require('./utils/telegramNotifier');
            notifyAdminSync(`FATAL: ${kind}`, {
                message: error?.message || String(error),
                stack: error?.stack,
                context: kind
            });
        } catch (_) { /* ignore */ }
    } catch {
        console.error(kind, error?.message);
    }

    if (server && !isShuttingDown) {
        await shutdown(kind);
        return;
    }

    setTimeout(async () => {
        try {
            await Promise.race([
                closePool(),
                new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
        } catch {
            // ignore
        }
        process.exit(1);
    }, 100);
}

process.on('uncaughtException', (err) => {
    handleFatalRuntimeError('UNCAUGHT EXCEPTION', err).catch(() => {});
});

// unhandledRejection: не гасим сервер на любой ошибке — только DB-ошибки
// (connection failure, shutdown) считаются критичными и запускают shutdown.
process.on('unhandledRejection', async (reason) => {
    try {
        logger.error({
            type: 'unhandled_rejection',
            message: reason?.message || String(reason),
            stack: reason?.stack || null
        });
        try {
            const { notifyAdminSync } = require('./utils/telegramNotifier');
            notifyAdminSync(`UNHANDLED REJECTION: ${reason?.message || String(reason)}`, {
                message: reason?.message || String(reason),
                stack: reason?.stack,
                context: 'unhandled_rejection'
            });
        } catch (_) { /* ignore */ }
    } catch {
        console.error('UNHANDLED REJECTION:', reason?.message || reason);
    }
    const isDbError = reason && (
        reason.code === '08006' ||      // connection failure
        reason.code === '57P01' ||      // admin_shutdown
        /terminating|connection.*lost/i.test(String(reason?.message || reason))
    );
    if (isDbError && !isShuttingDown) {
        handleFatalRuntimeError('UNHANDLED REJECTION (DB)', reason).catch(() => {});
    }
    // Транзитные конфликты (deadlock, serialization_failure) и SQL-ошибки (42*)
    // логируем, но не роняем процесс.
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { startScheduler, stopScheduler, getSchedulerMetrics } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/game-helpers');
const { getMetrics } = require('./utils/metrics');
const { query, closePool, setLogger, describeError } = require('./db/database');
const { initDatabase } = require('./db/init');
const { setupWebhook, bot } = require('./webhook');
const gameRouter = require('./routes/game');
const adminRouter = require('./routes/admin');

const app = express();

app.use((req, res, next) => {
    const _json = res.json.bind(res);
    res.json = function (body) {
        res.set('Content-Type', 'application/json; charset=utf-8');
        return _json(body);
    };
    next();
});
const PORT = process.env.PORT || 3000;

function getRateLimitKey(req) {
    return req.ip;
}

app.disable('x-powered-by');
// trust proxy: false — не доверяем X-Forwarded-For от любого хоста.
// Для работы за reverse-proxy (Bothost и т.п.) укажите IP прокси: app.set('trust proxy', ['1.2.3.4']).
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',') : false);

app.use((req, res, next) => {
    if (req.url.length > 2048) {
        return res.status(414).end();
    }
    next();
});

app.use(requestMiddleware);

const jsonParser = express.json({ limit: '1mb' });

function isSameHostOrSubdomain(origin, baseUrl) {
    let originHost;
    let baseHost;
    try {
        const o = new URL(origin);
        const b = new URL(baseUrl);
        if (o.protocol !== 'https:' || b.protocol !== 'https:') return false;
        originHost = o.hostname;
        baseHost = b.hostname;
    } catch {
        return false;
    }
    return originHost === baseHost || originHost.endsWith('.' + baseHost);
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://bot-1791489863-8300-greatcatsby.bothost.tech';
const GITHUB_PAGES_URL = 'https://simonscats69-code.github.io';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me'
];

function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return false;

    if (ALLOWED_ORIGINS.includes(origin)) return true;

    if (isSameHostOrSubdomain(origin, FRONTEND_URL)) return true;

    if (isSameHostOrSubdomain(origin, GITHUB_PAGES_URL)) return true;

    if (/^https:\/\/[\w-]+\.telegram\.org$/.test(origin)) return true;
    if (/^https:\/\/[\w-]+\.t\.me$/.test(origin)) return true;

    return false;
}

app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('hex');
    next();
});

const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtmlTemplate = null;

const ASSET_FILES = ['game.js', 'styles.css', 'shared/equipment.js'];
const ASSET_CHECK_INTERVAL_MS = 2000;

let assetVersion = 'dev';
let assetMtimes = new Map();
let lastAssetCheckAt = 0;
let lastAssetFallbackAt = 0;

function computeAssetVersion() {
    try {
        const hash = crypto.createHash('sha1');
        const mtimes = new Map();

        for (const file of ASSET_FILES) {
            const full = path.join(__dirname, 'public', file);
            const stat = fs.statSync(full);
            const content = fs.readFileSync(full);
            // Проверяем размер файла по содержимому, чтобы не отдавать stale-версию
            // при неатомарной записи (cp/git pull без rename).
            if (content.length !== Number(stat.size)) {
                throw new Error(`${file}: размер изменился во время чтения (${content.length} != ${stat.size})`);
            }
            hash.update(content);
            mtimes.set(file, Number(stat.mtimeMs) || Number(stat.mtime) || 0);
        }

        assetVersion = hash.digest('hex').slice(0, 10);
        assetMtimes = mtimes;
    } catch (e) {
        // Не удалось прочитать файлы — используем timestamp-fallback с cooldown,
        // чтобы не генерировать новый ?v= на каждый запрос.
        const now = Date.now();
        if (now - lastAssetFallbackAt >= ASSET_CHECK_INTERVAL_MS) {
            lastAssetFallbackAt = now;
            assetVersion = Date.now().toString(36);
            logger.warn('[index] Не удалось вычислить версию статики, использую timestamp:', e.message);
        }
    }
}

computeAssetVersion();

function getAssetVersion() {
    const now = Date.now();
    if (now - lastAssetCheckAt < ASSET_CHECK_INTERVAL_MS) {
        return assetVersion;
    }
    lastAssetCheckAt = now;

    try {
        for (const file of ASSET_FILES) {
            const full = path.join(__dirname, 'public', file);
            const stat = fs.statSync(full);
            const mtime = Number(stat.mtimeMs) || Number(stat.mtime) || 0;
            if (assetMtimes.get(file) !== mtime) {
                computeAssetVersion();
                break;
            }
        }
    } catch {
        // Файл недоступен (права/удаление) — оставляем текущую версию.
    }
    return assetVersion;
}

function sendIndexHtml(res) {
    try {
        if (indexHtmlTemplate === null) {
            indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        // no-store: nonce одноразовый, кэширование ломает CSP (старый nonce).
        res.set('Cache-Control', 'no-store');
        res.send(indexHtmlTemplate
            .replace(/\{\{nonce\}\}/g, res.locals.nonce || '')
            .replace(/\{\{assetVersion\}\}/g, getAssetVersion())
            .replace(/\{\{devMode\}\}/g, DEV_MODE ? 'true' : 'false'));
    } catch (e) {
        logger.error('[index] Не удалось отдать index.html:', e.message);
        res.status(500).send('Ошибка загрузки приложения. Обновите страницу.');
    }
}

app.use((req, res, next) => {
    res.setTimeout(15000, () => {
        logger.error(`[TIMEOUT] Запрос превысил время ожидания: ${req.method} ${req.path}`);
        if (!res.headersSent) {
            res.status(503).json({
                success: false,
                error: 'Сервер временно недоступен. Попробуйте позже.',
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
                'https://telegram.org'
            ],
            // script-src-attr: 'none' — inline-обработчики (onclick) запрещены;
            // используем addEventListener, иначе CSP их блокирует.
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
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
    permissionsPolicy: {
        features: {
            'accelerometer': ["'none'"],
            'gyroscope': ["'none'"],
        }
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
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Init-Data');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

function requireDatabaseReady(req, res, next) {
    if (isDatabaseReady) return next();
    return res.status(503).json({
        success: false,
        error: 'Игра загружается, попробуйте через несколько секунд',
        code: 'SERVICE_STARTING'
    });
}

app.use('/api/game', requireDatabaseReady, gameRouter);
app.use('/api/admin', requireDatabaseReady, adminRouter);
// /api/leaderboard/* переписывается на /minigames/leaderboard/* внутри gameRouter.
app.use('/api/leaderboard', requireDatabaseReady, (req, res, next) => {
    req.url = '/minigames/leaderboard' + req.url;
    gameRouter(req, res, next);
});

app.get(['/', '/index.html'], (req, res) => sendIndexHtml(res));

app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    maxAge: '1h',
    etag: true,
    cacheControl: true
}));

// Health checks
app.get('/health', healthLimiter, (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

app.get('/ready', healthLimiter, async (req, res) => {
    if (!isDatabaseReady) {
        return res.status(503).json({ status: 'starting', db: 'not_initialized' });
    }
    try {
        await query('SELECT 1');
        res.json({ status: 'ready', db: 'connected' });
    } catch (err) {
        res.status(503).json({ status: 'not_ready', db: 'error' });
    }
});

app.get('/metrics', telegramAuthMiddleware, (req, res) => {
    if (!req.telegramUser) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const telegramId = String(req.telegramUser.id);

    if (!isAdmin(telegramId)) {
        logger.warn({ type: 'metrics_access_denied', telegramId, ip: req.ip });
        return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const metrics = getMetrics();
    res.json({
        ...metrics,
        scheduler: getSchedulerMetrics()
    });
});

// 404: для браузерных GET без расширения — SPA-fallback (index.html),
// иначе — JSON 404.
app.use((req, res) => {
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && !req.path.startsWith('/api') && accept.includes('text/html') && !/\.[a-zA-Z0-9]+$/.test(req.path)) {
        return sendIndexHtml(res);
    }
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    if (res.headersSent) {
        return;
    }
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

async function shutdown(signal) {
    logger.info(`Получен сигнал ${signal}. Завершаем сервер...`);

    if (isShuttingDown) {
        logger.warn('Процесс завершения уже запущен');
        return;
    }
    isShuttingDown = true;

    // Порядок: сначала останавливаем scheduler и бота, затем HTTP-сервер
    // и пул БД. stopScheduler не бросает, даже если не был запущен.
    try {
        stopScheduler();
    } catch (err) {
        logger.warn('Ошибка остановки планировщика:', err.message);
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
        server.closeAllConnections();
        server.close(async () => {
            logger.info('HTTP сервер остановлен');
            try {
                await closePool();
                logger.info('Подключение к БД закрыто');
            } catch (err) {
                logger.error('Ошибка закрытия БД:', err);
            }
            // process.exitCode заранее выставлен при фатальной ошибке
            // (БД недоступна, fatal-ошибка) — код 1 победит над 0.
            process.exit(process.exitCode || 0);
        });
        setTimeout(() => {
            logger.error('Graceful shutdown не завершился, принудительный exit');
            process.exit(1);
        }, 10000);
    } else {
        logger.warn('SIGTERM получен до старта сервера');
        try {
            await closePool();
        } catch {
            // ignore
        }
        process.exit(process.exitCode || 0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function startHttpServer(port) {
    return new Promise((resolve, reject) => {
        const srv = app.listen(port, '0.0.0.0', () => {
            logger.info(`Сервер запущен на порту ${port}`);
            resolve(srv);
        });
        srv.on('error', reject);
    });
}

async function validateStartupConfig() {
    const problems = [];
    const warnings = [];

    if (!process.env.TG_BOT_TOKEN) {
        if (process.env.NODE_ENV === 'production') {
            problems.push('TG_BOT_TOKEN не задан в production: авторизация будет отвечать 500.');
        } else {
            warnings.push('TG_BOT_TOKEN не задан: авторизация пропускается (dev-режим). /metrics и админка ответят 401 вместо полезного ответа.');
        }
    }

    if (getAdminIds().length === 0) {
        warnings.push('ADMIN_IDS пуст: все /api/admin/* будут отвечать 403. Проверьте .env.');
    }

    if (!process.env.NODE_ENV) {
        warnings.push("NODE_ENV не задан (ожидается 'production' или 'development').");
    }

    if (!process.env.DATABASE_URL) {
        warnings.push('DATABASE_URL не задан в env — используется значение по умолчанию из db/database.js.');
    }

    for (const w of warnings) logger.warn({ type: 'startup_config_warning', message: w });

    if (problems.length > 0) {
        for (const p of problems) logger.error({ type: 'startup_config_error', message: p });
        // Критические проблемы конфигурации — не стартуем: процесс завершится
        // с кодом 1, чтобы оркестратор перезапустил его.
        process.exitCode = 1;
        await handleFatalRuntimeError('startup_config_invalid', { problems });
        return { problems, warnings };
    }

    return { problems, warnings };
}

async function startServer() {
    setLogger(logger);

    await validateStartupConfig();

    try {
        server = await startHttpServer(PORT);
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            logger.error({
                type: 'port_in_use',
                message: `Порт ${PORT} занят другим процессом. Завершаем: платформа перезапустит контейнер.`
            });
        } else {
            logger.error({ type: 'server_error', message: err.message });
        }
        process.exit(1);
        return;
    }

    const DB_INIT_ATTEMPTS = 3;
    const DB_INIT_RETRY_DELAY_MS = 5000;
    let databaseInitialized = false;
    for (let attempt = 1; attempt <= DB_INIT_ATTEMPTS; attempt++) {
        try {
            await initDatabase();
            logger.info('База данных инициализирована');
            databaseInitialized = true;

            try {
                const { init: initLootCache } = require('./utils/lootCache');
                await initLootCache();
                logger.info('Кэш лута инициализирован');
            } catch (lootError) {
                logger.error(`Ошибка инициализации кэша лута (продолжаем): ${describeError(lootError)}`);
            }

            break;
        } catch (dbError) {
            logger.error(`Ошибка инициализации БД (попытка ${attempt}/${DB_INIT_ATTEMPTS}), продолжаем без БД: ${describeError(dbError)}`);
            if (attempt < DB_INIT_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, DB_INIT_RETRY_DELAY_MS));
            }
        }
    }

    isDatabaseReady = databaseInitialized;
    if (!isDatabaseReady) {
        logger.error({
            type: 'database_unavailable',
            message: `БД недоступна после ${DB_INIT_ATTEMPTS} попыток. Игровые маршруты ответят 503 до перезапуска процесса.`
        });

        process.exitCode = 1;
        await handleFatalRuntimeError('database_unavailable', { attempts: DB_INIT_ATTEMPTS });
    }

    try {
        await initAchievementsTable();
        logger.info('Таблица достижений инициализирована');
    } catch (achError) {
        logger.error(`Ошибка инициализации таблицы достижений (продолжаем): ${describeError(achError)}`);
    }

    let botTimeout;
    await Promise.race([
        setupWebhook(app).then(
            () => logger.info('Webhook настроен'),
            (botError) => logger.error('Ошибка настройки бота (сервер работает): ' + describeError(botError))
        ),
        new Promise((resolve) => {
            botTimeout = setTimeout(() => {
                logger.warn('Настройка бота превысила 20 секунд — продолжаем');
                resolve();
            }, 20000);
        })
    ]);
    clearTimeout(botTimeout);

    try {
        startScheduler();
    } catch (schedError) {
        logger.error('Ошибка запуска планировщика:', schedError.message);
    }
}

if (require.main === module) {
    startServer();
}
