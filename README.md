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

Полный список смотрите в [.env.example](.env.example):

```env
PORT=3000
DATABASE_URL=postgresql://postgres:[PASSWORD]@host:5432/postgres
TG_BOT_TOKEN=your_bot_token
MINI_APP_URL=https://your-app.bothost.ru
WEBHOOK_URL=https://your-app.bothost.ru/webhook
ADMIN_IDS=
SECRET_KEY=your_secret_key
```

## Структура проекта

```
last-hearth/
├── index.js                 # Точка входа сервера (Express + статика)
├── webhook.js               # Telegram Webhook (Telegraf)
├── db/
│   ├── database.js          # Пул подключений и DB-утилиты
│   ├── schema.js            # DDL и миграции
│   ├── players.js           # DB-слой игроков
│   └── pvp.js               # PvP: доступ к данным + боевые формулы
├── routes/
│   ├── admin.js             # Админ-эндпоинты
│   ├── api.js               # Общие API-роуты (рейтинг, достижения)
│   └── game/                # Игровые namespace-роуты
│       ├── bosses.js        # Боссы и рейды
│       ├── clans.js         # Кланы
│       ├── items.js         # Предметы и магазин
│       ├── minigames.js     # Колесо удачи
│       ├── player.js        # Профиль, рефералы, энергия
│       ├── pvp.js           # PvP-бои
│       ├── status.js        # Статус игрока
│       └── world.js         # Локации и поиск лута
├── utils/
│   ├── config.js            # Конфигурация окружения
│   ├── game-helpers.js      # Нормализация состояния + достижения
│   ├── gameConstants.js     # Игровые формулы
│   ├── metrics.js           # Метрики сервера (GET /metrics)
│   ├── scheduler.js         # Фоновые задачи
│   └── serverApi.js         # Серверные утилиты, auth, метрики
└── public/
    ├── index.html           # Главная страница Mini App
    ├── manifest.json        # PWA-манифест
    ├── sw.js                # Service Worker
    ├── styles.css           # Стили
    └── game.js              # Весь клиентский код игры
```

## Функции игры

### Персонаж
- 6 характеристик: сила, выносливость, ловкость, интеллект, удача, крафт
- Основные состояния: здоровье, энергия, радиация, усталость, инфекции
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
- Внутриигровые покупки

## Разработка

Тестового набора в проекте нет. Перед коммитом прогоняй линтер:

```bash
npm run lint
```

### Основные API Endpoints

```
GET  /api/game/profile
GET  /api/game/inventory
POST /api/game/inventory/use-item

GET  /api/game/locations
POST /api/game/locations/search
POST /api/game/locations/move

GET  /api/game/bosses
POST /api/game/bosses/attack-boss
GET  /api/game/bosses/raids

GET  /api/game/clans/clan
POST /api/game/clans/clan/create
POST /api/game/clans/clan/join

POST /api/game/pvp/attack
POST /api/game/pvp/attack-hit
GET  /api/game/pvp/stats

GET  /api/game/wheel
POST /api/game/wheel/spin

GET  /api/game/items/shop
POST /api/game/items/buy
POST /api/game/purchase
POST /api/verify-telegram
```

## Лицензия

MIT
