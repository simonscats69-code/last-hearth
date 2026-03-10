#!/bin/sh
set -e

echo "=== Список файлов в /app ==="
ls -la /app
echo "=== Конец списка ==="

mkdir -p /app/data
chmod 777 /app/data
chown -R $(id -u):$(id -g) /app/data 2>/dev/null || true

cd /app
npm install --production --silent

exec "$@"
