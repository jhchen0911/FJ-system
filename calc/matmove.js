// 進退料簿（v6.0.195 進退料統整表 M1）：純計算，不讀畫面、不讀全域資料。
// 一筆＝一趟車（進場／退場／轉場），items 每列＝一種料（規格、長度、支數）。
// 前端 app.js（FJC.mv）與雲端（functions，之後每日檢查）共用；對外函式只能新增、不能改既有參數或意義。
(function (root) {
  'use strict';
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function r2(v) { return Math.round(num(v) * 100) / 100; }
  // 一列料的 M 數＝長度 × 支數（片、件類沒有長度＝0）
  function itemM(it) { return r2(num(it && it.len) * num(it && it.qty)); }
  // 舊日報簽收單方向 → 進退料簿方向（以工地為主：倉庫→工地＝進場；租賃商→工地＝租料進場）
  var SLIP_DIR = { out: { dir: 'in', own: true }, back: { dir: 'out', own: true }, rentIn: { dir: 'in', own: false }, rentOut: { dir: 'out', own: false } };
  function fromSlipDir(d) { var x = SLIP_DIR[d]; return x ? { dir: x.dir, own: x.own } : { dir: '', own: null }; }
  // 同一種料的鍵：品名＋規格＋長度
  function itemKey(it) { return [String((it && it.name) || '').trim(), String((it && it.spec) || '').trim(), r2(it && it.len)].join('|'); }
  // 某案在場量（只算已確認的）：進場 +、退場 −（短少的也離場）、轉場 A 案 −／B 案 +。回傳 {鍵:{name,spec,len,qty,m}}
  function onSite(moves, qid) {
    var out = {};
    (moves || []).forEach(function (mv) {
      if (!mv || mv.st !== 'ok') return;
      var sign = 0;
      if (mv.dir === 'in' && mv.qid === qid) sign = 1;
      else if (mv.dir === 'out' && mv.qid === qid) sign = -1;
      else if (mv.dir === 'xfer') { if (mv.toQid === qid) sign = 1; else if (mv.fromQid === qid) sign = -1; }
      if (!sign) return;
      (mv.items || []).forEach(function (it) {
        var k = itemKey(it), o = out[k] || (out[k] = { name: it.name || '', spec: it.spec || '', len: r2(it.len), qty: 0, m: 0 });
        var q = num(it.qty) + (sign < 0 ? num(it.short) : 0);
        o.qty = r2(o.qty + sign * q); o.m = r2(o.qty * o.len);
      });
    });
    return out;
  }
  // 趟數：同一天同一車號算一趟；沒填車號的每筆一趟
  function trips(moves) {
    var seen = {}, n = 0;
    (moves || []).forEach(function (mv) {
      if (!mv) return; var t = String(mv.truck || '').replace(/\s/g, '').toUpperCase();
      var k = t ? (String(mv.date || '') + '|' + t) : ('#' + (mv.id || n));
      if (!seen[k]) { seen[k] = 1; n += Math.max(1, Math.round(num(mv.trips) || 1)); }
    });
    return n;
  }
  // 重量（Lotion 11/07：同車依重量分攤）：型鋼＝每 M 單位重 × M 數；副件＝每件重量 × 件數。wt[規格]={kgm} 或 {kgpc}；查不到回 null（卡片標黃）
  function itemKg(it, wt) {
    var w = (wt || {})[String((it && it.spec) || '').trim()] || (wt || {})[String((it && it.name) || '').trim()];
    if (!w) return null;
    if (num(w.kgm) > 0 && num(it.len) > 0) return r2(num(w.kgm) * itemM(it));
    if (num(w.kgpc) > 0) return r2(num(w.kgpc) * num(it.qty));
    return null;
  }
  // 依重量分攤金額（整數、加總剛好等於總額，最大餘數法）。parts=[{key,kg}]；有任一筆 kg 不是正數 → null
  function shareByKg(parts, amount) {
    var A = Math.round(num(amount)), tot = 0, bad = false;
    (parts || []).forEach(function (p) { if (!(num(p && p.kg) > 0)) bad = true; else tot += num(p.kg); });
    if (bad || !(tot > 0) || !(parts || []).length) return null;
    var res = {}, rem = [], used = 0;
    parts.forEach(function (p) { var ex = A * num(p.kg) / tot, f = Math.floor(ex); res[p.key] = (res[p.key] || 0) + f; used += f; rem.push({ k: p.key, r: ex - f }); });
    rem.sort(function (a, b) { return b.r - a.r; });
    for (var i = 0; used < A && i < rem.length; i++, used++) res[rem[i].k] += 1;
    return res;
  }
  function dayNum(iso) { var p = String(iso || '').slice(0, 10).split('-'); if (p.length !== 3) return NaN; return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  // 兩個日期差幾天（b − a）；日期不對回 0
  function days(a, b) { var d = dayNum(b) - dayNum(a); return isNaN(d) ? 0 : Math.max(0, Math.round(d)); }
  // 一段期間的租金：unit＝'M月'（每 M 每月，30 天）、'M天'、'片月'（每片／支每月）
  function rentFor(rate, unit, m, n, d) {
    rate = num(rate); d = num(d);
    if (unit === 'M天') return Math.round(rate * num(m) * d);
    if (unit === '片月') return Math.round(rate * num(n) * d / 30);
    return Math.round(rate * num(m) * d / 30);
  }
  // 閒置多付租金（Lotion 11/07 第 4 題）：拔除完成日（日報）到退場日（簽收單；還沒退＝今天）× 這批租金單價
  function idleRent(o) {
    o = o || {}; var to = o.outDate || o.today, d = days(o.pullDone, to);
    return { days: d, cost: rentFor(o.rate, o.unit, o.m, o.n, d), perDay: rentFor(o.rate, o.unit, o.m, o.n, 1) };
  }
  // ── v6.0.211 M6 運費價格表（每家運輸公司一張，Lotion 11/10 第 1 題 A）──
  // tbl＝{base:{地區:基本台元}, mult:{地區:加成倍數}, perM:[{pat:'H300',rate:30}], lenAdd:[{min:13,add:10},{min:16,add:20}], waitHr:每小時等待費}
  function S(v) { return v == null ? '' : String(v); }
  function nz(s) { return S(s).toUpperCase().replace(/[\s　×*xX\-－_]/g, ''); }
  // 工地地址／地名 → 價格表的地區（名字出現在地址裡、取最長的那個）
  function frtRegion(tbl, place, only) {
    var p = S(place), best = '', ks = only ? Object.keys((tbl && tbl[only]) || {}) : Object.keys((tbl && tbl.base) || {}).concat(Object.keys((tbl && tbl.mult) || {}));
    ks.forEach(function (k) { if (k && p.indexOf(k) >= 0 && k.length > best.length) best = k; });
    return best;
  }
  // 一種料的每 M 單價＝規格單價（pat 出現在規格／品名裡、取最長）＋長度加價（長度 ≥ min 的最大那一級）
  function frtPerM(tbl, it) {
    var t = nz(S(it && it.spec) + ' ' + S(it && it.name)), rate = 0, pl = -1, add = 0, amin = -1, L = num(it && it.len);
    ((tbl && tbl.perM) || []).forEach(function (r) { var k = nz(r && r.pat); if (k && t.indexOf(k) >= 0 && k.length > pl) { pl = k.length; rate = num(r.rate); } });
    ((tbl && tbl.lenAdd) || []).forEach(function (r) { var mn = num(r && r.min); if (mn > 0 && L >= mn && mn > amin) { amin = mn; add = num(r.add); } });
    return { rate: rate, add: add, hit: pl >= 0 };
  }
  // 一趟車的運費＝max(基本台, Σ M 數 ×（每 M 單價＋長度加價）× 地區加成) ＋ 等待小時 × 每小時等待費
  function freightTrip(tbl, trip) {
    trip = trip || {}; var region = frtRegion(tbl, trip.place), rb = frtRegion(tbl, trip.place, 'base'), rm = frtRegion(tbl, trip.place, 'mult');   // 基本台、加成各自找最長的地名（台中市中科的基本台＋台中的加成）
    var base = num(((tbl && tbl.base) || {})[rb]), mult = num(((tbl && tbl.mult) || {})[rm]) || 1;
    var lines = [], miss = [], byM = 0;
    (trip.items || []).forEach(function (it) {
      var m = num(it && it.m) || itemM(it), r = frtPerM(tbl, it);
      if (!r.hit) { miss.push(S(it && it.name) + ' ' + S(it && it.spec)); return; }
      var a = m * (r.rate + r.add) * mult; byM += a; lines.push({ name: S(it.name), spec: S(it.spec), len: num(it.len), m: r2(m), rate: r.rate, add: r.add, mult: mult, amt: Math.round(a) });
    });
    var wait = num(trip.waitH) * num(tbl && tbl.waitHr), core = Math.max(base, Math.round(byM));
    return { region: region, base: base, mult: mult, byM: Math.round(byM), useBase: base > Math.round(byM), wait: Math.round(wait), amt: Math.round(core + wait), lines: lines, miss: miss, noRegion: !region };
  }
  // 一張請款單：請款金額 vs 我們算的，差在容許範圍內（Lotion 11/10 第 3 題 A：一張單差 NT$100 以內）就不出卡
  function billDiff(billAmt, calcAmt, tol) { var d = Math.round(num(billAmt) - num(calcAmt)); return { diff: d, ok: Math.abs(d) <= (tol == null ? 100 : num(tol)) }; }
  // 租金：這段請款期間（含頭含尾）每批在場天數 × M 數 × 月租／30；批次 d＝進場、o＝退場（空白＝還在場）
  function rentPeriod(batches, from, to, rate) {
    var tot = 0, rows = [];
    (batches || []).forEach(function (b) {
      if (!b || !b.d) return; var s = b.d > from ? b.d : from, e = b.o && b.o < to ? b.o : to; if (s > e) return;
      var d = days(s, e) + 1, a = Math.round(num(rate) * num(b.m) * d / 30); tot += a; rows.push({ id: S(b.id), from: s, to: e, days: d, m: num(b.m), amt: a });
    });
    return { amt: tot, rows: rows };
  }
  var mv = { itemM: itemM, fromSlipDir: fromSlipDir, itemKey: itemKey, onSite: onSite, trips: trips, itemKg: itemKg, shareByKg: shareByKg, days: days, rentFor: rentFor, idleRent: idleRent, frtRegion: frtRegion, frtPerM: frtPerM, freightTrip: freightTrip, billDiff: billDiff, rentPeriod: rentPeriod };
  if (typeof module !== 'undefined' && module.exports) module.exports = { mv: mv };
  if (root) { root.FJC = root.FJC || {}; root.FJC.mv = mv; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
