#!/bin/sh
set -e

# --- Восстановление workspace-ссылок и dist -------------------------------
# В рабочем контейнере node_modules/@last-hearth/* бывает битым ( npm-копия
# без dist, отсутствующий симлинк, удалённый на этапе платформенной сборки
# dist/ — он в .gitignore). Проверяем и чиним ЗДЕСЬ, при каждом старте:
# 1) пересоздаём симлинки на packages/*;
# 2) если dist недоступен — собираем пакеты локально;
# 3) если и это не помогло — npm install --include=dev (вернёт tsup,
#    postinstall пересоберёт workspaces);
# 4) иначе падаем с исчерпывающей диагностикой, а не молчаливым restart-loop.
echo "=== Fixing workspace symlinks ==="

fix_symlinks() {
  node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
pkgs.forEach(p => {
  const link = path.join('/app/node_modules/@last-hearth', p);
  const target = path.join('/app/packages', p);
  // lstat: симлинк на несуществующую цель existsSync() не видит
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st) {
    fs.rmSync(link, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'dir');
  console.log('Created symlink:', link, '->', target);
});
EOF
}

verify_dist() {
  node <<'EOF'
const fs = require('fs');
const path = require('path');
const pkgs = ['core', 'db', 'server', 'client'];
let failed = 0;
pkgs.forEach(p => {
  const distPath = path.join('/app/node_modules/@last-hearth', p, 'dist', 'index.js');
  if (fs.existsSync(distPath)) {
    console.log('VERIFIED:', distPath, '->', fs.realpathSync(distPath));
  } else {
    console.error('MISSING via symlink:', distPath);
    failed = 1;
  }
});
process.exit(failed);
EOF
}

fix_symlinks

if ! verify_dist; then
  echo "[boot] dist отсутствует — попытка восстановления: сборка пакетов"
  for p in core db server client; do
    npm run -w "@last-hearth/$p" -- build || echo "[boot] build $p failed"
  done

  if ! verify_dist; then
    echo "[boot] dist всё ещё отсутствует — npm install --include=dev"
    npm install --include=dev --no-audit --no-fund || echo "[boot] npm install failed"
    fix_symlinks

    if ! verify_dist; then
      echo "[boot] FATAL: не удалось восстановить dist. Диагностика:"
      ls -la /app/packages || true
      for p in core db server client; do
        echo "--- /app/packages/$p ---"
        ls -la "/app/packages/$p" || true
        echo "--- /app/packages/$p/dist ---"
        ls -la "/app/packages/$p/dist" 2>/dev/null || echo "(нет dist)"
      done
      echo "--- /app/node_modules/@last-hearth ---"
      ls -la /app/node_modules/@last-hearth || true
      echo "--- tsup ---"
      ls -la /app/node_modules/.bin/tsup 2>/dev/null || echo "tsup binary not found"
      exit 1
    fi
  fi
fi
echo "=== Workspace symlinks OK ==="

echo "=== Список файлов в /app ==="
ls -la /app
echo "=== Конец списка ==="

mkdir -p /app/data
chmod 777 /app/data
chown -R $(id -u):$(id -g) /app/data 2>/dev/null || true

echo "=== Node version ==="
node --version

echo "=== Starting node index.js with early error capture ==="
exec node -e "
const { spawn } = require('child_process');

try {
  require('./index.js');
  console.log('[EARLY] index.js loaded successfully');
} catch (err) {
  console.error('[EARLY LOAD ERROR]', err.message);
  console.error('[EARLY STACK]', err.stack);
  process.exit(1);
}

const child = spawn('node', ['index.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env
});

child.stdout.on('data', (data) => {
  console.log('[STDOUT]', data.toString().trim());
});

child.stderr.on('data', (data) => {
  console.error('[STDERR]', data.toString().trim());
});

child.on('error', (err) => {
  console.error('[SPAWN ERROR]', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.error('[PROCESS EXIT] code=', code, 'signal=', signal);
  if (code !== 0 && code !== null) {
    process.exit(code);
  }
  if (signal) {
    process.exit(128 + signal);
  }
  console.log('[WRAPPER] Process exited with 0, keeping container alive...');
  setInterval(() => {}, 1000);
});
" 2>&1