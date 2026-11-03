/* 豐有工程管理系統．計算模組：業主請款（改版第 3a 步，v6.0.130）
 * 只放「純計算」：不讀畫面、不讀全域資料（P、Q、INV…），需要的值一律由參數傳入。
 * 瀏覽器：index.html 在 app.js 之前載入，掛在 window.FJC.inv；Node：require('./calc/invoice.js').inv（tests/calc.js 單獨跑）。
 * 規則：對外的函式只能「新增」，不能改既有函式的參數或意義（Service Worker 換版的空檔裡，舊 app.js 可能配到新 calc）；
 *       要改算法就開新名字，app.js 改呼叫新名字。
 */
(function (root) {
  'use strict';
  var num = function (v) { return parseFloat(v) || 0; };

  // 稅率（%）：0 是合法值（免稅案），空白／沒設＝5
  function taxR(tax) { return (tax == null || tax === '') ? 5 : num(tax); }
  function taxM(tax) { return 1 + taxR(tax) / 100; }

  // 請款單合計：本期（各列金額加總）＋稅－保留款－清潔費（含稅）
  //   rowAmts：各列本期金額（未稅，已依請款% 算好）；o.taxR 稅率%；o.retOn 有沒有勾保留款；o.retPct 保留款%；o.cleanPermil 清潔費‰
  function totals(rowAmts, o) {
    o = o || {};
    var curTotal = 0;
    (rowAmts || []).forEach(function (a) { curTotal += num(a); });
    var tax = curTotal * num(o.taxR) / 100;
    var beforeRetention = curTotal + tax;
    var retention = o.retOn ? beforeRetention * (num(o.retPct) / 100) : 0;
    var cpm = num(o.cleanPermil), clean = Math.round(curTotal * cpm / 1000), cleanGross = Math.round(clean * (1 + num(o.taxR) / 100));
    return { curTotal: curTotal, tax: tax, total: beforeRetention - retention - cleanGross, retention: retention, clean: clean, cleanGross: cleanGross, cleanPermil: cpm, baseTotal: curTotal, claimRatio: 1 };
  }

  // 第 3c 步（v6.0.136）：同 totals，另可傳 o.cleanFixed（清潔費「第一期一次扣合約 %」本期待扣的未稅金額，有值就用它、不看 ‰；最多扣到本期未稅，回傳 t.clean＝實扣）
  function totals2(rowAmts, o) {
    o = o || {};
    var t = totals(rowAmts, o), fx = Math.round(num(o.cleanFixed));
    if (!(fx > 0)) return t;
    fx = Math.min(fx, Math.max(0, Math.round(num(t.curTotal))));   // Lotion 11/03：本期不夠扣只扣到本期未稅，扣不完的順延下一期（不出現負數）
    var cg = Math.round(fx * (1 + num(o.taxR) / 100));
    t.total = t.total + t.cleanGross - cg; t.clean = fx; t.cleanGross = cg; t.cleanFixed = fx;
    return t;
  }

  // 業主保留款（含稅基礎；已退還者不計）——retPct 由呼叫端依專案設定算好傳入
  function retention(inv, tR, retPct) {
    if (!inv || !inv.retention || inv.retentionReturned) return 0;
    var base = (inv.totals && num(inv.totals.curTotal)) || 0;
    if (!base) return (inv.totals && num(inv.totals.retention)) || 0;
    return Math.round(base * (1 + num(tR) / 100) * num(retPct) / 100);
  }

  // 已收款：業主本期付款（received 欄）
  function rcvOwner(inv) { return num(inv && inv.received); }
  // 另記的保留款退還現金：{amt,date}
  function retSepCash(inv) { return (inv && inv.retentionSep && inv.retentionReturned) ? { amt: num(inv.retentionReceivedAmt), date: String(inv.retentionReturnedDate || '') } : { amt: 0, date: '' }; }
  // 業主當場扣款的退還：逐筆 {amt,date}，上限＝該期當場扣款 recvHold
  function holdRetEntries(inv) {
    if (!inv) return [];
    var cap = num(inv.recvHold);
    var L = Array.isArray(inv.holdRetLog) && inv.holdRetLog.length ? inv.holdRetLog : (num(inv.holdRetAmt) > 0 ? [{ amt: num(inv.holdRetAmt), date: String(inv.holdRetDate || '') }] : []);
    var out = [], left = cap;
    L.forEach(function (e) { var a = Math.min(Math.max(0, num(e && e.amt)), left); if (a > 0) { out.push({ amt: a, date: String((e && e.date) || '') }); left -= a; } });
    return out;
  }
  function holdRetCash(inv) { var E = holdRetEntries(inv), a = E.reduce(function (x, e) { return x + e.amt; }, 0); return { amt: a, date: E.length ? E[E.length - 1].date : '' }; }
  // 這張請款單實際收到的全部現金＝業主付款＋另記保留款退還＋當場扣款退還
  function rcv(inv) { return rcvOwner(inv) + retSepCash(inv).amt + holdRetCash(inv).amt; }
  // 某期間（'YYYY' 或 'YYYY-MM'）收到的現金：各筆依自己的日期歸屬
  function rcvIn(inv, pre) {
    if (!inv) return 0;
    var a = 0, n = pre.length;
    if (String(inv.receivedDate || '').slice(0, n) === pre) a += rcvOwner(inv);
    var c = retSepCash(inv); if (c.amt && c.date.slice(0, n) === pre) a += c.amt;
    holdRetEntries(inv).forEach(function (h) { if (h.date.slice(0, n) === pre) a += h.amt; });
    return a;
  }
  // 業主當場扣下、還沒退的保留款
  function hold(inv) { return Math.max(0, num(inv && inv.recvHold) - holdRetCash(inv).amt); }
  // 單張應收（含稅、已扣保留款、扣實收與抵銷項；已結清＝0）——offset 由呼叫端算好（含折讓）
  function ar(inv, offset) {
    if (!inv) return 0;
    if (inv.receivedConfirmed) return 0;
    var due = (inv.totals && num(inv.totals.total)) || 0;
    return Math.max(0, due - rcvOwner(inv) - num(offset));
  }
  // 本期發票應開金額（含稅）＝本期＋稅－保留款－（清潔費「直接扣除」模式才扣）
  function einvGross(inv) {
    var t = (inv && inv.totals) || {}, mode = (inv && inv.cleanMode) || 'net';
    return Math.round(num(t.curTotal) + num(t.tax) - num(t.retention) - (mode === 'net' ? num(t.cleanGross) : 0));
  }
  // 含稅金額拆未稅／稅額
  function einvSplit(gross, tR) { var g = Math.round(num(gross)), n = Math.round(g / (1 + num(tR) / 100)); return { net: n, tax: g - n, gross: g }; }

  // 收款的現金比例（其餘為票據）：空白、0、非數字＝全部現金
  function cashPct(inv) { var v = inv && inv.cashPct, n = parseFloat(v); return (v == null || v === '' || !isFinite(n) || n <= 0) ? 1 : Math.min(1, n / 100); }

  var inv = { cashPct: cashPct, taxR: taxR, taxM: taxM, totals: totals, totals2: totals2, retention: retention, rcvOwner: rcvOwner, retSepCash: retSepCash, holdRetEntries: holdRetEntries,
    holdRetCash: holdRetCash, rcv: rcv, rcvIn: rcvIn, hold: hold, ar: ar, einvGross: einvGross, einvSplit: einvSplit };
  var FJC = root.FJC || (root.FJC = {});
  FJC.inv = inv;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
