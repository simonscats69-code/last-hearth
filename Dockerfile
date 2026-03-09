FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production || npm install --only=production

COPY . .

RUN chmod +x src/index.js

EXPOSE 3000

ENTRYPOINT ["node", "src/index.js"]
