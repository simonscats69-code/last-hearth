# Итоговый отчёт о багах в last-hearth

## ✅ КРИТИЧЕСКИЕ БАГИ (P0) - ВСЕ ИСПРАВЛЕНЫ

### 1. Таблица player_logs не создана (db/schema.js)
**Место**: Строки 898-900 (ранее)
**Проблема**: Индексы для `player_logs` создаются, но сама таблица не создана в `createTables()`.
**Решение**: Таблица `player_logs` теперь создается в `runMigrations()` (строки 899-906).
**Статус**: ✅ ИСПРАВЛЕНО

### 2. Несуществующая колонка owner_id в clans (db/schema.js)
**Место**: Строки 911-912
**Проблема**: Создавался индекс `idx_referrals_owner_id ON referrals(owner_id)`, но в таблице `clans` колонка `owner_id` НЕ существует - там `leader_id`.
**Решение**: Индекс создан правильно как `idx_clans_leader_id ON clans(leader_id)`.
**Статус**: ✅ ИСПРАВЛЕНО

### 3. Неправильный вызов logPlayerAction в status.js (routes/game/status.js)
**Место**: Строка 297
**Проблема**: Использовался `logPlayerActionSimple(query, ...)` вместо `logPlayerAction(playerId, action, metadata, client)`.
**Решение**: Исправлено на правильный вызов `logPlayerAction(playerId, 'status_heal', metadata, client)`.
**Статус**: ✅ ИСПРАВЛЕНО

### 4. Неправильные вызовы logPlayerAction в items.js (routes/game/items.js)
**Место**: Строки 198, 387, 425
**Проблема**: Использовался `logPlayerActionSimple(client, playerId, ...)` вместо `logPlayerAction(playerId, action, metadata, client)`.
**Решение**: Исправлено на правильный порядок аргументов.
**Статус**: ✅ ИСПРАВЛЕНО

### 5. Неправильный вызов logPlayerAction в player.js (routes/game/player.js)
**Место**: Строка 182
**Проблема**: Использовался `logPlayerAction(client, playerId, ...)` вместо `logPlayerAction(playerId, action, metadata, client)`.
**Решение**: Исправлено на правильный порядок аргументов.
**Статус**: ✅ ИСПРАВЛЕНО

### 6. Неправильные вызовы logPlayerAction в debuffs.js (routes/game/debuffs.js)
**Место**: Строки 388, 393, 427, 432
**Проблема**: Использовался `logPlayerAction(client, playerId, ...)` вместо `logPlayerAction(playerId, action, metadata, client)`.
**Решение**: Исправлено на правильный порядок аргументов.
**Статус**: ✅ ИСПРАВЛЕНО

### 7. Отсутствует проверка schedulerEnabled в resetDailyTasks (utils/scheduler.js)
**Место**: Строка 530
**Проблема**: Функция не проверяла флаг `schedulerEnabled` при планировании следующей итерации.
**Решение**: Добавлена проверка `if (schedulerEnabled)` перед `setTimeout`.
**Статус**: ✅ ИСПРАВЛЕНО

## 🟡 БАГИ СРЕДНЕЙ СЕРЬЁЗНОСТИ (P1) - ИСПРАВЛЕНЫ

### 8. Дублирование импорта pool (routes/game/clans.js)
**Место**: Строки 17 и 21
**Проблема**: `pool` импортировался дважды из одного места.
**Решение**: Удалён дублирующий импорт.
**Статус**: ✅ ИСПРАВЛЕНО

## 🟢 БАГИ НИЗКОЙ СЕРЬЁЗНОСТИ (P2) - ИСПРАВЛЕНЫ

### 9. Неправильный формат инвентаря в getRandomItemsToSteal (db/pvp.js)
**Место**: Строки 374-395
**Проблема**: Функция `getRandomItemsToSteal` использовала `Object.entries(inventory)` для работы с инвентарём как с объектом, но реальный инвентарь - массив предметов.
**Решение**: Исправлено на работу с массивом: `inventory.filter(...).map(...)` с проверкой `Array.isArray`.
**Статус**: ✅ ИСПРАВЛЕНО

### 10. Дублирование индексов в миграциях (db/schema.js)
**Место**: Строки 914-918
**Проблема**: Индексы `idx_players_clan_id` и `idx_players_telegram_id` создавались дважды (в `createTables()` и `runMigrations()`).
**Решение**: Удалены дублирующиеся индексы из `runMigrations()`, добавлен комментарий о том, что они уже создаются в `createTables()`.
**Статус**: ✅ ИСПРАВЛЕНО

### 11. Функция finishPVPMatch сбивается с инвентарём (db/pvp.js)
**Место**: Строки 282-310
**Проблема**: При краже предметов используется объектный доступ к инвентарю (`loserInventory[item.itemId]`), но реальный инвентарь - массив.
**Замечание**: Функция `finishPVPMatch` не используется в текущей реализации PvP.
**Статус**: ⚠️ Обозначен, не критичен (функция не используется)

---

## 📊 ИТОГОВЫЕ РЕЗУЛЬТАТЫ

### Статистика:
- **Всего найдено**: 11 багов
- **Исправлено**: 10 багов
- **Потенциальных**: 1 баг (не критичен)

### Исправленные файлы:
1. `db/schema.js` - создание player_logs таблицы и исправление дублирующихся индексов
2. `utils/scheduler.js` - проверка schedulerEnabled перед планированием следующей итерации
3. `routes/game/clans.js` - удаление дублирующего импорта pool
4. `routes/game/status.js` - исправление вызова logPlayerAction
5. `routes/game/items.js` - исправление 3 вызовов logPlayerAction
6. `routes/game/player.js` - исправление вызова logPlayerAction
7. `routes/game/debuffs.js` - исправление 4 вызовов logPlayerAction
8. `db/pvp.js` - исправление работы с инвентарём в getRandomItemsToSteal

### Файлы, требующие внимания (но не критичны):
- `db/pvp.js` - функция finishPVPMatch с потенциальным багом в работе с инвентарём (массив vs объект) - функция не используется