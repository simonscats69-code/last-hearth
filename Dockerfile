# Last Hearth - Telegram Mini App
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем все зависимости (включая devDependencies для надёжности)
RUN npm install

# Копируем весь проект
COPY . .

# Порт
EXPOSE 3000

# Запуск
CMD ["node", "index.js"]
