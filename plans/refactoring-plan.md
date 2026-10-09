# План рефакторинга Last Hearth

## Текущее состояние проекта

### Структура
```
last-hearth/
├── index.js                      # Точка входа Express-сервера (CommonJS)
├── webhook.js                    # Настройка Telegram webhook
├── routes/
│   ├── api.js                    # Ручки справочники (daily tasks config)
│   ├── admin.js                  # Админ-эндпоинты
│   └── game/                     # Игровые роутеры (CommonJS)
│       ├── index.js              # Главный роутер с мидлвэарами валидации
│       ├── world.js              # Локации, поиск лута, перемещение
│       ├── bosses.js             # Соло/массовые бои с боссами
│       ├── pvp.js                # PvP атака, удары, статистика
│       ├── player.js             # Профиль, энергия, ежедневный бонус
│       ├── items.js              # Инвентарь, покупка, продажа, разбор
│       ├── workshop.js           # Ремонт, улучшение, модификация
│       ├── status.js             # Статус игрока, лечение, дебаффы
│       ├── minigames.js          # Колесо удачи
│       ├── clans.js              # Кланы, чат, заявки
│       └── debuffs.js            # API для дебаффов
├── db/
│   ├── database.js               # Пул соединений, query/transaction
│   ├── init.js                   # Быстрая инициализация (CREATE TABLE IF NOT EXISTS)
│   ├── migrate.js                # Тяжёлые миграции
│   └── schema.js                 # DDL + сиды (970+ строк)
├── utils/
│   ├── gameConstants.js          # Константы дебаффов, лут (re-export из equipment.js)
│   ├── game-helpers.js           # Состояние игрока, ачивки (1051 строк)
│   ├── serverApi.js              # Auth, middleware, rate limiting, ответы
│   ├── config.js                 # Конфиг приложения
│   ├── validate.js               # Валидация ID
│   ├── log.js                    # Winston логгер
│   ├── metrics.js                # HTTP-метрики
│   ├── scheduler.js              # Планировщик задач
│   ├── lootCache.js              # Кэш пулов лута
│   └── serverApi.js              # Telegram auth, middleware, ответы
├── public/
│   ├── index.html
│   ├── game.js                   # Основной клиентский код
│   ├── styles.css
│   └── shared/
│       └── equipment.js          # UMD: правила предметов (1060 строк)
├── packages/
│   ├── core/                     # TypeScript shared core
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts         # GAME_CONFIG (дубль из equipment.js)
│   │   │   ├── equipment-rules.ts # Эквивалент equipment-rules (498 строк)
│   │   │   ├── economy.ts        # Sell/stack (дубль game-helpers.js)
│   │   │   ├── formulas.ts       # Drop chance, coin drop, utils
│   │   │   └── types.ts          # Типы и константы
│   │   └── tsconfig.json
│   ├── db/                       # TypeScript DB layer (скелет)
│   ├── client/                   # TypeScript client (скелет)
│   └── server/                   # TypeScript server (скелет)
├── tests/
│   └── db-init.test.js           # Единственный тест (node-based)
├── plans/                        # Планы и анализ
└── scripts/                      # Скрипты verify
```

### Ключевые проблемы

#### 1. Дублирование игровой логики (КРИТИЧНО)
- `public/shared/equipment.js` (1060 строк, UMD) — единственный источник правды для клиента и сервера
- `packages/core/src/equipment-rules.ts` (498 строк) — TypeScript порт с **расхождениями**:
  - `MODIFICATIONS`: equipment.js имеет `{key, name, stat, perLevel, appliesTo, icon, materials}`, equipment-rules.ts использует `{id, name, description, stat, bonus_per_level, materials_per_level, max_level, cost_multiplier}`
  - `MAX_UPGRADE_LEVEL`: 10 (equipment.js) vs 10 (types.ts), но `MAX_MODIFICATION_LEVEL`: 3 (equipment.js) vs 5 (types.ts)
  - `SCRAP_YIELD_BY_RARITY` отличается
  - `MODIFICATION_BY_STAT` в equipment.js — объект с ключами по stat, в equipment-rules.ts — массив с поиском
- `utils/gameConstants.js` реэкспортирует из equipment.js, но добавляет свои `LOOT_TABLES`, `DEBUFF_CONFIG`, `calculateLocationRiskProfile`
- `packages/core/src/economy.ts` дублирует `addItemToInventory`, `calculateSellPrice` из `game-helpers.js`

#### 2. Смешанная архитектура (КРИТИЧНО)
- Корень: CommonJS (Node 20+ Express)
- packages/: TypeScript/ESM с tsup сборкой
- packages/core и packages/server почти пусты — не используются в продакшене
- `public/shared/equipment.js` — UMD (Node + browser) без сборки

#### 3. Циклические зависимости
- `utils/game-helpers.js` → `db/database` → `utils/serverApi` → `db/players` (ленивый)
- `db/schema.js` → `db/database` → `db/schema.js` (разорвано через lazy require)
- Используются lazy require паттерны, что затрудняет тестирование

#### 4. Разрозненные константы
- `ENERGY_REGEN_INTERVAL_MS` определён в 3 местах: equipment.js, types.ts, gameConstants.js
- `MAX_INVENTORY_SLOTS` в equipment.js, types.ts
- Цены/пороги дублируются между equipment.js и config.ts

#### 5. Схема БД
- `db/schema.js` — 970+ строк, смешивает DDL, миграции, сиды
- `db/migrate.js` — отдельный runner для тяжёлых миграций
- Нет системы миграций с версиями (только SQL-файлы в db/migrations/)

#### 6. Тестирование
- Один тестовый файл `tests/db-init.test.js` (node-based, проверка синтаксиса)
- Нет покрытия игровых роутов

---

## Этапы рефакторинга

### Этап 0: CSS cleanup (Priority: MEDIUM — выполнено)

**Цель**: Исправить накопившиеся CSS-проблемы в `public/styles.css`,
выявленные статическим аудитом `scripts/verify-visual.js`.

#### Выполненные исправления:
1. **Сбалансированы фигурные скобки** — было 780 `{` vs 788 `}` (разница +8)
   - Исправлено: `.condition-effect` — пропущена закрывающая `}` перед `.heal-panel`
   - Исправлено: `.auto-heal-range` — orphan `border-radius: 4px; }` без селектора
2. **Удалён дубликат `@keyframes boss-pulse`** (было 2 определения, теперь 1)
3. **Добавлено `--accent-green-bright`** в `:root` (было использовано в `.slot-durability-bar`, но не объявлено)
4. **Устранена старая синяя палитра** — `#1a1a2e` в `.boss-hp-bar` заменён на `var(--bg-secondary)`
5. **Восстановлены потерянные CSS-селекторы** (потерян в commit `8e954d3`):
   - `.referral-code-box`, `.referral-code-display`, `.referral-code-display #referral-code`
   - `.referral-change-section`, `.referral-use-section`, `.referral-use-section h3`
   - `.referral-item`, `.referral-info`, `.referral-name`, `.referral-level`, `.referral-joined`, `.referral-bonuses`
   - `.referral-code-section`, `.referral-code-section h3`, `.referral-stats`
   - (восстановлено из `git show ae558db:public/styles.css`)
6. **Исправлен false positive в `scripts/verify-visual.js`** — `animation: none;` из `public/game.js` ошибочно добавлялся в список используемых анимаций (без проверки на исключение `none`)

#### Результат: `node scripts/verify-visual.js` → "Всё чисто"

### Этап 1: Консолидация игровых правил (Priority: CRITICAL)

**Цель**: Устранить дублирование и расхождения в игровых константах и формулах.

#### Задачи:
1. **Единый источник правды для equipment.js**
   - `public/shared/equipment.js` остаётся единственным источником для клиент-сервер shared logic
   - `packages/core/src/equipment-rules.ts` удаляется или превращается в thin wrapper

2. **Согласовать типы и константы**
   - Привести `types.ts` в `packages/core` в соответствие с `equipment.js`:
     ```typescript
     // Исправить MODIFICATIONS для согласованности
     // equipment.js: key/name/perLevel/appliesTo/icon/materials
     // equipment-rules.ts: id/name/bonus_per_level/materials_per_level/cost_multiplier
     ```
    - Привести `MAX_MODIFICATION_LEVEL`: 3 (equipment.js) — использовать 3 везде
    - `SCRAP_YIELD_BY_RARITY`: согласовать значения
    - `UPGRADE_MATERIAL_BY_RARITY`: исправлено (was: rare→Провода, epic→Электроника; equipment.js: rare→Электроника, epic→Титан)

3. **Экспорт types.ts как generated**
   - Сгенерировать `types.ts` из `equipment.js` или сделать его dependent на equipment.js
   - На сервере: `utils/game-helpers.js` уже использует `equipmentRules` из equipment.js

#### Ожидаемый результат:
- Один файл = одна истина
- Нет расхождений между клиентом и сервером
- `packages/core` может стать thin wrapper над `public/shared/equipment.js`

### Этап 2: Миграция на TypeScript (Priority: HIGH)

**Цель**: Мигрировать корневые CommonJS файлы в TypeScript, использовать types из packages/core.

#### Задачи:
1. **Добавить tsconfig в корень**
   ```json
   {
     "extends": "./tsconfig.base.json",
     "compilerOptions": {
       "module": "CommonJS",
       "outDir": "./dist",
       "rootDir": ".",
       "types": ["node"]
     }
   }
   ```

2. **Мигрировать utils/** постепенно:
   - `utils/validate.js` → `utils/validate.ts`
   - `utils/log.js` → `utils/log.ts`
   - `utils/config.js` → `utils/config.ts`
   - `utils/serverApi.js` → `utils/serverApi.ts` (самый объёмный)

3. **Мигрировать db/**:
   - `db/database.js` → `db/database.ts`
   - `db/init.js` → `db/init.ts`
   - `db/schema.js` → `db/schema.ts`

4. **Мигрировать routes/**:
   - Все роуты из `routes/game/*.js` → `routes/game/*.ts`

5. **Использовать @last-hearth/core для типов**
   - Импорт типов из packages вместо any/mixed

#### Ожидаемый результат:
- TypeScript покрывает весь серверный код
- Type safety на всех уровнях
- Единые пути импорта через workspaces

### Этап 3: Реструктуризация пакетов (Priority: HIGH)

**Цель**: Сделать packages/ функциональными, а не скелетами.

#### Задачи:
1. **@last-hearth/core**:
   - `equipment-rules.ts` — thin wrapper над `public/shared/equipment.js`
   - `economy.ts` — thin wrapper над `utils/game-helpers.js`  
   - `formulas.ts` — можно оставить как есть (pure functions)
   - `config.ts` — thin wrapper или re-export из equipment.js
   - `types.ts` — Generated из equipment.js, или equipment.js импортирует типы

2. **@last-hearth/db**:
   - Перенести `db/schema.ts` и `db/migrate.ts` из корня
   - Добавить типы для всех таблиц

3. **@last-hearth/client**:
   - Добавить client-side игровые функции (будут использовать equipment.js)
   - UI helpers для отображения

4. **@last-hearth/server**:
   - Перенести серверные типы и middleware
   - Re-export из основных модулей

#### Ожидаемый результат:
- packages/ содержат реальную логику
- Монотеплока работает через workspaces

### Этап 4: Исправление циклических зависимостей (Priority: HIGH)

**Цель**: Убедиться, что все циклические зависимости разорваны.

#### Статус: Готово

Архитектура уже исправлена:
- `db/database.js` → только `pg` (нулевые внутренние зависимости)
- `db/schema.js` → импортирует `db/database.js` + lazy-requires `utils/game-helpers.js`
- `db/init.js` → импортирует `db/database.js` + lazy-requires `db/schema.js`
- `db/players.js` → импортирует `db/database.js` + `utils/validate.js` (без serverApi)
- `utils/log.js` → импортирует `db/database.js` + `winston` (без обратных ссылок)
- `utils/serverApi.js` → импортирует `db/database.js` + `utils/log.js` + `utils/validate.js`

Оставшийся lazy require в `db/schema.js` → `utils/game-helpers.js` необходим: schema.js тяжёлая и game-helpers.js импортирует equipment.js + db/database.js.

#### Ожидает результат:
- Прямые зависимости без циклов
- Можно тестировать модули по отдельности

### Этап 5: Стандартизация роутов (Priority: MEDIUM)

**Цель**: Единый паттерн для всех игровых роутов.

#### Принятые паттерны (уже есть в pvp.js и bosses.js):
1. **Валидация до транзакции**: проверка входных данных ДО `transaction()`
2. **Outcome pattern**: транзакция возвращает `{status, body, log?}`, ответ отправляется после COMMIT
3. **throwPvpError/fail pattern**: единый формат ошибок `{success: false, error, code, statusCode}`
4. **withPlayerLock**: централизованная блокировка игрока с SELECT FOR UPDATE

#### Нужно стандартизировать в остальных роутерах:
- `world.js`, `player.js` — использовать outcome pattern
- `items.js`, `workshop.js`, `minigames.js` — использовать fail/handleError pattern
- `status.js` — использовать outcome pattern

### Этап 6: Тестирование (Priority: MEDIUM)

**Цель**: Добавить unit и integration тесты.

#### Задачи:
1. **Unit тесты** (vitest в packages/core):
   - equipment rules (calculateDropChance, calculateCoinDrop, applyDefenseReduction)
   - formulas (getExpForLevel, getTotalExpForLevel)
   - economy (calculateSellPrice, addItemToInventory)

2. **Integration тесты** (root tests/):
   - Game helpers (addItemToInventory, normalizeInventory)
   - PvP (формулы урона, кулдауны)
   - World (поиск лута, лимиты)

3. **Мигрировать на vitest**:
   - `tests/db-init.test.js` → vitest формат
   - Использовать `@vitest/mock` для мокания БД

### Этап 7: Очистка мусора (Priority: LOW)

**Цель**: Удалить устаревшие файлы.

#### Задачи:
1. Удалить `tmp-*.js` файлы (tmp-check.js, tmp-check2.js, tmp-check3.js, tmp-check4.js, tmp-dupscan.js, tmp-snap.js)
2. Удалить `restructure_equipment.py`, `replace_queries.py` (если больше не нужны)
3. Очистить `public/game.js` — вынести в ES-модули (см. plans/game-improvement-analysis.md)

---

## Приоритеты и порядок выполнения

| Этап | Приоритет | Описание | Блокирует |
|------|-----------|----------|-----------|
| 1 | CRITICAL | Консолидация equipment.js | 3, 6 |
| 2 | HIGH | Миграция на TypeScript | 4, 6 |
| 3 | HIGH | Реструктуризация пакетов | - |
| 4 | HIGH | Исправление циклических зависимостей | 2, 5 |
| 5 | MEDIUM | Стандартизация роутов | - |
| 6 | MEDIUM | Тестирование | - |
| 7 | LOW | Очистка мусора | - |

## Риски

1. **Остановка production**: equipment.js используется клиентом — любые изменения должны быть backwards-compatible
2. **Циклы загрузки**: при разделении модулей нужно аккуратно разорвать циклы
3. **TS migration**: можно выполнить поэтапно с preserve JS fallbacks
4. **DB migrations**: использовать IF NOT EXISTS, не ломать существующие схемы

## Детали реализации

### Equipment.js consolidation
```
public/shared/equipment.js — ЕДИНСТВЕННЫЙ источник (UMD, 1060 строк)
↓
utils/equipment.ts — thin wrapper (require equipment.js + add TS types)
packages/core/src/equipment-rules.ts — удалить или сделать реэкспорт
packages/core/src/types.ts — Generated или re-export из equipment.ts
```

### DB layer restructure
```
db/
├── pool.ts          — только пул (чистый, нет зависимостей)
├── query.ts         — query/queryOne/queryAll/transaction/withClient
├── schema/
│   ├── index.ts     — createTables, seedDatabase
│   ├── DDL.ts       — CREATE TABLE statements
│   └── seeds.ts     — INSERT/UPSERT seeds
├── migrations/      — SQL файлы с версиями
│   ├── 001_xxx.sql
│   └── 002_xxx.sql
├── init.ts          — initDatabase (createTables + seed)
└── migrate.ts       — migration runner
```

### Routes standardization
```typescript
// Новый паттерн для роутов
export class GameRouter {
  constructor(db, equipmentRules, helpers) { ... }
  
  // outcome pattern for transactions
  async handleRequest(req, res) {
    try {
      const outcome = await transaction(async (client) => {
        await this.validate(client, req.body);
        return await this.execute(client, req, res);
      });
      return ok(res, outcome.body);
    } catch (error) {
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return fail(res, error.message, error.code, error.statusCode);
      }
      handleError(res, error, action);
    }
  }
}
```