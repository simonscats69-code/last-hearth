/**
 * Инвентаризация маршрутов и ответов API.
 *
 * Запуск: node scripts/verify-routes.js
 *
 * Скрипт НИЧЕГО не меняет: он только читает исходники и печатает список
 * эндпоинтов. Нужен, чтобы заметить, что рефакторинг (перенос на общие
 * ok/fail/handleError, транзакции, validateId) случайно убрал или
 * переименовал маршрут. Сравнение — снимок до/после:
 *
 *   node scripts/verify-routes.js > before.txt
 *   ... изменения ...
 *   node scripts/verify-routes.js > after.txt
 *   Compare-Object before.txt after.txt
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Методы, которые объявляют эндпоинт.
const METHOD_RE = /router\.(get|post|put|patch|delete)\s*\(\s*(\[[\s\S]*?\]|'[^']*'|"[^"]*")/g;
// Эндпоинты, объявленные прямо на app (минуя роутер).
const APP_RE = /\bapp\.(get|post|put|patch|delete)\s*\(\s*(\[[\s\S]*?\]|'[^']*'|"[^"]*")/g;

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/**
 * Приводит аргумент маршрута к читаемому виду: ['/a', '/b'] -> /a, /b
 */
function normalizePaths(raw) {
    return raw
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .join(', ');
}

/**
 * Собирает эндпоинты из каталога роутеров.
 * @param {string} dir каталог с *.js
 * @returns {Array<{file: string, line: number, method: string, paths: string}>}
 */
function collectRoutes(dir) {
    const results = [];

    if (!fs.existsSync(dir)) return results;

    for (const file of walk(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');

        for (const re of [METHOD_RE, APP_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(src)) !== null) {
                const line = src.slice(0, m.index).split('\n').length;
                results.push({
                    file: rel,
                    line,
                    method: m[1].toUpperCase(),
                    paths: normalizePaths(m[2])
                });
            }
        }
    }

    results.sort((a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.method.localeCompare(b.method) ||
        a.paths.localeCompare(b.paths)
    );

    return results;
}

function main() {
    const args = process.argv.slice(2);

    /**
     * Режим сравнения: node scripts/verify-routes.js --diff <каталог>
     * Печатает, каких эндпоинтов не хватает относительно <каталог>.
     * Нужен, чтобы доказать, что рефакторинг ничего не убрал:
     *   git show HEAD:routes/... > tmp/routes/...   # восстановить снимок
     *   node scripts/verify-routes.js --diff tmp/routes
     */
    if (args[0] === '--diff' && args[1]) {
        const before = collectRoutes(path.resolve(args[1]));
        const after = collectRoutes(path.join(ROOT, 'routes'));
        const beforeSet = new Set(before.map((r) => `${r.method} ${r.paths}`));
        const afterSet = new Set(after.map((r) => `${r.method} ${r.paths}`));

        const lost = before.filter((r) => !afterSet.has(`${r.method} ${r.paths}`));
        const added = after.filter((r) => !beforeSet.has(`${r.method} ${r.paths}`));

        console.log(`В снимке: ${before.length}, сейчас: ${after.length}`);
        console.log(lost.length ? `ПОТЕРЯНО:\n  ${lost.map((r) => `${r.method} ${r.paths}`).join('\n  ')}` : 'ПОТЕРЯНО: нет');
        console.log(added.length ? `ПОЯВИЛОСЬ:\n  ${added.map((r) => `${r.method} ${r.paths}`).join('\n  ')}` : 'ПОЯВИЛОСЬ: нет');
        return;
    }

    const results = collectRoutes(path.join(ROOT, 'routes'));

    for (const r of results) {
        console.log(`${r.file}:${r.line} ${r.method} ${r.paths}`);
    }
    console.log(`\nВсего эндпоинтов: ${results.length}`);
}

// Только при прямом запуске: иначе require() из проверки загрузки модулей
// исполнил бы инвентаризацию маршрутов вместо того, чтобы её вернуть.
if (require.main === module) {
    main();
}