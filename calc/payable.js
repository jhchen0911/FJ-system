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
  // 分包實作超量：各期累計數量超過合約數量的部分（逐期依序），吸收（per.absorb）＝我方自付，其餘＝向業主追加請款
  function overStat(c) {
    var out = { overAmt: 0, absorbed: 0, toOwner: 0, overQty: {}, absorbQtyByItem: {}, overQtyByItem: {} };
    var cum = {};
    periods(c).filter(function (p) { return !p.isRet; }).slice().sort(function (a, b) { return (a.no || 0) - (b.no || 0); }).forEach(function (per) {
      (per.rows || []).forEach(function (pr) {
        var row = ((c && c.rows) || []).find(function (r) { return r.id === pr.rid; }); if (!row) return;
        var total = num(row.qty), before = cum[pr.rid] || 0, after = before + num(pr.qty); cum[pr.rid] = after;
        if (total <= 0) return;
        var ex = Math.max(0, after - total) - Math.max(0, before - total); if (ex <= 1e-9) return;
        var amt = Math.round(ex * rowPrice(row, pr));
        out.overAmt += amt; out.overQty[pr.rid] = (out.overQty[pr.rid] || 0) + ex;
        var ii = parseInt(row.linkedItemIdx);
        if (per.absorb) { out.absorbed += amt; if (!isNaN(ii) && ii >= 0) out.absorbQtyByItem[ii] = (out.absorbQtyByItem[ii] || 0) + ex; }
        else { out.toOwner += amt; }
        if (!isNaN(ii) && ii >= 0) out.overQtyByItem[ii] = (out.overQtyByItem[ii] || 0) + ex;
      });
    });
    return out;
  }
  // 自動應付的 id 規則
  function payId(cid, per) { return 'pay' + cid + (per.isRet ? '_r' : '_p') + per.no; }
  function advPayId(cid, a) { return 'pay' + cid + '_a' + a.id; }
  function earlyId(cid, per, e) { return 'pay' + cid + '_p' + per.no + '_e' + e.id; }

  // v6.0.187 第 6 步 6-1a：同一筆應付分次付款（p.pays＝[{id, amt 含稅, date, at, by, note}]）
  function paysOf(p) { return (p && Array.isArray(p.pays)) ? p.pays.filter(function (x) { return x && !x.void && num(x.amt) > 0; }) : []; }   // 撤銷的付款留著（void），跨裝置合併才不會復活
  // 已付合計（含稅）：整筆已付＝全額；部分已付＝付款紀錄加總（不超過全額）
  function paidSum(p, tR) {
    if (!p) return 0;
    var e = eff(p, tR);
    if (p.status === 'paid') return e;
    var s = paysOf(p).reduce(function (a, x) { return a + Math.round(num(x.amt)); }, 0);
    return Math.min(s, e);
  }
  // 餘額（含稅）＝全額－已付合計，不另外四捨五入；作廢、已付為 0
  function left(p, tR) {
    if (!p || p.voidAt || p.status === 'paid') return 0;
    return Math.max(0, eff(p, tR) - paidSum(p, tR));
  }
  // 某期間（日期字首，例 '2026' 或 '2026-11'）實際付出的現金（含稅）：有付款紀錄看紀錄日期；沒有紀錄的整筆已付看 paidDate（缺就 date）
  function paidIn(p, prefix, tR) {
    if (!p) return 0;
    prefix = String(prefix || '');
    var ps = paysOf(p);
    if (ps.length) {
      var cap = eff(p, tR), run = 0, out = 0;
      ps.slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')) || (num(a.at) - num(b.at)); }).forEach(function (x) {
        var a2 = Math.min(Math.round(num(x.amt)), Math.max(0, cap - run)); run += a2;
        if (String(x.date || '').indexOf(prefix) === 0) out += a2;
      });
      if (p.status === 'paid' && run < cap && String(p.paidDate || p.date || '').indexOf(prefix) === 0) out += cap - run;   // 整筆標已付、紀錄少於全額：差額算在實付日
      return out;
    }
    if (p.status !== 'paid') return 0;
    return String(p.paidDate || p.date || '').indexOf(prefix) === 0 ? eff(p, tR) : 0;
  }
  function partial(p, tR) { return !!p && p.status !== 'paid' && !p.voidAt && paidSum(p, tR) > 0; }

  // v6.0.188 第 6 步 6-1p：放款日遇假日順延到下一個工作日（週末自動判斷；國定假日 hol、補行上班日 mk 由 app 從參數傳入，'YYYY-MM-DD' 陣列）
  function ymd(t) { return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function isWorkday(iso, hol, mk) {
    iso = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
    if ((mk || []).indexOf(iso) >= 0) return true;
    if ((hol || []).indexOf(iso) >= 0) return false;
    var p = iso.split('-'), w = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
    return w !== 0 && w !== 6;
  }
  function nextWorkday(iso, hol, mk) {
    iso = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    var p = iso.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2]);
    for (var i = 0; i < 40 && !isWorkday(ymd(t), hol, mk); i++) t.setDate(t.getDate() + 1);
    return ymd(t);
  }
  var pay = { isWorkday: isWorkday, nextWorkday: nextWorkday, paysOf: paysOf, paidSum: paidSum, left: left, paidIn: paidIn, partial: partial, eff: eff, vatAmt: vatAmt, retention: retention, invoice: invoice, retRate: retRate, periods: periods, advs: advs, staged: staged, inst: inst,
    prInst: prInst, rowPrice: rowPrice, periodCalc: periodCalc, advInclAlloc: advInclAlloc, overStat: overStat, payId: payId, advPayId: advPayId, earlyId: earlyId };
  var FJC = root.FJC || (root.FJC = {});
  FJC.pay = pay;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
