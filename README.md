# Последний Очаг (Last Hearth)

Постапокалиптический survival RPG для Telegram Mini App.

## Быстрый старт

### Требования
- Node.js 18+
- PostgreSQL 14+
- Telegram Bot Token

### Установка

1. Клонируйте репозиторий
2. Установите зависимости:
```bash
npm install
```

3. Настройте окружение:
```bash
cp .env.example .env
# Отредактируйте .env файл
```

4. Настройте PostgreSQL базу данных

5. Запустите сервер:
```bash
npm start
```

### Переменные окружения (.env)

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=last_hearth
DB_USER=postgres
DB_PASSWORD=your_password
TELEGRAM_BOT_TOKEN=your_bot_token
MINI_APP_URL=http://localhost:3000
WEBHOOK_URL=https://your-domain.com/webhook
ADSGRAM_APP_ID=your_adsgram_app_id
SECRET_KEY=your_secret_key
```

## Структура проекта

```
last-hearth/
├── src/
│   ├── index.js          # Главный файл сервера
│   ├── bot/
│   │   └── webhook.js   # Telegram Webhook обработчики
│   ├── db/
│   │   └── database.js  # Подключение к PostgreSQL
│   └── routes/
│       ├── game.js      # Игровые API endpoints
│       └── api.js       # Дополнительные API
├── public/
│   ├── index.html       # Главная страница Mini App
│   ├── styles.css       # Стили
│   └── game.js          # Клиентский JavaScript
├── package.json
└── README.md
```

## Функции игры

### Персонаж
- 5 характеристик: сила, выносливость, ловкость, интеллект, удача
- 7 состояний: здоровье, голод, жажда, радиация, усталость, переломы, инфекции
- Энергия: тратится на действия, восстанавливается 1/мин

### Локации
7 локаций с нарастающей радиацией:
- Спальный район (☢️ 0)
- Рынок (☢️ 5)
- Больница (☢️ 15)
- Промзона (☢️ 30)
- Центр города (☢️ 50)
- Военная база (☢️ 70)
- Бункер (☢️ 100)

### Боссы
10 боссов с цепочкой разблокировки через ключи

### Монетизация
- Telegram Stars
- AdsGram реклама
- Внутриигровые покупки

## Разработка

### API Endpoints

```
GET  /api/game/profile     - Профиль игрока
POST /api/game/search      - Поиск лута
POST /api/game/move        - Переход к локации
GET  /api/game/locations   - Список локаций
POST /api/game/use-item    - Использовать предмет
GET  /api/game/inventory   - Инвентарь
GET  /api/game/bosses      - Список боссов
POST /api/game/attack-boss - Атаковать босса
POST /api/game/restore-energy - Восстановить энергию
```

## Лицензия

MIT
