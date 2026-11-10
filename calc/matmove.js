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
  // ── M7（v6.0.210 小批次線）：結案實績與每月閒置浪費 ──
  // 租金單價換成「每 M 每天」：rents 的 rate 單位是 M月（每 M 每月 30 天）、M天；片月沒有長度換不了 → null
  function perMDay(rate, unit) { rate = num(rate); if (!(rate > 0)) return null; if (unit === 'M天') return rate; if (unit === '片月') return null; return rate / 30; }
  // 一張租料單的實際租期：每批 M 數 × 在場天數（進場 d → 退場 o；還沒退用 asOf）；avgDays＝依 M 數加權的平均天數
  function rentActual(batches, asOf) {
    var m = 0, md = 0, open = 0;
    (batches || []).forEach(function (b) {
      if (!b || !b.d) return; var to = b.o || asOf; if (!b.o && (!asOf || String(b.d) <= String(asOf))) open++;
      if (!to || String(to) < String(b.d)) return;
      var bm = num(b.m); m += bm; md += bm * days(b.d, to);
    });
    return { m: r2(m), mDays: r2(md), avgDays: m > 0 ? Math.round(md / m) : 0, open: open };
  }
  function ymStart(ym) { return String(ym).slice(0, 7) + '-01'; }
  function ymNext(ym) { var y = +String(ym).slice(0, 4), m = +String(ym).slice(5, 7); return m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01'; }
  // 某個月的閒置天數（Lotion 11/07 第 4 題：拔除完成日 → 退場日，× 租金）：每批從「拔除完成日」與「這批進場日」較晚的那天，到「退場日（還沒退＝asOf）」，
  //   落在這個月 [1 日, 下月 1 日) 的天數。回傳 [{bid, m, days, cost}] 與合計；asOf 之後不算。
  function idleInMonth(o) {
    o = o || {}; var ms = ymStart(o.ym), me = ymNext(o.ym), out = [], tot = 0, td = 0;
    if (!o.start) return { rows: out, cost: 0, mDays: 0 };
    (o.batches || []).forEach(function (b) {
      if (!b || !b.d) return;
      var fr = b.d > o.start ? b.d : o.start, to = b.o || o.asOf; if (!to) return;
      if (o.asOf && to > o.asOf) to = o.asOf;
      var a = fr > ms ? fr : ms, z = to < me ? to : me, d = (z > a) ? days(a, z) : 0;
      if (!(d > 0)) return;
      var c = rentFor(o.rate, o.unit || 'M月', num(b.m), num(b.n), d);
      out.push({ bid: b.id || '', m: r2(b.m), days: d, cost: c }); tot += c; td += num(b.m) * d;
    });
    return { rows: out, cost: tot, mDays: r2(td) };
  }
  // 損耗：某案已確認的進退料，同一種料（品名＋規格＋長度）進場多少、短少、損壞、要修、報廢 → 損耗率＝(短少＋損壞)／進場
  function lossOf(moves, qid) {
    var S = {};
    (moves || []).forEach(function (mv) {
      if (!mv || mv.st !== 'ok') return;
      var inQ = (mv.dir === 'in' && mv.qid === qid) || (mv.dir === 'xfer' && mv.toQid === qid);
      var outQ = (mv.dir === 'out' && mv.qid === qid) || (mv.dir === 'xfer' && mv.fromQid === qid);
      if (!inQ && !outQ) return;
      (mv.items || []).forEach(function (it) {
        var k = itemKey(it), o = S[k] || (S[k] = { key: k, name: it.name || '', spec: it.spec || '', len: r2(it.len), own: mv.own, inQty: 0, outQty: 0, short: 0, dmg: 0, repair: 0, scrap: 0 });
        if (inQ) o.inQty = r2(o.inQty + num(it.qty));
        if (outQ) { o.outQty = r2(o.outQty + num(it.qty)); o.short = r2(o.short + num(it.short)); o.dmg = r2(o.dmg + num(it.dmg)); if (it.cond === 'repair') o.repair = r2(o.repair + num(it.qty)); if (it.cond === 'scrap') o.scrap = r2(o.scrap + num(it.qty)); }
      });
    });
    return Object.keys(S).sort().map(function (k) { var o = S[k]; o.rate = o.inQty > 0 ? Math.round((o.short + o.dmg) / o.inQty * 1000) / 10 : null; return o; });
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
  // ── v6.0.215 M8 租還是買（Lotion 11/10）──
  // 進料前整體評估：needs＝[{m, days}]（這案＋全公司同規格的需求：M 數 × 預估租期天數）、rateD＝每 M 每天租金、buyPerM＝每 M 買價、salvage＝殘值率（%）、store＝存放＋進出倉成本（null＝沒填）
  //   買的批量＝需求裡最大的一筆 M 數（料可以一案用完再給下一案）；買的淨成本＝買價 × 批量 ×（1 − 殘值率）＋ 存放成本
  function rentVsBuy(o) {
    o = o || {}; var rent = 0, maxM = 0;
    (o.needs || []).forEach(function (n) { var m = num(n && n.m), d = num(n && n.days); rent += m * d * num(o.rateD); if (m > maxM) maxM = m; });
    var buy = maxM * num(o.buyPerM), sv = buy * num(o.salvage) / 100, st = o.store == null || o.store === '' ? null : num(o.store);
    var net = buy - sv + (st || 0);
    return { rent: Math.round(rent), buyM: r2(maxM), buy: Math.round(buy), salvage: Math.round(sv), store: st, net: Math.round(net), suggestBuy: buy > 0 && rent >= net && net > 0 };
  }
  // 進料後累計租金提醒（Lotion 11/10 定案）：累計 ≥ 買價 60% 出卡；加上之後案子的預估租金 > 80% 而且之後還有案子要用 → 建議買料，否則持續觀察
  function buyAlert(o) {
    o = o || {}; var b = num(o.buy); if (!(b > 0)) return { show: false, ratio: 0, proj: 0, advice: '' };
    var ratio = num(o.cum) / b, proj = (num(o.cum) + num(o.future)) / b;
    return { show: ratio >= 0.6, ratio: Math.round(ratio * 1000) / 10, proj: Math.round(proj * 1000) / 10, advice: proj > 0.8 && num(o.futureN) > 0 ? '建議買料' : '持續觀察' };
  }
  // 車型建議（Lotion 11/10 第 4 題 A）：運費價格表的地區加成 ≥ 1.6 算遠 → 平板車；近的 → 吊板車
  function truckFor(mult) { var m = num(mult); return m >= 1.6 ? { type: 'flat', why: '遠（地區加成 ×' + m + '）' } : { type: 'crane', why: m > 0 ? '近（地區加成 ×' + m + '）' : '近' }; }
  // ── v6.0.216 各規格每 M 重量（kg/m）：材料買價依類別填每公斤價、系統換算每 M 買價（Lotion 11/10）──
  // 來源（標稱單位重，四捨五入到 0.1）：H 型鋼＝JIS G 3192 寬翼 H 型鋼（H300×300×10×15＝94.0、H350×350×12×19＝137、H400×400×13×21＝172 等）；
  //   鋼板樁＝JIS A 5523／A 5528 U 型鋼板樁每支單位重（II 48.0、III 60.0、IV 76.1、VL 105、IIw 61.8、IIIw 81.6、IVw 106）；
  //   鋼軌樁＝鋼軌公稱重（37 kg 軌 37.2、50 kg 軌 50.4、60 kg 軌 60.8）。實際採購以廠商過磅為準。
  var KGM = {
    H200: 49.9, H250: 72.4, H300: 94.0, H350: 137, H400: 172, H428: 283,
    II: 48.0, III: 60.0, IV: 76.1, VL: 105, IIW: 61.8, IIIW: 81.6, IVW: 106,
    '37KG': 37.2, '50KG': 50.4, '60KG': 60.8
  };
  function kgKey(spec) {
    var s = String(spec == null ? '' : spec).toUpperCase().replace(/[\s　]/g, '').replace(/^FSP-?/, '');
    var h = s.match(/^H(\d{3})/); if (h) return 'H' + h[1];
    var k = s.match(/(\d{2})KG/); if (k) return k[1] + 'KG';
    return s;
  }
  function kgPerM(spec) { var v = KGM[kgKey(spec)]; return v == null ? null : v; }
  var mv = { itemM: itemM, fromSlipDir: fromSlipDir, itemKey: itemKey, onSite: onSite, trips: trips, itemKg: itemKg, shareByKg: shareByKg, days: days, rentFor: rentFor, idleRent: idleRent, perMDay: perMDay, rentActual: rentActual, idleInMonth: idleInMonth, lossOf: lossOf, frtRegion: frtRegion, frtPerM: frtPerM, freightTrip: freightTrip, billDiff: billDiff, rentPeriod: rentPeriod, rentVsBuy: rentVsBuy, buyAlert: buyAlert, truckFor: truckFor, kgPerM: kgPerM, kgKey: kgKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = { mv: mv };
  if (root) { root.FJC = root.FJC || {}; root.FJC.mv = mv; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
