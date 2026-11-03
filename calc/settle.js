/* 豐有工程管理系統．計算模組：完工結算差異表（改版第 3c 步，v6.0.136；畫面在第 7c 步接上專案「完工結算」）
 * 營造廠結算書的數量 vs 豐有累計請款／日報／已確認追加，逐工項列差多少、金額影響與可能原因。純計算：掛在 window.FJC.settle；Node：require('./calc/settle.js').settle
 * 規則同其他 calc：對外函式只能新增，不能改既有參數或意義。
 *
 *   diff(rows, o)
 *     rows：[{ idx, desc, unit, price 未稅單價, stmtQty 結算書數量, billedQty 豐有累計請款數量, dailyQty 日報累計數量, addQty 已確認追加數量 }]
 *     o（可省略）：{ clean：{ pct 一次扣合約 %, took 第一期已扣（未稅）, finalNet 結算後合約未稅 }, retention 保留款合計 }
 *   回傳：{ rows：[…原欄位, diff（結算書−豐有累計請款）, amt（差×單價，未稅）, reasons[] ], sumAmt, nDiff, clean, retention }
 *   可能原因只是提示（Lotion 確認或議價）：結算書比請款少＝業主扣減或少算；結算書比請款多＝我方漏請；日報≠請款＝請款沒跟上日報；追加沒進結算書。
 */
(function (root) {
  'use strict';
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var EPS = 1e-6;
  var r2 = function (x) { return Math.round(x * 100) / 100; };

  function diff(rows, o) {
    o = o || {};
    var out = [], sumAmt = 0, nDiff = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var st = num(r.stmtQty), bi = num(r.billedQty), da = num(r.dailyQty), ad = num(r.addQty), pr = num(r.price);
      var d = r2(st - bi), amt = Math.round(d * pr), why = [];
      if (d < -EPS) why.push('業主扣減或少算，確認是否議價');
      if (d > EPS) why.push('我方漏請，下期補請');
      if (r.dailyQty != null && r.dailyQty !== '' && Math.abs(da - bi) > EPS) why.push('請款沒跟上日報（日報 ' + r2(da) + '、請款 ' + r2(bi) + '）');
      if (ad > EPS && d < -EPS && -d >= ad - EPS) why.push('追加未納入結算書');
      if (Math.abs(d) > EPS) { nDiff++; sumAmt += amt; }
      out.push({ idx: r.idx, desc: r.desc || '', unit: r.unit || '', price: pr, stmtQty: st, billedQty: bi, dailyQty: r.dailyQty == null || r.dailyQty === '' ? null : da, addQty: ad, diff: d, amt: amt, reasons: why });
    });
    var clean = null;
    if (o.clean && num(o.clean.pct) > 0) {
      var should = Math.round(num(o.clean.finalNet) * num(o.clean.pct) / 100), took = Math.round(num(o.clean.took));
      clean = { pct: num(o.clean.pct), finalNet: Math.round(num(o.clean.finalNet)), should: should, took: took, diff: should - took,
        note: should === took ? '清潔費與結算金額相符' : ('清潔費依結算金額應為 ' + should + '，第一期已扣 ' + took + '，差 ' + (should - took)) };
    }
    return { rows: out, sumAmt: sumAmt, nDiff: nDiff, clean: clean, retention: Math.round(num(o.retention)) };
  }

  var settle = { diff: diff };
  var FJC = root.FJC || (root.FJC = {});
  FJC.settle = settle;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
