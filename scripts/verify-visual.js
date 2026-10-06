const fs = require('fs');
const css = fs.readFileSync('public/styles.css', 'utf8');
// CSS без комментариев — пояснения не должны влиять на проверки
const codeOnly = css.replace(/\/\*[\s\S]*?\*\//g, '');

let fail = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); fail++; };

console.log('=== 1. Баланс скобок ===');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
open === close ? ok('скобки сбалансированы: ' + open) : bad('скобки: { =' + open + ', } =' + close);

console.log('\n=== 2. Все ли @keyframes определены ===');
const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
const dupes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1])
  .filter((v, i, a) => a.indexOf(v) !== i);
[...new Set(dupes)].length
  ? bad('дубли @keyframes: ' + [...new Set(dupes)].join(', '))
  : ok('дублей нет, всего ' + defined.size);

const usedAnim = new Set();
for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+/)[0];
    if (/^[a-z][\w-]*$/i.test(name) && !['none', 'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'alternate', 'normal', 'reverse', 'both', 'forwards', 'backwards', 'running', 'paused'].includes(name)) {
      usedAnim.add(name);
    }
  }
}
for (const m of fs.readFileSync('public/game.js', 'utf8').matchAll(/animation\s*=\s*'([^']+)'/g)) {
  usedAnim.add(m[1].trim().split(/\s+/)[0]);
}
const missing = [...usedAnim].filter(n => !defined.has(n));
missing.length ? bad('нет определения: ' + missing.join(', ')) : ok('все ' + usedAnim.size + ' используемых анимаций определены');

console.log('\n=== 3. Все ли var(--token) объявлены ===');
const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
// токены, задаваемые на месте (--slot-rarity и т.п.)
const local = new Set([...css.matchAll(/(--[\w-]+)\s*:\s*var\(/g)].map(m => m[1]));
const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
const undef = [...used].filter(t => !declared.has(t) && !local.has(t));
undef.length ? bad('не объявлены: ' + undef.join(', ')) : ok('все ' + used.size + ' использованных токенов объявлены');

console.log('\n=== 4. Ссылки на удалённые темы ===');
const js = fs.readFileSync('public/game.js', 'utf8') + fs.readFileSync('public/index.html', 'utf8');
// Код без комментариев — иначе проверка цепляется за мои же пояснения
// «темы удалены», где эти слова упомянуты намеренно.
const codeOnlyJs = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/data-theme=|prefers-color-scheme/.test(codeOnly)
  ? bad('остались упоминания тем в коде CSS')
  : ok('в коде CSS тем нет');
/data-theme|setTheme|colorScheme/.test(codeOnlyJs)
  ? bad('остались упоминания тем в коде JS')
  : ok('в коде JS тем нет');

console.log('\n=== 5. getRarityColor удалён ===');
/getRarityColor/.test(js) && !/getRarityColor удалён/.test(js) ? bad('остались вызовы getRarityColor') : ok('вызовов нет');

console.log('\n=== 6. Старая синяя палитра ===');
const blues = ['#1a1a2e', '#0f0f23', '#16213e', '#2a2a4a', '#1a1a3a', '#6366f1', '#3a3a5c'];
const left = blues.filter(b => codeOnly.toLowerCase().includes(b));
left.length ? bad('остались: ' + left.join(', ')) : ok('ни одного из ' + blues.length + ' старых синих цветов');

console.log('\n' + (fail ? 'ПРОБЛЕМ: ' + fail : 'Всё чисто'));
process.exit(fail ? 1 : 0);
