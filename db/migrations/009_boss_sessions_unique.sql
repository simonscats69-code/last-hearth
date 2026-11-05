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
