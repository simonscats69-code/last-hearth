with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('function showStackSellDialog')
print('Found at:', idx)
print(repr(content[idx:idx+500]))