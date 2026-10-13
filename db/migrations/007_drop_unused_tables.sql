-- 007_drop_unused_tables.sql
-- Миграция: удаление таблиц, которых нет в коде игры.
--
-- Сверка сделана по всем .js проекта (routes/, db/, utils/, index.js, webhook.js):
-- ни одной операции SELECT/INSERT/UPDATE/DELETE с этими таблицами.
-- Все проверенные на COUNT(*) перед удалением — 0 строк в каждой.
--
-- Таблицы:
--   admins .......... доступ админа идёт через ADMIN_IDS из .env
--                      (routes/admin.js:50), таблица пустая и не читалась.
--   referrals ........ реферальной системы нет: ноль упоминаний в коде.
--   clan_applications . заявок в клан как процесса нет — вступление сразу
--                      по is_open / invite_code (routes/game/clans.js /clan/join).
--   clan_bosses ...... клановых боссов в игре нет.
--   player_sessions .. авторизация по подписи initData, сессионные токены
--                      не используются.
--
-- DROP ... IF EXISTS повторяемый: на чистой БД после 006 таблиц уже нет,
-- и миграция просто ничего не сделает.
-- CASCADE снимает зависимые индексы и FK; связанных данных нет (все 0 строк).

DROP TABLE IF EXISTS clan_applications CASCADE;
DROP TABLE IF EXISTS clan_bosses CASCADE;
DROP TABLE IF EXISTS player_sessions CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
