/* 豐有工程管理系統．計算模組：應付與分包計價（改版第 3a-2 步，v6.0.131）
 * 只放純計算：不讀畫面、不讀全域資料；稅率、裝設請款％預設等由參數傳入。掛在 window.FJC.pay；Node：require('./calc/payable.js').pay
 * 規則同 calc/invoice.js：對外函式只能新增，不能改既有參數或意義。
 */
(function (root) {
  'use strict';
  var num = function (v) { return parseFloat(v) || 0; };
  var clamp = function (v) { return Math.max(0, Math.min(100, v)); };

  // 應付實付金額（含稅）：未稅 amount × 稅率；有抵扣預付款的期別存含稅 p.incl；vat===false 未稅
  function eff(p, tR) {
    var a = num(p.amount);
    if (p.vat !== false && p.incl != null && isFinite(+p.incl)) return Math.round(+p.incl);
    return p.vat === false ? Math.round(a) : Math.round(a * (1 + num(tR) / 100));
  }
  function vatAmt(p, tR) { return eff(p, tR) - Math.round(num(p.amount)); }
  // 廠商保留款（含稅基礎；已付不計）
  function retention(p, tR) {
    if (!p || !(parseFloat(p.retentionPct) > 0) || p.status === 'paid') return 0;
    return Math.round(eff(p, tR) * parseFloat(p.retentionPct) / 100);
  }

  // ── 分包計價 ──
  function invoice(c) { return !c || c.invoice !== false; }   // 有沒有開發票（預設有）
  function retRate(c, row) {   // 保留款％：列可覆寫卡片
    var r = (row && row.ret != null && row.ret !== '') ? parseFloat(row.ret) : parseFloat(c && c.retRate);
    return isNaN(r) ? 0 : clamp(r);
  }
  function periods(c) { return (c && Array.isArray(c.periods)) ? c.periods : []; }
  function advs(c) { return (c && Array.isArray(c.advances)) ? c.advances : []; }
  function staged(row) { return !!(row && row.stage && !row.lump && row.tpl !== 'grout'); }
  function inst(row, instDef) { var v = parseFloat(row && row.inst); return isNaN(v) ? instDef : clamp(v); }
  function prInst(row, pr, instDef) { var v = parseFloat(pr && pr.ins); return isNaN(v) ? inst(row, instDef) : clamp(v); }   // 期別存當時的裝設％，之後調整不回溯
  function rowPrice(row, pr) { var u = pr && pr.up; return (u != null && u !== '') ? num(u) : num(row && row.unitPrice); }   // 廠商請款單價可核實覆寫
  // 單期計價：本期金額、保留款、淨額、抵扣預付款（不超過淨額）、應付
  function periodCalc(c, per, instDef) {
    var amt = 0, ret = 0;
    if (per && per.isRet) { amt = Math.round(num(per.amt)); return { amt: amt, ret: 0, net: amt, adv: 0, pay: amt }; }
    ((per && per.rows) || []).forEach(function (pr) {
      var row = ((c && c.rows) || []).find(function (r) { return r.id === pr.rid; }); if (!row) return;
      var a = staged(row) && (pr.qi != null || pr.qr != null)
        ? ((num(pr.qi) * prInst(row, pr, instDef) + num(pr.qr) * (100 - prInst(row, pr, instDef))) / 100) * rowPrice(row, pr)   // 分段＝裝設量×inst%＋拆除量×其餘%
        : num(pr.qty) * rowPrice(row, pr);
      amt += a; ret += a * retRate(c, row) / 100;
    });
    amt = Math.round(amt); ret = Math.round(ret);
    var net = amt - ret, adv = Math.max(0, Math.min(Math.round(num(per && per.adv)), net));
    return { amt: amt, ret: ret, net: net, adv: adv, pay: net - adv };
  }
  // 預付款抵扣（含稅口徑）：各期依累計比例分攤含稅預付總額，扣滿時剛好等於已付的含稅預付款。回傳 {期別:本期抵扣含稅}
  function advInclAlloc(c, tR, instDef) {
    var out = {}, vat = invoice(c), A = advs(c), m = 1 + num(tR) / 100;
    var U = A.reduce(function (a, x) { return a + Math.round(num(x.amt)); }, 0); if (!(U > 0)) return out;
    var I = A.reduce(function (a, x) { var v = Math.round(num(x.amt)); return a + (vat ? Math.round(v * m) : v); }, 0);
    var cum = 0, cumI = 0;
    periods(c).filter(function (p) { return p && !p.isRet; }).slice().sort(function (a, b) { return (parseInt(a.no) || 0) - (parseInt(b.no) || 0); }).forEach(function (per) {
      var d = periodCalc(c, per, instDef).adv; if (!(d > 0)) return; cum += d;
      var ci = cum >= U ? I : Math.round(cum / U * I); out[per.no] = ci - cumI; cumI = ci;
    });
    return out;
  }
  // 自動應付的 id 規則
  function payId(cid, per) { return 'pay' + cid + (per.isRet ? '_r' : '_p') + per.no; }
  function advPayId(cid, a) { return 'pay' + cid + '_a' + a.id; }
  function earlyId(cid, per, e) { return 'pay' + cid + '_p' + per.no + '_e' + e.id; }

  var pay = { eff: eff, vatAmt: vatAmt, retention: retention, invoice: invoice, retRate: retRate, periods: periods, advs: advs, staged: staged, inst: inst,
    prInst: prInst, rowPrice: rowPrice, periodCalc: periodCalc, advInclAlloc: advInclAlloc, payId: payId, advPayId: advPayId, earlyId: earlyId };
  var FJC = root.FJC || (root.FJC = {});
  FJC.pay = pay;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
