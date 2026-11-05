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
