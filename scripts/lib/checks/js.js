/**
 * Чек 4: точные дубли функций и мёртвый код в JS.
 *
 * Дубль ищем по телу функции без комментариев и лишних пробелов — так
 * ловятся копии, отличающиеся только именем переменной.
 */
const TARGETS = [
    'public/game.js', 'public/shared/equipment.js', 'index.js', 'webhook.js',
    'utils/serverApi.js', 'utils/game-helpers.js', 'utils/gameConstants.js',
    'utils/scheduler.js', 'utils/realtime.js',
    'db/players.js', 'db/pvp.js', 'db/schema.js', 'db/database.js',
    'routes/api.js', 'routes/admin.js',
    'routes/game/index.js', 'routes/game/world.js', 'routes/game/items.js',
    'routes/game/clans.js', 'routes/game/bosses.js', 'routes/game/pvp.js',
    'routes/game/player.js', 'routes/game/debuffs.js',
    'routes/game/status.js', 'routes/game/minigames.js'
];

module.exports = function checkJs(read) {
    const files = TARGETS.map(rel => ({ rel, src: read(rel) })).filter(f => f.src);
    const bySig = new Map();
    const declared = new Map();

    for (const { rel, src } of files) {
        const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const name = m[1];
            const line = src.slice(0, m.index).split('\n').length;
            if (!declared.has(name)) declared.set(name, []);
            declared.get(name).push(rel + ':' + line);

            const open = src.indexOf('{', m.index);
            if (open < 0) continue;
            let depth = 0, end = -1;
            for (let i = open; i < Math.min(src.length, open + 30000); i++) {
                if (src[i] === '{') depth++;
                else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            if (end < 0) continue;
            const sig = src.slice(open + 1, end)
                .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
                .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
            // Порог 80 символов нормализованного тела: короче — совпадение
            // случайное (например, пустой return 0), а не настоящий дубль.
            if (sig.length < 80) continue;
            if (!bySig.has(sig)) bySig.set(sig, []);
            bySig.get(sig).push({
                rel, name, line,
                size: src.slice(open, end + 1).split('\n').length
            });
        }
    }

    const dupes = [...bySig.values()].filter(g => g.length > 1);

    // Мёртвый код: объявлен, но больше нигде не упоминается. Тесты и HTML
    // тоже «потребители» — без них вывод был бы неверным.
    const corpus = files.map(f => f.src).join('\n') + '\n' +
        (read('game.test.js') || '') + '\n' + (read('public/index.html') || '');
    const dead = [];
    for (const [name, locs] of declared) {
        const total = (corpus.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
        if (total - locs.length <= 0) dead.push(name + '()  — ' + locs.join(', '));
    }

    return [
        {
            severity: 'warning',
            title: 'ТОЧНЫЕ ДУБЛИ ФУНКЦИЙ',
            lines: dupes.map(g =>
                '  [' + g[0].size + ' строк x' + g.length + ']\n        ' +
                g.map(c => c.rel + ':' + c.line + '  ' + c.name + '()').join('\n        '))
        },
        { severity: 'warning', title: 'МЁРТВЫЙ КОД В JS', lines: dead }
    ];
};