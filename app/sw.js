// Offline cache. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'flip-helper-v0.1.0';
const OWN = 'flip-helper-';
const ASSETS = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'js/main.js', 'js/core/sites.js', 'js/core/inventory.js', 'js/core/key.js', 'js/core/prefs.js', 'js/core/draft.js', 'js/core/storage.js', 'js/ui/dom.js', 'js/ui/suggest.js', 'js/ui/screens/form.js', 'js/ui/screens/home.js', 'js/ui/screens/add.js', 'js/ui/screens/item.js', 'js/ui/screens/items.js', 'js/ui/screens/settings.js'];
// App shell: network first so an open gets the newest version when online,
// with the cache as the offline fallback. Images: cache first.
const SHELL_RE = /(\/|\.html|\.js|\.css|\.json|\.webmanifest)$/;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(OWN) && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const home = req.mode === 'navigate';
    const key = home ? new Request(self.registration.scope + 'index.html') : new Request(url.origin + url.pathname);
    if (home || SHELL_RE.test(url.pathname)) {
      try {
        const res = await Promise.race([fetch(home ? key : req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(key)) || (home && await cache.match(self.registration.scope)) || Response.error();
      }
    }
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  })());
});
