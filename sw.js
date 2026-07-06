// 豐有工程管理系統 — Service Worker（選配）
// 策略：網路優先（確保拿到最新版），離線時退回快取 → 工地沒訊號也能開啟系統
const CACHE='fy-system-v1';
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./'])).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // 只接管同源頁面本身；Firebase/CDN 請求不攔截
  if(url.origin!==location.origin)return;
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request).then(m=>m||caches.match('./')))
  );
});
