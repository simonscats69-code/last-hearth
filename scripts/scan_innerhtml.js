/**
 * Сканер потенциально небезопасных вставок в innerHTML.
 * Запуск: node scripts/scan_innerhtml.js
 * Только чтение — файлы не изменяются.
 */

const fs = require('fs');
const path = require('path');

const TARGETS = [
    path.join(__dirname, '..', 'public', 'game.js')
];

const SAFE_MARKERS = [
    'escapeHtml',
    'escapeAttribute',
    'textContent',
    // Числовые подстановки: Number()/Number.parseInt() безопасно приводят
    // значение, даже если сервер прислал строку
    'Number(',
    'parseInt(',
    'parseFloat(',
    'formatNumber('
];

/** Считает, покрыта ли строка экранированием в своём или соседних строках. */
function isEscaped(lines, index) {
    const window = [
        lines[index - 2],
        lines[index - 1],
        lines[index],
        lines[index + 1]
    ].filter(Boolean).join('\n');
    return SAFE_MARKERS.some((marker) => window.includes(marker));
}

for (const file of TARGETS) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const findings = [];

    lines.forEach((line, index) => {
        if (!line.includes('innerHTML')) return;

        const trimmed = line.trim();
        // Пропускаем статические строки без подстановок
        const hasInterpolation = trimmed.includes('${');
        if (!hasInterpolation) return;

        // Пропускаем строки, где рядом есть экранирование
        if (isEscaped(lines, index)) return;

        findings.push({
            line: index + 1,
            code: trimmed.slice(0, 160)
        });
    });

    console.log('='.repeat(70));
    console.log(`СКАНИРОВАНИЕ innerHTML: ${path.basename(file)}`);
    console.log('='.repeat(70));

    if (findings.length === 0) {
        console.log('Неэкранированных подстановок не найдено.');
    } else {
        console.log(`Найдено мест для ручной проверки: ${findings.length}`);
        for (const finding of findings) {
            console.log(`  ${finding.line}: ${finding.code}`);
        }
    }
    console.log('');
}