/**
 * Клиентские тесты: безопасность мутаций, отмена запросов, энергия,
 * авторизация и блокировки от двойного клика в public/game.js.
 */

const vm = require('vm');
const {
    readGameSource,
    extractFunction,
    extractActionLocks,
    createSandbox,
    loadFunctions
} = require('./scripts/lib/gameJsSandbox');

// =============================================================================
// apiRequest: мутации не должны повторяться
// =============================================================================

describe('apiRequest: безопасность мутаций', () => {
    const failingFetch = (calls) => async () => {
        calls.count++;
        const err = new Error('Failed to fetch');
        err.name = 'TypeError';
        throw err;
    };

    test('POST не повторяется после таймаута (иначе двойное списание)', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], {
            fetch: async () => {
                calls.count++;
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            }
        });

        await expect(apiRequest('/api/game/purchase', {
            method: 'POST',
            body: { item_id: 'buff_free_energy' }
        })).rejects.toBeDefined();

        expect(calls.count).toBe(1);
    });

    test('POST с сетевой ошибкой тоже не повторяется', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], { fetch: failingFetch(calls) });

        await expect(apiRequest('/api/game/bosses/attack-boss', {
            method: 'POST',
            body: { boss_id: 1 }
        })).rejects.toBeDefined();

        expect(calls.count).toBe(1);
    });

    test('POST с idempotent: true повторяется (явное согласие вызывающего)', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], { fetch: failingFetch(calls) });

        await expect(apiRequest('/api/game/search', {
            method: 'POST',
            idempotent: true,
            body: {}
        })).rejects.toBeDefined();

        expect(calls.count).toBe(3); // первая попытка + 2 повтора
    });

    test('POST с Idempotency-Key повторяется', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], { fetch: failingFetch(calls) });

        await expect(apiRequest('/api/game/purchase', {
            method: 'POST',
            body: {},
            headers: { 'Idempotency-Key': 'abc-123' }
        })).rejects.toBeDefined();

        expect(calls.count).toBe(3);
    });

    test('GET по-прежнему повторяется', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], { fetch: failingFetch(calls) });

        await expect(apiRequest('/api/game/profile')).rejects.toBeDefined();
        expect(calls.count).toBe(3);
    });

    test('внешняя отмена (signal) разрывает запрос и не показывает тост', async () => {
        const notifications = [];
        const controller = new AbortController();
        const { apiRequest } = loadFunctions(['apiRequest'], {
            showNotification: (msg) => notifications.push(msg),
            fetch: (url, options) => new Promise((_, reject) => {
                options.signal.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            })
        });

        const promise = apiRequest('/api/game/profile', {
            method: 'GET',
            signal: controller.signal
        });
        controller.abort();

        await expect(promise).rejects.toMatchObject({
            name: 'AbortError',
            isManualAbort: true
        });
        expect(notifications).toHaveLength(0);
    });

    test('уже отменённый signal не отправляет запрос вообще', async () => {
        const calls = { count: 0 };
        const controller = new AbortController();
        controller.abort();
        const { apiRequest } = loadFunctions(['apiRequest'], {
            fetch: async () => { calls.count++; }
        });

        await expect(apiRequest('/api/game/profile', {
            method: 'GET',
            signal: controller.signal
        })).rejects.toBeDefined();

        expect(calls.count).toBe(0);
    });
// =============================================================================
// Энергия: клиент не должен показывать энергию, которой нет на сервере
// =============================================================================

describe('энергия: синхронизация с сервером', () => {
    function loadEnergy(initial) {
        const sandbox = createSandbox();
        const source = readGameSource();
        const code = [
            extractFunction(source, 'ensurePlayerStatus'),
            extractFunction(source, 'getEffectivePlayerStatus'),
            extractFunction(source, 'syncPlayerEnergyState')
        ].join('\n\n');
        vm.runInContext(`
            const ENERGY_REGEN_INTERVAL_MS = 60000;
            const gameState = { player: ${JSON.stringify(initial)} };
            ${code}
            this.__api = { getEffectivePlayerStatus, syncPlayerEnergyState, gameState };
        `, sandbox);
        return sandbox.__api;
    }

    test('после атаки босса клиент не показывает лишнюю энергию', () => {
        // Регрессия: сервер вернул 9, а last_energy_update — 2 минуты назад.
        // Без обновления метки клиент «дочислил» бы реген и показал 10,
        // хотя на сервере 9 — кнопка атаки оставалась активной.
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const api = loadEnergy({
            status: { energy: 10, max_energy: 10, last_energy_update: twoMinutesAgo },
            energy: 10,
            max_energy: 10
        });

        api.syncPlayerEnergyState(9, 10, new Date().toISOString());

        expect(api.getEffectivePlayerStatus().energy).toBe(9);
    });

    test('метка last_energy_update обновляется вместе с энергией', () => {
        const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const api = loadEnergy({
            status: { energy: 10, max_energy: 10, last_energy_update: old },
            energy: 10,
            max_energy: 10
        });

        const stamp = new Date().toISOString();
        api.syncPlayerEnergyState(7, 10, stamp);

        const status = api.getEffectivePlayerStatus();
        expect(status.last_energy_update).toBe(stamp);
        expect(status.energy).toBe(7);
    });

    test('если сервер не прислал метку, берётся текущее время, а не старая метка', () => {
        const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const api = loadEnergy({
            status: { energy: 10, max_energy: 10, last_energy_update: old },
            energy: 10,
            max_energy: 10
        });

        api.syncPlayerEnergyState(6, 10, null);

        const status = api.getEffectivePlayerStatus();
        expect(status.energy).toBe(6);
        expect(new Date(status.last_energy_update).getTime())
            .toBeGreaterThan(new Date(old).getTime());
    });
});

    test('без initData в production запрос не уходит (fail-fast)', async () => {
        const calls = { count: 0 };
        const { apiRequest } = loadFunctions(['apiRequest'], {
            DEV_FALLBACK_ENABLED: false,
            getInitData: () => null,
            fetch: async () => { calls.count++; }
        });

        await expect(apiRequest('/api/game/profile')).rejects.toMatchObject({
            code: 'NO_INIT_DATA'
        });
        expect(calls.count).toBe(0);
    });
});
// =============================================================================
// Авторизация: фиктивный Telegram ID недоступен в production
// =============================================================================

describe('авторизация: фиктивный Telegram ID только в DEV', () => {
    function loadTelegramHelpers({ devMode, initDataUnsafe }) {
        const sandbox = createSandbox({
            window: { __DEV_MODE__: devMode },
            localStorage: { getItem: () => null },
            location: { hash: '' }
        });
        sandbox.window.Telegram = initDataUnsafe
            ? { WebApp: { initDataUnsafe: { user: initDataUnsafe }, initData: 'real' } }
            : undefined;

        const source = readGameSource();
        const code = [
            extractFunction(source, 'getInitDataFromHash'),
            extractFunction(source, 'getTelegramId'),
            extractFunction(source, 'getInitData')
        ].join('\n\n');
        vm.runInContext(`
            const DEV_FALLBACK_ENABLED = window.__DEV_MODE__ === true;
            ${code}
            this.__api = { getTelegramId, getInitData };
        `, sandbox);
        return sandbox.__api;
    }

    test('без Telegram в production возвращает null, а не 123456789', () => {
        const { getTelegramId, getInitData } = loadTelegramHelpers({ devMode: false });
        expect(getTelegramId()).toBeNull();
        expect(getInitData()).toBeNull();
    });

    test('в DEV-режиме фоллбэк доступен', () => {
        const { getTelegramId, getInitData } = loadTelegramHelpers({ devMode: true });
        expect(getTelegramId()).toBe('123456789');
        expect(getInitData()).toContain('hash=dummy');
    });

    test('настоящие данные Telegram важнее DEV-фоллбэка', () => {
        const { getTelegramId } = loadTelegramHelpers({
            devMode: true,
            initDataUnsafe: { id: 555 }
        });
        expect(getTelegramId()).toBe('555');
    });
});

// =============================================================================
// Экранирование
// =============================================================================

describe('экранирование', () => {
    function evaluate(expression) {
        const sandbox = createSandbox();
        vm.runInContext(extractFunction(readGameSource(), 'escapeAttribute'), sandbox);
        return vm.runInContext(expression, sandbox);
    }

    test('escapeAttribute экранирует кавычки (XSS в data-атрибутах)', () => {
        const result = evaluate('escapeAttribute(\'x" onmouseover="alert(1)\')');
        expect(result).not.toContain('"');
        expect(result).toContain('&quot;');
    });

    test('escapeAttribute убирает < > & и одинарную кавычку', () => {
        expect(evaluate('escapeAttribute("<script>&\'</script>")'))
            .toBe('&lt;script&gt;&amp;&#39;&lt;/script&gt;');
    });

    test('escapeAttribute корректно обрабатывает null/undefined/0', () => {
        expect(evaluate('escapeAttribute(null)')).toBe('');
        expect(evaluate('escapeAttribute(undefined)')).toBe('');
        expect(evaluate('escapeAttribute(0)')).toBe('0');
    });
});
// =============================================================================
// Блокировки от повторных mutation-запросов
// =============================================================================

describe('lockAction: защита от двойного клика', () => {
    function loadLocks() {
        const sandbox = createSandbox({ showNotification: () => {} });
        const source = readGameSource();
        const code = [
            extractActionLocks(source),
            extractFunction(source, 'lockAction'),
            extractFunction(source, 'unlockAction')
        ].join('\n\n');
        vm.runInContext(`${code}\nthis.__api = { lockAction, unlockAction };`, sandbox);
        return sandbox.__api;
    }

    test('второй вызов блокируется до unlockAction', () => {
        const { lockAction, unlockAction } = loadLocks();

        expect(lockAction('purchase')).toBe(true);
        expect(lockAction('purchase')).toBe(false);
        expect(lockAction('purchase')).toBe(false);

        unlockAction('purchase');
        expect(lockAction('purchase')).toBe(true);
    });

    test('блокировки независимы: покупка не блокирует колесо', () => {
        const { lockAction, unlockAction } = loadLocks();

        expect(lockAction('purchase')).toBe(true);
        expect(lockAction('wheelSpin')).toBe(true);
        expect(lockAction('wheelSpin')).toBe(false);

        unlockAction('wheelSpin');
        expect(lockAction('purchase')).toBe(false);
    });

    test('все критичные операции имеют собственные блокировки', () => {
        const sandbox = createSandbox({ showNotification: () => {} });
        vm.runInContext(extractActionLocks(readGameSource()), sandbox);
        const locks = vm.runInContext('Object.keys(actionLocks)', sandbox);

        for (const required of [
            'purchase', 'buyCoinItem', 'wheelSpin', 'buyEnergy',
            'clanCreate', 'clanDonate', 'pvpStart', 'attackBoss',
            'useItem', 'sellItem', 'searchLoot'
        ]) {
            expect(locks).toContain(required);
        }
    });
});
// =============================================================================
// Регрессии, найденные ревью: они не должны вернуться
// =============================================================================

describe('регрессии из ревью', () => {
    const src = () => readGameSource();

    test('фиктивный initData остался только внутри DEV-ветки', () => {
        // Считаем только реальные литералы в коде, а не упоминания в комментариях:
        const literals = src().match(/return 'user=[^']*hash=dummy'/g) || [];
        expect(literals).toHaveLength(1);

        // Ветка DEV обязана быть последним возвратом getInitData,
        // то есть production-путь возвращает null
        const getInitData = extractFunction(src(), 'getInitData');
        expect(getInitData).toContain('if (DEV_FALLBACK_ENABLED)');
        expect(getInitData.trimEnd()).toMatch(/return null;\s*}$/);
    });

    test('хрупкий доступ window.EquipmentShared заменён на безопасный', () => {
        expect(src()).toContain('window.EquipmentShared?.MAX_INVENTORY_SLOTS ?? 100');
        // Реальный доступ без ?. остался только в комментарии, где описан
        // прежний баг; в коде его быть не должно
        const code = src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        expect(code).not.toMatch(/window\.EquipmentShared\.MAX_INVENTORY_SLOTS/);
    });

    test('без shared/equipment.js файл не падает на лимите инвентаря', () => {
        const sandbox = createSandbox({ window: {} });
        const declaration = /const INVENTORY_MAX_SLOTS = [^;]+;/.exec(src())[0];
        expect(() => vm.runInContext(declaration, sandbox)).not.toThrow();
        expect(vm.runInContext('INVENTORY_MAX_SLOTS', sandbox)).toBe(100);
    });

    test('API.endpoints строится из общего словаря endpoints (нет дубля списка)', () => {
        const apiObject = src().slice(src().indexOf('const API = {'));
        expect(apiObject.slice(0, 1200)).toContain('Object.fromEntries');
        expect(/endpoints:\s*\{\s*profile:\s*'\/api\/game\/profile'/.test(apiObject)).toBe(false);
    });

    test('PvP-сообщение и результат боя экранируются перед вставкой в innerHTML', () => {
        const s = src();
        expect(s).toContain("escapeHtml(payload.message || 'Удар нанесён')");
        expect(s).toContain("escapeHtml(result.message || '')");
        expect(s).not.toContain("${payload.message || 'Удар нанесён'}");
        expect(s).not.toContain('class="battle-result">${result.message}');
    });

    test('имя соперника в PvP-атрибуте экранируется через escapeAttribute', () => {
        const s = src();
        expect(s).toContain('data-target-name="${escapeAttribute(player.username');
        expect(s).not.toContain('data-target-name="${escapeHtml(player.username');
    });

    test('renderCoinShop использует bindClickOnce — обработчики не копятся', () => {
        const fn = extractFunction(src(), 'renderCoinShop');
        expect(fn).toContain('bindClickOnce');
        expect(fn).not.toMatch(/btn\.addEventListener/);
    });

    test('hideModal/openModalElement защищены от гонки (счётчик поколений)', () => {
        const s = src();
        expect(extractFunction(s, 'hideModal')).toContain('modalState.openGeneration');
        expect(extractFunction(s, 'openModalElement')).toContain('modalState.openGeneration');
    });

    test('waitForTelegramWebApp отклоняется по таймауту, а не резолвится', () => {
        const fn = extractFunction(src(), 'waitForTelegramWebApp');
        expect(fn).toContain('reject(');
        expect(fn).not.toContain('Всё равно продолжаем');
    });

    test('updateProfileUI больше не объявлена async без await', () => {
        expect(extractFunction(src(), 'updateProfileUI').startsWith('function updateProfileUI')).toBe(true);
    });

    test('после победы/атаки перезагружается профиль, а не только UI-кэш', () => {
        expect(extractFunction(src(), 'attackBoss')).toContain('loadProfile()');
        expect(extractFunction(src(), 'attackWithWeapon')).toContain('loadProfile()');
        expect(extractFunction(src(), 'attackRaid')).toContain('loadProfile()');
    });

    test('покупки и вращения защищены lockAction', () => {
        const s = src();
        expect(extractFunction(s, 'buyShopItem')).toContain("lockAction('purchase')");
        expect(extractFunction(s, 'buyCoinItem')).toContain("lockAction('buyCoinItem')");
        expect(extractFunction(s, 'spinWheelFree')).toContain("lockAction('wheelSpin')");
        expect(extractFunction(s, 'spinWheelPaid')).toContain("lockAction('wheelSpin')");
        expect(extractFunction(s, 'restoreEnergy')).toContain("lockAction('buyEnergy')");
        expect(extractFunction(s, 'createClan')).toContain("lockAction('clanCreate')");
        expect(extractFunction(s, 'donateToClan')).toContain("lockAction('clanDonate')");
        expect(extractFunction(s, 'startPVPFight')).toContain("lockAction('pvpStart')");
    });

    test('applyBuff берёт срок из ответа сервера, а не из локальных данных', () => {
        const fn = extractFunction(src(), 'applyBuff');
        expect(fn).toContain('buff.expires_at');
        expect(fn).toContain('if (!effect)');
        // Старого setTimeout-таймера, удаляющего бафф, больше нет
        expect(fn).not.toContain('setTimeout');
    });

    test('updateBossFightTimer снимает интервал после «Время вышло!»', () => {
        expect(extractFunction(src(), 'updateBossFightTimer')).toContain('stopTimer()');
    });

    test('onScreenOpen для карты обрабатывает ошибку загрузки', () => {
        const fn = extractFunction(src(), 'onScreenOpen');
        const mapCase = fn.slice(fn.indexOf("case 'map'"), fn.indexOf("case 'inventory'"));
        expect(mapCase).toContain('.catch(');
    });

    test('loadProfile сбрасывает кэш gameApi, иначе вернёт устаревшие данные', () => {
        expect(extractFunction(src(), 'loadProfile')).toContain("invalidateCache('profile')");
    });
});

// =============================================================================
// Регрессии второго аудита (сравнение версий)
// =============================================================================

describe('регрессии второго аудита', () => {
    const src = () => readGameSource();

    test('сообщение о недоступности PvP экранируется перед innerHTML', () => {
        expect(src()).toContain("escapeHtml(payload.message || 'PvP недоступно')");
        expect(src()).not.toContain("${payload.message || 'PvP недоступно'}");
    });

    test('в showModal НЕТ escapeHtml — он выводит через textContent', () => {
        // Регрессия: escapeHtml перед showModal показывал игроку
        // буквальные «&amp;» вместо символа
        expect(src()).not.toMatch(/showModal\([^)]*escapeHtml/);
        expect(src()).not.toMatch(/showNotification\([^)]*escapeHtml/);
    });

    test('showModal действительно использует textContent (не innerHTML)', () => {
        const fn = extractFunction(src(), 'showModal');
        expect(fn).toContain('modalMessage.textContent = message;');
        expect(fn).not.toContain('modalMessage.innerHTML');
    });

    test('escapeHtml применяется только там, где идёт вставка через innerHTML', () => {
        // Проверяем, что экранирование не потеряно после правок:
        // PvP-сообщение и результат боя по-прежнему экранируются
        expect(src()).toContain("escapeHtml(payload.message || 'Удар нанесён')");
        expect(src()).toContain("escapeHtml(result.message || '')");
    });

    test('числа с сервера приводятся Number() перед вставкой в innerHTML', () => {
        // Регрессия: `${result.damage_dealt}` и `${result.mastery}` шли
        // в innerHTML как есть — строка ответа стала бы разметкой
        const s = src();
        expect(s).toContain('${Number(result.damage_dealt) || 0}');
        expect(s).toContain('${Number(result.mastery) || 0}');
    });

    test('фоновая проверка статуса не глотает ошибки молча', () => {
        // Регрессия: был пустой `catch {}`, и падение раз в 10 минут
        // не попадало даже в консоль
        const fn = extractFunction(src(), 'checkPlayerStatus');
        expect(fn).not.toMatch(/catch \([^)]*\) \{\s*\}/);
        expect(fn).toContain('console.warn');
    });

    test('лимит инвентаря защищён от деления на ноль', () => {
        const fn = extractFunction(src(), 'renderInventoryCapacity');
        expect(fn).toMatch(/Math\.max\(1,/);
    });

    test('все изменяющие операции защищены lockAction', () => {
        const s = src();
        // Блокировки первой итерации
        expect(extractFunction(s, 'startPVPFight')).toContain("lockAction('pvpStart')");
        expect(extractFunction(s, 'buyShopItem')).toContain("lockAction('purchase')");
        expect(extractFunction(s, 'buyCoinItem')).toContain("lockAction('buyCoinItem')");
        expect(extractFunction(s, 'restoreEnergy')).toContain("lockAction('buyEnergy')");
        expect(extractFunction(s, 'createClan')).toContain("lockAction('clanCreate')");
        expect(extractFunction(s, 'donateToClan')).toContain("lockAction('clanDonate')");
        // Блокировки, добавленные по итогам второго аудита
        expect(extractFunction(s, 'joinClan')).toContain("lockAction('clanJoin')");
        expect(extractFunction(s, 'leaveClan')).toContain("lockAction('clanLeave')");
        expect(extractFunction(s, 'joinRaid')).toContain("lockAction('raidJoin')");
        expect(extractFunction(s, 'claimAchievement')).toContain("lockAction('claimAchievement')");
    });

    test('у каждой блокировки есть парный unlockAction в finally', () => {
        const s = src();
        for (const fn of ['joinClan', 'leaveClan', 'joinRaid', 'claimAchievement', 'donateToClan']) {
            expect(extractFunction(s, fn)).toMatch(/finally \{[\s\S]*unlockAction\(/);
        }
    });

    test('блокировка колеса держится до конца анимации', () => {
        const s = src();
        // В finally блокировки быть не должно: снятие перенесено
        // внутрь spinWheelAnimation
        for (const fn of ['spinWheelFree', 'spinWheelPaid']) {
            const code = extractFunction(s, fn);
            expect(code).not.toMatch(/finally \{[\s\S]*unlockAction\('wheelSpin'\)/);
            expect(code).toContain("unlockAction('wheelSpin')");
        }
        // Анимация снимает блокировку в конце всего цикла
        const animation = extractFunction(s, 'spinWheelAnimation');
        expect(animation).toContain("unlockAction('wheelSpin')");
        expect(animation).toContain('loadWheelInfo()');
    });

    test('API.endpoints сохраняет прежние публичные ключи (обратная совместимость)', () => {
        const apiObject = src().slice(
            src().indexOf('const API = {'),
            src().indexOf('_activeControllers')
        );

        // Основные ключи берутся из общего словаря endpoints
        expect(apiObject).toContain('Object.fromEntries');
        expect(apiObject).toContain('Object.entries(endpoints)');

        // Ключи из прежнего API.endpoints, которых нет в endpoints,
        // должны присутствовать явно — иначе API.load('market') упал бы
        for (const key of ['market', 'pvp', 'status', 'energy']) {
            expect(apiObject).toMatch(new RegExp(`^\\s+${key}: '/api/`, 'm'));
        }
    });

    test('любая успешная мутация сбрасывает API-кэш', () => {
        expect(src()).toContain('function invalidateAllCaches()');
        const apiRequest = extractFunction(src(), 'apiRequest');
        expect(apiRequest).toContain('if (isMutation)');
        expect(apiRequest).toContain('invalidateAllCaches();');
    });

    test('полоса PvP-здоровья не может превысить 100%', () => {
        const fn = extractFunction(src(), 'updatePVPHealth');
        expect(fn).toContain('Math.min(100');
        expect(fn).toContain('safeMax');
    });

    test('buyCoinItem блокирует только нажатую кнопку, а не все', () => {
        const fn = extractFunction(src(), 'buyCoinItem');
        expect(fn).toContain('triggerButton');
        expect(fn).toContain('button?.isConnected');
        expect(fn).not.toContain("querySelectorAll('[data-buy-coin-item]')");
        // Делегированный обработчик передаёт саму кнопку
        expect(src()).toContain('buyCoinItem(Number(buyBtn.dataset.buyCoinItem), buyBtn);');
    });

    test('spinWheelAnimation предупреждает о неизвестном призе', () => {
        const fn = extractFunction(src(), 'spinWheelAnimation');
        expect(fn).toContain('Приз с сервера не найден в списке призов');
        expect(fn).toContain('prize?.type');
    });

    test('список призов синхронизируется с сервером', () => {
        const s = src();

        // Клиент берёт призы из ответа GET /wheel (сервер их уже отдаёт)
        expect(extractFunction(s, 'loadWheelInfo')).toContain('payload.prizes');
        expect(s).toContain('let wheelPrizes = WHEEL_PRIZES;');

        // Анимация использует актуальный список, а не жёсткую копию
        const animation = extractFunction(s, 'spinWheelAnimation');
        expect(animation).toContain('wheelPrizes');
        expect(animation).toContain('prizes.findIndex');
    });

    test('дефолтные клиентские призы совпадают с серверными', () => {
        const fs = require('fs');
        const path = require('path');
        const server = fs.readFileSync(path.join(__dirname, 'routes/game/minigames.js'), 'utf8');
        const serverBlock = /const WHEEL_PRIZES = \[[\s\S]*?\n\];/.exec(server)[0];
        const clientBlock = /const WHEEL_PRIZES = \[[\s\S]*?\n\];/.exec(src())[0];

        // weight есть только на сервере (вероятности), сравниваем type/value
        const parse = (block) => [...block.matchAll(/type:\s*'(\w+)',\s*value:\s*(\d+)/g)]
            .map((m) => `${m[1]}:${m[2]}`);

        expect(parse(clientBlock)).toEqual(parse(serverBlock));
    });
});

// =============================================================================
// Сервер: коды ошибок и утечка внутренних сообщений
// =============================================================================

describe('сервер: коды ошибок и утечка деталей', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');

    test('бизнес-ошибки кланов возвращают 4xx, а не 500', () => {
        const clans = read('routes/game/clans.js');

        // Регрессия: `throw new Error(...)` без statusCode давал 500,
        // и игрок видел «Внутренняя ошибка» вместо причины
        expect(clans).not.toMatch(/throw new Error\(/);

        // И конфликт имени клана — это 409, а не сбой сервера
        expect(clans).toContain("code: 'CLAN_NAME_TAKEN', statusCode: 409");
        expect(clans).toContain("code: 'PLAYER_NOT_FOUND', statusCode: 404");
        expect(clans).toContain("code: 'ALREADY_IN_CLAN', statusCode: 400");
        expect(clans).toContain("code: 'CLAN_FULL', statusCode: 400");
        expect(clans).toContain("code: 'INSUFFICIENT_COINS', statusCode: 400");
    });

    test('handleError не отдаёт внутреннее сообщение при 5xx', () => {
        const { handleError } = require('./utils/serverApi');
        const logged = [];
        const sent = [];
        const originalLogger = require('./utils/serverApi').logger;

        // Подменяем logger и собираем ответ, вместо реального res
        const res = {
            status(code) {
                sent.status = code;
                return this;
            },
            json(body) {
                sent.body = body;
                return this;
            }
        };

        const serverApi = require('./utils/serverApi');
        const savedLog = serverApi.logger.error;
        serverApi.logger.error = (...args) => logged.push(args);

        try {
            // Внутренняя ошибка с «секретным» текстом
            handleError(res, { message: 'relation "players" does not exist', code: 'DB_ERROR' }, 'test');
            expect(sent.status).toBe(500);
            // Клиенту НЕ показываем детали БД
            expect(sent.body.error).not.toContain('players');
            expect(sent.body.error).toContain('Внутренняя ошибка');
            // Но в лог детали попали
            expect(logged.length).toBe(1);

            // Клиентская ошибка — текст отдаём как есть
            handleError(res, { message: 'Не хватает монет', code: 'INSUFFICIENT_COINS', statusCode: 400 }, 'test');
            expect(sent.status).toBe(400);
            expect(sent.body.error).toBe('Не хватает монет');
        } finally {
            serverApi.logger.error = savedLog;
        }
        expect(originalLogger).toBeDefined();
    });

    test('debuffs.js не утекает внутренние сообщения при 500', () => {
        const debuffs = read('routes/game/debuffs.js');
        // Для 500 должен отдаваться обобщённый текст
        expect(debuffs).toContain("'Внутренняя ошибка сервера. Попробуй позже.'");
    });

    test('items.js не вызывает res.status(undefined)', () => {
        const items = read('routes/game/items.js');
        // Регрессия: res.status(error.statusCode) дал бы невалидный код,
        // если statusCode не задан
        expect(items).not.toMatch(/res\.status\(error\.statusCode\)/);
        expect(items).toContain('Number(error.statusCode) || 404');
    });
});
// =============================================================================
// Серверная часть: энергия и авторизация
// =============================================================================

describe('сервер: синхронизация энергии и авторизация', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');

    test('боссы списывают энергию ВМЕСТЕ с обновлением last_energy_update', () => {
        const bosses = read('routes/game/bosses.js');
        const energyUpdates = bosses.match(/SET energy = GREATEST\(0, energy - \$1\)[^`]*`/g) || [];
        expect(energyUpdates.length).toBeGreaterThanOrEqual(3);
        for (const update of energyUpdates) {
            expect(update).toContain('last_energy_update = NOW()');
            expect(update).toContain('RETURNING energy');
            expect(update).toContain('last_energy_update');
        }
    });

    test('PvP тоже двигает last_energy_update при списании энергии', () => {
        const pvp = read('routes/game/pvp.js');
        const update = /UPDATE players\s+SET energy = GREATEST\(0, energy - \$1\)[\s\S]*?`/.exec(pvp);
        expect(update).not.toBeNull();
        expect(update[0]).toContain('last_energy_update = NOW()');
    });

    test('ответы сервера отдают last_energy_update клиенту', () => {
        expect(read('routes/game/bosses.js'))
            .toContain('last_energy_update: energyResult.rows[0].last_energy_update');
        expect(read('routes/game/pvp.js')).toContain('last_energy_update: energyLastUpdate');
    });

    test('/verify-telegram берёт id из проверенных initData', () => {
        const api = read('routes/api.js');
        const handler = api.slice(api.indexOf("router.post('/verify-telegram'"));
        expect(handler).toContain('const signedId = Number(validated.user.id);');
        expect(handler).toContain('telegramId = signedId;');
        expect(handler).toContain('telegram_id_mismatch');
    });

    test('index.js подставляет DEV-флаг только по явному DEV_MODE', () => {
        const indexJs = read('index.js');
        expect(indexJs).toContain("const DEV_MODE = process.env.DEV_MODE === 'true';");
        // Подстановка не должна зависеть от NODE_ENV: на BotHost он не задан,
        // и NODE_ENV !== 'production' включило бы фоллбэк в production
        expect(indexJs).toContain("DEV_MODE ? 'true' : 'false'");
    });

    test('index.html объявляет data-dev-mode и ставит скрипт с nonce до game.js', () => {
        const html = read('public/index.html');
        expect(html).toContain('data-dev-mode="{{devMode}}"');
        expect(html).toContain('window.__DEV_MODE__ = document.body.dataset.devMode');
        expect(html.indexOf('window.__DEV_MODE__')).toBeLessThan(html.indexOf('src="game.js'));
    });
});