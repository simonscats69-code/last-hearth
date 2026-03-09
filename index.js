require('dotenv').config();
const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

const { logger, requestMiddleware } = require('./utils/logger');
const { initDatabase, query } = require('./db/database');
const { setupWebhook } = require('./bot/webhook');
const gameRouter = require('./routes/game');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://*.telegram.org',
    'https://t.me',
    'https://*.t.me'
];

const ORIGIN_SET = new Set(ALLOWED_ORIGINS);
const jsonParser = express.json({ limit: '1mb' });

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
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
        return jsonParser(req, res, next);
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
    if (!origin) {
        res.header('Access-Control-Allow-Origin', '*');
        return next();
    }
    const isAllowed = ORIGIN_SET.has(origin) || ALLOWED_ORIGINS.some(o => o.includes('*') && origin.endsWith(o.replace('*.', '')));
    res.header('Access-Control-Allow-Origin', isAllowed ? origin : '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Telegram-ID');
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

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    cacheControl: true,
    immutable: true
}));

app.use('/api/game', gameRouter);
app.use('/api', apiRouter);

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

app.get('/debug/memory', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).end();
    }
    res.json(process.memoryUsage());
});

app.get('/ready', async (req, res) => {
    try {
        await query('SELECT 1');
        res.json({ status: 'ready', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'not_ready', db: 'error' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
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

function shutdown(signal) {
    logger.info(`Получен сигнал ${signal}. Завершаем сервер...`);
    if (server) {
        server.close(() => {
            logger.info('HTTP сервер остановлен');
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('Graceful shutdown не завершился, принудительный exit');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
