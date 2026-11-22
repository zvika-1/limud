// Service worker: מאפשר לאפליקציה להיפתח מהר וגם בלי אינטרנט
const CACHE = 'limud-v12';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/books.js', 'js/config.js', 'js/hebrew.js', 'js/schedule.js', 'js/store.js', 'js/fixed.js', 'js/parsha-data.js',
  'vendor/firebase/firebase-app.js', 'vendor/firebase/firebase-auth.js', 'vendor/firebase/firebase-firestore.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.origin !== location.origin) return;

  // קבצי האפליקציה: קודם מהרשת (כדי לקבל עדכונים), ואם אין אינטרנט — מהמטמון
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
