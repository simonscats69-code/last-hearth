/**
 * Real-time утилиты для мониторинга и WebSocket коммуникации
 * Объединяет метрики сервера и WebSocket сервер для live-обновлений
 */

const os = require('os');
const WebSocket = require('ws');
const crypto = require('crypto');
const { logger } = require('./logger');

// =============================================================================
// Метрики сервера
// =============================================================================

const metrics = {
    requests: {
        total: 0,
        success: 0,
        errors: 0,
        byEndpoint: {}
    },
    websocket: {
        messagesSent: 0,
        messagesFailed: 0,
        connectionsActive: 0,
        connectionsTotal: 0,
        roomsCount: 0
    },
    responseTimes: [],
    startTime: Date.now()
};

/**
 * Записывает метрику запроса
 */
function recordRequest(endpoint, statusCode, responseTime) {
    metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
        metrics.requests.success++;
    } else {
        metrics.requests.errors++;
    }
    
    if (!metrics.requests.byEndpoint[endpoint]) {
        metrics.requests.byEndpoint[endpoint] = {
            total: 0,
            success: 0,
            errors: 0,
            avgTime: 0
        };
    }
    
    const ep = metrics.requests.byEndpoint[endpoint];
    ep.total++;
    if (statusCode >= 200 && statusCode < 400) {
        ep.success++;
    } else {
        ep.errors++;
    }
    
    ep.avgTime = ((ep.avgTime * (ep.total - 1)) + responseTime) / ep.total;
    
    metrics.responseTimes.push(responseTime);
    if (metrics.responseTimes.length > 100) {
        metrics.responseTimes.shift();
    }
}

/**
 * Получить текущие метрики
 */
function getMetrics() {
    const uptime = Date.now() - metrics.startTime;
    const avgResponseTime = metrics.responseTimes.length > 0
        ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        : 0;
    
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });
    const cpuUsage = 100 - (100 * totalIdle / totalTick);
    
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    return {
        uptime: Math.floor(uptime / 1000),
        requests: {
            total: metrics.requests.total,
            success: metrics.requests.success,
            errors: metrics.requests.errors,
            successRate: metrics.requests.total > 0
                ? Math.round((metrics.requests.success / metrics.requests.total) * 100)
                : 100
        },
        websocket: {
            messagesSent: metrics.websocket.messagesSent,
            messagesFailed: metrics.websocket.messagesFailed,
            connectionsActive: metrics.websocket.connectionsActive,
            connectionsTotal: metrics.websocket.connectionsTotal,
            roomsCount: metrics.websocket.roomsCount
        },
        performance: {
            avgResponseTime: Math.round(avgResponseTime * 100) / 100,
            requestsPerSecond: (metrics.requests.total / (uptime / 1000)).toFixed(2)
        },
        system: {
            cpu: Math.round(cpuUsage * 100) / 100,
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                systemTotal: Math.round(totalMemory / 1024 / 1024),
                systemFree: Math.round(freeMemory / 1024 / 1024)
            },
            nodeVersion: process.version,
            platform: os.platform()
        },
        endpoints: metrics.requests.byEndpoint
    };
}

/**
 * Сбросить метрики
 */
function resetMetrics() {
    metrics.requests.total = 0;
    metrics.requests.success = 0;
    metrics.requests.errors = 0;
    metrics.requests.byEndpoint = {};
    metrics.responseTimes = [];
    metrics.startTime = Date.now();
}

/**
 * Обновить WebSocket метрики
 */
function updateWebSocketMetrics(wsMetrics) {
    metrics.websocket = {
        messagesSent: wsMetrics.messagesSent || 0,
        messagesFailed: wsMetrics.messagesFailed || 0,
        connectionsActive: wsMetrics.connectionsActive || 0,
        connectionsTotal: wsMetrics.connectionsTotal || 0,
        roomsCount: wsMetrics.roomsCount || 0
    };
}

// =============================================================================
// WebSocket сервер
// =============================================================================

let wss = null;
const clients = new Map();
const rooms = new Map();

const CONFIG = {
    HEARTBEAT_INTERVAL: 30 * 1000,
    MAX_MESSAGE_SIZE: 64 * 1024,
    PONG_TIMEOUT: 10 * 1000
};

const pingTimers = new Map();

/**
 * Генерация токена для игрока
 */
function generateToken(playerId, secret) {
    if (!secret) {
        throw new Error('WS_TOKEN_SECRET обязателен для генерации токена');
    }
    const payload = `${playerId}:${Date.now()}`;
    return crypto.createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

function generateTokenWithSecret(playerId, secret) {
    const payload = `${playerId}:${Date.now()}`;
    return crypto.createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

/**
 * Проверка токена
 */
function verifyToken(playerId, token) {
    if (!token) {
        logger.warn({ type: 'ws_auth_failed', playerId, reason: 'no_token' });
        return false;
    }
    
    const tokenSecret = process.env.WS_TOKEN_SECRET;
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!tokenSecret) {
        if (!isDev) {
            logger.error({ type: 'ws_auth_failed', playerId, reason: 'no_secret_in_production' });
            return false;
        }
        logger.warn({ type: 'ws_auth_dev_mode', playerId, message: 'WS_TOKEN_SECRET не настроен. Разрешаем соединение в режиме разработки.' });
        return true;
    }
    
    const expectedToken = generateTokenWithSecret(playerId, tokenSecret);
    
    let isValid = false;
    try {
        if (token.length !== expectedToken.length) {
            logger.warn({ type: 'ws_auth_failed', playerId, reason: 'invalid_token_length' });
            return false;
        }
        
        isValid = crypto.timingSafeEqual(
            Buffer.from(token),
            Buffer.from(expectedToken)
        );
    } catch (err) {
        logger.warn({ type: 'ws_token_compare_error', playerId, message: err.message });
        return false;
    }
    
    if (!isValid) {
        logger.warn({ type: 'ws_auth_failed', playerId, reason: 'invalid_token' });
    }
    
    return isValid;
}

/**
 * Удаление клиента
 */
function removeClient(playerId) {
    const ws = clients.get(playerId);
    if (ws) {
        for (const [roomId, roomClients] of rooms) {
            roomClients.delete(playerId);
            if (roomClients.size === 0) {
                rooms.delete(roomId);
            }
        }
        
        const pingTimer = pingTimers.get(playerId);
        if (pingTimer) {
            clearTimeout(pingTimer);
            pingTimers.delete(playerId);
        }
        
        clients.delete(playerId);
        metrics.websocket.connectionsActive = clients.size;
        logger.info({ type: 'ws_removed', playerId, reason: 'cleanup' });
    }
}

/**
 * Отправка сообщения с обработкой ошибок
 */
function safeSend(ws, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
    }
    
    try {
        ws.send(data);
        metrics.websocket.messagesSent++;
        return true;
    } catch (err) {
        metrics.websocket.messagesFailed++;
        logger.error({ type: 'ws_send_error', message: err.message });
        
        if (ws.playerId) {
            removeClient(ws.playerId);
        }
        return false;
    }
}

/**
 * Heartbeat - проверка соединений
 */
function startHeartbeat() {
    setInterval(() => {
        const now = Date.now();
        
        for (const [playerId, ws] of clients) {
            if (ws.readyState !== WebSocket.OPEN) {
                removeClient(playerId);
                continue;
            }
            
            const lastPong = ws.lastPong || 0;
            if (now - lastPong > CONFIG.PONG_TIMEOUT) {
                logger.warn({ type: 'ws_pong_timeout', playerId });
                ws.terminate();
                removeClient(playerId);
                continue;
            }
            
            try {
                ws.ping();
            } catch (err) {
                logger.error({ type: 'ws_ping_error', playerId, message: err.message });
                removeClient(playerId);
            }
        }
        
        metrics.websocket.connectionsActive = clients.size;
    }, CONFIG.HEARTBEAT_INTERVAL);
}

/**
 * Инициализация WebSocket сервера
 */
function initWebSocket(server) {
    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws, req) => {
        const urlMatch = req.url?.match(/\/ws\/(\d+)/);
        const playerId = urlMatch?.[1];
        const token = req.url?.match(/token=([^&]+)/)?.[1];
        
        if (!playerId) {
            ws.close(4001, 'Требуется playerId');
            return;
        }
        
        const requireToken = process.env.WS_REQUIRE_TOKEN === 'true';
        if (requireToken && !verifyToken(playerId, token)) {
            ws.close(4003, 'Неверный токен');
            return;
        }
        
        if (clients.has(parseInt(playerId))) {
            const existingWs = clients.get(parseInt(playerId));
            if (existingWs && existingWs.readyState === WebSocket.OPEN) {
                existingWs.terminate();
            }
            clients.delete(parseInt(playerId));
        }
        
        ws.playerId = parseInt(playerId);
        ws.lastPong = Date.now();
        ws.events = null;
        ws.rooms = new Set();
        
        clients.set(parseInt(playerId), ws);
        metrics.websocket.connectionsActive = clients.size;
        metrics.websocket.connectionsTotal++;
        
        logger.info({ type: 'ws_connected', playerId });
        
        ws.on('message', (message) => {
            try {
                if (message.length > CONFIG.MAX_MESSAGE_SIZE) {
                    logger.warn({ type: 'ws_message_too_big', playerId, size: message.length });
                    ws.close(4002, 'Слишком большое сообщение');
                    return;
                }
                
                const data = JSON.parse(message);
                handleMessage(parseInt(playerId), data, ws);
            } catch (err) {
                console.error('JSON.parse ws message failed:', typeof message, message?.toString?.().substring(0, 100));
                logger.error({ type: 'ws_message_error', playerId, message: err.message });
            }
        });
        
        ws.on('close', (code, reason) => {
            removeClient(parseInt(playerId));
            logger.info({ type: 'ws_disconnected', playerId, code, reason: reason.toString() });
        });
        
        ws.on('error', (err) => {
            logger.error({ type: 'ws_error', playerId, message: err.message });
            removeClient(parseInt(playerId));
        });
        
        ws.on('pong', () => {
            ws.lastPong = Date.now();
        });
        
        const tokenSecret = process.env.WS_TOKEN_SECRET;
        if (tokenSecret) {
            ws.send(JSON.stringify({ 
                type: 'connected', 
                playerId: parseInt(playerId),
                token: generateToken(parseInt(playerId), tokenSecret)
            }));
        } else {
            ws.send(JSON.stringify({ 
                type: 'connected', 
                playerId: parseInt(playerId),
                token: null
            }));
        }
    });
    
    startHeartbeat();
    
    logger.info('WebSocket сервер инициализирован с heartbeat');
}

/**
 * Обработка сообщений от клиента
 */
function handleMessage(playerId, data, ws) {
    switch (data.type) {
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
            
        case 'subscribe':
            if (Array.isArray(data.events)) {
                ws.events = data.events;
                logger.info({ type: 'ws_subscribed', playerId, events: data.events });
            }
            break;
            
        case 'unsubscribe':
            ws.events = null;
            break;
            
        case 'join_room':
            if (data.roomId) {
                joinRoom(playerId, data.roomId, ws);
            }
            break;
            
        case 'leave_room':
            if (data.roomId) {
                leaveRoom(playerId, data.roomId);
            }
            break;
            
        default:
            logger.warn({ type: 'ws_unknown_message', playerId, messageType: data.type });
    }
}

/**
 * Вход в комнату
 */
function joinRoom(playerId, roomId, ws) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    
    const roomClients = rooms.get(roomId);
    roomClients.add(playerId);
    ws.rooms.add(roomId);
    metrics.websocket.roomsCount = rooms.size;
    
    logger.info({ type: 'ws_joined_room', playerId, roomId });
}

/**
 * Выход из комнаты
 */
function leaveRoom(playerId, roomId) {
    const roomClients = rooms.get(roomId);
    if (roomClients) {
        roomClients.delete(playerId);
        if (roomClients.size === 0) {
            rooms.delete(roomId);
        }
    }
    
    const ws = clients.get(playerId);
    if (ws) {
        ws.rooms.delete(roomId);
    }
    metrics.websocket.roomsCount = rooms.size;
    
    logger.info({ type: 'ws_left_room', playerId, roomId });
}

/**
 * Проверка подписки на событие
 */
function isSubscribed(ws, event) {
    if (!ws.events || ws.events.length === 0) {
        return true;
    }
    return ws.events.includes(event);
}

/**
 * Отправить сообщение конкретному игроку
 */
function sendToPlayer(playerId, data) {
    const ws = clients.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
    }
    
    if (data.event && !isSubscribed(ws, data.event)) {
        return false;
    }
    
    const message = JSON.stringify(data);
    return safeSend(ws, message);
}

/**
 * Отправить сообщение всем подключённым игрокам (broadcast)
 */
function broadcast(data, eventFilter = null) {
    const message = JSON.stringify(data);
    let count = 0;
    let failed = 0;
    
    const results = Promise.allSettled(
        [...clients.values()]
            .filter(ws => ws.readyState === WebSocket.OPEN)
            .filter(ws => !eventFilter || isSubscribed(ws, eventFilter))
            .map(ws => safeSend(ws, message))
    );
    
    results.then(results => {
        count = results.filter(r => r.value === true).length;
        failed = results.filter(r => r.status === 'rejected').length;
    });
    
    return count;
}

/**
 * Отправить сообщение в комнату
 */
function broadcastToRoom(roomId, data) {
    const roomClients = rooms.get(roomId);
    if (!roomClients) {
        return 0;
    }
    
    const message = JSON.stringify(data);
    let count = 0;
    
    for (const playerId of roomClients) {
        const ws = clients.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (safeSend(ws, message)) {
                count++;
            }
        }
    }
    
    return count;
}

/**
 * Отправить уведомление о событии
 */
function notifyPlayer(playerId, event, data) {
    return sendToPlayer(playerId, {
        type: 'event',
        event,
        data,
        timestamp: Date.now()
    });
}

/**
 * Уведомление об атаке босса
 */
function notifyBossAttack(playerId, bossData) {
    return notifyPlayer(playerId, 'boss_attack', bossData);
}

/**
 * Уведомление о PvP
 */
function notifyPvp(playerId, pvpData) {
    return notifyPlayer(playerId, 'pvp', pvpData);
}

/**
 * Уведомление о клановом событии
 */
function notifyClanEvent(playerId, clanData) {
    return notifyPlayer(playerId, 'clan', clanData);
}

/**
 * Уведомление о достижении
 */
function notifyAchievement(playerId, achievement) {
    return notifyPlayer(playerId, 'achievement', achievement);
}

/**
 * Уведомление всем игрокам в клане
 */
function notifyClanMembers(clanId, event, data) {
    return broadcastToRoom(`clan_${clanId}`, {
        type: 'event',
        event,
        data,
        timestamp: Date.now()
    });
}

/**
 * Получить WebSocket метрики
 */
function getWebSocketMetrics() {
    return {
        messagesSent: metrics.websocket.messagesSent,
        messagesFailed: metrics.websocket.messagesFailed,
        connectionsActive: metrics.websocket.connectionsActive,
        connectionsTotal: metrics.websocket.connectionsTotal,
        roomsCount: metrics.websocket.roomsCount
    };
}

// =============================================================================
// Экспорт
// =============================================================================

module.exports = {
    // Метрики
    recordRequest,
    getMetrics,
    resetMetrics,
    updateWebSocketMetrics,
    
    // WebSocket
    initWebSocket,
    generateToken,
    verifyToken,
    sendToPlayer,
    broadcast,
    broadcastToRoom,
    notifyPlayer,
    notifyBossAttack,
    notifyPvp,
    notifyClanEvent,
    notifyAchievement,
    notifyClanMembers,
    getWebSocketMetrics
};
