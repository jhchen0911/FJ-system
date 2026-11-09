/* 豐有工程管理系統．計算模組：報價得標率紀錄（v6.0.218，小批次線；7b 的後端）
 * 純計算：不讀畫面、不讀全域資料，值由參數傳入。掛在 window.FJC.bid；Node：require('./calc/bid.js').bid。
 * 對外函式只能新增，不能改既有參數或意義（換版空檔可能舊 app.js 配新 calc）。
 *
 * 一張報價的結果記在 q.bid＝{res:'won'|'lost'|'void', at, first（第一個正式版的含稅總價）, rival（對手價含稅，可空）, src, by}；
 * 成交價、讓價不存，讀的時候由 view() 算（得標＝主約合約金額，沒有合約用報價總計；沒得標＝我方最後報價）。
 * 統計 stats()：同一類工項滿 minN（預設 5）筆才給「得標率、建議目標價 ±%」；只是建議，不改任何報價。
 */
(function (root) {
  'use strict';
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var KINDS = { hpile: 'H 型鋼樁', railpile: '鋼軌樁', sheet: '鋼板樁', midpile: '中間樁', strut: '水平支撐', deck: '構台', prepile: '預壘樁', anchor: '地錨', ccp: 'CCP 固結樁', rcpile: 'RC 基樁', rope: '安全母索', other: '其他' };
  // 工項類別：看說明第一行的關鍵字（順序有差：中間樁要在 H 型鋼樁前面、各種樁要在「支撐」前面）
  var RULES = [
    ['rope', /安全母索|母索/], ['deck', /構台/], ['midpile', /中間[樁柱]/], ['sheet', /鋼板樁/], ['railpile', /鋼軌樁/], ['prepile', /預壘樁/],
    ['ccp', /CCP|固結樁/i], ['anchor', /地錨/], ['rcpile', /基樁|RC\s*樁|全套管|鑽掘樁/i], ['hpile', /H\s*型?\s*鋼\s*排?\s*樁|H\s*樁|排樁/i],
    ['strut', /水平支撐|支撐|圍令|斜撐|角撐|千斤頂/],
  ];
  function kind(desc) {
    var d = String(desc || '').split('\n')[0];
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(d)) return RULES[i][0];
    return 'other';
  }
  // 這張報價有哪些類別（只算一般工項：段落、備用單價、減項不算），依未稅金額由大到小
  function kindsOf(items) {
    var m = {};
    (items || []).forEach(function (it) {
      if (!it || it.sec || it.spare) return;
      var a = num(it.qty) * num(it.price); if (!(a > 0)) return;
      var k = kind(it.desc); m[k] = (m[k] || 0) + a;
    });
    return Object.keys(m).map(function (k) { return { kind: k, amt: Math.round(m[k]) }; }).sort(function (a, b) { return b.amt - a.amt || (a.kind < b.kind ? -1 : 1); });
  }
  // 第一個正式版的含稅總價：歷史版次裡版次最小的正式版；沒有正式版用最舊的一筆；都沒有用現在的總價
  function firstOf(hist, curTotal) {
    var H = (hist || []).filter(function (h) { return h && h.snapshot && h.snapshot.t && num(h.snapshot.t.total) > 0; });
    var F = H.filter(function (h) { return h.formal; }).sort(function (a, b) { return (num(a.ver) - num(b.ver)) || (num(a.savedAt) - num(b.savedAt)); });
    if (F.length) return Math.round(num(F[0].snapshot.t.total));
    if (H.length) { H.sort(function (a, b) { return num(a.savedAt) - num(b.savedAt); }); return Math.round(num(H[0].snapshot.t.total)); }
    return Math.round(num(curTotal));
  }
  // 報價目前的結果（跟 q.bid 比，決定要不要記一筆新的）
  function resOf(q) { if (!q) return ''; if (q.awarded) return 'won'; if (q.bidStatus === 'lost') return 'lost'; if (q.bidStatus === 'void') return 'void'; return ''; }
  // 單張報價的結果（讀的時候算）：ctx＝{ctAmt：主約合約金額含稅（沒有給 0）}
  function view(q, ctx) {
    var b = q && q.bid; if (!b || !b.res) return null;
    ctx = ctx || {};
    var cur = Math.round(num(q.t && q.t.total)), ct = Math.round(num(ctx.ctAmt));
    var price = b.res === 'won' ? (ct > 0 ? ct : cur) : (b.res === 'lost' ? cur : null);
    var first = num(b.first) > 0 ? Math.round(num(b.first)) : null;
    var conc = (b.res === 'won' && first && price != null) ? first - price : null;
    var rival = num(b.rival) > 0 ? Math.round(num(b.rival)) : (b.res === 'lost' && num(q.lostPrice) > 0 ? Math.round(num(q.lostPrice)) : null);
    return {
      res: b.res, at: num(b.at), first: first, price: price, conc: conc, concPct: (conc != null && first) ? r1(conc / first * 100) : null,
      rival: rival, gapPct: (b.res === 'lost' && rival && price) ? r1((price - rival) / rival * 100) : null,
    };
  }
  // 建議目標價調整（%）：tune＝{lo:40, hi:60, maxDown:10, maxUp:5}；得標率低於 lo 往下、高於 hi 往上，中間不動；以 0.5% 為單位
  function suggest(st, tune) {
    if (!st || !st.ready || st.rate == null) return null;
    var t = Object.assign({ lo: 40, hi: 60, maxDown: 10, maxUp: 5 }, tune || {}), v = 0;
    if (st.rate < t.lo) v = -Math.min(t.maxDown, (st.gapPct != null && st.gapPct > 0) ? st.gapPct / 2 : (t.lo - st.rate) / 10);
    else if (st.rate > t.hi) v = Math.min(t.maxUp, (st.rate - t.hi) / 10);
    v = Math.round(v * 2) / 2;
    return v === 0 ? 0 : v;   // 不要 -0
  }
  // 統計：rows＝[{kinds:['hpile',…], v:view(q)}]；流標（void）不算；opt＝{minN:5, tune}
  function stats(rows, opt) {
    opt = opt || {}; var minN = opt.minN || 5, S = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.v || (r.v.res !== 'won' && r.v.res !== 'lost')) return;
      (r.kinds || []).forEach(function (k) {
        var s = S[k] || (S[k] = { kind: k, label: KINDS[k] || k, n: 0, won: 0, lost: 0, cs: [], gs: [] });
        s.n++; if (r.v.res === 'won') { s.won++; if (r.v.concPct != null) s.cs.push(r.v.concPct); } else { s.lost++; if (r.v.gapPct != null) s.gs.push(r.v.gapPct); }
      });
    });
    var avg = function (a) { return a.length ? r1(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; };
    return Object.keys(S).map(function (k) {
      var s = S[k], o = { kind: k, label: s.label, n: s.n, won: s.won, lost: s.lost, rate: s.n ? r1(s.won / s.n * 100) : null, concPct: avg(s.cs), nConc: s.cs.length, gapPct: avg(s.gs), nGap: s.gs.length, ready: s.n >= minN };
      o.adjPct = suggest(o, opt.tune); return o;
    }).sort(function (a, b) { return b.n - a.n || (a.kind < b.kind ? -1 : 1); });
  }
  // 給報價線的統計（只放數字，不放案名、業主、金額）
  function exportRows(st) {
    return (st || []).map(function (s) { return { kind: s.kind, label: s.label, n: s.n, won: s.won, lost: s.lost, rate: s.rate, concPct: s.concPct, gapPct: s.gapPct, ready: s.ready, adjPct: s.adjPct }; });
  }
  var bid = { KINDS: KINDS, kind: kind, kindsOf: kindsOf, firstOf: firstOf, resOf: resOf, view: view, suggest: suggest, stats: stats, exportRows: exportRows };
  var FJC = root.FJC || (root.FJC = {});
  FJC.bid = bid;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
