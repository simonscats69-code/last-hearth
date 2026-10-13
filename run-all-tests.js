/**
 * Единый прогон всех тестовых харнесов проекта.
 * Использование: node run-all-tests.js
 *
 * Харнессы мокают зависимости и вызывают настоящие обработчики роутов,
 * поэтому проверяют не только синтаксис, но и области видимости, порядок
 * параметров SQL и побочные эффекты.
 *
 * Также прогоняет scripts/verify-*.js. ЗДЕСЬ БЫЛА ДЫРА: раньше собирались
 * только test-*.js, поэтому падение verify-скрипта (например verify-rules,
 * который умеет выходить с кодом 1) в общем прогоне выглядело зелёным.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Список берём с диска, чтобы новые тесты не приходилось добавлять вручную.
const harnesses = fs.readdirSync(__dirname)
    .filter(f => /^test-.*\.js$/.test(f))
    .sort();

// Проверочные скрипты: они не печатают «ИТОГ», зато возвращают exit code,
// поэтому судим по коду возврата.
const verifiers = fs.readdirSync(path.join(__dirname, 'scripts'))
    .filter(f => /^verify-.*\.js$/.test(f))
    .map(f => path.join('scripts', f))
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

// Проверочные скрипты. Некоторые (verify-messages) требуют аргумент-каталог,
// вне прогона они бесполезны — их пропускаем.
const VERIFIERS_NEEDING_ARGS = new Set(['scripts/verify-messages.js']);

for (const v of verifiers) {
    if (VERIFIERS_NEEDING_ARGS.has(v.replace(/\\/g, '/'))) continue;
    try {
        execFileSync(process.execPath, [path.join(__dirname, v)], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        if (/Укажите|использование|Usage/i.test(String(e.stdout || ''))) continue; // требует аргументы
        failed.push(v);
        console.log('FAIL ' + v + ' [exit ' + (typeof e.status === 'number' ? e.status : 1) + ']');
        String(e.stdout || '').split(/\r?\n/)
            .filter(l => /РАСХОЖ|✗|problems|ИТОГ/i.test(l))
            .slice(0, 5)
            .forEach(l => console.log('   ' + l.trim()));
    }
}

console.log('');
const verifiersRun = verifiers.filter(v => !VERIFIERS_NEEDING_ARGS.has(v.replace(/\\/g, '/'))).length;
console.log('Харнесов: ' + harnesses.length + ' + проверок: ' + verifiersRun +
    ' (' + VERIFIERS_NEEDING_ARGS.size + ' требуют аргументов), пройдено тестов: ' + totalPassed + ', упало: ' + totalFailed);
if (failed.length) {
    console.log('Проблемные: ' + failed.join(', '));
    process.exit(1);
}
console.log('ВСЕ ЗЕЛЁНЫЕ');
