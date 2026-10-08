with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'r', encoding='utf-8') as f:
    content = f.read()

return_idx = content.find('return {')
after_return = content[return_idx+29:]

# Find the first } after return
first_brace = after_return.find('}')
print(f'First }} at offset {first_brace}')
print(repr(after_return[first_brace:first_brace+200]))

# Find all } after that
rest = after_return[first_brace+1:]
for i, ch in enumerate(rest):
    if ch == '}':
        print(f'Extra }} at offset {i}: {repr(rest[i:i+50])}')
    if ch == '{':
        print(f'Extra {{ at offset {i}: {repr(rest[i:i+50])}')