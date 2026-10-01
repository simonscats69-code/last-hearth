const fs = require('fs');
const path = require('path');

/**
 * Удаляет из CSS правила, чьи селекторы состоят ТОЛЬКО из мёртвых классов.
 *
 * Безопасно в том смысле, что не трогает:
 *  - правила, где в селекторе есть хотя бы один живой класс,
 *  - @media / @supports блоки (рекурсия спускается внутрь),
 *  - правила без классов (body, html, a, input ...).
 *
 * Использование:
 *   node scripts/prune_css.js --dry .dead-class .another-class
 *   node scripts/prune_css.js --apply .dead-class .another-class
 */
const FILE = path.join(__dirname, '..', 'public', 'styles.css');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dead = args.filter(a => a.startsWith('.')).map(a => a.slice(1));

if (!dead.length) {
    console.error('Укажите классы: node scripts/prune_css.js --dry .a .b');
    process.exit(1);
}

const deadSet = new Set(dead);
const src = fs.readFileSync(FILE, 'utf8');
let removedRules = 0;
let slimmedRules = 0;
const removedSelectors = [];
const slimmedSelectors = [];

const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * Разбирает список селекторов правила на группы (через запятую) и
 * определяет, какие группы принципиально не могут совпасть с DOM.
 *
 * Группа недостижима, если в любом её составном селекторе (`.a.b`,
 * `.parent .child`) есть мёртвый класс: элемент никогда не получит
 * этот класс, поэтому совпадения не будет. Именно так выглядит
 * остаток старой вёрстки: `.card.danger` и `.boss-fight-timer .timer-label`
 * существуют, но срабатывают ноль раз.
 *
 * @returns {{dead: boolean, live: string[]}} мёртва ли группа и какие
 *          селекторы выживают.
 */
function analyzeSelector(selector) {
    const live = [];
    for (const group of selector.split(',')) {
        const g = group.trim();
        if (!g) continue;
        const classes = [...g.matchAll(CLASS_RE)].map(m => m[1]);
        if (!classes.length) { live.push(g); continue; }   // body, html, a — не трогаем
        if (classes.some(c => deadSet.has(c))) continue;    // есть мёртвый класс — недостижима
        live.push(g);
    }
    return { dead: live.length === 0, live };
}

/** Рекурсивно обрабатывает блок @media/@supports, возвращает новый текст */
function processAtBlock(text, blockStart, blockEnd) {
    return processRange(text, blockStart + 1, blockEnd - 1);
}

/** Обрабатывает диапазон [from, to), предполагая сбалансированные скобки */
function processRange(text, from, to) {
    let result = '';
    let i = from;
    while (i < to) {
        const ch = text[i];

        // Пропускаем пробельные символы ВНАЧРИ цикла. Без этого пробел между
        // правилами считался бы началом селектора, text.indexOf('{') находил бы
        // скобку следующего @media, и весь блок проглатывался целиком —
        // вместе с правилами внутри, которые нужно было почистить.
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            result += ch;
            i++;
            continue;
        }

        // Пропускаем комментарии
        if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i) + 2;
            result += text.slice(i, end);
            i = end;
            continue;
        }

        // @media / @supports и подобные — спускаемся внутрь
        if (ch === '@') {
            const braceStart = text.indexOf('{', i);
            const header = text.slice(i, braceStart);
            const blockEnd = findBlockEnd(text, braceStart);
            if (braceStart < 0 || blockEnd < 0 || blockEnd > to) {
                result += ch;
                i++;
                continue;
            }
            const inner = processAtBlock(text, braceStart, blockEnd);
            // Сохраняем перевод строки перед закрывающей скобкой блока.
            // Без этого «...; }» + «}» склеивается в «...; }}» и файл
            // теряет по строке на каждый @keyframes/@media.
            const origInner = text.slice(braceStart + 1, blockEnd);
            const tailMatch = origInner.match(/\n([ \t]*)$/);
            const tail = tailMatch ? '\n' + tailMatch[1] : '';
            result += header + '{' + inner + tail + '}';
            i = blockEnd + 1;
            continue;
        }

        // Закрывающая скобка: обычное правило или конец @media
        if (ch === '}') {
            result += ch;
            i++;
            continue;
        }

        const braceStart = text.indexOf('{', i);
        if (braceStart < 0 || braceStart > to) {
            result += text.slice(i, to);
            break;
        }
        const selector = text.slice(i, braceStart);
        const blockEnd = findBlockEnd(text, braceStart);
        if (blockEnd < 0 || blockEnd > to) {
            result += text.slice(i, to);
            break;
        }

        const info = analyzeSelector(selector);
        if (process.env.TRACE_VISIT) {
            console.log('  вижу @' + i + ' селектор: ' + selector.trim().replace(/\s+/g, ' ').slice(0, 60));
        }
        if (info.dead) {
            removedRules++;
            removedSelectors.push(selector.trim().replace(/\s+/g, ' '));
            // Срезаем пустую строку, остающуюся между соседними правилами.
            // Именно пустую (две подряд \n): если срезать любой \n, закрывающая
            // скобка блока склеивается — «...}» + «}» превращается в «...}}».
            if (result.endsWith('\n\n')) result = result.slice(0, -1);
            i = blockEnd + 1;
            continue;
        }

        const originalGroups = selector.split(',').map(g => g.trim()).filter(Boolean);
        if (info.live.length < originalGroups.length) {
            // Часть групп выбрасываем: правило «.btn, .card {}» -> «.btn {}».
            // Правка списка селекторов, тело блока не трогаем.
            const indent = (text.slice(i, i + 8).match(/^[ \t]*/) || [''])[0];
            result += indent + info.live.join(',\n' + indent) + text.slice(braceStart, blockEnd + 1);
            slimmedRules++;
            slimmedSelectors.push(selector.trim().replace(/\s+/g, ' ') +
                '  ->  ' + info.live.join(', '));
        } else {
            result += text.slice(i, blockEnd + 1);
        }
        i = blockEnd + 1;
    }
    return result;
}

function findBlockEnd(text, braceStart) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

const out = processRange(src, 0, src.length);

const before = src.split(/\r?\n/).length;
const after = out.split(/\r?\n/).length;
console.log('Классов в списке: ' + dead.length);
console.log('Удалено правил целиком: ' + removedRules);
console.log('Прорежено правил (убраны мёртвые селекторы из списка): ' + slimmedRules);
console.log('Строк: ' + before + ' -> ' + after + ' (минус ' + (before - after) + ')');
if (process.env.LIST) {
    console.log('--- УДАЛЕНЫ ЦЕЛИКОМ:');
    for (const s of removedSelectors) console.log('    ' + s);
    console.log('--- ПРОРЕЖЕНЫ:');
    for (const s of slimmedSelectors) console.log('    ' + s);
}
if (process.env.DUMP) {
    // Диагностика: какие селекторы инструмент вообще видит и как их оценивает.
    const seen = [...src.matchAll(/([^{}]+)\{/g)];
    console.log('--- СЕЛЕКТОРЫ (' + seen.length + '), содержащие ' + [...deadSet].join(', '));
    for (const m of seen) {
        const sel = m[1].trim();
        if (![...deadSet].some(d => sel.includes('.' + d))) continue;
        const info = analyzeSelector(sel);
        console.log('    ' + (info.dead ? 'МЁРТВЫЙ  ' : 'живой    ') + ' | ' + sel.replace(/\s+/g, ' ').slice(0, 80));
    }
}
if (process.env.TRACE) {
    // Показываем, какие селекторы реально посещает рекурсивный обход.
    const visited = [];
    for (const s of removedSelectors) visited.push('УДАЛЁН ' + s);
    for (const s of slimmedSelectors) visited.push('ПРОРЕЖАН ' + s);
    console.log('--- ПОСЕЩЕНО ПРАВИЛ С МЁРТВЫМИ КЛАССАМИ: ' + visited.length);
    for (const v of visited) console.log('    ' + v);
    // Ищем в raw-тексте случаи, где мёртвый класс стоит в селекторе, который
    // обход пропустил (значит, он съел блок целиком).
    const missing = [];
    for (const d of deadSet) {
        const re = new RegExp('(^|[,{}])\\s*\\.' + d.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '(?![\\w-])', 'gm');
        let mm;
        while ((mm = re.exec(src)) !== null) {
            const line = src.slice(0, mm.index).split('\n').length;
            if (!removedSelectors.some(r => r.includes('.' + d))) {
                missing.push('.' + d + ' (строка ' + line + ')');
            }
            break;
        }
    }
    if (missing.length) {
        console.log('--- ПРОПУЩЕНЫ ОБХОДОМ (требуют разбора):');
        for (const m of missing) console.log('    ' + m);
    }
}

if (apply) {
    fs.writeFileSync(FILE, out, 'utf8');
    console.log('ЗАПИСАНО в public/styles.css');
} else {
    console.log('(--dry: файл не изменён. Добавьте --apply для записи)');
}
