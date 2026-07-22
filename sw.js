/* 豐有工程管理系統 Service Worker — v5.243
 * 策略：網路優先（永遠先拿最新版），失敗時退回快取（工地無訊號也能開）。
 * 只快取同源 GET；Firebase／CDN 請求不攔截。
 */
const CACHE = 'fy-app-v1';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // Firebase/CDN 直通

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 成功：回應並更新快取（下次離線用）
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // 離線：退回快取；導覽請求最終退回 index.html
        caches.match(e.request).then(m =>
          m || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
        )
      )
  );
});
