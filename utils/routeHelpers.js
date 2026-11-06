// utils/routeHelpers.js
// Общие помощники для игровых роутов: guard игрока и единая обработка ошибок.
'use strict';

const { unauthorized, handleError, handleConnectionError } = require('./serverApi');

/**
 * Проверяет, что req.playerId задан. Если нет — отправляет 401 и возвращает null.
 * @returns {number|null}
 */
function playerIdGuard(req, res, unauthorizedMessage) {
    const playerId = req.playerId || req.player?.id;
    if (!playerId) {
        unauthorized(res, unauthorizedMessage);
        return null;
    }
    if (!req.playerId) req.playerId = playerId;
    return playerId;
}

/**
 * Единая обработка ошибки роута: сначала проверка ошибки соединения с БД,
 * затем универсальный handleError.
 */
function handleRouteError(res, error, action = 'unknown', playerId = null) {
    if (handleConnectionError(res, error)) return res;
    return handleError(res, error, action, playerId);
}

module.exports = { playerIdGuard, handleRouteError };
