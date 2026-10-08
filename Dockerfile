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

# Собираем пакеты в правильном порядке: core -> db -> server -> client
RUN npm run -w @last-hearth/core -- build && \
    npm run -w @last-hearth/db -- build && \
    npm run -w @last-hearth/server -- build && \
    npm run -w @last-hearth/client -- build

# Не удаляем dev deps — npm prune ломает workspace symlinks

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]