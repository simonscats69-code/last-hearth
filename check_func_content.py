with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('function showStackSellDialog')
with open(r'E:\zztelegramLast-hearth\last-hearth\check_func.txt', 'w', encoding='utf-8') as f:
    f.write(content[idx:idx+500])
print('Written to check_func.txt')