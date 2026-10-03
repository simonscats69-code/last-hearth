/**
 * Конфигурация Jest.
 *
 * Тесты гоняются по одному процессу и не должны зависать: game-helpers и
 * serverApi тянут за собой db/database (пул) и serverApi (setInterval
 * очистки rate-limit карты). Поэтому модули БД и логирования мокаются
 * в самих тестах, а тут дополнительно запрещаем долгие open handles.
 */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    // Боевые файлы не подхватываем: тесты лежат только в tests/.
    testPathIgnorePatterns: ['/node_modules/', '/.kilo/', '/backups/'],
    clearMocks: true,
    // Тесты на чистых формулах не должны тянуть за собой серверные модули.
    // Если хук всё же открыл пул/таймер — процесс завершаем явно.
    forceExit: true,
    verbose: true
};
