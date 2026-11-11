/* 豐有工程管理系統．計算模組：薪資單（改版第 3a-4 步，v6.0.133）
 * 純計算：掛在 window.FJC.hr；Node：require('./calc/payroll.js').hr。對外函式只能新增，不能改既有參數或意義。
 */
(function (root) {
  'use strict';
  function n(v, d) { var x = parseFloat(v); return isFinite(x) ? x : (d || 0); }   // 數字（空白／非數字＝預設）
  // 薪資單：底薪（日薪×天數或月薪）＋津貼＋加班＝應發；勞健保自付＋其他扣＝應扣；實發＝應發−應扣；公司負擔＝勞健退公司部分（s 會被改寫並回傳）
  function slip(s) {
    s.days = n(s.days);
    s.baseAmt = s.payType === 'day' ? Math.round(n(s.base) * s.days) : Math.round(n(s.base));
    ['tel', 'other', 'extra', 'laborSelf', 'healthSelf', 'pensionSelf', 'otherDed', 'laborCo', 'healthCo', 'pensionCo'].forEach(function (k) { s[k] = Math.round(n(s[k])); });
    s.gross = s.baseAmt + s.tel + s.other + s.extra;
    s.ded = s.laborSelf + s.healthSelf + s.pensionSelf + s.otherDed;
    s.net = s.gross - s.ded;
    s.coCost = s.laborCo + s.healthCo + s.pensionCo;
    return s;
  }
  // ── 薪資草稿（v6.0.235，需求書 #19，Lotion 11/11 定案）──
  // 加班費（勞基法 24 條）：一天的加班時數 h，前 2 小時 × 1.34、超過的 × 1.67（時薪 hourly）；回傳不四捨五入的金額
  function otPay(h, hourly) { h = Math.max(0, n(h)); hourly = Math.max(0, n(hourly)); return Math.min(h, 2) * hourly * 1.34 + Math.max(h - 2, 0) * hourly * 1.67; }
  // 時薪：有填加班時薪用它；日薪 ÷ 8；月薪 ÷ 240（勞基法月薪換算 30 天 × 8 小時）
  function hourlyOf(h) { h = h || {}; if (n(h.otHourly) > 0) return n(h.otHourly); return h.payType === 'day' ? n(h.base) / 8 : n(h.base) / 240; }
  // 這個月某人的出工：logs＝[{date, site, att:[{hrId, day(1／0.5／0), ot, off}]}]（各案日報攤平後傳進來）；同一天兩個工地只算一次（取 day 最大、加班加總）
  function monthAtt(logs, ym, hrId) {
    var by = {};
    (logs || []).forEach(function (L) {
      var d = String((L && L.date) || '').slice(0, 10); if (d.slice(0, 7) !== ym) return;
      ((L && L.att) || []).forEach(function (a) {
        if (!a || a.hrId !== hrId) return; var x = by[d] || (by[d] = { date: d, day: 0, ot: 0, sites: [] });
        x.day = Math.max(x.day, Math.max(0, Math.min(1, n(a.day)))); x.ot += Math.max(0, n(a.ot)); if (L.site && x.sites.indexOf(L.site) < 0) x.sites.push(String(L.site));
      });
    });
    var rows = Object.keys(by).sort().map(function (k) { return by[k]; });
    return { rows: rows, days: rows.reduce(function (s, r) { return s + r.day; }, 0), full: rows.filter(function (r) { return r.day === 1; }).length, half: rows.filter(function (r) { return r.day === 0.5; }).length, otH: rows.reduce(function (s, r) { return s + r.ot; }, 0) };
  }
  // 草稿薪資條：h＝人員薪資設定（payType／base／津貼／勞健保…），att＝monthAtt 的結果，adds＝[{amt, note}]（Lotion 在卡片選「加進這期薪資」的零用金／代墊）
  //   日薪：底薪＝日薪 × 出工天數（半天 0.5）；月薪：照整月，不看出工；加班費（extra）＝每天各自照勞基法算再加總、四捨五入到元
  function draftSlip(h, att, adds) {
    h = h || {}; att = att || { rows: [], days: 0 };
    var hourly = hourlyOf(h), ot = 0; (att.rows || []).forEach(function (r) { ot += otPay(r.ot, hourly); });
    var add = (adds || []).reduce(function (a, x) { return a + Math.round(n(x && x.amt)); }, 0);
    var s = slip({ payType: h.payType === 'day' ? 'day' : 'month', base: n(h.base), days: h.payType === 'day' ? att.days : 0, tel: n(h.telAllow), other: n(h.otherAllow) + add, extra: Math.round(ot),
      laborSelf: n(h.laborSelf), healthSelf: n(h.healthSelf), pensionSelf: n(h.pensionSelf), otherDed: 0, laborCo: n(h.laborCo), healthCo: n(h.healthCo), pensionCo: n(h.pensionCo) });
    s.hourly = Math.round(hourly * 100) / 100; s.otH = att.otH || 0; s.otAmt = Math.round(ot); s.addAmt = add;
    s.noIns = !(n(h.laborSelf) || n(h.healthSelf) || n(h.laborCo) || n(h.healthCo));
    return s;
  }
  // ── 點工出工推估（第 7 步「今天出工」，Lotion 11/11 F2／J1）──
  // logs＝[{date, site, ppl:[{k 人, day 1／0.5, ot 加班時數, rate 日薪, oh 加班時薪（可空）}] 或 null, workers 舊日報人數, rate 舊日報用的日薪}]
  //   有 ppl（新格式）：每人每天 day × 日薪＋加班費（otPay；時薪沒填＝日薪÷8）；同一人同一天在幾個工地＝天數加總、最多 1 天（Lotion 11/11：上午甲 0.5＋下午乙 0.5＝1 天、各 0.5；兩案都全天＝各 0.5；超過 1 照比例縮），加班算在填的那一案
  //   沒有 ppl（舊日報只有人數）：人數 × 日薪（照舊，不會變 0）
  // 回傳 {site: {days, amt}}（days 留兩位小數、amt 四捨五入到元）
  function crewEst(logs) {
    // 同一個人在同一案同一天出現兩次（例如勾在兩個工班）：只算一次（天數取最大、加班加總）
    var seen = {}, L2 = [];
    (logs || []).forEach(function (L) {
      if (!L || !Array.isArray(L.ppl)) { L2.push(L); return; }
      var ppl = [];
      L.ppl.forEach(function (p) {
        if (!p || !p.k) return; var key = String(L.date || '').slice(0, 10) + '|' + L.site + '|' + p.k, x = seen[key];
        if (x) { x.day = Math.max(n(x.day), n(p.day)); x.ot = n(x.ot) + n(p.ot); return; }
        x = seen[key] = { k: p.k, day: n(p.day), ot: n(p.ot), rate: p.rate, oh: p.oh }; ppl.push(x);
      });
      L2.push({ date: L.date, site: L.site, ppl: ppl });
    });
    logs = L2;
    var day = {};
    (logs || []).forEach(function (L) {
      if (!L || !Array.isArray(L.ppl)) return;
      L.ppl.forEach(function (p) {
        var d = Math.max(0, Math.min(1, n(p && p.day))); if (!(d > 0) || !p.k) return;
        var key = String(L.date || '').slice(0, 10) + '|' + p.k, x = day[key] || (day[key] = { sum: 0 });
        x.sum += d;
      });
    });
    var by = {};
    (logs || []).forEach(function (L) {
      if (!L) return; var o = by[L.site] || (by[L.site] = { days: 0, amt: 0 });
      if (Array.isArray(L.ppl)) {
        L.ppl.forEach(function (p) {
          if (!p || !p.k) return; var rate = Math.max(0, n(p.rate)), oh = n(p.oh) > 0 ? n(p.oh) : rate / 8;
          var d = Math.max(0, Math.min(1, n(p.day))), x = day[String(L.date || '').slice(0, 10) + '|' + p.k];
          var share = (d > 0 && x) ? d * Math.min(1, 1 / x.sum) : 0;   // 加總最多 1 天：沒超過照各案填的、超過照比例縮（全天＋全天＝各 0.5、上午 0.5＋下午 0.5＝各 0.5）
          o.days += share; o.amt += share * rate + otPay(p.ot, oh);
        });
      } else { var w = Math.max(0, n(L.workers)); o.days += w; o.amt += w * Math.max(0, n(L.rate)); }
    });
    Object.keys(by).forEach(function (k) { by[k].days = Math.round(by[k].days * 100) / 100; by[k].amt = Math.round(by[k].amt); });
    return by;
  }
  var hr = { num: n, slip: slip, otPay: otPay, hourlyOf: hourlyOf, monthAtt: monthAtt, draftSlip: draftSlip, crewEst: crewEst };
  var FJC = root.FJC || (root.FJC = {});
  FJC.hr = hr;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
