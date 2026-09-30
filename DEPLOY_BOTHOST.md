# Инструкция по деплою на Bothost

## 1. Подготовка репозитория
Код уже на GitHub: https://github.com/simonscats69-code/last-hearth

## 2. Окружение (Environment Variables)
В панели Bothost нужно настроить:

```
# Подключение к БД (любой формат)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.eddqhtpbpqzdixejmked.supabase.co:5432/postgres?sslmode=require

# Или отдельно (теперь тоже поддерживается кодом):
DB_HOST=db.eddqhtpbpqzdixejmked.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[PASSWORD]

# ВАЖНО: переменная называется именно TG_BOT_TOKEN (не TELEGRAM_BOT_TOKEN)
TG_BOT_TOKEN=your_bot_token_from_botfather
MINI_APP_URL=https://твой-домен.bothost.ru
WEBHOOK_URL=https://твой-домен.bothost.ru/webhook
SECRET_KEY=любой-секретный-ключ
```

Если ни `DATABASE_URL`, ни `DB_HOST` не заданы, pg подключается к
`localhost:5432` — в контейнере это всегда `ECONNREFUSED`. В логах старт
печатает строку `Подключение к БД: <host>:<port>/<db>` — проверьте её в первую очередь.

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
