# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем весь проект
COPY . .

# Копируем entrypoint и делаем исполняемым
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

# Запускаем через entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]
