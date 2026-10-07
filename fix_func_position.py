with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the misplaced function
func_start = content.find('function renderPlayerEquipmentInBossFight() {')
next_func = content.find('function ', func_start + 1)

# Extract the function code
func_code = content[func_start:next_func]

# Remove the misplaced function from inside startBossFight
content = content[:func_start] + content[next_func:]

# Now find the correct place to insert - before startBossFight
# Search for the comment before startBossFight
insert_pos = content.find('/**\n * Начало боя с боссом - обновлённый UI с кнопками атаки\n */')
if insert_pos < 0:
    # Try alternative
    insert_pos = content.find('function startBossFight')
    if insert_pos < 0:
        # Try finding the async function
        insert_pos = content.find('async function startBossFight')
    if insert_pos < 0:
        print('Could not find startBossFight')
        exit(1)

# Insert before the comment
new_content = content[:insert_pos] + func_code + '\n\n' + content[insert_pos:]

with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('SUCCESS: Function moved to correct position')