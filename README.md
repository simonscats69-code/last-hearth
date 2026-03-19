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
├── index.js                 # Точка входа сервера
├── bot/
│   └── webhook.js           # Telegram Webhook
├── db/
│   ├── database.js          # Подключение и DB-утилиты
│   ├── schema.js            # DDL и миграции
│   └── players.js           # DB-слой игроков
├── routes/
│   ├── api.js               # Общие API-роуты
│   ├── leaderboard.js       # Рейтинги
│   └── game/                # Игровые namespace-роуты
├── services/
│   └── playerService.js     # Бизнес-логика игрока
├── utils/
│   ├── serverApi.js         # Серверные утилиты и auth
│   ├── gameConstants.js     # Игровые формулы
│   └── playerState.js       # Нормализация состояния игрока
└── public/
    ├── index.html           # Главная страница Mini App
    ├── styles.css           # Стили
    ├── game-core.js         # Ядро клиента, state, экраны
    ├── game-systems.js      # Игровые сценарии и механики
    ├── game-ui.js           # DOM-binding и обработчики
    ├── game-api.js          # Клиентские API-обёртки
    └── прочие UI/эффект-модули
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
- AdsGram реклама
- Внутриигровые покупки

## Разработка

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

POST /api/game/energy/buy-energy
GET  /api/game/market/listings-v2
POST /api/game/purchase
POST /api/verify-telegram
```

## Лицензия

MIT
