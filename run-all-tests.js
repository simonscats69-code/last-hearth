/**
 * Единый прогон всех тестовых харнессов проекта.
 * Использование: node run-all-tests.js
 *
 * Харнессы мокают зависимости и вызывают настоящие обработчики роутов,
 * поэтому проверяют не только синтаксис, но и области видимости, порядок
 * параметров SQL и побочные эффекты.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Список берём с диска, чтобы новые тесты не приходилось добавлять вручную.
const harnesses = fs.readdirSync(__dirname)
    .filter(f => /^test-.*\.js$/.test(f))
    .sort();

let totalPassed = 0;
let totalFailed = 0;
const failed = [];

for (const h of harnesses) {
    let out = '';
    let code = 0;
    try {
        out = execFileSync(process.execPath, [path.join(__dirname, h)], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        out = String(e.stdout || '');
        code = typeof e.status === 'number' ? e.status : 1;
    }

    const failLines = out.split(/\r?\n/).filter(l => /^\s*FAIL\b/.test(l));
    const summary = (out.match(/ИТОГ:.+/) || [''])[0];
    const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(summary);

    if (m) {
        totalPassed += Number(m[1]);
        totalFailed += Number(m[2]);
    } else {
        // Нет строки итога — считаем один провал, чтобы харнесс не потерялся молча
        totalFailed += 1;
    }

    const bad = (m && Number(m[2]) > 0) || failLines.length || !m;
    if (bad) {
        failed.push(h);
        console.log('FAIL ' + h + (code ? ' [exit ' + code + ']' : ''));
        failLines.forEach(l => console.log('   ' + l.trim()));
    }
}

console.log('');
console.log('Харнессов: ' + harnesses.length + ', пройдено тестов: ' + totalPassed + ', упало: ' + totalFailed);
if (failed.length) {
    console.log('Проблемные: ' + failed.join(', '));
    process.exit(1);
}
console.log('ВСЕ ЗЕЛЁНЫЕ');
