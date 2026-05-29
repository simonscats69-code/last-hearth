// Last Hearth - Service Worker
const CACHE_VERSION = 'v1';
const CACHE_NAME = `last-hearth-cache-${CACHE_VERSION}`;
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/game.js',
    '/sw.js'
];

// Установка - кэшируем статику
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// Активация - удаляем старые кэши
self.addEventListener('activate', (event) => {
    self.clients.claim();
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
});

// Стратегия: cache-first для статики, network-only для API
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API запросы - только сеть
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request).catch(() => {
            return new Response(JSON.stringify({ error: 'Нет соединения', offline: true }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }));
        return;
    }

    // Статические файлы - cache-first
    event.respondWith(
        caches.match(request).then((cached) => {
            const fetchPromise = fetch(request).then((response) => {
                if (response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});