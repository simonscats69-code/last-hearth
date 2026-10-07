with open(r'E:\zztelegramLast-hearth\last-hearth\public\styles.css', 'r', encoding='utf-8') as f:
    content = f.read()

old_start = content.find('/* ---------- Экран боя с боссом')
next_section = content.find('/* ----------', old_start + 1)

old_css = content[old_start:next_section]

new_css = '''/* ---------- Экран боя с боссом (markup: boss-fight-container) ---------- */
.boss-fight-container {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

/* --- Новое поле боя --- */
.battle-field {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex: 1;
}

/* --- Комбатанты --- */
.combatant {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.player-side {
    order: 1;
}

.boss-side {
    order: 3;
}

.battle-center {
    order: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 80px;
}

.vs-label {
    font-size: 20px;
    font-weight: bold;
    color: var(--accent-red);
    text-shadow: 0 0 8px var(--accent-red);
    animation: vs-pulse 1.5s ease-in-out infinite;
}

@keyframes vs-pulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.1); opacity: 1; }
}

/* --- Информация о комбатанте --- */
.combatant-info {
    text-align: center;
    margin-bottom: 12px;
    padding: 8px 12px;
    background: var(--bg-card);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 180px;
}

.combatant-name {
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 8px;
    color: var(--text-primary);
}

.combatant-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.stat-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 13px;
}

.stat-label {
    font-size: 16px;
}

.stat-value {
    font-weight: bold;
    color: var(--text-primary);
}

/* --- Слоты экипировки (RPG-style) --- */
.equipment-slots {
    margin-top: 12px;
    padding: 12px;
    background: var(--bg-card);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    min-width: 220px;
}

.equipment-row {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 8px;
}

.equipment-row:last-child {
    margin-bottom: 0;
}

.equipment-slot {
    position: relative;
    width: 64px;
    height: 64px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    transition: all 0.2s ease;
    cursor: help;
}

.equipment-slot:hover {
    border-color: var(--accent-purple);
    box-shadow: 0 0 12px rgba(168, 85, 247, 0.3);
}

.equipment-slot.empty {
    opacity: 0.4;
    background: rgba(255, 255, 255, 0.01);
}

.equipment-slot.broken {
    border-color: var(--accent-red);
    box-shadow: 0 0 12px rgba(255, 68, 68, 0.4);
    animation: slot-broken-pulse 1s ease-in-out infinite;
}

@keyframes slot-broken-pulse {
    0%, 100% { box-shadow: 0 0 12px rgba(255, 68, 68, 0.4); }
    50% { box-shadow: 0 0 20px rgba(255, 68, 68, 0.8); }
}

.slot-icon {
    font-size: 20px;
    line-height: 1;
}

.slot-name {
    font-size: 9px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.slot-item {
    position: absolute;
    top: 2px;
    left: 2px;
    right: 2px;
    bottom: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    pointer-events: none;
}

.slot-durability {
    position: absolute;
    bottom: 2px;
    left: 4px;
    right: 4px;
    height: 4px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 2px;
    overflow: hidden;
}

.slot-durability-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-green), var(--accent-green-bright));
    border-radius: 2px;
    transition: width 0.3s ease, background 0.3s ease;
}

.slot-durability-bar.low {
    background: linear-gradient(90deg, var(--color-warning), #ffaa00);
}

.slot-durability-bar.critical {
    background: linear-gradient(90deg, var(--accent-red), #ff6666);
}

.slot-durability-bar.broken {
    background: var(--accent-red);
}

/* Анимация пульсации босса */
@keyframes boss-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
}

/* Анимация пульсации босса */
.boss-icon-large {
    font-size: 80px;
    line-height: 1;
    animation: boss-pulse 2.4s ease-in-out infinite;
    filter: drop-shadow(0 0 20px rgba(255, 100, 100, 0.5));
}

/* --- Босс HP --- */
.boss-hp-section {
    margin-top: 8px;
}

.boss-hp-bar {
    height: 22px;
    background: #1a1a2e;
    border-radius: 11px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.15);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
}

.boss-hp-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-red), #ff6b6b, #ffaa00);
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 9px;
    position: relative;
    overflow: hidden;
}

.boss-hp-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, 
        transparent 0%, 
        rgba(255,255,255,0.2) 50%, 
        transparent 100%);
    animation: hp-shine 2s ease-in-out infinite;
}

@keyframes hp-shine {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.boss-hp-text {
    text-align: center;
    font-size: 14px;
    font-weight: bold;
    color: var(--text-primary);
    margin-top: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* --- Лог боя --- */
.fight-log {
    flex: 1;
    min-height: 150px;
    max-height: 250px;
    overflow-y: auto;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 12px;
    line-height: 1.5;
}

.fight-log p {
    margin: 4px 0;
    padding: 4px 8px;
    border-radius: 6px;
    animation: log-entry 0.3s ease-out;
}

@keyframes log-entry {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

.fight-log .damage { color: var(--accent-red); font-weight: bold; }
.fight-log .heal { color: var(--accent-green); font-weight: bold; }
.fight-log .hit { color: var(--accent-orange); }
.fight-log .block { color: var(--accent-blue); }
.fight-log .crit { color: var(--accent-yellow); font-weight: bold; text-shadow: 0 0 4px var(--accent-yellow); }
.fight-log .loot { color: var(--accent-yellow); }
.fight-log .boss-action { color: var(--accent-orange); font-style: italic; }
.fight-log .player-action { color: var(--accent-green); }

/* --- Энергия в бою --- */
.fight-energy-display {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 15px;
    padding: 10px 16px;
    background: var(--bg-card);
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.energy-label {
    color: var(--text-secondary);
}

#boss-energy-text {
    font-weight: bold;
    font-size: 18px;
    color: var(--accent-yellow);
}

.energy-used {
    color: var(--accent-red);
    font-weight: bold;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.energy-used.show {
    opacity: 1;
    animation: energy-flash 0.3s ease-out;
}

@keyframes energy-flash {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); color: #ff4444; }
    100% { transform: scale(1); }
}

/* --- Кнопки действий --- */
.boss-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
}

.attack-btn {
    width: 100%;
    padding: 18px;
    border: none;
    border-radius: 16px;
    background: linear-gradient(135deg, #4d7c41, #2e7d32);
    color: #fff;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    box-shadow: 0 4px 12px rgba(46, 125, 50, 0.4);
    transition: all 0.15s ease;
}

.attack-btn:active { transform: scale(0.96); }
.attack-btn:disabled, .attack-btn.disabled { 
    opacity: 0.4; 
    pointer-events: none; 
    transform: none;
}

.attack-btn:hover:not(:disabled) {
    box-shadow: 0 6px 20px rgba(46, 125, 50, 0.6);
    background: linear-gradient(135deg, #5a8d4e, #3a8f3e);
}

.attack-progress-container {
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
}

.attack-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-yellow), var(--accent-orange));
    width: 0%;
    transition: width 0.1s linear;
    border-radius: 3px;
}

.weapon-btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--accent-purple), #6a1b9a);
    color: #fff;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.15s ease;
}

.weapon-btn:hover {
    box-shadow: 0 4px 16px rgba(106, 27, 154, 0.5);
}

/* ---------- Рейды (вкладка "Массовый" на экране боссов) ---------- */
'''

if old_start >= 0:
    new_content = content[:old_start] + new_css + content[next_section:]
    with open(r'E:\zztelegramLast-hearth\last-hearth\public\styles.css', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('SUCCESS: CSS replaced')
else:
    print('NOT FOUND')
EOF