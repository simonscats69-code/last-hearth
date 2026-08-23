/**
 * Конфигурация Jest для тестирования
 */
module.exports = {
  // Тестовые файлы
  testMatch: [
    '**/*.test.js'
  ],
  // Игнорировать worktree-директории и node_modules
  testPathIgnorePatterns: [
    '/\\.kilo/',
    '/node_modules/'
  ],
  // Для CommonJS модулей
  testEnvironment: 'node'
};
