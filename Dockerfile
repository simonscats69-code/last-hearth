# Last Hearth - Telegram Mini App
# Multi-stage build: builder stage compiles packages, runtime stage is slim.

# ============================================================
# Stage 1: Builder — install all deps (including dev) and build
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests first for layer caching
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/db/package*.json ./packages/db/
COPY packages/server/package*.json ./packages/server/
COPY packages/client/package*.json ./packages/client/

# Copy source code
COPY . .

# Install all dependencies (dev included for build tools)
RUN npm install --include=dev

# Build packages in dependency order: core -> db -> server -> client
RUN npm run -w @last-hearth/core -- build && \
    npm run -w @last-hearth/db -- build && \
    npm run -w @last-hearth/server -- build && \
    npm run -w @last-hearth/client -- build

# Create workspace symlinks (needed at runtime)
RUN node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
pkgs.forEach(p => {
  const link = path.join('/app/node_modules/@last-hearth', p);
  const target = path.join('/app/packages', p);
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fs.rmSync(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'dir');
  console.log('Created symlink:', link, '->', target);
});
EOF

# ============================================================
# Stage 2: Runtime — production deps only, no dev tools
# ============================================================
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy package manifests
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/db/package*.json ./packages/db/
COPY packages/server/package*.json ./packages/server/
COPY packages/client/package*.json ./packages/client/

# Copy built artifacts and source from builder
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/db ./db
COPY --from=builder /app/index.js ./index.js
COPY --from=builder /app/webhook.js ./webhook.js
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

# Prune devDependencies (tsup, typescript, etc.) — keep only production deps
RUN npm prune --production 2>/dev/null || true

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Data directory
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Run as root to allow entrypoint to rebuild packages on mounted volumes
# USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "index.js"]
