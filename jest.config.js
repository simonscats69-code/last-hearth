/**
 * Конфигурация Jest для тестирования
 */
module.exports = {
  // Тестовые файлы
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  // Для CommonJS модулей
  testEnvironment: 'node'
};
