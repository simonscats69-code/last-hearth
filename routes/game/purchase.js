/**
 * Покупка товаров за Stars
 * Обрабатывает покупку баффов, косметики и мини-игр
 */

const express = require('express');
const router = express.Router();
const { pool, query } = require('../../db/database');
const { logger, handleError } = require('../../utils/serverApi');

const BUFFS_CONFIG = {
    'buff_loot_1h': { name: 'x2 Добыча', duration: 3600, effect: 'loot_x2', stars: 5 },
    'buff_energy_1h': { name: 'Бесплатная энергия', duration: 3600, effect: 'free_energy', stars: 3 },
    'buff_radiation_1h': { name: 'Анти-rad', duration: 3600, effect: 'no_radiation', stars: 2 },
    'buff_exp_1h': { name: 'x2 Опыт', duration: 3600, effect: 'exp_x2', stars: 4 },
    'buff_loot_daily': { name: 'x2 Добыча (24ч)', duration: 86400, effect: 'loot_x2', stars: 20 },
};

const COSMETICS_CONFIG = {
    'cosm_glow_gold': { name: 'Золотое свечение', effect: 'glow_gold', stars: 50 },
    'cosm_glow_blue': { name: 'Синее свечение', effect: 'glow_blue', stars: 30 },
    'cosm_frame_elite': { name: 'Элитная рамка', effect: 'frame_elite', stars: 100 },
    'cosm_title_veteran': { name: 'Звание: Ветеран', effect: 'title_veteran', stars: 25 },
    'cosm_particles_fire': { name: 'Огненные частицы', effect: 'particles_fire', stars: 40 },
};

function getItemConfig(itemId) {
    return BUFFS_CONFIG[itemId] || COSMETICS_CONFIG[itemId] || null;
}

async function grantPlayerBuff(client, playerId, effect, expiresAt) {
    const playerBuffs = await client.query(
        'SELECT buffs FROM players WHERE id = $1',
        [playerId]
    );
    
    let buffs = {};
    if (playerBuffs.rows[0]?.buffs) {
        try {
            buffs = typeof playerBuffs.rows[0].buffs === 'string' 
                ? JSON.parse(playerBuffs.rows[0].buffs) 
                : playerBuffs.rows[0].buffs;
        } catch (e) {
            buffs = {};
        }
    }
    
    buffs[effect] = { expires_at: expiresAt.toISOString() };
    
    await client.query(
        'UPDATE players SET buffs = $1 WHERE id = $2',
        [JSON.stringify(buffs), playerId]
    );
}

async function grantPlayerCosmetic(client, playerId, effect) {
    const playerCosmetics = await client.query(
        'SELECT cosmetics FROM players WHERE id = $1',
        [playerId]
    );
    
    let cosmetics = [];
    if (playerCosmetics.rows[0]?.cosmetics) {
        try {
            cosmetics = typeof playerCosmetics.rows[0].cosmetics === 'string' 
                ? JSON.parse(playerCosmetics.rows[0].cosmetics) 
                : playerCosmetics.rows[0].cosmetics;
        } catch (e) {
            cosmetics = [];
        }
    }
    
    if (!cosmetics.includes(effect)) {
        cosmetics.push(effect);
    }
    
    await client.query(
        'UPDATE players SET cosmetics = $1 WHERE telegram_id = $2',
        [JSON.stringify(cosmetics), playerId]
    );
}

/**
 * POST /purchase - покупка товара за Stars
 */
router.post('/', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { item_id, currency = 'stars' } = req.body;
        const playerId = req.player.id;
        
        if (currency !== 'stars') {
            return res.status(400).json({
                success: false,
                error: 'Этот endpoint принимает только Stars',
                code: 'INVALID_CURRENCY'
            });
        }
        
        const itemConfig = getItemConfig(item_id);
        if (!itemConfig) {
            return res.status(404).json({
                success: false,
                error: 'Товар не найден',
                code: 'ITEM_NOT_FOUND'
            });
        }
        
        const price = itemConfig.stars;
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(
                'SELECT stars FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );
            
            const player = playerResult.rows[0];
            const playerStars = player?.stars || 0;
            
            if (playerStars < price) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно Stars',
                    code: 'INSUFFICIENT_STARS',
                    stars: playerStars,
                    required: price
                });
            }
            
            await client.query(
                'UPDATE players SET stars = stars - $1 WHERE telegram_id = $2',
                [price, playerId]
            );
            
            let reward = null;
            
            if (BUFFS_CONFIG[item_id]) {
                const expiresAt = new Date(Date.now() + itemConfig.duration * 1000);
                await grantPlayerBuff(client, playerId, itemConfig.effect, expiresAt);
                reward = {
                    type: 'buff',
                    effect: itemConfig.effect,
                    expires_at: expiresAt.toISOString()
                };
            } else if (COSMETICS_CONFIG[item_id]) {
                await grantPlayerCosmetic(client, playerId, itemConfig.effect);
                reward = {
                    type: 'cosmetic',
                    effect: itemConfig.effect
                };
            }
            
            await client.query('COMMIT');
            
            logger.info(`[purchase] Игрок ${playerId} купил ${item_id} за ${price} Stars`);
            
            res.json({
                success: true,
                message: `Куплено: ${itemConfig.name}`,
                purchased_item: {
                    id: item_id,
                    name: itemConfig.name,
                    reward: reward
                },
                new_stars: playerStars - price,
                balance: playerStars - price
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    } catch (error) {
        return handleError(res, error, 'purchase');
    } finally {
        client.release();
    }
});

module.exports = router;
