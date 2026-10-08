with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add GAME_CONFIG after BASE_PRICE_BY_RARITY
# Find the end of BASE_PRICE_BY_RARITY
idx = content.find('BASE_PRICE_BY_RARITY')
brace_count = 0
i = content.find('{', idx)
while i < len(content):
    if content[i] == '{':
        brace_count += 1
    elif content[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            insert_pos = i + 1
            break
    i += 1

game_config = '''

    /** Игровая конфигурация — единый источник констант для клиента и сервера */
    const GAME_CONFIG = Object.freeze({
        // Шанс дропа
        BASE_DROP_CHANCE: 8,
        MAX_DROP_CHANCE: 60,
        MAX_LUCK: 150,

        // Регенерация
        ENERGY_REGEN_INTERVAL_MS: 60 * 1000,
        HEALTH_REGEN_INTERVAL_MS: 90 * 1000,
        HEALTH_REGEN_CAP_RATIO: 0.6,
        DEFAULT_AUTO_HEAL_THRESHOLD: 35,
        AUTO_HEAL_THRESHOLD_MIN: 10,
        AUTO_HEAL_THRESHOLD_MAX: 90,

        // Износ и ремонт
        WEAR_PER_HIT: 0.5,
        REPAIR_COST_MULTIPLIER: 0.4,
        UPGRADE_COST_MULTIPLIER: 0.8,
        BASE_DURABILITY: 500,

        // Цены
        BASE_PRICE_BY_RARITY: {
            common: 50,
            uncommon: 200,
            rare: 800,
            epic: 5000,
            legendary: 50000
        },

        // Дроп монет
        COIN_DROP_CHANCE: 30,
        BASE_COIN_AMOUNT: 50,
        MAX_COIN_AMOUNT: 500,
        RISK_MULTIPLIERS: {
            safe: 1.0,
            warning: 1.5,
            danger: 2.0,
            deadly: 3.0
        }
    });

'''

content = content[:insert_pos] + game_config + content[insert_pos:]

# 2. Remove duplicate GAME_CONFIG from exports (it appears twice)
# Find and remove duplicate GAME_CONFIG from exports
# The exports are at the end of the file
export_section = content.rfind('return {')
if export_section >= 0:
    # Find the return object
    brace_count = 0
    i = export_section
    while i < len(content):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                export_end = i + 1
                break
        i += 1
    
    export_content = content[export_section:export_end]
    # Remove duplicate GAME_CONFIG entries
    export_content = export_content.replace('GAME_CONFIG,\n        GAME_CONFIG,', 'GAME_CONFIG,')
    export_content = export_content.replace('GAME_CONFIG,\n        GAME_CONFIG,', 'GAME_CONFIG,')
    content = content[:export_section] + export_content + content[export_end:]

# Write the fixed file
with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed equipment.js')