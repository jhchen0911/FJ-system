/* 豐有工程管理系統 Service Worker — v5.445
 * 策略：網路優先（永遠先拿最新版），失敗時退回快取（工地無訊號也能開）。
 * 只快取同源 GET；Firebase／CDN 請求不攔截——
 * 例外（v5.445）：PDF 套件 html2canvas／jsPDF（版本固定、不會變）改「快取優先」，
 * 手機網路不穩時也能載到，匯出 PDF 才不會退回瀏覽器列印。
 */
const CACHE = 'fy-app-v1';
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];
const LIB_RE = /html2canvas|jspdf/i;

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
  if (url.origin !== self.location.origin) {
    // v5.445：PDF 套件快取優先（回應可能是 opaque，也照存）
    if (LIB_HOSTS.includes(url.hostname) && LIB_RE.test(url.pathname)) {
      e.respondWith(
        caches.match(e.request).then(m => m || fetch(e.request).then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        }))
      );
    }
    return;   // 其餘 Firebase/CDN 直通
  }

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
