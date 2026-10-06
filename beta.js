/* ── 測試版沙盒：不上傳雲端（beta.js，defer 接在 app.js 之後）── */
(function(){
  ['_autoUpload','_immediateUpload','_pushPrivate','_pushRelayCosts','_pushRelayExpenses','fbUpload','fbUploadWithConflictCheck','_pushCloud'].forEach(function(nm){
    if(typeof window[nm]==='function'){window[nm]=function(){var cb=null;for(var i=0;i<arguments.length;i++){if(typeof arguments[i]==='function'){cb=arguments[i];break;}}if(cb){try{cb(false);}catch(e){}}return false;};}
  });
  try{document.title='β 測試版｜'+document.title;}catch(e){}
  var seeded='';try{seeded=localStorage.getItem('__seeded')||'';}catch(e){}
  var d=document.createElement('div');
  d.id='fy-beta-chip';
  d.style.cssText='position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:99998;background:#b26a00;color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:5px 10px;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;font-family:inherit';
  d.innerHTML='<span>β 測試版・資料為正式版副本・不上傳</span><button type="button" onclick="if(confirm(\'重新從正式版複製一份資料到測試版？測試版目前的輸入會被覆蓋。\'))fyBetaReseed()" style="border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;cursor:pointer;font-family:inherit">重新複製</button>';
  function mount(){document.body.appendChild(d);if(window.innerWidth<=767)d.style.bottom='calc(env(safe-area-inset-bottom,0px) + 78px)';}
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);
})();
