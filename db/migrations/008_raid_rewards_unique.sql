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
