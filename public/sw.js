/**
 * Service Worker для Last Hearth
 * Кэширование статических ресурсов для офлайн работы
 */

const CACHE_NAME = 'last-hearth-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/game.js',
    '/game-api.js',
    '/game-utils.js',
    '/game-state.js',
    '/game-screens.js',
    '/game-store.js',
    '/game-map.js',
    '/game-animations.js',
    '/game-particles.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Кэширование статических файлов');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    event.respondWith((async () => {
        const url = new URL(event.request.url);

        // Не обрабатываем кросс-доменные запросы
        if (url.origin !== self.location.origin) {
            try {
                return await fetch(event.request);
            } catch (error) {
                return new Response('', { status: 504, statusText: 'Gateway Timeout' });
            }
        }
        
        // API запросы - только сеть
        if (url.pathname.startsWith('/api/')) {
            try {
                return await fetch(event.request);
            } catch (error) {
                return new Response(
                    JSON.stringify({ error: 'Нет соединения' }),
                    { headers: { 'Content-Type': 'application/json' } }
                );
            }
        }
        
        const cached = await caches.match(event.request);
        if (cached) {
            // Возвращаем кэш и обновляем в фоне
            event.waitUntil((async () => {
                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(event.request, networkResponse.clone());
                    }
                } catch (error) {
                    // Тихо игнорируем ошибки обновления кэша
                }
            })());
            return cached;
        }
        
        // Нет в кэше - загружаем из сети
        try {
            const networkResponse = await fetch(event.request);
            if (networkResponse.ok) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
        } catch (error) {
            if (event.request.mode === 'navigate') {
                const fallback = await caches.match('/index.html');
                if (fallback) return fallback;
            }
            return new Response('', { status: 504, statusText: 'Gateway Timeout' });
        }
    })());
});
