# Last Hearth - Telegram Mini App
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Копируем package.json файлы для workspace resolution
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/db/package*.json ./packages/db/
COPY packages/server/package*.json ./packages/server/
COPY packages/client/package*.json ./packages/client/

# Устанавливаем все зависимости (включая dev для сборки)
RUN npm ci

# Копируем исходный код
COPY . .

# Собираем все workspace пакеты
RUN npm run build

# Не удаляем dev deps — npm prune ломает workspace symlinks

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]