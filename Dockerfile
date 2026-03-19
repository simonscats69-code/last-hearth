# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm ci --omit=dev

# Копируем весь проект
COPY . .

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]
