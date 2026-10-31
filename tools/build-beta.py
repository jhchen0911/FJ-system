#!/usr/bin/env python3
# 由 index.html 產生 beta.html（＋ beta.js）：
#  ‧ localStorage 鍵全部改走 beta: 前綴（第一次開啟時從正式版複製一份），正式資料絕不被改到
#  ‧ 所有上傳雲端的函式改為空操作（可登入、可拉雲端資料，但不會推回去）
#  ‧ 畫面左下角標示「測試版」，可一鍵重新從正式版複製資料
#  ‧ v6.0.34 起主程式在 app.js（defer）：沙盒尾段改成 beta.js，以 defer 接在 app.js 之後載入，
#    確保覆寫上傳函式時主程式已經定義（寫在 index 內的行內 script 會先於 defer 執行，蓋不到）
import sys,io,re
src=io.open(sys.argv[1],encoding='utf-8').read()
out=sys.argv[2]
shim_head = r'''<script>
/* ── 測試版沙盒：資料隔離 ── */
(function(){
  var P='beta:',S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem,k=S.key;
  function m(key){return (typeof key==='string'&&/^fy/.test(key))?P+key:key;}
  S.getItem=function(key){return g.call(this,m(key));};
  S.setItem=function(key,v){return s.call(this,m(key),v);};
  S.removeItem=function(key){return r.call(this,m(key));};
  window.FY_BETA=true;
  window.fyBetaReseed=function(){
    try{var del=[];for(var i=0;i<localStorage.length;i++){var kk=k.call(localStorage,i);if(kk.indexOf(P)===0)del.push(kk);}del.forEach(function(kk){r.call(localStorage,kk);});
      for(var j=0;j<localStorage.length;j++){var k2=k.call(localStorage,j);if(/^fy/.test(k2))s.call(localStorage,P+k2,g.call(localStorage,k2));}
      s.call(localStorage,P+'__seeded',String(Date.now()));}catch(e){}
    location.reload();
  };
  try{
    if(!g.call(localStorage,P+'__seeded')){
      for(var i=0;i<localStorage.length;i++){var kk=k.call(localStorage,i);if(/^fy/.test(kk))s.call(localStorage,P+kk,g.call(localStorage,kk));}
      s.call(localStorage,P+'__seeded',String(Date.now()));
    }
  }catch(e){}
})();
</script>
'''
shim_tail = r'''/* ── 測試版沙盒：不上傳雲端（beta.js，defer 接在 app.js 之後）── */
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
'''
import os
# 改版第 0 步：第二個參數檔名是 test*.html → 產生「測試站」test.html：連測試專案 fj-system-test、可以寫入（給 Lotion 在手機上測試雲端流程），
#   localStorage 走 test: 前綴、不從正式版複製（同網域，絕不碰正式站本機資料），不載 beta.js；app.js 依網址判斷連測試專案並顯示紫色「測試環境」標示
if os.path.basename(out).lower().startswith('test'):
    test_head = r'''<script>
/* ── 測試站：本機資料隔離（test: 前綴、從空白開始；雲端連測試專案 fj-system-test，見 app.js _fyEnvOf） ── */
(function(){
  var P='test:',S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem;
  function m(key){return (typeof key==='string'&&/^fy/.test(key))?P+key:key;}
  S.getItem=function(key){return g.call(this,m(key));};
  S.setItem=function(key,v){return s.call(this,m(key),v);};
  S.removeItem=function(key){return r.call(this,m(key));};
  window.FY_TESTSITE=true;
})();
</script>
'''
    i=src.index('</head>');src=src[:i]+test_head+src[i:]
    src=src.replace('<title>','<title>測試站 ',1)
    # 測試站不帶正式站的公司資料預設值（負責人姓名等），一律換假名（Lotion-HQ 10/23 真實案名掃描）
    src,nn=re.subn(r'(<input id="pb" value=")[^"]*(")',r'\1測試負責人\2',src)
    if nn!=1: raise SystemExit('test.html：找不到負責人欄位 id="pb"，請檢查 index.html')
    io.open(out,'w',encoding='utf-8').write(src)
    print('test.html written',len(src))
    raise SystemExit(0)
i=src.index('</head>');src=src[:i]+shim_head+src[i:]
m=re.search(r'<script src="app\.js\?v=([^"]+)" defer></script>',src)
if not m: raise SystemExit('找不到 app.js 載入標籤')
betajs=os.path.join(os.path.dirname(os.path.abspath(out)),'beta.js')
src=src[:m.end()]+'<script src="beta.js?v='+m.group(1)+'" defer></script>'+src[m.end():]
src=src.replace('<title>','<title>β ',1)
io.open(out,'w',encoding='utf-8').write(src)
io.open(betajs,'w',encoding='utf-8').write(shim_tail)
print('beta.html written',len(src),'beta.js',len(shim_tail))
