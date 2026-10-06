/* 豐有工程管理系統 Service Worker — v6.0.33
 * 策略：
 *  - index.html／導覽請求：快取優先（開頁不等網路），同時背景抓最新版；抓到不同版本（ETag／Last-Modified／長度不同）
 *    就通知頁面顯示「系統有新版本」，使用者按重新整理即更新。（v6.0.33 以前是網路優先，每次開頁都要先下載 2.9MB）
 *  - 其他同源 GET：網路優先，失敗退回快取（工地無訊號也能開）。
 *  - PDF 套件 html2canvas／jsPDF（版本固定）：快取優先。Firebase／其他 CDN 不攔截。
 */
const CACHE = 'fy-app-v2';
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

function sig(res) {
  return (res.headers.get('etag') || '') + '|' + (res.headers.get('last-modified') || '') + '|' + (res.headers.get('content-length') || '');
}
function notifyUpdate() {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(cs => cs.forEach(c => c.postMessage({ type: 'fy-update' }))).catch(() => {});
}
function isAppShell(req, url) {
  return req.mode === 'navigate' || /\/index\.html$/.test(url.pathname) || /\/$/.test(url.pathname);
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
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
    return;
  }

  if (isAppShell(e.request, url)) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then(cached => {
        const net = fetch(e.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
            if (cached && sig(cached) !== sig(res)) notifyUpdate();
          }
          return res;
        }).catch(() => null);
        if (cached) { e.waitUntil(net); return cached; }
        return net.then(r => r || caches.match('./index.html'));
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(m =>
          m || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
        )
      )
  );
});
