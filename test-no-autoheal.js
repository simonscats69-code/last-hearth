/**
 * Тесты удаления автоиспользования лекарств и отображения HP/энергии в бою.
 *
 * Что проверяем:
 *   1. applyAutoHeal удалён полностью — из общих правил, из game-helpers,
 *      из вызовов боя и PvP, из ответов API. Автоаптек больше нет.
 *   2. Ползунок и галочка автолечения убраны из UI, роут /auto-heal удалён.
 *   3. Единственное место правды для регена: HEALTH_REGEN_INTERVAL_MS живёт
 *      только в public/shared/equipment.js и читается клиентом и сервером.
 *   4. HP и энергия игрока отображаются в бою: #player-hp-display,
 *      #player-energy-display, #player-name-display больше не декоративные.
 *   5. Фоллбеки max_energy = 50 (как в схеме БД), а не 100.
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (n, c, e) => { if (c) { passed++; console.log('  OK   ' + n); } else { failed++; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); } };

const GAME = 'public/game.js';
const EQ = 'public/shared/equipment.js';
const HELPERS = 'utils/game-helpers.js';
const BOSSES = 'routes/game/bosses.js';
const PVP = 'routes/game/pvp.js';
const PLAYER = 'routes/game/player.js';
const SCHEMA = 'db/schema.js';
const CSS = 'public/styles.css';
const TYPES = 'packages/core/src/types.ts';

const gameSrc = fs.readFileSync(GAME, 'utf8');
const gameCode = gameSrc.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('=== 1. Автолечение удалено из кода ===');
ok('applyAutoHeal нет в game-helpers',
    !fs.readFileSync(HELPERS, 'utf8').includes('applyAutoHeal'));
ok('applyAutoHeal нет в bosses.js (кроме комментариев)',
    !BossesCodeHasCall(fs.readFileSync(BOSSES, 'utf8')));
ok('applyAutoHeal нет в pvp.js (кроме комментариев)',
    !PvpCodeHasCall(fs.readFileSync(PVP, 'utf8')));
ok('нет функции saveAutoHealSettings в game.js',
    !fs.readFileSync(GAME, 'utf8').includes('saveAutoHealSettings'));
ok('нет вызова apiRequest к /player/auto-heal',
    !gameCode.includes('/api/game/player/auto-heal'));

function BossesCodeHasCall(src) {
    const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    return /applyAutoHeal\s*\(/.test(code);
}
function PvpCodeHasCall(src) {
    const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    return /applyAutoHeal\s*\(/.test(code);
}

console.log('\n=== 2. UI и роут удалены ===');
ok('нет input#auto-heal-enabled в разметке', !gameSrc.includes('id="auto-heal-enabled"'));
ok('нет input#auto-heal-threshold в разметке', !gameSrc.includes('id="auto-heal-threshold"'));
ok('нет label.auto-heal-toggle', !gameSrc.includes('auto-heal-toggle'));
ok('нет CSS .auto-heal-toggle / .auto-heal-range',
    !fs.readFileSync(CSS, 'utf8').includes('auto-heal'));
ok('роут POST /auto-heal удалён',
    !/router\.post\('\/auto-heal'/.test(fs.readFileSync(PLAYER, 'utf8')));
ok('колонки auto_heal_* больше не создаются в схеме',
    !fs.readFileSync(SCHEMA, 'utf8').includes('ADD COLUMN IF NOT EXISTS auto_heal'));

console.log('\n=== 3. Общие правила: константы автохила убраны ===');
const eqSrc = fs.readFileSync(EQ, 'utf8');
ok('нет DEFAULT_AUTO_HEAL_THRESHOLD', !eqSrc.includes('DEFAULT_AUTO_HEAL_THRESHOLD'));
ok('нет AUTO_HEAL_THRESHOLD_MIN/MAX', !eqSrc.includes('AUTO_HEAL_THRESHOLD_MIN') && !eqSrc.includes('AUTO_HEAL_THRESHOLD_MAX'));
ok('нет функции getAutoHealThreshold', !/function getAutoHealThreshold/.test(eqSrc));
ok('нет функции selectHealItem', !/function selectHealItem/.test(eqSrc));
ok('в TS-пакете тоже нет автохила',
    !fs.readFileSync(TYPES, 'utf8').includes('auto_heal_enabled'));

console.log('\n=== 4. Единое место правды для регена ===');
const eq = require(path.join(__dirname, EQ));
ok('HEALTH_REGEN_INTERVAL_MS = 90 000 (1 HP / 90 с)', eq.HEALTH_REGEN_INTERVAL_MS === 90000, eq.HEALTH_REGEN_INTERVAL_MS);
ok('HEALTH_REGEN_CAP_RATIO = 0.6 (потолок 60 HP)', eq.HEALTH_REGEN_CAP_RATIO === 0.6, eq.HEALTH_REGEN_CAP_RATIO);
ok('getHealthRegenCap(100) = 60', eq.getHealthRegenCap(100) === 60, eq.getHealthRegenCap(100));
ok('getRegenerableHealth(0, 100) = 60', eq.getRegenerableHealth(0, 100) === 60, eq.getRegenerableHealth(0, 100));

const regenDefs = (gameSrc.match(/HEALTH_REGEN_INTERVAL_MS\s*=\s*90/g) || []).length;
ok('нет локального дубля константы в game.js', regenDefs === 0, 'найдено ' + regenDefs);
ok('нет хардкод-фоллбэка `: 90` в подсказке',
    !/: 90/.test(gameSrc.split(/\r?\n/).filter(l => /interval/.test(l)).join('\n')),
    'остался фоллбек');
ok('подсказка панели читает интервал из общего модуля',
    /shared\.HEALTH_REGEN_INTERVAL_MS/.test(gameSrc));

console.log('\n=== 5. HP/энергия игрока в бою ===');
/**
 * Достаёт тело функции по имени (до парной закрывающей скобки),
 * чтобы не зависеть от длины и жадности regexp.
 */
function fnBody(name) {
    const s = gameSrc.indexOf('function ' + name);
    if (s === -1) return '';
    let depth = 0, started = false;
    for (let k = s; k < gameSrc.length; k++) {
        if (gameSrc[k] === '{') { depth++; started = true; }
        if (gameSrc[k] === '}') { depth--; if (started && depth === 0) return gameSrc.slice(s, k + 1); }
    }
    return '';
}

ok('в разметке есть #player-hp-display', gameSrc.includes('id="player-hp-display"'));
ok('в разметке есть #player-energy-display', gameSrc.includes('id="player-energy-display"'));
ok('updatePlayerHealthUi пишет и в #player-hp-display',
    fnBody('updatePlayerHealthUi').includes("getElementById('player-hp-display')"));
ok('renderEnergyIndicators пишет и в #player-energy-display',
    fnBody('renderEnergyIndicators').includes("getElementById('player-energy-display')"));
ok('renderBossFightScreen заполняет имя игрока',
    fnBody('renderBossFightScreen').includes("getElementById('player-name-display')"));
ok('renderBossFightScreen заполняет HP игрока',
    fnBody('renderBossFightScreen').includes("getElementById('player-hp-display')"));
ok('renderBossFightScreen заполняет энергию игрока',
    fnBody('renderBossFightScreen').includes("getElementById('player-energy-display')"));

console.log('\n=== 6. Фоллбеки энергии (50, а не 100) ===');
ok('в loadProfile max_energy || 50',
    /max_energy: Number\(playerData\.max_energy \|\| 50\)/.test(gameSrc));
ok('в loadBosses player_max_energy ?? 50',
    /player_max_energy \?\? 50/.test(gameSrc));
ok('дефолт в HTML = 50/50, а не 100/100',
    /id="energy-text">⚡ 50\/50</.test(gameSrc));
ok('в бою дефолт энергии = 50/50',
    /id="boss-energy-text">50\/50</.test(gameSrc));
ok('серверный recalcEnergy тоже считает по 50',
    /max_energy \|\| 50/.test(fs.readFileSync('utils/game-helpers.js', 'utf8')));

console.log('\n=== 7. Ручное лечение работает ===');
ok('панель лечения и её кнопки на месте',
    gameSrc.includes('id="heal-panel"') && gameSrc.includes('id="heal-panel-items"'));
ok('healItem шлёт на inventory/use-item',
    /apiRequest\('\/api\/game\/inventory\/use-item'/.test(gameSrc));
ok('в панели лечения нет больше элементов управления автохилом',
    !/auto-heal/.test(gameSrc.slice(gameSrc.indexOf('id="heal-panel"'), gameSrc.indexOf('id="heal-panel"') + 400)));

console.log('\n========================================');
console.log('ИТОГ:', passed, 'passed,', failed, 'failed');
console.log('========================================');
process.exit(failed ? 1 : 0);
