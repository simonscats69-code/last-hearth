/**
 * Service Worker для Last Hearth
 * Кэширование статических ресурсов для офлайн работы
 * Улучшенная версия с защитой от ошибок переподключения
 */

const CACHE_NAME = 'last-hearth-v5';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/game-core.js',
    '/game-systems.js',
    '/game-ui.js',
    '/game-api.js',
    '/game-utils.js',
    '/game-store.js',
    '/game-animations.js',
    '/game-visualEffects.js'
];

// Максимальное количество попыток переподключения
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 1000;

// Установка Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Кэширование статических файлов');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] SW установлен, пропускаем ожидание');
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error('[SW] Ошибка кэширования:', err);
            })
    );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
    console.log('[SW] Активация новой версии');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Удаляем старый кэш:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Получаем контроль над клиентами');
            return self.clients.claim();
        })
    );
});

// Обработка сообщений от клиентов
self.addEventListener('message', (event) => {
    console.log('[SW] Получено сообщение:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    event.respondWith((async () => {
        const url = new URL(event.request.url);

        // Не обрабатываем кросс-доменные запросы (включая Telegram CDN)
        if (url.origin !== self.location.origin) {
            try {
                return await fetch(event.request);
            } catch (error) {
                console.warn('[SW] Кросс-доменный запрос не удался:', url.href);
                return new Response('', { status: 504, statusText: 'Gateway Timeout' });
            }
        }
        
        // API запросы - только сеть с улучшенной обработкой ошибок
        if (url.pathname.startsWith('/api/')) {
            try {
                const response = await fetch(event.request);
                return response;
            } catch (error) {
                console.error('[SW] Ошибка API запроса:', error.message);
                return new Response(
                    JSON.stringify({ error: 'Нет соединения', message: error.message }),
                    { 
                        headers: { 'Content-Type': 'application/json' },
                        status: 503
                    }
                );
            }
        }
        
        // Запросы к статическим файлам - пробуем кэш
        const cached = await caches.match(event.request);
        if (cached) {
            console.log('[SW] Возвращаем из кэша:', event.request.url);
            
            // Обновляем кэш в фоне (без блокировки ответа)
            event.waitUntil((async () => {
                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(event.request, networkResponse.clone());
                    }
                } catch (error) {
                    // Тихо игнорируем ошибки обновления кэша
                    console.warn('[SW] Не удалось обновить кэш:', error.message);
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
            console.error('[SW] Сетевой запрос не удался:', error.message);
            
            // Для навигационных запросов возвращаем index.html
            if (event.request.mode === 'navigate') {
                const fallback = await caches.match('/index.html');
                if (fallback) {
                    console.log('[SW] Возвращаем fallback index.html');
                    return fallback;
                }
            }
            
            // Для остальных - заглушка
            return new Response(
                'Ресурс временно недоступен',
                { status: 503, statusText: 'Service Unavailable' }
            );
        }
    })());
});

// Обработка ошибок
self.addEventListener('error', (event) => {
    console.error('[SW] Ошибка:', event.message);
});

self.addEventListener('install', (event) => {
    console.log('[SW] Установлен');
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Активирован');
});
