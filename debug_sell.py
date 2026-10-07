with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('function showStackSellDialog')
with open(r'E:\zztelegramLast-hearth\last-hearth\debug_sell.txt', 'w', encoding='utf-8') as f:
    f.write(content[idx:idx+800])
print('Written to debug_sell.txt')