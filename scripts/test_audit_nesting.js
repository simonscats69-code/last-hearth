/**
 * Обратный тест парсера CSS в audit_classes.js.
 *
 * Смысл: тот же баг (незакрытая скобка) раньше проходил молча — баланс
 * скобок был 0, потому что «лишняя» } компенсировала потерянную {. Инструмент
 * объявил 476 строк рабочими. Здесь мы берём РЕАЛЬНЫЙ styles.css, ломаем его
 * тем же способом и проверяем, что аудит теперь это замечает.
 *
 * Запуск: node scripts/test_audit_nesting.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cssPath = path.join(ROOT, 'public', 'styles.css');
const src = fs.readFileSync(cssPath, 'utf8');

// Воспроизводим настоящий баг: закрывающая скобка ПРОПУЩЕНА, поэтому все
// следующие правила оказываются внутри предыдущего и не применяются.
// Именно так выглядел файл до починки (476 строк не работали).
//
// Маркер берём динамически — первое правило с классом. Раньше здесь был
// жёстко вписан .pvp-attack-btn:disabled, и тест падал, когда чистка CSS
// удаляла этот класс: проверка инструмента зависела от его содержимого.
const markerMatch = src.match(/\.(-?[_a-zA-Z][\w-]*)[^{]*\{/);
if (!markerMatch) {
    console.error('В styles.css нет ни одного правила — тест неприменим.');
    process.exit(1);
}
const marker = src.indexOf(markerMatch[0]);
const close = src.indexOf('}', marker);
// Вырезаем закрывающую скобку блока и сразу добавляем за ней правило,
// которое «провалится» внутрь.
const broken = src.slice(0, close) +
    '\n.pvz-injected-test { color: red; }\n' +
    src.slice(close + 1);

const brokenPath = path.join(ROOT, 'public', '.styles-broken-test.css');
fs.writeFileSync(brokenPath, broken, 'utf8');

try {
    // Подменяем styles.css на сломанный, запускаем аудит, возвращаем обратно.
    fs.writeFileSync(cssPath, broken, 'utf8');

    // audit.js возвращает код 1, когда нашёл критичные проблемы — а на
    // сломанном CSS он их находит по определению. execFileSync на
    // ненулевом коде бросает исключение, поэтому вывод ловим из него.
    let out = '';
    try {
        out = require('child_process')
            .execFileSync('node', [path.join(__dirname, 'audit.js'), 'css'], { encoding: 'utf8' });
    } catch (e) {
        out = (e.stdout || '') + (e.stderr || '');
    }

    // Заголовок формируется в audit.js как «<title> (<число>)», поэтому число
// берём отсюда, а не ищем по старой формулировке.
const count = Number((out.match(/не применяются \((\d+)\)/) || [, '0'])[1]);
const nestingReported = /вложено в/.test(out);

    console.log('Структурных ошибок в отчёте: ' + count);
    console.log('Найдены вложенные правила:    ' + (nestingReported ? 'да' : 'нет'));

    if (nestingReported && count > 0) {
        console.log('ТЕСТ ПРОЙДЕН: аудит заметил пропущенную скобку.');
    } else {
        console.log('ТЕСТ ПРОВАЛЕН: парсер снова слеп к вложенности.');
        process.exitCode = 1;
    }
} finally {
    fs.writeFileSync(cssPath, src, 'utf8');   // всегда возвращаем как было
    if (fs.existsSync(brokenPath)) fs.unlinkSync(brokenPath);
    console.log('styles.css восстановлен из резервной копии.');
}