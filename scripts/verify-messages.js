/**
 * Сверка строк ответов API с эталоном.
 *
 * Запуск: node scripts/verify-messages.js <каталог-эталон>
 *
 * Рефакторинг меняет форму ответа (например, res.json(...) переносится
 * из try наружу), и при переносе легко потерять или переврать слово в
 * пользовательском сообщении. Линтер и node --check такое пропускают:
 * строка синтаксически корректна, просто стала другой.
 *
 * Скрипт вытаскивает все строковые литералы из полей error/message/code
 * и сверяет их с эталоном, показывая пропавшие и появившиеся.
 *
 * Как подготовить эталон (PowerShell):
 *   git ls-tree -r --name-only HEAD -- routes |
 *     ForEach-Object {
 *       $t = Join-Path $tmp ($_ -replace '/','\')
 *       New-Item -ItemType Directory -Path (Split-Path $t) -Force | Out-Null
 *       git show "HEAD:$_" | Set-Content -NoNewline $t
 *     }
 *   node scripts/verify-messages.js $tmp\routes
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Поля, значение которых клиент видит и на которые может опираться UI.
const FIELD_RE = /\b(?:error|message|code)\s*:\s*(?:'([^']*)'|"([^"]*)")/g;

// Тот же текст, но переданный аргументом в общий хелпер:
// unauthorized(res, 'Не авторизован'), fail(res, 'Нет монет', 'CODE') и т.п.
//
// Без этой второй проверки замена ручного res.status(401).json({ error:
// 'Не авторизован' }) на unauthorized(res, 'Не авторизован') выглядела бы
// как «строка пропала», хотя для клиента ничего не изменилось.
const HELPER_RE = /\b(?:unauthorized|notFound|fail|error)\s*\(\s*res\s*,\s*(?:'([^']*)'|"([^"]*)")/g;

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
 * Собирает пары «строка — в скольких местах встречается».
 * Не просто множество: потеря одного из двух одинаковых сообщений —
 * тоже изменение, поэтому считаем количество.
 *
 * @param {string} dir каталог
 * @returns {Map<string, number>} текст -> количество вхождений
 */
function collect(dir) {
    const counts = new Map();

    for (const file of walk(dir)) {
        const src = fs.readFileSync(file, 'utf8');

        FIELD_RE.lastIndex = 0;
        let m;
        while ((m = FIELD_RE.exec(src)) !== null) {
            const value = m[1] !== undefined ? m[1] : m[2];
            counts.set(value, (counts.get(value) || 0) + 1);
        }

        HELPER_RE.lastIndex = 0;
        while ((m = HELPER_RE.exec(src)) !== null) {
            const value = m[1] !== undefined ? m[1] : m[2];
            counts.set(value, (counts.get(value) || 0) + 1);
        }
    }

    return counts;
}

function main() {
    const refDir = process.argv[2];
    if (!refDir) {
        console.log('Укажите каталог с эталоном, например:');
        console.log('  node scripts/verify-messages.js <каталог>');
        process.exit(1);
    }

    const ref = collect(path.resolve(refDir));
    const cur = collect(path.join(ROOT, 'routes'));

    const removed = [];
    const added = [];

    for (const [text, count] of ref) {
        const now = cur.get(text) || 0;
        if (now < count) removed.push(`  - "${text}" (было ${count}, стало ${now})`);
    }
    for (const [text, count] of cur) {
        const before = ref.get(text) || 0;
        if (count > before) added.push(`  + "${text}" (было ${before}, стало ${count})`);
    }

    console.log(`Строк в эталоне: ${ref.size}, сейчас: ${cur.size}`);
    console.log(removed.length ? `ПРОПАЛИ:\n${removed.join('\n')}` : 'ПРОПАЛИ: нет');
    console.log(added.length ? `ПОЯВИЛИСЬ:\n${added.join('\n')}` : 'ПОЯВИЛИСЬ: нет');
}

// Только при прямом запуске. Иначе require() из другого скрипта (например,
// из проверки загрузки модулей) исполнил бы проверку и напечатал usage.
if (require.main === module) {
    main();
}