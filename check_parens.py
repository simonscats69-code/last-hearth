with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    open_p = line.count('(')
    close_p = line.count(')')
    if open_p != close_p:
        print(f'Line {i+1}: open={open_p} close={close_p} - {line.rstrip()[:80]}')