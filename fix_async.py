with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add async to startSoloBossFight
content = content.replace(
    'function startSoloBossFight(bossId) {',
    'async function startSoloBossFight(bossId) {'
)

with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('SUCCESS: Added async to startSoloBossFight')