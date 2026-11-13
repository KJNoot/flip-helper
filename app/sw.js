// Offline cache. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'flip-helper-v0.8.0-1';
const OWN = 'flip-helper-';
const ASSETS = ['./', 'index.html', 'css/app.css', 'fonts/DancingScript-Jessika.woff', 'fonts/DancingScript-Jessika.ttf', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'js/core/actions.js', 'js/core/ask.js', 'js/core/autosave.js', 'js/core/compat.js', 'js/core/comps.js', 'js/core/csv.js', 'js/core/demo.js', 'js/core/desktop.js', 'js/core/sync-config.js', 'js/core/sync.js', 'js/core/draft.js', 'js/core/drops.js', 'js/core/fees.js', 'js/core/guide.js', 'js/core/history.js', 'js/core/honesty.js', 'js/core/intro.js', 'js/core/inventory.js', 'js/core/invite.js', 'js/core/key.js', 'js/core/match.js', 'js/core/mistakes.js', 'js/core/morning.js', 'js/core/photo.js', 'js/core/studio.js', 'js/core/segment.js', 'js/core/studio-worker.js', 'js/core/prefs.js', 'js/core/pricing.js', 'js/core/profit.js', 'js/core/protect.js', 'js/core/qr.js', 'js/core/samples.js', 'js/core/scanner.js', 'js/core/secondlook.js', 'js/core/lookdeeper.js', 'js/core/enhance.js', 'js/core/locate.js', 'js/core/settings.js', 'js/core/shipping.js', 'js/core/sites.js', 'js/core/sitestatus.js', 'js/core/storage.js', 'js/core/taxes.js', 'js/core/voice.js', 'js/core/walkthrough.js', 'js/main.js', 'js/ui/ask.js', 'js/ui/cleanup.js', 'js/ui/demo.js', 'js/ui/dictation.js', 'js/ui/dom.js', 'js/ui/intro.js', 'js/ui/screens/add.js', 'js/ui/screens/compat.js', 'js/ui/screens/form.js', 'js/ui/screens/home.js', 'js/ui/screens/item.js', 'js/ui/screens/items.js', 'js/ui/screens/scan.js', 'js/ui/screens/secondlook.js', 'js/ui/screens/settings.js', 'js/ui/syncui.js', 'js/ui/screens/taxes.js', 'js/ui/suggest.js', 'js/ui/terms.js', 'js/ui/tips.js', 'js/ui/walkthrough.js', 'media/intro-poster.jpg', 'media/samples/mug.jpg', 'media/samples/frame.jpg', 'media/samples/tote.jpg'];
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
  // Intro video is lazy-loaded and can be ~15 MB — never precache or runtime-cache it.
  if (/\.mp4$/i.test(url.pathname)) {
    e.respondWith(fetch(req));
    return;
  }
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
