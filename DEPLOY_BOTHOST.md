# Инструкция по деплою на Bothost

## 1. Подготовка репозитория
Код уже на GitHub: https://github.com/simonscats69-code/last-hearth

## 2. Окружение (Environment Variables)
В панели Bothost нужно настроить:

```
# Подключение к БД через пулер Supabase (Supavisor).
# ВАЖНО: прямой хост db.<ref>.supabase.co — только IPv6, из контейнера Bothost
# недостижим (ENETUNREACH). Точную строку берите в Dashboard -> Connect -> Session pooler.
# У ЭТОГО проекта пул aws-1-eu-west-1 (на aws-0-eu-west-1 тот же URI даёт
# "XX000 tenant/user postgres.<ref> not found" — проверено экспериментально).
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require

# Альтернативный формат (не нужно задавать вместе с DATABASE_URL — он имеет приоритет):
DB_HOST=aws-1-eu-west-1.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres.[PROJECT-REF]
DB_PASSWORD=[PASSWORD]

# Обязательные переменные бота:
# ВАЖНО: переменная называется именно TG_BOT_TOKEN (не TELEGRAM_BOT_TOKEN)
TG_BOT_TOKEN=your_bot_token_from_botfather
MINI_APP_URL=https://твой-домен.bothost.tech
FRONTEND_URL=https://твой-домен.bothost.tech
# Числовые Telegram ID админов через запятую (доступ к /metrics и админ-роутам)
ADMIN_IDS=123456789
```

Примечания:
- `?sslmode=require` в `DATABASE_URL` оставлять можно: код (`db/database.js`)
  сам вырезает `sslmode` из строки и включает TLS без строгой проверки цепочки
  (иначе pg 8.20 падает с `SELF_SIGNED_CERT_IN_CHAIN` на сертификате Supabase).
- `SECRET_KEY`, `NODE_ENV`, `PORT`, `DOMAIN` задавать не нужно —
  бот работает в режиме polling, а порт/домен выдаёт платформа.
- Если ни `DATABASE_URL`, ни `DB_HOST` не заданы, pg подключается к
  `localhost:5432` — в контейнере это всегда `ECONNREFUSED`. В логах старт
  печатает строку `Подключение к БД: <host>:<port>/<db>` — проверьте её в первую очередь.
- Успешный старт с БД: в логе `Подключение к БД: aws-1-eu-west-1.pooler.supabase.com:5432/postgres`
  и следом `База данных инициализирована` (без ошибок `tenant/user ... not found`).

## 3. Запуск
- Node.js версия: 18+
- Команда запуска: `npm start` или `node index.js`
- Порт: 3000

## 4. Описание проекта
- Стек: Node.js + Express + PostgreSQL (Supabase)
- Фронтенд: статика в папке `public/`
- API: порт 3000

## 5. Структура файлов для Bothost
```
/public/        - фронтенд (Telegram Mini App)
/               - бэкенд (Node.js, index.js)
/package.json   - зависимости
.env            - переменные окружения (не грузить на git!)
```

## 6. Частые проблемы

### 401 «Неверная подпись Telegram»
- Игра открывается ТОЛЬКО внутри Telegram: /start у бота → кнопка «🎮 Играть».
  Если открыть прямой URL в обычном браузере, SDK Telegram отсутствует, клиент
  отправляет тестовую заглушку initData (`hash=dummy`) — сервер её отклоняет
  (в логах Bothost: `telegram_hash_mismatch`). Это защита, а не поломка.
- Приложение само подключает `https://telegram.org/js/telegram-web-app.js`
  (см. `public/index.html`), поэтому даже открытие по ссылке с fragment
  `#tgWebAppData=...` авторизуется штатно. Fragment живёт ограниченное время
  (окно проверки задаётся `MAX_INIT_DATA_AGE_SECONDS`, по умолчанию 24 ч).
- Клиент берёт initData в таком порядке: SDK Telegram → fragment ссылки
  (`getInitDataFromHash()` в `game.js`) → dev-заглушка `hash=dummy`.
  Поэтому игра работает даже если `telegram.org` недоступен.
- После деплоя `index.html` отдаётся с `Cache-Control: no-store`, но старые
  версии могли закэшироваться на 1 час — если видите старый код в консоли,
  подождите/перезапустите приложение.
- 403 `telegram_id не соответствует подписанным данным` — клиент передал чужой
  id (например, старую запись в localStorage). Перезапустите Mini App.

### CSP-ошибки в консоли (inline script blocked)
- `index.html` отдаётся через шаблон с подстановкой `{{nonce}}` (функция
  `sendIndexHtml` в `index.js`). Новые inline-скрипты обязаны иметь атрибут
  `nonce="{{nonce}}"`, иначе helmet их заблокирует.
- Inline-обработчики (`onclick="..."` в разметке и шаблонах) **не работают**:
  для директивы `script-src-attr` nonce по спецификации CSP не действует.
  Поэтому динамические кнопки помечаются data-атрибутами (`data-raid-attack`,
  `data-raid-join`, `data-claim-achievement`, `data-achievement-filter`,
  `data-buy-coin-item`, `data-use-item`, `data-attack-boss`), а клики
  обрабатывает один общий делегированный обработчик в конце `game.js`.
  Новые динамические кнопки добавляйте так же, а не через `onclick`.

### Экран загрузки и показ интерфейса
- `#loading-screen` (в `index.html`) перекрывает всё до конца инициализации
  (z-index 9999).
- Основной контейнер `#game-content` скрыт (`display: none`) и показывается
  только из `initGame()` в `game.js` — строго после успешной загрузки профиля
  (`gameContent.style.display = 'block'` + `hideLoadingScreen()`).
- Любая ошибка инициализации и «зависание» (watchdog, >30 сек) показываются
  прямо в лоадере через `renderInitError()` с кнопкой «Перезапустить»
  (обработчик навешивается `addEventListener`, не `onclick` — CSP).

### Service worker
- Регистрация SW убрана из `index.html` **и из `game.js`**: cache-first
  стратегия отдавала устаревший `game.js` после обновлений.
- ⚠️ Никогда не вызывать `navigator.serviceWorker.register('./sw.js')` снова:
  `sw.js` самоуничтожается (снимает регистрацию + перезагружает страницы).
  Если страница при каждой загрузке регистрирует его заново, игра попадает в
  бесконечный цикл «загрузка → активация SW → перезагрузка» (вечный лоадер,
  в консоли пусто — она очищается при каждой навигации). В `game.js` вместо
  регистрации стоит блок, который только снимает старые регистрации и чистит
  кэши (без reload).
- `public/sw.js` — **самоуничтожающийся**: клиенты со старой регистрацией при
  следующей загрузке сами удалят кэши, снимут регистрацию и перезагрузятся на
  свежую версию. **Не удалять файл**: при 404 проверка обновления у старых
  клиентов провалится и они навсегда останутся на старом кэше.
- Если нужно проверить фиксы до срабатывания самоуничтожения — открой игру в
  режиме инкогнито (там SW нет) или вручную сними регистрацию в
  DevTools → Application → Service Workers.
- Статика подключается с версией: `game.js?v=<hash>` / `styles.css?v=<hash>`
  (хэш считается по содержимому файлов при старте сервера). После деплоя ссылки
  меняются, поэтому браузерный кэш (1 час) не может отдать старую версию игры.
