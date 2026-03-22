/**
 * Боссы: соло-боёвка и массовые бои.
 *
 * Согласованная модель:
 * - Обычные боссы доступны соло и в массовом режиме
 * - Ключи тратятся только при старте боя
 * - Игрок может находиться только в одном активном бою одновременно
 * - Соло и массовый бой — разные режимы
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../../db/database');
const { safeJsonParse, PlayerHelper: playerHelper, handleError } = require('../../utils/serverApi');
const { normalizeInventory } = require('../../utils/playerState');

const KEYS_REQUIRED_FOR_BOSS = 3;
const SOLO_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;
const MASS_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;
const DAMAGE_PER_KILL = 0.1;
const KILL_DECAY_FACTOR = 0.1;


function validateBossId(bossId) {
    return Number.isInteger(bossId) && bossId > 0;
}

function getEquipmentBonuses(player) {
    const equipment = safeJsonParse(player.equipment, {});

    let weaponBonus = 0;
    let setBonus = 0;

    if (equipment.weapon && equipment.weapon.damage) {
        weaponBonus = equipment.weapon.damage;

        if (equipment.weapon.modifications?.sharpening) {
            weaponBonus += equipment.weapon.modifications.sharpening * 2;
        }
    }

    if (equipment.set_id) {
        let setItems = [];
        if (equipment.set_items) {
            if (Array.isArray(equipment.set_items)) {
                setItems = equipment.set_items;
            } else if (typeof equipment.set_items === 'string') {
                setItems = safeJsonParse(equipment.set_items, []);
            }
        }

        if (setItems.length > 0) {
            setBonus = setItems.length * Math.floor((player.level || 1) * 0.05);
        }
    }

    return { weaponBonus, setBonus };
}

function calculateDamageBonus(bossId, masteries) {
    const masteryMap = {};
    for (const mastery of masteries) {
        masteryMap[mastery.boss_id] = mastery.kills;
    }

    let killBonus = 0;

    for (let i = 1; i < bossId; i++) {
        const kills = masteryMap[i] || 0;
        const distance = bossId - i;
        const multiplier = Math.pow(KILL_DECAY_FACTOR, distance);
        killBonus += kills * DAMAGE_PER_KILL * multiplier;
    }

    const currentKills = masteryMap[bossId] || 0;
    killBonus += currentKills * DAMAGE_PER_KILL;

    return Math.floor(killBonus);
}

function calculateDamage(bossId, player, masteries = []) {
    const { weaponBonus, setBonus } = getEquipmentBonuses(player);
    const killBonus = calculateDamageBonus(bossId, masteries);

    return Math.floor(1 + killBonus + (player.level || 1) + weaponBonus + setBonus);
}

function getNextBossId(bossId) {
    return bossId + 1;
}

function normalizeRewardItems(rawRewardItems) {
    const parsed = safeJsonParse(rawRewardItems, []);
    return Array.isArray(parsed) ? parsed : [];
}

async function getBossById(client, bossId) {
    const result = await client.query('SELECT * FROM bosses WHERE id = $1', [bossId]);
    return result.rows[0] || null;
}

async function getPlayerBaseState(client, playerId) {
    const result = await client.query(
        `SELECT id, first_name, level, health, max_health, energy, max_energy, equipment,
                active_boss_id, active_boss_started_at, active_boss_mode, active_raid_id
         FROM players
         WHERE telegram_id = $1
         FOR UPDATE`,
        [playerId]
    );

    return result.rows[0] || null;
}

async function clearPlayerActiveBattle(client, playerId) {
    await client.query(
        `UPDATE players
         SET active_boss_id = NULL,
             active_boss_started_at = NULL,
             active_boss_mode = NULL,
             active_raid_id = NULL
         WHERE telegram_id = $1`,
        [playerId]
    );
}

async function clearActiveBattleForPlayers(client, playerIds) {
    if (!playerIds.length) return;

            await client.query(
                `UPDATE players
                 SET active_boss_id = NULL,
                     active_boss_started_at = NULL,
                     active_boss_mode = NULL,
                     active_raid_id = NULL
                 WHERE telegram_id = ANY($1::int[])`,
                [playerIds]
            );
}

async function resolveActiveBattle(client, playerId) {
    const player = await getPlayerBaseState(client, playerId);
    if (!player || !player.active_boss_mode) {
        return null;
    }

    if (player.active_boss_mode === 'solo') {
        if (!player.active_boss_started_at || !player.active_boss_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const startedAt = new Date(player.active_boss_started_at).getTime();
        const timePassed = Date.now() - startedAt;
        if (timePassed >= SOLO_FIGHT_DURATION_MS) {
            await client.query('DELETE FROM player_boss_progress WHERE player_id = $1', [playerId]);
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const result = await client.query(
            `SELECT b.id, b.name, b.icon, b.max_health, b.reward_coins, b.reward_experience,
                    pbp.current_hp, pbp.max_hp, pbp.started_at
             FROM bosses b
             JOIN player_boss_progress pbp ON pbp.boss_id = b.id AND pbp.player_id = $1
             WHERE b.id = $2`,
            [playerId, player.active_boss_id]
        );

        const boss = result.rows[0];
        if (!boss) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'solo',
            boss_id: boss.id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: SOLO_FIGHT_DURATION_MS - timePassed,
            boss: {
                id: boss.id,
                name: boss.name,
                icon: boss.icon,
                hp: boss.current_hp,
                max_hp: boss.max_hp,
                reward_coins: boss.reward_coins,
                reward_experience: boss.reward_experience
            }
        };
    }

    if (player.active_boss_mode === 'mass') {
        if (!player.active_raid_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const raidResult = await client.query(
            `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                    b.name, b.icon, b.reward_coins, b.reward_experience
             FROM raid_progress rp
             JOIN bosses b ON b.id = rp.boss_id
             WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()`,
            [player.active_raid_id]
        );

        const raid = raidResult.rows[0];
        if (!raid) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'mass',
            raid_id: raid.id,
            boss_id: raid.boss_id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now(),
            boss: {
                id: raid.boss_id,
                name: raid.name,
                icon: raid.icon,
                hp: raid.current_health,
                max_hp: raid.max_health,
                reward_coins: raid.reward_coins,
                reward_experience: raid.reward_experience
            }
        };
    }

    await clearPlayerActiveBattle(client, playerId);
    return null;
}

async function getBossMasteries(client, playerId) {
    const result = await client.query('SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1', [playerId]);
    return result.rows;
}

async function getPlayerKeyCount(client, playerId, previousBossId) {
    if (previousBossId <= 0) return 0;

    const result = await client.query(
        'SELECT quantity FROM boss_keys WHERE player_id = $1 AND boss_id = $2',
        [playerId, previousBossId]
    );

    return result.rows[0]?.quantity || 0;
}

async function spendBossKeys(client, playerId, previousBossId) {
    if (previousBossId <= 0) return;

    const keyCount = await getPlayerKeyCount(client, playerId, previousBossId);
    if (keyCount < KEYS_REQUIRED_FOR_BOSS) {
        throw {
            message: `Нужно ${KEYS_REQUIRED_FOR_BOSS} ключей от босса ${previousBossId}`,
            code: 'INSUFFICIENT_KEYS',
            statusCode: 400,
            keys_owned: keyCount,
            keys_required: KEYS_REQUIRED_FOR_BOSS
        };
    }

    await client.query(
        `UPDATE boss_keys
         SET quantity = quantity - $1
         WHERE player_id = $2 AND boss_id = $3`,
        [KEYS_REQUIRED_FOR_BOSS, playerId, previousBossId]
    );
}

async function grantNextBossKey(client, playerId, bossId) {
    const nextBossId = getNextBossId(bossId);
    const bossExists = await getBossById(client, nextBossId);
    if (!bossExists) return null;

    await client.query(
        `INSERT INTO boss_keys (player_id, boss_id, quantity)
         VALUES ($1, $2, 1)
         ON CONFLICT (player_id, boss_id)
         DO UPDATE SET quantity = boss_keys.quantity + 1`,
        [playerId, nextBossId]
    );

    return {
        boss_id: nextBossId,
        quantity: 1,
        boss_name: bossExists.name
    };
}

async function loadItemTemplates(client, rewardItems) {
    const templates = [];

    for (const reward of rewardItems) {
        if (reward.item_id || reward.id) {
            const itemId = reward.item_id || reward.id;
            const result = await client.query(
                `SELECT id, name, type, rarity, icon,
                        COALESCE((stats->>'damage')::integer, 0) AS damage,
                        COALESCE((stats->>'defense')::integer, 0) AS defense
                 FROM items WHERE id = $1`,
                [itemId]
            );

            if (result.rows[0]) {
                templates.push({ ...result.rows[0], quantity: Number(reward.quantity || 1) });
            }
        } else if (reward.name && reward.type) {
            templates.push({
                id: reward.id || reward.item_id || null,
                name: reward.name,
                type: reward.type,
                rarity: reward.rarity || 'common',
                icon: reward.icon || '📦',
                damage: Number(reward.damage || 0),
                defense: Number(reward.defense || 0),
                quantity: Number(reward.quantity || 1)
            });
        }
    }

    return templates;
}

async function grantRewardItems(client, playerId, rewardItems, multiplier = 1) {
    const normalizedItems = normalizeRewardItems(rewardItems);
    if (!normalizedItems.length || multiplier <= 0) return [];

    const templates = await loadItemTemplates(client, normalizedItems);
    if (!templates.length) return [];

    const playerResult = await client.query('SELECT inventory FROM players WHERE telegram_id = $1 FOR UPDATE', [playerId]);
    const inventory = normalizeInventory(playerResult.rows[0]?.inventory);
    const granted = [];

    for (const template of templates) {
        const totalQuantity = Math.max(1, template.quantity || 1);
        const grantedQuantity = Math.floor(totalQuantity * multiplier);

        if (grantedQuantity <= 0) continue;

        for (let i = 0; i < grantedQuantity; i++) {
            inventory.push({
                id: template.id,
                name: template.name,
                type: template.type,
                rarity: template.rarity || 'common',
                icon: template.icon || '📦',
                damage: template.damage || 0,
                defense: template.defense || 0,
                upgrade_level: 0,
                modifications: {}
            });
        }

        granted.push({
            id: template.id,
            name: template.name,
            icon: template.icon || '📦',
            quantity: grantedQuantity
        });
    }

    if (granted.length) {
        await client.query('UPDATE players SET inventory = $1 WHERE id = $2', [JSON.stringify(inventory), playerId]);
    }

    return granted;
}

async function getActiveRaids(client, playerId) {
    const raidsResult = await client.query(
        `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                rp.leader_id, rp.leader_name,
                b.name AS boss_name, b.icon, b.description AS boss_description,
                (SELECT COUNT(*) FROM boss_sessions WHERE raid_id = rp.id) AS participants_count
         FROM raid_progress rp
         JOIN bosses b ON b.id = rp.boss_id
         WHERE rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
         ORDER BY rp.started_at DESC`,
        []
    );

    const participatingResult = await client.query(
        'SELECT raid_id FROM boss_sessions WHERE player_id = $1 AND raid_id IS NOT NULL',
        [playerId]
    );

    const participatingIds = participatingResult.rows.map((row) => row.raid_id);

    return {
        raids: raidsResult.rows.map((raid) => ({
            id: raid.id,
            boss: {
                id: raid.boss_id,
                name: raid.boss_name,
                icon: raid.icon,
                description: raid.boss_description
            },
            hp: raid.current_health,
            max_hp: raid.max_health,
            hp_percent: raid.max_health > 0 ? Math.round((raid.current_health / raid.max_health) * 100) : 0,
            leader: {
                id: raid.leader_id,
                name: raid.leader_name
            },
            participants_count: Number(raid.participants_count || 0),
            expires_at: raid.expires_at,
            time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
        })),
        participatingIds
    };
}

function buildAlreadyInFightResponse(activeBattle) {
    return {
        success: false,
        error: 'У вас уже есть активный бой',
        code: 'ALREADY_IN_FIGHT',
        active_battle: activeBattle
    };
}

router.post('/start', async (req, res) => {
    const client = await pool.connect();

    try {
        const bossId = Number(req.body?.boss_id);
        const playerId = req.player.id;

        if (!validateBossId(bossId)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
        }

        await client.query('BEGIN');

        try {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'solo' && activeBattle.boss_id === bossId) {
                    await client.query('COMMIT');
                    return res.json({
                        success: true,
                        data: {
                            mode: 'solo',
                            resumed: true,
                            boss: activeBattle.boss,
                            time_remaining_ms: activeBattle.time_remaining_ms
                        }
                    });
                }

                await client.query('ROLLBACK');
                return res.status(400).json(buildAlreadyInFightResponse(activeBattle));
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Босс не найден', code: 'BOSS_NOT_FOUND' });
            }

            if (bossId > 1) {
                await spendBossKeys(client, playerId, bossId - 1);
            }

            await client.query(
                `INSERT INTO player_boss_progress (player_id, boss_id, current_hp, max_hp, started_at, last_attack)
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 ON CONFLICT (player_id, boss_id)
                 DO UPDATE SET current_hp = $3, max_hp = $4, started_at = NOW(), last_attack = NOW()`,
                [playerId, bossId, boss.max_health, boss.max_health]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'solo',
                     active_raid_id = NULL
                 WHERE id = $2`,
                [bossId, playerId]
            );

            await client.query('COMMIT');

            return res.json({
                success: true,
                data: {
                    mode: 'solo',
                    keys_spent: bossId > 1 ? KEYS_REQUIRED_FOR_BOSS : 0,
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        icon: boss.icon,
                        hp: boss.max_health,
                        max_hp: boss.max_health
                    },
                    time_remaining_ms: SOLO_FIGHT_DURATION_MS
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === 'INSUFFICIENT_KEYS') {
                return res.status(400).json(error);
            }
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'solo_start');
    } finally {
        client.release();
    }
});

router.get('/bonuses', async (req, res) => {
    const client = await pool.connect();

    try {
        const playerId = req.player.id;
        const player = await getPlayerBaseState(client, playerId);
        const masteries = await getBossMasteries(client, playerId);
        const masteryMap = Object.fromEntries(masteries.map((m) => [m.boss_id, m.kills]));
        const bossesResult = await client.query('SELECT id, name FROM bosses ORDER BY id');

        res.json({
            success: true,
            data: {
                player_level: player.level,
                bonuses: bossesResult.rows.map((boss) => ({
                    boss_id: boss.id,
                    boss_name: boss.name,
                    defeated_count: masteryMap[boss.id] || 0,
                    current_damage: calculateDamage(boss.id, player, masteries),
                    mastery_bonus: calculateDamageBonus(boss.id, masteries)
                }))
            }
        });
    } catch (error) {
        return handleError(res, error, 'bonuses');
    } finally {
        client.release();
    }
});

router.get('/', async (req, res) => {
    const client = await pool.connect();

    try {
        const playerId = req.player.id;
        const player = await getPlayerBaseState(client, playerId);
        const activeBattle = await resolveActiveBattle(client, playerId);
        const masteries = await getBossMasteries(client, playerId);
        const masteryMap = Object.fromEntries(masteries.map((m) => [m.boss_id, m.kills]));

        const bossesResult = await client.query('SELECT * FROM bosses ORDER BY id');

        const bossList = [];
        for (const boss of bossesResult.rows) {
            const ownedKeys = boss.id === 1 ? 0 : await getPlayerKeyCount(client, playerId, boss.id - 1);
            const isUnlocked = boss.id === 1 || ownedKeys >= KEYS_REQUIRED_FOR_BOSS;
            const soloProgress = activeBattle?.type === 'solo' && activeBattle.boss_id === boss.id
                ? activeBattle.boss.hp
                : boss.max_health;

            bossList.push({
                id: boss.id,
                name: boss.name,
                description: boss.description,
                icon: boss.icon,
                hp: soloProgress,
                max_hp: boss.max_health,
                reward_coins: boss.reward_coins,
                reward_experience: boss.reward_experience,
                required_keys: boss.id === 1 ? 0 : KEYS_REQUIRED_FOR_BOSS,
                owned_keys: ownedKeys,
                is_unlocked: isUnlocked,
                defeated_count: masteryMap[boss.id] || 0,
                mastery: masteryMap[boss.id] || 0,
                current_damage: calculateDamage(boss.id, player, masteries),
                can_start_solo: isUnlocked && !activeBattle,
                can_start_mass: isUnlocked && !activeBattle
            });
        }

        const raids = await getActiveRaids(client, playerId);

        res.json({
            success: true,
            data: {
                bosses: bossList,
                raids: raids.raids,
                participating_boss_ids: raids.participatingIds,
                player_energy: player.energy,
                player_max_energy: player.max_energy,
                player_level: player.level,
                active_battle: activeBattle,
                fight_duration_ms: SOLO_FIGHT_DURATION_MS,
                raid_duration_ms: MASS_FIGHT_DURATION_MS,
                info: {
                    solo: 'Соло-бой: старт через кнопку, 1 удар = 1 энергия, бой длится 8 часов.',
                    mastery: 'Каждая победа над боссом увеличивает урон по нему и частично усиливает урон по следующим боссам.',
                    raids: 'Массовый бой — отдельный режим на 8 часов. Награды и предметы делятся пропорционально урону, ключ получает только лидер.'
                }
            }
        });
    } catch (error) {
        return handleError(res, error, 'boss_list');
    } finally {
        client.release();
    }
});

router.post('/attack-boss', async (req, res) => {
    const client = await pool.connect();

    try {
        const bossId = Number(req.body?.boss_id);
        const playerId = req.player.id;

        if (!validateBossId(bossId)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
        }

        await client.query('BEGIN');

        try {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'solo' || activeBattle.boss_id !== bossId) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Сначала начните соло-бой с этим боссом',
                    code: 'BOSS_NOT_STARTED'
                });
            }

            const player = await getPlayerBaseState(client, playerId);
            if (player.energy < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    energy: player.energy,
                    energy_required: 1
                });
            }

            // Проверяем здоровье игрока
            if (player.health <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Вы мертвы. Нельзя атаковать босса.',
                    code: 'PLAYER_DEAD'
                });
            }

            const masteries = await getBossMasteries(client, playerId);
            const damage = calculateDamage(bossId, player, masteries);
            const newHp = Math.max(0, activeBattle.boss.hp - damage);

            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - 1),
                     last_energy_update = NOW()
                 WHERE id = $1
                 RETURNING energy`,
                [playerId]
            );

            await client.query(
                `UPDATE player_boss_progress
                 SET current_hp = $1, last_attack = NOW()
                 WHERE player_id = $2 AND boss_id = $3`,
                [newHp, playerId, bossId]
            );

            let killed = false;
            let rewards = null;
            let mastery = masteries.find((m) => m.boss_id === bossId)?.kills || 0;

            if (newHp <= 0) {
                killed = true;

                const boss = await getBossById(client, bossId);
                rewards = {
                    coins: boss.reward_coins || 0,
                    experience: boss.reward_experience || 0
                };

                if (boss.reward_coins > 0) {
                    await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [boss.reward_coins, playerId]);
                }

                if (boss.reward_experience > 0) {
                    await playerHelper.addExperience(playerId, boss.reward_experience, client);
                }

                const grantedKey = await grantNextBossKey(client, playerId, bossId);
                if (grantedKey) {
                    rewards.key = grantedKey;
                }

                const grantedItems = await grantRewardItems(client, playerId, boss.reward_items, Math.random() < 0.5 ? 1 : 0);
                if (grantedItems.length) {
                    rewards.items = grantedItems;
                }

                await client.query(
                    `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                     VALUES ($1, $2, 1, NOW())
                     ON CONFLICT (player_id, boss_id)
                     DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
                    [playerId, bossId]
                );

                mastery += 1;

                await client.query('UPDATE players SET bosses_killed = bosses_killed + 1 WHERE id = $1', [playerId]);
                await client.query('DELETE FROM player_boss_progress WHERE player_id = $1 AND boss_id = $2', [playerId, bossId]);
                await clearPlayerActiveBattle(client, playerId);
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                boss_hp: newHp,
                boss_max_hp: activeBattle.boss.max_hp,
                damage_dealt: damage,
                boss_defeated: killed,
                player_energy: energyResult.rows[0].energy,
                mastery,
                rewards,
                data: {
                    boss: {
                        id: bossId,
                        hp: newHp,
                        max_hp: activeBattle.boss.max_hp
                    },
                    damage,
                    killed,
                    rewards,
                    mastery,
                    energy_left: energyResult.rows[0].energy
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'solo_attack');
    } finally {
        client.release();
    }
});

router.get('/raids', async (req, res) => {
    const client = await pool.connect();

    try {
        const raids = await getActiveRaids(client, req.player.id);
        res.json({
            success: true,
            data: {
                raids: raids.raids,
                participating_boss_ids: raids.participatingIds
            }
        });
    } catch (error) {
        return handleError(res, error, 'raids');
    } finally {
        client.release();
    }
});

router.post('/raid/start', async (req, res) => {
    const client = await pool.connect();

    try {
        const bossId = Number(req.body?.boss_id);
        const playerId = req.player.id;
        const playerName = req.player.first_name || 'Игрок';

        if (!validateBossId(bossId)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
        }

        await client.query('BEGIN');

        try {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                await client.query('ROLLBACK');
                return res.status(400).json(buildAlreadyInFightResponse(activeBattle));
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Босс не найден', code: 'BOSS_NOT_FOUND' });
            }

            if (bossId > 1) {
                await spendBossKeys(client, playerId, bossId - 1);
            }

            const existingRaid = await client.query(
                `SELECT id FROM raid_progress
                 WHERE boss_id = $1 AND is_active = true AND is_raid = true AND expires_at > NOW()`,
                [bossId]
            );

            if (existingRaid.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Массовый бой на этого босса уже идёт',
                    code: 'RAID_ALREADY_ACTIVE',
                    raid_id: existingRaid.rows[0].id
                });
            }

            const expiresAt = new Date(Date.now() + MASS_FIGHT_DURATION_MS);

            const raidResult = await client.query(
                `INSERT INTO raid_progress
                 (boss_id, current_health, max_health, started_at, expires_at, is_active, is_raid, leader_id, leader_name)
                 VALUES ($1, $2, $3, NOW(), $4, true, true, $5, $6)
                 RETURNING id`,
                [bossId, boss.max_health, boss.max_health, expiresAt, playerId, playerName]
            );

            const raidId = raidResult.rows[0].id;

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())`,
                [bossId, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [bossId, raidId, playerId]
            );

            await client.query('COMMIT');

            return res.json({
                success: true,
                data: {
                    raid_id: raidId,
                    mode: 'mass',
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        icon: boss.icon,
                        hp: boss.max_health,
                        max_hp: boss.max_health
                    },
                    keys_spent: bossId > 1 ? KEYS_REQUIRED_FOR_BOSS : 0,
                    expires_at: expiresAt,
                    time_remaining_ms: MASS_FIGHT_DURATION_MS
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === 'INSUFFICIENT_KEYS') {
                return res.status(400).json(error);
            }
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'mass_start');
    } finally {
        client.release();
    }
});

router.post('/raid/:id/join', async (req, res) => {
    const client = await pool.connect();

    try {
        const raidId = Number(req.params.id);
        const playerId = req.player.id;

        if (!raidId || raidId <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID рейда', code: 'INVALID_RAID_ID' });
        }

        await client.query('BEGIN');

        try {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'mass' && activeBattle.raid_id === raidId) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Вы уже участвуете в этом массовом бою', code: 'ALREADY_PARTICIPATING' });
                }

                await client.query('ROLLBACK');
                return res.status(400).json(buildAlreadyInFightResponse(activeBattle));
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                        b.name AS boss_name, b.icon
                 FROM raid_progress rp
                 JOIN bosses b ON b.id = rp.boss_id
                 WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Массовый бой не найден', code: 'RAID_NOT_FOUND' });
            }

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())`,
                [raid.boss_id, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [raid.boss_id, raidId, playerId]
            );

            await client.query('COMMIT');

            return res.json({
                success: true,
                data: {
                    raid_id: raidId,
                    mode: 'mass',
                    boss: {
                        id: raid.boss_id,
                        name: raid.boss_name,
                        icon: raid.icon,
                        hp: raid.current_health,
                        max_hp: raid.max_health
                    },
                    expires_at: raid.expires_at
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'mass_join');
    } finally {
        client.release();
    }
});

router.post('/raid/:id/attack', async (req, res) => {
    const client = await pool.connect();

    try {
        const raidId = Number(req.params.id);
        const playerId = req.player.id;

        if (!raidId || raidId <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите корректный ID рейда', code: 'INVALID_RAID_ID' });
        }

        await client.query('BEGIN');

        try {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'mass' || activeBattle.raid_id !== raidId) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Вы не участвуете в этом массовом бою', code: 'NOT_PARTICIPATING' });
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at, rp.leader_id,
                        b.name AS boss_name, b.reward_coins, b.reward_experience, b.reward_items
                 FROM raid_progress rp
                 JOIN bosses b ON b.id = rp.boss_id
                 WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
                 FOR UPDATE`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Массовый бой не найден', code: 'RAID_NOT_FOUND' });
            }

            const sessionResult = await client.query(
                'SELECT * FROM boss_sessions WHERE player_id = $1 AND raid_id = $2 FOR UPDATE',
                [playerId, raidId]
            );

            const session = sessionResult.rows[0];
            if (!session) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Вы не участвуете в этом массовом бою', code: 'NOT_PARTICIPATING' });
            }

            const player = await getPlayerBaseState(client, playerId);
            if (player.energy < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Недостаточно энергии', code: 'INSUFFICIENT_ENERGY' });
            }

            const masteries = await getBossMasteries(client, playerId);
            const damage = calculateDamage(raid.boss_id, player, masteries);
            const newHp = Math.max(0, raid.current_health - damage);
            const newTotalDamage = session.damage_dealt + damage;

            await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - 1),
                     last_energy_update = NOW()
                 WHERE id = $1`,
                [playerId]
            );

            await client.query('UPDATE raid_progress SET current_health = $1 WHERE id = $2', [newHp, raidId]);
            await client.query('UPDATE boss_sessions SET damage_dealt = $1, last_hit_at = NOW() WHERE player_id = $2 AND raid_id = $3', [newTotalDamage, playerId, raidId]);

            let killed = false;
            let rewards = null;

            if (newHp <= 0) {
                killed = true;
                await client.query('UPDATE raid_progress SET is_active = false, ended_at = NOW(), current_health = 0 WHERE id = $1', [raidId]);

                const participantsResult = await client.query(
                    'SELECT player_id, damage_dealt FROM boss_sessions WHERE raid_id = $1 AND damage_dealt > 0',
                    [raidId]
                );

                const participants = participantsResult.rows;
                const totalDamage = participants.reduce((sum, row) => sum + Number(row.damage_dealt || 0), 0) || 1;
                const participantIds = participants.map((row) => row.player_id);

                for (const participant of participants) {
                    const share = Number(participant.damage_dealt || 0) / totalDamage;
                    const coinsReward = Math.floor((raid.reward_coins || 0) * share);
                    const experienceReward = Math.floor((raid.reward_experience || 0) * share);

                    if (coinsReward > 0) {
                        await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [coinsReward, participant.player_id]);
                    }

                    if (experienceReward > 0) {
                        await playerHelper.addExperience(participant.player_id, experienceReward, client);
                    }

                    const grantedItems = await grantRewardItems(client, participant.player_id, raid.reward_items, share);

                    if (participant.player_id === playerId) {
                        rewards = {
                            coins: coinsReward,
                            experience: experienceReward
                        };
                        if (grantedItems.length) {
                            rewards.items = grantedItems;
                        }
                    }

                    await client.query(
                        `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                         VALUES ($1, $2, 1, NOW())
                         ON CONFLICT (player_id, boss_id)
                         DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
                        [participant.player_id, raid.boss_id]
                    );

                    await client.query('UPDATE players SET bosses_killed = bosses_killed + 1 WHERE id = $1', [participant.player_id]);
                }

                const leaderKey = await grantNextBossKey(client, raid.leader_id, raid.boss_id);
                if (playerId === raid.leader_id && leaderKey) {
                    rewards = rewards || { coins: 0, experience: 0 };
                    rewards.key = leaderKey;
                }

                await clearActiveBattleForPlayers(client, participantIds);
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                data: {
                    raid: {
                        id: raidId,
                        hp: newHp,
                        max_hp: raid.max_health,
                        hp_percent: raid.max_health > 0 ? Math.round((newHp / raid.max_health) * 100) : 0
                    },
                    damage,
                    your_total_damage: newTotalDamage,
                    killed,
                    rewards
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'mass_attack');
    } finally {
        client.release();
    }
});

router.get('/active', async (req, res) => {
    const client = await pool.connect();

    try {
        const activeBattle = await resolveActiveBattle(client, req.player.id);

        res.json({
            success: true,
            data: {
                has_active_boss: Boolean(activeBattle),
                active_boss: activeBattle
            }
        });
    } catch (error) {
        return handleError(res, error, 'active');
    } finally {
        client.release();
    }
});

module.exports = router;
