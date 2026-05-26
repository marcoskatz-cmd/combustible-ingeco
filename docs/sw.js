/**
 * Service Worker — Combustible INGECO PWA.
 *
 * Estrategia:
 *   - SHELL (HTML, CSS, JS, íconos, manifest): cache-first con
 *     stale-while-revalidate. La app abre rápido aún sin red y el SW
 *     actualiza en background para la próxima visita.
 *   - API (Cloudflare Worker proxy): network-only. Los datos cambian,
 *     no queremos servir balance/entregas viejos.
 *   - Cualquier otra URL: pasamos sin tocar.
 *
 * Versionado: cuando cambies el SHELL, bumpeá CACHE_VERSION para forzar
 * que los clientes existentes traigan el shell nuevo en la próxima carga.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'combustible-shell-' + CACHE_VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './entrega.html',
  './reposicion.html',
  './stock.html',
  './resumen.html',
  './estilos.css',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache) {
      // addAll falla atómicamente si algún archivo no se puede traer.
      // Usamos add individual con catch para no romper la instalación
      // si un ícono opcional faltara.
      return Promise.all(SHELL_FILES.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('SW no pudo cachear', url, err);
        });
      }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) {
        if (k !== SHELL_CACHE && k.indexOf('combustible-shell-') === 0) {
          return caches.delete(k);
        }
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  const req = event.request;

  // No interferir con métodos que no sean GET (POST al worker, etc.)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interferir con requests a otros orígenes (proxy worker, apps script, etc.)
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate sobre el shell
  event.respondWith(
    caches.match(req).then(function(cached) {
      const networkFetch = fetch(req).then(function(resp) {
        // Solo cacheamos respuestas OK del mismo origen
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(SHELL_CACHE).then(function(cache) {
            cache.put(req, respClone);
          });
        }
        return resp;
      }).catch(function() {
        // Sin red — si tenemos cache, ya lo devolvimos arriba. Si no, falla.
        return cached || new Response('Offline', { status: 503 });
      });
      return cached || networkFetch;
    })
  );
});
