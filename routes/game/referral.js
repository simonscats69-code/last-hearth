/**
 * Реферальная система
 */

const express = require('express');
const router = express.Router();
const {
    queryOne,
    createReferralCode,
    changeReferralCode,
    applyReferralCode,
    giveReferralRegistrationBonus,
    getReferralsList,
    getReferralStats
} = require('../../db/database');
const { logger } = require('../../utils/serverApi');

/**
 * Получение реферального кода
 * GET /referral/code → GET /api/game/referral/code
 * Путь: /code (внутри роутера)
 */
router.get('/code', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const player = await queryOne(
            'SELECT referral_code, referral_code_changed FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }

        let code = player.referral_code;
        if (!code) {
            code = await createReferralCode(playerId);
        }

        res.json({
            success: true,
            code,
            can_change: player.referral_code_changed !== true
        });
        
    } catch (error) {
        logger.error('[referral] Ошибка /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Установка реферального кода
 * PUT /referral/code → PUT /api/game/referral/code
 * Путь: /code (внутри роутера)
 */
router.put('/code', async (req, res) => {
    try {
        const newCode = String(req.body?.new_code || '').trim().toUpperCase();
        const result = await changeReferralCode(req.player.id, newCode);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        logger.error('[referral] Ошибка PUT /referral/code:', error);
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Статистика рефералов
 * GET /referral/stats → GET /api/game/referral/stats
 * Путь: /stats (внутри роутера)
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await getReferralStats(req.player.id);

        res.json({
            success: true,
            stats
        });
        
    } catch (error) {
        logger.error({ type: 'referral_stats_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Использование реферального кода (POST)
 * POST /referral/use → POST /api/game/referral/use
 * Путь: /use (внутри роутера)
 */
router.post('/use', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const result = await applyReferralCode(req.player.id, code);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        logger.error({ type: 'referral_use_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Список рефералов
 * GET /referral/list → GET /api/game/referral/list
 * Путь: /list (внутри роутера)
 */
router.get('/list', async (req, res) => {
    try {
        const referrals = await getReferralsList(req.player.id);
        
        res.json({
            success: true,
            referrals: referrals
        });
        
    } catch (error) {
        logger.error({ type: 'referral_list_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

/**
 * Получение бонуса за реферала
 * POST /referral/claim-bonus → POST /api/game/referral/claim-bonus
 * Путь: /claim-bonus (внутри роутера)
 */
router.post('/claim-bonus', async (req, res) => {
    try {
        const result = await giveReferralRegistrationBonus(req.player.id);
        res.status(result.success ? 200 : 400).json(result);
        
    } catch (error) {
        logger.error({ type: 'referral_claim_error', message: error.message });
        res.status(500).json({ error: 'Ошибка' });
    }
});

module.exports = router;
