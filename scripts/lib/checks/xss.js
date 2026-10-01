/**
 * Чек 3: XSS — вставка контролируемых игроком данных в разметку.
 *
 * first_name/username приходят из профиля Telegram, им управляет игрок,
 * и в БД они пишутся без очистки. Такое поле обязано проходить через
 * escapeHtml перед вставкой в innerHTML.
 *
 * Намеренно НЕ проверяются item/weapon/buff/location — их имена приходят
 * из справочников, заполняемых разработчиком.
 */
const UNTRUSTED = /(?:msg|member|m|player|user|ref|clan)\.(first_name|last_name|username|message|text)\b/i;

module.exports = function checkXss(js) {
    const lines = js.split(/\r?\n/);
    const bad = [];
    for (let i = 0; i < lines.length; i++) {
        const cur = lines[i];
        if (!UNTRUSTED.test(cur) || cur.includes('escapeHtml')) continue;
        const window = lines.slice(i, i + 3).join(' ');
        if (/innerHTML|insertAdjacentHTML|<div|<span|\+\s*'</.test(window)) {
            bad.push('строка ' + (i + 1) + ': ' + cur.trim().slice(0, 95));
        }
    }
    return [{
        severity: 'critical',
        title: 'XSS — вставка данных игрока без escapeHtml',
        lines: bad
    }];
};