// P2-14 PWA Service Worker（20260929）
// 策略：
//   - 应用外壳（html/js/css）走 network-first，保证更新即时生效，离线时回退缓存；
//   - vendor/ 与图标等不可变资源走 cache-first，离线可用且加载更快。
const CACHE = 'paxihub-v1';
const SHELL = [
  './', 'index.html', 'app.js', 'session.js', 'shared.js', 'games.js',
  'sanguo.js', 'crazydice.js', 'compat.js', 'paxi-cosmjs.umd.js',
  'manifest.json', 'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（CDN 回退）不拦截

  // vendor / 图标：cache-first
  if (url.pathname.includes('/vendor/') || url.pathname.endsWith('/icon.svg')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // 应用外壳：network-first，失败回退缓存
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
