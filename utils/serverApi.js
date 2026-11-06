/**
 * 1J548=Q==K9 <>4C;L A5@25@=KE CB8;8B 4;O Last Hearth
 * 1J548=O5B: 20;840F8N, >B25BK API, B@0=70:F88, ;>38@>20=85, >1@01>B:C >H81>:, Telegram 02B>@870F8N
 */

const crypto = require('crypto');
const { transaction } = require('../db/database');
const { randomUUID } = crypto;
const { recordRequest } = require('./metrics');

// >38@>20=85 2K=5A5=> 2 utils/log.js, GB>1K @07>@20BL F8:;
// db/players.js -> utils/serverApi.js -> db/players.js.
// "5?5@L db/players.js 8<?>@B8@C5B ;>38@>20=85 >BBC40 65, 0 serverApi
// ?5@58A?>;L7C5B B>B 65 M:75<?;O@  4C1;8@>20=8O ;>335@0 =5 2>7=8:05B.
//
// <?>@B8@CNBAO @>2=> B5, GB> =C6=K 2 B5;5 D09;0  2 @5M:A?>@B5 =865:
// 6 @>CB>2 (clans, debuffs, items, player, status, pvp) 15@CB
// logPlayerAction/handleLogError 87 serverApi  @5M:A?>@B 4;O =8E >1O70B5;5=,
// ?>:0 2A5 ?>B@518B5;8 =5 ?5@52545=K =0 ?@O<>9 8<?>@B 87 utils/log.js.
const { logger, logPlayerAction, logPlayerError, serializeJSONField } = require('./log');
// 0;840F8O ID 682QB 2 >B45;L=>< D09;5: utils/validate.js =5 7028A8B
// =8 >B G53>, ?>MB><C 53> <>6=> 8<?>@B8@>20BL 8 745AL, 8 87 db/players.js
// (serverApi =5;L7O  >B =53> 7028A8B players, ?>;CG8;AO 1K F8:;).
const { validateId } = require('./validate');

const ERROR_MESSAGES = Object.freeze({
    INSUFFICIENT_COINS: '54>AB0B>G=> <>=5B',
    INSUFFICIENT_STARS: '54>AB0B>G=> 72Q74',
    INSUFFICIENT_ENERGY: '54>AB0B>G=> M=5@388',
    INSUFFICIENT_HEALTH: '54>AB0B>G=> 74>@>2LO'
});

/**
 * >;CG8BL 83@>:0 ?> Telegram ID
 */

/**
 * @>25@8BL 8 C25;8G8BL ;8<8B 70?@>A>2 4;O 845=B8D8:0B>@0 (IP 8;8 playerId).
 * A?>;L7C5B  2<5AB> in-memory Map 4;O @01>BK 2 :;0AB5@5.
 * 
 * @param {string} identifier - IP 8;8 playerId
 * @param {number} maxRequests - <0:A8<C< 70?@>A>2 2 >:=5
 * @param {number} windowMs - >:=> 2 <8;;8A5:C=40E
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkRateLimit(identifier, maxRequests = 1000, windowMs = 60000) {
    try {
        const { query, transaction } = require('../db/database');
        
        const windowStart = new Date(Date.now() - windowMs);
        
        // #40;O5< AB0@K5 70?8A8 (cleanup)
        await query(
            `DELETE FROM rate_limits WHERE window_start < $1`,
            [windowStart]
        );
        
        // >;CG05< 8;8 A>740Q< 70?8AL 4;O B5:CI53> >:=0
        const result = await transaction(async (client) => {
            const existing = await client.query(
                `SELECT request_count, window_start FROM rate_limits 
                 WHERE identifier = $1 AND window_start >= $2
                 ORDER BY window_start DESC LIMIT 1`,
                [identifier, windowStart]
            );
            
            if (existing.rows[0]) {
                const newCount = existing.rows[0].request_count + 1;
                await client.query(
                    `UPDATE rate_limits SET request_count = $1 WHERE identifier = $2 AND window_start = $3`,
                    [newCount, identifier, existing.rows[0].window_start]
                );
                return { count: newCount, windowStart: existing.rows[0].window_start };
            } else {
                const insertResult = await client.query(
                    `INSERT INTO rate_limits (identifier, window_start, request_count)
                     VALUES ($1, NOW(), 1)
                     RETURNING window_start`,
                    [identifier]
                );
                return { count: 1, windowStart: insertResult.rows[0].window_start };
            }
        });
        
        const allowed = result.count <= maxRequests;
        const remaining = Math.max(0, maxRequests - result.count);
        const resetAt = new Date(result.windowStart).getTime() + windowMs;
        
        return { allowed, remaining, resetAt };
    } catch (err) {
        // @8 >H81:5  1;>:8@C5< 70?@>A (fail-closed): 8=0G5 ?@8 =54>ABC?=>AB8
        //  7;>C<KH;5==8: <>65B >1>9B8 rate-limit, 2K7202 =5>3@0=8G5==>5 G8A;>
        // 70?@>A>2 =0 /auth. >38@C5< >H81:C 8 2>72@0I05< 429 G5@57 2K7K20NI89 :>4.
        logger.error('[rateLimit] check failed, denying request', { error: err.message, identifier });
        return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs };
    }
}

/**
 * Middleware 4;O rate limiting =0 >A=>25 .
 *
 * !, +  "+ -! ": ACI5AB2>20;0 DC=:F8O createRateLimitMiddleware
 * (?@8<5@=> 25 AB@>:), :>B>@0O =8 @07C =5 1K;0 2K720=0  2>>1I5 =8345.
 *  50;L=K9 rate-limit 84QB 42C<O ?CBO<8: ?@O<>9 2K7>2 checkRateLimit 2=CB@8
 * telegramAuthMiddleware (serverApi.js:529) 8 A>740=8O ;8<8B5@>2 express-rate-limit
 * 2 routes/game/index.js. #40;5=> 2<5AB5 A :><<5=B0@85<->?8A0=85<, ?>B><C GB>
 * =570<5B=0O 0;LB5@=0B820 <0A:8@>20;0 548=AB25==K9 682>9 ?CBL 8 ;><0;0AL 1K
 * ?@8 @5D0:B>@5 checkRateLimit.
 */

// 0AB@>9:0 ;>335@0 (48@5:B>@8O ;>3>2, D>@<0BK, B@0=A?>@BK, >1@01>BG8:
// >H81>: A0<>3> ;>335@0) ?5@55E0;0 2 utils/log.js 2<5AB5 A
// logPlayerAction/logPlayerError/serializeJSONField/handleLogError.
// 45AL >=8 8<?>@B8@>20=K >BBC40, ?>MB><C 4C1;8:0B>2 =5B.

/**
 * !0=8B097 GC2AB28B5;L=KE 40==KE 2 ;>30E
 */
function sanitize(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return '[Circular]';

    const sensitive = ['password', 'token', 'authorization', 'secret', 'api_key', 'apikey', 'init_data', 'init-data', 'x-init-data', 'x-telegram-init-data'];
    const clone = Array.isArray(obj) ? [] : {};
    seen.add(obj);

    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (sensitive.includes(key.toLowerCase())) {
            clone[key] = '***';
        } else if (typeof value === 'object' && value !== null) {
            clone[key] = sanitize(value, seen);
        } else {
            clone[key] = value;
        }
    }
    return clone;
}

/**
 * 45=B8D8:0B>@ :;85=B0 4;O rate-limit 8 ;>3>2.
 *
 * : 703>;>2>: x-telegram-id  CG8BK205BAO. = ?@8E>48B >B :;85=B0
 * 8 ?>445;K205BAO >4=8< curl, 87-70 G53> ;8<8BK >1E>48;8AL ?5@51>@><
 * 7=0G5=89 703>;>2:0.
 *
 * getTelegramIdFromHeaders ?0@A8B initData  ?@>25@:8 ?>4?8A8 
 * 8A?>;L7C5BAO ", 4;O >B>1@065=8O playerId 2 ;>30E (A D>;1M:><
 * 'anonymous').  5H5=8O > 4>ABC?5  ?@8=8<0NBAO =0 >A=>25 MB>3>
 * 7=0G5=8O; 02B>@870F8O  2 telegramAuthMiddleware G5@57
 * validateTelegramInitData.
 */
function getTelegramIdFromHeaders(headers = {}) {
    const initData = headers['x-telegram-init-data'] || headers['x-init-data'];
    if (!initData || typeof initData !== 'string') {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? String(user.id) : null;
    } catch (e) {
        logger.warn('H81:0 ?0@A8=30 initData 2 getTelegramIdFromHeaders:', e.message);
        return null;
    }
}

/**
 * Middleware 4;O 02B><0B8G5A:>3> ;>38@>20=8O HTTP 70?@>A>2
 */
function requestMiddleware(req, res, next) {
    req.requestId = randomUUID();
    const start = Date.now();

    res.on('finish', () => {
        try {
            const duration = Date.now() - start;
            const isProd = process.env.NODE_ENV === 'production';

            // @O<>9 8<?>@B =025@EC D09;0: metrics.js =5 BO=5B serverApi,
            // ?>MB><C F8:;8G5A:>9 7028A8<>AB8 1>;LH5 =5B.
            try {
                // req.path  query-AB@>:8. !, + #"': A req.originalUrl
                // :;NG <5B@8:8 2:;NG0; query (?v=..., boss_id=...), 0 byEndpoint 
                // plain object 157 LRU/TTL. 064K9 C=8:0;L=K9 URL (:MH-10AB8=3,
                // 1>BK A @07=K<8 query) A>74020; 70?8AL ! 2 ?0<OB8
                // ?@>F5AA0 8 @074C20; >B25B GET /metrics.
                recordRequest(req.path || req.url || 'unknown', res.statusCode, duration);
            } catch {
                // <5B@8:8 =5 4>;6=K ;><0BL >1@01>B:C 70?@>A0
            }

            const entry = {
                type: 'http_request',
                requestId: req.requestId,
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration,
                playerId: getTelegramIdFromHeaders(req.headers) || 'anonymous',
                ...(isProd ? {} : {
                    query: sanitize(req.query),
                    ip: req.ip,
                    userAgent: req.headers?.['user-agent']
                })
            };

            // !B0B8:0 (css/js/:0@B8=:8) 8 CA?5H=K5 GET-70?@>AK  @CB8==K9 HC<:
            // 2 combined.log 8E A>B=8 2 <8=CBC 8 >=8 B>?OB =0AB>OI85 A>1KB8O.
            // >=8605< 4> debug (284=> ?@8 LOG_LEVEL=debug), >H81:8 8 <CB0F88
            // >AB0NBAO =0 info/error.
            const path = req.originalUrl || req.url || '';
            const isStatic = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|mp[34])($|\?)/i.test(path);
            const isQuiet = isStatic || (req.method === 'GET' && res.statusCode < 400);

            if (!isQuiet) {
                logger.info(entry);
            } else {
                // winston A0< >BD8;LB@C5B ?> LOG_LEVEL (?> C<>;G0=8N info)
                logger.debug(entry);
            }
        } catch (e) {
            logger.error('Logging failed', { error: e.message });
        }
    });

    next();
}

/**
 * 0;840F8O ?>;>68B5;L=>3> F5;>3> ID ?@82>48BAO 2 utils/validate.js 
 * >B45;L=K9 D09; =C65= 87-70 ?>@O4:0 703@C7:8 <>4C;59: serverApi.js
 * ;5=82> (2=CB@8 DC=:F88) B@51C5B db/players.js, ?>MB><C players.js
 * 8<?>@B8@>20BL serverApi =5 <>65B  2>7=8: 1K F8:;.
 */

/**
 * G8AB:0 8<5=8 (trim, C40;5=85 A?5FA8<2>;>2)
 */
function sanitizeName(name, maxLength = 50) {
    const max = Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 50;
    if (name === undefined || name === null) {
        return { ok: false, valid: false, error: '"@51C5BAO 8<O', code: 'MISSING_FIELD' };
    }
    if (typeof name !== 'string') {
        return { ok: false, valid: false, error: '<O 4>;6=> 1KBL AB@>:>9', code: 'INVALID_TYPE' };
    }
    let sanitized = name.normalize('NFC').trim();
    sanitized = sanitized.replace(/[^\\w\\s\\u0430-\\u044f\\u0410-\\u042f\\u0451\\u0401]/g, '');
    sanitized = sanitized.replace(/\s+/g, ' ');
    if (sanitized.length === 0) {
        return { ok: false, valid: false, error: '<O =5 <>65B 1KBL ?CABK< ?>A;5 >G8AB:8', code: 'EMPTY_VALUE' };
    }
    if (sanitized.length > max) {
        return { ok: false, valid: false, error: `<O A;8H:>< 4;8==>5 (<0:A. ${max} A8<2>;>2)`, code: 'TOO_LONG', value: sanitized.substring(0, max) };
    }
    return { ok: true, valid: true, value: sanitized };
}

/**
 * #A?5H=K9 >B25B A 40==K<8
 */
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({ success: true, data });
}

/**
 * H81:0 70?@>A0 (:;85=BA:0O >H81:0)
 */
function fail(res, message, code = 'ERROR', statusCode = 400) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * =CB@5==OO >H81:0 A5@25@0
 */
function error(res, message, code = 'INTERNAL_ERROR', statusCode = 500) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 *  5AC@A =5 =0945= (404)
 */
function notFound(res, message = ' 5AC@A =5 =0945=', code = 'NOT_FOUND') {
    return res.status(404).json({ success: false, error: message, code });
}

/**
 * "@51C5BAO 02B>@870F8O (401)
 */
function unauthorized(res, message = '"@51C5BAO 02B>@870F8O', code = 'UNAUTHORIZED') {
    return res.status(401).json({ success: false, error: message, code });
}

/**
 * @>25@:0 02B>@870F88 83@>:0. A;8 83@>: =5 =0945=  >B40QB 401 8 2>72@0I05B false.
 * >72@0I05B true, 5A;8 02B>@870F8O ?@>945=0.
 */
function requireAuth(req, res) {
    if (!req.player || !req.player.id) {
        unauthorized(res);
        return false;
    }
    return true;
}

/**
 * 0;840F8O ID 1>AA0 (F5;>5 ?>;>68B5;L=>5). @8 >H81:5  400, 2>72@0I05B false.
 */
function requireBossId(res, bossId) {
    if (!bossId || bossId <= 0 || !Number.isInteger(bossId)) {
        fail(res, '#:068B5 :>@@5:B=K9 ID 1>AA0', 'INVALID_BOSS_ID');
        return false;
    }
    return true;
}

/**
 * 0;840F8O ID @5940 (F5;>5 ?>;>68B5;L=>5). @8 >H81:5  400, 2>72@0I05B false.
 */
function requireRaidId(res, raidId) {
    if (!raidId || raidId <= 0 || !Number.isInteger(raidId)) {
        fail(res, '#:068B5 :>@@5:B=K9 ID @5940', 'INVALID_RAID_ID');
        return false;
    }
    return true;
}

/**
 * 0;840F8O ID ?@54<5B0 (F5;>5 ?>;>68B5;L=>5). @8 >H81:5  400, 2>72@0I05B false.
 */
function requireItemId(res, itemId) {
    if (!itemId || itemId <= 0 || !Number.isSafeInteger(itemId)) {
        fail(res, '#:068B5 ID ?@54<5B0', 'INVALID_ITEM_ID');
        return false;
    }
    return true;
}

/**
 * =:@5<5=B AGQBG8:0 A>1@0==KE ?@54<5B>2 (items_collected) =0 1.
 * K7K205BAO 2=CB@8 B@0=70:F88 ?>A;5 4>102;5=8O ?@54<5B0 2 8=25=B0@L.
 */
function incrementItemsCollected(client, playerId, amount = 1) {
    return client.query(
        `UPDATE players SET items_collected = COALESCE(items_collected, 0) + $1 WHERE id = $2`,
        [amount, playerId]
    );
}

/**
 * Middleware->1Q@B:0 4;O catch >H81>: 2 0A8=E@>==KE >1@01>BG8:0E
 */
function wrap(fn) {
    return function(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 57>?0A=>5 ?@52@0I5=85 >1J5:B0 2 AB@>:C
 */
function safeStringify(obj, space) {
    if (obj === undefined || obj === null) return '{}';
    if (typeof obj === 'function') return '{}';
    try {
        return JSON.stringify(obj, null, space);
    } catch (error) {
        logger.warn('JSON stringify failed');
        return '{}';
    }
}

/**
 * 57>?0A=K9 ?0@A8=3 JSON
 */
function safeJsonParse(str, defaultValue = null) {
    if (!str) return defaultValue;
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        logger.warn('[safeJsonParse failed]', {
            error: e.message,
            str: str?.substring(0, 100),
            type: typeof str,
            length: str?.length
        });
        return defaultValue;
    }
}

/**
 * K?>;=8BL DC=:F8N 2 B@0=70:F88 A 1;>:8@>2:>9 83@>:0
 * @param {number} playerId - ID 83@>:0 (2=CB@5==89 id 87 )
 * @param {function} fn - $C=:F8O 4;O 2K?>;=5=8O (?>;CG05B client 8 lockedPlayer)
 * @param {number} timeoutMs - "09<0CB 2 <8;;8A5:C=40E (?> C<>;G0=8N 10000<A)
 */
async function withPlayerLock(playerId, fn, timeoutMs = 10000) {
    // 1I0O 20;840F8O ID: ?@82>48B : G8A;C, ?>MB><C playerId, ?@8H54H89
    // AB@>:>9, B>65 ?@8=8<05BAO.
    const idCheck = validateId(playerId, 'ID 83@>:0');
    if (!idCheck.ok) {
        throw { message: '5:>@@5:B=K9 ID 83@>:0', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    const id = idCheck.value;

    return await transaction(async (client) => {
        await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);

        const lockedPlayer = await client.query(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [id]
        );

        if (!lockedPlayer.rows[0]) {
            throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        return await fn(client, lockedPlayer.rows[0]);
    });
}

/**
 * #=825@A0;L=K9 >1@01>BG8: >H81>: 4;O @>CB>2
 *
 * ;85=BC >B40Q< B5:AB ", 4;O :;85=BA:8E >H81>: (4xx). ;O 500
 * =0@C6C CE>48B >1>1IQ==K9 B5:AB: 8=0G5 83@>: 2845; 1K 2=CB@5==85
 * A>>1I5=8O (=0?@8<5@, B5:AB >H81:8 PostgreSQL A 8<5=0<8 B01;8F 8
 * :>;>=>:). >;=K5 45B0;8 >AB0NBAO 2 ;>30E.
 */
function handleError(res, error, action = 'unknown', playerId = null) {
    const statusCode = error.statusCode || 500;
    // >4K >H81>:  (23505, 42P01...)  MB> 2=CB@5==85 :>4K Postgres,
    // >B4020BL 8E :;85=BC =570G5<. 0@C6C CE>4OB B>;L:> =0H8
    // 1C:25==>-F8D@>2K5 :>4K 2840 INSUFFICIENT_COINS.
    const rawCode = typeof error.code === 'string' ? error.code : '';
    const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
    const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const internalMessage = error.message || '=CB@5==OO >H81:0 A5@25@0';
    const isClientError = statusCode >= 400 && statusCode < 500;

    logger.error(`[${action}] H81:0: ${internalMessage}`, {
        code,
        statusCode,
        playerId,
        stack: error.stack
    });

    // B?@02;O5< >H81:C 04<8=8AB@0B>@C 2 Telegram (B>;L:> 4;O 5xx)
    if (statusCode >= 500) {
        try {
            const { notifyAdminSync } = require('./telegramNotifier');
            notifyAdminSync(`[${action}] ${internalMessage}`, {
                stack: error.stack,
                playerId,
                context: action
            });
        } catch (_) { /* ignore */ }
    }

    const message = isClientError
        ? internalMessage
        : '=CB@5==OO >H81:0 A5@25@0. >?@>1C9 ?>765.';

    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * @>25@O5B ?>4?8AL initData >B Telegram
 */
function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) {
        logger.warn('BACBAB2CNB ?0@0<5B@K', { hasInitData: !!initData, hasBotToken: !!botToken });
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) {
            logger.warn('BACBAB2C5B hash');
            return null;
        }
        params.delete('hash');

        const entries = [...params.entries()];
        const dataCheckString = entries
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const authDateStr = params.get('auth_date');
        const userStr = params.get('user');
        if (!authDateStr || !userStr) {
            logger.warn('BACBAB2CNB >1O70B5;L=K5 ?>;O', { hasAuthDate: !!authDateStr, hasUser: !!userStr });
            return null;
        }

        const authDate = parseInt(authDateStr, 10);
        if (!Number.isInteger(authDate)) return null;

        const now = Math.floor(Date.now() / 1000);
        const age = now - authDate;
        // initData  ?>4?8A0==K9 Telegram bearer-B>:5=: :B> 8< 2;0455B, B>B
        // >B 8<5=8 83@>:0. 24 G0A0  A;8H:>< H8@>:>5 >:=> 4;O ?5@5E20B0
        // (AAK;:0, :MH 1@0C75@0, ?@>:A8). Telegram 2K40QB initData ?@8
        // :064>< >B:@KB88 Mini App, ?>MB><C 1 G0A 4>AB0B>G=>: 25@=C2H89AO
        // ?>765 ?@>AB> ?>;CG8B =>2K9 B>:5=.
        const MAX_AGE = Number.isFinite(parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '3600', 10)) ? parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '3600', 10) : 3600;
        if (age < -300 || age > MAX_AGE) {
            logger.warn('initData 8ABQ: 8;8 2@5<O =5 A8=E@>=878@>20=>', { age, authDate, now, maxAge: MAX_AGE });
            return null;
        }

        let user;
        let userId;
        try {
            user = JSON.parse(userStr);
            userId = user.id;
        } catch (e) {
            logger.warn('H81:0 ?0@A8=30 user', { error: e.message });
            return null;
        }

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        let isValid = false;
        try {
            const hashBuf = Buffer.from(computedHash, 'hex');
            const dataHashBuf = Buffer.from(hash, 'hex');
            if (hashBuf.length === dataHashBuf.length) {
                isValid = crypto.timingSafeEqual(hashBuf, dataHashBuf);
            } else {
                logger.warn(' 07=0O 4;8=0 E5H59', { expectedLength: hashBuf.length, actualLength: dataHashBuf.length });
            }
        } catch (e) {
            logger.warn({ type: 'auth_failed', reason: 'hash_compare_error', userId, error: e.message });
            return null;
        }

        if (!isValid) {
            logger.warn({ type: 'auth_failed', reason: 'hash_mismatch', userId });
            return null;
        }

        return {
            user: user,
            auth_date: authDate,
            chat_instance: params.get('chat_instance'),
            chat_type: params.get('chat_type'),
            start_param: params.get('start_param'),
            raw: Object.fromEntries(
                [...params.entries()].filter(([k]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
            ),
            rawInitData: initData
        };
    } catch (err) {
        logger.error('[serverApi] H81:0 20;840F88 Telegram', err.message, err.stack);
        return null;
    }
}

/**
 * Middleware 4;O Express - ?@>25@O5B Telegram initData
 */
async function telegramAuthMiddleware(req, res, next) {
    try {
        // Rate limit 4;O /auth endpoint (10 req/min per IP).
        // trust proxy = false, ?>MB><C req.ip  @50;L=K9 IP A>548=5=8O;
        // X-Forwarded-For =5 G8B05<, 8=0G5 <>6=> ?>445;0BL 8 >1>9B8 ;8<8B.
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';
        
        // Rate limit 4;O /auth endpoint (10 req/min per IP)
        const { allowed, remaining, resetAt } = await checkRateLimit(clientIP, 10, 60000);
        res.set('X-RateLimit-Limit', 10);
        res.set('X-RateLimit-Remaining', remaining);
        res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
        
        if (!allowed) {
            return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' });
        }
        
        const initData = req.headers['x-init-data'] || req.body?.initData;
        const botToken = process.env.TG_BOT_TOKEN;

        if (!botToken) {
            // Fail-closed: ?@>?CA:05< ", ?@8 O2=>< DEV_MODE=true.
            //  0=LH5 CA;>285 1K;> `NODE_ENV !== 'production'`  ?@8
            // =57040==>< NODE_ENV (D0:B8G5A:>5 A>AB>O=85 45?;>O: A<.
            // index.js validateStartupConfig) 8 >BACBAB2CNI5< B>:5=5
            // middleware CE>48; 2 next() 157 req.telegramUser, 8 70I8B0
            // /api/admin 8 /metrics F5;8:>< 7028A5;0 >B B>3>, 2A?><=8B ;8
            // :064K9 @>CB ?@> A>1AB25==K9 guard. 15 >H81:8 >48=0:>2>
            // 40NB 500  ?>2545=85 1>;LH5 =5 7028A8B >B =5O2=>3> NODE_ENV.
            if (process.env.DEV_MODE === 'true') {
                logger.warn('TG_BOT_TOKEN =5 =0AB@>5= - 02B>@870F8O ?@>?CI5=0 (DEV_MODE=true)');
                return next();
            }
            logger.error('TG_BOT_TOKEN =5 =0AB@>5= - 70?@>A >B:;>=Q=');
            return res.status(500).json({ error: 'H81:0 :>=D83C@0F88 A5@25@0' });
        }

        if (!initData) {
            return res.status(401).json({ error: '"@51C5BAO initData' });
        }

        const validated = validateTelegramInitData(initData, botToken);
        if (!validated) {
            return res.status(401).json({ error: '525@=0O ?>4?8AL initData' });
        }

        req.telegramUser = validated.user;
        req.telegramAuth = validated;
        next();
    } catch (e) {
        logger.error('telegramAuthMiddleware error', e);
        return res.status(500).json({ error: 'H81:0 02B>@870F88' });
    }
}

/**
 * Middleware 4;O 845<?>B5=B=>AB8 <CB0F89 G5@57 703>;>2>: Idempotency-Key.
 * 
 * A;8 :;85=B ?@8AK;05B Idempotency-Key, A5@25@ A>E@0=O5B @57C;LB0B 2K?>;=5=8O
 * 70?@>A0 =0 24 G0A0. >2B>@=K9 70?@>A A B5< 65 :;NG>< 25@=QB A>E@0=Q==K9
 * >B25B  ?>2B>@=>3> 2K?>;=5=8O ;>38:8.
 * 
 * >445@68205B B>;L:> <CB8@CNI85 <5B>4K (POST, PUT, PATCH, DELETE).
 * 
 * @param {Request} req
 * @param {Response} res
 * @param {Function} next
 */
async function idempotencyMiddleware(req, res, next) {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return next(); // ">;L:> 4;O <CB0F89
    }

    const idempotencyKey = req.headers['idempotency-key'] || `auto:${method}:${req.path}:${JSON.stringify(req.body || {})}`;

    // >@<0;87C5< :;NG: playerId + :;NG :;85=B0
    const playerId = req.player?.id;
    if (!playerId) {
        return next();
    }

    const fullKey = `idem:${playerId}:${idempotencyKey}`;

    // !, + : :;NG A=0G0;0 B>;L:> ?@>25@O;AO (SELECT), 0
    // A>E@0=O;AO C65 ! 2K?>;=5=8O 70?@>A0. 20 ?0@0;;5;L=KE 70?@>A0
    // A >4=8< Idempotency-Key (42>9=>9 B0? :;85=B0 40QB AB018;L=K9 :;NG
    // =0 1.5 A) >10 =5 =0E>48;8 AB@>:C 8 >10 2K?>;=O;8 <CB0F8N 
    // 42>9=>5 A?8A0=85/=0G8A;5=85. "5?5@L :;NG «70=8<05BAO» 0B><0@=K<
    // INSERT  next(); ?0@0;;5;L=K9 ?>2B>@ ?>;CG05B 409 (8;8
    // A>E@0=Q==K9 >B25B, 5A;8 ?5@20O ?>?KB:0 C65 7025@H8;0AL).
    let claimed = false;
    try {
        const { query: dbQuery, queryOne } = require('../db/database');

        // ;NG8 AB0@H5 24 G ?5@58A?>;L7CNBAO  A=0G0;0 C40;O5< ?@>BCEH89.
        await dbQuery(
            `DELETE FROM idempotency_keys
              WHERE idempotency_key = $1 AND created_at < NOW() - INTERVAL '24 hours'`,
            [fullKey]
        );

        const insertResult = await dbQuery(
            `INSERT INTO idempotency_keys (idempotency_key, response_data, created_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [fullKey, {}]
        );
        claimed = insertResult.rowCount > 0;

        if (!claimed) {
            // ;NG 70=OB: ;81> ?5@20O ?>?KB:0 5IQ 2K?>;=O5BAO, ;81> C65
            // >B25B8;0. A;8 >B25B 3>B>2 (response_data =5 ?CAB>9) 
            // >B40Q< 53> :0: @5?;59.
            const existing = await queryOne(
                `SELECT response_data, created_at FROM idempotency_keys WHERE idempotency_key = $1`,
                [fullKey]
            );
            const isStale = existing
                && (!existing.response_data || Object.keys(existing.response_data).length === 0)
                && existing.created_at
                && (Date.now() - new Date(existing.created_at).getTime() > 5 * 60 * 1000);

            if (isStale) {
                await dbQuery(`DELETE FROM idempotency_keys WHERE idempotency_key = $1`, [fullKey]);
                const retryInsert = await dbQuery(
                    `INSERT INTO idempotency_keys (idempotency_key, response_data, created_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [fullKey, {}]
                );
                claimed = retryInsert.rowCount > 0;
                if (claimed) {
                    // proceed to handler
                } else {
                    // race lost; fall through to 409 below
                }
            }

            if (!claimed && existing && existing.response_data && Object.keys(existing.response_data).length > 0) {
                logger.info('[idempotency] returning cached response', { key: idempotencyKey, playerId });
                return res.set('Idempotency-Replay', 'true').json(existing.response_data);
            }
            if (!claimed && !isStale) {
                return res.status(409).json({
                    error: '0?@>A A B0:8< Idempotency-Key C65 2K?>;=O5BAO',
                    code: 'IDEMPOTENCY_IN_PROGRESS'
                });
            }
            if (!claimed) {
                return res.status(409).json({
                    error: '0?@>A A B0:8< Idempotency-Key C65 2K?>;=O5BAO',
                    code: 'IDEMPOTENCY_IN_PROGRESS'
                });
            }
        }
} catch (err) {
        // Fail-closed: ?@8 A1>5  =5 2K?>;=O5< <CB0F8N 157 845<?>B5=B=>AB8.
        logger.error('[idempotency] claim failed, failing closed', { error: err.message });
        return res.status(503).json({ error: '!5@28A 2@5<5==> =54>ABC?5=', code: 'SERVICE_UNAVAILABLE' });
    }

    // !>E@0=O5< >B25B 2 :MH 845<?>B5=B=>AB8  >B?@02:8 :;85=BC.
    // A;8 ?@>F5AA C?04QB <564C A>E@0=5=85< 8 >B?@02:>9, ?>2B>@=K9 70?@>A
    // A B5< 65 :;NG>< ?>;CG8B A>E@0=Q==K9 >B25B (@5?;59), 0 =5 409.
    const originalJson = res.json.bind(res);
    res.json = function(data) {
        if (claimed && idempotencyKey && res.statusCode >= 200 && res.statusCode < 600) {
            res.__idempotencyData = data;
            res.__idempotencyFullKey = `idem:${playerId}:${idempotencyKey}`;
        }
        return originalJson(data);
    };

    res.on('finish', () => {
        if (claimed && idempotencyKey && res.__idempotencyData !== undefined) {
            const { query } = require('../db/database');
            query(
                `UPDATE idempotency_keys SET response_data = $2, created_at = NOW()
                  WHERE idempotency_key = $1`,
                [res.__idempotencyFullKey, res.__idempotencyData]
            ).catch(() => {});
        } else if (claimed && idempotencyKey) {
            const { query } = require('../db/database');
            query(
                `DELETE FROM idempotency_keys WHERE idempotency_key = $1`,
                [`idem:${playerId}:${idempotencyKey}`]
            ).catch(() => {});
        }
    });

    next();
}

/**
 * 1@01>B:0 >H81>: A>548=5=8O A . >72@0I05B true, 5A;8 >H81:0 >1@01>B0=0 (503 >B?@02;5=).
 * @returns {boolean}
 */
function handleConnectionError(res, error) {
    if (!error) return false;
    const code = error.code || '';
    const message = error.message || '';
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
        message.includes('connect ECONNREFUSED') || message.includes('timeout') ||
        message.includes('Connection terminated')) {
        res.status(503).json({
            success: false,
            error: '!5@28A 2@5<5==> =54>ABC?5=',
            code: 'SERVICE_UNAVAILABLE'
        });
        return true;
    }
    return false;
}

module.exports = {
    // >38@>20=85.
    // sanitize 745AL =5 M:A?>@B8@C5BAO: >= 8A?>;L7C5BAO B>;L:> 2=CB@8
    // requestMiddleware 4;O ?@82545=8O B5;0 70?@>A0 : 157>?0A=><C 284C,
    // 8 =0@C6C 53> =8:B> =5 G8B0;.
    logger,
    requestMiddleware,
    logPlayerError,

    // 0;840F8O
    validateId,
    sanitizeName,
    // B25BK API
    ok,
    fail,
    error,
    // #=825@A0;L=K9 >1@01>BG8: >H81>: 4;O @>CB>2. -:A?>@B8@C5BAO, GB>1K
    // 53> ?>2545=85 (A>:@KB85 2=CB@5==8E A>>1I5=89 ?@8 5xx) <>6=> 1K;>
    // ?@>25@8BL B5AB0<8 157 ?>4=OB8O HTTP-A5@25@0
    handleError,
    handleConnectionError,
    notFound,
    unauthorized,
    requireAuth,
    requireBossId,
    requireRaidId,
    requireItemId,
    incrementItemsCollected,
    wrap,

    // JSON CB8;8BK
    serializeJSONField,
    safeStringify,
    safeJsonParse,
    getTelegramIdFromHeaders,

    // "@0=70:F88 A 1;>:8@>2:>9
    withPlayerLock,

    // >38@>20=85 459AB289 83@>:0: @5M:A?>@B 87 utils/log.js.
    // B45;L=> >B logger/logPlayerError 2KH5, ?>B><C GB> 8A?>;L7C5BAO
    // 4@C38<8 <>4C;O<8 (@>CBK ;>38@CNB 459AB28O, db/players.js  =0G8A;5=85
    // >?KB0). ?@545;5=85 682QB 2 utils/log.js, 745AL B>;L:> AAK;:0 =0 =53>.
    logPlayerAction,

    // 1@01>B:0 >H81>:
    ERROR_MESSAGES,
    // #B8;8BK 83@>:>2

    // Telegram 02B>@870F8O
    validateTelegramInitData,
    telegramAuthMiddleware,

    // 45<?>B5=B=>ABL
    idempotencyMiddleware,

    // Rate limiting: M:A?>@B C1@0=. checkRateLimit 8A?>;L7C5BAO ", 2=CB@8
    // MB>3> D09;0 (telegramAuthMiddleware:529)  =0@C6C DC=:F8O =5 =C6=0, 8
    // verify-dead-exports.js ?>:07K20; 5Q :0: <Q@B2K9 M:A?>@B.

    // PlayerHelper 4;O bosses.js 8 4@C38E <>4C;59
    PlayerHelper: {
        async addExperience(playerId, exp, client = null) {
            // <?>@BK ?>4=OBK =025@E: F8:; db/players.js <-> utils/serverApi.js @07>@20=
            // ?5@5=>A>< ;>38@>20=8O 2 utils/log.js. db/players.js 1>;LH5 =5
            // AAK;05BAO =0 serverApi, gameConstants 8 database  =0 MB>B D09;
            // B>65 =5 AAK;0NBAO.
            const { addExperienceWithLevelUp } = require('../db/players');
            const { getExpForLevel } = require('./gameConstants');

            if (client) {
                return await addExperienceWithLevelUp(client, playerId, exp, getExpForLevel);
            }

            // transaction  MB> B>B 65 transaction() 87 db/database, 8<?>@B8@>20==K9
            // =025@EC D09;0. !2>53> ;>:0;L=>3> 20@80=B0 BEGIN/COMMIT/ROLLBACK
            // 745AL =5 =C6=>: 420 <5AB0 ?@02OB >4=C <5E0=8:C  8 >4=064K
            // @07J5760NBAO.
            return await transaction((poolClient) =>
                addExperienceWithLevelUp(poolClient, playerId, exp, getExpForLevel)
            );
        }
    }
};
