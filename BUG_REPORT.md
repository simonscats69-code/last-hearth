# Отчёт об анализе багов проекта Last Hearth

Дата анализа: 27.10.2026  
Репозиторий: `e:\zztelegramLast-hearth\last-hearth`  
Ветка: `main` (коммит `6b0a131`)

## 1. Методика

Проведён статический и динамический анализ:
- чтение архитектуры: `index.js`, `routes/game/index.js`, `public/index.html`, `public/game.js`, `public/shared/equipment.js`, `db/*`, `utils/*`;
- запуск ESLint: **134 ошибки** (в основном `no-unused-vars`, `no-undef` в тестах, дубли ключей в `scripts/icon-gen/index.js`);
- запуск `node run-all-tests.js`: **443 passed, 11 failed**;
- запуск verify-скриптов: `verify-client-errors.js` упал, остальные зелёные;
- сверка всех клиентских эндпоинтов (`/api/game/...`) с фактическими маршрутами backend;
- проверка тестовых харнесов на актуальность.

## 2. Сводка

| Категория | Кол-во |
|---|---:|
| Проваленные автотесты/харнесы | 5 файлов |
| Проваленные проверки внутри харнесов | 11 |
| ESLint ошибки | 134 |
| Клиентские эндпоинты без backend-аналога | 2 |
| Устаревшие тестовые ожидания | 4+ |

## 3. Фронтенд ↔ бэкенд: сверка кнопок/эндпоинтов

### 3.1. Корректно совпадают

Все основные игровые действия имеют backend-маршруты: профиль/инвентарь, локации, боссы, рейды, кланы, PvP, предметы/магазин, мастерская, миниигры, статус/достижения.

### 3.2. Несовпадения / мёртвые клиентские эндпоинты

1. `API.endpoints.status = '/api/game/status'` (GET). Backend `routes/game/status.js` содержит только `POST /check`. GET `/status` не зарегистрирован → 404. Вызовов не найдено, но эндпоинт оставлен в публичном словаре.
2. `API.endpoints.energy = '/api/game/profile/energy'` (GET). Backend `routes/game/player.js` не имеет `/energy`. Источник энергии — `/game/player/buy-energy` и данные профиля. Эндпоинт мёртвый.
3. `/api/game/bosses/attack` упоминается только в комментарии как удалённый путь; реальный вызов идёт в `/attack-boss`.
4. `/api/game/clans?search=` — backend GET `/` должен поддерживать `search`. Требуется ручная проверка query-параметра.
5. Рекомендуется удалить мёртвые эндпоинты `status`/`energy` из `API.endpoints` либо реализовать backend-роуты.
## 4. Найденные баги и несогласованности

### 4.1. Тестовый набор рассинхронизирован с кодом
- `tests/db-init.test.js` ожидает, что `db/init.js` не вызывает `runMigrations()`. Фактически `init.js` вызывает `await runMigrations()` (строка 65). Это либо устаревший тест, либо незадокументированное изменение.
- `test-no-autoheal.js` ожидает `HEALTH_REGEN_CAP_RATIO = 0.6` и функции `getHealthRegenCap/getRegenerableHealth` в `public/shared/equipment.js`. В коде их нет: есть только `HEALTH_REGEN_INTERVAL_MS`. Незавершённый рефакторинг регена здоровья.
- `test-pvp-harness.js` ожидает плоский ответ `res.body.battle_id`, `res.body.battleEnded`, `res.body.message`, но сервер оборачивает результат в `{ success, data }`. Тесты устарели.
- `test-search-harness.js` падает из-за ожиданий `found_key`, `INVENTORY_FULL`, `LOCATION_UNAVAILABLE` и количества SQL-запросов.
- `scripts/verify-client-errors.js`: `public/game.js:7736` — catch-блок перезагрузки рейдов пишет в `console.error` без `error.message` (ложное срабатывание).

### 4.2. Линтер
- 134 ошибки ESLint: неиспользуемые переменные в `public/game.js`, дублирование ключа `👑` в `scripts/icon-gen/index.js`, `no-undef` (`currentPlayer`) в `test-search-harness.js`.
- `.eslintignore` не исключает тесты/скрипты, поэтому `npm run lint` не проходит.

### 4.3. Константы и типы
- `packages/core` (TypeScript) не используется сервером и содержит расхождения: `MAX_INVENTORY_SLOTS` JS=100 vs TS=50; `EQUIPMENT_SLOTS` различаются; `COMBAT_SLOTS` дублирует `weapon`.
- Дублирование констант в `public/shared/equipment.js` (standalone + `GAME_CONFIG`).

### 4.4. Безопасность / надёжность
- `public/game.js` использует `innerHTML`/шаблонные строки для рендера; нужно убедиться, что все пользовательские данные проходят через `escapeHtml`/`escapeAttribute`.
- Rate-limit и idempotency зависят от `req.player.id`; `validatePlayer` выполняется до `idempotencyMiddleware` (ОК).
- В `index.js` глобальный `unhandledRejection` не завершает процесс; возможна тихая деградация при ошибках БД.

### 4.5. Архитектура
- Двойной код: root JS + `packages/*` (TS). Сервер использует root JS; TS-пакеты — справочник. Риск расхождения констант.
- `db/init.js` и `db/migrate.js` разделены, но тесты ожидают старую схему — путаница в CI.

## 5. Результаты тестов

```
Харнесов: 16 + проверок: 8
Пройдено тестов: 443, упало: 11
Проблемные: db-init.test.js, test-no-autoheal.js, test-pvp-harness.js, test-search-harness.js, scripts/verify-client-errors.js
```

## 6. Рекомендации

1. Обновить или удалить устаревшие тесты (`db-init`, `pvp`, `search`, `no-autoheal`) под текущий контракт API.
2. Завершить рефакторинг регена здоровья: добавить `HEALTH_REGEN_CAP_RATIO`/`getHealthRegenCap` в `equipment.js` или убрать ожидания из теста.
3. Удалить мёртвые клиентские эндпоинты `status`/`energy` из `API.endpoints` либо реализовать backend-роуты.
4. Синхронизировать `packages/core` с JS или пометить как deprecated.
5. Исправить ESLint ошибки (минимум `no-undef` в тестах и дубль ключа в icon-gen).
6. Провести ручной QA кнопок: создание/вступление в клан, рейды, PvP, мастерская, магазин, колесо.
7. Добавить CI-шаг `node run-all-tests.js` и `npm run lint` с падением при ошибках.

## 7. Ограничения

Анализ выполнен статически + запуск существующих тестов. Полноценный E2E с живой БД и Telegram initData не проводился (требуется `DATABASE_URL`, `TG_BOT_TOKEN`). Некоторые пункты помечены как требующие динамической проверки.

