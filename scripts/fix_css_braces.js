/**
 * Нормализует склейку закрывающих скобок вида «...; }}».
 *
 * Появляется, когда правило удаляется с конца блока @media/@keyframes:
 * перевод строки перед «}» блока съедается вместе с удалённым правилом.
 * На результат это не влияет (CSS нечувствителен к переводам строк), но
 * файл становится нечитаемым, поэтому приводим к нормальному виду.
 *
 * Безопасно: предварительно проверяем, что в файле нет фигурных скобок
 * внутри строк и url(...), иначе замена исказила бы содержимое.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'styles.css');

let css = fs.readFileSync(FILE, 'utf8');

const urlWithBrace = [...css.matchAll(/url\([^)]*[{}][^)]*\)/g)];
const strWithBrace = [...css.matchAll(/'[^'\r\n]*[{}][^'\r\n]*'/g)];
if (urlWithBrace.length || strWithBrace.length) {
    console.error('В файле есть фигурные скобки внутри url()/строк — нормализация отменена.');
    process.exit(1);
}

const before = css.split(/\r?\n/).length;
css = css.replace(/\}\}/g, '}\n}');
const after = css.split(/\r?\n/).length;

// Проверка баланса скобок после правки
let depth = 0;
for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
}
if (depth !== 0) {
    console.error('Баланс скобок нарушен (' + depth + ') — запись отменена.');
    process.exit(1);
}

fs.writeFileSync(FILE, css, 'utf8');
console.log('Склейки «}}» исправлены. Строк: ' + before + ' -> ' + after);
console.log('Баланс скобок: ' + depth);
