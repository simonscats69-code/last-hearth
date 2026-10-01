/**
 * Сбор «используемых» имён из разметки и кода.
 *
 * Общая часть для аудита классов, поиска мёртвого CSS и проверки XSS.
 * Ключевая сложность — шаблонные строки JS: разметка живёт в бэктиках
 * (`<div class="item-card rarity-${item.rarity}">`), и наивный поиск по
 * class="..." видит только статические куски.
 */

/**
 * Убирает интерполяции ${...} (в т.ч. вложенные), оставляя «скелет» строки.
 * Позволяет искать статические class="..." внутри шаблонных литералов.
 */
function stripTemplates(src) {
    let out = '', i = 0;
    while (i < src.length) {
        if (src.startsWith('${', i)) {
            let depth = 1; i += 2;
            while (i < src.length && depth > 0) {
                if (src[i] === '{') depth++;
                else if (src[i] === '}') depth--;
                i++;
            }
            out += ' ';
        } else {
            const c = src[i];
            if (c === '"' || c === "'" || c === '`') {
                const quote = c; out += c; i++;
                while (i < src.length) {
                    if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
                    out += src[i];
                    if (src[i] === quote) { i++; break; }
                    i++;
                }
            } else { out += c; i++; }
        }
    }
    return out;
}

/**
 * Собирает классы и id из разметки (game.js + index.html).
 *
 * @param {string} js содержимое game.js
 * @param {string} html содержимое index.html
 * @returns {{classes: Map<string,{count:number,example:string}>, ids: Map<string,number>}}
 */
function collectMarkup(js, html) {
    // Комментарии не рендерятся — считать из них id/class нельзя:
    // раньше `<div id="main-screen">` в JSDoc давал ложный «дубль ID».
    const jsCode = js
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const markup = stripTemplates(jsCode) + '\n' + stripTemplates(html);
    const classes = new Map();
    const ids = new Map();

    for (const m of markup.matchAll(/class="([^"]*)"/g)) {
        const raw = m[1];
        for (const cls of raw.split(/\s+/)) {
            if (!cls || !/^[A-Za-z][\w-]*$/.test(cls)) continue;
            if (!classes.has(cls)) classes.set(cls, { count: 0, example: raw.trim().slice(0, 70) });
            classes.get(cls).count++;
        }
    }
    for (const m of markup.matchAll(/\sid="([^"]*)"/g)) {
        for (const id of m[1].split(/\s+/)) {
            if (!id || !/^[A-Za-z][\w-]*$/.test(id)) continue;
            ids.set(id, (ids.get(id) || 0) + 1);
        }
    }
    return { classes, ids };
}

module.exports = { stripTemplates, collectMarkup };