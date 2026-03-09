#!/bin/bash
set -e

echo "=== Entrypoint started ==="

# Создаём папку для данных
mkdir -p /app/data
chmod 777 /app/data
chown -R $(id -u):$(id -g) /app/data 2>/dev/null || true

echo "=== Data folder created ==="

# Проверяем права на файл
ls -la /app/entrypoint.sh

# Запускаем основное приложение
echo "=== Starting node index.js ==="
exec "$@"
