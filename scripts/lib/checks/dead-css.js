/**
 * Чек 2: мёртвый CSS.
 *
 * Класс считается живым, если встречается в class-атрибуте (в том числе
 * внутри ${...} шаблонов), в className/classList, в селекторе или в
 * строковом литерале. Всё, что осталось, — кандидаты: удалять можно
 * только после ручной проверки глазами.
 */
const { stripCommentsAndUrls } = require('../css-parse');

module.exports = function checkDeadCss(css, js, html) {
    // Дедуплицируем ИМЕНА, а не объекты матча: new Set() на массиве
    // RegExpExecArray ничего не убирает (каждый элемент — новый объект),
    // и список выходил с дублями вида .rarity-common по нескольку раз.
    const names = new Set();
    for (const m of stripCommentsAndUrls(css).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        names.add(m[1]);
    }
    const cssClasses = [...names];

    const used = new Set();
    const unsure = new Set();
    const src = js + '\n' + html;

    const addWords = s => {
        for (const w of s.split(/[^A-Za-z0-9_-]+/)) if (w) used.add(w);
    };

    for (const m of src.matchAll(/class="([^"]*)"/g)) {
        const raw = m[1];
        // Выкидываем ${...}. Последнее слово перед интерполяцией, если оно
        // кончается дефисом, — префикс динамического класса (rarity-${x}),
        // значит весь .rarity-* жив.
        const staticPart = raw.replace(/\$\{([^}]*)\}/g, (expr, off) => {
            const before = raw.slice(0, off);
            const last = before.split(/\s+/).pop() || '';
            if (last.endsWith('-')) unsure.add(last);
            for (const lit of expr.matchAll(/'([^']*)'|"([^"]*)"/g)) {
                addWords(lit[1] || lit[2] || '');
            }
            return ' ';
        });
        addWords(staticPart);
    }
    for (const m of src.matchAll(/className\s*=\s*['"`]([^'"`]*)/g)) addWords(m[1]);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"`]([^'"`]*)/g)) addWords(m[1]);
    for (const m of src.matchAll(/querySelector(?:All)?\s*\(\s*['"`]([^'"`]+)/g)) {
        for (const part of m[1].split(/[\s,>+~:[\]=^$*|]+/)) {
            if (part.startsWith('.')) used.add(part.slice(1));
        }
    }

    // Префиксы, известные по шаблонам вида rarity-${x}: любой класс с таким
    // началом собирается в разметке динамически. Раньше такие классы
    // попадали в список мёртвых и предлагались к удалению — а они живые.
    const prefixes = new Set();
    for (const m of src.matchAll(/([\w-]+)-\$\{/g)) prefixes.add(m[1] + '-');

    // Класс жив, если упомянут напрямую ИЛИ начинается с такого префикса.
    const alive = c => used.has(c) || [...prefixes].some(p => c.startsWith(p));

    const dead = cssClasses.filter(c => !alive(c));
    return [{
        severity: 'warning',
        title: 'МЁРТВЫЙ CSS — кандидаты, требуют ручной проверки',
        lines: dead.slice(0, 40).map(c => '.' + c)
    }];
};