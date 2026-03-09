#!/bin/sh
set -e

# Инициализация папки данных
mkdir -p /app/data
chmod 777 /app/data
chown -R $(id -u):$(id -g) /app/data 2>/dev/null || true

# Запуск основного приложения
exec "$@"
