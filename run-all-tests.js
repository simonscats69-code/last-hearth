/**
 * Единый прогон всех тестовых харнессей проекта.
 * Использование: node run-all-tests.js
 *
 * Харнессы мокают зависимости и вызывают настоящие обработчики роутов,
 * поэтому проверяют не только синтаксис, но и области видимости, порядок
 * параметров SQL и побочные эффекты.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const harnesses = [
    'test-search-harness.js',
    'test-pvp-harness.js',
    'test-status-harness.js',
    'test-boss-weapon-harness.js',
    'test-boss-keys-harness.js',
    'test-raid-race-harness.js',
    'test-achievement-harness.js',
    'test-items-quantity-harness.js',
    'test-ratelimit-harness.js',
    'test-idempotency-harness.js',
    'test-p2-fixes-harness.js',
    'test-gamejs-harness.js',
    'test-gamejs-guards.js'
];

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

for (const h of harnesses) {
    process.stdout.write('\n##### ' + h + ' #####\n');

    let out = '';
    let exitCode = 0;
    try {
        out = execFileSync(process.execPath, [path.join(__dirname, h)], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        out = String(e.stdout || '');
        exitCode = typeof e.status === 'number' ? e.status : 1;
    }

    // Показываем только строки итога и падений, чтобы вывод не тонул в логах
    const lines = out.split(/\r?\n/);
    const fails = lines.filter(l => /^\s*FAIL\b/.test(l));
    const summary = lines.filter(l => /ИТОГ:/.test(l)).pop() || '<нет строки итога>';

    if (fails.length) {
        process.stdout.write(fails.join('\n') + '\n');
        failures.push(h);
    }
    process.stdout.write('  ' + summary + (exitCode !== 0 ? '  [exit ' + exitCode + ']' : '') + '\n');

    const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(summary);
    if (m) {
        totalPassed += Number(m[1]);
        totalFailed += Number(m[2]);
    } else if (exitCode !== 0) {
        totalFailed += 1;
    }
}

process.stdout.write('\n========================================\n');
process.stdout.write('Сводка\n');
process.stdout.write('========================================\n');
process.stdout.write('  Харнессов запущено : ' + harnesses.length + '\n');
process.stdout.write('  Всего тестов       : ' + (totalPassed + totalFailed) + '\n');
process.stdout.write('  Пройдено           : ' + totalPassed + '\n');
process.stdout.write('  Упало              : ' + totalFailed + '\n');
if (failures.length) {
    process.stdout.write('  Проблемные         : ' + failures.join(', ') + '\n');
}
process.exit(totalFailed > 0 ? 1 : 0);
