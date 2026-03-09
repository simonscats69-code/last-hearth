/**
 * Service Worker для Last Hearth
 * Кэширование статических ресурсов для офлайн работы
 */

const CACHE_NAME = 'last-hearth-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/game.js',
    '/game-api.js',
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
    const url = new URL(event.request.url);
    
    // API запросы - только сеть
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return new Response(
                        JSON.stringify({ error: 'Нет соединения' }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }
    
    // Статические файлы - кэш + сеть
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    // Возвращаем кэш и обновляем в фоне
                    event.waitUntil(
                        fetch(event.request)
                            .then((networkResponse) => {
                                if (networkResponse.ok) {
                                    caches.open(CACHE_NAME)
                                        .then((cache) => cache.put(event.request, networkResponse));
                                }
                            })
                            .catch(() => {})
                    );
                    return response;
                }
                
                // Нет в кэше - загружаем из сети
                return fetch(event.request)
                    .then((networkResponse) => {
                        if (networkResponse.ok) {
                            const responseClone = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => cache.put(event.request, responseClone));
                        }
                        return networkResponse;
                    });
            })
    );
});
