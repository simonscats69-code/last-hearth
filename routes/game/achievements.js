/**
 * API достижений
 */

const express = require('express');
const router = express.Router();
const { getPlayerAchievements, getPlayerProgress } = require('../../utils/achievements');

/**
 * Получить все достижения
 */
router.get('/', async (req, res) => {
    try {
        const playerId = req.player?.id;
        
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        
        const achievements = await getPlayerAchievements(playerId);
        
        res.json({
            success: true,
            achievements
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения достижений' });
    }
});

/**
 * Получить прогресс
 */
router.get('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        
        if (!playerId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        
        const progress = await getPlayerProgress(playerId);
        
        if (!progress) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        res.json({
            success: true,
            progress
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения прогресса' });
    }
});

module.exports = router;
