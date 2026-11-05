// utils/gameMiddleware.js
// Общие middleware для игровых роутов.
'use strict';

const { unauthorized } = require('./serverApi');

/**
 * Middleware: требует авторизованного игрока (req.player.id).
 * Устанавливает req.playerId для удобства.
 */
function requirePlayer(req, res, next) {
    const playerId = req.player?.id;
    if (!playerId) return unauthorized(res);
    req.playerId = playerId;
    next();
}

/**
 * Обёртка для async-обработчиков: ловит ошибки и передаёт в handleError.
 * @param {Function} handler — async (req, res) => void
 * @param {string} action — имя действия для логирования
 */
function asyncHandler(handler, action) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            const { handleError } = require('./serverApi');
            handleError(res, err, action || 'unknown', req.player?.id);
        }
    };
}

module.exports = { asyncHandler, requirePlayer };
