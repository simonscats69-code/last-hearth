-- ===== 001_remove_pvp_matches.sql =====
-- Удаление устаревшей таблицы pvp_matches (заменена на pvp_battles)
DROP TABLE IF EXISTS pvp_matches CASCADE;


-- ===== 002_remove_crafting_tables.sql =====
-- Удаление таблиц систем баз и крафта (системы удалены из игры)
-- ВАЖНО: crafting_recipes НЕ удаляем — система крафта восстановлена.
-- DROP TABLE IF EXISTS player_buildings CASCADE;
-- DROP TABLE IF EXISTS buildings CASCADE;
-- DROP TABLE IF EXISTS crafting_recipes CASCADE;
-- Нейтрализовано: крафт восстановлен, таблица нужна.
SELECT 1;


-- ===== 003_remove_craft_achievements.sql =====
-- Полное удаление достижений крафта (система крафта удалена)
-- Нейтрализовано: система крафта восстановлена.
-- DELETE FROM player_achievements
--  WHERE achievement_id IN (
--     SELECT id FROM achievements WHERE category = 'craft'
-- );
-- DELETE FROM achievements WHERE category = 'craft';
SELECT 1;


-- ===== 004_cleanup_orphaned_achievements.sql =====
-- Удаление записей player_achievements с NULL achievement_id или ссылкой на
-- несуществующее достижение (ошибка старой схемы)
DELETE FROM player_achievements pa
 WHERE pa.achievement_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM achievements a WHERE a.id = pa.achievement_id);


-- ===== 005_remove_legacy_items.sql =====
-- Чистка легаси-строк каталога items.
-- 1) «Спирт» существует дважды: старый (type=food) и новый (type=medicine).
--    Старый в магазине выглядел как еда, но /use его игнорировал.
-- 2) «Клюш от Биологического ужары» — опечатка, из-за которой на проде
--    было два ключа от одного босса, а бой открывался «не тем» ключом.
-- 3) «Ключ от босса» — безымянный ключ из ранних сборок.
-- Ключи из инвентарей переезжают в boss_keys (repairPlayerInventories),
-- а не теряются вместе с удалённой строкой каталога.
DELETE FROM items
 WHERE (type = 'food' AND name = 'Спирт')
    OR (type = 'key' AND name IN ('Клюш от босса', 'Клюш от босса.', 'Клюш от Биологического ужары'));


-- ===== 006_fix_player_boss_progress_fk.sql =====
-- MIGRATION: 006_fix_player_boss_progress_fk
-- FK player_boss_progress.player_id должен ссылаться на players(id),
-- а НЕ на players(telegram_id).
--
-- На проде (Supabase) ограничение оказалось создано вручную со ссылкой на
-- telegram_id, тогда как приложение везде передаёт req.player.id === players.id
-- (см. buildRequestPlayer в routes/game/index.js). Из-за этого INSERT ... ON CONFLICT
-- падал с ошибкой 23503 (FK violation) -> 500 на POST /api/game/bosses/start.
--
-- Приводим и ограничение, и данные к схеме CREATE TABLE (REFERENCES players(id)).
DO $do$
DECLARE r record;
BEGIN
    -- 1. Убираем FK на players, ссылающийся на любую колонку кроме id.
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_class frel ON frel.oid = con.confrelid
        JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = current_schema()
          AND rel.relname = 'player_boss_progress'
          AND con.contype = 'f'
          AND frel.relname = 'players'
          AND fa.attname <> 'id'
    LOOP
        EXECUTE format('ALTER TABLE player_boss_progress DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- 2. Строки, где player_id хранит telegram_id, переводим в players.id.
    --    Если по тому же боссу уже есть запись с правильным id — лишнюю убираем,
    --    иначе нарушится UNIQUE (player_id, boss_id).
    DELETE FROM player_boss_progress pbp
    USING players p
    WHERE pbp.player_id = p.telegram_id
      AND pbp.player_id IS DISTINCT FROM p.id
      AND EXISTS (
          SELECT 1 FROM player_boss_progress x
          WHERE x.player_id = p.id AND x.boss_id = pbp.boss_id
      );

    UPDATE player_boss_progress pbp
    SET player_id = p.id
    FROM players p
    WHERE pbp.player_id = p.telegram_id
      AND pbp.player_id IS DISTINCT FROM p.id
      AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.id = pbp.player_id);

    -- 3. Корректный FK (добавляем только если его ещё нет).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_class frel ON frel.oid = con.confrelid
        JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
        WHERE rel.relname = 'player_boss_progress'
          AND con.contype = 'f'
          AND frel.relname = 'players'
          AND fa.attname = 'id'
    ) THEN
        ALTER TABLE player_boss_progress
            ADD CONSTRAINT player_boss_progress_player_id_fkey
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
    END IF;
END $do$;


-- ===== 007_drop_unused_tables.sql =====
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


-- ===== 008_raid_rewards_unique.sql =====
-- 008: идемпотентность наград за рейд на уровне БД.
--
-- Проблема: raid_rewards не имел UNIQUE(raid_id, player_id), а claim
-- читает claimed=false без FOR UPDATE. Параллельные/repeat-запросы
-- (ретрай клиента после таймаута, два параллельных claim) могли
-- прочитать один набор pending и начислить награду дважды.
--
-- Миграция идемпотентна: дубли (если они уже успели появиться)
-- сворачиваются к минимальному id, затем создаётся UNIQUE-индекс.

-- 1. Удаляем дубли, оставляя самую раннюю запись на (raid_id, player_id).
DELETE FROM raid_rewards r
USING raid_rewards keep
WHERE r.raid_id = keep.raid_id
  AND r.player_id = keep.player_id
  AND r.id > keep.id;

-- 2. Запрет задвоения на будущее.
CREATE UNIQUE INDEX IF NOT EXISTS uq_raid_rewards_raid_player
    ON raid_rewards (raid_id, player_id);


-- ===== 009_boss_sessions_unique.sql =====
-- Удалить дубликаты boss_sessions, оставив запись с максимальным id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boss_sessions') THEN
    DELETE FROM boss_sessions a
    USING boss_sessions b
    WHERE a.id < b.id
      AND a.boss_id IS NOT DISTINCT FROM b.boss_id
      AND a.player_id IS NOT DISTINCT FROM b.player_id
      AND a.raid_id IS NOT DISTINCT FROM b.raid_id;
  END IF;
END $$;

-- Добавить уникальное ограничение, если его ещё нет
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boss_sessions') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'boss_sessions_boss_id_player_id_raid_id_key'
    ) THEN
      ALTER TABLE boss_sessions
        ADD CONSTRAINT boss_sessions_boss_id_player_id_raid_id_key
        UNIQUE (boss_id, player_id, raid_id);
    END IF;
  END IF;
END $$;


-- ===== 010_boss_mastery_expand.sql =====
-- Guard: skip if tables do not exist yet (fresh DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boss_mastery') THEN
    RAISE NOTICE 'Skipping migration 010: boss_mastery table does not exist yet';
    RETURN;
  END IF;
END $$;

-- Расширение boss_mastery: урон, разбивка соло/рейд, временные метки
ALTER TABLE boss_mastery
  ADD COLUMN IF NOT EXISTS total_damage BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS solo_kills INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raid_kills INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_killed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_damage_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS max_single_hit INTEGER NOT NULL DEFAULT 0;

-- first_killed_at приближаем из last_killed_at для существующих строк
UPDATE boss_mastery
   SET first_killed_at = COALESCE(first_killed_at, last_killed_at)
 WHERE kills > 0 AND first_killed_at IS NULL;

-- Добавить damage_dealt в raid_rewards для истории вклада
ALTER TABLE raid_rewards
  ADD COLUMN IF NOT EXISTS damage_dealt INTEGER NOT NULL DEFAULT 0;

-- Удалить мёртвое поле mastery_cache
ALTER TABLE player_boss_progress
  DROP COLUMN IF EXISTS mastery_cache;

-- Индексы для лидербордов по урону
CREATE INDEX IF NOT EXISTS idx_boss_mastery_boss_damage ON boss_mastery(boss_id, total_damage DESC);
CREATE INDEX IF NOT EXISTS idx_raid_rewards_player_boss ON raid_rewards(player_id, boss_id);

-- ON DELETE CASCADE для целостности
ALTER TABLE boss_mastery
  DROP CONSTRAINT IF EXISTS boss_mastery_player_id_fkey,
  DROP CONSTRAINT IF EXISTS boss_mastery_boss_id_fkey;
ALTER TABLE boss_mastery
  ADD CONSTRAINT boss_mastery_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  ADD CONSTRAINT boss_mastery_boss_id_fkey FOREIGN KEY (boss_id) REFERENCES bosses(id) ON DELETE CASCADE;


-- ===== 011_inventory_normalize.sql =====
-- Guard: skip if tables do not exist yet (fresh DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'players') THEN
    RAISE NOTICE 'Skipping migration 011: players table does not exist yet';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    RAISE NOTICE 'Skipping migration 011: items table does not exist yet';
    RETURN;
  END IF;
END $$;

-- Миграция: перенос инвентаря из JSONB в нормализованную таблицу player_inventory
-- Идемпотентная: пропускает уже существующие записи.

CREATE TABLE IF NOT EXISTS player_inventory (
    id SERIAL PRIMARY KEY,
    player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    durability INTEGER DEFAULT 100,
    max_durability INTEGER DEFAULT 100,
    upgrade_level INTEGER DEFAULT 0,
    modifications JSONB DEFAULT '{}'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    UNIQUE(player_id, item_id, upgrade_level, durability)
);

INSERT INTO player_inventory (player_id, item_id, quantity, durability, max_durability, upgrade_level, modifications, stats)
SELECT
    p.id AS player_id,
    (item->>'id')::integer AS item_id,
    COALESCE((item->>'quantity')::integer, 1) AS quantity,
    COALESCE((item->>'durability')::integer, 100) AS durability,
    COALESCE((item->>'max_durability')::integer, 100) AS max_durability,
    COALESCE((item->>'upgrade_level')::integer, 0) AS upgrade_level,
    COALESCE(item->'modifications', '{}'::jsonb) AS modifications,
    COALESCE(item->'stats', '{}'::jsonb) AS stats
FROM players p
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN p.inventory IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(p.inventory) = 'array' THEN p.inventory
        ELSE '[]'::jsonb
    END
) AS item
WHERE (item->>'id') IS NOT NULL
  AND (item->>'id')::integer IS NOT NULL
ON CONFLICT (player_id, item_id, upgrade_level, durability) DO NOTHING;

