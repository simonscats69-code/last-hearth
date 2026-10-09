-- Полное удаление достижений крафта (система крафта удалена)
DELETE FROM player_achievements
 WHERE achievement_id IN (
    SELECT id FROM achievements WHERE category = 'craft'
);
DELETE FROM achievements WHERE category = 'craft';
