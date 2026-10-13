/**
 * Поиск расхождений в игровых правилах.
 *
 * Запуск: node scripts/verify-rules.js
 *
 * Идея: одно и то же правило (лимит инвентаря, цена, кулдаун, длительность)
 * нередко записано дважды — в клиенте и на сервере, или в двух серверных
 * файлах. Пока значения совпадают, это работает; стоит поправить одну
 * сторону — и клиент покажет одну цифру, а сервер спишет другую.
 *
 * Скрипт собирает именованные константы (UPPER_CASE) из клиента и сервера
 * и печатает те, у которых ОДИНАКОВОЕ ИМЯ, но РАЗНЫЕ значения.
 *
 * Скрипт ничего не меняет.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Клиентские файлы (читаются браузером) и серверные.
//
// public/shared/equipment.js — общий файл правил: его читают и браузер,
// и Node. В выборку клиента он не входит намеренно — иначе каждый его
// элемент сравнивался бы сам с собой и давал ложное «клиент = сервер».
const CLIENT_DIRS = ['public'];
const SERVER_DIRS = ['routes', 'utils', 'db', 'public/shared'];
const CLIENT_EXCLUDE = new Set(['shared']);
// Источник правил: файл, а не каталог. Запасные значения клиентских прокси
// сверяются именно с ним.
const SHARED_DIR = 'public/shared';
const SHARED_FILE = 'public/shared/equipment.js';

/**
 * Признаки того, что константа — не самостоятельное правило, а прокси к
 * общему файлу public/shared/equipment.js.
 *
 * Например: const STARS_COST = window.EquipmentShared?.X ?? 5;
 * Значение 5 здесь — запасной вариант на случай, если shared не загрузился,
 * а правило живёт в одном месте. Считать такое константой-дублем нельзя:
 * так появились бы ложные срабатывания на всех прокси сразу.
 */
const PROXY_MARKERS = /EquipmentShared|equipmentRules|window\.[A-Z]|\?\?/;

/**
 * Собирает запасные значения констант-прокси.
 *
 * Прокси — строка вида `const X = window.EquipmentShared?.Y ?? 60000`.
 * Само правило живёт в public/shared, а 60000 — то, что увидит игрок, если
 * shared не загрузился. Расхождение этих двух чисел молчаливое, поэтому
 * проверяем его отдельно.
 *
 * @param {string} dir каталог
 * @param {Set} exclude исключаемые подкаталоги
 * @returns {Object} файл -> [{ line, fallbackFor, value }]
 */
function collectProxyFallbacks(dir, exclude = new Set()) {
    const abs = path.join(ROOT, dir);
    const stats = {};
    if (!fs.existsSync(abs)) return stats;

    const proxyRe = /\b(?:const\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(?:[^=;]|\n)*?\?\?\s*(\d[\d\s*/.]*)/;
    const sharedRefRe = /(?:EquipmentShared|equipmentRules|window\.[A-Za-z_$]+)[?.\[]*([A-Z][A-Z0-9_]{2,})/;
    const NUM = '-?\\d+(?:\\.\\d+)?(?:\\s*[*/]\\s*-?\\d+(?:\\.\\d+)?)*';
    const proxyReStrict = new RegExp('\\??\\s*([A-Z][A-Z0-9_]{2,})\\s*=\\s*[^=;]*\\?\\?\\s*(' + NUM + ')');

    (function walk(current, rel) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (['node_modules', '.kilo'].includes(entry.name)) continue;
            const full = path.join(current, entry.name);
            const relChild = rel ? `${rel}/${entry.name}` : entry.name;
            if (exclude.has(relChild)) continue;
            if (entry.isDirectory()) walk(full, relChild);
            else if (entry.name.endsWith('.js')) {
                const relPath = path.relative(ROOT, full).replace(/\\/g, '/');
                const lines = fs.readFileSync(full, 'utf8').split('\n');
                lines.forEach((line, index) => {
                    const t = line.trim();
                    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
                    if (!PROXY_MARKERS.test(line)) return;

                    const refMatch = line.match(sharedRefRe);
                    if (!refMatch) return;
                    // Запасное значение берём строгим regex: только \?? <число/выражение>
                    const valueMatch = line.match(/\?\?\s*(\d[\d\s*/.]*)/);
                    if (!valueMatch) return;

                    const value = String(valueMatch[1]
                        .split('*')
                        .map((part) => Number(part.trim()))
                        .reduce((acc, part) => acc * part, 1));

                    (stats[relPath] = stats[relPath] || []).push({
                        line: index + 1,
                        fallbackFor: refMatch[1],
                        value
                    });
                });
            }
        }
    })(abs, '');

    return stats;
}

/**
 * Возвращает Map имя -> массив { file, value } для констант вида
 * `const NAME = 42` или `NAME: 42` в объектах-конфигурациях.
 *
 * Прокси к общему файлу пропускаются — см. PROXY_MARKERS.
 *
 * @param {string} dir каталог
 * @returns {Map<string, Array<{file: string, value: string}>>}
 */
function collectConstants(dir, exclude = new Set()) {
    const found = new Map();
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return found;

    const files = [];
    (function walk(d, rel) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (['node_modules', '.kilo'].includes(entry.name)) continue;
            const full = path.join(d, entry.name);
            const relChild = rel ? `${rel}/${entry.name}` : entry.name;
            if (exclude.has(relChild)) continue;
            if (entry.isDirectory()) walk(full, relChild);
            else if (entry.name.endsWith('.js')) files.push(full);
        }
    })(abs, '');

    // const NAME = <число или выражение вида 60 * 1000>
    //
    // Регулярка берёт и выражение целиком: источник правил
    // public/shared/equipment.js пишет ENERGY_REGEN_INTERVAL_MS = 60 * 1000.
    // Если взять только первое число, клиентское 60000 и исходное 60 дали бы
    // ложное расхождение.
    const NUM = '-?\\d+(?:\\.\\d+)?(?:\\s*[*/]\\s*-?\\d+(?:\\.\\d+)?)*';
    const constRe = new RegExp('\\bconst\\s+([A-Z][A-Z0-9_]{2,})\\s*=\\s*(' + NUM + ')\\b');
    // NAME: <число> в объектах-конфигурациях
    const propRe = new RegExp('\\b([A-Z][A-Z0-9_]{2,})\\s*:\\s*(' + NUM + ')\\b');

    for (const file of files) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');

        lines.forEach((line, index) => {
            // Прокси к общему файлу — не самостоятельное правило.
            if (PROXY_MARKERS.test(line)) return;

            // Комментарии и строки внутри JSDoc/блока: правило, упомянутое
            // в описании, не задаёт его значение. Без этой проверки
            // `const STARS_COST = 5` внутри комментария считался бы
            // настоящей константой.
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

            for (const re of [constRe, propRe]) {
                const m = line.match(re);
                if (!m) continue;

                const [, name, rawValue] = m;
                // '60 * 1000' -> 60000: сравнивать надо числа, иначе источник,
                // записанный выражением, конфликтовал бы с клиентским числом.
                const value = String(rawValue
                    .split('*')
                    .map((part) => Number(part.trim()))
                    .reduce((acc, part) => acc * part, 1));

                if (!found.has(name)) found.set(name, []);
                found.get(name).push({
                    file: `${path.relative(ROOT, file).replace(/\\/g, '/')}:${index + 1}`,
                    value
                });
                break;
            }
        });
    }

    return found;
}

function main() {
    const client = collectConstants(CLIENT_DIRS[0], CLIENT_EXCLUDE);
    const server = new Map();
    for (const dir of SERVER_DIRS) {
        for (const [name, list] of collectConstants(dir)) {
            if (!server.has(name)) server.set(name, []);
            server.get(name).push(...list);
        }
    }

    // Запасные значения прокси клиента — для сверки с источником правил
    const PROXY_STATS = collectProxyFallbacks(CLIENT_DIRS[0], CLIENT_EXCLUDE);

    const conflicts = [];

    for (const [name, clientList] of client) {
        const serverList = server.get(name);
        if (!serverList) continue;

        const clientValues = new Set(clientList.map((x) => x.value));
        const serverValues = new Set(serverList.map((x) => x.value));

        // Расхождение есть, если общая пара «клиент/сервер» с разными числами
        const differing = [...clientValues].some((cv) => ![...serverValues].includes(cv));
        if (differing) {
            conflicts.push({ name, clientList, serverList });
        }
    }

    if (conflicts.length === 0) {
        console.log(`Расхождений в одноимённых константах клиента и сервера не найдено.`);
    } else {
        console.log(`Расхождений найдено: ${conflicts.length}\n`);
        for (const c of conflicts) {
            console.log(c.name);
            for (const x of c.clientList) console.log(`  клиент  ${x.file}: ${x.value}`);
            for (const x of c.serverList) console.log(`  сервер  ${x.file}: ${x.value}`);
            console.log('');
        }
    }

    // Сколько вообще одноимённых констант сопоставлено. Ноль означал бы,
    // что скрипт не работает: имена в клиенте и сервере разные, и искать
    // расхождения по ним бессмысленно — нужен другой подход.
    let shared = 0;
    for (const [name, clientList] of client) {
        if (!server.has(name)) continue;
        shared++;

        const cv = [...new Set(clientList.map((x) => x.value))].join(', ');
        const sv = [...new Set(server.get(name).map((x) => x.value))].join(', ');
        console.log(`  ${name.padEnd(32)} клиент=${cv.padEnd(10)} сервер=${sv}`);
    }
    console.log(`\nОдноимённых констант сопоставлено: ${shared} ` +
        `(клиент: ${client.size}, сервер: ${server.size})`);

    // Второй смысл сопоставления: клиентские прокси против источника правил.
    //
    // Прокси вида `const X = window.EquipmentShared?.Y ?? 60000` не берётся
    // как самостоятельное правило (PROXY_MARKERS), но запасное число —
    // единственное, что увидит игрок, если shared не загрузился. Если оно
    // разойдётся с источником, молчаливого способа это заметить не остаётся.
    const sharedConstants = collectConstants(SHARED_DIR);    let proxyChecked = 0;
    const proxyConflicts = [];

    for (const [file, entries] of Object.entries(PROXY_STATS)) {
        for (const entry of entries) {
            const source = sharedConstants.get(entry.fallbackFor);
            if (!source) continue;
            proxyChecked++;
            const sourceValue = source[0].value;
            if (String(entry.value) !== String(sourceValue)) {
                proxyConflicts.push({
                    file: `${file}:${entry.line}`,
                    name: entry.fallbackFor,
                    clientValue: entry.value,
                    sourceValue
                });
            }
        }
    }

    if (proxyChecked > 0) {
        console.log(`\nЗапасных значений проверено против ${SHARED_DIR}: ${proxyChecked}`);
        if (proxyConflicts.length === 0) {
            console.log('Все запасные значения совпадают с источником правил.');
        } else {
            console.log(`РАСХОЖДЕНИЯ ЗАПАСНЫХ ЗНАЧЕНИЙ: ${proxyConflicts.length}`);
            for (const c of proxyConflicts) {
                console.log(`  ${c.name}: запасное ${c.clientValue} (${c.file}) != источник ${c.sourceValue}`);
            }
        }
    }

    // Правила, известные только клиенту, — потенциальная проблема: клиент
    // что-то проверяет или показывает, а сервер о таком правиле не знает.
    // Обратная ситуация безопаснее: серверу законно известно больше, чем
    // нужно браузеру (таймауты SQL, служебные лимиты), поэтому «только
    // на сервере» не приводится.
    const clientOnly = [...client.keys()].filter((name) => !server.has(name));
    if (clientOnly.length === 0) {
        console.log('Правил, известных только клиенту, нет.');
    } else {
        console.log(`\nПравила, известные только клиенту (${clientOnly.length}) — проверьте,`);
        console.log('нужно ли то же самое серверу:');
        for (const name of clientOnly) {
            for (const x of client.get(name)) {
                console.log(`  ${name} = ${x.value}   (${x.file})`);
            }
        }
    }

    // Итоговый код выхода.
    //
    // ЗДЕСЬ БЫЛ ВАКУУМ: при shared === 0 и conflicts === 0 скрипт печатал
    // «расхождений не найдено» и выходил с 0. Все правила-дубли были сведены
    // в public/shared/equipment.js, пересечений имён между клиентом и сервером
    // не осталось — скрипт всегда давал «всё хорошо», ничего не проверяя.
    const effectiveChecks = Math.max(shared, proxyChecked);
    const totalProblems = conflicts.length + proxyConflicts.length;
    if (totalProblems > 0) {
        console.log(`\nИТОГ: проблем ${totalProblems}.`);
        process.exit(1);
    }
    if (effectiveChecks === 0) {
        console.log('\nИТОГ: скрипт не проверил НИЧЕГО (0 сопоставленных констант, 0 запасных значений).');
        process.exit(1);
    }
    console.log('\nИТОГ: проблем нет.');
    process.exit(0);
}

if (require.main === module) {
    main();
}
