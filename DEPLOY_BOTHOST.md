# Инструкция по деплою на Bothost

## 1. Подготовка репозитория
Код уже на GitHub: https://github.com/simonscats69-code/last-hearth

## 2. Окружение (Environment Variables)
В панели Bothost нужно настроить:

```
DB_HOST=db.eddqhtpbpqzdixejmked.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=Leonardo43552635

TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
MINI_APP_URL=https://твой-домен.bothost.ru
WEBHOOK_URL=https://твой-домен.bothost.ru/webhook
SECRET_KEY=любой-секретный-ключ
```

## 3. Запуск
- Node.js версия: 18+
- Команда запуска: `npm start` или `node src/index.js`
- Порт: 3000

## 4. Описание проекта
- Стек: Node.js + Express + PostgreSQL (Supabase)
- Фронтенд: статика в папке `public/`
- API: порт 3000

## 5. Структура файлов для Bothost
```
/public/        - фронтенд (Telegram Mini App)
/src/           - бэкенд (Node.js)
/package.json   - зависимости
.env            - переменные окружения (не грузить на git!)
```
