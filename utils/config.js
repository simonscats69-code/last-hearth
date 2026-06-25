/**
 * Централизованные конфигурации приложения
 */

module.exports = {
  MINI_APP_URL: process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru',
  RATE_LIMIT: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    cleanupIntervalMs: 60 * 1000
  },
  MAX_INIT_DATA_AGE_SECONDS: parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '172800', 10),
  PLAYER_NAME_MAX_LENGTH: 50,
  PLAYER_NAME_PATTERN: /^[^\w\s\-а-яА-ЯёЁ]+$/,
  DEFAULT_ENERGY: 100,
  DEFAULT_HEALTH: 100
};
