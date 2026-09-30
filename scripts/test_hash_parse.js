/** Тест getInitDataFromHash из public/game.js. Запуск: npm run test:hash */
const fs = require('fs');

// 1. Вырезаем реальную функцию из game.js
const src = fs.readFileSync('public/game.js', 'utf8');
const startMarker = 'function getInitDataFromHash() {';
const retMarker = "return decoded.includes('hash=') ? decoded : null;";
const start = src.indexOf(startMarker);
const retIdx = src.indexOf(retMarker, start);
if (start === -1 || retIdx === -1) {
    console.error('НЕ НАЙДЕНА функция getInitDataFromHash в game.js!');
    process.exit(1);
}
const endBrace = src.indexOf('}', retIdx);
const fnSource = src.slice(start, endBrace + 1);

// 2. Собираем тестовый контекст
const vm = require('vm');
const sandbox = { location: { hash: '' }, decodeURIComponent, console };
vm.createContext(sandbox);
vm.runInContext(fnSource, sandbox);
const getInitDataFromHash = sandbox.getInitDataFromHash;

let failed = 0;
function check(name, hash, expected) {
    sandbox.location.hash = hash;
    const got = getInitDataFromHash();
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        console.log('  ожидалось: ' + JSON.stringify(expected));
        console.log('  получено:  ' + JSON.stringify(got));
    }
}

// initData в реальном формате Telegram (user закодирован как в SDK)
const initData = 'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A5449121710%2C%22first_name%22%3A%22Cat%22%2C%22username%22%3A%22cats6y%22%7D&auth_date=1759000000&hash=8e73cb112233445566778899aabbccddeeff00112233445566778899aabbccdd';
const themeParams = '%7B%22bg_color%22%3A%22%23df3f40%22%7D';

// Тест 1: стандартная ссылка Telegram (tgWebAppData закодирован целиком, дальше ещё параметры)
check(
    'стандартный fragment (encodeURIComponent целиком)',
    '#tgWebAppData=' + encodeURIComponent(initData) + '&tgWebAppVersion=8.0&tgWebAppPlatform=web&tgWebAppThemeParams=' + themeParams,
    initData
);

// Тест 2: fragment без кодирования (внутри сырые & и %-последовательности)
check(
    'некодированный fragment',
    '#tgWebAppData=' + initData + '&tgWebAppVersion=8.0',
    initData
);

// Тест 3: tgWebAppData последний параметр, без хвостовых tgWebApp*
check(
    'tgWebAppData последний параметр',
    '#something=1&tgWebAppData=' + encodeURIComponent(initData),
    initData
);

// Тест 4: нет подписи — null
check('нет hash — null', '#tgWebAppData=foo%3Dbar', null);

// Тест 5: нет fragment — null
check('пустой fragment — null', '', null);

// Тест 6: fragment без tgWebAppData — null
check('нет tgWebAppData — null', '#other=1&tgWebAppVersion=8.0', null);

process.exit(failed > 0 ? 1 : 0);
