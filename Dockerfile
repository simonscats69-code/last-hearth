# Last Hearth - Telegram Mini App
FROM node:20-alpine

# ENV NODE_ENV=production moved below build steps to ensure devDependencies are installed

WORKDIR /app

# Копируем package.json файлы для workspace resolution
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/db/package*.json ./packages/db/
COPY packages/server/package*.json ./packages/server/
COPY packages/client/package*.json ./packages/client/

# Копируем исходный код ДО установки зависимостей (postinstall запускает build)
COPY . .

# Устанавливаем все зависимости (включая dev) — нужны для npm run build на этапе сборки.
# Dev-зависимости (tsup, typescript и т.д.) остаются в最終 образе, так как
# multi-stage сборка не используется.
RUN npm install --include=dev

# Собираем пакеты в правильном порядке: core -> db -> server -> client
RUN npm run -w @last-hearth/core -- build && \
    npm run -w @last-hearth/db -- build && \
    npm run -w @last-hearth/server -- build && \
    npm run -w @last-hearth/client -- build

# Явная проверка/создание workspace-symlinks ПОСЛЕ всех билдов
RUN node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
pkgs.forEach(p => {
  const link = path.join('/app/node_modules/@last-hearth', p);
  const target = path.join('/app/packages', p);
  // Удаляем старый (если есть) и создаём заново
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fs.rmSync(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'dir');
  console.log('Created symlink:', link, '->', target);
  
  // Верификация: проверяем, что через симлинк виден dist
  const distPath = path.join(link, 'dist', 'index.js');
  if (fs.existsSync(distPath)) {
    console.log('VERIFIED:', distPath, '->', fs.realpathSync(distPath));
  } else {
    console.error('MISSING via symlink:', distPath);
    process.exit(1);
  }
});
EOF

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

# Незащищённый запуск от root — риск при компрометации контейнера.
# Создаём непривилегированного пользователя и запускаем от его имени.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Run as root to allow entrypoint to rebuild packages on mounted volumes
# USER appuser

EXPOSE 3000

# Healthcheck через существующий endpoint /ready (node вместо wget, которого нет в alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" || exit 1

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]