# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем все зависимости
RUN npm install

# Копируем весь проект
COPY . .

# Копируем и делаем исполняемым entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Порт
EXPOSE 3000

# Запуск через entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]
