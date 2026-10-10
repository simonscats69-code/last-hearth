/**
 * Финальная проверка двух спорных путей:
 *   1) /api/leaderboard/${type} — шаблонная строка, подставляется в рантайме;
 *   2) /api/game/purchase — требует {item_id, currency:'stars'}.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const BOT_TOKEN = /^TG_BOT_TOKEN=(.*)$/m.exec(fs.readFileSync('.env', 'utf8'))[1].trim();
const PORT = 4331;
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
    const id = makeInitData({ id: 1, first_name: 'p' });
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
const ok = (n, c, e) => { if (c) { passed++; console.log('  OK   ' + n); } else { failed++; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); } };

(async () => {
    const child = spawn('node', ['index.js'], {
        env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', LOG_LEVEL: 'warn' }, stdio: 'ignore'
    });
    if (!await waitReady()) { console.error('не готов'); child.kill(); process.exit(1); }
    console.log('Сервер готов\n');

    const initData = makeInitData({ id: 700000000 + Math.floor(Math.random() * 999999), first_name: 'Тест', username: 'probe2' });

    async function call(method, p, body) {
        const r = await fetch(BASE + p, {
            method, headers: { 'content-type': 'application/json', 'x-init-data': initData },
            body: body ? JSON.stringify(body) : undefined
        });
        let j = null; try { j = await r.json(); } catch (e) { }
        return { status: r.status, json: j, text: JSON.stringify(j).slice(0, 130) };
    }

    console.log('=== Шаблонный путь loadRating подставляет type в рантайме ===');
    for (const t of ['players', 'clans']) {
        const url = '/api/leaderboard/' + t;   // ровно как в loadRating
        const r = await call('GET', url);
        console.log('  GET ' + url + ' -> ' + r.status);
        ok('GET ' + url + ' -> 200', r.status === 200, r.text);
        ok('GET ' + url + ' отдаёт leaderboard', Array.isArray(r.json && r.json.leaderboard), r.text);
    }

    console.log('\n=== /api/game/purchase с правильной валютой ===');
    let r = await call('POST', '/api/game/purchase', { item_id: 999999, currency: 'stars' });
    ok('stars: маршрут найден (не маршрутный 404)',
        !(r.json && r.json.error === 'Not found'), r.text);
    console.log('    -> ' + r.status + ' ' + r.text);

    r = await call('POST', '/api/game/purchase', { item_id: 999999, currency: 'coins' });
    ok('coins: endpoint намеренно только для Stars (400 INVALID_CURRENCY)',
        r.json && r.json.code === 'INVALID_CURRENCY', r.text);
    console.log('    -> ' + r.status + ' ' + r.text);

    // Проверим, что shop-кнопки действительно шлют stars
    const src = fs.readFileSync('public/game.js', 'utf8');
    ok('клиент shop-кнопок шлёт currency: stars',
        /currency: 'stars'/.test(src) && /getStarShopItemsByCategory/.test(src), 'проверь renderShopList');

    console.log('\n========================================');
    console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
    console.log('========================================');
    child.kill();
    process.exit(failed ? 1 : 0);
})();
