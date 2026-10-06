/**
 * Сверка клиентских ЗАПАСНЫХ значений с общим файлом правил.
 *
 * Запуск: node scripts/verify-fallbacks.js
 *
 * Клиент читает правила так:
 *   const X = window.EquipmentShared?.ENERGY_REGEN_INTERVAL_MS ?? 60000;
 * Optional chaining и `??` нужны, чтобы строка не упала с TypeError,
 * если shared/equipment.js не загрузился (404 или обрыв). Но тогда
 * страница живёт на ЗАПАСНОМ числе.
 *
 * Опасность в том, что расхождение не видно: shared загрузился, всё
 * работает, и браузер молча показывает старое правило, пока кто-то не
 * догадается сверить два числа. Скрипт сверяет каждое `?? <число>` с тем,
 * что реально лежит в общем файле.
 *
 * Скрипт ничего не меняет.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'public/shared/equipment.js');
const CLIENT_DIR = path.join(ROOT, 'public');

// window.EquipmentShared?.NAME ?? <число>
const PROXY_RE = /window\.EquipmentShared\??\.([A-Z][A-Z0-9_]*)\s*\?\?\s*(-?\d+(?:\.\d+)?)/g;

/**
 * Собирает *.js верхнего уровня public/ (без shared — он сам эталон).
 * @returns {string[]} абсолютные пути
 */
function clientFiles() {
    return fs.readdirSync(CLIENT_DIR)
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join(CLIENT_DIR, name));
}

function main() {
    // Общий файл — единственный источник правды, читаем его как модуль.
    const shared = require(SHARED);

    const problems = [];
    let checked = 0;

    for (const file of clientFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        const lines = src.split('\n');

        lines.forEach((line, i) => {
            PROXY_RE.lastIndex = 0;
            let m;
            while ((m = PROXY_RE.exec(line)) !== null) {
                const [, name, fallbackText] = m;
                const rel = path.relative(ROOT, file).replace(/\\/g, '/');

                // Правила нет в общем файле — ссылка битая.
                if (!(name in shared)) {
                    problems.push(
                        `${rel}:${i + 1}  ${name} — нет такого имени в shared/equipment.js`
                    );
                    continue;
                }

                checked++;
                const real = shared[name];
                const fallback = Number(fallbackText);

                if (typeof real !== 'number') continue;
                if (real === fallback) continue;

                problems.push(
                    `${rel}:${i + 1}  ${name}\n` +
                    `      в shared/equipment.js: ${real}\n` +
                    `      запасное в клиенте:     ${fallback}` +
                    `   <- страница покажет ${fallback}, пока shared не загрузится`
                );
            }
        });
    }

    console.log(`Проверено прокси-констант: ${checked}`);

    problems.push(...checkFallbackSlotList(shared));

    if (problems.length === 0) {
        console.log('Расхождений между запасными значениями клиента и общим файлом нет.');
        return;
    }

    console.log(`\nРасхождений: ${problems.length}\n`);
    for (const p of problems) console.log(`  ${p}`);

    process.exitCode = 1;
}

/**
 * Сверяет запасной список слотов в клиенте с COMBAT_SLOTS общего файла.
 *
 * Числовые прокси проверяются регуляркой выше, а этот список — нет: он
 * захардкожен массивом строк. Между тем именно он повторяет уже
 * исправленный баг: если в shared добавят слот, клиент без общего файла
 * продолжит считать предметы с этим слотом неэкипируемыми.
 *
 * @param {object} shared общий модуль правил
 * @returns {string[]} список расхождений (пустой, если всё совпало)
 */
function checkFallbackSlotList(shared) {
    const gamePath = path.join(CLIENT_DIR, 'game.js');
    if (!fs.existsSync(gamePath)) return [];

    const src = fs.readFileSync(gamePath, 'utf8');
    const m = src.match(/FALLBACK_COMBAT_SLOTS\s*=\s*\[([^\]]*)\]/);
    if (!m) return [];

    const listed = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);

    const real = shared.COMBAT_SLOTS || [];
    const problems = [];

    const missing = real.filter((s) => !listed.includes(s));
    const extra = listed.filter((s) => !real.includes(s));

    if (missing.length === 0 && extra.length === 0) return [];

    problems.push('public/game.js  FALLBACK_COMBAT_SLOTS разошёлся с COMBAT_SLOTS');
    if (missing.length) problems.push(`      нет в клиенте: ${missing.join(', ')}`);
    if (extra.length) problems.push(`      лишние в клиенте: ${extra.join(', ')}`);
    problems.push('      -> при недоступном shared/equipment.js предметы этих слотов');
    problems.push('         нельзя будет экипировать');

    return problems;
}

if (require.main === module) {
    main();
}