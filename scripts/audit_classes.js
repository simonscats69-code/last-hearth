// Точная проверка: для каждого селектора из CSS-подобных строк в разметке — есть ли он в CSS.
// Запуск: node scripts/audit_classes.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public');
const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

// Убираем интерполяции ${...} (в т.ч. вложенные) и получаем «статические» куски разметки
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

const markup = stripTemplates(js) + '\n' + stripTemplates(html);

const classHits = new Map(); // класс -> {count, example}
const idHits = new Map();

for (const m of markup.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1];
    for (const cls of raw.split(/\s+/)) {
        if (!cls || !/^[A-Za-z][\w-]*$/.test(cls)) continue;
        if (!classHits.has(cls)) classHits.set(cls, { count: 0, example: raw.trim().slice(0, 70) });
        classHits.get(cls).count++;
    }
}
for (const m of markup.matchAll(/\sid="([^"]*)"/g)) {
    const raw = m[1];
    for (const id of raw.split(/\s+/)) {
        if (!id || !/^[A-Za-z][\w-]*$/.test(id)) continue;
        idHits.set(id, (idHits.get(id) || 0) + 1);
    }
}

// Наличие класса в CSS (учитываем и составные селекторы вида .a.b)
const cssTokens = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssTokens.add(m[1]);
const cssHas = sel => cssTokens.has(sel.replace(/^\./, ''));

const missClasses = [...classHits].filter(([c]) => !cssHas('.' + c)).sort((a, b) => a[0].localeCompare(b[0]));
const missIds = [...idHits].filter(([i]) => !cssHas('#' + i) && !new RegExp(`getElementById\\(\\s*['"\`]${i}['"\`]\\s*\\)`).test(js)).sort((a, b) => a[0].localeCompare(b[0]));

console.log(`Классов в разметке: ${classHits.size} | id: ${idHits.size} | селекторов в CSS: ${(css.match(/\.[A-Za-z][\w-]*/g) || []).length}`);
console.log(`\n== Классы БЕЗ правил в styles.css (${missClasses.length}) ==`);
for (const [c, v] of missClasses) console.log(`  .${c}  (${v.count}×)  ← ${v.example}`);
console.log(`\n== id БЕЗ стилей и без обращений из JS (${missIds.length}) ==`);
for (const [i, n] of missIds) console.log(`  #${i}  (${n}×)`);

// Дублиты id
const dupIds = [...idHits].filter(([, n]) => n > 1);
if (dupIds.length) {
    console.log(`\n== Дублирующиеся id (${dupIds.length}) ==`);
    dupIds.forEach(([i, n]) => console.log(`  #${i}  ×${n}`));
}

// url(...) в CSS: проверка существования файлов
console.log('\n== url(...) в CSS на несуществующие файлы ==');
let missingUrl = 0;
for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    let u = m[1];
    if (u.startsWith('data:') || u.startsWith('#')) continue;
    u = u.split('?')[0];
    if (!fs.existsSync(path.join(root, u.replace(/^\//, '')))) { console.log(`  ${m[1]}`); missingUrl++; }
}
if (!missingUrl) console.log('  (нет битых)');

// src/href на локальные файлы
console.log('\n== Локальные src/href, отсутствующие на диске ==');
let missingSrc = 0;
for (const src of [js, html]) {
    for (const m of src.matchAll(/(?:src|href)=["'](\/[^"'?]+)/g)) {
        if (m[1].startsWith('//')) continue;
        if (!fs.existsSync(path.join(root, m[1].replace(/^\//, '')))) { console.log(`  ${m[1]}`); missingSrc++; }
    }
}
if (!missingSrc) console.log('  (нет битых)');
