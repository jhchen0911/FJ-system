/* 豐有工程管理系統 Service Worker — v6.0.34（v6.0.130 加 calc/*.js）
 * 策略：
 *  - 應用殼（index.html／導覽請求、app.js 主程式、calc/*.js 計算模組）：快取優先（開頁不等網路），同時背景以 no-cache 重新驗證；
 *    抓到不同版本（ETag／Last-Modified／長度不同）就先把 index.html 與 app.js 都更新到快取，再通知頁面
 *    顯示「系統有新版本」，使用者按重新整理即更新（一起換，不會新 index 配舊 app.js，也不會舊 app.js 配新 calc）。
 *  - 其他同源 GET：網路優先，失敗退回快取（工地無訊號也能開）。
 *  - PDF 套件 html2canvas／jsPDF（版本固定）：快取優先。Firebase／其他 CDN 不攔截。
 */
const CACHE = 'fy-app-v3';
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];
const LIB_RE = /html2canvas|jspdf/i;

// v6.0.130：計算模組清單（新增 calc 檔時一起加）。安裝時先存進快取——否則升級那次 calc 不在快取裡，之後離線開啟會缺計算模組
const CALC_FILES = ['./calc/invoice.js', './calc/payable.js', './calc/report.js', './calc/comm.js', './calc/payroll.js', './calc/lifeline.js', './calc/settle.js', './calc/route.js', './calc/todo.js', './calc/vbill.js', './calc/qdraft.js', './calc/matmove.js', './calc/bidstat.js'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CALC_FILES.map(f => c.add(new Request(f, { cache: 'no-cache' })).catch(() => {})))).catch(() => {}));
});

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
// 改版第 0 步：只有正式站本身（/ 或 /index.html）離線時可以退回快取的 index.html；beta.html／test.html 等別的頁面不行，
// 否則第一次開 test.html 剛好斷線，會拿到正式站的 index.html（沒有本機資料隔離）卻連到測試專案
function isIndexPath(url) { return /\/(index\.html)?$/.test(url.pathname); }
function isCalc(url) { return /\/calc\/[\w-]+\.js$/.test(url.pathname); }
function isAppShell(req, url) {
  return req.mode === 'navigate' || /\/index\.html$/.test(url.pathname) || /\/$/.test(url.pathname) || /\/app\.js$/.test(url.pathname) || isCalc(url);
}
// index.html 換新時，快取裡的 calc 模組也一起重新驗證（v6.0.130）
function revalidateCalc() {
  const base = self.registration ? self.registration.scope : self.location.href;
  return caches.open(CACHE).then(c => c.keys()).then(ks => {
    const urls = new Set(CALC_FILES.map(f => new URL(f, base).href));   // 清單上的一定重抓（快取裡還沒有也抓）
    ks.forEach(r => { const u = new URL(r.url); if (isCalc(u)) urls.add(u.origin + u.pathname); });
    return Promise.all([...urls].map(u => caches.match(u).then(cc => revalidate(u, cc))));
  }).catch(() => {});
}
// 快取鍵：去掉查詢字串（app.js?v=… 版本不同仍對到同一份），目錄請求視同 index.html
function shellKey(url) {
  return url.origin + url.pathname.replace(/\/$/, '/index.html');
}
function appJsKey(url) {
  return url.origin + url.pathname.replace(/\/$/, '/index.html').replace(/\/index\.html$/, '/app.js');
}
// 背景重新驗證：no-cache 一律向伺服器確認；回傳是否與快取不同
function revalidate(key, cached) {
  return fetch(new Request(key, { cache: 'no-cache' })).then(res => {
    if (!res || !res.ok) return false;
    const clone = res.clone();
    return caches.open(CACHE).then(c => c.put(key, clone)).catch(() => {}).then(() => !!cached && sig(cached) !== sig(res));
  }).catch(() => false);
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
    const isJs = /\/app\.js$/.test(url.pathname) || isCalc(url);
    const key = shellKey(url);
    e.respondWith(
      caches.match(key).then(cached => {
        const net = revalidate(key, cached).then(changed => {
          if (!changed) return;
          // index.html 變了 → app.js 一起換新再通知；app.js 變了（通常同時）→ 直接通知
          if (isJs) { notifyUpdate(); return; }
          const jk = appJsKey(url);
          return revalidateCalc().then(() => caches.match(jk)).then(jc => revalidate(jk, jc)).then(() => notifyUpdate());   // 先換 calc 再換 app.js：不會出現新 app.js 配舊 calc
        });
        if (cached) { e.waitUntil(net); return cached; }
        return fetch(e.request).then(res => {
          if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(key, clone)).catch(() => {}); }
          return res;
        }).catch(() => caches.match(key).then(m => m || ((isJs || !isIndexPath(url)) ? Response.error() : caches.match('./index.html'))));
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
          m || ((e.request.mode === 'navigate' && isIndexPath(url)) ? caches.match('./index.html') : Response.error())
        )
      )
  );
});
