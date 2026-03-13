# Спецификация: Механика войны с боссами

## Версия документа: 1.0
## Дата: 2026-03-12

---

## 1. Обзор концепции

Новая механика войны с боссами представляет собой систему, где игрок многократно кликает по боссу для его убийства, получая постоянный прогресс в виде мастерства (перманентный бонус к урону). Каждый босс имеет собственный прогресс мастерства игрока.

### Ключевые принципы

- Кликовая механика: игрок многократно атакует босса одним нажатием
- Мастерство: +1 к урону за каждое убийство конкретного босса
- Бесплатные атаки: 10 атак в сутки на каждого босса
- Система ключей: для разблокировки следующего босса требуется 3 ключа от текущего
- Ежедневный сброс лимитов в полночь по времени сервера (UTC)

---

## 2. Архитектура базы данных

### 2.1 Существующие таблицы (расширение)

#### Таблица `bosses` (расширение)

```sql
-- Добавить поля к существующей таблице bosses
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS damage_per_click INTEGER DEFAULT 1;
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS base_hp INTEGER DEFAULT 100;
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS hp_scale_factor DECIMAL(5,2) DEFAULT 1.0;
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT '👾';
```

### 2.2 Новые таблицы

#### Таблица `boss_mastery` (мастерство игрока против босса)

```sql
CREATE TABLE IF NOT EXISTS boss_mastery (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    boss_id INTEGER NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
    kills_count INTEGER DEFAULT 0,           -- Количество убийств этого босса
    total_damage INTEGER DEFAULT 0,         -- Общий нанесённый урон
    last_attack_time TIMESTAMP,             -- Время последней атаки
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(player_id, boss_id)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_boss_mastery_player ON boss_mastery(player_id);
CREATE INDEX IF NOT EXISTS idx_boss_mastery_boss ON boss_mastery(boss_id);
```

#### Таблица `boss_daily_attacks` (дневные атаки)

```sql
CREATE TABLE IF NOT EXISTS boss_daily_attacks (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    boss_id INTEGER NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
    attack_date DATE NOT NULL,               -- Дата атаки (UTC)
    attacks_used INTEGER DEFAULT 0,           -- Использовано атак
    attacks_remaining INTEGER DEFAULT 10,     -- Оставшиеся атаки
    last_attack_time TIMESTAMP,               -- Время последней атаки
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(player_id, boss_id, attack_date)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_boss_daily_player_date ON boss_daily_attacks(player_id, attack_date);
CREATE INDEX IF NOT EXISTS idx_boss_daily_boss_date ON boss_daily_attacks(boss_id, attack_date);
```

#### Таблица `boss_keys` (существующая - проверить структуру)

```sql
-- Существующая таблица уже есть, убедимся в структуре
CREATE TABLE IF NOT EXISTS boss_keys (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    boss_id INTEGER NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (player_id, boss_id)
);
```

---

## 3. API эндпоинты

### 3.1 Существующие эндпоинты (модификация)

#### `GET /api/game/bosses`

**Модификация:** добавить информацию о мастерстве и дневных атаках

**Ответ:**
```json
{
  "success": true,
  "data": {
    "bosses": [
      {
        "id": 1,
        "name": "Крыса",
        "description": "Опасный грызун",
        "hp": 100,
        "max_hp": 100,
        "damage_per_click": 1,
        "icon": "🐀",
        "reward_coins": 50,
        "reward_exp": 25,
        "reward_items": [],
        "keys_required": 0,
        "keys_owned": 0,
        "unlocked": true,
        "mastery": {
          "kills_count": 5,
          "damage_bonus": 5,
          "total_damage": 500
        },
        "daily_attacks": {
          "used": 3,
          "remaining": 7,
          "resets_at": "2026-03-13T00:00:00Z"
        }
      }
    ],
    "player_keys": { "1": 0, "2": 3 },
    "pagination": { "total": 10, "limit": 20, "offset": 0, "has_more": false }
  }
}
```

#### `POST /api/game/attack-boss`

**Модификация:** изменить логику с энергии на дневные атаки, добавить расчёт мастерства

**Тело запроса:**
```json
{
  "boss_id": 1,
  "clicks": 1
}
```

**Параметры:**
- `boss_id` (number, обязательно) - ID босса
- `clicks` (number, опционально, по умолчанию 1) - количество кликов

**Ответ при успехе:**
```json
{
  "success": true,
  "data": {
    "boss": {
      "id": 1,
      "name": "Крыса",
      "hp": 0,
      "max_hp": 100,
      "is_dead": true
    },
    "attack": {
      "clicks": 10,
      "base_damage": 10,
      "mastery_bonus": 5,
      "total_damage": 150,
      "damage_per_click": 15
    },
    "killed": true,
    "rewards": {
      "coins": 50,
      "exp": 25,
      "items": [],
      "key": {
        "boss_id": 2,
        "boss_name": "Таракан",
        "quantity": 1
      }
    },
    "mastery": {
      "kills_count": 6,
      "damage_bonus": 6
    },
    "daily_attacks": {
      "used": 3,
      "remaining": 7,
      "resets_at": "2026-03-13T00:00:00Z"
    },
    "player": {
      "coins": 150,
      "experience": 125,
      "level": 2
    }
  }
}
```

**Ответ при ошибке лимита:**
```json
{
  "success": false,
  "error": "Достигнут дневной лимит атак",
  "code": "DAILY_ATTACK_LIMIT",
  "resets_at": "2026-03-13T00:00:00Z",
  "bosses": [
    { "boss_id": 1, "remaining": 0 }
  ]
}
```

### 3.2 Новые эндпоинты

#### `GET /api/game/boss-mastery/:bossId`

Получить статистику мастерства для конкретного босса

```json
{
  "success": true,
  "data": {
    "boss_id": 1,
    "kills_count": 15,
    "damage_bonus": 15,
    "total_damage": 2500,
    "avg_damage_per_kill": 166,
    "best_kill_time": "2026-03-12T15:30:00Z",
    "last_attack_time": "2026-03-12T18:45:00Z"
  }
}
```

#### `GET /api/game/boss-daily-stats`

Получить статистику дневных атак для всех боссов

```json
{
  "success": true,
  "data": {
    "date": "2026-03-12",
    "resets_at": "2026-03-13T00:00:00Z",
    "bosses": [
      {
        "boss_id": 1,
        "boss_name": "Крыса",
        "attacks_used": 8,
        "attacks_remaining": 2,
        "can_attack": true
      },
      {
        "boss_id": 2,
        "boss_name": "Таракан",
        "attacks_used": 0,
        "attacks_remaining": 10,
        "can_attack": true,
        "unlock_required": { "boss_id": 1, "keys_needed": 3, "keys_owned": 0 }
      }
    ],
    "total_attacks_used": 8,
    "total_attacks_remaining": 12
  }
}
```

#### `POST /api/game/boss-unlock/:bossId`

Разблокировать босса (потратить ключи)

```json
{
  "success": true,
  "data": {
    "boss_id": 2,
    "boss_name": "Таракан",
    "keys_spent": 3,
    "keys_remaining": 0,
    "unlocked": true
  }
}
```

---

## 4. Формулы расчёта урона

### 4.1 Базовая формула урона

```
УРОН_ЗА_КЛИК = (Базовый_урон + Мастерство_босса) × Множитель_уровня
```

**Где:**
- `Базовый_урон` = сумма статов игрока (сила × 2 + ловкость × 0.5 + удача × 0.3)
- `Мастерство_босса` = количество убийств этого босса (каждое убийство +1 к урону)
- `Множитель_уровня` = 1 + (уровень_игрока × 0.1)

### 4.2 Формула с учётом оружия

```
УРОН_ЗА_КЛИК = (Базовый_урон + Мастерство_босса + Бонус_оружия) × Множитель_уровня
```

**Где:**
- `Бонус_оружия` = урон оружия + (заточка × 2) + (модификаторы)

### 4.3 Примеры расчёта

| Уровень | Статы (С+А+Л) | Оружие | Мастерство | Итоговый урон |
|---------|---------------|--------|------------|---------------|
| 1 | 5+5+5=15 | 0 | 0 | 15 × 1.1 = 16.5 → 16 |
| 5 | 10+8+7=25 | +5 | 0 | 30 × 1.5 = 45 |
| 10 | 15+12+10=37 | +10 | 5 | 52 × 2.0 = 104 |
| 20 | 25+20+15=60 | +25 | 15 | 100 × 3.0 = 300 |

### 4.4 Формула HP босса

```
HP_босса = Базовое_HP × (Множитель_HP ^ Номер_босса)
```

| Босс | HP (базовый множитель 1.5) |
|------|----------------------------|
| 1 | 100 |
| 2 | 150 |
| 3 | 225 |
| 5 | 506 |
| 10 | 3,842 |

---

## 5. Логика лимитов (10 атак в сутки)

### 5.1 Правила системы лимитов

1. **Лимит:** 10 атак в сутки на каждого босса
2. **Сброс:** в полночь UTC (03:00 по Москве)
3. **Отдельный счётчик:** для каждого босса свой счётчик
4. **Без потребления энергии:** атаки бесплатны (без траты энергии)
5. **Первый босс:** всегда доступен (0 ключей для входа)
6. **Последующие боссы:** требуют 3 ключа от предыдущего босса

### 5.2 Алгоритм проверки лимита

```
ФУНКЦИЯ ПроверитьЛимитАтак(player_id, boss_id, attack_date):
    1. Найти запись в boss_daily_attacks
       WHERE player_id = player_id 
       AND boss_id = boss_id 
       AND attack_date = attack_date
    
    2. ЕСЛИ запись найдена:
       ЕСЛИ attacks_remaining > 0:
           ВЕРНУТЬ (доступно: true, оставшиеся: attacks_remaining)
       ИНАЧЕ:
           ВЕРНУТЬ (доступно: false, оставшиеся: 0, ошибка: LIMIT_EXCEEDED)
    
    3. ЕСЛИ запись НЕ найдена:
       ВЕРНУТЬ (доступно: true, оставшиеся: 10)
```

### 5.3 Алгоритм списания атаки

```
ФУНКЦИЯ ИспользоватьАтаку(player_id, boss_id):
    1. Начать транзакцию
    
    2. Получить или создать запись daily_attacks с блокировкой FOR UPDATE
    
    3. ЕСЛИ attacks_remaining <= 0:
        ОТКАТАТЬ транзакцию
        ВЕРНУТЬ ошибку DAILY_ATTACK_LIMIT
    
    4. attacks_used = attacks_used + 1
    5. attacks_remaining = attacks_remaining - 1
    6. last_attack_time = NOW()
    7. updated_at = NOW()
    
    8. Закоммитить транзакцию
    9. ВЕРНУТЬ успех с новыми значениями
```

### 5.4 Сброс лимитов (cron задача)

```
ФУНКЦИЯ СброситьЛимиты():
    1. Выполняется каждый день в 00:00 UTC
    
    2. НОВЫЕ записи не создаются - сброс происходит 
       при первой атаке нового дня
    
    3. При запросе атаки:
       ЕСЛИ attack_date < сегодня:
           Создать НОВУЮ запись с лимитом 10
```

---

## 6. Система ключей

### 6.1 Правила системы ключей

1. **Уникальные ключи:** каждый босс имеет собственный ключ
2. **Получение ключа:** +1 ключ за убийство босса
3. **Требование:** 3 ключа от босса N-1 для разблокировки босса N
4. **Первый босс:** всегда разблокирован (0 ключей)
5. **Ключи не тратятся:** для входа в бой ключи не нужны (изменение логики!)

### 6.2 Изменение логики (критично!)

**Старая логика:**
- Потратить 3 ключа для входа в бой с боссом

**Новая логика:**
- Ключи нужны только для РАЗБЛОКИРОВКИ босса (один раз)
- После разблокировки босс доступен навсегда
- В бою тратится только дневной лимит атак

### 6.3 Алгоритм разблокировки

```
ФУНКЦИЯ РазблокироватьБосса(player_id, target_boss_id):
    1. Получить target_boss из БД
    
    2. ЕСЛИ target_boss.id == 1:
        ВЕРНУТЬ успех (первый босс всегда доступен)
    
    3. Получить ключи от предыдущего босса:
        keys_owned = SELECT quantity FROM boss_keys 
        WHERE player_id = player_id 
        AND boss_id = target_boss_id - 1
    
    4. ЕСЛИ keys_owned < 3:
        ВЕРНУТЬ ошибку INSUFFICIENT_KEYS
    
    5. В транзакции:
        a. Списать 3 ключа:
           UPDATE boss_keys SET quantity = quantity - 3
           WHERE player_id = player_id AND boss_id = target_boss_id - 1
        
        b. Пометить босса как разблокированный
           (можно использовать поле unlocked в кэше или отдельной таблице)
    
    6. ВЕРНУТЬ успех
```

### 6.4 Выдача ключа при убийстве

```
ФУНКЦИЯ ВыдатьКлючЗаУбийство(player_id, killed_boss_id):
    1. next_boss_id = killed_boss_id + 2  # +1 для след босса, +1 т.к. id с 1
    
    2. Проверить существует ли next_boss
    
    3. UPSERT ключа:
       INSERT INTO boss_keys (player_id, boss_id, quantity)
       VALUES (player_id, next_boss_id, 1)
       ON CONFLICT (player_id, boss_id)
       DO UPDATE SET quantity = boss_keys.quantity + 1,
                     updated_at = NOW()
    
    4. ВЕРНУТЬ информацию о выданном ключе
```

---

## 7. Клиент-серверное взаимодействие

### 7.1 Архитектура взаимодействия

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                              │
├─────────────────────────────────────────────────────────────┤
│  game-systems.js                                           │
│  ├── loadBosses()           - Загрузка списка боссов        │
│  ├── attackBoss()           - Атака босса (клик)           │
│  ├── unlockBoss()           - Разблокировка босса           │
│  └── getDailyStats()        - Получить дневную статистику  │
├─────────────────────────────────────────────────────────────┤
│  game-api.js                                                │
│  └── Вызовы к /api/game/boss*                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                         SERVER                               │
├─────────────────────────────────────────────────────────────┤
│  routes/game/bosses.js                                      │
│  ├── GET  /bosses            - Список боссов                │
│  ├── POST /attack-boss      - Атака босса                  │
│  ├── GET  /boss-mastery     - Мастерство                   │
│  ├── GET  /boss-daily-stats - Дневная статистика           │
│  └── POST /boss-unlock      - Разблокировка                │
├─────────────────────────────────────────────────────────────┤
│  db/playerQueries.js                                        │
│  └── Запросы к БД                                          │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Клиентские функции (game-systems.js)

#### Загрузка списка боссов

```javascript
/**
 * Загрузка списка боссов с мастерством и дневными лимитами
 */
async function loadBosses() {
    const data = await apiRequest('/api/game/bosses');
    gameState.bosses = data.bosses;
    renderBosses(data.bosses);
    return data;
}
```

#### Атака босса (основная механика)

```javascript
/**
 * Атака босса - основная кликовая механика
 * @param {number} bossId - ID босса
 * @param {number} clicks - количество кликов (1-10)
 */
async function attackBoss(bossId, clicks = 1) {
    // Проверка лимита на клиенте
    const boss = gameState.bosses.find(b => b.id === bossId);
    if (boss?.daily_attacks?.remaining < clicks) {
        showModal('⏰ Лимит исчерпан', 
            'До следующего сброса: ' + getTimeUntilReset());
        return;
    }
    
    const result = await apiRequest('/api/game/attack-boss', {
        method: 'POST',
        body: { boss_id: bossId, clicks: Math.min(clicks, 10) }
    });
    
    if (result.success) {
        updateBossUI(result.data);
        showDamageAnimation(result.data.attack.total_damage);
        
        if (result.data.killed) {
            showVictoryModal(result.data.rewards);
        }
    }
    
    return result;
}
```

### 7.3 Серверная логика (routes/game/bosses.js)

#### Основной обработчик атаки

```javascript
router.post('/attack-boss', rateLimitMiddleware, async (req, res) => {
    const { boss_id, clicks = 1 } = req.body;
    const playerId = req.player.id;
    
    // 1. Проверить валидность boss_id
    // 2. Проверить разблокировку босса
    // 3. Проверить дневной лимит
    // 4. Рассчитать урон с учётом мастерства
    // 5. Обновить HP босса
    // 6. Если убит - выдать награды и ключ
    // 7. Обновить мастерство
    // 8. Вернуть результат
});
```

### 7.4 WebSocket уведомления

```javascript
// При атаке босса - уведомление всех игроков
{
    type: 'BOSS_ATTACK',
    data: {
        bossId: 1,
        bossName: 'Крыса',
        damage: 150,
        hpPercent: 45,
        killer: { id: 123, name: 'Player1' }
    }
}

// При убийстве босса
{
    type: 'BOSS_DEFEATED',
    data: {
        bossId: 1,
        killer: { id: 123, name: 'Player1' },
        rewards: { coins: 50, exp: 25 },
        nextBoss: { id: 2, name: 'Таракан', unlocked: true }
    }
}
```

---

## 8. UI компоненты

### 8.1 Экран списка боссов (bosses-screen)

#### Структура HTML

```html
<div id="bosses-screen" class="screen">
    <div class="screen-header">
        <h2>👾 Боссы</h2>
        <div class="daily-stats">
            <span class="attacks-used">Атак сегодня: 8</span>
            <span class="attacks-remaining">Осталось: 12</span>
            <span class="resets-at">Сброс в 03:00 МСК</span>
        </div>
    </div>
    
    <div id="bosses-list" class="boss-list">
        <!-- Боссы рендерятся здесь -->
    </div>
</div>
```

#### Элемент босса (CSS)

```css
.boss-item {
    display: flex;
    align-items: center;
    padding: 12px;
    margin: 8px;
    background: #1a1a2e;
    border-radius: 8px;
    border: 2px solid #333;
    cursor: pointer;
    transition: all 0.2s ease;
}

.boss-item:hover {
    border-color: #e94560;
    transform: scale(1.02);
}

.boss-item.locked {
    opacity: 0.6;
    filter: grayscale(0.5);
}

.boss-item .boss-icon {
    font-size: 48px;
    margin-right: 16px;
}

.boss-item .boss-info {
    flex: 1;
}

.boss-item .boss-mastery {
    color: #ffd700;
    font-size: 14px;
}

.boss-item .boss-daily-attacks {
    display: flex;
    gap: 8px;
    margin-top: 4px;
}

.boss-item .attack-counter {
    padding: 4px 8px;
    background: #16213e;
    border-radius: 4px;
    font-size: 12px;
}

.boss-item .attack-counter.remaining {
    background: #0f3460;
    color: #4ecca3;
}
```

### 8.2 Экран боя с боссом (boss-fight-screen)

#### Структура

```html
<div id="boss-fight-screen" class="screen">
    <div class="boss-display">
        <div id="boss-icon" class="boss-avatar">🐀</div>
        <div id="boss-name" class="boss-title">Крыса</div>
        
        <div class="boss-hp-container">
            <div class="hp-bar">
                <div id="boss-health-bar" class="hp-fill" style="width: 100%"></div>
            </div>
            <div id="boss-health-text" class="hp-text">100 / 100 HP</div>
        </div>
        
        <div class="mastery-badge">
            <span class="mastery-icon">⚔️</span>
            <span id="mastery-level">Мастерство: 5</span>
            <span class="damage-bonus">+5 урона</span>
        </div>
    </div>
    
    <div class="attack-area">
        <div class="click-counter">
            <button class="click-btn minus" onclick="adjustClicks(-1)">-</button>
            <span id="click-count">1</span>
            <button class="click-btn plus" onclick="adjustClicks(1)">+</button>
        </div>
        
        <button id="attack-boss-btn" class="attack-button" onclick="performAttack()">
            ⚔️ АТАКОВАТЬ
        </button>
        
        <div class="damage-preview">
            Урон за клик: <span id="damage-preview-value">16</span>
            Всего урона: <span id="total-damage-preview">16</span>
        </div>
    </div>
    
    <div class="fight-log" id="fight-log">
        <!-- Лог атак -->
    </div>
    
    <div class="daily-info">
        Атак осталось: <span id="attacks-remaining">7</span> / 10
        <div class="reset-timer">Сброс через: <span id="reset-timer">5:32:15</span></div>
    </div>
</div>
```

#### Стили кнопки атаки

```css
.attack-button {
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: linear-gradient(145deg, #e94560, #c73e54);
    border: 4px solid #fff;
    color: white;
    font-size: 24px;
    font-weight: bold;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.1s;
    box-shadow: 0 8px 32px rgba(233, 69, 96, 0.4);
}

.attack-button:active {
    transform: scale(0.95);
    box-shadow: 0 4px 16px rgba(233, 69, 96, 0.6);
}

.attack-button:disabled {
    background: #333;
    cursor: not-allowed;
    opacity: 0.5;
}

.attack-button .ripple {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    transform: scale(0);
    animation: ripple 0.6s linear;
}

@keyframes ripple {
    to {
        transform: scale(4);
        opacity: 0;
    }
}
```

### 8.3 Модальные окна

#### Модальное окно победы

```javascript
function showVictoryModal(rewards) {
    const modal = createModal('🏆 ПОБЕДА!', `
        <div class="victory-content">
            <div class="boss-defeated">${gameState.currentBoss.name} повержён!</div>
            
            <div class="rewards-list">
                <div class="reward-item coins">
                    <span class="icon">💰</span>
                    <span class="value">+${rewards.coins}</span>
                    <span class="label">монет</span>
                </div>
                <div class="reward-item exp">
                    <span class="icon">✨</span>
                    <span class="value">+${rewards.exp}</span>
                    <span class="label">опыта</span>
                </div>
                ${rewards.key ? `
                <div class="reward-item key">
                    <span class="icon">🔑</span>
                    <span class="value">+1</span>
                    <span class="label">ключ ${rewards.key.boss_name}</span>
                </div>
                ` : ''}
            </div>
            
            <div class="mastery-up">
                <span>⚔️ Мастерство: ${rewards.mastery.kills_count}</span>
            </div>
            
            <button class="btn primary" onclick="closeModal(); showScreen('bosses')">
                Продолжить
            </button>
        </div>
    `);
}
```

#### Модальное окно лимита

```javascript
function showLimitModal(resetsAt) {
    const timeLeft = getTimeUntil(resetsAt);
    createModal('⏰ Лимит исчерпан', `
        <div class="limit-content">
            <p>Вы использовали все 10 атак на сегодня.</p>
            <p>До сброса осталось:</p>
            <div class="timer">${timeLeft}</div>
            <button class="btn" onclick="closeModal()">Ждать</button>
        </div>
    `);
}
```

### 8.4 UI для разблокировки босса

```javascript
function renderUnlockPrompt(boss, keysOwned, keysRequired) {
    return `
        <div class="unlock-prompt">
            <div class="boss-preview">
                <span class="icon">${boss.icon}</span>
                <span class="name">${boss.name}</span>
            </div>
            
            <div class="keys-info">
                <div class="current">
                    У вас ключей: <span class="count">${keysOwned}</span>
                </div>
                <div class="required">
                    Нужно ключей: <span class="count">${keysRequired}</span>
                </div>
            </div>
            
            ${keysOwned >= keysRequired ? `
                <button class="btn unlock-btn" onclick="unlockBoss(${boss.id})">
                    Разблокировать 🔓
                </button>
            ` : `
                <div class="need-keys">
                    Убейте ${boss.name} чтобы получить ключи
                </div>
            `}
        </div>
    `;
}
```

---

## 9. Анимации и визуальные эффекты

### 9.1 Анимация урона

```css
.damage-number {
    position: absolute;
    font-size: 32px;
    font-weight: bold;
    color: #ff4444;
    text-shadow: 2px 2px 0 #000;
    animation: damageFloat 1s ease-out forwards;
    pointer-events: none;
    z-index: 1000;
}

@keyframes damageFloat {
    0% {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
    50% {
        opacity: 1;
        transform: translateY(-50px) scale(1.2);
    }
    100% {
        opacity: 0;
        transform: translateY(-100px) scale(0.8);
    }
}
```

### 9.2 Анимация кнопки атаки

```css
.attack-button.combo {
    animation: comboShake 0.1s ease-in-out;
}

@keyframes comboShake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px) rotate(-2deg); }
    75% { transform: translateX(5px) rotate(2deg); }
}

.attack-button .hit-effect {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
    animation: hitFlash 0.3s ease-out;
}

@keyframes hitFlash {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(2); opacity: 0; }
}
```

### 9.3 Партиклы при убийстве

```javascript
function showVictoryParticles() {
    const colors = ['#ffd700', '#ff6b6b', '#4ecca3', '#a855f7'];
    
    for (let i = 0; i < 50; i++) {
        createParticle({
            x: random(window.innerWidth),
            y: random(window.innerHeight),
            color: random(colors),
            velocity: {
                x: random(-5, 5),
                y: random(-10, -5)
            },
            size: random(5, 15),
            life: 2000
        });
    }
}
```

---

## 10. Тестирование

### 10.1 Юнит-тесты

- Тест формулы расчёта урона
- Тест лимитов атак
- Тест системы ключей
- Тест мастерства

### 10.2 Интеграционные тесты

- Полный цикл атаки босса
- Разблокировка босса
- Выдача ключей
- Сброс лимитов

### 10.3 Нагрузочное тесты

- Множественные атаки одновременно
- Сброс лимитов в полночь

---

## 11. План реализации

### Фаза 1: База данных

1. Добавить поля к таблице bosses
2. Создать таблицу boss_mastery
3. Создать таблицу boss_daily_attacks
4. Протестировать миграции

### Фаза 2: Серверная логика

1. Обновить GET /bosses - добавить мастерство и лимиты
2. Модифицировать POST /attack-boss
3. Добавить новые эндпоинты
4. Реализовать формулы урона
5. Добавить логику лимитов

### Фаза 3: Клиент

1. Обновить UI боссов
2. Добавить механику кликов
3. Добавить визуализацию мастерства
4. Добавить таймер сброса
5. Добавить анимации

### Фаза 4: Тестирование и полировка

1. Интеграционное тестирование
2. Исправление багов
3. Оптимизация производительности

---

## 12. Обратная совместимость

- Сохранить существующие API ответы где возможно
- Новые поля должны быть опциональными
- Предупреждать о депреккации старых эндпоинтов
- Обеспечить плавный переход

---

## 13. Безопасность

- Валидация всех входных данных
- Защита от SQL-injection (использовать параметризованные запросы)
- Rate limiting на атаки боссов
- Логирование подозрительной активности

---

## 14. Производительность

- Индексы на часто запрашиваемые поля
- Кэширование данных боссов
- Оптимизация транзакций
- Пагинация для списка боссов
