/* ── 測試版沙盒：不上傳雲端（beta.js，defer 接在 app.js 之後）── */
(function(){
  ['_autoUpload','_immediateUpload','_pushPrivate','_pushRelayCosts','_pushRelayExpenses','fbUpload','fbUploadWithConflictCheck','_pushCloud','_tombReqPush','_tombReqPull','_wkSensPush','_wkSensPull','_bankMigrate','_bankCompanySave','_bankVendorSave','_syncAccessLists'].forEach(function(nm){
    if(typeof window[nm]==='function'){window[nm]=function(){var cb=null;for(var i=0;i<arguments.length;i++){if(typeof arguments[i]==='function'){cb=arguments[i];break;}}if(cb){try{cb(false);}catch(e){}}return false;};}
  });
  // 改版第 0 步（健檢 3 🔴3）：Firebase SDK 層一律不寫——資料庫 set／update／push(值)／remove／transaction、Storage 上傳／刪除，
  // 上面那串函式以外、日後新增的寫入路徑也寫不出去（beta 連的是測試專案 fj-system-test，雙重保險）
  try{
    var no=function(){var e=new Error('β 測試版不寫入雲端');window.__fyBetaBlocked=(window.__fyBetaBlocked||0)+1;for(var i=0;i<arguments.length;i++){if(typeof arguments[i]==='function'){try{arguments[i](e);}catch(x){}}}return Promise.reject(e);};
    var R=window.firebase&&firebase.database&&firebase.database.Reference&&firebase.database.Reference.prototype;
    if(R){['set','update','remove','setWithPriority','setPriority','transaction'].forEach(function(m){if(R[m])R[m]=no;});
      var p0=R.push;if(p0)R.push=function(v){if(arguments.length&&v!==undefined)return no.apply(this,arguments);return p0.apply(this,arguments);};}
    var SR=window.firebase&&firebase.storage&&firebase.storage.Reference&&firebase.storage.Reference.prototype;
    // 上傳呼叫端會用 task.on('state_changed',進度,錯誤) 與 task.snapshot.ref → 回一個假的上傳工作，非同步回報錯誤（審查修正）
    var task=function(){var e=new Error('β 測試版不上傳檔案');window.__fyBetaBlocked=(window.__fyBetaBlocked||0)+1;var p=Promise.reject(e);p.catch(function(){});
      var t={on:function(ev,a,b){var cb=typeof b==='function'?b:(a&&typeof a.error==='function'?a.error.bind(a):null);setTimeout(function(){if(cb)try{cb(e);}catch(x){}},0);return function(){};},
        then:function(f,r){return p.then(f,r);},catch:function(r){return p.catch(r);},cancel:function(){return false;},pause:function(){return false;},resume:function(){return false;},
        snapshot:{bytesTransferred:0,totalBytes:0,state:'error',ref:{getDownloadURL:function(){return Promise.reject(e);}}}};return t;};
    if(SR){['put','putString'].forEach(function(m){if(SR[m])SR[m]=task;});['delete','updateMetadata'].forEach(function(m){if(SR[m])SR[m]=no;});}
  }catch(e){}
  try{document.title='β 測試版｜'+document.title;}catch(e){}
  var seeded='';try{seeded=localStorage.getItem('__seeded')||'';}catch(e){}
  var d=document.createElement('div');
  d.id='fy-beta-chip';
  d.style.cssText='position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:99998;background:#b26a00;color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:5px 10px;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;font-family:inherit';
  d.innerHTML='<span>β 測試版・連測試專案・不上傳</span><button type="button" onclick="if(confirm(\'重新從正式版複製一份資料到測試版？測試版目前的輸入會被覆蓋。\'))fyBetaReseed()" style="border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;cursor:pointer;font-family:inherit">重新複製</button>';
  function mount(){document.body.appendChild(d);if(window.innerWidth<=767)d.style.bottom='calc(env(safe-area-inset-bottom,0px) + 78px)';}
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);
})();
