/**
 * Ленивая загрузка utils/game-helpers.js.
 *
 * utils/game-helpers.js — единственный источник функций состояния игрока.
 * Он тянет db/database, поэтому обычный require сверху каждого роута создавал
 * цикл загрузки модулей: routes -> game-helpers -> db/database -> ... -> routes.
 *
 * Импорт ленивый — он выполняется при первом обращении, когда цикл уже
 * разрешен. Идентичный блок из 10 строк был продублирован в routes/game/
 * pvp.js, status.js и world.js; теперь источник один.
 *
 * Модуль кэширует результат, поэтому повторные обращения бесплатны.
 */
let gameHelpers = null;

/**
 * Получить модуль game-helpers (загружает при первом вызове).
 * @returns {object} модуль utils/game-helpers
 */
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('./game-helpers');
    }
    return gameHelpers;
}

module.exports = { getGameHelpers };
