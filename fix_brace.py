with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the extra closing brace at line 4611
lines = content.split('\n')
# Line 4611 (index 4610) has the extra }
lines[4610] = '    showScreen(\'boss-fight\');'  # Remove the extra }

new_content = '\n'.join(lines)

with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('SUCCESS: Fixed extra closing brace')