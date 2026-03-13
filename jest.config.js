/**
 * Конфигурация Jest для тестирования
 */
module.exports = {
  // Игнорировать db папку при трансформации (содержит синтаксические ошибки)
  transformIgnorePatterns: [
    'node_modules/',
    'db/'
  ],
  // Тестовые файлы
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  // Модули которые не нужно трансформировать
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  // Для CommonJS модулей
  testEnvironment: 'node'
};
