'use strict';

// Генератор PNG-иконок игры Last Hearth.
//
// Запуск:  node scripts/icon-gen
//
// Что делает:
//  1. Рисует каждую иконку процедурно (см. icons/*.js) на 64×64 холсте
//     в постапок-палитре: тёмная пыльная плашка, ржавчина, кислотный акцент.
//  2. Кодирует в PNG собственным энкодером (png.js, без зависимостей)
//     и пишет в public/icons/<key>.png.
//  3. Пишет public/icons/manifest.js — карту «имя предмета/босса/эмодзи
//     → файл PNG». Клиент (game.js) грузит её как обычный <script> и
//     рендерит <img> вместо текстового эмодзи.
//
// Почему генерация, а не ручные файлы: единый стиль обеспечивается общими
// примитивами (draw.js/kit.js), а повторный запуск байт-в-байт воспроизводим
// (детерминированный PRNG) — git-диффы предсказуемы.

const fs = require('fs');
const path = require('path');

const { Canvas, drawFrame, applyGrain } = require('./draw');
const bossesHi = require('./icons/bosses-hi');
const weapons = require('./icons/weapons');
const armor = require('./icons/armor');
const consumables = require('./icons/consumables');
const resources = require('./icons/resources');
const misc = require('./icons/misc');

const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'icons');
const SIZE = 64;
const BOSS_SIZE = 256;

/** Все определения иконок в одном словаре (боссы — bosses-hi, 256×256). */
const ICONS = { ...bossesHi, ...weapons, ...armor, ...consumables, ...resources, ...misc };

/** Ключи иконок боссов — для них используется bosses-hi (256×256). */
const BOSS_KEYS = Object.keys(bossesHi);

/**
 * Рендер иконки в PNG. Боссы рисуются в BOSS_SIZE (256×256), остальные — в SIZE (64×64).
 */
function renderIcon(key, drawFn, size = SIZE) {
    const canvas = new Canvas(size, size);
    const random = drawFrame(canvas, hashSeed(key) % 100000);
    drawFn(canvas, random);
    applyGrain(canvas, random, 0.045);
    return canvas.toPNG();
}

/**
 * Маппинг игровых сущностей → ключи иконок.
 *
 * Имена — из db/schema.js (items/bosses/locations). Клиент ищет сначала
 * по имени (точное совпадение), потом по эмодзи (fallback для ачивок
 * и мест, где имя не передаётся).
 */
const BY_NAME = {
    // Боссы
    'Крысиный король': 'boss-rat',
    'Бездомный псих': 'boss-psych',
    'Медведь-мутант': 'boss-bear',
    'Военный дрон': 'boss-drone',
    'Главарь мародёров': 'boss-raider',
    'Биологический ужас': 'boss-bio',
    'Офицер-нежить': 'boss-officer',
    'Гигантский монстр': 'boss-monster',
    'Профессор безумия': 'boss-professor',
    'Последний страж': 'boss-warden',

    // Оружие
    'Нож': 'wpn-knife',
    'Бита': 'wpn-bat',
    'Пистолет': 'wpn-pistol',
    'Пистолет ТТ': 'wpn-pistol-tt',
    'Обрез': 'wpn-sawed',
    'Топор': 'wpn-axe',
    'Автомат': 'wpn-assault',
    'Винтовка Мосина': 'wpn-mosin',
    'Дробовик': 'wpn-shotgun',
    'Снайперская винтовка': 'wpn-sniper',
    'Пулемёт': 'wpn-machinegun',
    'Реактивная пушка': 'wpn-rpg',

    // Броня/одежда
    'Кожаная куртка': 'arm-jacket',
    'Бандитская куртка': 'arm-jacket',
    'Бронежилет': 'arm-vest',
    'Армейская каска': 'arm-helmet',
    'Военные перчатки': 'arm-gloves',
    'Медицинские перчатки': 'arm-gloves',
    'Сталкерские перчатки': 'arm-gloves',
    'Бандитские наручи': 'arm-gloves',
    'Военные ботинки': 'arm-boots',
    'Сталкерские сапоги': 'arm-boots',
    'Рваные джинсы': 'arm-pants',
    'Армейские штаны': 'arm-pants',
    'Сталкерские штаны': 'arm-pants',
    'Противогаз': 'arm-gasmask',
    'Медицинский халат': 'arm-labcoat',
    'Медицинский рюкзак': 'arm-medbag',
    'Сталкерский плащ': 'arm-coat',
    'Сталкерский пояс': 'arm-belt',
    'Бандитская бандана': 'arm-bandana',
    'Экзо-костюм': 'arm-exo',
    'Броня стражей': 'arm-guard',

    // Еда/медицина
    'Консервы': 'food-canned',
    'Вода': 'food-water',
    'Спирт': 'food-alcohol',
    'Снеки': 'food-snack',
    'Энергетик': 'food-energy',
    'Бинт': 'food-bandage',
    'Аптечка': 'food-medkit',
    'Витамины': 'food-medkit',
    'Антидот': 'med-syringe',
    'Реаниматор': 'med-reviver',
    'Антирадин': 'med-antirad',
    'Нано-аптечка': 'med-nano',
    'Радиа-кур': 'med-radiashield',
    'Стимулятор': 'med-stim',
    'Сыворотка мутанта': 'med-serum',
    'Нейроимплант': 'med-implant',

    // Ресурсы/аммо
    'Металлолом': 'res-scrap',
    'Древесина': 'res-wood',
    'Пластик': 'res-plastic',
    'Ткань': 'res-cloth',
    'Провода': 'res-wire',
    'Электроника': 'res-electronics',
    'Титан': 'res-titan',
    'Кристалл силы': 'res-crystal',
    'Химикаты': 'res-chemicals',
    'Уран': 'res-uranium',
    'Патроны': 'res-ammo',
    'Реактивные гранаты': 'res-rockets',
    // Все девять ключей боссов используют одну иконку
    'Ключ от Бездомного психа': 'res-key',
    'Ключ от Медведя-мутанта': 'res-key',
    'Ключ от Военного дрона': 'res-key',
    'Ключ от Главаря мародёров': 'res-key',
    'Ключ от Биологического ужаса': 'res-key',
    'Ключ от Офицера-нежить': 'res-key',
    'Ключ от Гигантского монстра': 'res-key',
    'Ключ от Профессора безумия': 'res-key',
    'Ключ от Последнего стража': 'res-key',
    'Ключ от Крысного короля': 'res-key',

    // Локации
    'Спальный район': 'loc-home',
    'Рынок': 'loc-market',
    'Больница': 'loc-hospital',
    'Промзона': 'loc-industry',
    'Центр города': 'loc-city',
    'Военная база': 'loc-base',
    'Бункер': 'loc-bunker',
};
/** Fallback по эмодзи — для ачивок и всего, где имя неизвестно. */
const BY_EMOJI = {
    '🐀': 'boss-rat',
    '🤡': 'boss-psych',
    '🛸': 'boss-drone',
    '🔪': 'wpn-knife',
    '🐻': 'boss-bear',
    '🤖': 'arm-exo',
    '💀': 'boss-raider',
    '👾': 'boss-bio',
    '💂': 'boss-officer',
    '🦖': 'boss-monster',
    '🧑‍🔬': 'boss-professor',
    '👑': 'boss-warden',
    '🛡️': 'med-radiashield',
    '🏏': 'wpn-bat',
    '🔫': 'wpn-pistol',
    '🪓': 'wpn-axe',
    '⚔️': 'wpn-assault',
    '🎯': 'wpn-sniper',
    '🔭': 'wpn-sniper',
    '🚀': 'res-rockets',
    '🔧': 'res-scrap',
    '🔩': 'res-ammo',
    '🗝️': 'res-key',
    '🧥': 'arm-jacket',
    '🦺': 'arm-vest',
    '⛑️': 'arm-helmet',
    '🧤': 'arm-gloves',
    '🥾': 'arm-boots',
    '👖': 'arm-pants',
    '😷': 'arm-gasmask',
    '🥼': 'arm-labcoat',
    '🎒': 'arm-medbag',
    '🧭': 'arm-belt',
    '🥷': 'arm-bandana',
    '🥫': 'food-canned',
    '💧': 'food-water',
    '🍺': 'food-alcohol',
    '🍪': 'food-snack',
    '⚡': 'food-energy',
    '🩹': 'food-bandage',
    '💊': 'food-medkit',
    '💉': 'med-syringe',
    '☢️': 'med-antirad',
    '🏥': 'med-nano',
    '💥': 'med-stim',
    '🧬': 'med-serum',
    '🧠': 'med-implant',
    '⚙️': 'res-scrap',
    '🪵': 'res-wood',
    '🔌': 'res-wire',
    '💾': 'res-electronics',
    '⛏️': 'res-titan',
    '💎': 'res-crystal',
    '🧪': 'res-chemicals',
    '⚛️': 'res-uranium',
    '🏠': 'loc-home',
    '🛒': 'loc-market',
    '🏭': 'loc-industry',
    '🌆': 'loc-city',
    '🎖️': 'loc-base',
    '🔒': 'loc-bunker',
    '🌟': 'ui-star',
    '🏅': 'ui-badge',
    '🏆': 'ui-badge',
    '🌱': 'res-wood',
    '🌿': 'res-wood',
    '🌳': 'res-wood',
    '📅': 'ui-badge',
    '📆': 'ui-badge',
    '📦': 'ui-box',
    '🤝': 'ui-badge',
    '🥊': 'ui-flame',
    '🥋': 'ui-flame',
    '🗺️': 'loc-city',
    '🔥': 'ui-flame',
    '💣': 'res-rockets',
    // Баффы и эффекты (buffMeta в game.js)
    '⬆️': 'ui-star',
    '✨': 'ui-badge',
    // Косметика/профиль (public/shared/equipment.js)
    '💠': 'ui-badge',
    '🖼️': 'ui-badge',
};

function hashSeed(key) {
    // FNV-1a: стабильный seed на ключ иконки
    let h = 0x811C9DC5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}


function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // Чистим старые PNG, кроме боссов: боссы — ИИ-арт, их не затирать.
    // (Процедурные bosses-hi остаются только как fallback, если файла нет.)
    for (const f of fs.readdirSync(OUT_DIR)) {
        if (f.endsWith('.png') && !f.startsWith('boss-')) fs.unlinkSync(path.join(OUT_DIR, f));
    }

    let bytes = 0;
    // Все иконки для проверки ссылок в манифесте (включая высокорезные боссы).
    const ALL_ICONS = { ...ICONS, ...bossesHi };
    for (const [key, drawFn] of Object.entries(ICONS)) {
        const isBoss = BOSS_KEYS.includes(key);
        if (isBoss && fs.existsSync(path.join(OUT_DIR, `${key}.png`))) continue; // ИИ-арт уже лежит — не затирать
        const size = isBoss ? BOSS_SIZE : SIZE;
        const fn = isBoss ? bossesHi[key] : drawFn;
        const png = renderIcon(key, fn, size);
        fs.writeFileSync(path.join(OUT_DIR, `${key}.png`), png);
        bytes += png.length;
    }

    // Манифест для клиента. Пути относительные (public/ — корень статики).
    const manifest = { version: 1, byName: {}, byEmoji: {} };
    for (const [name, key] of Object.entries(BY_NAME)) {
        if (!ALL_ICONS[key]) throw new Error(`BY_NAME ссылается на несуществующую иконку: ${key} (${name})`);
        manifest.byName[name] = `icons/${key}.png`;
    }
    for (const [emoji, key] of Object.entries(BY_EMOJI)) {
        if (!ALL_ICONS[key]) throw new Error(`BY_EMOJI ссылается на несуществующую иконку: ${key} (${emoji})`);
        manifest.byEmoji[emoji] = `icons/${key}.png`;
    }

    const manifestJs = `// СГЕНЕРИРОВАНО scripts/icon-gen — не редактировать вручную.
// Карта «имя/эмодзи → PNG». Клиент использует window.IconManifest.
window.IconManifest = ${JSON.stringify(manifest)};
`;
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.js'), manifestJs);

    const count = Object.keys(ICONS).length;
    console.log(`[icon-gen] ${count} иконок -> ${OUT_DIR} (${(bytes / 1024).toFixed(1)} KB PNG)`);
    console.log(`[icon-gen] манифест: ${Object.keys(manifest.byName).length} имён, ${Object.keys(manifest.byEmoji).length} эмодзи`);
}

try {
    main();
} catch (err) {
    console.error('[icon-gen] Ошибка генерации иконок:', err.message);
    process.exitCode = 1;
}


