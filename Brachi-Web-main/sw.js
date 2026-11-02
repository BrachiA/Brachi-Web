// Service Worker: keeps the shell, CV and articles available offline.
// Change VERSION on every deploy that changes assets. Old caches are deleted on activate.
const VERSION = 'v2.3.0';
const CORE = `bp-core-${VERSION}`;
const RUNTIME = `bp-runtime-${VERSION}`;
const RUNTIME_MAX = 40;

const PRECACHE = [
  '/', '/index.html', '/cv.html', '/404.html',
  '/articles/multi-ai.html', '/articles/benefits-wallet.html', '/articles/assistiq.html',
  '/assets/css/site.css', '/assets/css/fonts.css', '/assets/css/article.css',
  '/assets/js/main.js', '/assets/js/router.js', '/assets/js/offline.js', '/assets/js/cv.js',
  '/assets/js/diagrams.js', '/assets/js/playground.js', '/assets/js/video-wall.js',
  '/assets/js/media-manifest.js', '/assets/js/video-store.js', '/assets/js/dial.js', '/assets/js/blurhash.js', '/assets/js/article.js',
  '/assets/fonts/karantina-700-hebrew.woff2', '/assets/fonts/ibm-plex-sans-hebrew-400-hebrew.woff2',
  '/assets/fonts/ibm-plex-sans-hebrew-600-hebrew.woff2', '/assets/img/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // One file that fails (404) does not abort the whole install
    await Promise.allSettled(PRECACHE.map(async (url) => {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('bp-') && k !== CORE && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - RUNTIME_MAX; i++) await cache.delete(keys[i]);
}

function cacheable(req, res) {
  return res && res.ok && res.status === 200 && res.type !== 'opaque' && !res.headers.has('Content-Range');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Video and media are never cached (206 partial responses, size)
  if (req.destination === 'video' || req.destination === 'audio' || req.headers.has('range')) return;
  if (url.origin !== location.origin) return;
  // The video list must always be fresh (it changes from the editor), so it goes straight to the network
  if (url.pathname.endsWith('/videos-manifest.json')) return;

  // Navigation: network first (3s), then cache, then 404
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CORE);
      const cached = (await cache.match(url.pathname, { ignoreSearch: true })) || (await cache.match(url.pathname + '.html'));
      try {
        // Without a cached copy there is nothing to fall back to, so wait for the network however slow it is
        const net = cached ? await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]) : await fetch(req);
        if (cacheable(req, net)) cache.put(url.pathname === '/' ? '/' : url.pathname, net.clone());
        return net;
      } catch {
        return cached
          || (await cache.match('/404.html'))
          || new Response('אין חיבור לאינטרנט.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith((async () => {
    const core = await caches.open(CORE);
    const hit = await core.match(req, { ignoreSearch: true });
    const runtime = await caches.open(RUNTIME);
    const rHit = hit || await runtime.match(req);
    const network = fetch(req).then(async (res) => {
      if (cacheable(req, res)) {
        if (hit) await core.put(req, res.clone());
        else { await runtime.put(req, res.clone()); trim(runtime); }
      }
      return res;
    }).catch(() => null);
    if (rHit) { event.waitUntil(network); return rHit; }
    const res = await network;
    return res || new Response('', { status: 504 });
  })());
});
