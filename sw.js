// Service worker: מאפשר לאפליקציה להיפתח מהר וגם בלי אינטרנט
const CACHE = 'limud-v3';
const FB = 'https://www.gstatic.com/firebasejs/13.3.0/';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/books.js', 'js/config.js', 'js/hebrew.js', 'js/schedule.js', 'js/store.js',
];
const FB_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => FB + f);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILES);
    // ספריות Firebase — כדי שהאפליקציה תיפתח גם בלי אינטרנט
    await Promise.all(FB_FILES.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
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

  // ספריות Firebase (הגרסה קבועה בכתובת): קודם מהמטמון
  if (url.href.startsWith(FB)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })),
    );
    return;
  }

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
