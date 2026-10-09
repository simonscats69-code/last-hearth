-- Удаление записей player_achievements с NULL achievement_id или ссылкой на
-- несуществующее достижение (ошибка старой схемы)
DELETE FROM player_achievements pa
 WHERE pa.achievement_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM achievements a WHERE a.id = pa.achievement_id);
