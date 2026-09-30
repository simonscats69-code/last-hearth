const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/game.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const used = new Set();

const addWords = (chunk) => {
    for (const w of String(chunk).split(/[^A-Za-z0-9_-]+/)) {
        if (w && !w.includes('$')) used.add(w);
    }
};

// class="..." в разметке (в т.ч. внутри шаблонных строк для innerHTML)
for (const m of js.matchAll(/class="([^"]*)"/g)) addWords(m[1].split('${')[0]);
for (const m of html.matchAll(/class="([^"]*)"/g)) addWords(m[1]);

// className = '...' / className = `...` — в game.js так собрана большая
// часть разметки, без этого куча ложных «мёртвых» классов
for (const m of js.matchAll(/className\s*=\s*'([^']*)'/g)) addWords(m[1]);
for (const m of js.matchAll(/className\s*=\s*`([^`]*)`/g)) {
    addWords(m[1].split('${')[0]);
    const parts = m[1].split('}');
    for (let i = 1; i < parts.length; i++) addWords(parts[i].split('${')[0]);
}

// classList.add/remove/toggle('...')
for (const m of js.matchAll(/classList\.(?:add|remove|toggle|contains)\('([^']+)'/g)) used.add(m[1]);

// classList.add(`... ${x} ...`) — берём статические куски
for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(`([^`]*)`/g)) {
    addWords(m[1].split(/\$\{/)[0]);
    const tail = m[1].split('}').pop();
    if (tail) addWords(tail);
}

// querySelector('.x') / getElementById -> классы из селекторов
for (const m of js.matchAll(/querySelector(?:All)?\(['"]([^'"]+)['"]\)/g)) {
    for (const part of m[1].split(/[\s,>+~:[\]=^$*|]+/)) {
        if (part.startsWith('.')) used.add(part.slice(1));
    }
}

// имена из строковых id вида 'foo-bar' (кино-конвенция класса = id)
for (const m of js.matchAll(/getElementById\('([a-z0-9-]+)'\)/g)) used.add(m[1]);

// data-* атрибуты, которые CSS может использовать
for (const m of css.matchAll(/\[data-([a-z-]+)/g)) used.add(m[1]);

const defined = [...new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]))];
const dead = defined.filter(c => !used.has(c));

console.log('Классов объявлено в CSS: ' + defined.length);
console.log('Используется: ' + (defined.length - dead.length));
console.log('НЕ используется: ' + dead.length);
console.log('');
console.log(dead.map(c => '.' + c).join('\n'));
