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
const dry = args.includes('--dry') || !apply;
const dead = args.filter(a => a.startsWith('.')).map(a => a.slice(1));

if (!dead.length) {
    console.error('Укажите классы: node scripts/prune_css.js --dry .a .b');
    process.exit(1);
}

const deadSet = new Set(dead);
const src = fs.readFileSync(FILE, 'utf8');
let out = '';
let pos = 0;
let removedRules = 0;
let removedLines = 0;

const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;

function selectorIsDead(selector) {
    const classes = [...selector.matchAll(CLASS_RE)].map(m => m[1]);
    if (!classes.length) return false;              // body/html/a — не трогаем
    return classes.every(c => deadSet.has(c));
}

/** Рекурсивно обрабатывает блок @media/@supports, возвращает новый текст */
function processAtBlock(text, blockStart, blockEnd) {
    return { text: processRange(text, blockStart + 1, blockEnd - 1), start: blockStart, end: blockEnd };
}

/** Обрабатывает диапазон [from, to), предполагая сбалансированные скобки */
function processRange(text, from, to) {
    let result = '';
    let i = from;
    while (i < to) {
        const ch = text[i];

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
            const inner = processRange(text, braceStart + 1, blockEnd - 1);
            result += header + '{' + inner + '}';
            i = blockEnd + 1;
            continue;
        }

        // Обычное правило: собираем селектор до '{'
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

        if (selectorIsDead(selector)) {
            removedRules++;
            removedLines += (blockEnd + 1 - i + 1); // примерно, с новой строки
            // заодно срезаем ведущий перевод строки, чтобы не оставлять пустот
            let cut = i;
            if (out.endsWith('\n')) {
                out = out.slice(0, -1);
                cut--;
            }
            i = blockEnd + 1;
            continue;
        }

        result += text.slice(i, blockEnd + 1);
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

out = processRange(src, 0, src.length);

const before = src.split(/\r?\n/).length;
const after = out.split(/\r?\n/).length;
console.log('Классов в списке: ' + dead.length);
console.log('Удалено правил: ' + removedRules);
console.log('Строк: ' + before + ' -> ' + after + ' (минус ' + (before - after) + ')');

if (apply) {
    fs.writeFileSync(FILE, out, 'utf8');
    console.log('ЗАПИСАНО в public/styles.css');
} else {
    console.log('(--dry: файл не изменён. Добавьте --apply для записи)');
}
