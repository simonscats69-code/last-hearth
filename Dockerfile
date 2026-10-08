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

# Копируем исходный код ДО установки зависимостей (postinstall запускает build)
COPY . .

# Устанавливаем зависимости — npm install лучше работает с workspaces чем npm ci
RUN npm install --include=dev

# Явная проверка/создание workspace-symlinks (фоллбек для старых npm)
RUN node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
pkgs.forEach(p => {
  const link = path.join('/app/node_modules/@last-hearth', p);
  const target = path.join('/app/packages', p);
  if (!fs.existsSync(link)) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'dir');
    console.log('Created symlink:', link, '->', target);
  } else {
    console.log('Symlink exists:', link);
  }
});
EOF

# Собираем пакеты в правильном порядке: core -> db -> server -> client
RUN npm run -w @last-hearth/core -- build && \
    npm run -w @last-hearth/db -- build && \
    npm run -w @last-hearth/server -- build && \
    npm run -w @last-hearth/client -- build

# Верификация: убеждаемся, что dist-файлы на месте
RUN node <<'EOF'
const fs = require('fs');
const path = require('path');
const required = [
  'packages/core/dist/index.js',
  'packages/core/dist/index.mjs',
  'packages/db/dist/index.js',
  'packages/server/dist/index.js',
  'packages/client/dist/index.js',
];
required.forEach(f => {
  const full = path.join('/app', f);
  if (!fs.existsSync(full)) {
    console.error('MISSING:', full);
    process.exit(1);
  } else {
    console.log('OK:', full);
  }
});
console.log('All build outputs verified');
EOF

# Не удаляем dev deps — npm prune ломает workspace symlinks

# Делаем entrypoint исполняемым
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]