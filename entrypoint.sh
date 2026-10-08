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

echo "=== Starting node index.js with wrapper ==="
# Запускаем через wrapper, который не даёт процессу уйти молча
exec node -e "
const { spawn } = require('child_process');
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
  // Если code === 0 — всё равно не выходим, а ждём, чтобы контейнер не рестартил
  console.log('[WRAPPER] Process exited with 0, keeping container alive for debugging...');
  setInterval(() => {}, 1000);
});
" 2>&1