#!/bin/sh
set -e

echo "🚀 Запуск Last Hearth..."

# Создаём папку для данных если её нет
mkdir -p /app/data

# Запускаем команду
exec "$@"
