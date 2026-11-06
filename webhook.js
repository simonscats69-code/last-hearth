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
            { command: 'admin', description: '🛡 Админ-панель' },
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
                const isNewPlayer = !player.inventory || (Array.isArray(player.inventory) && player.inventory.length === 0) || player.inventory === null;
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
                        const { safeJsonParse } = require('./utils/serverApi');
                        let stats = safeJsonParse(row.stats, {});
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

    // ===== АДМИН-ПАНЕЛЬ В ЧАТЕ (только для ADMIN_IDS) =====
    const { isAdmin } = require('./utils/adminIds');
    const { getMetrics } = require('./utils/metrics');
    const { getSchedulerMetrics } = require('./utils/scheduler');

    function adminOnly(ctx) {
        if (!isAdmin(ctx.from?.id)) {
            ctx.reply('⛔ Доступ запрещён. Ваш Telegram ID не в ADMIN_IDS.');
            return false;
        }
        return true;
    }

    function adminKeyboard() {
        return {
            inline_keyboard: [
                [{ text: '📊 Сводка', callback_data: 'admin:stats' }, { text: '🏆 Топ-10', callback_data: 'admin:top' }],
                [{ text: '📈 Метрики', callback_data: 'admin:metrics' }, { text: '⚠️ Ошибки', callback_data: 'admin:errors' }],
                [{ text: '👤 Игрок', callback_data: 'admin:player' }, { text: '🚫 Забаненные', callback_data: 'admin:banned' }],
                [{ text: '👹 Боссы', callback_data: 'admin:bosses' }, { text: '🛠 Обслуживание', callback_data: 'admin:maint' }],
                [{ text: '🔄 Обновить', callback_data: 'admin:refresh' }]
            ]
        };
    }

    async function adminStatsText() {
        const totalPlayers = await queryOne('SELECT COUNT(*)::int AS c FROM players');
        const totalClans = await queryOne('SELECT COUNT(*)::int AS c FROM clans');
        const active24 = await queryOne("SELECT COUNT(*)::int AS c FROM players WHERE last_action_time > NOW() - INTERVAL '24 hours'");
        const banned = await queryOne('SELECT COUNT(*)::int AS c FROM players WHERE banned = true');
        return (
            '🛡 <b>Админ-панель — сводка</b>\n\n' +
            `👥 Игроков: <b>${totalPlayers?.c ?? 0}</b>\n` +
            `🏰 Кланов: <b>${totalClans?.c ?? 0}</b>\n` +
            `🟢 Активных за 24ч: <b>${active24?.c ?? 0}</b>\n` +
            `🚫 Забаненных: <b>${banned?.c ?? 0}</b>`
        );
    }

    async function adminTopText() {
        const rows = await query('SELECT telegram_id, username, level, strength FROM players ORDER BY level DESC, experience DESC LIMIT 10');
        const lines = (rows.rows || []).map((r, i) => `${i + 1}. ${r.username || 'Без имени'} (ID ${r.telegram_id}) — ур. ${r.level}, сила ${r.strength}`);
        return '🏆 <b>Топ-10 игроков</b>\n\n' + (lines.length ? lines.join('\n') : 'Нет данных');
    }

    function adminMetricsText() {
        const m = getMetrics();
        const s = getSchedulerMetrics();
        return (
            '📈 <b>Метрики сервера</b>\n\n' +
            `⏱ Uptime: ${m.uptime} с\n` +
            `📥 Запросов: ${m.requests.total} (ok ${m.requests.success}, err ${m.requests.errors})\n` +
            `⚡ RPS: ${m.performance.requestsPerSecond} | avg ${m.performance.avgResponseTime} мс\n` +
            `🖥 CPU: ${m.system.cpu}% | RAM: ${m.system.memory.used}/${m.system.memory.total} МБ\n` +
            `🔧 Планировщик: energy=${s.energy?.total ?? 0}, daily=${s.dailyActivity?.total ?? 0}, ` +
            `ach=${s.achievements?.total ?? 0}, cleanup=${s.cleanup?.total ?? 0}, tasks=${s.dailyTasks?.total ?? 0}`
        );
    }

    function adminErrorsText() {
        const m = getMetrics();
        return (
            '⚠️ <b>Ошибки и логи</b>\n\n' +
            `HTTP ошибок: ${m.requests.errors}\n` +
            'Уведомления об ошибках отправляются автоматически всем админам при logger.error и 5xx.\n' +
            'Файловые логи: logs/error.log, logs/combined.log.\n' +
            'Просмотр player_logs через БД: таблица player_logs (ретеншен 30 дней).'
        );
    }

    async function adminBannedText() {
        const rows = await query('SELECT telegram_id, username, ban_reason, last_action_time FROM players WHERE banned = true ORDER BY last_action_time DESC LIMIT 20');
        const lines = (rows.rows || []).map((r) => `• ${r.username || 'Без имени'} (ID ${r.telegram_id}) — ${r.ban_reason || 'без причины'}`);
        return '🚫 <b>Забаненные игроки</b>\n\n' + (lines.length ? lines.join('\n') : 'Забаненных нет');
    }

    async function adminBossesText() {
        const rows = await query('SELECT id, name, level, max_health, damage, reward_experience FROM bosses ORDER BY level');
        const lines = (rows.rows || []).map((r) => `#${r.id} ${r.name} (ур.${r.level}) HP ${r.max_health} DMG ${r.damage} EXP ${r.reward_experience}`);
        return '👹 <b>Боссы</b>\n\n' + (lines.length ? lines.join('\n') : 'Нет данных') +
            '\n\nИзменение: /boss_set <id> <поле> <значение>\nПоля: name, max_health, damage, reward_experience';
    }

    function adminMaintenanceText() {
        const s = getSchedulerMetrics();
        return (
            '🛠 <b>Обслуживание</b>\n\n' +
            `energy: ${s.energy?.total ?? 0} (посл. ${s.energy?.lastDuration ?? 0} мс)\n` +
            `dailyActivity: ${s.dailyActivity?.total ?? 0}\n` +
            `achievements: ${s.achievements?.total ?? 0} (обработано ${s.achievements?.playersProcessed ?? 0}, ошибок ${s.achievements?.errors ?? 0})\n` +
            `cleanup: ${s.cleanup?.total ?? 0}\n` +
            `dailyTasks: ${s.dailyTasks?.total ?? 0}\n\n` +
            'Команды:\n/player <id>\n/resources <id> <energy> <health> <exp>\n/ban <id> [причина]\n/unban <id>\n/boss_set <id> <поле> <значение>'
        );
    }

    bot.command('admin', async (ctx) => {
        if (!adminOnly(ctx)) return;
        await ctx.reply('🛡 <b>Админ-панель</b>', { parse_mode: 'HTML', reply_markup: adminKeyboard() });
    });

    bot.action(/^admin:(.+)$/, async (ctx) => {
        if (!adminOnly(ctx)) {
            await ctx.answerCbQuery('Нет доступа');
            return;
        }
        const action = ctx.match[1];
        await ctx.answerCbQuery();
        let text = '';
        try {
            switch (action) {
                case 'stats': text = await adminStatsText(); break;
                case 'top': text = await adminTopText(); break;
                case 'metrics': text = adminMetricsText(); break;
                case 'errors': text = adminErrorsText(); break;
                case 'player': text = '👤 <b>Поиск игрока</b>\n\nИспользуйте команды:\n/player &lt;telegram_id&gt;\n/resources &lt;id&gt; &lt;energy&gt; &lt;health&gt; &lt;exp&gt;\n/ban &lt;id&gt; [причина]\n/unban &lt;id&gt;'; break;
                case 'banned': text = await adminBannedText(); break;
                case 'bosses': text = await adminBossesText(); break;
                case 'maint': text = adminMaintenanceText(); break;
                case 'refresh': text = await adminStatsText(); break;
                default: text = 'Неизвестное действие';
            }
        } catch (e) {
            logger.error('[bot][admin] Ошибка:', e);
            text = '❌ Ошибка при выполнении действия';
        }
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: adminKeyboard() });
        } catch (_) {
            await ctx.reply(text, { parse_mode: 'HTML', reply_markup: adminKeyboard() });
        }
    });

    // Команды админа
    bot.command('player', async (ctx) => {
        if (!adminOnly(ctx)) return;
        const parts = (ctx.message.text || '').trim().split(/\s+/);
        const id = parts[1];
        if (!id || !/^\d+$/.test(id)) {
            await ctx.reply('Использование: /player <telegram_id>');
            return;
        }
        try {
            const p = await queryOne('SELECT telegram_id, username, level, strength, endurance, agility, intelligence, luck, health, radiation, energy, max_energy, experience, created_at, last_action_time, banned, ban_reason FROM players WHERE telegram_id = $1', [id]);
            if (!p) {
                await ctx.reply('Игрок не найден');
                return;
            }
            await ctx.reply(
                `👤 <b>${p.username || 'Без имени'}</b> (ID ${p.telegram_id})\n` +
                `Ур. ${p.level} | Опыт ${p.experience}\n` +
                `Сила ${p.strength} Вын ${p.endurance} Лов ${p.agility} Инт ${p.intelligence} Удача ${p.luck}\n` +
                `HP ${p.health} | Энергия ${p.energy}/${p.max_energy}\n` +
                `Радиация ${typeof p.radiation === 'object' ? (p.radiation?.level ?? 0) : p.radiation}\n` +
                `Бан: ${p.banned ? 'да (' + (p.ban_reason || '-') + ')' : 'нет'}\n` +
                `Создан: ${p.created_at}\nПоследняя активность: ${p.last_action_time}`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            logger.error('[bot][admin] /player:', e);
            await ctx.reply('Ошибка при получении игрока');
        }
    });

    bot.command('resources', async (ctx) => {
        if (!adminOnly(ctx)) return;
        const parts = (ctx.message.text || '').trim().split(/\s+/);
        const id = parts[1];
        if (!id || !/^\d+$/.test(id)) {
            await ctx.reply('Использование: /resources <telegram_id> <energy> <health> <experience>');
            return;
        }
        const energy = parts[2] !== undefined ? Number(parts[2]) : null;
        const health = parts[3] !== undefined ? Number(parts[3]) : null;
        const exp = parts[4] !== undefined ? Number(parts[4]) : null;
        if ((energy !== null && (!Number.isInteger(energy) || energy < 0 || energy > 10000)) ||
            (health !== null && (!Number.isInteger(health) || health < 0 || health > 10000)) ||
            (exp !== null && (!Number.isInteger(exp) || exp < 0 || exp > 1000000))) {
            await ctx.reply('Значения: energy 0-10000, health 0-10000, experience 0-1000000 (целые).');
            return;
        }
        const sets = [];
        const vals = [];
        let i = 1;
        if (energy !== null) { sets.push(`energy = $${i++}`); vals.push(energy); }
        if (health !== null) { sets.push(`health = $${i++}`); vals.push(health); sets.push('last_hp_regen = NOW()'); }
        if (exp !== null) { sets.push(`experience = $${i++}`); vals.push(exp); }
        if (sets.length === 0) {
            await ctx.reply('Укажите хотя бы одно значение: /resources <id> <energy> <health> <exp>');
            return;
        }
        vals.push(id);
        try {
            const r = await query(`UPDATE players SET ${sets.join(', ')} WHERE telegram_id = $${i} RETURNING telegram_id`, vals);
            if (!r.rows || r.rows.length === 0) {
                await ctx.reply('Игрок не найден');
                return;
            }
            await ctx.reply(`✅ Ресурсы обновлены для ID ${id}`);
        } catch (e) {
            logger.error('[bot][admin] /resources:', e);
            await ctx.reply('Ошибка при изменении ресурсов');
        }
    });

    bot.command('ban', async (ctx) => {
        if (!adminOnly(ctx)) return;
        const parts = (ctx.message.text || '').trim().split(/\s+/);
        const id = parts[1];
        const reason = parts.slice(2).join(' ') || 'Нарушение правил';
        if (!id || !/^\d+$/.test(id)) {
            await ctx.reply('Использование: /ban <telegram_id> [причина]');
            return;
        }
        try {
            const r = await query('UPDATE players SET banned = true, ban_reason = $1 WHERE telegram_id = $2 RETURNING telegram_id', [reason, id]);
            if (!r.rows || r.rows.length === 0) {
                await ctx.reply('Игрок не найден');
                return;
            }
            await ctx.reply(`🚫 Игрок ${id} забанен. Причина: ${reason}`);
        } catch (e) {
            logger.error('[bot][admin] /ban:', e);
            await ctx.reply('Ошибка при бане');
        }
    });

    bot.command('unban', async (ctx) => {
        if (!adminOnly(ctx)) return;
        const parts = (ctx.message.text || '').trim().split(/\s+/);
        const id = parts[1];
        if (!id || !/^\d+$/.test(id)) {
            await ctx.reply('Использование: /unban <telegram_id>');
            return;
        }
        try {
            const r = await query('UPDATE players SET banned = false, ban_reason = NULL WHERE telegram_id = $1 RETURNING telegram_id', [id]);
            if (!r.rows || r.rows.length === 0) {
                await ctx.reply('Игрок не найден');
                return;
            }
            await ctx.reply(`✅ Игрок ${id} разбанен`);
        } catch (e) {
            logger.error('[bot][admin] /unban:', e);
            await ctx.reply('Ошибка при разбане');
        }
    });

    bot.command('boss_set', async (ctx) => {
        if (!adminOnly(ctx)) return;
        const parts = (ctx.message.text || '').trim().split(/\s+/);
        const id = parts[1];
        const field = parts[2];
        const value = parts.slice(3).join(' ');
        const allowed = ['name', 'max_health', 'damage', 'reward_experience'];
        if (!id || !/^\d+$/.test(id) || !allowed.includes(field) || value === '') {
            await ctx.reply('Использование: /boss_set <id> <поле> <значение>\nПоля: name, max_health, damage, reward_experience');
            return;
        }
        const numericFields = ['max_health', 'damage', 'reward_experience'];
        let sqlValue = value;
        if (numericFields.includes(field)) {
            const num = Number(value);
            if (!Number.isInteger(num)) {
                await ctx.reply('Значение должно быть целым числом');
                return;
            }
            if (field === 'max_health' && (num < 1 || num > 1000000)) { await ctx.reply('max_health: 1-1000000'); return; }
            if (field === 'damage' && (num < 0 || num > 100000)) { await ctx.reply('damage: 0-100000'); return; }
            if (field === 'reward_experience' && (num < 0 || num > 1000000)) { await ctx.reply('reward_experience: 0-1000000'); return; }
            sqlValue = num;
        } else if (field === 'name' && value.length > 100) {
            await ctx.reply('name: до 100 символов');
            return;
        }
        try {
            const r = await query(`UPDATE bosses SET ${field} = $1 WHERE id = $2 RETURNING id, name`, [sqlValue, id]);
            if (!r.rows || r.rows.length === 0) {
                await ctx.reply('Босс не найден');
                return;
            }
            await ctx.reply(`✅ Босс #${id} (${r.rows[0].name}): ${field} обновлён`);
        } catch (e) {
            logger.error('[bot][admin] /boss_set:', e);
            await ctx.reply('Ошибка при изменении босса');
        }
    });

    // ===== КОНЕЦ АДМИН-ПАНЕЛИ =====

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
