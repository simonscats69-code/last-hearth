/**
 * Тесты P2-исправлений: кланы, minigames, player, debuffs, items, bosses, activity.
 *
 * Каждый блок проверяет КОРНЕВУЮ проблему, а не косметику:
 *  - Boolean("false") === true -> настройка клана игнорировалась;
 *  - description: {a:1} -> "[object Object]" в БД;
 *  - limit = -5 -> LIMIT -5 -> 500;
 *  - лидерборд без first_name -> «Игрок» вместо имени;
 *  - DebuffAPI level = NaN -> expires_at: null (вечный дебафф);
 *  - this.calculateDebuffDamage ломался при деструктуризации;
 *  - item_index = 2.5 проходил валидацию;
 *  - req.player без guard -> 500 вместо 401.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
    if (cond) { passed++; console.log('  OK   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + String(extra) : '')); }
};

// ============================================================================
// 1. КЛАНЫ: parseBoolSetting + описание + цена
// ============================================================================
console.log('=== 1. Кланы: parseBoolSetting, описание, CLAN_CREATE_COST ===');
{
    const clansSrc = fs.readFileSync('routes/game/clans.js', 'utf8');
    ok('Boolean(isPublicBody) больше не используется',
        !/Boolean\(isPublicBody\)|Boolean\(isOpenBody\)/.test(clansSrc));
    ok('parseBoolSetting определён', /function parseBoolSetting\(value, def = true\)/.test(clansSrc));
    // ВАЖНО: сверяем только РАБОЧИЙ код, без комментариев — иначе
    // комментарий «Было String(description).slice(0, 200)» даёт ложный FAIL.
    const clansCode = clansSrc.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok('String(description).slice заменён на safeDescription',
        !/String\(description\)\.slice/.test(clansCode) && /safeDescription/.test(clansCode));

    // Функционально: извлекаем и вызываем parseBoolSetting
    const fnStart = clansSrc.indexOf('function parseBoolSetting');
    const fnEnd = clansSrc.indexOf('\n}', fnStart) + 2;
    const parseBoolSetting = new Function('return (' + clansSrc.slice(fnStart, fnEnd) + ')')();

    ok('"false" -> false (было true!)', parseBoolSetting('false') === false, parseBoolSetting('false'));
    ok('"0" -> false', parseBoolSetting('0') === false);
    ok('"no" -> false', parseBoolSetting('no') === false);
    ok('"off" -> false', parseBoolSetting('off') === false);
    ok('"true" -> true', parseBoolSetting('true') === true);
    ok('"1" -> true', parseBoolSetting('1') === true);
    ok('false -> false', parseBoolSetting(false) === false);
    ok('true -> true', parseBoolSetting(true) === true);
    ok('0 -> false', parseBoolSetting(0) === false);
    ok('1 -> true', parseBoolSetting(1) === true);
    ok('undefined -> default true', parseBoolSetting(undefined) === true);
    ok('undefined + default false -> false', parseBoolSetting(undefined, false) === false);
    ok('null -> default', parseBoolSetting(null) === true);
    ok('пустая строка -> default', parseBoolSetting('') === true);
    ok('мусор -> default', parseBoolSetting('maybe') === true);

    const equip = require(path.join(__dirname, 'public/shared/equipment.js'));
    ok('CLAN_CREATE_COST экспортирован = 1000', equip.CLAN_CREATE_COST === 1000, equip.CLAN_CREATE_COST);
    ok('CLAN_DESCRIPTION_MAX = 200', equip.CLAN_DESCRIPTION_MAX === 200);
    ok('CLAN_NAME_MAX = 30', equip.CLAN_NAME_MAX === 30);
    ok('clans.js использует CLAN_CREATE_COST (не хардкод)', clansSrc.includes('CLAN_CREATE_COST'));
    const hardcoded = (clansSrc.match(/coins < 1000|coins - 1000|cost: 1000/g) || []).length;
    ok('хардкода 1000 не осталось', hardcoded === 0, hardcoded + ' вхождений');

    // Лимитер чата
    const idxSrc = fs.readFileSync('routes/game/index.js', 'utf8');
    ok('лимитер чата клана добавлен', /chatLimiter/.test(idxSrc) && /router\.use\('\/clans\/clan\/chat', chatLimiter\)/.test(idxSrc));
    ok('лимитер чата: 10 сообщений / 30 с', /windowMs: 30 \* 1000/.test(idxSrc) && /max: 10/.test(idxSrc));
}

// ============================================================================
// 2. MINIGAMES: limit clamp + first_name + WHEEL_PRIZES
// ============================================================================
console.log('\n=== 2. Minigames: limit, first_name, WHEEL_PRIZES ===');
{
    const mg = fs.readFileSync('routes/game/minigames.js', 'utf8');
    const mgCode = mg.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    ok('старый Math.min(parseInt(...) || 10, 50) убран из кода',
        !/Math\.min\(parseInt\(req\.query\.limit, 10\) \|\| 10, 50\)/.test(mgCode));
    const clampCount = (mg.match(/Math\.min\(Math\.max\(Number\.isFinite\(rawLimit\) && rawLimit > 0 \? rawLimit : 10, 1\), 50\)/g) || []).length;
    ok('clamp применён в обоих лидербордах', clampCount === 2, clampCount);

    ok('first_name добавлен во все selectFields лидерборда',
        (mg.match(/first_name/g) || []).length >= 5,
        (mg.match(/first_name/g) || []).length);
    ok('first_name в ответе', /first_name: player\.first_name \|\| null/.test(mg));

    const equip = require(path.join(__dirname, 'public/shared/equipment.js'));
    ok('WHEEL_PRIZES в общем модуле', Array.isArray(equip.WHEEL_PRIZES) && equip.WHEEL_PRIZES.length === 6);
    ok('у призов есть weight (нужен серверу)', equip.WHEEL_PRIZES.every(p => typeof p.weight === 'number'));
    ok('WHEEL_FREE_SPIN_COOLDOWN_MS = 24ч', equip.WHEEL_FREE_SPIN_COOLDOWN_MS === 86400000);
    ok('minigames.js импортирует WHEEL_PRIZES из общего модуля',
        /const \{ WHEEL_PRIZES, WHEEL_FREE_SPIN_COOLDOWN_MS: FREE_SPIN_COOLDOWN_MS \} = require/.test(mg));
    ok('локальная копия WHEEL_PRIZES удалена из minigames.js',
        !/const WHEEL_PRIZES = \[/.test(mg));

    // Клиентский фоллбэк тоже из общего модуля
    const gameSrc = fs.readFileSync('public/game.js', 'utf8');
    ok('клиент берёт фоллбек из EquipmentShared',
        /window\.EquipmentShared && Array\.isArray\(window\.EquipmentShared\.WHEEL_PRIZES\)/.test(gameSrc));
    ok('локальный фоллбек сохранён как подстраховка',
        /\{ type: 'coins', value: 10, text: '10 монет' \}/.test(gameSrc));
}

// ============================================================================
// 3. PLAYER: avatar, валидация значений, реген-лог, daily-константы
// ============================================================================
console.log('\n=== 3. Player: avatar, валидация, реген-log, daily ===');
{
    const pl = fs.readFileSync('routes/game/player.js', 'utf8');

    ok('avatar убран из whitelist (колонки нет в схеме)',
        !/ALLOWED_UPDATE_FIELDS = \[[^\]]*'avatar'/.test(pl));
    ok('validateUpdateValues определён', /function validateUpdateValues\(/.test(pl));
    ok('validateUpdateValues вызывается в PUT /update', /validateUpdateValues\(updates\)/.test(pl));
    ok('UPDATE_FIELD_RULES есть с типами', /UPDATE_FIELD_RULES = \{/.test(pl) && /type: 'string'/.test(pl));
    // Проверяем рабочий код без комментариев: в них текст «.catch(() => 0)» остался
    // намеренно, как пояснение что было.
    const plCode = pl.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok('реген: в catch появился logger.warn (было пустое .catch(() => 0))',
        /\}\)\.catch\(\((?:err|error|e)\) => \{[\s\S]{0,1200}?logger\.warn/.test(plCode));
    ok('реген: пустой .catch(() => 0) больше не используется в коде',
        !/\}\)\.catch\(\(\) => 0\)/.test(plCode));
    ok('daily: DAILY_BONUS_BASE_COINS', /DAILY_BONUS_BASE_COINS = 25/.test(pl));
    ok('daily: DAILY_BONUS_COINS_PER_DAY', /DAILY_BONUS_COINS_PER_DAY = 25/.test(pl));
    ok('daily: DAILY_BONUS_STAR_EVERY', /DAILY_BONUS_STAR_EVERY = 3/.test(pl));
    ok('daily: формула через константы', /DAILY_BONUS_BASE_COINS \+ \(cappedDay - 1\) \* DAILY_BONUS_COINS_PER_DAY/.test(pl));
    ok('daily: звёзды через константу', /streak % DAILY_BONUS_STAR_EVERY === 0/.test(pl));
}

// ============================================================================
// 4. DEBUFFS: level NaN + this-binding
// ============================================================================
console.log('\n=== 4. Debuffs: level NaN, this-binding ===');
{
    const db = fs.readFileSync('routes/game/debuffs.js', 'utf8');
    const dbCode = db.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    ok('Number.isFinite-проверка уровня добавлена', /Number\.isFinite\(numericLevel\)/.test(db));
    ok('this.calculateDebuffDamage заменён на DebuffAPI.calculateDebuffDamage',
        !/this\.calculateDebuffDamage\(/.test(dbCode) && /DebuffAPI\.calculateDebuffDamage\(active\)/.test(dbCode));

    // Проверяем, что рантайм-деструктуризация не ломается
    const real = require(path.join(__dirname, 'routes/game/debuffs.js'));

    // Старый паттерн деструктуризации (именно он ломал this)
    const { DebuffAPI } = real;
    ok('DebuffAPI доступен после деструктуризации { DebuffAPI }', typeof DebuffAPI === 'object');
    ok('calculateDebuffDamage доступен', typeof DebuffAPI.calculateDebuffDamage === 'function');

    // Реальные значения из utils/gameConstants.js:
    //   radiation.damagePerLevel = 1, порог 5 -> (level-4) * 1
    //   infection.damagePerLevel = 2, шанс 10% (Math.random() < 0.1)
    const future = new Date(Date.now() + 3600000).toISOString();

    ok('радиация ур.6 = (6-4)*1 = 2',
        DebuffAPI.calculateDebuffDamage([{ type: 'radiation', level: 6, expiresAt: future }]) === 2,
        DebuffAPI.calculateDebuffDamage([{ type: 'radiation', level: 6, expiresAt: future }]));
    ok('радиация ур.5 = 1 (порог ровно на 5)',
        DebuffAPI.calculateDebuffDamage([{ type: 'radiation', level: 5, expiresAt: future }]) === 1);
    ok('радиация ур.4 = 0 (ниже порога урона нет)',
        DebuffAPI.calculateDebuffDamage([{ type: 'radiation', level: 4, expiresAt: future }]) === 0);

    // Инфекция зависит от Math.random(): подменяем его на детерминированный
    const realRandom = Math.random;
    try {
        Math.random = () => 0;      // всегда «выпало»
        ok('инфекция ур.2 при срабатывании = 2*2 = 4',
            DebuffAPI.calculateDebuffDamage([{ type: 'zombie_infection', level: 2, expiresAt: future }]) === 4,
            DebuffAPI.calculateDebuffDamage([{ type: 'zombie_infection', level: 2, expiresAt: future }]));
        ok('радиация + инфекция вместе = 2 + 4 = 6',
            DebuffAPI.calculateDebuffDamage([
                { type: 'radiation', level: 6, expiresAt: future },
                { type: 'zombie_infection', level: 2, expiresAt: future }
            ]) === 6);
        Math.random = () => 0.99;   // никогда не срабатывает
        ok('инфекция не сработавшая = 0 урона',
            DebuffAPI.calculateDebuffDamage([{ type: 'zombie_infection', level: 9, expiresAt: future }]) === 0);
    } finally {
        Math.random = realRandom;
    }

    const past = new Date(Date.now() - 1000).toISOString();
    ok('истёкший дебафф даёт 0 урона', DebuffAPI.calculateDebuffDamage([{ type: 'radiation', level: 9, expiresAt: past }]) === 0);
    ok('некорректный уровень бросает ошибку с текстом', /Некорректный уровень дебаффа/.test(db));
}

// ============================================================================
// 5. ITEMS: item_index, unique_items в /buy
// ============================================================================
console.log('\n=== 5. Items: item_index, trackCollectedItems в /buy ===');
{
    const it = fs.readFileSync('routes/game/items.js', 'utf8');

    ok('/use использует Number.isInteger (2.5 отсекается)',
        /const itemIndex = Number\(req\.body\?\.item_index\);[\s\S]{0,220}?if \(!Number\.isInteger\(itemIndex\) \|\| itemIndex < 0\)/.test(it));
    const isNaNChecks = (it.match(/if \(isNaN\(itemIndex\) \|\| itemIndex < 0\)/g) || []).length;
    ok('старой проверки isNaN не осталось', isNaNChecks === 0, isNaNChecks);

    ok('trackCollectedItems вызывается в /buy', /trackCollectedItems\(client, playerId, \[shopItem\.id\]\)/.test(it));
    ok('trackCollectedItems был и в /buy-stars', /trackCollectedItems\(client, playerId, \[shopItemRow\.id\]\)/.test(it));

    // Валидация подсчётов количества
    const validate = require(path.join(__dirname, 'utils/validate.js'));
    ok('validateQuantity отсекает 2.5', validate.validateQuantity(2.5).ok === false);
    ok('validateQuantity пропускает 1..99', validate.validateQuantity(1).ok && validate.validateQuantity(99).ok);
    ok('validateQuantity отсекает 0 и 100', !validate.validateQuantity(0).ok && !validate.validateQuantity(100).ok);
}

// ============================================================================
// 6. BOSSES: req.player guard
// ============================================================================
console.log('\n=== 6. Bosses: req.player guard ===');
{
    const bo = fs.readFileSync('routes/game/bosses.js', 'utf8');

    const guards = (bo.match(/return res\.status\(401\)\.json\(\{ success: false, error: 'Требуется авторизация', code: 'UNAUTHORIZED' \}\);/g) || []).length;
    ok('401-гард добавлен в боевые роуты (>= 2)', guards >= 2, guards);
    ok('req.player.id заменён на req.player?.id в /attack-boss',
        /router\.post\('\/attack-boss'[\s\S]{0,400}?req\.player\?\.id/.test(bo));
    ok('req.player.id заменён на req.player?.id в /attack-with-weapon',
        /router\.post\('\/attack-with-weapon'[\s\S]{0,700}?req\.player\?\.id/.test(bo));
}

// ============================================================================
// 7. ACTIVITY BUS: TTL/ретеншен
// ============================================================================
console.log('\n=== 7. Activity bus: ретеншен ===');
{
    const idx = fs.readFileSync('routes/game/index.js', 'utf8');

    ok('pruneActivityBus определён', /function pruneActivityBus\(/.test(idx));
    ok('ACTIVITY_BUS_RETENTION_MS = 1 час', /ACTIVITY_BUS_RETENTION_MS = 60 \* 60 \* 1000/.test(idx));
    ok('pruneActivityBus вызывается из touchPlayerActivity', /pruneActivityBus\(ACTIVITY_BUS_RETENTION_MS\)/.test(idx));

    // Функционально: ретеншен действительно чистит старые записи
    const start = idx.indexOf('function pruneActivityBus(');
    const end = idx.indexOf('\n}', start) + 2;
    const pruneSrc = idx.slice(start, end);

    // Собираем мини-окружение и проверяем поведение
    const bus = new Map();
    bus.set(1, Date.now() - 2 * 60 * 60 * 1000);   // 2 часа назад — должен удалиться
    bus.set(2, Date.now() - 30 * 60 * 1000);       // 30 мин назад — остаться
    bus.set(3, Date.now());                          // сейчас — остаться

    const prune = new Function('lastActivityTouch', 'retentionMs', pruneSrc + '\nreturn pruneActivityBus(retentionMs);');
    const removed = prune(bus, 60 * 60 * 1000);

    ok('удалена только запись старше часа', removed === 1 && bus.has(2) && bus.has(3) && !bus.has(1),
        'removed=' + removed + ' осталось=' + [...bus.keys()].join(','));
    ok('повторный prune идемпотентен', prune(bus, 60 * 60 * 1000) === 0 && bus.size === 2, bus.size);
}

// ============================================================================
// 8. Синтаксис всего изменённого
// ============================================================================
console.log('\n=== 8. Синтаксис всех изменённых файлов ===');
const files = [
    'public/game.js', 'public/shared/equipment.js',
    'routes/game/pvp.js', 'routes/game/status.js', 'routes/game/world.js',
    'routes/game/bosses.js', 'routes/game/items.js', 'routes/game/minigames.js',
    'routes/game/clans.js', 'routes/game/player.js', 'routes/game/debuffs.js',
    'routes/game/index.js', 'index.js', 'webhook.js',
    'utils/game-helpers.js', 'utils/validate.js', 'utils/serverApi.js', 'utils/scheduler.js'
];
let syntaxOk = true;
for (const f of files) {
    try {
        require('child_process').execSync('node --check ' + JSON.stringify(f), { stdio: 'pipe' });
    } catch (e) {
        syntaxOk = false;
        console.log('    СИНТАКСИС СЛОМАН: ' + f);
    }
}
ok('все ' + files.length + ' файлов проходят node --check', syntaxOk);

console.log('\n========================================');
console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
