/**
 * Ленивая загрузка utils/game-helpers.js.
 */
let gameHelpers = null;
let loadError = null;

function getGameHelpers() {
    if (gameHelpers !== null) return gameHelpers;
    if (loadError) throw loadError;
    try {
        gameHelpers = require('./game-helpers');
        return gameHelpers;
    } catch (err) {
        loadError = err;
        throw err;
    }
}

module.exports = { getGameHelpers };
