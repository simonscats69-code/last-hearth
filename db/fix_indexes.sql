-- Недостающие индексы для производительности
-- Запусти этот файл в pgAdmin

-- Индексы для PvP системы (правильные имена колонок)
CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_defender ON pvp_matches(defender_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_created ON pvp_matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_cooldowns_player ON pvp_cooldowns(player_id);

-- Индексы для рейдов
CREATE INDEX IF NOT EXISTS idx_raid_progress_player ON raid_progress(player_id);
CREATE INDEX IF NOT EXISTS idx_raid_progress_boss ON raid_progress(boss_id);
CREATE INDEX IF NOT EXISTS idx_boss_sessions_boss ON boss_sessions(boss_id);
CREATE INDEX IF NOT EXISTS idx_boss_sessions_player ON boss_sessions(player_id);

-- Индексы для рефералов
CREATE INDEX IF NOT EXISTS idx_players_referred_by ON players(referred_by);

-- Индексы для достижений
CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements(player_id);
CREATE INDEX IF NOT EXISTS idx_player_achievements_achievement ON player_achievements(achievement_type);

-- Индексы для лидерборда (уже должны быть, но проверим)
CREATE INDEX IF NOT EXISTS idx_players_level_desc ON players(level DESC);
CREATE INDEX IF NOT EXISTS idx_players_strength_desc ON players(strength DESC);
CREATE INDEX IF NOT EXISTS idx_players_experience_desc ON players(experience DESC);

-- Уникальный индекс для реферальных кодов
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_referral_code_unique ON players(referral_code) WHERE referral_code IS NOT NULL;

-- Проверка существующих индексов (раскомментируй если нужно)
-- SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public';
