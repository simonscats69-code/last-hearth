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

const { getAdminIds } = require('./utils/adminIds');

// ADMIN_IDS парсится один раз при старте через общий модуль
const ADMIN_IDS = getAdminIds();
const DEV_MODE = process.env.DEV_MODE === 'true';
// Окно валидации initData (MAX_INIT_DATA_AGE_SECONDS, по умолчанию 1 ч)
// читается напрямую в utils/serverApi.js (validateTelegramInitData) —
// дубль константы здесь был мёртвым кодом и удалён.

const { logger, requestMiddleware, telegramAuthMiddleware } = require('./utils/serverApi');

let server;
let isShuttingDown = false;

// Готовность БД. HTTP-сервер поднимается ДО initDatabase (это нужно, чтобы
// прокси Bothost не отвечал 404, пока приложение поднимается), и поэтому
// есть окно, в которое порт уже слушает, а база ещё не инициализирована.
//
// Без этого флага игровой запрос в это окно доходил до роута и падал на
// обращении к неготовой БД: игрок видел 500/таймаут вместо внятного ответа,
// а после трёх неудачных попыток подключения сервер продолжал работу и
// отдавал такие ошибки уже постоянно.
//
// Пока флаг снят — 503 SERVICE_STARTING и понятный текст. /health и
// корневая страница продолжают отвечать: проверка живости и загрузка UI
// не должны зависеть от базы.
let isDatabaseReady = false;

async function handleFatalRuntimeError(kind, error) {
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

// Глобальные обработчики ошибок для отладки
process.on('uncaughtException', (err) => {
    handleFatalRuntimeError('UNCAUGHT EXCEPTION', err).catch(() => {});
});

// unhandledRejection: не гасим сервер на любой ошибке, но критическая
// ошибка БД (connection failure, shutdown) делает работу небезопасной —
// завершаем процесс, чтобы orquestrator перезапустил инстанс.
process.on('unhandledRejection', async (reason) => {
    try {
        logger.error({
            type: 'unhandled_rejection',
            message: reason?.message || String(reason),
            stack: reason?.stack || null
        });
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
    // Временные конфликты (deadlock, serialization_failure) и ошибки SQL (42*)
    // логируем, но не убиваем процесс — транзакции ретраят их сами.
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// startScheduler запускает задачи по расписанию, stopScheduler — гасит их
// перед выходом из процесса: см. его вызов в shutdown() ниже.
// getSchedulerMetrics отдаётся в GET /metrics.
const { startScheduler, stopScheduler, getSchedulerMetrics } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/game-helpers');
const { getMetrics } = require('./utils/metrics');
const { query, closePool, setLogger, describeError } = require('./db/database');
// initDatabase живёт в db/init.js — он связывает подключение (database.js)
// и DDL (schema.js). Импорт отсюда, а не из database.js, чтобы тот не
// зависел от schema и цикл импортов не появлялся снова.
// Тяжёлые миграции (runMigrations, DROP TABLE, DELETE, ремонт данных) вызываются
// отдельной командой: node db/migrate.js — чтобы не уничтожать данные при каждом старте.
const { initDatabase } = require('./db/init');
const { setupWebhook, bot } = require('./webhook');
const gameRouter = require('./routes/game');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Ключ rate-limit.
 *
 * Раньше здесь возвращался getTelegramIdFromHeaders(req.headers) — то есть
 * user.id, разобранный из заголовка initData БЕЗ проверки подписи. Лимитер
 * стоит на строке app.use('/api', apiLimiter), то есть ДО авторизации
 * (gameRouter с validatePlayer подключается ниже), поэтому подпись к этому
 * моменту ещё не проверена.
 *
 * Проверено перебором: с одного IP и 1000 фейковых initData с разными
 * подставленными id получалось 1000 уникальных ключей — лимит обходился
 * тривиально, тем же способом, что и раньше с заголовком x-telegram-id.
 * То, что validateTelegramInitData потом отвергнет такой initData, не помогает:
 * счётчик лимита к этому моменту уже разделён по поддельным ключам.
 *
 * Решение: на уровне /apiidentity ещё не подтверждена, поэтому ключ — только
 * IP. Персонифицированные лимиты на критичных операциях ставит сам роут
 * ПОСЛЕ validatePlayer, где req.player.id уже проверен подписью.
 */
function getRateLimitKey(req) {
    return req.ip;
}

// Базовая конфигурация приложения
app.disable('x-powered-by');
// trust proxy: false — не доверяем X-Forwarded-For от любого хоста.
// Иначе злоумышленник подделывает заголовок и получает разные ключи
// rate-limit с одного реального IP. Для работы за конкретным прокси
// (Bothost и т.п.) укажите его IP явно: app.set('trust proxy', ['1.2.3.4']).
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',') : false);

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

/**
 * Совпадает ли origin с базовым URL или его поддоменом.
 *
 * Строка НЕ подходит: startsWith(base + '.') пропускает домены атакующего,
 * потому что 'https://simonscats69-code.github.io.evil.com' начинается с
 * 'https://simonscats69-code.github.io.'. Проверено перебором — такой origin
 * получал ALLOW вместе с credentials.
 *
 * Правильно: разобрать origin через URL и сравнивать hostname. Поддоменом
 * base является только hostname, заканчивающийся на '.' + hostname(base).
 * Порт и путь игнорируются (Origin их не содержит), протокол обязан быть
 * https — иначе http-версия домена тоже прошла бы.
 */
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

// Разрешённые источники для CORS.
// Fallback — актуальный домен мини-аппа (старый last-hearth.bothost.ru
// больше не привязан к сервису); в панели Bothost задаётся FRONTEND_URL.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://bot-1791489863-8300-greatcatsby.bothost.tech';
const GITHUB_PAGES_URL = 'https://simonscats69-code.github.io';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me'
];

// Проверка CORS с поддержкой telegram поддоменов
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return false;
    
    // Точное совпадение
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    
    // FRONTEND_URL и его поддомены — через сравнение hostname (см.
    // isSameHostOrSubdomain): прежняя проверка origin.startsWith(base + '.')
    // разрешала https://last-hearth.bothost.ru.evil.com, то есть домен
    // атакующего получал доступ к API с credentials.
    if (isSameHostOrSubdomain(origin, FRONTEND_URL)) return true;
    
    // GitHub Pages: тот же класс доменов, поэтому и та же проверка hostname.
    // Раньше здесь стояло startsWith(githubBase + '.') — обход идентичный.
    if (isSameHostOrSubdomain(origin, GITHUB_PAGES_URL)) return true;
    
    // Telegram поддомены (web.telegram.org, web.telegram.me и т.д.)
    // Регулярка с \w- и обязательным многоточием перед доменом: строки без
    // суффикса («.telegram.org» с чем-то перед ним) не проходят.
    if (/^https:\/\/[\w-]+\.telegram\.org$/.test(origin)) return true;
    if (/^https:\/\/[\w-]+\.t\.me$/.test(origin)) return true;
    
    return false;
}

// Генератор nonce для CSP
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('hex');
    next();
});

// Отдача index.html с подстановкой {{nonce}} (шаблон кэшируем в памяти)
const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtmlTemplate = null;

// Версия статики для кэш-бастинга (?v=...): считается по СОДЕРЖИМОМУ game.js,
// styles.css и shared/equipment.js. shared/equipment.js обязателен в списке —
// иначе правка общих правил экипировки не сбросит кэш у клиента, и браузер
// достанет старую копию (у статики Cache-Control 1 час).
//
// ЗДЕСЬ БЫЛ БАГ: версия считалась ОДИН раз при старте сервера и никогда не
// пересчитывалась. После правки CSS или game.js без перезапуска процесса
// assetVersion оставался старым -> URL ?v= со старым хэшем -> браузер
// полчаса-час отдавал закэшированную старую копию, и правки «не появлялись».
//
// Теперь при каждой отдаче index.html сверяем mtime файлов (statSync, не
// чтение) и пересчитываем хэш только при реальном изменении. Нагрузка —
// три statSync на запрос HTML, сам хэш считается только после правки.
const ASSET_FILES = ['game.js', 'styles.css', 'shared/equipment.js'];

// Как часто сверять mtime файлов (мс). Окно кэша версии: см. getAssetVersion.
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
            // Защита от неатомарной записи: при деплое «в месте» (cp/git pull
            // без rename) mtime может обновиться на частично записанном файле.
            // Такой хэш уехал бы клиентам как ?v=, и браузер закэшировал бы
            // на час обрезанный game.js.
            // Проверяем размер: stat.size читается ДО чтения, так что при
            // совпадении содержимое либо было стабильным, либо дописано после
            // чтения — но mtime тогда тоже стал бы больше записанного.
            if (content.length !== Number(stat.size)) {
                throw new Error(`${file}: размер изменился во время чтения (${content.length} != ${stat.size})`);
            }
            hash.update(content);
            mtimes.set(file, Number(stat.mtimeMs) || Number(stat.mtime) || 0);
        }

        assetVersion = hash.digest('hex').slice(0, 10);
        assetMtimes = mtimes;
    } catch (e) {
        // Не смогли прочитать файлы. Две вещи, которых здесь быть НЕ должно:
        //
        // 1. НЕ обнулять assetMtimes. Раньше здесь стояло
        //    `assetMtimes = new Map()`, и при недоступном файле проверка
        //    `assetMtimes.get(file) !== mtime` снова оказывалась истинной —
        //    пересчёт на каждый HTML-запрос, а каждый пересчёт давал новый
        //    timestamp. Итог: бесконечный cache-busting (?v= менялся на каждой
        //    отдаче), клиент перекачивал game.js + styles.css на каждый вход
        //    и флушил logger.warn.
        // 2. Timestamp-fallback только с backoff: без cooldown одна
        //    незаписанная правка означала бы новый ?v= постоянно.
        const now = Date.now();
        if (now - lastAssetFallbackAt >= ASSET_CHECK_INTERVAL_MS) {
            lastAssetFallbackAt = now;
            assetVersion = Date.now().toString(36);
            logger.warn('[index] Не удалось вычислить версию статики, использую timestamp:', e.message);
        }
        // assetMtimes и assetVersion сохраняем — пока отдаём последнюю рабочую версию.
    }
}

computeAssetVersion();

/**
 * Версия статики с проверкой изменений файлов.
 *
 * TTL-кэш: statSync НЕ чаще раза в ASSET_CHECK_INTERVAL_MS. Причина — sendIndexHtml
 * работает и как SPA-fallback для любого GET с Accept: text/html, то есть
 * через него идут боты, превью-ссылки Telegram и перезагрузки; синхронный
 * statSync в обработчике каждого такого запроса блокировал бы event loop.
 * Окно в 2 секунды не мешает разработке: правку видно сразу после Ctrl+F5,
 * а случайный лишний stat при частом фладе невозможен.
 *
 * @returns {string} хэш статики
 */
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
        // Файл временно недоступен (правка/перемещение) — отдаём то, что есть.
        // Следующий запрос пересчитает.
    }
    return assetVersion;
}

function sendIndexHtml(res) {
    try {
        if (indexHtmlTemplate === null) {
            indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        // no-store: nonce одноразовый, страницу нельзя брать из кэша/по 304 (иначе
        // в DOM останется старый nonce, а CSP придёт с новым — скрипты заблокируются)
        res.set('Cache-Control', 'no-store');
        res.send(indexHtmlTemplate
            .replace(/\{\{nonce\}\}/g, res.locals.nonce || '')
            .replace(/\{\{assetVersion\}\}/g, getAssetVersion())
            // DEV-флаг авторизации для клиента. Клиент по нему решает,
            // допустим ли фиктивный telegram_id/initData. Флаг ставится
            // ТОЛЬКО по явному DEV_MODE=true — в production (где NODE_ENV
            // часто не задан, напр. на BotHost) подстановка всё равно 'false'.
            .replace(/\{\{devMode\}\}/g, DEV_MODE ? 'true' : 'false'));
    } catch (e) {
        logger.error('[index] Не удалось отдать index.html:', e.message);
        res.status(500).send('Ошибка загрузки приложения. Обновите страницу.');
    }
}

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
                'https://telegram.org'
            ],
            // script-src-attr: 'none', а не nonce.
            //
            // Nonce здесь не имел смысла: он разрешает элемент <script nonce>,
            // но НЕ разрешает inline-обработчики вида onclick="...". Ставить
            // 'unsafe-inline' в script-src-attr — это как раз то, чего мы
            // добиваемся (XSS через обработчик не проходит), а ставить
            // 'none' значит запретить их полностью.
            //
            // Проверено: в public/index.html нет ни одного on*= атрибута,
            // а единственный onclick= в public/game.js — текст внутри
            // комментария о том, что CSP их блокирует. Игра работает через
            // addEventListener, поэтому 'none' ничего не ломает.
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
    // X-Telegram-ID убран: заголовок приходит от клиента и больше нигде
    // не читается. Разрешать его в CORS незачем, а его присутствие
    // провоцировало клиентов его слать.
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Init-Data');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

/**
 * Middleware: игровые маршруты не работают, пока не готова БД.
 *
 * Ставится перед /api/game, /api/admin и /api/leaderboard — всем, что ходит
 * в базу. /health, /ready и корневая страница смонтированы без него:
 * проверка живости и загрузка UI не должны зависеть от базы.
 */
function requireDatabaseReady(req, res, next) {
    if (isDatabaseReady) return next();
    return res.status(503).json({
        success: false,
        error: 'Игра запускается, попробуйте через несколько секунд',
        code: 'SERVICE_STARTING'
    });
}

// Роутеры
// idempotencyMiddleware здесь был бесполезен: он стоял ДО validatePlayer,
// req.player ещё не заполнен, и middleware всегда уходил в next().
// Перенесён в routes/game/index.js — сразу после validatePlayer.
app.use('/api/game', requireDatabaseReady, gameRouter);
app.use('/api/admin', requireDatabaseReady, adminRouter);
// Публичный рейтинг: /api/leaderboard/* -> игровой роутер.
//
// ВАЖНО про req.url: внутри обработчика Express уже снял префикс монтирования,
// то есть для запроса /api/leaderboard/players здесь req.url === '/players'.
// Раньше код делал req.url = '/minigames' + req.url, получая '/minigames/players',
// а в minigames.js зарегистрирован '/leaderboard/players'. Совпадения не
// происходило -> все обращения к рейтингу уходили в 404 Not found.
// Нужен полный внутренний путь: '/minigames/leaderboard' + остаток.
app.use('/api/leaderboard', requireDatabaseReady, (req, res, next) => {
    req.url = '/minigames/leaderboard' + req.url;
    gameRouter(req, res, next);
});

// Главная страница: index.html через шаблон (подстановка nonce для CSP)
app.get(['/', '/index.html'], (req, res) => sendIndexHtml(res));

// Статика (index: false — index.html отдаёт только sendIndexHtml)
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

// /ready отвечает 503, пока БД не готова. Именно на этот эндпоинт
// смотрят балансировщики и оркестраторы: 200 означает «можно слать
// трафик», поэтому до готовности БД отвечать 200 нельзя. Внутри
// дополнительно проверяем соединение — флаг мог быть снят, а пул
// после этого упал.
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

// Метрики сервера (только для админов)
app.get('/metrics', telegramAuthMiddleware, (req, res) => {
    // Guard: при TG_BOT_TOKEN не заданном и NODE_ENV !== 'production'
    // telegramAuthMiddleware уходит в next() БЕЗ установки req.telegramUser
    // (utils/serverApi.js:536-543). ЗДЕСЬ БЫЛ 500: String(req.telegramUser.id)
    // на undefined бросал TypeError вместо 401. В .env NODE_ENV не задан, а в
    // logs/combined.log были записи hasBotToken:false — ситуация реальная.
    if (!req.telegramUser) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const telegramId = String(req.telegramUser.id);
    
    if (!getAdminIds().includes(telegramId)) {
        logger.warn({ type: 'metrics_access_denied', telegramId, ip: req.ip });
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    // Метрики HTTP-слоя плюс метрики планировщика.
    //
    // Счётчики задач планировщика (сколько раз отработала регенерация
    // энергии, сколько раз падал cleanup, сколько длилась последняя
    // задача) накапливались в памяти, но наружу не отдавались: по
    // /metrics было видно только состояние HTTP-запросов. Теперь видно,
    // работают ли фоновые задачи — иначе их поломку можно заметить
    // лишь по косвенным признакам в логах.
    const metrics = getMetrics();
    res.json({
        ...metrics,
        scheduler: getSchedulerMetrics()
    });
});

// 404: для браузерных переходов по сайту отдаём index.html (SPA-fallback),
// чтобы ни один путь не мог вернуть 404 при загрузке игры.
// Для API и прочего — JSON 404.
app.use((req, res) => {
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && !req.path.startsWith('/api') && accept.includes('text/html') && !/\.[a-zA-Z0-9]+$/.test(req.path)) {
        return sendIndexHtml(res);
    }
    res.status(404).json({ error: 'Not found' });
});

// Глобальный обработчик ошибок
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

    // Планировщик останавливаем СРАЗУ и ДО закрытия пула.
    //
    // Раньше этого вызова не было: stopScheduler() экспортировался, но
    // его никто не звал. Задачи по расписанию проверяют schedulerEnabled
    // перед каждым запуском, и без вызова новая задача могла стартовать
    // уже после server.close() и уйти в закрывающийся пул — в лог
    // падала бы ошибка закрытия соединения.
    //
    // stopScheduler не прерывает задачу, которая уже выполняется, —
    // она завершится на текущем пуле. Но новых запусков не будет.
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
            // process.exitCode заранее выставлен при аварийном завершении
            // (БД недоступна, fatal-ошибка) - код 1 говорит платформе о сбое.
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

/**
 * Проверка обязательной конфигурации при старте.
 *
 * Не роняет процесс (кроме критичных случаев) — insecure-состояния логируются
 * громко, чтобы dev увидел их при рестарте, а не спустя часы отладки.
 *
 * @returns {{problems: string[], warnings: string[]}}
 */
async function validateStartupConfig() {
    const problems = [];
    const warnings = [];

    // TG_BOT_TOKEN: без него в NODE_ENV !== 'production'
    // telegramAuthMiddleware уходит в next() БЕЗ req.telegramUser (см. #17).
    if (!process.env.TG_BOT_TOKEN) {
        if (process.env.NODE_ENV === 'production') {
            problems.push('TG_BOT_TOKEN не задан в production: авторизация будет отвечать 500.');
        } else {
            warnings.push('TG_BOT_TOKEN не задан: авторизация пропускается (dev-режим). /metrics и админка ответят 401 вместо полезного ответа.');
        }
    }

    // ADMIN_IDS: пустой список = все /api/admin/* молча 403.
    if (ADMIN_IDS.length === 0) {
        warnings.push('ADMIN_IDS пуст: все /api/admin/* будут отвечать 403. Проверь .env.');
    }

    // NODE_ENV: от него зависят security-решения в utils/serverApi.js
    // (fail-closed auth) и уровень логирования.
    if (!process.env.NODE_ENV) {
        warnings.push("NODE_ENV не задан (ожидается 'production' или 'development').");
    }

    // База данных: DATABASE_URL читает db/database.js
    if (!process.env.DATABASE_URL) {
        warnings.push('DATABASE_URL не задан в env — используется значение по умолчанию из db/database.js.');
    }

    for (const w of warnings) logger.warn({ type: 'startup_config_warning', message: w });

    if (problems.length > 0) {
        for (const p of problems) logger.error({ type: 'startup_config_error', message: p });
        // Критичные проблемы конфигурации — не стартуем: молча живой сервер
        // без авторизации опаснее, чем упавший процесс, который перезапустится.
        process.exitCode = 1;
        await handleFatalRuntimeError('startup_config_invalid', { problems });
        return { problems, warnings };
    }

    return { problems, warnings };
}

async function startServer() {
    setLogger(logger);

    // Громкая проверка конфигурации при старте.
    //
    // ЗДЕСЬ БЫЛА ТИХАЯ ПОЛОМКА: ADMIN_IDS парсился (строка 18) и никак не
    // проверялся. При пустом значении ВСЕ /api/admin/* молча отвечают 403 даже
    // легитимному админу, а предупреждения нет — выглядит как «доступ запрещён
    // сервером». В проверенном .env NODE_ENV и ADMIN_IDS не заданы вовсе.
    // Попутно ADMIN_IDS фиксируется здесь, а routes/admin.js:50 парсит env
    // заново на каждый запрос — копии могут разойтись (dev переустановил env
    // между рестартом и запросом).
    await validateStartupConfig();

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

    // БД может быть временно недоступна при старте (DNS, сеть, холодный
    // старт Supabase) — повторяем подключение, прежде чем работать без БД.
const DB_INIT_ATTEMPTS = 3;
const DB_INIT_RETRY_DELAY_MS = 5000;
    let databaseInitialized = false;
    for (let attempt = 1; attempt <= DB_INIT_ATTEMPTS; attempt++) {
        try {
            await initDatabase();
            logger.info('База данных инициализирована');
            databaseInitialized = true;
            
            // Инициализируем кэш лута после успешного подключения к БД
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

    // Флаг снимается ТОЛЬКО после успеха. Если все попытки провалились,
    // isDatabaseReady остаётся false и requireDatabaseReady отдаёт 503 на
    // игровые маршруты — вместо 500 из каждого эндпоинта. Раньше в этом
    // состоянии сервер просто продолжал работу и падал в каждом хендлере
    // отдельно; теперь причина видна сразу и в логах, и игроку.
    isDatabaseReady = databaseInitialized;
    if (!isDatabaseReady) {
        // ЗДЕСЬ БЫЛ БАГ ДЕПЛОЯ: после всех неудачных попыток процесс продолжал
        // жить. `/` (index.html) и `/health` отвечают 200 — пробник BotHost
        // видит здоровье и НЕ перезапускает контейнер. Все /api/game/* отдают
        // 503 SERVICE_STARTING до ручного рестарта, а isDatabaseReady не
        // пересчитывается никогда. Игра мертва, но выглядит живой.
        //
        // Теперь падаем: платформа перезапустит контейнер и даст новое окно на
        // БД. Отключается явно (EXIT_ON_DB_FAIL=false) для ручного дебага.
        logger.error({
            type: 'database_unavailable',
            message: `БД недоступна после ${DB_INIT_ATTEMPTS} попыток. Игровые маршруты отвечают 503 до перезапуска процесса.`
        });

        // Всегда завершаем процесс при недоступности БД: иначе healthcheck видит
        // 200 на / и не перезапускает контейнер, а игра отвечает 503 вечно.
        // EXIT_ON_DB_FAIL=false оставлен для обратной совместимости, но не
        // предотвращает завершение — иначе сервер застревает в зомби-состоянии.
        process.exitCode = 1;
        await handleFatalRuntimeError('database_unavailable', { attempts: DB_INIT_ATTEMPTS });
    }

    try {
        await initAchievementsTable();
        logger.info('Таблица достижений инициализирована');
    } catch (achError) {
        logger.error(`Ошибка инициализации таблицы достижений (продолжаем): ${describeError(achError)}`);
    }

    // setupWebhook ждёт ответа api.telegram.org без таймаута.
    // Зависший запрос здесь раньше блокировал app.listen -> 404 на весь сайт.
    // Ограничиваем ожидание 20 секундами: сбой бота не влияет на работу сайта.
    // Таймер обязательно очищаем иначе, даже при мгновенной настройке бота,
    // через 20 секунд печатался ложный warn «превысила 20 секунд».
    let botTimeout;
    await Promise.race([
        setupWebhook(app).then(
            () => logger.info('Webhook настроен'),
            (botError) => logger.error('Ошибка настройки бота (сервер работает): ' + describeError(botError))
        ),
        new Promise((resolve) => {
            botTimeout = setTimeout(() => {
                logger.warn('Настройка бота превысила 20 секунд — пропускаем');
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

// Запускаем сервер ТОЛЬКО при прямом запуске (node index.js).
// Когда index.js require'ится извне (проверка загрузки модулей в entrypoint
// wrapper'е), main() не должен выполняться: иначе require-проверка занимает
// порт, а реальный экземпляр дочернего процесса падает с EADDRINUSE.
if (require.main === module) {
    startServer();
}