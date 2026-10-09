# Глубокий анализ проекта "Last Hearth"

## Статус выполнения
- **Цель:** документирование проблем (баги, мёртвый код, циклы зависимостей, дублирование, JS/TS расхождения) без изменения кода.
- **Результат:** этот документ. Изменения кода не внесены.
- **Примечание:** анализ основан на статическом чтении файлов. Некоторые пункты помечены как `TODO` — требуются динамическая проверка (запуск, тесты) для подтверждения.

---

## 1. Обзор архитектуры

### Ключевые файлы
| Слой | Файл | Роль |
|------|------|------|
| Shared (UMD) | `public/shared/equipment.js` | Единый источник правды для клиента и сервера. `window.EquipmentShared` (браузер) / `module.exports` (Node). |
| Серверные утилиты | `utils/gameConstants.js` | Ре-экспорты над `equipment.js` + серверные функции (XP, падение предметов). |
| Серверные утилиты | `utils/game-helpers.js` | Хелперы для состояния игрока, достижений. |
| API | `utils/serverApi.js` | Telegram auth, middleware, rate limiting, API ответы, обработка ошибок. |
| База данных | `db/database.js` | pg Pool + `query`/`transaction`/`withClient`. |
| База данных | `db/schema.js` | DDL + seeds + repair helpers. |
| База данных | `db/init.js` | Идемпотентный старт. |
| База данных | `db/migrate.js` | Тяжёлые миграции. |
| База данных | `db/players.js` | XP/запросы игроков. |
| База данных | `db/pvp.js` | PvP-данные + формулы. |
| Маршруты | `routes/game/*.js` | Эндпоинты игры. |
| TypeScript (справочник) | `packages/core/src/*.ts` | Порт на TS. **Не используется сервером** (согласно комментариям). |
| Проверка | `scripts/verify-*.js` | Статические проверки. |

### Паттерн lazy require
Многие модули используют функции-обёртки для lazy require:
- `game-helpers.js` → `getGameHelpers()` (line 517: ссылка на `equipmentRules` до определения).
- `schema.js` → `getSchema()`.
- `database.js` → `getLogger()` / lazy `require`.

---

## 2. Обнаруженные проблемы

### 2.1. JS/TS расхождения в константах

#### MAX_INVENTORY_SLOTS
| Файл | Значение | Источник правды |
|------|----------|-----------------|
| `public/shared/equipment.js:194` | `100` | Да |
| `packages/core/src/types.ts` | `50` | Нет |
| `packages/core/src/config.ts` | (чтение через `MAX_INVENTORY_SLOTS`) | Нет |

**Риск:** TS-типы описывают другое поведение. Если `packages/core` перестанет быть "справочником", баг.
> **TODO:** Удалить `packages/core/src` или синхронизировать.

#### EQUIPMENT_SLOTS
| Файл | Слоты |
|------|-------|
| `public/shared/equipment.js` | `armor, helmet, body, head, hands, legs, boots, accessory` (нет `weapon`) |
| `packages/core/src/types.ts` | `weapon, armor, head, body, hands, legs, boots, accessory` |
| `packages/core/src/equipment-rules.ts` (`EQUIPMENT_SLOTS_LIST`) | `weapon, body, head, hands, legs, boots, accessory` (нет `armor`) |

**Замечание:** В `equipment.js` слотовое имя `armor` и `helmet`/`head` дублируются (armor = тип, head = слот). Это запутанная модель.
> **TODO:** Согласовать модель слотов. `weapon` отсутствует в `equipment.js`, но присутствует в TS.

#### COMBAT_SLOTS
- В `equipment.js`: `COMBAT_SLOTS` определяется как `EQUIPMENT_SLOTS.concat(['weapon'])` → `weapon` добавляется, хотя его нет в `EQUIPMENT_SLOTS`.
- В `packages/core/src/equipment-rules.ts`: `COMBAT_SLOTS = EQUIPMENT_SLOTS.concat(['weapon'])`, но `EQUIPMENT_SLOTS` в TS **уже включает** `weapon` → **дубликат**.

#### GAME_CONFIG (equipment.js)
Внутри `equipment.js` есть стандартные константы, которые также определены как standalone:
```js
const WEAR_PER_HIT = 1;
const REPAIR_COST_MULTIPLIER = 0.5;
const UPGRADE_COST_MULTIPLIER = 1.5;
const BASE_DURABILITY = 100;
```
- **Дублирование:** `WEAR_PER_HIT`, `REPAIR_COST_MULTIPLIER`, `UPGRADE_COST_MULTIPLIER`, `BASE_DURABILITY` — определены дважды (standalone + в `GAME_CONFIG`).

> **TODO:** Убрать standalone константы или исключить их из `GAME_CONFIG`.

### 2.2. calculateDropChance / calculateCoinDrop

| Функция | JS (`equipment.js`) | TS (`packages/core/src/formulas.ts`) |
|---------|---------------------|-------------------------------------|
| `calculateDropChance` | `10` базовый (line 329) | `10` базовый (formulas.ts) |
| `calculateCoinDrop` | Диапазон 10–500 золота | В `economy.ts` |

> **Примечание:** `game.js:7649` содержит комментарий о несовпадении с серверной `calculateDropChance`. Это может быть сознательным клиент-серверным разрывом.

### 2.3. Мёртвый код и неиспользуемые экспорты

#### gameConstants.js
Согласно `scripts/verify-dead-exports.js`:
- "11 из 18 экспортов были мёртвыми" в `gameConstants.js`.
- В том числе `getItemCategory` — баг категоризации по ID-диапазонам.

> **TODO:** Выполнить `node scripts/verify-dead-exports.js` для актуализации.

#### public/game.js
- `INVENTORY_MAX_SLOTS = window.EquipmentShared?.MAX_INVENTORY_SLOTS ?? 100` — fallback 100, но в `equipment.js` `MAX_INVENTORY_SLOTS = 100`. Однако в `verify-fallbacks.js` проверяется, что fallback совпадает с реальным значением. В данном случае 100 === 100, но если `equipment.js` изменится, fallback не синхронизируется автоматически.
> **TODO:** `verify-fallbacks.js` — запустить для проверки.

### 2.4. Циклы зависимостей (Circular Dependencies)

#### Класттр db ↔ utils ↔ routes
- `utils/log.js` → `db/database.js` (`query`)
- `db/database.js` → `utils/log.js` (логгер)
  - **Разрешено:** `getLogger()` lazy pattern
- `utils/game-helpers.js` → `db/database.js` (`query`, `transaction`)
- `db/schema.js` → `utils/game-helpers.js` (lazy `getGameHelpers()`)
  - **Разрешено:** lazy pattern
- `routes/game/api.js` → `db/database.js` + `utils/game-helpers.js` (lazy)
- `db/players.js` → `utils/validate.js` (`requireId`), `utils/log.js` (`logPlayerAction`)

> **TODO:** `node -e "require('./index.js')"` с `--trace-warnings` для обнаружения циклов.

### 2.5. Баги логики

#### getGameHelpers() в game-helpers.js (line 517)
```js
// equipmentRules ссылка ДО определения — TODO
```
> **TODO:** Проверить, что lazy pattern корректен.

#### PvP cooldown (routes/game/pvp.js:48)
```js
// MAX_INVENTORY_SLOTS — иначе кража предмета могла выдать 101-й слот
```
> **TODO:** Убедиться, что проверка `>= MAX_INVENTORY_SLOTS` используется перед `attackerInventory.push()`.

#### calculateCoinDrop (routes/game/world.js:509)
- Вызов `calculateCoinDrop({...})` с объектом `options`.
> **TODO:** Убедиться, что сигнатура в `equipment.js` принимает объект.

### 2.6. Дублирование кода

| Функция | JS | TS |
|---------|----|----|
| `calculateCoinDrop` | `equipment.js:348` | `packages/core/src/economy.ts` |
| `getExpForLevel` / `getTotalExpForLevel` | `equipment.js` (импорт через `gameConstants.js`) | `packages/core/src/formulas.ts` |
| `isConnectionError` | `db/database.js` | — |

> **TODO:** Консолидировать в один источник правды.

### 2.7. Проблемы валидации

#### validateId vs requireId (utils/validate.js)
- `validateId` (возвращает `{ok, value, error, code}`).
- `requireId` (бросает Error).
> **TODO:** Убедиться, что все роуты используют `validateId` для пользователя, а `requireId` для внутренних ID.

#### PvP ошибки (scripts/verify-validate.js)
- Регрессия: ранее `clan_id` валидировался неверно (`result.valid` вместо `result.ok`).
> Исправлено (согласно скрипту), но проверить, что больше нет аналогичных.

---

## 3. Инвентаризация маршрутов (routes/game/*.js)

> **TODO:** Запустить `node scripts/verify-routes.js` для полной карты эндпоинтов.

Ключевые файлы:
- `routes/game/world.js` — основной геймплей.
- `routes/game/items.js` — предметы.
- `routes/game/bosses.js` — боссы (использует `MAX_INVENTORY_SLOTS`).
- `routes/game/pvp.js` — PvP.

### Проблема: MAX_INVENTORY_SLOTS в роутах
- `world.js`, `bosses.js`, `items.js`, `pvp.js` — все импортируют `MAX_INVENTORY_SLOTS` из `equipment.js`.
> Согласованность: значение `100` в `equipment.js`.

---

## 4. Проверка клиент-сервер согласованности

### verify-fallbacks.js
- Проверяет `window.EquipmentShared?.X ?? <число>` в `public/game.js`.
- Проверяет `FALLBACK_COMBAT_SLOTS` в `game.js` против `COMBAT_SLOTS` из `equipment.js`.
> **TODO:** Запустить `node scripts/verify-fallbacks.js`.

### verify-client-errors.js
- Проверяет `clientErrorMessage` в `game.js`.
- Ищет catch-блоки, где игрок видит обобщённый текст без `error.message`.
> **TODO:** Запустить для текущего `game.js`.

### verify-messages.js
- Сравнивает строки ответов API с эталоном (до/после).
> **TODO:** Настроить эталон в CI.

### verify-validate.js
- Проверяет `validateId`, `requireId`, `isConnectionError`.
> **TODO:** Запустить для регрессионной проверки.

### verify-dead-exports.js
- Ищет мёртвые экспорты (имена, не встречающиеся больше нигде).
> **TODO:** Запустить для актуализации мёртвого кода.

### verify-visual.js
- Проверяет CSS: скобки, `@keyframes`, `var(--token)`, удалённые темы, `getRarityColor`, старую синюю палитру.
> **TODO:** Запустить для текущей `public/styles.css`.

### verify-data.js
- Проверяет данные в БД.
> **TODO:** Требует подключения к БД.

### verify-rules.js
> **TODO:** Не прочитан полностью — нужно добавить в анализ.

---

## 5. Матрица рекомендаций

| # | Проблема | Приоритет | Статус |
|---|----------|-----------|--------|
| 1 | `MAX_INVENTORY_SLOTS` в TS = 50, в JS = 100 | Средний | TODO |
| 2 | `EQUIPMENT_SLOTS` / `COMBAT_SLOTS` несогласованы JS/TS | Средний | TODO |
| 3 | Дублирование констант в `equipment.js` (standalone + GAME_CONFIG) | Низкий | TODO |
| 4 | 11 мёртвых экспортов в `gameConstants.js` | Средний | TODO |
| 5 | Циклы зависимостей db ↔ utils | Низкий | TODO |
| 6 | `packages/core/src` не синхронизирован с JS | Средний | TODO |
| 7 | PvP ошибки классифицируются по тексту (verify-validate) | Средний | Исправлено |
| 8 | Client error swallowing (23 catch-блока) | Средний | TODO |
| 9 | Fallback значения в `game.js` не проверены | Низкий | TODO |

---

## 6. Инструменты для актуализации

```bash
# Запуск всех проверок
node scripts/verify-dead-exports.js
node scripts/verify-fallbacks.js
node scripts/verify-client-errors.js
node scripts/verify-validate.js
node scripts/verify-visual.js
node scripts/verify-routes.js
node scripts/verify-messages.js <каталог-эталон>
```

---

*Документ создан для анализа. Никакие изменения кода не внесены.*
