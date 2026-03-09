/**
 * Реферальная система
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../../db/database');

/**
 * Получение реферального кода
 */
router.get('/referral/code', async (req, res) => {
    try {
        const player = req.player;
        
        res.json({
            code: player.referral_code || null,
            uses_count: player.referrals_used || 0
        });
        
    } catch (error) {
        console.error('Ошибка /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Установка реферального кода
 */
async function useReferralCode(player, code, res) {
    if (!code) {
        return res.status(400).json({ error: 'Укажите код' });
    }
    
    // Валидация формата кода
    if (!/^[A-Z0-9]{4,16}$/i.test(code)) {
        return res.json({
            success: false,
            message: 'Неверный формат кода'
        });
    }
    
    if (player.referred_by) {
        return res.json({
            success: false,
            message: 'Вы уже использовали реферальный код'
        });
    }
    
    // Ищем игрока с этим кодом
    const referrer = await queryOne(`
        SELECT id, referral_code FROM players WHERE referral_code = $1
    `, [code]);
    
    if (!referrer) {
        return res.json({
            success: false,
            message: 'Неверный реферальный код'
        });
    }
    
    if (referrer.id === player.id) {
        return res.json({
            success: false,
            message: 'Нельзя использовать свой код'
        });
    }
    
    // Устанавливаем реферала
    await query(`
        UPDATE players SET referred_by = $1 WHERE id = $2
    `, [referrer.id, player.id]);
    
    // Даём бонус рефереру
    await query(`
        UPDATE players SET coins = coins + 100 WHERE id = $1
    `, [referrer.id]);
    
    return res.json({
        success: true,
        message: 'Реферальный код активирован!',
        referrer_id: referrer.id
    });
}

router.put('/referral/code', async (req, res) => {
    try {
        const { code } = req.body;
        const player = req.player;
        await useReferralCode(player, code, res);
    } catch (error) {
        console.error('Ошибка /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Статистика рефералов
 */
router.get('/referral/stats', async (req, res) => {
    try {
        const player = req.player;
        
        // Получаем своих рефералов
        const referrals = await queryAll(`
            SELECT id, username, first_name, level, created_at
            FROM players 
            WHERE referred_by = $1
        `, [player.id]);
        
        const totalEarnings = referrals.length * 100;
        
        res.json({
            referrals_count: referrals.length,
            total_earnings: totalEarnings,
            referrals: referrals
        });
        
    } catch (error) {
        console.error('Ошибка /referral/stats:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Использование реферального кода (POST)
 */
router.post('/referral/use', async (req, res) => {
    try {
        const { code } = req.body;
        const player = req.player;
        await useReferralCode(player, code, res);
    } catch (error) {
        console.error('Ошибка /referral/use:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Список рефералов
 */
router.get('/referral/list', async (req, res) => {
    try {
        const player = req.player;
        
        const referrals = await queryAll(`
            SELECT telegram_id, username, first_name, level, created_at
            FROM players 
            WHERE referred_by = $1
            ORDER BY created_at DESC
        `, [player.id]);
        
        res.json({
            referrals: referrals
        });
        
    } catch (error) {
        console.error('Ошибка /referral/list:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Получение бонуса за реферала
 */
router.post('/referral/claim-bonus', async (req, res) => {
    try {
        const player = req.player;
        
        if (!player.referred_by) {
            return res.json({
                success: false,
                message: 'Вы не были приглашены'
            });
        }
        
        // Проверяем, не получен ли уже бонус
        if (player.referral_bonus_claimed) {
            return res.json({
                success: false,
                message: 'Бонус уже получен'
            });
        }
        
        // Бонус за регистрацию
        await query(`
            UPDATE players SET coins = coins + 50, referral_bonus_claimed = true WHERE id = $1
        `, [player.id]);
        
        res.json({
            success: true,
            message: 'Бонус получен!',
            coins: 50
        });
        
    } catch (error) {
        console.error('Ошибка /referral/claim-bonus:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

module.exports = router;
