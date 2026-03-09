# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем весь проект
COPY . .

EXPOSE 3000

# Запускаем напрямую без entrypoint.sh
CMD ["node", "index.js"]
