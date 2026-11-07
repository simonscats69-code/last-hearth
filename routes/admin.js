/**
 * Admin API <0@H@CBK
 * #?@02;5=85 83@>:0<8, 1>AA0<8, AB0B8AB8:>9
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { telegramAuthMiddleware, logger } = require('../utils/serverApi');
const { isAdmin } = require('../utils/adminIds');

// @8<5=O5< telegramAuthMiddleware :> 2A5< admin @>CB0<
// -B> CAB0=02;8205B req.telegramUser ?>A;5 20;840F88 ?>4?8A8 Telegram
router.use(telegramAuthMiddleware);

/**
 * @>25@:0 :telegramId 87 ?0@0<5B@>2 <0@H@CB0.
 *
 *  0=LH5 >4=0 8 B0 65 ?@>25@:0 :>?8@>20;0AL 2 4 >1@01>BG8:0. @><5
 * 4C1;8@>20=8O, isNaN(Number(x)) ?@>?CA:05B =5-G8A;>2K5 7=0G5=8O:
 * Number('') === 0, Number('1e3') === 1000, Number('0x10') === 16,
 * Number('Infinity') === Infinity  2A5 40NB isNaN === false.
 * SQL-8=J5:F88 MB> =5 4020;> (7=0G5=85 84QB ?0@0<5B@>< $n), =>
 * <CA>@=K9 ID 4>E>48; 4>  8 ?040; B0< >H81:>9 B8?0 2<5AB> ?>=OB=>3> 400.
 *
 * @returns {string|null} B5:AB >H81:8 8;8 null, 5A;8 ID :>@@5:B5=
 */
function validateTelegramIdParam(rawId) {
    if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
        return '5 C:070= Telegram ID';
    }
    const str = String(rawId).trim();
    if (!/^\d{1,20}$/.test(str)) {
        return '5:>@5:B=K9 Telegram ID';
    }
    const num = Number(str);
    if (!Number.isSafeInteger(num) || num <= 0) {
        return '5:>@5:B=K9 Telegram ID';
    }
    return null;
}

// Middleware 4;O ?@>25@:8 04<8=0
// : 8A?>;L7C5< req.telegramUser CAB0=>2;5==K9 telegramAuthMiddleware
function requireAdmin(req, res, next) {
    // !=0G0;0 ?@>25@O5< GB> ?>;L7>20B5;L ?@>HQ; 20;840F8N Telegram
    if (!req.telegramUser) {
        return res.status(401).json({ error: '"@51C5BAO 20;84=0O 02B>@870F8O Telegram' });
    }
    
    const telegramId = String(req.telegramUser.id);
    
    if (!isAdmin(telegramId)) {
        logger.warn({ type: 'admin_access_denied', telegramId });
        return res.status(403).json({ error: '>ABC? 70?@5IQ=' });
    }
    
    next();
}

// >;CG8BL AB0B8AB8:C A5@25@0
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const stats = {};
        
        // >;8G5AB2> 83@>:>2
        const playersResult = await query('SELECT COUNT(*) as count FROM players');
        stats.totalPlayers = parseInt(playersResult.rows[0].count, 10);
        
        // >;8G5AB2> :;0=>2
        const clansResult = await query('SELECT COUNT(*) as count FROM clans');
        stats.totalClans = parseInt(clansResult.rows[0].count, 10);
        
        // :B82=K5 83@>:8 70 ?>A;54=85 24 G0A0
        const activeResult = await query(
            "SELECT COUNT(*) as count FROM players WHERE last_action_time > NOW() - INTERVAL '24 hours'"
        );
        stats.activePlayers24h = parseInt(activeResult.rows[0].count, 10);
        
        // ">? 83@>:8 ?> C@>2=N
        const topResult = await query(
            'SELECT telegram_id, username, level, strength FROM players ORDER BY level DESC LIMIT 10'
        );
        stats.topPlayers = topResult.rows;
        
        res.json({ success: true, stats });
    } catch (err) {
        logger.error({ type: 'admin_stats_error', message: err.message });
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O AB0B8AB8:8' });
    }
});

// >;CG8BL 8=D>@<0F8N > 83@>:5
router.get('/player/:telegramId', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // 0;840F8O telegramId
        const idError = validateTelegramIdParam(telegramId);
        if (idError) {
            return res.status(400).json({ error: idError });
        }
        
        const result = await query(
            `SELECT telegram_id, username, level, strength, endurance, agility, 
                    intelligence, luck, health, radiation,
                    energy, max_energy, experience, created_at, last_action_time
             FROM players WHERE telegram_id = $1`,
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '3@>: =5 =0945=' });
        }
        
        res.json({ success: true, player: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_player_error', message: err.message });
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O 83@>:0' });
    }
});

// 7<5=8BL @5AC@AK 83@>:0
router.post('/player/:telegramId/resources', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // 0;840F8O telegramId
        const idError = validateTelegramIdParam(telegramId);
        if (idError) {
            return res.status(400).json({ error: idError });
        }
        
        const { energy, health, experience } = req.body;
        // 0;840F8O 2E>4=KE 40==KE
        if (energy !== undefined) {
            if (!Number.isInteger(energy) || energy < 0 || energy > 10000) {
                return res.status(400).json({ error: 'energy 4>;65= 1KBL F5;K< G8A;>< >B 0 4> 10000' });
            }
        }
        
        if (health !== undefined) {
            if (!Number.isInteger(health) || health < 0 || health > 10000) {
                return res.status(400).json({ error: 'health 4>;65= 1KBL F5;K< G8A;>< >B 0 4> 10000' });
            }
        }
        
        if (experience !== undefined) {
            if (!Number.isInteger(experience) || experience < 0 || experience > 1000000) {
                return res.status(400).json({ error: 'experience 4>;65= 1KBL F5;K< G8A;>< >B 0 4> 1000000' });
            }
        }
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (energy !== undefined) {
            updates.push(`energy = $${paramIndex++}`);
            values.push(energy);
        }
        
        if (health !== undefined) {
            updates.push(`health = $${paramIndex++}`);
            values.push(health);
            // 5B:0 @535=0 74>@>2LO. 57 5Q A1@>A0 83@>:, :>B>@><C 04<8=
            // 2K40; HP �2 ?;NA�, =5 <>3 2>AAB0=>28BLAO: regenerateHealth
            // AG8B05B H038 >B last_hp_regen, 0 >=0 >AB0;0AL =0 <><5=B5
            // A<5@B8  4> A;54CNI53> H030 (90 A5:C=4) 2K40==K9 HP ?@>AB>
            // 28A5;, =5 4>E>4O 4> ?>B>;:0 @535=5@0F88.
            updates.push('last_hp_regen = NOW()');
        }
        
        if (experience !== undefined) {
            updates.push(`experience = $${paramIndex++}`);
            values.push(experience);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: '5 C:070=K @5AC@AK 4;O 87<5=5=8O' });
        }
        
        values.push(telegramId);
        
        const result = await query(
            `UPDATE players SET ${updates.join(', ')} WHERE telegram_id = $${paramIndex} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '3@>: =5 =0945=' });
        }
        
        logger.info({ 
            type: 'admin_resource_change', 
            telegramId, 
            changes: { energy, health, experience },
            admin: req.telegramUser?.id
        });
        
        res.json({ success: true, player: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_resource_error', message: err.message });
        res.status(500).json({ error: 'H81:0 87<5=5=8O @5AC@A>2' });
    }
});

// 010=8BL 83@>:0
router.post('/player/:telegramId/ban', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // 0;840F8O telegramId
        const idError = validateTelegramIdParam(telegramId);
        if (idError) {
            return res.status(400).json({ error: idError });
        }
        
        const { reason } = req.body;
        
        const result = await query(
            "UPDATE players SET banned = true, ban_reason = $1 WHERE telegram_id = $2 RETURNING *",
            [reason || '0@CH5=85 ?@028;', telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '3@>: =5 =0945=' });
        }
        
        logger.info({ 
            type: 'player_banned', 
            telegramId, 
            reason,
            admin: req.telegramUser?.id
        });
        
        res.json({ success: true, message: 'Игрок заблокирован' });
    } catch (err) {
        logger.error({ type: 'admin_ban_error', message: err.message });
        res.status(500).json({ error: 'H81:0 10=0' });
    }
});

//  0710=8BL 83@>:0
router.post('/player/:telegramId/unban', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // 0;840F8O telegramId
        const idError = validateTelegramIdParam(telegramId);
        if (idError) {
            return res.status(400).json({ error: idError });
        }
        
        const result = await query(
            "UPDATE players SET banned = false, ban_reason = NULL WHERE telegram_id = $1 RETURNING *",
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '3@>: =5 =0945=' });
        }
        
        logger.info({ 
            type: 'player_unbanned', 
            telegramId,
            admin: req.telegramUser?.id
        });
        
        res.json({ success: true, message: 'Игрок разблокирован' });
    } catch (err) {
        logger.error({ type: 'admin_unban_error', message: err.message });
        res.status(500).json({ error: 'H81:0 @0710=0' });
    }
});

// >;CG8BL A?8A>: 701;>:8@>20==KE 83@>:>2
router.get('/banned', requireAdmin, async (req, res) => {
    try {
        const result = await query(
            "SELECT telegram_id, username, ban_reason, last_action_time FROM players WHERE banned = true"
        );
        
        res.json({ success: true, players: result.rows });
    } catch (err) {
        logger.error({ type: 'admin_banned_list_error', message: err.message });
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O A?8A:0' });
    }
});

// #?@02;5=85 1>AA0<8 - ?>;CG8BL 2A5E 1>AA>2
router.get('/bosses', requireAdmin, async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM bosses ORDER BY level'
        );
        
        res.json({ success: true, bosses: result.rows });
    } catch (err) {
        logger.error({ type: 'admin_bosses_error', message: err.message });
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O 1>AA>2' });
    }
});

// 7<5=8BL 1>AA0
router.put('/bosses/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, max_health, damage, reward_experience, reward_items } = req.body;
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (name !== undefined) {
            if (typeof name !== 'string' || name.length > 100) {
                return res.status(400).json({ error: 'name 4>;65= 1KBL AB@>:>9 4> 100 A8<2>;>2' });
            }
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        const normalizedMaxHealth = max_health;
        if (normalizedMaxHealth !== undefined) {
            if (!Number.isInteger(normalizedMaxHealth) || normalizedMaxHealth < 1 || normalizedMaxHealth > 1000000) {
                return res.status(400).json({ error: 'max_health 4>;65= 1KBL F5;K< G8A;>< >B 1 4> 1000000' });
            }
            updates.push(`max_health = $${paramIndex++}`);
            values.push(normalizedMaxHealth);
        }
        if (damage !== undefined) {
            if (!Number.isInteger(damage) || damage < 0 || damage > 100000) {
                return res.status(400).json({ error: 'damage 4>;65= 1KBL F5;K< G8A;>< >B 0 4> 100000' });
            }
            updates.push(`damage = $${paramIndex++}`);
            values.push(damage);
        }
        const normalizedRewardExp = reward_experience;
        if (normalizedRewardExp !== undefined) {
            if (!Number.isInteger(normalizedRewardExp) || normalizedRewardExp < 0 || normalizedRewardExp > 1000000) {
                return res.status(400).json({ error: 'reward_experience 4>;65= 1KBL F5;K< G8A;>< >B 0 4> 1000000' });
            }
            updates.push(`reward_experience = $${paramIndex++}`);
            values.push(normalizedRewardExp);
        }
        if (reward_items !== undefined) {
            if (!Array.isArray(reward_items)) {
                return res.status(400).json({ error: 'reward_items 4>;65= 1KBL <0AA82><' });
            }
            updates.push(`reward_items = $${paramIndex++}`);
            values.push(JSON.stringify(reward_items));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: '5 C:070=K 40==K5 4;O 87<5=5=8O' });
        }
        
        values.push(id);
        
        const result = await query(
            `UPDATE bosses SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '>AA =5 =0945=' });
        }
        
        logger.info({ 
            type: 'boss_updated', 
            bossId: id, 
            changes: req.body,
            admin: req.telegramUser?.id
        });
        
        res.json({ success: true, boss: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_boss_update_error', message: err.message });
        res.status(500).json({ error: 'H81:0 87<5=5=8O 1>AA0' });
    }
});

module.exports = router;
