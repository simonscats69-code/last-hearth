// utils/telegramNotifier.js
// Отправка ошибок администратору в Telegram.
// Не блокирует основной поток, имеет rate-limiting.
'use strict';

const { getAdminIds } = require('./adminIds');

// Rate limiting: не более 1 сообщения в секунду, максимум 5 в минуту
const RATE_LIMIT_MS = 1000;
const MAX_PER_MINUTE = 5;
let lastSentAt = 0;
let sentThisMinute = 0;
let minuteStart = Date.now();

// Кэш последнего отправленного текста (чтобы не дублировать)
let lastMessage = '';
let lastMessageAt = 0;
const DEDUP_WINDOW_MS = 30000; // 30 секунд

/**
 * Отправить сообщение об ошибке администратору.
 * @param {string} message — текст сообщения
 * @param {object} [meta] — метаданные (error, stack, context)
 */
async function notifyAdmin(message, meta = {}) {
    try {
        const adminIds = getAdminIds();
        if (adminIds.length === 0) return;

        // Получаем bot instance
        let bot = null;
        try {
            const webhook = require('../webhook');
            bot = webhook.bot;
        } catch (_) {
            return;
        }
        if (!bot) return;

        // Rate limiting
        const now = Date.now();
        if (now - minuteStart > 60000) {
            sentThisMinute = 0;
            minuteStart = now;
        }
        if (sentThisMinute >= MAX_PER_MINUTE) return;
        if (now - lastSentAt < RATE_LIMIT_MS) return;

        // Дедупликация: не отправлять одинаковое сообщение в течение 30 сек
        const fullText = message + (meta.stack ? '\n' + meta.stack.slice(0, 500) : '');
        if (fullText === lastMessage && now - lastMessageAt < DEDUP_WINDOW_MS) return;

        // Формируем текст
        let text = `⚠️ <b>Ошибка сервера</b>\n\n${escapeHtml(message)}`;
        if (meta.context) text += `\n\n<b>Контекст:</b> ${escapeHtml(String(meta.context))}`;
        if (meta.stack) text += `\n\n<b>Стек:</b>\n<code>${escapeHtml(meta.stack.slice(0, 1000))}</code>`;
        if (meta.url) text += `\n<b>URL:</b> ${escapeHtml(meta.url)}`;
        if (meta.playerId) text += `\n<b>Player:</b> ${meta.playerId}`;

        // Отправляем всем админам
        for (const adminId of adminIds) {
            try {
                await bot.telegram.sendMessage(adminId, text, { parse_mode: 'HTML' });
            } catch (e) {
                // Не роняем основной поток
            }
        }

        lastSentAt = now;
        sentThisMinute++;
        lastMessage = fullText;
        lastMessageAt = now;
    } catch (e) {
        // Не роняем основной поток
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Синхронная обёртка для вызова из handleError (не блокирует)
function notifyAdminSync(message, meta) {
    notifyAdmin(message, meta).catch(() => {});
}

module.exports = { notifyAdmin, notifyAdminSync };
