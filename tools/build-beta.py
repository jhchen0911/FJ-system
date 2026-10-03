#!/usr/bin/env python3
# 由 index.html（redesign-v6）產生 beta.html：
#  ‧ localStorage 鍵全部改走 beta: 前綴（第一次開啟時從正式版複製一份），正式資料絕不被改到
#  ‧ 所有上傳雲端的函式改為空操作（可登入、可拉雲端資料，但不會推回去）
#  ‧ 畫面左下角標示「測試版」，可一鍵重新從正式版複製資料
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
shim_tail = r'''<script>
/* ── 測試版沙盒：不上傳雲端 ── */
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
</script>
'''
i=src.index('</head>');src=src[:i]+shim_head+src[i:]
j=src.rindex('</body>');src=src[:j]+shim_tail+src[j:]
src=src.replace('<title>','<title>β ',1)
io.open(out,'w',encoding='utf-8').write(src)
print('beta.html written',len(src))
