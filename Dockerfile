# Last Hearth - Telegram Mini App
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Устанавливаем все зависимости (включая dev для сборки)
# Сначала копируем package.json файлы всех workspace пакетов
COPY package*.json ./
COPY packages/*/package*.json ./packages/*/
RUN npm ci

# Копируем исходный код
COPY . .

# Собираем все workspace пакеты
RUN npm run build

# Не удаляем dev deps — npm prune ломает workspace symlinks
# Dev deps в продакшн образе допустимы (небольшой overhead)

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]