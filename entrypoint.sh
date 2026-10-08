#!/bin/sh
set -e

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

// Сначала проверяем, что index.js загружается без синтаксических ошибок
try {
  require('./index.js');
  console.log('[EARLY] index.js loaded successfully');
} catch (err) {
  console.error('[EARLY LOAD ERROR]', err.message);
  console.error('[EARLY STACK]', err.stack);
  process.exit(1);
}

// Если загрузился - запускаем нормально через spawn для логов
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