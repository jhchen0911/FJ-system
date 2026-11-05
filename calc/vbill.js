/* 第 6 步 廠商請款辨識：純計算（設計見 docs/第6步_廠商請款辨識_設計.md；Lotion 11/04 八題全部照建議）
 * 不讀畫面、不讀全域資料。掛在 window.FJC.vb；Node：require('./calc/vbill.js').vb
 *   norm      說明文字正規化（全形轉半形、去空白、統一 Ø／φ、大寫）
 *   rowMatch  單據一列 → 分包卡哪一列（說明相似度＋單位＋單價接近度；對位是程式做的，不是 AI 猜的）
 *   dupKeys／dupHit  重複請款：廠商＋發票號；沒有發票號用廠商＋期間＋合計（第 4 題）
 *   sumCheck  逐項加總 vs 合計、稅額是不是 5%
 *   slipAmt   簽單（點工／機具）金額＝Σ 工×單價（第 7 題：單價分包卡優先，沒有用簽單價並標黃）
 *   unitPrice 本期單價：預設照分包卡，勾選才用單據價（第 2 題）
 *   gate      核准前的擋：沒選專案／分包卡、黃色（低／無信心）欄位沒點過、題目沒答、重複請款沒寫放行原因
 */
(function (root) {
  'use strict';
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function S(x) { return x == null ? '' : String(x); }
  function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : []; }

  function norm(s) {
    return S(s).replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/　/g, ' ').replace(/[φΦ∅]/g, 'Ø').replace(/[\s,，、。．.()（）\[\]【】\-_:：;；'"「」]/g, '').toUpperCase();
  }
  // 字元二元組相似度（Dice），中文短字串好用
  function sim(a, b) {
    a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1;
    var g = function (s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); o[k] = (o[k] || 0) + 1; } if (s.length === 1) o[s] = 1; return o; };
    var A = g(a), B = g(b), n = 0, na = 0, nb = 0, k;
    for (k in A) { na += A[k]; if (B[k]) n += Math.min(A[k], B[k]); }
    for (k in B) nb += B[k];
    return na + nb ? 2 * n / (na + nb) : 0;
  }
  function unitEq(a, b) { a = norm(a); b = norm(b); if (!a || !b) return null; var M = { 'M': 'M', '米': 'M', '公尺': 'M', '支': '支', '根': '支', '片': '片', '工': '工', '天': '工', '式': '式', 'T': 'T', '噸': 'T' }; return (M[a] || a) === (M[b] || b); }

  // 一列對分包卡各列 → { rowId, conf: 高／中／低／無, score, cands:[{id,score}] }
  function rowMatch(line, cardRows) {
    var rs = arr(cardRows).map(function (r) {
      var s = sim(line.text, r.desc), u = unitEq(line.unit, r.unit), up = num(line.up), cp = num(r.unitPrice);
      var pr = (up > 0 && cp > 0) ? 1 - Math.min(1, Math.abs(up - cp) / Math.max(up, cp)) : 0.5;
      var score = s * 0.7 + (u === true ? 0.2 : u === false ? -0.2 : 0) + pr * 0.1;
      return { id: r.id, score: Math.round(score * 1000) / 1000 };
    }).sort(function (a, b) { return b.score - a.score; });
    var top = rs[0], second = rs[1];
    if (!top || top.score < 0.45) return { rowId: null, conf: '無', score: top ? top.score : 0, cands: rs.slice(0, 3) };
    var gap = second ? top.score - second.score : 1;
    var conf = top.score >= 0.8 && gap >= 0.15 ? '高' : top.score >= 0.6 && gap >= 0.08 ? '中' : '低';
    return { rowId: top.id, conf: conf, score: top.score, cands: rs.slice(0, 3) };
  }

  // 重複請款的比對鍵（廠商名正規化）
  function dupKeys(b) {
    var v = norm(b && b.vendor), keys = [];
    var inv = norm(b && b.invNo);
    if (v && inv) keys.push('i|' + v + '|' + inv);
    if (v && b && b.from && b.to) keys.push('p|' + v + '|' + b.from + '|' + b.to + '|' + Math.round(num(b.total)));
    return keys;
  }
  // 已入帳的單：[{vendor, invNo, from, to, total, ref}] → 命中的那筆（沒有＝null）
  function dupHit(b, booked) {
    var mine = dupKeys(b); if (!mine.length) return null;
    var hit = null;
    arr(booked).some(function (x) { var ks = dupKeys(x); if (ks.some(function (k) { return mine.indexOf(k) >= 0; })) { hit = x; return true; } return false; });
    return hit;
  }

  // 逐項加總 vs 合計；稅額檢查（taxMode 外加：tax 應＝sub×稅率；內含：total 應＝sub）
  function sumCheck(rows, tot, taxR) {
    var s = Math.round(arr(rows).reduce(function (a, r) { return a + (r.amt != null && r.amt !== '' ? num(r.amt) : num(r.qty) * num(r.up)); }, 0));
    var t = tot || {}, sub = Math.round(num(t.sub)), tax = Math.round(num(t.tax)), tr = taxR == null ? 5 : num(taxR);
    var out = { rowSum: s, sub: sub, diff: sub ? s - sub : 0, taxOk: true, taxExp: Math.round(sub * tr / 100) };
    if (t.taxMode === '外加' && sub) out.taxOk = Math.abs(tax - out.taxExp) <= 1;
    return out;
  }

  // 簽單金額＝Σ 人數（或工數）×單價；單價：分包卡優先（cardUp>0），沒有用簽單價並標黃
  function slipAmt(slip, cardUp) {
    var flag = false;
    var amt = Math.round(arr(slip).reduce(function (a, s) {
      var u = num(cardUp) > 0 ? num(cardUp) : num(s.up); if (!(num(cardUp) > 0)) flag = true;
      return a + num(s.n) * u;
    }, 0));
    return { amt: amt, yellow: flag && arr(slip).length > 0 };
  }

  // 本期單價：預設分包卡；useBill＝勾選「用單據單價」才用單據價
  function unitPrice(line, cardRow, useBill) {
    var cp = num(cardRow && cardRow.unitPrice), bp = num(line && line.up);
    if (useBill && bp > 0) return { up: bp, src: 'bill', diff: cp ? bp - cp : 0 };
    return { up: cp || bp, src: cp ? 'card' : 'bill', diff: cp && bp ? bp - cp : 0 };
  }

  // 核准前的擋（回傳原因清單；空＝可以核准）。st＝畫面狀態 {qid, cid, seen:{欄位:1}, answers:{欄位:值}, dupReason}
  var LOW = { '低': 1, '無': 1 };
  function gate(pl, st, dup) {
    pl = pl || {}; st = st || {};
    var why = [];
    if (!st.qid) why.push('還沒選專案');
    if (!st.cid) why.push('還沒選分包卡');
    var seen = st.seen || {}, ans = st.answers || {};
    ['vendor', 'qid', 'date', 'invNo', 'tot'].forEach(function (k) { var f = pl[k]; if (f && LOW[f.conf] && !seen[k]) why.push('「' + k + '」辨識信心低，請點過確認'); });
    arr(pl.rows).forEach(function (r, i) { if (LOW[r.rowConf] && ans['rows[' + i + '].rowId'] == null) why.push('第 ' + (i + 1) + ' 項還沒選要掛哪一列（併入／新增／不計）'); });
    arr(pl.asks).forEach(function (a) { if (a && a.field && ans[a.field] == null) why.push('還沒回答：' + S(a.q).slice(0, 40)); });
    if (dup && !S(st.dupReason).trim()) why.push('這張單已經入帳過（' + S(dup.ref || '') + '），要放行請寫原因');
    if (pl.needHuman && !seen.needHuman) why.push('辨識失敗、需人工判讀：請對照原檔確認每一欄');
    return why;
  }

  var vb = { norm: norm, sim: sim, unitEq: unitEq, rowMatch: rowMatch, dupKeys: dupKeys, dupHit: dupHit, sumCheck: sumCheck, slipAmt: slipAmt, unitPrice: unitPrice, gate: gate };
  var FJC = root.FJC || (root.FJC = {});
  FJC.vb = vb;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
