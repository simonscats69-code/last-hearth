/**
 * Тест P1-7: фактический общий лимит игрока.
 *
 * До исправления висело ДВА последовательных лимитера по playerId:
 *   generalActionLimiter  max: 60   (router.use первым)
 *   playerActionLimiter   max: 120  (router.use вторым)
 * Первый всегда срабатывал первым -> фактический лимит 60/мин,
 * второй был недостижимым мёртвым кодом, а его комментарий про
 * «120/мин хватает на бой и фарм» не соответствовал поведению.
 *
 * Тест проверяет:
 *  1. В routes/game/index.js ровно ОДИН общий лимитер на игрока.
 *  2. Его max = 120 (как и задумано).
 *  3. Точечные лимиты на месте: атаки 60, покупки 20, IP 120.
 *  4. Ни одного playerActionLimiter в коде не осталось.
 */
const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, 'routes/game/index.js');
const src = fs.readFileSync(p, 'utf8');
const lines = src.split(/\r?\n/);

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

console.log('=== P1-7: структура лимитеров ===');

/** Достаёт max из определения лимитера по имени переменной */
function maxOf(name) {
    const idx = lines.findIndex(l => new RegExp('const ' + name + '\\s*=\\s*rateLimit\\(\\{\\s*$').test(l));
    if (idx === -1) return null;
    for (let i = idx; i < Math.min(idx + 8, lines.length); i++) {
        const m = /^\s*max:\s*(\d+)/.exec(lines[i]);
        if (m) return Number(m[1]);
    }
    return null;
}

/** Считает ТОЛЬКО реальные router.use(<name>) */
function usesOf(name) {
    return lines.filter(l => new RegExp('^\\s*router\\.use\\(\\s*' + name + '\\s*\\)').test(l)).length;
}

console.log('  definied limiters:');
['ipFloodLimiter', 'criticalActionLimiter', 'generalActionLimiter', 'purchaseLimiter'].forEach(n => {
    console.log('    ' + n + ': max=' + maxOf(n) + ', router.use=' + usesOf(n));
});

// 1. Один общий лимитер
const uses = usesOf('generalActionLimiter');
ok('общий лимитер подключён ровно один раз', uses === 1, uses);
ok('playerActionLimiter удалён (мёртвый код)',
    maxOf('playerActionLimiter') === null && usesOf('playerActionLimiter') === 0,
    'max=' + maxOf('playerActionLimiter'));

// 2. Значение 120
ok('общий лимитер = 120/мин (как задокументировано)', maxOf('generalActionLimiter') === 120, maxOf('generalActionLimiter'));
ok('общий лимитер использует playerKey (по id игрока)',
    /keyGenerator:\s*playerKey/.test(src.slice(src.indexOf('const generalActionLimiter'), src.indexOf('const generalActionLimiter') + 220)),
    'keyGenerator не playerKey');

// 3. Точечные лимиты не тронуты
ok('IP-флуд лимитер = 120', maxOf('ipFloodLimiter') === 120, maxOf('ipFloodLimiter'));
ok('критические действия = 60', maxOf('criticalActionLimiter') === 60, maxOf('criticalActionLimiter'));
ok('покупки = 20', maxOf('purchaseLimiter') === 20, maxOf('purchaseLimiter'));

// 4. Порядок: IP-лимитер -> validatePlayer -> точечные -> общий
// Учитываем только реальные router.use(...), не комментарии.
const order = [];
lines.forEach((l, i) => {
    if (/^\s*router\.use\(ipFloodLimiter\)/.test(l)) order.push(['ipFlood', i]);
    if (/^\s*router\.use\(validatePlayer\)/.test(l)) order.push(['validatePlayer', i]);
    if (/^\s*router\.use\('\/pvp\/attack', criticalActionLimiter\)/.test(l)) order.push(['critical', i]);
    if (/^\s*router\.use\(generalActionLimiter\)/.test(l)) order.push(['generalAction', i]);
});
ok('порядок: ipFlood < validatePlayer < точечные < общий',
    order.length === 4 && order[0][1] < order[1][1] && order[1][1] < order[2][1] && order[2][1] < order[3][1],
    JSON.stringify(order.map(o => o[0] + '@' + (o[1] + 1))));

// 5. validatePlayer идёт ДО лимитов по playerId (иначе keyGenerator не сработает)
const vpIdx = lines.findIndex(l => /router\.use\(validatePlayer\)/.test(l));
const criticalIdx = lines.findIndex(l => /router\.use\('\/pvp\/attack'/.test(l));
ok('validatePlayer раньше лимитов по id игрока', vpIdx < criticalIdx, vpIdx + ' vs ' + criticalIdx);

// 6. Алиасы /inventory/buy не потеряны
ok('алиас /inventory/buy под лимитом покупок',
    lines.some(l => /router\.use\('\/inventory\/buy', purchaseLimiter\)/.test(l)));
ok('алиас /inventory/buy-stars под лимитом покупок',
    lines.some(l => /router\.use\('\/inventory\/buy-stars', purchaseLimiter\)/.test(l)));

// 7. Синтаксис файла корректен (настоящая проверка, а не костыль с new Function)
try {
    require('child_process').execSync('node --check ' + JSON.stringify(p), { stdio: 'pipe' });
    ok('node --check routes/game/index.js проходит', true);
} catch (e) {
    ok('node --check routes/game/index.js проходит', false, String(e.stderr || e.message).slice(0, 160));
}

console.log('\n========================================');
console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
