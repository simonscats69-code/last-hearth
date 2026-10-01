/**
 * Общий разбор CSS для всех аудит-инструментов.
 *
 * Раньше логика «убрать комментарии, найти селекторы, понять вложенность»
 * была продублирована в audit_classes.js, find_dup_selectors.js и
 * find_dead_css.js — и копии разошлись: аудит классов принимал файлы за
 * нормальные, а дубли селекторов нет.
 */

/**
 * Убирает комментарии, сохраняя переводы строк.
 * Иначе номера строк в отчёте съезжают на высоту каждого комментария.
 */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g,
        m => ' ' + '\n'.repeat((m.match(/\n/g) || []).length));
}

/**
 * Убирает комментарии И url(...).
 * Без этого из «telegram.org» в комментариях рождается «класс» .org,
 * а из data:image/svg+xml — .svg, .w3 и десятки мусорных имён.
 */
function stripCommentsAndUrls(src) {
    return stripComments(src).replace(/url\([^)]*\)/g, ' ');
}

/**
 * Разбирает CSS в список селекторов, попутно проверяя структуру.
 *
 * Главная проверка — вложенность. Правило внутри другого правила в CSS
 * невозможно: браузер его отбрасывает. Именно так проявился баг с
 * незакрытой скобкой: 476 строк молча не применялись, а баланс скобок
 * оставался нулевым («лишняя» } компенсировала потерянную {).
 *
 * @param {string} src содержимое CSS
 * @returns {{selectors: Set<string>, problems: string[]}}
 */
function parseCss(src) {
    const text = stripComments(src);
    const selectors = new Set();
    const problems = [];
    const stack = [];   // стек открытых блоков

    let i = 0, atLine = 1;
    let buf = '';      // накопитель селектора

    while (i < text.length) {
        const ch = text[i];

        if (ch === '\n') { atLine++; buf += ch; i++; continue; }
        if (ch === ' ' || ch === '\t' || ch === '\r') { buf += ch; i++; continue; }

        if (ch === '{') {
            const header = buf.trim();
            buf = '';
            const isAtRule = header.startsWith('@');

            if (!isAtRule) {
                const owner = stack.find(s => !s.isAtRule);
                if (owner) {
                    problems.push('строка ' + atLine + ': правило «' +
                        header.slice(0, 45) + '» вложено в «' +
                        owner.header.slice(0, 45) + '» (строка ' + owner.line +
                        ') — не применится');
                }
                for (const g of header.split(',')) {
                    const sel = g.trim();
                    if (!sel) continue;
                    for (const m of sel.matchAll(/([.#])(-?[_a-zA-Z][\w-]*)/g)) {
                        selectors.add(m[1] + m[2]);
                    }
                }
            }
            stack.push({ header, line: atLine, isAtRule });
            i++;
            continue;
        }

        if (ch === '}') {
            buf = '';
            if (stack.length === 0) problems.push('строка ' + atLine + ': лишняя «}»');
            else stack.pop();
            i++;
            continue;
        }

        buf += ch;
        i++;
    }

    for (const s of stack) {
        problems.push('строка ' + s.line + ': «' + s.header.slice(0, 45) + '» не закрыта');
    }

    return { selectors, problems };
}

/**
 * Возвращает список правил с указанием, на какой глубине вложенности
 * они объявлены. Глубина 0 — верхний уровень, больше — внутри @media.
 *
 * Нужен, чтобы отличать настоящее дублирование селекторов (два правила
 * на верхнем уровне перекрывают друг друга) от штатной адаптивности
 * (тот же селектор переопределяется внутри @media).
 *
 * @param {string} src содержимое CSS
 * @returns {{sel: string, at: number, depth: number, props: Object}[]}
 */
function listRules(src) {
    const text = stripComments(src);
    const rules = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;

    const depthAt = pos => {
        let d = 0;
        for (let i = 0; i < pos; i++) {
            if (text[i] === '{') d++;
            else if (text[i] === '}') d--;
        }
        return d;
    };

    while ((m = ruleRe.exec(text)) !== null) {
        const selector = m[1].trim().replace(/\s+/g, ' ');
        if (selector.startsWith('@')) continue;          // @media/@keyframes
        const at = text.slice(0, m.index).split('\n').length;
        const depth = depthAt(m.index);

        const props = {};
        for (const decl of m[2].split(';')) {
            const idx = decl.indexOf(':');
            if (idx < 0) continue;
            const p = decl.slice(0, idx).trim();
            const v = decl.slice(idx + 1).trim();
            if (p) props[p] = v;
        }
        for (const group of selector.split(',')) {
            const g = group.trim();
            if (!g) continue;
            // Кадры keyframes (from/to/50%) — не селекторы, а шаги анимации.
            if (/^(from|to|\d+%(\s*,\s*\d+%)*)$/i.test(g)) continue;
            rules.push({ sel: g, at, depth, props });
        }
    }
    return rules;
}

module.exports = { stripComments, stripCommentsAndUrls, parseCss, listRules };