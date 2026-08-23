# Конкретные решения по пунктам улучшения Last Hearth

Для каждого пункта из `game-improvement-analysis.md` — что именно меняем и каким
кодом. Решения сгруппированы по приоритету.

---

## P0-1. Энергия: сброс регена при трате

**Проблема:** `world.js:387` и `pvp.js:417` делают `last_energy_update = NOW()`
при трате. Реген в `game-helpers.js` считается от этого поля → каждое действие
обнуляет накопленный реген.

**Решение:** реген должен считаться от времени последнего *реального* обновления
(вход/пересчёт), а трата энергии не должна двигать таймер. Вводим единый
хелпер `recalcEnergy`:

```js
// utils/game-helpers.js
async function recalcEnergy(client, playerId, player) {
    const now = Date.now();
    const last = new Date(player.last_energy_update).getTime();
    const elapsedMin = Math.floor((now - last) / 60000);
    if (elapsedMin <= 0) return player;
    const regen = elapsedMin * 1; // 1 энергия/мин
    const newEnergy = Math.min(player.max_energy, player.energy + regen);
    await client.query(
        `UPDATE players SET energy=$1, last_energy_update =
            CASE WHEN $1 >= max_energy THEN last_energy_update
                 ELSE NOW() - ($2::int % 60 || ' seconds')::interval END
         WHERE id=$3`,
        [newEnergy, (now - last) / 1000, playerId]
    );
    player.energy = newEnergy;
    return player;
}
```

И в `world.js`/`pvp.js` перед проверкой энергии вызываем `recalcEnergy`,
а при трате пишем только `energy = energy - $1` БЕЗ изменения `last_energy_update`.

---

## P0-2. Проверка здоровья при поиске

**Файл:** `routes/game/world.js` после получения `updatedPlayer` (строка 191).

**Решение:** добавить сразу после проверки энергии:

```js
if (Number(updatedPlayer.health || 0) <= 0) {
    await client.query('ROLLBACK');
    return res.json({
        success: false,
        error: 'Вы истощены. Сначала восстановите здоровье.',
        code: 'NO_HEALTH'
    });
}
```

Опционально: при `health` ниже порога (например < 20) давать warning в ответе,
но не блокировать.

---

## P0-3. Баланс XP

**Файл:** `utils/gameConstants.js` строки 14-18.

**Решение:** мягкая экспонента + бонус за уровень локации.

```js
function getExpForLevel(level) {
    // 500 * level * (1 + level/25): 1→520, 10→700, 20→1100, 50→3000
    return Math.round(500 * level * (1 + level / 25));
}
```

В `world.js:361` привязать базовый XP к локации:

```js
const locBonus = 1 + (locationData.id - 1) * 0.15; // локация 7 → ×1.9
const baseExpReward = Math.floor(
    (6 + (rarityExp)) * locBonus
);
```

Где `rarityExp` = 0/3/7/11/15 как сейчас. Плюс "combo": если `total_actions`
кратен 10 — бонус ×1.5.

---

## P0-4. Модуляризация game.js / проверка UI

**Решение (если showScreen/useItem/attackBoss отсутствуют):**
1. Прочитать оставшиеся строки game.js (1001–7795), найти определения.
2. Если нет — создать `public/core.js`, `public/ui.js`, `public/systems.js`,
   `public/state.js` и вынести туда логику, добавив `export`.
3. В `index.html` заменить `<script src="game.js">` на
   `<script type="module" src="core.js"></script>`.
4. Добавить в `package.json` сборку (esbuild) если нужно для прод-режима.

---

## P1-5. PvP кулдаун после боя

**Файл:** `routes/game/pvp.js` блок `if (newHealth <= 0)` (строка 502).

**Решение:** после `UPDATE pvp_battles ... status='completed'` вставить
установку кулдаунов для обоих:

```js
const cooldownMin = 5;
await client.query(
    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
     VALUES ($1,'pvp_battle', NOW() + ($2 || ' minutes')::interval)
     ON CONFLICT (player_id, cooldown_type)
     DO UPDATE SET expires_at = NOW() + ($2 || ' minutes')::interval`,
    [attackerId, cooldownMin]
);
await client.query(
    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
     VALUES ($1,'pvp_battle', NOW() + ($2 || ' minutes')::interval)
     ON CONFLICT (player_id, cooldown_type)
     DO UPDATE SET expires_at = NOW() + ($2 || ' minutes')::interval`,
    [defenderId, cooldownMin]
);
// Защита от фарма одной цели:
await client.query(
    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
     VALUES ($1,'pvp_target_'||$2, NOW() + '10 minutes'::interval)
     ON CONFLICT (player_id, cooldown_type) DO UPDATE SET expires_at = NOW() + '10 minutes'::interval`,
    [attackerId, defenderId]
);
```

И в `attack` проверять `pvp_target_<target_id>` кулдаун.

---

## P1-6. PvP формулы (soft caps)

**Файл:** `routes/game/pvp.js` строки 425-464.

**Решение:** заменить жёсткие caps на насыщение:

```js
// Урон
let damage = attacker.strength * 2 + attacker.agility * 0.8;
const eq = safeParse(attacker.equipment, {});
if (eq.weapon?.damage) damage += eq.weapon.damage;
damage *= 1 + (attacker.level - defender.level) * 0.01; // влияние уровня

// Уклонение (soft cap 20%)
const dodgeChance = Math.min(20, defender.agility / (defender.agility + 40) * 20);

// Защита (soft cap 60%)
const defenseReduction = Math.min(60, defender.endurance / (defender.endurance + 60) * 60);
damage = Math.floor(damage * (1 - defenseReduction / 100));
damage = Math.max(1, damage);
```

---

## P1-7. Радиация: константа damagePerLevel

**Файл:** `routes/game/world.js` строка 379.

**Решение:**

```js
// было: radiationDamage = DEBUFF_CONFIG.radiation.damagePerLevel || 2;
radiationDamage = DEBUFF_CONFIG.radiation.damagePerLevel; // = 1
```

Плюс убрать дублирование расчёта защиты: вместо
`Math.ceil(locationData.radiation / 10) - radiationDefense` использовать
уже посчитанный `riskProfile.radiationPressure`:

```js
const baseRadiation = riskProfile.radiationPressure; // уже с учётом defense
radiationGain = Math.max(0, Math.ceil(baseRadiation * randomFactor));
```

---

## P1-8. Ключи боссов по boss_id

**Файл:** `routes/game/world.js` строки 298-339.

**Решение:** заменить массив с русскими именами на привязку к boss_id и джоин:

```js
const keyChances = [
    { bossId: 2, chance: 2.5 }, { bossId: 3, chance: 1.25 },
    { bossId: 4, chance: 0.625 }, /* ... */ { bossId: 10, chance: 0.0097 }
].map(k => ({ ...k, chance: k.chance * riskProfile.keyChanceMultiplier }));

// вместо LIKE:
const keyResult = await client.query(
    `SELECT i.id, i.name, i.type, i.rarity, i.icon
     FROM items i JOIN bosses b ON b.required_key_id = i.id
     WHERE b.id = $1 LIMIT 1`,
    [foundKey.bossId]
);
```

---

## P2-9. Производительность лута

**Файл:** `routes/game/world.js` `getRandomLootItem`.

**Решение:** кэш пула ID при старте сервера:

```js
// при запуске (в index.js или отдельном модуле)
const lootPoolCache = {}; // { 'epic:weapon': [id1,id2,...], ... }
async function buildLootCache() {
    const rows = await queryAll(`SELECT id, rarity, type FROM items WHERE type != 'key'`);
    for (const r of rows) {
        const key = `${r.rarity}:${r.type}`;
        (lootPoolCache[key] ||= []).push(r.id);
    }
}

// в getRandomLootItem:
const pool = lootPoolCache[`${rarity}:${preferredType}`] || lootPoolCache[`${rarity}:*`];
const randId = pool[Math.floor(Math.random() * pool.length)];
const item = await client.query(`SELECT ... FROM items WHERE id=$1`, [randId]);
```

---

## P2-10. Лимит инвентаря

**Файл:** `routes/game/world.js` строка 350.

**Решение:**

```js
const MAX_SLOTS = 100;
if (inventory.length >= MAX_SLOTS) {
    return res.json({ success: false, error: 'Инвентарь полон (100)', code: 'INVENTORY_FULL' });
}
```

Или авто-продажа при переполнении (продавать common за 1 coin).

---

## P2-11. RenderCache инвалидация

**Файл:** `public/game.js` использование `RenderCache`.

**Решение:** после каждого действия (useItem, attackBoss, purchase, search)
вызывать `RenderCache.clear('inventory')` / `clear('bosses')`. Можно добавить
хук в `apiRequest` успешный POST — инвалидировать соответствующие секции по
`cacheInvalidationMap`.

---

## P2-12. Дубли ачивок

**Решение:** в `game-helpers.js` `initAchievementsTable` оставить только
миграцию старых записей, если таблица пуста И нет записей из schema.js. Либо
удалить старый набор (19 шт.) и оставить 4 из schema.js как единый источник.
Добавить `category` и `rarity` для единообразия.

---

## P2-13. Валидация equipment

**Решение:** в `game-helpers.js` добавить `normalizeEquipment(raw)`:

```js
function normalizeEquipment(raw) {
    const eq = safeParseJson(raw, {});
    const out = {};
    for (const slot of ['weapon','armor','helmet','body','head','hands','legs','boots','accessory']) {
        if (eq[slot] && typeof eq[slot] === 'object') out[slot] = eq[slot];
    }
    return out;
}
```

И использовать в world.js / pvp.js вместо `safeJsonParse(equipment, {})`.

---

## P2-14. Realtime PvP

**Файл:** `utils/realtime.js`, `routes/game/pvp.js`.

**Решение:**
- В `attack-hit` после применения урона отправлять через ws событие
  противнику: `realtime.sendToPlayer(defenderId, 'pvp_hit', { damage, health: newHealth })`.
- Добавить поле `last_hit_at` в `pvp_battles` и при старте хода проверять,
  что прошло < 30 c; иначе авто-завершение в пользу активного.

---

## P3-15. Мелочи

- `checkAchievements` (game-helpers.js): объединить 4 SELECT в 1 с JOIN.
- `API_BASE` (game.js:269): упростить до
  `const API_BASE = window.__API_BASE__ || (window.location.origin + '/api');`
- Добавить тесты `game.test.js`:
  - `world.search` с health=0 → NO_HEALTH
  - `pvp.attack-hit` завершение → кулдаун установлен
  - `energy` реген не сбрасывается тратой

---

## Порядок реализации (рекомендую)

1. P0-1 (энергия) + P0-2 (health) — быстро, убирает баги.
2. P0-3 (XP) — баланс.
3. P1-5 (PvP кулдаун) — защита от фарма.
4. P1-6/P1-7/P1-8 — формулы и константы.
5. P2-9/P2-10 — производительность и лимиты.
6. P2-11..14 — качество UI/безопасность/realtime.
7. Тесты (P3).