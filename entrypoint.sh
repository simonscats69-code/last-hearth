#!/bin/sh
set -e

echo "=== Fixing workspace symlinks ==="
node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
pkgs.forEach(p => {
  const link = path.join('/app/node_modules/@last-hearth', p);
  const target = path.join('/app/packages', p);
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fs.rmSync(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'dir');
  console.log('Created symlink:', link, '->', target);
  
  const distPath = path.join(link, 'dist', 'index.js');
  if (fs.existsSync(distPath)) {
    console.log('VERIFIED:', distPath, '->', fs.realpathSync(distPath));
  } else {
    console.error('MISSING via symlink:', distPath);
    process.exit(1);
  }
});
EOF

echo "=== Список файлов в /app ==="
ls -la /app
echo "=== Конец списка ==="

mkdir -p /app/data
chmod 777 /app/data
chown -R $(id -u):$(id -g) /app/data 2>/dev/null || true

echo "=== Node version ==="
node --version

echo "=== Starting node index.js with early error capture ==="
exec node -e "
const { spawn } = require('child_process');

try {
  require('./index.js');
  console.log('[EARLY] index.js loaded successfully');
} catch (err) {
  console.error('[EARLY LOAD ERROR]', err.message);
  console.error('[EARLY STACK]', err.stack);
  process.exit(1);
}

const child = spawn('node', ['index.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env
});

child.stdout.on('data', (data) => {
  console.log('[STDOUT]', data.toString().trim());
});

child.stderr.on('data', (data) => {
  console.error('[STDERR]', data.toString().trim());
});

child.on('error', (err) => {
  console.error('[SPAWN ERROR]', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.error('[PROCESS EXIT] code=', code, 'signal=', signal);
  if (code !== 0 && code !== null) {
    process.exit(code);
  }
  if (signal) {
    process.exit(128 + signal);
  }
  console.log('[WRAPPER] Process exited with 0, keeping container alive...');
  setInterval(() => {}, 1000);
});
" 2>&1