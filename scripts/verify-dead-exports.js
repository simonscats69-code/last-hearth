/**
 * Поиск мёртвых экспортов.
 *
 * Запуск: node scripts/verify-dead-exports.js
 *
 * Скрипт не меняет код. Он перебирает экспортируемые имена и ищет их в
 * остальных файлах проекта. Имя, которое нигде больше не встречается,
 * можно убирать из module.exports — оно никем не читается, но отвлекает
 * и маскирует настоящие дубли.
 *
 * История вопроса: в gameConstants.js из 18 экспортов 11 были мёртвыми,
 * и среди них прятался опасный getItemCategory, определявший категорию
 * предмета по диапазонам ID (тот же баг, что уже был на клиенте).
 *
 * Ограничение: имя, встречающееся в комментарии, будет сочтено живым.
 * Это осознанный выбор — сомнительные случаи лучше посмотреть глазами.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Модули, чьи экспорты проверяем.
const MODULES = [
    'utils/serverApi.js',
    'utils/log.js',
    'utils/game-helpers.js',
    'utils/scheduler.js',
    'utils/metrics.js',
    'db/database.js',
    'db/schema.js',
    'db/init.js',
    'db/migrate.js',
    'db/players.js',
    'db/pvp.js'
];

/**
 * Собирает *.js, исключая node_modules, временные и скрипты.
 * @returns {string[]} абсолютные пути
 */
function collectJsFiles() {
    const out = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['node_modules', '.kilo', 'test'].includes(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) out.push(full);
        }
    })(ROOT);
    return out;
}

/**
 * Разбирает module.exports = { a, b: c, ... } на список имён.
 * Поддерживает и объектный формат, и повторяющиеся `module.exports.x = ...`.
 *
 * @param {string} src исходник модуля
 * @returns {string[]} экспортемые имена
 */
function parseExports(src) {
    const names = new Set();

    const block = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
    if (block) {
        for (const raw of block[1].split(',')) {
            const token = raw
                .replace(/\/\/.*$/gm, '')   // комментарии
                .replace(/^[\s*]+/, '')
                .trim();
            if (!token) continue;

            // Проверяется только КЛЮЧ: именно по нему потребители делают
            // require(...).name. Для `transaction: tx` читают .transaction,
            // а не .tx — спутав ключ и значение, получил бы ложную
            // диагностику в обе стороны.
            //
            // Значение может быть не идентификатором (PlayerHelper: {...}),
            // поэтому берём просто то, что до двоеточия, а не regex
            // «ключ: идентификатор» — иначе такие экспорты мимо проверки.
            const colon = token.indexOf(':');
            const key = (colon === -1 ? token : token.slice(0, colon)).trim();

            if (/^[A-Za-z_$][\w$]*$/.test(key)) {
                names.add(key);
            }
        }
    }

    for (const m of src.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
        names.add(m[1]);
    }

    return [...names];
}

function main() {
    const allFiles = collectJsFiles();

    let anyDead = false;

    for (const rel of MODULES) {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) {
            console.log(`${rel}: файл не найден`);
            continue;
        }

        const src = fs.readFileSync(full, 'utf8');
        const exports = parseExports(src);
        if (exports.length === 0) continue;

        // Склеиваем весь остальной проект (кроме самого модуля)
        let others = '';
        const self = path.resolve(full).replace(/\\/g, '/');
        for (const file of allFiles) {
            if (path.resolve(file).replace(/\\/g, '/') === self) continue;
            others += fs.readFileSync(file, 'utf8');
        }

        const dead = exports.filter((name) => {
            const re = new RegExp(`\\b${name}\\b`);
            return !re.test(others);
        });

        if (dead.length > 0) {
            anyDead = true;
            console.log(`${rel}: ${exports.length} экспортов -> мёртвых ${dead.length}`);
            for (const name of dead) console.log(`    ${name}`);
        } else {
            console.log(`${rel}: ${exports.length} экспортов, мёртвых нет`);
        }
    }

    if (anyDead) {
        console.log('\nМёртвый экспорт — кандидат на удаление. Но проверьте глазами, что');
        console.log('имя действительно никем не читается, а не просто упоминается');
        console.log('в комментарии, который стоит оставить.');
    }
}

// Только при прямом запуске: иначе require() из проверки загрузки модулей
// исполнил бы проверку вместо того, чтобы просто вернуть модуль.
if (require.main === module) {
    main();
}