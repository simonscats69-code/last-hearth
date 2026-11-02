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
