/**
 * Единый аудит проекта. Только чтение — файлы не изменяются.
 *
 * Запуск:
 *   npm run audit                — все проверки
 *   node scripts/audit.js css    — структура CSS, классы, дубли селекторов
 *   node scripts/audit.js dead   — мёртвый CSS
 *   node scripts/audit.js xss    — безопасность
 *   node scripts/audit.js js     — дубли функций и мёртвый код
 *
 * Правящие инструменты (prune_css, fix_css_braces) намеренно живут
 * отдельно: случайный запуск аудита не должен изменить проект.
 *
 * Код возврата: 0 — критичных проблем нет, 1 — есть (удобно для CI).
 */
const fs = require('fs');
const path = require('path');

const checkCss = require('./lib/checks/css');
const checkDeadCss = require('./lib/checks/dead-css');
const checkXss = require('./lib/checks/xss');
const checkJs = require('./lib/checks/js');

const ROOT = path.join(__dirname, '..');
const read = rel => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

const css = read('public/styles.css') || '';
const js = read('public/game.js') || '';
const html = read('public/index.html') || '';

const GROUPS = {
    css: () => checkCss(css, js, html),
    dead: () => checkDeadCss(css, js, html),
    xss: () => checkXss(js),
    js: () => checkJs(read)
};

const only = process.argv[2];
const groups = only ? [only] : Object.keys(GROUPS);

if (!GROUPS[only] && only) {
    console.error('Неизвестная группа: ' + only);
    console.error('Доступны: ' + Object.keys(GROUPS).join(', '));
    process.exit(2);
}

console.log('='.repeat(72));
console.log('АУДИТ ПРОЕКТА — только чтение, файлы не изменяются');
console.log('='.repeat(72));

let criticalCount = 0;
for (const g of groups) {
    for (const r of GROUPS[g]()) {
        const count = r.lines.length;
        console.log('\n=== ' + r.title + ' (' + count + ') ===');
        if (!count) console.log('  (нет)');
        else for (const l of r.lines) console.log('  ' + l);
        if (r.severity === 'critical' && count) criticalCount++;
    }
}

console.log('');
console.log('='.repeat(72));
console.log(criticalCount === 0
    ? 'Критичных проблем нет.'
    : 'Критичных проблем: ' + criticalCount);
console.log('='.repeat(72));
process.exitCode = criticalCount ? 1 : 0;