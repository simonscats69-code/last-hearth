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
END $do$
