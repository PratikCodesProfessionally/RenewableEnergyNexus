// Service Worker for Renewable Energy Nexus
// NOTE: network-first to avoid serving stale HTML/CSS during active development.
const CACHE_NAME = 'renewable-energy-nexus-v4';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/articles.html',
    '/manifest.json',
    '/RenewableEnergyNexus/css/StyleSheet1.css',
    '/RenewableEnergyNexus/js/script.js',
    '/RenewableEnergyNexus/js/emailSubscription.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch(() => undefined)
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) =>
                Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                )
            ),
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    // Skip cross-origin requests and auth redirects to avoid CORS issues
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Only cache valid same-origin responses
                if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(event.request, responseClone))
                        .catch(() => undefined);
                }
                return networkResponse;
            })
            .catch(() => {
                // Return cached response or a proper fallback
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Return a proper error response instead of undefined
                    return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
                });
            })
    );
});
