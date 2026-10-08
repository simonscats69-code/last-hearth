/**
 * Централизованные конфигурации приложения
 */

module.exports = {
  // Fallback должен указывать на АКТУАЛЬНЫЙ домен: из этого значения бот
  // строит все ссылки Mini App (/play, /profile и т.д.). Старый
  // last-hearth.bothost.ru больше не привязан к сервису и отдаёт 404.
  // В панели Bothost переменная MINI_APP_URL задаётся явно — fallback
  // срабатывает только если её там нет.
  MINI_APP_URL: process.env.MINI_APP_URL || 'https://bot-1791489863-8300-greatcatsby.bothost.tech'
};