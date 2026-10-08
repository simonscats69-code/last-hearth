with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the return statement
return_idx = content.find('return {')
print(f'Return at position {return_idx}')

# Find the end of the return object (first }; after return)
return_obj_end = content.find('};', return_idx) + 2
print(f'Return object ends at position {return_obj_end}')

# Find the end of the factory function (before IIFE closes)
# The IIFE closes with });\n);
iife_close = content.rfind('});\n);')
print(f'IIFE closes at position {iife_close}')

# Extract parts
header = content[:return_idx]
return_obj = content[return_idx:return_obj_end]
helpers = content[return_obj_end:iife_close]

print(f'Header length: {len(header)}')
print(f'Return obj length: {len(return_obj)}')
print(f'Helpers length: {len(helpers)}')

# New content: header + helpers + return_obj + IIFE close
new_content = header + helpers + return_obj + '\n});\n);\n'

with open(r'E:\zztelegramLast-hearth\last-hearth\public\shared\equipment.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Restructured equipment.js')