/**
 * Модуль настройки Telegram Webhook
 */

const { Telegraf } = require('telegraf');
const { query, queryOne } = require('./db/database');
const { logger } = require('./utils/serverApi');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
    telegram: { agent: null, webhookReply: true }
});

/**
 * Настройка webhook и обработчиков команд
 */
async function setupWebhook(app) {
    // Удаляем webhook и используем polling
    await bot.telegram.deleteWebhook();
    bot.launch();
    logger.info('Бот запущен в режиме polling');

    // Команда /start - начало игры
    bot.command('start', async (ctx) => {
        const telegramId = ctx.from.id;
        const username = ctx.from.username || '';
        const firstName = ctx.from.first_name || '';
        const lastName = ctx.from.last_name || '';

        try {
            // Проверяем, есть ли игрок
            let player = await queryOne(
                'SELECT * FROM players WHERE telegram_id = $1',
                [telegramId]
            );

            if (!player) {
                // Создаём нового игрока с реферальным кодом
                const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                
                player = await queryOne(`
                    INSERT INTO players (telegram_id, username, first_name, last_name, referral_code)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *
                `, [telegramId, username, firstName, lastName, referralCode]);

                // Создаём начальный инвентарь
                await query(`
                    UPDATE players SET inventory = $1 WHERE telegram_id = $2
                `, [JSON.stringify([
                    { id: '1', name: 'Консервы', type: 'food', hunger: 10 },
                    { id: '2', name: 'Вода', type: 'water', thirst: 15 }
                ]), telegramId]);
            } else {
                // Обновляем username при повторном входе
                if (username && player.username !== username) {
                    await query(`
                        UPDATE players SET username = $1 WHERE telegram_id = $2
                    `, [username, telegramId]);
                }
            }

            // URL Mini App - без telegram_id (безопасность)
            const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
            
            // Приветственное сообщение
            await ctx.reply(
                `🏚️ <b>Последний Очаг</b>\n\n` +
                `Добро пожаловать в мир после конца света, ${firstName}!\n\n` +
                `Ты выживший в постапокалиптическом мире. Твоя цель - выжить, ` +
                `найти убежище и стать сильнейшим.\n\n` +
                `Нажми кнопку ниже, чтобы начать:`,
                { parse_mode: 'HTML' }
            );
            
            // Кнопка запуска игры
            await ctx.reply('🎮 <b>Начать игру</b>', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎮 Играть', web_app: { url: miniAppUrl } }]
                    ]
                }
            });
        } catch (error) {
            logger.error('[bot] Ошибка при обработке /start:', error);
            await ctx.reply('Произошла ошибка. Попробуй позже.');
        }
    });

    // Команда /profile - открывает Mini App
    bot.command('profile', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '👤 Открой Mini App для просмотра профиля:',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Профиль', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Команда /locations - открывает Mini App
    bot.command('locations', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '🗺️ Открой Mini App для просмотра карты:',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗺️ Карта', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Команда /shop - магазин
    bot.command('shop', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '🏪 Открой Mini App для доступа к магазину:',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛒 Магазин', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Команда /help - помощь
    bot.command('help', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '❓ <b>Помощь</b>\n\n' +
            '<b>Основные команды:</b>\n' +
            '/start - Начать игру\n' +
            '/play - Играть (Mini App)\n' +
            '/shop - Магазин\n' +
            '/daily - Ежедневный бонус\n' +
            '/help - Эта справка\n\n' +
            '<b>Вся игра в Mini App!</b>',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎮 Играть', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Команда /play - быстрый запуск игры
    bot.command('play', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '🎮 <b>Последний Очаг</b>\n\nВся игра в Mini App!',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎮 Играть', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Команда /daily - ежедневный бонус
    bot.command('daily', async (ctx) => {
        const miniAppUrl = process.env.MINI_APP_URL || 'https://last-hearth.bothost.ru';
        
        await ctx.reply(
            '🎁 Открой Mini App для получения ежедневного бонуса:',
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎁 Получить бонус', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });

    // Обработка текстовых сообщений
    bot.on('text', async (ctx) => {
        const text = ctx.message.text;
        
        if (text.startsWith('/')) {
            return; // Это команда, уже обработана
        }

        // Простой чат-бот для общения
        const responses = {
            'привет': '👋 Привет, выживший! Напиши /start чтобы начать игру.',
            'здравствуй': '👋 Здравствуй! Напиши /start чтобы начать игру.',
            'что делать': '🎮 Исследуй локации, ищи лут, строй базу и побеждай боссов!',
            'помоги': 'Напиши /help для получения списка команд.'
        };

        const lowerText = text.toLowerCase();
        for (const [key, value] of Object.entries(responses)) {
            if (lowerText.includes(key)) {
                await ctx.reply(value);
                return;
            }
        }
    });

    logger.info('✓ Обработчики Telegram bot зарегистрированы');
}

/**
 * Отправка уведомления игроку
 */
async function sendNotification(telegramId, message, keyboard = null) {
    try {
        await bot.telegram.sendMessage(telegramId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        return true;
    } catch (error) {
        logger.error('[bot] Ошибка отправки уведомления:', error);
        return false;
    }
}

module.exports = {
    setupWebhook,
    sendNotification,
    bot
};
