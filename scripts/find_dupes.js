const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TARGETS = [
    'public/game.js', 'index.js', 'webhook.js',
    'utils/serverApi.js', 'utils/game-helpers.js', 'utils/gameConstants.js',
    'utils/scheduler.js', 'utils/realtime.js',
    'db/players.js', 'db/pvp.js', 'db/schema.js', 'db/database.js',
    'routes/api.js', 'routes/admin.js',
    'routes/game/index.js', 'routes/game/world.js', 'routes/game/items.js',
    'routes/game/clans.js', 'routes/game/bosses.js', 'routes/game/pvp.js',
    'routes/game/player.js', 'routes/game/debuffs.js',
    'routes/game/status.js', 'routes/game/minigames.js'
];
const MIN_LINES = 8;
const MAX_CHARS = 30000;

const read = rel => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};
const norm = l => l.replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim();

function countLines(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}

function lineIndex(src) {
    const arr = new Int32Array(src.length + 1);
    let n = 1;
    for (let i = 0; i < src.length; i++) {
        arr[i] = n;
        if (src.charCodeAt(i) === 10) n++;
    }
    arr[src.length] = n;
    return pos => arr[Math.min(pos, src.length)];
}

function bodyOf(src, from) {
    const open = src.indexOf('{', from);
    if (open < 0) return null;
    let depth = 0;
    const limit = Math.min(src.length, open + MAX_CHARS);
    for (let i = open; i < limit; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(open + 1, i);
        }
    }
    return null;
}

function scan(files) {
    const bySig = new Map();
    const all = [];
    const declared = new Map();
    for (const rel of files) {
        const src = read(rel);
        if (!src) continue;
        const at = lineIndex(src);
        const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const name = m[1];
            const line = at(m.index);
            if (!declared.has(name)) declared.set(name, []);
            declared.get(name).push({ rel, line });
            const body = bodyOf(src, m.index);
            if (body === null) continue;
            const size = countLines(body);
            all.push({ rel, name, line, size });
            if (size < MIN_LINES) continue;
            const sig = body.split('\n').map(norm).filter(Boolean).join('\n');
            if (sig.length < 80) continue;
            if (!bySig.has(sig)) bySig.set(sig, []);
            bySig.get(sig).push({ rel, name, line, size });
        }
    }
    const dupes = [...bySig.values()].filter(g => g.length > 1);
    dupes.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
    all.sort((a, b) => b.size - a.size);
    return { dupes, all, declared };
}

/**
 * Мёртвый код: объявлен, но нигде не упомянут.
 *
 * Считаем ВСЕ упоминания идентификатора и вычитаем объявления.
 * Первый вариант искал только `name(` / `window.name` / `.name`, но это
 * давало тонну ложных срабатываний: `setTimeout(regenerateEnergy, 60000)`,
 * `module.exports = { isAdmin }`, обращения из тестов — всё это не ловилось.
 */
function findDead(files, declared) {
    const extra = files.map(read).filter(Boolean).join('\n');
    const allSrc = extra;
    const out = [];
    for (const [name, locs] of declared) {
        const all = allSrc.match(new RegExp('\\b' + name + '\\b', 'g'));
        const total = all ? all.length : 0;
        if (total - locs.length <= 0) out.push({ name, locs });
    }
    return out;
}

const hr = t => {
    console.log('');
    console.log('='.repeat(72));
    console.log(t);
    console.log('='.repeat(72));
};

const argv = process.argv.slice(2);
const list = argv.length ? argv : TARGETS;
const present = list.filter(f => read(f));
for (const f of list) if (!read(f)) console.log('  [пропущено] ' + f);

// Тесты и HTML тоже «потребители» — без них мёртвый код определяется неверно.
const USAGE_EXTRA = ['game.test.js', 'public/index.html', 'scripts/test_hash_parse.js'];
const usageCorpus = present.concat(USAGE_EXTRA.filter(f => read(f) && !present.includes(f)));

hr('ФАЙЛОВ ПРОВЕРЕНО: ' + present.length);
const res = scan(present);

hr('1. ТОЧНЫЕ ДУБЛИ ФУНКЦИЙ — ' + res.dupes.length + ' групп');
if (!res.dupes.length) {
    console.log('  нет');
} else {
    for (const g of res.dupes) {
        const waste = g[0].size * (g.length - 1);
        console.log('');
        console.log('  [' + g[0].size + ' строк x' + g.length + ' = ~' + waste + ' строк лишних]');
        for (const c of g) console.log('    ' + c.rel + ':' + c.line + '  ' + c.name + '()');
    }
}

const dead = findDead(usageCorpus, res.declared);
hr('2. МЁРТВЫЙ КОД — ' + dead.length);
if (!dead.length) {
    console.log('  нет');
} else {
    for (const d of dead) {
        console.log('  ' + d.name + '()  — ' + d.locs.map(l => l.rel + ':' + l.line).join(', '));
    }
}

hr('3. КРУПНЕЙШИЕ ФУНКЦИИ (кандидаты на разбиение)');
for (const b of res.all.slice(0, 25)) {
    console.log('  ' + String(b.size).padStart(5) + '  ' + b.rel + ':' + b.line + '  ' + b.name + '()');
}
