/**
 * Чек 1: структура CSS + классы/id.
 *
 * Ловит главный класс тихих поломок — правило, вложенное в другое правило.
 * Браузер такое отбрасывает, при этом баланс скобок остаётся нулевым, если
 * «лишняя» } компенсирует потерянную {. Так потерялись 476 строк стилей,
 * и ни один прежний инструмент этого не заметил.
 */
const { parseCss, listRules } = require('../css-parse');
const { collectMarkup, stripTemplates } = require('../markup');

function idUsed(id, js) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forms = [
        new RegExp(`getElementById\\(\\s*['"\`]${esc}['"\`]\\s*\\)`),
        new RegExp(`getEl\\(\\s*['"\`]${esc}['"\`]\\s*\\)`),
        new RegExp(`setElementText\\(\\s*['"\`]${esc}['"\`]`),
        new RegExp(`setElementHtml\\(\\s*['"\`]${esc}['"\`]`),
        new RegExp(`querySelector(?:All)?\\(\\s*['"\`]#${esc}\\b`),
        new RegExp(`['"\`]#${esc}\\b`)
    ];
    if (forms.some(p => p.test(js))) return true;
    // Экраны адресуются не по id, а по имени: showScreen() ищет
    // getElementById(`${screenName}-screen`). Без этой ветки 20 живых
    // экранов попадали в отчёт как мёртвые.
    if (/-screen$/.test(id)) {
        const name = id.slice(0, -'-screen'.length).replace(/-/g, '[-]');
        return new RegExp(`['"\`]${name}['"\`]`).test(js);
    }
    return false;
}

module.exports = function checkCss(css, js, html) {
    const out = [];
    const { problems, selectors } = parseCss(css);
    out.push({
        severity: 'critical',
        title: 'СТРУКТУРА CSS — вложенные правила не применяются',
        lines: problems.slice(0, 30)
    });

    const { classes, ids } = collectMarkup(js, html);

    out.push({
        severity: 'warning',
        title: 'КЛАССЫ БЕЗ ПРАВИЛ В CSS',
        lines: [...classes]
            .filter(([c]) => !selectors.has('.' + c))
            .map(([c, v]) => '.' + c + '  (' + v.count + '×)  ← ' + v.example)
    });

    out.push({
        severity: 'warning',
        title: 'ID БЕЗ СТИЛЕЙ И БЕЗ ОБРАЩЕНИЙ В JS',
        lines: [...ids]
            .filter(([i]) => !selectors.has('#' + i) && !idUsed(i, js))
            .map(([i, n]) => '#' + i + '  (' + n + '×)')
    });

    out.push({
        severity: 'warning',
        title: 'ДУБЛИРУЮЩИЕСЯ ID',
        lines: [...ids].filter(([, n]) => n > 1)
            .map(([i, n]) => '#' + i + '  ×' + n)
    });

    // Разбор случая «CSS написан классом .X, а в разметке элемент с id X».
    // Селектор .X не сработает для <div id="X"> — но severity зависит от
    // того, есть ли у элемента другой класс:
    //
    //   есть другой класс Y (и для Y есть правила) -> стили применяются
    //     через Y, .X просто остался от переименования. Не баг: сирота.
    //   класса нет вообще -> оформление действительно потеряно. БАГ.
    //
    // Раньше оба случая шли как critical, хотя в 6 из 8 стили были целы.
    const cssClassNames = new Set(
        [...selectors].filter(s => s.startsWith('.')).map(s => s.slice(1))
    );
    const asClass = new Set(classes.keys());
    const orphans = [], broken = [];

    // id -> классы элемента, которому он принадлежит
    const idToClasses = new Map();
    for (const m of (stripTemplates(js) + '\n' + stripTemplates(html))
        .matchAll(/class="([^"]*)"[^>]*\sid="([^"]*)"/g)) {
        const list = m[1].split(/\s+/).filter(Boolean);
        idToClasses.set(m[2], list);
    }
    for (const m of (stripTemplates(js) + '\n' + stripTemplates(html))
        .matchAll(/id="([^"]*)"[^>]*\sclass="([^"]*)"/g)) {
        const list = m[2].split(/\s+/).filter(Boolean);
        if (!idToClasses.has(m[1])) idToClasses.set(m[1], list);
    }

    for (const id of ids.keys()) {
        if (!cssClassNames.has(id)) continue;
        if (asClass.has(id)) continue;
        const own = idToClasses.get(id) || [];
        const styled = own.filter(c => cssClassNames.has(c));
        const label = '#' + id + '  — есть CSS-правило .' + id + ', ';
        if (styled.length) {
            orphans.push(label + 'но элемент оформлен классом .' + styled.join(' .') +
                ': правило-.ничего не делает, это остаток переименования');
        } else if (own.length) {
            orphans.push(label + 'но есть только классы .' + own.join(' .') +
                ' (правил для них нет) — возможно потеряно оформление, проверь вручную');
        } else {
            broken.push(label + 'а в разметке только id, класса нет: оформление ПОТЕРЯНО');
        }
    }

    out.push({
        severity: 'critical',
        title: 'ПОТЕРЯННОЕ ОФОРМЛЕНИЕ — элемент без класса, но правила есть',
        lines: broken
    });
    out.push({
        severity: 'warning',
        title: 'ПРАВИЛА-СИРОТЫ — не срабатывают никогда, но оформление цело',
        lines: orphans
    });

    // Дубли селекторов: на верхнем уровне это конфликт каскада,
    // внутри @media — штатная адаптивность.
    const rules = listRules(css);
    const byKey = new Map();
    for (const r of rules) {
        const key = r.sel + '@' + r.depth;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(r);
    }
    const hard = [], mediaCount = { n: 0 };
    for (const [, list] of byKey) {
        if (list.length < 2) continue;
        if (list[0].depth !== 0) { mediaCount.n++; continue; }
        const clashing = [];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                for (const [p, v] of Object.entries(list[i].props)) {
                    if (p in list[j].props && list[j].props[p] !== v) {
                        clashing.push(p + ': ' + v + ' -> ' + list[j].props[p]);
                    }
                }
            }
        }
        const label = (clashing.length ? 'КОНФЛИКТ ' : 'повтор  ') +
            list[0].sel + '   [' + list.map(r => r.at).join(', ') + ']';
        hard.push(clashing.length
            ? label + '\n        ~ ' + clashing.slice(0, 3).join('\n        ~ ')
            : label);
    }
    out.push({
        severity: 'warning',
        title: 'ДУБЛИ СЕЛЕКТОРОВ ВЕРХНЕГО УРОВНЯ (в @media: ' +
            mediaCount.n + ' — это адаптивность, не проблема)',
        lines: hard
    });

    return out;
};