/**
 * Модуль настройки Telegram Webhook
 */

const { Telegraf } = require('telegraf');
const { query, queryOne } = require('./db/database');
const { logger } = require('./utils/serverApi');
const { MINI_APP_URL } = require('./utils/config');

// Проверка наличия токена бота
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
if (!BOT_TOKEN) {
    logger.error('TG_BOT_TOKEN не найден в переменных окружения!');
    logger.error('Пожалуйста, настройте переменную TG_BOT_TOKEN на BotHost');
}

// Создаём бота только если токен существует
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN, {
    telegram: { agent: null, webhookReply: true }
}) : null;

/**
 * Синхронизация Menu Button и списка команд бота.
 *
 * Menu Button — синяя кнопка «Открыть приложение» в профиле бота и кнопка
 * «Открыть» рядом с ботом в списке «Мои Боты». Её URL задаётся ТОЛЬКО в
 * BotFather вручную, и если там остался старый домен (last-hearth.bothost.ru),
 * игра по этим кнопкам открывается пустой — а по инлайн-кнопке «🎮 Играть»
 * (её шлёт /start с MINI_APP_URL из панели Bothost) работает. Выглядит как
 * «два разных приложения», хотя это одна игра с двумя URL входа.
 *
 * Здесь бот при каждом старте ставит Menu Button на тот же MINI_APP_URL,
 * что и инлайн-кнопки: ручную настройку в BotFather больше не нужно
 * держать в голове, а смена домена в панели Bothost применяется сама.
 *
 * Идемпотентно: setChatMenuButton с web_app перезаписывает прежнее
 * значение любого типа (commands/default/web_app).
 */
async function setupMenuButton() {
    // Без токена или URL настроить нечего — просто выходим (не роняем старт).
    if (!BOT_TOKEN || !bot || !MINI_APP_URL) {
        logger.warn('[bot] Menu Button не настроен: нет токена или MINI_APP_URL');
        return;
    }

    try {
        await bot.telegram.setChatMenuButton({
            menu_button: {
                type: 'web_app',
                text: '🎮 Играть',
                web_app: { url: MINI_APP_URL }
            }
        });
        logger.info(`[bot] Menu Button настроен на ${MINI_APP_URL}`);
    } catch (error) {
        // Не фатально: инлайн-кнопки /start продолжают работать.
        logger.error('[bot] Не удалось настроить Menu Button: ' + (error?.message || String(error)));
    }

    // Список команд — чтобы в интерфейсе бота были подсказки, а не пустота.
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🎮 Начать игру' },
            { command: 'play', description: '▶️ Быстрый запуск' },
            { command: 'profile', description: '👤 Профиль' },
            { command: 'locations', description: '🗺️ Локации' },
            { command: 'shop', description: '🏪 Магазин' },
            { command: 'daily', description: '🎁 Ежедневный бонус' },
            { command: 'help', description: '❓ Помощь' }
        ]);
    } catch (error) {
        logger.warn('[bot] Не удалось обновить список команд: ' + (error?.message || String(error)));
    }
}

/**
 * Настройка webhook и обработчиков команд
 */
async function setupWebhook(app) {
    // Проверяем наличие токена и бота перед запуском
    if (!BOT_TOKEN || !bot) {
        logger.error('Бот не может быть запущен: отсутствует токен TG_BOT_TOKEN');
        return;
    }
    
    // Удаляем webhook и используем polling
    try {
        await bot.telegram.deleteWebhook();
        // launch() возвращает промис: без .catch() ошибка авторизации/сети
        // превращалась в unhandledRejection и могла ронять процесс
        Promise.resolve(bot.launch()).catch((launchError) => {
            logger.error('Бот остановлен с ошибкой (polling): ' + (launchError?.message || String(launchError)));
        });
        logger.info('Бот запущен в режиме polling');

        // Кнопка меню и список команд — сразу после старта: Menu Button из
        // BotFather мог указывать на старый домен, и «синие» кнопки Telegram
        // открывали пустой Mini App. Ставим актуальный URL из MINI_APP_URL.
        await setupMenuButton();
    } catch (error) {
        logger.error('Ошибка запуска бота: ' + (error?.message || String(error)));
    }

    // Команда /start - начало игры
    bot.command('start', async (ctx) => {
        const telegramId = ctx.from.id;
        const username = ctx.from.username || '';
        const firstName = ctx.from.first_name || '';
        const lastName = ctx.from.last_name || '';

            try {
                // Атомарное создание: ON CONFLICT DO NOTHING + RETURNING.
                // Два параллельных /start от одного пользователя — только один
                // создаст строку, второй получит существующего игрока.
                let player = await queryOne(`
                    INSERT INTO players (telegram_id, username, first_name, last_name, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, NOW(), NOW())
                    ON CONFLICT (telegram_id) DO NOTHING
                    RETURNING *
                `, [telegramId, username, firstName, lastName]);

                if (!player) {
                    // Уже существует — читаем текущего
                    player = await queryOne(
                        'SELECT * FROM players WHERE telegram_id = $1',
                        [telegramId]
                    );
                }

                if (!player) {
                    // Не удалось создать и не нашли — ошибка
                    throw new Error('Не удалось создать или найти игрока');
                }

                // Если игрок только что создан (старые поля пусты), выдаём стартовый инвентарь
                const isNewPlayer = !player.inventory || player.inventory === '[]' || player.inventory === null;
                if (isNewPlayer) {
                    // Стартовый инвентарь берём из каталога по ИМЕНИ, а не по захардкоженным
                    // id. Раньше здесь стояли {id: 1} и {id: 2} — таких id в
                    // таблице items нет (реальные начинаются со 150480), поэтому
                    // предметы нельзя было ни продать, ни применить, ни увидеть
                    // в магазине: они были фантомами мёртвой версии игры.
                    // Стартовый набор. Раньше здесь были только «Консервы» и «Вода»:
                    // игрок начинал без оружия, хотя в бою с боссом урон теперь даёт и снаряжение
                    // (ближний бой +40% к боссам). Нож — 20 монет, 50 прочности и +5 урона:
                    // он же учит механике износа и ремонта.
                    const starterNames = ['Нож', 'Консервы', 'Вода'];
                    const starterResult = await query(
                        `SELECT id, name, type, category, rarity, icon, slot, price, stats, durability, max_durability
                           FROM items WHERE name = ANY($1::text[])`,
                        [starterNames]
                    );
                    const starterItems = [];
                    for (const name of starterNames) {
                        const row = starterResult.rows.find((item) => item.name === name);
                        if (!row) {
                            logger.warn('[bot] Стартовый предмет не найден в каталоге', { name });
                            continue;
                        }
                        // stats приходит из jsonb-колонки (уже объект), но исторически мог быть
                        // строкой — разбор без try/catch ронял весь обработчик /start.
                        let stats = row.stats;
                        if (typeof stats === 'string') {
                            try {
                                stats = JSON.parse(stats);
                            } catch {
                                stats = {};
                            }
                        } else if (!stats || typeof stats !== 'object') {
                            stats = {};
                        }
                        starterItems.push({
                            id: row.id,
                            name: row.name,
                            type: row.type,
                            category: row.category || row.type,
                            rarity: row.rarity || 'common',
                            icon: row.icon || '📦',
                            // Слот нужен, чтобы нож можно было надеть, а прочность —
                            // чтобы износ и ремонт работали с первого боя.
                            slot: row.slot || null,
                            stats,
                            damage: Number(stats.damage) || 0,
                            durability: Number(row.durability) || 100,
                            max_durability: Number(row.max_durability) || 100,
                            upgrade_level: 0,
                            modifications: {},
                            price: row.price || 0,
                            quantity: 1
                        });
                    }

                    if (starterItems.length > 0) {
                        await query(`
                            UPDATE players SET inventory = $1 WHERE telegram_id = $2
                        `, [JSON.stringify(starterItems), telegramId]);
                    }
                } else {
                // Обновляем username при повторном входе
                if (username && player.username !== username) {
                    await query(`
                        UPDATE players SET username = $1 WHERE telegram_id = $2
                    `, [username, telegramId]);
                }
            }

            // URL Mini App - без telegram_id (безопасность)
            const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        const miniAppUrl = MINI_APP_URL;

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
        if (!bot) {
            logger.error('[bot] Бот не инициализирован, невозможно отправить уведомление');
            return false;
        }
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
