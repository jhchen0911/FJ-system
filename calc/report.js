/* 豐有工程管理系統．計算模組：經營報表（改版第 3a-3 步，v6.0.132）
 * 年度損益（股東報表、經營總覽共用的權責口徑）與分潤自動估算。純計算：資料集合與需要的口徑函式由參數傳入，
 * 不讀畫面、不讀全域資料。掛在 window.FJC.rpt；Node：require('./calc/report.js').rpt
 * 規則同其他 calc：對外函式只能新增，不能改既有參數或意義。
 *   data：{ invoices, quotes, expenses, payslips }（陣列）
 *   fn  ：{ taxM:number, retention(inv), rcvIn(inv,pre), hrEstimate(Y) }——保留款、期間實收、無薪資單時的人事估算由呼叫端提供（同全站口徑）
 */
(function (root) {
  'use strict';
  var num = function (v) { return parseFloat(v) || 0; };
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  var costCat = function (c) { return c.type === 'sub' ? '承包（發包）' : c.type === 'labor' ? '點工' : c.type === 'own' ? '自有（材料機具）' : '額外支出'; };

  // 年度損益（權責口徑，請款日／成本卡日期／費用日期歸屬）
  function year(data, year, fn) {
    var Y = String(year), tm = fn.taxM, invs = arr(data.invoices), qs = arr(data.quotes), exps = arr(data.expenses), slipsAll = arr(data.payslips);
    var revTax = 0, ret = 0;
    invs.forEach(function (v) { if ((v.date || '').slice(0, 4) !== Y) return; revTax += ((v.totals && num(v.totals.total)) || 0); ret += fn.retention(v); });
    var recv = invs.reduce(function (a, i) { return a + fn.rcvIn(i, Y); }, 0);
    var cost = 0, costByCat = {};
    qs.forEach(function (q) { (q.costs || []).forEach(function (c) { if ((c.date || '').slice(0, 4) !== Y) return; var a = num(c.amt); cost += a; var k = costCat(c); costByCat[k] = (costByCat[k] || 0) + a; }); });
    var exp = 0, expByCat = {};
    exps.forEach(function (e) { if (!e || e.costRef || (e.date || '').slice(0, 4) !== Y) return; var a = num(e.amount != null ? e.amount : e.amt); exp += a; var k = e.cat || '其他'; expByCat[k] = (expByCat[k] || 0) + a; });
    var slips = slipsAll.filter(function (s) { return s && String(s.ym || '').slice(0, 4) === Y; });
    var hr = slips.reduce(function (a, s) { return a + num(s.gross) + num(s.coCost); }, 0), hrEst = false;
    if (!slips.length) { if (revTax > 0 || cost > 0 || exp > 0) { try { hr = fn.hrEstimate(Y); hrEst = true; } catch (e) { hr = 0; } } else hr = 0; }   // 無任何營運活動的年度不推估
    var revNet = Math.round((revTax + ret) / tm);
    var gross = revNet - cost, pretax = gross - exp - hr;
    var monthly = [];
    for (var m = 1; m <= 12; m++) {
      var ms = Y + '-' + String(m).padStart(2, '0');
      var mr = invs.reduce(function (a, i) { return a + (((i.date || '').slice(0, 7) === ms) ? ((((i.totals && num(i.totals.total)) || 0) + fn.retention(i)) / tm) : 0); }, 0);
      var mc = 0; qs.forEach(function (q) { (q.costs || []).forEach(function (c) { if ((c.date || '').slice(0, 7) === ms) mc += num(c.amt); }); });
      var mv = invs.reduce(function (a, i) { return a + fn.rcvIn(i, ms); }, 0);
      monthly.push({ m: m, rev: Math.round(mr), cost: Math.round(mc), recv: Math.round(mv) });
    }
    return { Y: Y, revTax: Math.round(revTax), ret: Math.round(ret), revNet: revNet, recv: Math.round(recv), cost: Math.round(cost), costByCat: costByCat, gross: Math.round(gross),
      grossR: revNet > 0 ? gross / revNet * 100 : 0, exp: Math.round(exp), expByCat: expByCat, hr: Math.round(hr), hrEst: hrEst, pretax: Math.round(pretax), netR: revNet > 0 ? pretax / revNet * 100 : 0, monthly: monthly };
  }
  // 營業稅是代收代付、不算費用；營所稅列在稅後——在 year() 結果上調整（d 會被改寫並回傳）
  function taxAdj(d) {
    var vat = Math.round(d.expByCat['營業稅'] || 0), inc = Math.round(d.expByCat['營所稅'] || 0);
    d.vat = vat; d.inctax = inc;
    if (vat || inc) { d.exp -= vat + inc; d.pretax += vat + inc; d.netR = d.revNet > 0 ? d.pretax / d.revNet * 100 : 0; }
    d.afterTax = d.pretax - inc;
    return d;
  }
  // 分潤自動估算（權責上限用）：營收含保留款、扣成本／費用／估計薪資；循環資金增額＝月均成本成長×23/30
  //   o：{ taxM, months, salaryMonth }；fn.retention(inv)
  function shareAuto(data, y, o, fn) {
    var invs = arr(data.invoices), qs = arr(data.quotes), exps = arr(data.expenses);
    var rev = 0; invs.forEach(function (v) { if ((v.date || '').slice(0, 4) !== y) return; rev += ((v.totals && num(v.totals.total)) || 0) + fn.retention(v); });
    var cost = 0; qs.forEach(function (q) { (q.costs || []).forEach(function (c) { if ((c.date || '').slice(0, 4) === y) cost += num(c.amt); }); });
    var exp = 0; exps.forEach(function (e) { if (e && e.costRef) return; if ((e.date || '').slice(0, 4) === y) exp += num(e.amount != null ? e.amount : e.amt); });   // costRef：智慧收件的材料發票已計入施工成本
    var months = o.months;
    var salary = o.salaryMonth * 2 * months;
    var pretax = rev / o.taxM - cost - exp - salary;
    var prevCost = 0; qs.forEach(function (q) { (q.costs || []).forEach(function (c) { if ((c.date || '').slice(0, 4) === String(parseInt(y) - 1)) prevCost += num(c.amt); }); });
    var curMo = months > 0 ? (cost + exp + salary) / months : 0;
    var prevMo = prevCost / 12;
    var wcAdd = Math.max(0, Math.round((curMo - prevMo) * 23 / 30));
    return { rev: Math.round(rev), cost: Math.round(cost), exp: Math.round(exp), salary: salary, months: months, wcAdd: wcAdd, netProfit: Math.round(Math.max(0, pretax) * 0.8) };
  }

  var rpt = { year: year, taxAdj: taxAdj, shareAuto: shareAuto };
  var FJC = root.FJC || (root.FJC = {});
  FJC.rpt = rpt;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
