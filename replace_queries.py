with open(r'E:\zztelegramLast-hearth\last-hearth\db\schema.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the runMigrations function boundaries
lines = content.split('\n')

# Find start and end of runMigrations function
start_line = -1
end_line = -1
for i, line in enumerate(lines):
    if 'async function runMigrations()' in line:
        start_line = i
    if start_line >= 0 and line.strip() == '}' and i > start_line:
        # Check if this is the end of runMigrations (next function starts)
        next_lines = lines[i+1:i+5]
        if any('async function' in l or 'function ' in l for l in next_lines if l.strip()):
            end_line = i
            break

print(f'runMigrations: lines {start_line+1} to {end_line+1}')

# Replace await query( with await queryTx( in the runMigrations function
new_lines = []
in_run_migrations = False
for i, line in enumerate(lines):
    if i == start_line:
        in_run_migrations = True
    if in_run_migrations:
        # Replace await query( with await queryTx( in this function
        if 'await query(' in line and 'queryTx' not in line:
            line = line.replace('await query(', 'await queryTx(')
    if in_run_migrations and i == len(lines) - 1:
        in_run_migrations = False
    # Check if we've left the runMigrations function
    if in_run_migrations and i > 0:
        # Check if we've reached the end of runMigrations
        if line.strip() == '}' and i > start_line:
            # Check if next line starts a new function
            next_idx = i + 1
            while next_idx < len(lines) and lines[next_idx].strip() == '':
                next_idx += 1
            if next_idx < len(lines) and ('async function' in lines[next_idx] or 'function ' in lines[next_idx]):
                in_run_migrations = False
    new_lines.append(line)

new_content = '\n'.join(new_lines)

# Also need to close the transaction at the end of runMigrations
# Find the closing brace of runMigrations and add the transaction close
if 'await query(' in new_content:
    print("WARNING: Still has await query( after replacement")

with open(r'E:\zztelegramLast-hearth\last-hearth\db\schema.js', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print('Replacement done')