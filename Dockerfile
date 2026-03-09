# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем все зависимости
RUN npm install

# Копируем весь проект
COPY . .

# Порт
EXPOSE 3000

# Запускаем напрямую (без entrypoint.sh)
CMD ["node", "index.js"]
