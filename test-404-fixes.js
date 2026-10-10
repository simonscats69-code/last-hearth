/**
 * E2E-регрессия исправлений 404: каждый из 5 путей проверяется против
 * НАСТОЯЩЕГО сервера, и дополнительно проверяется контракт ответа
 * (форма данных, которую ждёт клиент).
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const BOT_TOKEN = /^TG_BOT_TOKEN=(.*)$/m.exec(fs.readFileSync('.env', 'utf8'))[1].trim();
const PORT = 4330;
const BASE = 'http://127.0.0.1:' + PORT;

function makeInitData(user) {
    const params = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAF_t' + Math.random().toString(36).slice(2, 10),
        user: JSON.stringify(user)
    };
    const dcs = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    return Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&') + '&hash=' + hash;
}

async function waitReady() {
    const id = makeInitData({ id: 1, first_name: 'probe' });
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(BASE + '/api/game/profile', { headers: { 'x-init-data': id } });
            if (r.status !== 503) return true;
        } catch (e) { }
        await new Promise(r => setTimeout(r, 1500));
    }
    return false;
}

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

(async () => {
    const child = spawn('node', ['index.js'], {
        env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', LOG_LEVEL: 'warn' },
        stdio: 'ignore'
    });
    if (!await waitReady()) { console.error('Сервер не готов'); child.kill(); process.exit(1); }
    console.log('Сервер готов (БД подключена)\n');

    const user = { id: 700000000 + Math.floor(Math.random() * 999999), first_name: 'ТестНовый', username: 'e2e_fix' };
    const initData = makeInitData(user);

    async function call(method, p, body) {
        const r = await fetch(BASE + p, {
            method,
            headers: { 'content-type': 'application/json', 'x-init-data': initData },
            body: body ? JSON.stringify(body) : undefined
        });
        let json = null;
        try { json = await r.json(); } catch (e) { }
        return { status: r.status, json, text: JSON.stringify(json).slice(0, 160) };
    }

    console.log('=== FIX-1: /api/leaderboard (mount терял /leaderboard) ===');
    let r = await call('GET', '/api/leaderboard/players');
    ok('GET /api/leaderboard/players -> не 404', r.status !== 404, r.status + ' ' + r.text);
    ok('ответ 200', r.status === 200, r.status);
    ok('есть массив leaderboard', Array.isArray(r.json && r.json.leaderboard), r.text);

    console.log('\n=== FIX-1b: /api/leaderboard/clans ===');
    r = await call('GET', '/api/leaderboard/clans');
    ok('GET /api/leaderboard/clans -> 200', r.status === 200, r.status);
    ok('есть массив leaderboard', Array.isArray(r.json && r.json.leaderboard), r.text);

    console.log('\n=== FIX-3: рейтинг отдаёт first_name и bosses_killed ===');
    r = await call('GET', '/api/leaderboard/players');
    const lb = r.json && r.json.leaderboard;
    ok('leaderboard — массив', Array.isArray(lb), typeof lb);
    if (Array.isArray(lb) && lb.length > 0) {
        const first = lb[0];
        console.log('    пример записи: ' + JSON.stringify(first));
        ok('есть first_name (не «Игрок»)', 'first_name' in first, Object.keys(first).join(','));
        ok('есть bosses_killed (не «undefined боссов»)', 'bosses_killed' in first && Number.isFinite(Number(first.bosses_killed)),
            first.bosses_killed);
    } else {
        ok('в рейтинге есть записи (для проверки полей)', false, 'пусто — нужен seed игроков');
    }

    console.log('\n=== FIX-2: startBossFight -> /api/game/bosses/start ===');
    r = await call('POST', '/api/game/bosses/start', { boss_id: 1 });
    ok('POST /api/game/bosses/start -> 200', r.status === 200, r.status + ' ' + r.text);
    ok('ответ содержит data.boss с hp/max_hp',
        r.json && r.json.data && r.json.data.boss && 'hp' in r.json.data.boss,
        r.text);
    ok('ответ содержит time_remaining_ms (клиент его читает)',
        r.json && r.json.data && typeof r.json.data.time_remaining_ms === 'number',
        r.text);
    const old = await call('POST', '/api/game/bosses/attack', { boss_id: 1 });
    ok('старый путь /bosses/attack действительно 404 (подтверждение корня)', old.status === 404, old.status);

    console.log('\n=== FIX-4: GET /player/achievements/progress ===');
    r = await call('GET', '/api/game/player/achievements/progress');
    ok('-> 200', r.status === 200, r.status + ' ' + r.text);
    const p4 = r.json && r.json.data;
    ok('data.progress — массив', p4 && Array.isArray(p4.progress), r.text);
    ok('data.categories — объект {key:{completed,total}}',
        p4 && typeof p4.categories === 'object' && Object.values(p4.categories).every(c => 'completed' in c && 'total' in c),
        p4 && JSON.stringify(p4.categories).slice(0, 120));
    if (p4 && Array.isArray(p4.progress) && p4.progress.length > 0) {
        const a = p4.progress[0];
        console.log('    пример достижения: ' + JSON.stringify(a).slice(0, 200));
        ['name', 'description', 'category', 'current', 'target', 'percent', 'completed', 'icon'].forEach(k => {
            ok('поле "' + k + '" есть', k in a, Object.keys(a).join(','));
        });
        ok('target — число (не undefined)', typeof a.target === 'number', a.target);
        ok('percent — число 0..100', typeof a.percent === 'number' && a.percent >= 0 && a.percent <= 100, a.percent);
    }

    console.log('\n=== FIX-5: POST /player/achievements/claim ===');
    // Бизнес-404 (ACHIEVEMENT_NOT_FOUND) — это правильно: маршрут найден,
    // достижение не существует. Отличаем от МАРШРУТНОГО 404 {"error":"Not found"}.
    r = await call('POST', '/api/game/player/achievements/claim', { achievement_id: 999999 });
    const isRoute404 = r.json && r.json.error === 'Not found' && !r.json.code;
    ok('маршрут найден (это не Not found роутинга)', !isRoute404, r.text);
    ok('бизнес-ошибка ACHIEVEMENT_NOT_FOUND', r.json && r.json.code === 'ACHIEVEMENT_NOT_FOUND', r.text);
    const r5 = await call('POST', '/api/achievements/claim', { achievement_id: 1 });
    ok('старый путь /api/achievements/claim давал маршрутный 404',
        r5.status === 404 && r5.json && r5.json.error === 'Not found', r5.text);

    console.log('\n=== Бонус: старые 404-пути больше не зовутся клиентом ===');
    // Сверяем только РАБОЧИЙ код, без комментариев: в них старые пути
    // упоминаются намеренно, как пояснение что было.
    const srcRaw = fs.readFileSync('public/game.js', 'utf8');
    const src = srcRaw.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // Точная проверка вызова, а не подстроки: /attack-with-weapon и
    // /attack-boss — валидные маршруты, они начинаются с той же строки.
    ok('в коде game.js нет вызова apiRequest(\'/api/game/bosses/attack\')',
        !/apiRequest\(\s*['"`]\/api\/game\/bosses\/attack['"`]/.test(src));
    ok('валиные /attack-with-weapon и /attack-boss на месте',
        /apiRequest\(\s*['"`]\/api\/game\/bosses\/attack-with-weapon['"`]/.test(src) &&
        /apiRequest\(\s*['"`]\/api\/game\/bosses\/attack-boss['"`]/.test(src));
    ok('в коде нет вызова `/rating/${type}`', !/apiRequest\(`\/rating\/\$\{type\}`\)/.test(src));
    ok('в коде нет /api/achievements/progress', !src.includes('/api/achievements/progress'));
    ok('в коде нет /api/achievements/claim', !src.includes('/api/achievements/claim'));

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    child.kill();
    process.exit(failed > 0 ? 1 : 0);
})();
