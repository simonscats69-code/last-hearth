# Last Hearth - Telegram Mini App
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Устанавливаем все зависимости (включая dev для сборки)
COPY package*.json ./
RUN npm ci

# Копируем исходный код
COPY . .

# Собираем все workspace пакеты
RUN npm run build

# Удаляем dev dependencies в каждом workspace и в корне
RUN npm prune --omit=dev --workspaces --include-workspace-root

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]