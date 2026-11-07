/* AI 改單草稿的純計算（v6.0.190 從 app.js 搬出來，前端 fyQuoteChange／_qchgOpen 與雲端 fyDraft 共用同一套對位與試算）
 * 不讀畫面、不讀全域資料。掛在 window.FJC.qd；Node：require('./calc/qdraft.js').qd
 *   plan(q, ops, fmt)  把動作套到報價複本：{items, rmk, rows:[{act,ok,why,before,after,d}], bad}
 *   clean(ops)         只留白名單欄位
 *   sub(items)／totals(items, taxR)  未稅小計（不含段落列、備用單價）／含稅（稅額四捨五入到元，同 calcT）
 *   find／key／num／numOk／has、F（可改欄位）、RMK（可改的備註欄）、MAX（動作上限）
 */
(function (root) {
  'use strict';
  function _fmt0(n) { n = Math.round((+n || 0) * 100) / 100; return n.toLocaleString('en-US'); }
var _QCHG_F={desc:1,unit:1,qty:1,price:1,note:1,estCost:1};   // estCost：v6.0.196 成本單價（Lotion 11/07 開放；只有管理員確認後才生效）
var _QCHG_RMK={load:1,walk:1,tech:1,bh:1,br:1,bs:1,bb:1,c2:1,c3:1,ir:1,mob:1,minQty:1,spareTxt:1};   // spareTxt：v6.0.165 備用單價那一條的單張文字（上限 300）
var _QCHG_MAX=60;
function _qchgHas(o,k){return Object.prototype.hasOwnProperty.call(o,k);}   // 審查：不讓 constructor／toString 這類繼承來的名字過白名單
function _qchgNumOk(n,lim){return n!=null&&Math.abs(n)<=lim;}
function _qchgKey(it){return String((it&&it.desc)||'').split('\n')[0].trim();}
function _qchgNum(v){if(v===''||v==null)return null;var n=parseFloat(v);return isFinite(n)?n:null;}
// 找列：給 idx 就要 idx 那列的說明第一行等於 match（有給 match 時）；只給 match 就要唯一一列相符
function _qchgFind(its,ref){
  ref=ref||{};var m=ref.match!=null?String(ref.match).trim():null;
  if(ref.idx!=null&&ref.idx!==''){var i=parseInt(ref.idx,10),it=its[i];return (it&&!it.sec&&(m==null||_qchgKey(it)===m))?i:-1;}
  if(m){var hits=[];its.forEach(function(it,i){if(it&&!it.sec&&_qchgKey(it)===m)hits.push(i);});return hits.length===1?hits[0]:-1;}
  return -1;
}
function _qchgSub(its){return (its||[]).reduce(function(a,it){return (!it||it.sec||!!(it&&it.spare))?a:a+(parseFloat(it.qty)||0)*(parseFloat(it.price)||0);},0);}
function _qchgRowTxt(it,F){F=F||_fmt0;if(!it)return '';return _qchgKey(it)+'　'+(it.qty!=null?it.qty:'')+' '+(it.unit||'')+' × '+F(parseFloat(it.price)||0)+'＝'+F((parseFloat(it.qty)||0)*(parseFloat(it.price)||0))+(it.note?('（'+it.note+'）'):'');}
// 把動作套到複本：{items, rmk, rows:[{act,ok,why,before,after,d}], bad}
// opts（v6.0.196，選填）：{rmkBase: 這張報價用的條款範本全文}，rmkFix 改固定條款要用
function _qchgStrip(line){return String(line||'').replace(/^\s*\d+\s*\.(?!\d)\s*/,'').trim();}
function _qchgPlan(q,ops,F,opts){F=F||_fmt0;opts=opts||{};
  var src=(q&&q.items)||[],its=JSON.parse(JSON.stringify(src)),rmk=JSON.parse(JSON.stringify((q&&q.rmk)||{}));if(!Array.isArray(rmk.extra))rmk.extra=[];
  var ex0=rmk.extra.slice(),ex=ex0.map(function(t,n){return {t:t,n:n,del:0};}),seenEx={},rows=[],bad=0;   // 審查：自訂條款用位置改，不用文字找（兩條一樣時不會改錯）
  var no=function(act,why){rows.push({act:act,ok:false,why:why});bad++;};
  if(!Array.isArray(ops)||!ops.length){no('—','沒有任何動作');return {items:its,rmk:rmk,rows:rows,bad:bad};}
  if(ops.length>_QCHG_MAX){no('—','動作太多（上限 '+_QCHG_MAX+'）');return {items:its,rmk:rmk,rows:rows,bad:bad};}
  var mkItem=function(s){s=s||{};var o={desc:String(s.desc||'').slice(0,500),unit:String(s.unit||'').slice(0,20),qty:_qchgNum(s.qty),price:_qchgNum(s.price),note:String(s.note||'').slice(0,200),sec:false};var ec=_qchgNum(s.estCost);if(ec!=null)o.estCost=ec;return o;};
  // 先把所有對位解析到「原本那一列的物件」，再改／刪／加，列號不會互相影響
  var dels=[],adds=[],seen={};
  ops.forEach(function(op){
    op=op&&typeof op==='object'?op:{};var t=String(op.op||'');
    if(t==='add'){
      var ni=mkItem(op.item);
      if(!ni.desc.trim()){no('新增','沒有說明');return;}
      if(!(ni.qty>0)||!_qchgNumOk(ni.qty,1e7)){no('新增「'+ni.desc.slice(0,30)+'」','數量要大於 0（而且合理）');return;}
      if(!_qchgNumOk(ni.price,1e9)){no('新增「'+ni.desc.slice(0,30)+'」','單價不是數字或太大');return;}
      if(ni.estCost!=null&&(!_qchgNumOk(ni.estCost,1e9)||ni.estCost<0)){no('新增「'+ni.desc.slice(0,30)+'」','成本單價不是數字、是負的或太大');return;}
      var after=null;if(op.after){var ai=_qchgFind(src,op.after);if(ai<0){no('新增「'+ni.desc.slice(0,30)+'」','找不到要接在後面的那一列（'+String(op.after.match||op.after.idx)+'）');return;}after=its[ai];}
      adds.push({it:ni,after:after});var ra={act:'新增',ok:true,before:'',after:_qchgRowTxt(ni,F)+(ni.price<0?'　【減項】':''),d:ni.qty*ni.price};if(ni.estCost!=null)ra.cost={b:null,a:ni.estCost,price:ni.price};rows.push(ra);
    }else if(t==='set'||t==='del'){
      var i=_qchgFind(src,op),lbl=(t==='set'?'修改':'刪除')+'第 '+(op.idx!=null?(+op.idx+1):'?')+' 列'+(op.match?('「'+String(op.match).slice(0,30)+'」'):'');
      if(i<0){no(lbl,'對不上（報價可能被改過，這一列的說明不一樣或找不到）');return;}
      if(seen[i]){no(lbl,'同一列有兩個動作');return;}seen[i]=1;
      var o=its[i],before=_qchgRowTxt(o,F),a0=(parseFloat(o.qty)||0)*(parseFloat(o.price)||0);
      if(t==='del'){dels.push(o);rows.push({act:lbl,ok:true,before:before,after:'（刪除）',d:-a0});return;}
      var f=op.fields&&typeof op.fields==='object'?op.fields:{},ks=Object.keys(f).filter(function(k){return _qchgHas(_QCHG_F,k);});
      if(!ks.length){no(lbl,'沒有要改的欄位');return;}
      var nx=JSON.parse(JSON.stringify(o)),why='';
      ks.forEach(function(k){if(k==='estCost'){if(f[k]===''||f[k]==null){delete nx.estCost;return;}var c0=_qchgNum(f[k]);if(!_qchgNumOk(c0,1e9)||c0<0)why=why||'成本單價不是數字、是負的或太大';else nx.estCost=c0;return;}if(k==='qty'||k==='price'){var n=_qchgNum(f[k]);if(!_qchgNumOk(n,k==='qty'?1e7:1e9))why=why||(k==='qty'?'數量':'單價')+'不是數字或太大';else nx[k]=n;}else nx[k]=String(f[k]==null?'':f[k]).slice(0,k==='desc'?500:k==='unit'?20:200);});
      if(!why&&!String(nx.desc||'').trim())why='說明不能空白';
      if(!why&&!((parseFloat(nx.qty)||0)>0)&&(parseFloat(nx.price)||0)<0)why='減項列（負數單價）的數量要大於 0';
      if(!why&&(parseFloat(nx.qty)||0)<0)why='數量不可為負數';
      if(why){no(lbl,why);return;}
      var cb=o.estCost==null?null:+o.estCost;
      if(!('estCost' in nx))delete o.estCost;Object.assign(o,nx);var rs={act:lbl,ok:true,before:before,after:_qchgRowTxt(o,F),d:(parseFloat(o.qty)||0)*(parseFloat(o.price)||0)-a0};
      if(ks.indexOf('estCost')>=0)rs.cost={b:cb,a:o.estCost==null?null:+o.estCost,price:parseFloat(o.price)||0};   // v6.0.196 畫面另外顯示成本改前→改後與改後毛利
      rows.push(rs);
    }else if(t==='rmk'){
      var k=String(op.key||'');if(!_qchgHas(_QCHG_RMK,k)){no('備註','不認得的欄位 '+k.slice(0,20));return;}
      var v=String(op.value==null?'':op.value).slice(0,k==='spareTxt'?300:60);rows.push({act:'備註欄位 '+k,ok:true,before:String(rmk[k]||'（空白）'),after:v||'（清空）',d:0});rmk[k]=v;
    }else if(t==='rmkAdd'){
      var tx=String(op.text||'').trim().slice(0,300);if(!tx){no('新增條款','沒有內容');return;}
      ex.push({t:tx,n:-1,del:0});rows.push({act:'新增自訂條款',ok:true,before:'',after:tx,d:0});
    }else if(t==='rmkSet'||t==='rmkDel'){
      var n=parseInt(op.n,10),cur=ex0[n],lb=(t==='rmkSet'?'修改':'刪除')+'自訂條款第 '+(n+1)+' 條';
      if(cur==null||(op.match!=null&&String(cur).trim().indexOf(String(op.match).trim())!==0)){no(lb,'對不上（條款內容不一樣或沒有這一條）');return;}
      if(seenEx[n]){no(lb,'同一條有兩個動作');return;}seenEx[n]=1;
      if(t==='rmkDel'){ex[n].del=1;rows.push({act:lb,ok:true,before:cur,after:'（刪除）',d:0});return;}
      var tx2=String(op.text||'').trim().slice(0,300);if(!tx2){no(lb,'沒有內容（要刪請用刪除）');return;}
      ex[n].t=tx2;rows.push({act:lb,ok:true,before:cur,after:tx2,d:0,txt:1});
    }else if(t==='rmkFix'){   // v6.0.196：改範本固定條款的字（只改這張報價，存在 rmk.ov['L'+範本第幾行]＝{from 原文, to 新文}；key 用 L 開頭，免得 Firebase 把數字 key 存成陣列；text 空白＝回復範本）
      var base=String(opts.rmkBase||''),mt=String(op.match||'').trim(),L=base.split('\n'),hits=[];
      if(!base){no('改固定條款','沒有條款範本，不能改');return;}
      if(!mt){no('改固定條款','要給 match（原本條文，不含編號）');return;}
      if(!rmk.ov||typeof rmk.ov!=='object'||Array.isArray(rmk.ov))rmk.ov={};
      L.forEach(function(line,li){if(line.indexOf('【')>=0)return;var st=_qchgStrip(line),ov=rmk.ov['L'+li];if(!st)return;if(st===mt||(ov&&ov.from===st&&String(ov.to||'').trim()===mt))hits.push(li);});
      var lb2='改固定條款「'+mt.slice(0,20)+'」';
      if(hits.length!==1){no(lb2,hits.length?'有 '+hits.length+' 條一樣，對不出是哪一條':'範本裡找不到這一條（要給原本的條文，不含編號；有填數字的條款不能用這個改）');return;}
      var li=hits[0],K='L'+li,orig=_qchgStrip(L[li]),now0=(rmk.ov[K]&&rmk.ov[K].from===orig)?String(rmk.ov[K].to):orig,tx3=String(op.text==null?'':op.text).trim().slice(0,300);
      if(seenEx['f'+li]){no(lb2,'同一條有兩個動作');return;}seenEx['f'+li]=1;
      if(!tx3||tx3===orig){delete rmk.ov[K];rows.push({act:lb2+'（回復範本）',ok:true,before:now0,after:orig,d:0,txt:1});return;}
      rmk.ov[K]={from:orig,to:tx3};rows.push({act:lb2,ok:true,before:now0,after:tx3,d:0,txt:1});
    }else no('—','不認得的動作 '+t.slice(0,20));
  });
  var lastIns=new Map();   // 審查：同一列後面加好幾列，照動作的順序排
  adds.forEach(function(a){var ref=a.after?(lastIns.get(a.after)||a.after):null,p=ref?its.indexOf(ref):-1;if(p<0)its.push(a.it);else its.splice(p+1,0,a.it);if(a.after)lastIns.set(a.after,a.it);});
  its=its.filter(function(it){return dels.indexOf(it)<0;});
  rmk.extra=ex.filter(function(x){return !x.del;}).map(function(x){return x.t;});
  return {items:its,rmk:rmk,rows:rows,bad:bad};
}
// 送出前只留白名單欄位（審查：不把多餘或很長的欄位送上雲端）
function _qchgClean(ops){
  var S=function(v,n){return String(v==null?'':v).slice(0,n);},N=function(v){var x=_qchgNum(v);return x==null?null:x;},ref=function(r){if(!r||typeof r!=='object')return null;var o={};if(r.idx!=null&&r.idx!=='')o.idx=parseInt(r.idx,10);if(r.match!=null)o.match=S(r.match,500);return o;};
  return (ops||[]).slice(0,_QCHG_MAX).map(function(op){
    op=op&&typeof op==='object'?op:{};var t=S(op.op,10),o={op:t};
    if(t==='add'){var it=op.item||{};o.item={desc:S(it.desc,500),unit:S(it.unit,20),qty:N(it.qty),price:N(it.price),note:S(it.note,200)};if(N(it.estCost)!=null)o.item.estCost=N(it.estCost);var a=ref(op.after);if(a)o.after=a;}
    else if(t==='set'||t==='del'){var r=ref(op)||{};if(r.idx!=null)o.idx=r.idx;if(r.match!=null)o.match=r.match;if(t==='set'){o.fields={};Object.keys(op.fields||{}).forEach(function(k){if(_qchgHas(_QCHG_F,k))o.fields[k]=(k==='qty'||k==='price')?N(op.fields[k]):k==='estCost'?((op.fields[k]===''||op.fields[k]==null)?null:(N(op.fields[k])==null?S(op.fields[k],40):N(op.fields[k]))):S(op.fields[k],500);});}}
    else if(t==='rmk'){o.key=S(op.key,20);o.value=S(op.value,String(op.key)==='spareTxt'?300:60);}
    else if(t==='rmkAdd'){o.text=S(op.text,300);}
    else if(t==='rmkSet'||t==='rmkDel'){o.n=parseInt(op.n,10);if(op.match!=null)o.match=S(op.match,300);if(t==='rmkSet')o.text=S(op.text,300);}
    else if(t==='rmkFix'){o.match=S(op.match,300);o.text=S(op.text,300);}
    return o;
  });
}
  function totals(its, taxR) { var sub = _qchgSub(its), tr = taxR == null ? 5 : (+taxR || 0), tax = Math.round(sub * tr / 100); return { sub: sub, tax: tax, total: sub + tax }; }
  // 同一件草稿的鍵（v6.0.189 取代舊草稿用；前端 _draftKey 與雲端 fyDraft 共用）：同送件人＋同種＋同報價（新報價用報價編號；補登再分版次）
  var SUP_T = { quote: 1, qchg: 1, bid: 1, qverfix: 1 };
  function draftKey(d) {
    if (!d || !SUP_T[d.type]) return ''; var pl = (d.payload && typeof d.payload === 'object') ? d.payload : {}, S = function (v) { return v == null ? '' : String(v); };
    var q = S(pl.qid || pl.base).slice(0, 80); if (!q && d.type === 'quote') { var c = S(pl.fields && pl.fields.code).trim(); if (c) q = 'code:' + c.slice(0, 60); }
    if (q && d.type === 'qverfix') q += '|v' + (parseInt(pl.ver, 10) || 0);
    return q ? (d.type + '|' + S(d.by).toLowerCase() + '|' + q) : '';
  }
  var qd = { F: _QCHG_F, RMK: _QCHG_RMK, MAX: _QCHG_MAX, has: _qchgHas, numOk: _qchgNumOk, key: _qchgKey, num: _qchgNum, find: _qchgFind, sub: _qchgSub, rowTxt: _qchgRowTxt, plan: _qchgPlan, strip: _qchgStrip, clean: _qchgClean, totals: totals, SUP_T: SUP_T, draftKey: draftKey };
  var FJC = root.FJC || (root.FJC = {});
  FJC.qd = qd;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
