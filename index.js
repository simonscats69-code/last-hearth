/**
 * Last Hearth - >AB0?>:0;8?B8G5A:89 survival RPG Telegram Mini App
 * 
 * ">G:0 2E>40 A5@25@0
 */
require('express-async-errors');

// !=0G0;0 703@C605< dotenv -  ;N1KE 4@C38E require
try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ENOENT') {
        throw e; // 5@51@0AK205< =58725AB=K5 >H81:8
    }
}

const { getAdminIds, isAdmin } = require('./utils/adminIds');

// ADMIN_IDS ?0@A8BAO >48= @07 ?@8 AB0@B5 G5@57 >1I89 <>4C;L

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
// :=> 20;840F88 initData (MAX_INIT_DATA_AGE_SECONDS, ?> C<>;G0=8N 1 G)
// G8B05BAO =0?@O<CN 2 utils/serverApi.js (validateTelegramInitData) 
// 4C1;L :>=AB0=BK 745AL 1K; <Q@B2K< :>4>< 8 C40;Q=.

const { logger, requestMiddleware, telegramAuthMiddleware } = require('./utils/serverApi');

let server;
let isShuttingDown = false;

// >B>2=>ABL . HTTP-A5@25@ ?>4=8<05BAO  initDatabase (MB> =C6=>, GB>1K
// ?@>:A8 Bothost =5 >B25G0; 404, ?>:0 ?@8;>65=85 ?>4=8<05BAO), 8 ?>MB><C
// 5ABL >:=>, 2 :>B>@>5 ?>@B C65 A;CH05B, 0 1070 5IQ =5 8=8F80;878@>20=0.
//
// 57 MB>3> D;030 83@>2>9 70?@>A 2 MB> >:=> 4>E>48; 4> @>CB0 8 ?040; =0
// >1@0I5=88 : =53>B>2>9 : 83@>: 2845; 500/B09<0CB 2<5AB> 2=OB=>3> >B25B0,
// 0 ?>A;5 B@QE =5C40G=KE ?>?KB>: ?>4:;NG5=8O A5@25@ ?@>4>;60; @01>BC 8
// >B4020; B0:85 >H81:8 C65 ?>AB>O==>.
//
// >:0 D;03 A=OB  503 SERVICE_STARTING 8 ?>=OB=K9 B5:AB. /health 8
// :>@=520O AB@0=8F0 ?@>4>;60NB >B25G0BL: ?@>25@:0 682>AB8 8 703@C7:0 UI
// =5 4>;6=K 7028A5BL >B 107K.
let isDatabaseReady = false;

async function handleFatalRuntimeError(kind, error) {
    try {
        logger.error({
            type: 'fatal_runtime_error',
            kind,
            message: error?.message || String(error),
            stack: error?.stack || null
        });
        // B?@02;O5< 04<8=8AB@0B>@C
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

// ;>10;L=K5 >1@01>BG8:8 >H81>: 4;O >B;04:8
process.on('uncaughtException', (err) => {
    handleFatalRuntimeError('UNCAUGHT EXCEPTION', err).catch(() => {});
});

// unhandledRejection: =5 30A8< A5@25@ =0 ;N1>9 >H81:5, => :@8B8G5A:0O
// >H81:0  (connection failure, shutdown) 45;05B @01>BC =5157>?0A=>9 
// 7025@H05< ?@>F5AA, GB>1K orquestrator ?5@570?CAB8; 8=AB0=A.
process.on('unhandledRejection', async (reason) => {
    try {
        logger.error({
            type: 'unhandled_rejection',
            message: reason?.message || String(reason),
            stack: reason?.stack || null
        });
        // B?@02;O5< 04<8=8AB@0B>@C
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
    // @5<5==K5 :>=D;8:BK (deadlock, serialization_failure) 8 >H81:8 SQL (42*)
    // ;>38@C5<, => =5 C18205< ?@>F5AA  B@0=70:F88 @5B@0OB 8E A0<8.
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// startScheduler 70?CA:05B 7040G8 ?> @0A?8A0=8N, stopScheduler  30A8B 8E
// ?5@54 2KE>4>< 87 ?@>F5AA0: A<. 53> 2K7>2 2 shutdown() =865.
// getSchedulerMetrics >B40QBAO 2 GET /metrics.
const { startScheduler, stopScheduler, getSchedulerMetrics } = require('./utils/scheduler');
const { initAchievementsTable } = require('./utils/game-helpers');
const { getMetrics } = require('./utils/metrics');
const { query, closePool, setLogger, describeError } = require('./db/database');
// initDatabase 682QB 2 db/init.js  >= A2O7K205B ?>4:;NG5=85 (database.js)
// 8 DDL (schema.js). <?>@B >BAN40, 0 =5 87 database.js, GB>1K B>B =5
// 7028A5; >B schema 8 F8:; 8<?>@B>2 =5 ?>O2;O;AO A=>20.
// "O6Q;K5 <83@0F88 (runMigrations, DROP TABLE, DELETE, @5<>=B 40==KE) 2K7K20NBAO
// >B45;L=>9 :><0=4>9: node db/migrate.js  GB>1K =5 C=8GB>60BL 40==K5 ?@8 :064>< AB0@B5.
const { initDatabase } = require('./db/init');
const { setupWebhook, bot } = require('./webhook');
const gameRouter = require('./routes/game');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * ;NG rate-limit.
 *
 *  0=LH5 745AL 2>72@0I0;AO getTelegramIdFromHeaders(req.headers)  B> 5ABL
 * user.id, @07>1@0==K9 87 703>;>2:0 initData  ?@>25@:8 ?>4?8A8. 8<8B5@
 * AB>8B =0 AB@>:5 app.use('/api', apiLimiter), B> 5ABL  02B>@870F88
 * (gameRouter A validatePlayer ?>4:;NG05BAO =865), ?>MB><C ?>4?8AL : MB><C
 * <><5=BC 5IQ =5 ?@>25@5=0.
 *
 * @>25@5=> ?5@51>@><: A >4=>3> IP 8 1000 D59:>2KE initData A @07=K<8
 * ?>4AB02;5==K<8 id ?>;CG0;>AL 1000 C=8:0;L=KE :;NG59  ;8<8B >1E>48;AO
 * B@8280;L=>, B5< 65 A?>A>1><, GB> 8 @0=LH5 A 703>;>2:>< x-telegram-id.
 * ">, GB> validateTelegramInitData ?>B>< >B25@3=5B B0:>9 initData, =5 ?><>305B:
 * AGQBG8: ;8<8B0 : MB><C <><5=BC C65 @0745;Q= ?> ?>445;L=K< :;NG0<.
 *
 *  5H5=85: =0 C@>2=5 /apiidentity 5IQ =5 ?>4B25@645=0, ?>MB><C :;NG  B>;L:>
 * IP. 5@A>=8D8F8@>20==K5 ;8<8BK =0 :@8B8G=KE >?5@0F8OE AB028B A0< @>CB
 * ! validatePlayer, 345 req.player.id C65 ?@>25@5= ?>4?8ALN.
 */
function getRateLimitKey(req) {
    return req.ip;
}

// 07>20O :>=D83C@0F8O ?@8;>65=8O
app.disable('x-powered-by');
// trust proxy: false  =5 4>25@O5< X-Forwarded-For >B ;N1>3> E>AB0.
// =0G5 7;>C<KH;5==8: ?>445;K205B 703>;>2>: 8 ?>;CG05B @07=K5 :;NG8
// rate-limit A >4=>3> @50;L=>3> IP. ;O @01>BK 70 :>=:@5B=K< ?@>:A8
// (Bothost 8 B.?.) C:068B5 53> IP O2=>: app.set('trust proxy', ['1.2.3.4']).
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',') : false);

// @>25@:0 4;8=K URL - A0<0O ?5@20O (4> ;N1KE BO6Q;KE middleware)
app.use((req, res, next) => {
    if (req.url.length > 2048) {
        return res.status(414).end();
    }
    next();
});

// requestMiddleware - ?5@2K9 2 F5?>G:5 4;O B>G=>3> 2@5<5=8 =0G0;0 70?@>A0
app.use(requestMiddleware);

// >=D83C@0F8O ?0@A5@>2
const jsonParser = express.json({ limit: '1mb' });

/**
 * !>2?0405B ;8 origin A 107>2K< URL 8;8 53> ?>44><5=><.
 *
 * !B@>:0  ?>4E>48B: startsWith(base + '.') ?@>?CA:05B 4><5=K 0B0:CNI53>,
 * ?>B><C GB> 'https://simonscats69-code.github.io.evil.com' =0G8=05BAO A
 * 'https://simonscats69-code.github.io.'. @>25@5=> ?5@51>@><  B0:>9 origin
 * ?>;CG0; ALLOW 2<5AB5 A credentials.
 *
 * @028;L=>: @07>1@0BL origin G5@57 URL 8 A@02=820BL hostname. >44><5=><
 * base O2;O5BAO B>;L:> hostname, 70:0=G820NI89AO =0 '.' + hostname(base).
 * >@B 8 ?CBL 83=>@8@CNBAO (Origin 8E =5 A>45@68B), ?@>B>:>; >1O70= 1KBL
 * https  8=0G5 http-25@A8O 4><5=0 B>65 ?@>H;0 1K.
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

//  07@5HQ==K5 8AB>G=8:8 4;O CORS.
// Fallback  0:BC0;L=K9 4><5= <8=8-0??0 (AB0@K9 last-hearth.bothost.ru
// 1>;LH5 =5 ?@82O70= : A5@28AC); 2 ?0=5;8 Bothost 7040QBAO FRONTEND_URL.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://bot-1791489863-8300-greatcatsby.bothost.tech';
const GITHUB_PAGES_URL = 'https://simonscats69-code.github.io';
const ALLOWED_ORIGINS = [
    'https://telegram.org',
    'https://t.me'
];

// @>25@:0 CORS A ?>445@6:>9 telegram ?>44><5=>2
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return false;
    
    // ">G=>5 A>2?045=85
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    
    // FRONTEND_URL 8 53> ?>44><5=K  G5@57 A@02=5=85 hostname (A<.
    // isSameHostOrSubdomain): ?@56=OO ?@>25@:0 origin.startsWith(base + '.')
    // @07@5H0;0 https://last-hearth.bothost.ru.evil.com, B> 5ABL 4><5=
    // 0B0:CNI53> ?>;CG0; 4>ABC? : API A credentials.
    if (isSameHostOrSubdomain(origin, FRONTEND_URL)) return true;
    
    // GitHub Pages: B>B 65 :;0AA 4><5=>2, ?>MB><C 8 B0 65 ?@>25@:0 hostname.
    //  0=LH5 745AL AB>O;> startsWith(githubBase + '.')  >1E>4 845=B8G=K9.
    if (isSameHostOrSubdomain(origin, GITHUB_PAGES_URL)) return true;
    
    // Telegram ?>44><5=K (web.telegram.org, web.telegram.me 8 B.4.)
    //  53C;O@:0 A \w- 8 >1O70B5;L=K< <=>3>B>G85< ?5@54 4><5=><: AB@>:8 157
    // ACDD8:A0 (�.telegram.org� A G5<-B> ?5@54 =8<) =5 ?@>E>4OB.
    if (/^https:\/\/[\w-]+\.telegram\.org$/.test(origin)) return true;
    if (/^https:\/\/[\w-]+\.t\.me$/.test(origin)) return true;
    
    return false;
}

// 5=5@0B>@ nonce 4;O CSP
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('hex');
    next();
});

// B40G0 index.html A ?>4AB0=>2:>9 {{nonce}} (H01;>= :MH8@C5< 2 ?0<OB8)
const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtmlTemplate = null;

// 5@A8O AB0B8:8 4;O :MH-10AB8=30 (?v=...): AG8B05BAO ?> ! # game.js,
// styles.css 8 shared/equipment.js. shared/equipment.js >1O70B5;5= 2 A?8A:5 
// 8=0G5 ?@02:0 >1I8E ?@028; M:8?8@>2:8 =5 A1@>A8B :MH C :;85=B0, 8 1@0C75@
// 4>AB0=5B AB0@CN :>?8N (C AB0B8:8 Cache-Control 1 G0A).
//
// !, + : 25@A8O AG8B0;0AL  @07 ?@8 AB0@B5 A5@25@0 8 =8:>340 =5
// ?5@5AG8BK20;0AL. >A;5 ?@02:8 CSS 8;8 game.js 157 ?5@570?CA:0 ?@>F5AA0
// assetVersion >AB020;AO AB0@K< -> URL ?v= A> AB0@K< EMH5< -> 1@0C75@
// ?>;G0A0-G0A >B4020; 70:MH8@>20==CN AB0@CN :>?8N, 8 ?@02:8 �=5 ?>O2;O;8AL�.
//
// "5?5@L ?@8 :064>9 >B40G5 index.html A25@O5< mtime D09;>2 (statSync, =5
// GB5=85) 8 ?5@5AG8BK205< EMH B>;L:> ?@8 @50;L=>< 87<5=5=88. 03@C7:0 
// B@8 statSync =0 70?@>A HTML, A0< EMH AG8B05BAO B>;L:> ?>A;5 ?@02:8.
const ASSET_FILES = ['game.js', 'styles.css', 'shared/equipment.js'];

// 0: G0AB> A25@OBL mtime D09;>2 (<A). :=> :MH0 25@A88: A<. getAssetVersion.
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
            // 0I8B0 >B =50B><0@=>9 70?8A8: ?@8 45?;>5 �2 <5AB5� (cp/git pull
            // 157 rename) mtime <>65B >1=>28BLAO =0 G0AB8G=> 70?8A0==>< D09;5.
            // "0:>9 EMH C5E0; 1K :;85=B0< :0: ?v=, 8 1@0C75@ 70:MH8@>20; 1K
            // =0 G0A >1@570==K9 game.js.
            // @>25@O5< @07<5@: stat.size G8B05BAO  GB5=8O, B0: GB> ?@8
            // A>2?045=88 A>45@68<>5 ;81> 1K;> AB018;L=K<, ;81> 4>?8A0=> ?>A;5
            // GB5=8O  => mtime B>340 B>65 AB0; 1K 1>;LH5 70?8A0==>3>.
            if (content.length !== Number(stat.size)) {
                throw new Error(`${file}: @07<5@ 87<5=8;AO 2> 2@5<O GB5=8O (${content.length} != ${stat.size})`);
            }
            hash.update(content);
            mtimes.set(file, Number(stat.mtimeMs) || Number(stat.mtime) || 0);
        }

        assetVersion = hash.digest('hex').slice(0, 10);
        assetMtimes = mtimes;
    } catch (e) {
        // 5 A<>3;8 ?@>G8B0BL D09;K. 25 25I8, :>B>@KE 745AL 1KBL  4>;6=>:
        //
        // 1.  >1=C;OBL assetMtimes.  0=LH5 745AL AB>O;>
        //    `assetMtimes = new Map()`, 8 ?@8 =54>ABC?=>< D09;5 ?@>25@:0
        //    `assetMtimes.get(file) !== mtime` A=>20 >:07K20;0AL 8AB8==>9 
        //    ?5@5AGQB =0 :064K9 HTML-70?@>A, 0 :064K9 ?5@5AGQB 4020; =>2K9
        //    timestamp. B>3: 15A:>=5G=K9 cache-busting (?v= <5=O;AO =0 :064>9
        //    >B40G5), :;85=B ?5@5:0G820; game.js + styles.css =0 :064K9 2E>4
        //    8 D;CH8; logger.warn.
        // 2. Timestamp-fallback B>;L:> A backoff: 157 cooldown >4=0
        //    =570?8A0==0O ?@02:0 >7=0G0;0 1K =>2K9 ?v= ?>AB>O==>.
        const now = Date.now();
        if (now - lastAssetFallbackAt >= ASSET_CHECK_INTERVAL_MS) {
            lastAssetFallbackAt = now;
            assetVersion = Date.now().toString(36);
            logger.warn('[index] 5 C40;>AL 2KG8A;8BL 25@A8N AB0B8:8, 8A?>;L7CN timestamp:', e.message);
        }
        // assetMtimes 8 assetVersion A>E@0=O5<  ?>:0 >B40Q< ?>A;54=NN @01>GCN 25@A8N.
    }
}

computeAssetVersion();

/**
 * 5@A8O AB0B8:8 A ?@>25@:>9 87<5=5=89 D09;>2.
 *
 * TTL-:MH: statSync  G0I5 @070 2 ASSET_CHECK_INTERVAL_MS. @8G8=0  sendIndexHtml
 * @01>B05B 8 :0: SPA-fallback 4;O ;N1>3> GET A Accept: text/html, B> 5ABL
 * G5@57 =53> 84CB 1>BK, ?@52LN-AAK;:8 Telegram 8 ?5@5703@C7:8; A8=E@>==K9
 * statSync 2 >1@01>BG8:5 :064>3> B0:>3> 70?@>A0 1;>:8@>20; 1K event loop.
 * :=> 2 2 A5:C=4K =5 <5H05B @07@01>B:5: ?@02:C 284=> A@07C ?>A;5 Ctrl+F5,
 * 0 A;CG09=K9 ;8H=89 stat ?@8 G0AB>< D;045 =52>7<>65=.
 *
 * @returns {string} EMH AB0B8:8
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
        // $09; 2@5<5==> =54>ABC?5= (?@02:0/?5@5<5I5=85)  >B40Q< B>, GB> 5ABL.
        // !;54CNI89 70?@>A ?5@5AG8B05B.
    }
    return assetVersion;
}

function sendIndexHtml(res) {
    try {
        if (indexHtmlTemplate === null) {
            indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        // no-store: nonce >4=>@07>2K9, AB@0=8FC =5;L7O 1@0BL 87 :MH0/?> 304 (8=0G5
        // 2 DOM >AB0=5BAO AB0@K9 nonce, 0 CSP ?@84QB A =>2K<  A:@8?BK 701;>:8@CNBAO)
        res.set('Cache-Control', 'no-store');
        res.send(indexHtmlTemplate
            .replace(/\{\{nonce\}\}/g, res.locals.nonce || '')
            .replace(/\{\{assetVersion\}\}/g, getAssetVersion())
            // DEV-D;03 02B>@870F88 4;O :;85=B0. ;85=B ?> =5<C @5H05B,
            // 4>?CAB8< ;8 D8:B82=K9 telegram_id/initData. $;03 AB028BAO
            // ", ?> O2=><C DEV_MODE=true  2 production (345 NODE_ENV
            // G0AB> =5 7040=, =0?@. =0 BotHost) ?>4AB0=>2:0 2AQ @02=> 'false'.
            .replace(/\{\{devMode\}\}/g, DEV_MODE ? 'true' : 'false'));
    } catch (e) {
        logger.error('[index] 5 C40;>AL >B40BL index.html:', e.message);
        res.status(500).send('H81:0 703@C7:8 ?@8;>65=8O. 1=>28B5 AB@0=8FC.');
    }
}

// "09<0CB 4;O 2A5E 70?@>A>2 - 70I8B0 >B 7028A0=89
app.use((req, res, next) => {
    res.setTimeout(15000, () => {
        logger.error(`[TIMEOUT] 0?@>A ?@52KA8; 2@5<O >6840=8O: ${req.method} ${req.path}`);
        if (!res.headersSent) {
            res.status(503).json({
                success: false,
                error: '!5@25@ 2@5<5==> 70=OB. >?@>1C9B5 ?>765.',
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
            // script-src-attr: 'none', 0 =5 nonce.
            //
            // Nonce 745AL =5 8<5; A<KA;0: >= @07@5H05B M;5<5=B <script nonce>,
            // =>  @07@5H05B inline->1@01>BG8:8 2840 onclick="...". !B028BL
            // 'unsafe-inline' 2 script-src-attr  MB> :0: @07 B>, G53> <K
            // 4>18205<AO (XSS G5@57 >1@01>BG8: =5 ?@>E>48B), 0 AB028BL
            // 'none' 7=0G8B 70?@5B8BL 8E ?>;=>ABLN.
            //
            // @>25@5=>: 2 public/index.html =5B =8 >4=>3> on*= 0B@81CB0,
            // 0 548=AB25==K9 onclick= 2 public/game.js  B5:AB 2=CB@8
            // :><<5=B0@8O > B><, GB> CSP 8E 1;>:8@C5B. 3@0 @01>B05B G5@57
            // addEventListener, ?>MB><C 'none' =8G53> =5 ;><05B.
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
    message: { error: 'API ;8<8B ?@52KH5=' },
    keyGenerator: getRateLimitKey
});

const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: '!;8H:>< <=>3> 70?@>A>2' }
});

app.use('/api', apiLimiter);
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        return jsonParser(req, res, (err) => {
            if (err) {
                logger.error('[JSON PARSER ERROR]', err.message);
                return res.status(400).json({ error: '525@=K9 JSON' });
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
        return res.status(403).json({ error: 'Origin =5 @07@5HQ=', origin });
    }
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    // X-Telegram-ID C1@0=: 703>;>2>: ?@8E>48B >B :;85=B0 8 1>;LH5 =8345
    // =5 G8B05BAO.  07@5H0BL 53> 2 CORS =570G5<, 0 53> ?@8ACBAB285
    // ?@>2>F8@>20;> :;85=B>2 53> A;0BL.
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Init-Data');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

/**
 * Middleware: 83@>2K5 <0@H@CBK =5 @01>B0NB, ?>:0 =5 3>B>20 .
 *
 * !B028BAO ?5@54 /api/game, /api/admin 8 /api/leaderboard  2A5<, GB> E>48B
 * 2 107C. /health, /ready 8 :>@=520O AB@0=8F0 A<>=B8@>20=K 157 =53>:
 * ?@>25@:0 682>AB8 8 703@C7:0 UI =5 4>;6=K 7028A5BL >B 107K.
 */
function requireDatabaseReady(req, res, next) {
    if (isDatabaseReady) return next();
    return res.status(503).json({
        success: false,
        error: '3@0 70?CA:05BAO, ?>?@>1C9B5 G5@57 =5A:>;L:> A5:C=4',
        code: 'SERVICE_STARTING'
    });
}

//  >CB5@K
// idempotencyMiddleware 745AL 1K; 15A?>;575=: >= AB>O;  validatePlayer,
// req.player 5IQ =5 70?>;=5=, 8 middleware 2A5340 CE>48; 2 next().
// 5@5=5AQ= 2 routes/game/index.js  A@07C ?>A;5 validatePlayer.
app.use('/api/game', requireDatabaseReady, gameRouter);
app.use('/api/admin', requireDatabaseReady, adminRouter);
// C1;8G=K9 @59B8=3: /api/leaderboard/* -> 83@>2>9 @>CB5@.
//
//  ?@> req.url: 2=CB@8 >1@01>BG8:0 Express C65 A=O; ?@5D8:A <>=B8@>20=8O,
// B> 5ABL 4;O 70?@>A0 /api/leaderboard/players 745AL req.url === '/players'.
//  0=LH5 :>4 45;0; req.url = '/minigames' + req.url, ?>;CG0O '/minigames/players',
// 0 2 minigames.js 70@538AB@8@>20= '/leaderboard/players'. !>2?045=8O =5
// ?@>8AE>48;> -> 2A5 >1@0I5=8O : @59B8=3C CE>48;8 2 404 Not found.
// C65= ?>;=K9 2=CB@5==89 ?CBL: '/minigames/leaderboard' + >AB0B>:.
app.use('/api/leaderboard', requireDatabaseReady, (req, res, next) => {
    req.url = '/minigames/leaderboard' + req.url;
    gameRouter(req, res, next);
});

// ;02=0O AB@0=8F0: index.html G5@57 H01;>= (?>4AB0=>2:0 nonce 4;O CSP)
app.get(['/', '/index.html'], (req, res) => sendIndexHtml(res));

// !B0B8:0 (index: false  index.html >B40QB B>;L:> sendIndexHtml)
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

// /ready >B25G05B 503, ?>:0  =5 3>B>20. <5==> =0 MB>B M=4?>8=B
// A<>B@OB 10;0=A8@>2I8:8 8 >@:5AB@0B>@K: 200 >7=0G05B �<>6=> A;0BL
// B@0D8:�, ?>MB><C 4> 3>B>2=>AB8  >B25G0BL 200 =5;L7O. =CB@8
// 4>?>;=8B5;L=> ?@>25@O5< A>548=5=85  D;03 <>3 1KBL A=OB, 0 ?C;
// ?>A;5 MB>3> C?0;.
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

// 5B@8:8 A5@25@0 (B>;L:> 4;O 04<8=>2)
app.get('/metrics', telegramAuthMiddleware, (req, res) => {
    // Guard: ?@8 TG_BOT_TOKEN =5 7040==>< 8 NODE_ENV !== 'production'
    // telegramAuthMiddleware CE>48B 2 next()  CAB0=>2:8 req.telegramUser
    // (utils/serverApi.js:536-543). !, + 500: String(req.telegramUser.id)
    // =0 undefined 1@>A0; TypeError 2<5AB> 401.  .env NODE_ENV =5 7040=, 0 2
    // logs/combined.log 1K;8 70?8A8 hasBotToken:false  A8BC0F8O @50;L=0O.
    if (!req.telegramUser) {
        return res.status(401).json({ error: '"@51C5BAO 02B>@870F8O' });
    }

    const telegramId = String(req.telegramUser.id);
    
    if (!isAdmin(telegramId)) {
        logger.warn({ type: 'metrics_access_denied', telegramId, ip: req.ip });
        return res.status(403).json({ error: '>ABC? 70?@5IQ=' });
    }
    
    // 5B@8:8 HTTP-A;>O ?;NA <5B@8:8 ?;0=8@>2I8:0.
    //
    // !GQBG8:8 7040G ?;0=8@>2I8:0 (A:>;L:> @07 >B@01>B0;0 @535=5@0F8O
    // M=5@388, A:>;L:> @07 ?040; cleanup, A:>;L:> 4;8;0AL ?>A;54=OO
    // 7040G0) =0:0?;820;8AL 2 ?0<OB8, => =0@C6C =5 >B4020;8AL: ?>
    // /metrics 1K;> 284=> B>;L:> A>AB>O=85 HTTP-70?@>A>2. "5?5@L 284=>,
    // @01>B0NB ;8 D>=>2K5 7040G8  8=0G5 8E ?>;><:C <>6=> 70<5B8BL
    // ;8HL ?> :>A25==K< ?@87=0:0< 2 ;>30E.
    const metrics = getMetrics();
    res.json({
        ...metrics,
        scheduler: getSchedulerMetrics()
    });
});

// 404: 4;O 1@0C75@=KE ?5@5E>4>2 ?> A09BC >B40Q< index.html (SPA-fallback),
// GB>1K =8 >48= ?CBL =5 <>3 25@=CBL 404 ?@8 703@C7:5 83@K.
// ;O API 8 ?@>G53>  JSON 404.
app.use((req, res) => {
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && !req.path.startsWith('/api') && accept.includes('text/html') && !/\.[a-zA-Z0-9]+$/.test(req.path)) {
        return sendIndexHtml(res);
    }
    res.status(404).json({ error: 'Not found' });
});

// ;>10;L=K9 >1@01>BG8: >H81>:
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
    logger.info(`>;CG5= A83=0; ${signal}. 025@H05< A5@25@...`);
    
    if (isShuttingDown) {
        logger.warn('@>F5AA 7025@H5=8O C65 70?CI5=');
        return;
    }
    isShuttingDown = true;

    // ;0=8@>2I8: >AB0=02;8205< ! # 8  70:@KB8O ?C;0.
    //
    //  0=LH5 MB>3> 2K7>20 =5 1K;>: stopScheduler() M:A?>@B8@>20;AO, =>
    // 53> =8:B> =5 720;. 040G8 ?> @0A?8A0=8N ?@>25@ONB schedulerEnabled
    // ?5@54 :064K< 70?CA:><, 8 157 2K7>20 =>20O 7040G0 <>3;0 AB0@B>20BL
    // C65 ?>A;5 server.close() 8 C9B8 2 70:@K20NI89AO ?C;  2 ;>3
    // ?040;0 1K >H81:0 70:@KB8O A>548=5=8O.
    //
    // stopScheduler =5 ?@5@K205B 7040GC, :>B>@0O C65 2K?>;=O5BAO, 
    // >=0 7025@H8BAO =0 B5:CI5< ?C;5. > =>2KE 70?CA:>2 =5 1C45B.
    try {
        stopScheduler();
    } catch (err) {
        logger.warn('H81:0 >AB0=>2:8 ?;0=8@>2I8:0:', err.message);
    }

    try {
        if (bot && typeof bot.stop === 'function') {
            bot.stop(signal);
            logger.info('Telegram bot polling >AB0=>2;5=');
        }
    } catch (err) {
        logger.warn('H81:0 >AB0=>2:8 Telegram bot:', err.message);
    }
    
    if (server) {
        server.closeAllConnections();
        server.close(async () => {
            logger.info('HTTP A5@25@ >AB0=>2;5=');
            try {
                await closePool();
                logger.info('>4:;NG5=85 :  70:@KB>');
            } catch (err) {
                logger.error('H81:0 70:@KB8O :', err);
            }
            // process.exitCode 70@0=55 2KAB02;5= ?@8 020@89=>< 7025@H5=88
            // ( =54>ABC?=0, fatal->H81:0) - :>4 1 3>2>@8B ?;0BD>@<5 > A1>5.
            process.exit(process.exitCode || 0);
        });
        setTimeout(() => {
            logger.error('Graceful shutdown =5 7025@H8;AO, ?@8=C48B5;L=K9 exit');
            process.exit(1);
        }, 10000);
    } else {
        logger.warn('SIGTERM ?>;CG5= 4> AB0@B0 A5@25@0');
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
            logger.info(`!5@25@ 70?CI5= =0 ?>@BC ${port}`);
            resolve(srv);
        });
        srv.on('error', reject);
    });
}

/**
 * @>25@:0 >1O70B5;L=>9 :>=D83C@0F88 ?@8 AB0@B5.
 *
 * 5 @>=O5B ?@>F5AA (:@><5 :@8B8G=KE A;CG052)  insecure-A>AB>O=8O ;>38@CNBAO
 * 3@><:>, GB>1K dev C2845; 8E ?@8 @5AB0@B5, 0 =5 A?CABO G0AK >B;04:8.
 *
 * @returns {{problems: string[], warnings: string[]}}
 */
async function validateStartupConfig() {
    const problems = [];
    const warnings = [];

    // TG_BOT_TOKEN: 157 =53> 2 NODE_ENV !== 'production'
    // telegramAuthMiddleware CE>48B 2 next()  req.telegramUser (A<. #17).
    if (!process.env.TG_BOT_TOKEN) {
        if (process.env.NODE_ENV === 'production') {
            problems.push('TG_BOT_TOKEN =5 7040= 2 production: 02B>@870F8O 1C45B >B25G0BL 500.');
        } else {
            warnings.push('TG_BOT_TOKEN =5 7040=: 02B>@870F8O ?@>?CA:05BAO (dev-@568<). /metrics 8 04<8=:0 >B25BOB 401 2<5AB> ?>;57=>3> >B25B0.');
        }
    }

    // ADMIN_IDS: ?CAB>9 A?8A>: = 2A5 /api/admin/* <>;G0 403.
    if (getAdminIds().length === 0) {
        warnings.push('ADMIN_IDS ?CAB: 2A5 /api/admin/* 1C4CB >B25G0BL 403. @>25@L .env.');
    }

    // NODE_ENV: >B =53> 7028AOB security-@5H5=8O 2 utils/serverApi.js
    // (fail-closed auth) 8 C@>25=L ;>38@>20=8O.
    if (!process.env.NODE_ENV) {
        warnings.push("NODE_ENV =5 7040= (>68405BAO 'production' 8;8 'development').");
    }

    // 070 40==KE: DATABASE_URL G8B05B db/database.js
    if (!process.env.DATABASE_URL) {
        warnings.push('DATABASE_URL =5 7040= 2 env  8A?>;L7C5BAO 7=0G5=85 ?> C<>;G0=8N 87 db/database.js.');
    }

    for (const w of warnings) logger.warn({ type: 'startup_config_warning', message: w });

    if (problems.length > 0) {
        for (const p of problems) logger.error({ type: 'startup_config_error', message: p });
        // @8B8G=K5 ?@>1;5<K :>=D83C@0F88  =5 AB0@BC5<: <>;G0 682>9 A5@25@
        // 157 02B>@870F88 >?0A=55, G5< C?02H89 ?@>F5AA, :>B>@K9 ?5@570?CAB8BAO.
        process.exitCode = 1;
        await handleFatalRuntimeError('startup_config_invalid', { problems });
        return { problems, warnings };
    }

    return { problems, warnings };
}

async function startServer() {
    setLogger(logger);

    // @><:0O ?@>25@:0 :>=D83C@0F88 ?@8 AB0@B5.
    //
    // !, + "%/ : ADMIN_IDS ?0@A8;AO (AB@>:0 18) 8 =8:0: =5
    // ?@>25@O;AO. @8 ?CAB>< 7=0G5=88 ! /api/admin/* <>;G0 >B25G0NB 403 4065
    // ;538B8<=><C 04<8=C, 0 ?@54C?@5645=8O =5B  2K3;O48B :0: �4>ABC? 70?@5IQ=
    // A5@25@><�.  ?@>25@5==>< .env NODE_ENV 8 ADMIN_IDS =5 7040=K 2>2A5.
    // >?CB=> ADMIN_IDS D8:A8@C5BAO 745AL, 0 routes/admin.js:50 ?0@A8B env
    // 70=>2> =0 :064K9 70?@>A  :>?88 <>3CB @07>9B8AL (dev ?5@5CAB0=>28; env
    // <564C @5AB0@B>< 8 70?@>A><).
    await validateStartupConfig();

    // HTTP-A5@25@ AB0@BC5B  +. 0 reverse-?@>:A8 Bothost ?@8;>65=85
    // >1O70=> A;CH0BL ?>@B :0: <>6=> @0=LH5: ?>:0 ?>@B =5 >B:@KB,
    // ?@>:A8 >B25G05B "404 page not found" =0 2A5 70?@>AK.
    // /1>B/?;0=8@>2I8: 8=8F80;878@CNBAO 2 D>=5 8 =5 <>3CB 701;>:8@>20BL listen.
    try {
        server = await startHttpServer(PORT);
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            // 5;L7O <>;G0 ?5@55760BL =0 PORT+1 70 ?@>:A8:
            // ?@>:A8 ?@>4>;68B A;0BL B@0D8: =0 8AE>4=K9 ?>@B -> 25G=K9 404.
            logger.error({
                type: 'port_in_use',
                message: `>@B ${PORT} 70=OB 4@C38< ?@>F5AA><. 025@H05<AO  ?;0BD>@<0 ?5@570?CAB8B :>=B59=5@.`
            });
        } else {
            logger.error({ type: 'server_error', message: err.message });
        }
        process.exit(1);
        return;
    }

    //  <>65B 1KBL 2@5<5==> =54>ABC?=0 ?@8 AB0@B5 (DNS, A5BL, E>;>4=K9
    // AB0@B Supabase)  ?>2B>@O5< ?>4:;NG5=85, ?@5645 G5< @01>B0BL 157 .
const DB_INIT_ATTEMPTS = 3;
const DB_INIT_RETRY_DELAY_MS = 5000;
    let databaseInitialized = false;
    for (let attempt = 1; attempt <= DB_INIT_ATTEMPTS; attempt++) {
        try {
            await initDatabase();
            logger.info('070 40==KE 8=8F80;878@>20=0');
            databaseInitialized = true;
            
            // =8F80;878@C5< :MH ;CB0 ?>A;5 CA?5H=>3> ?>4:;NG5=8O : 
            try {
                const { init: initLootCache } = require('./utils/lootCache');
                await initLootCache();
                logger.info('MH ;CB0 8=8F80;878@>20=');
            } catch (lootError) {
                logger.error(`H81:0 8=8F80;870F88 :MH0 ;CB0 (?@>4>;605<): ${describeError(lootError)}`);
            }
            
            break;
        } catch (dbError) {
            logger.error(`H81:0 8=8F80;870F88  (?>?KB:0 ${attempt}/${DB_INIT_ATTEMPTS}), ?@>4>;605< 157 : ${describeError(dbError)}`);
            if (attempt < DB_INIT_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, DB_INIT_RETRY_DELAY_MS));
            }
        }
    }

    // $;03 A=8<05BAO ", ?>A;5 CA?5E0. A;8 2A5 ?>?KB:8 ?@>20;8;8AL,
    // isDatabaseReady >AB0QBAO false 8 requireDatabaseReady >B40QB 503 =0
    // 83@>2K5 <0@H@CBK  2<5AB> 500 87 :064>3> M=4?>8=B0.  0=LH5 2 MB><
    // A>AB>O=88 A5@25@ ?@>AB> ?@>4>;60; @01>BC 8 ?040; 2 :064>< E5=4;5@5
    // >B45;L=>; B5?5@L ?@8G8=0 284=0 A@07C 8 2 ;>30E, 8 83@>:C.
    isDatabaseReady = databaseInitialized;
    if (!isDatabaseReady) {
        // !, +  /: ?>A;5 2A5E =5C40G=KE ?>?KB>: ?@>F5AA ?@>4>;60;
        // 68BL. `/` (index.html) 8 `/health` >B25G0NB 200  ?@>1=8: BotHost
        // 2848B 74>@>2L5 8  ?5@570?CA:05B :>=B59=5@. A5 /api/game/* >B40NB
        // 503 SERVICE_STARTING 4> @CG=>3> @5AB0@B0, 0 isDatabaseReady =5
        // ?5@5AG8BK205BAO =8:>340. 3@0 <5@B20, => 2K3;O48B 682>9.
        //
        // "5?5@L ?0405<: ?;0BD>@<0 ?5@570?CAB8B :>=B59=5@ 8 40AB =>2>5 >:=> =0
        // . B:;NG05BAO O2=> (EXIT_ON_DB_FAIL=false) 4;O @CG=>3> 451030.
        logger.error({
            type: 'database_unavailable',
            message: ` =54>ABC?=0 ?>A;5 ${DB_INIT_ATTEMPTS} ?>?KB>:. 3@>2K5 <0@H@CBK >B25G0NB 503 4> ?5@570?CA:0 ?@>F5AA0.`
        });

        // A5340 7025@H05< ?@>F5AA ?@8 =54>ABC?=>AB8 : 8=0G5 healthcheck 2848B
        // 200 =0 / 8 =5 ?5@570?CA:05B :>=B59=5@, 0 83@0 >B25G05B 503 25G=>.
        // EXIT_ON_DB_FAIL=false >AB02;5= 4;O >1@0B=>9 A>2<5AB8<>AB8, => =5
        // ?@54>B2@0I05B 7025@H5=85  8=0G5 A5@25@ 70AB@5205B 2 7><18-A>AB>O=88.
        process.exitCode = 1;
        await handleFatalRuntimeError('database_unavailable', { attempts: DB_INIT_ATTEMPTS });
    }

    try {
        await initAchievementsTable();
        logger.info('"01;8F0 4>AB865=89 8=8F80;878@>20=0');
    } catch (achError) {
        logger.error(`H81:0 8=8F80;870F88 B01;8FK 4>AB865=89 (?@>4>;605<): ${describeError(achError)}`);
    }

    // setupWebhook 64QB >B25B0 api.telegram.org 157 B09<0CB0.
    // 028AH89 70?@>A 745AL @0=LH5 1;>:8@>20; app.listen -> 404 =0 25AL A09B.
    // 3@0=8G8205< >6840=85 20 A5:C=40<8: A1>9 1>B0 =5 2;8O5B =0 @01>BC A09B0.
    // "09<5@ >1O70B5;L=> >G8I05< 8=0G5, 4065 ?@8 <3=>25==>9 =0AB@>9:5 1>B0,
    // G5@57 20 A5:C=4 ?5G0B0;AO ;>6=K9 warn �?@52KA8;0 20 A5:C=4�.
    let botTimeout;
    await Promise.race([
        setupWebhook(app).then(
            () => logger.info('Webhook =0AB@>5='),
            (botError) => logger.error('H81:0 =0AB@>9:8 1>B0 (A5@25@ @01>B05B): ' + describeError(botError))
        ),
        new Promise((resolve) => {
            botTimeout = setTimeout(() => {
                logger.warn('0AB@>9:0 1>B0 ?@52KA8;0 20 A5:C=4  ?@>?CA:05<');
                resolve();
            }, 20000);
        })
    ]);
    clearTimeout(botTimeout);

    try {
        startScheduler();
    } catch (schedError) {
        logger.error('H81:0 70?CA:0 ?;0=8@>2I8:0:', schedError.message);
    }
}

// 0?CA:05< A5@25@ ", ?@8 ?@O<>< 70?CA:5 (node index.js).
// >340 index.js require'8BAO 872=5 (?@>25@:0 703@C7:8 <>4C;59 2 entrypoint
// wrapper'5), main() =5 4>;65= 2K?>;=OBLAO: 8=0G5 require-?@>25@:0 70=8<05B
// ?>@B, 0 @50;L=K9 M:75<?;O@ 4>G5@=53> ?@>F5AA0 ?0405B A EADDRINUSE.
if (require.main === module) {
    startServer();
}