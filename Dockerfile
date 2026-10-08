# Last Hearth - Telegram Mini App
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Устанавливаем зависимости для сборки (включая dev)
COPY package*.json ./
RUN npm ci

# Копируем весь проект
COPY . .

# Собираем workspace пакеты
RUN npm run build

# Удаляем dev dependencies после сборки
RUN npm prune --omit=dev

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]