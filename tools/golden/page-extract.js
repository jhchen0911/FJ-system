// 真實黃金樣本 (b)：在「已載入快照的 FJ 頁面」裡，用當時這份程式自己的算法算出關鍵數字（只讀，不寫雲端）。
// 由 tools/golden/run.js 注入執行；輸出只用 id 當鍵（不放案名），案名另外輸出到 names（給全文搜尋用，只存 Lotion-HQ 電腦）。
// 欄位類別（比對時只回報類別）：quote（報價合計）、stat（專案統計：合約、已請、已收、應收、保留款、成本、毛利…）、
//   inv（每期請款：本期金額、稅、保留款、清潔費扣款、應收、實收）、sub（分包：總額、已計價、已付、未付）、pay（應付每期）、year（股東報表年度數字）
(async () => {
  const R = (x) => { const n = Number(x); return isFinite(n) ? Math.round(n * 100) / 100 : null; };   // 留到分，免得浮點雜訊誤報
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o && o[k] != null && typeof o[k] !== 'object') r[k] = R(o[k]); }); return r; };
  const out = { meta: { app: APP_VERSION, quotes: Q.length, invoices: INV.length, payables: PAYABLES.length }, quote: {}, stat: {}, inv: {}, sub: {}, pay: {}, year: {} };
  const names = new Set();
  const nm = s => { s = String(s || '').trim(); if (s.length >= 2) names.add(s); };
  // 選案：全部得標案（含已結案、含追加案）；再加 5 張代表性報價（未得標、工項最多的）
  const won = Q.filter(q => q && q.awarded);
  const rep = Q.filter(q => q && !q.awarded && Array.isArray(q.items)).sort((a, b) => (b.items.length - a.items.length) || String(a.id).localeCompare(String(b.id))).slice(0, 5);
  const sel = won.concat(rep);
  // 報價合計：用編輯頁的 calcT 重算（工項 × 單價、稅、附加項）
  for (const q of sel) {
    try {
      items = JSON.parse(JSON.stringify(q.items || [])); exs = JSON.parse(JSON.stringify(q.exs || []));
      const t = calcT() || {};
      out.quote[q.id] = pick(t, ['sub', 'tax', 'total', 'ext', 'cost', 'gross', 'net']);
    } catch (e) { out.quote[q.id] = { __err: String(e && e.message || e).slice(0, 80) }; }
    nm(q.name); nm(q.client); nm(q.contact); nm(q.loc);
  }
  // 專案統計（主案）＋每期請款＋分包
  for (const q of won.filter(x => !x.parentId)) {
    let st;
    try { st = _pjStat(q); } catch (e) { out.stat[q.id] = { __err: String(e && e.message || e).slice(0, 80) }; continue; }
    out.stat[q.id] = pick(st, ['quoteTotal', 'base', 'origTotal', 'curTotal', 'billed', 'recv', 'ar', 'retHeld', 'costNet', 'subTotal', 'subBilled', 'payTotal', 'payPaid', 'profit', 'physPct']);
    out.stat[q.id].won = R(_wonAmt(q));
    (st.invs || []).forEach(inv => {
      const c = JSON.parse(JSON.stringify(inv));
      let re = {};
      try { _recalcInvAmounts(c); re = pick(c.totals, ['curTotal', 'tax', 'total', 'retention', 'clean', 'cleanGross']); } catch (e) { re = { __err: String(e && e.message || e).slice(0, 80) }; }
      out.inv[inv.id] = Object.assign({ stored: R(inv.totals && inv.totals.total), rcv: R(_invRcv(inv)), ar: R(_invAR(inv)), ret: R(_invRetention(inv)) }, re);
      nm(inv.project); nm(inv.client);
    });
    (st.subs || []).forEach(s => {
      out.sub[s.c.id] = pick(s.s, ['total', 'billed', 'paid', 'unpaid', 'payN', 'ret', 'adv']);
      nm(s.c.vendor);
    });
  }
  // 應付每期：跟這些案子有關的每一筆（含稅實付口徑 _payEff）
  const qids = new Set(won.map(q => q.id));
  PAYABLES.filter(p => p && qids.has(p.quoteId)).forEach(p => { out.pay[p.id] = { eff: R(_payEff(p)), paid: p.status === 'paid' ? 1 : 0 }; nm(p.to); });
  // 股東報表年度數字：請款單出現過的每一年
  const years = Array.from(new Set(INV.map(i => String(i.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))).sort();
  for (const y of years) {
    try {
      const s = _shRptYear(y);
      out.year[y] = Object.assign(pick(s, ['revTax', 'ret', 'revNet', 'recv', 'cost', 'gross', 'exp', 'hr', 'pretax']), { cap: R(s.sh && s.sh.cap), drawn: R(s.sh && s.sh.drawn) });
    } catch (e) { out.year[y] = { __err: String(e && e.message || e).slice(0, 80) }; }
  }
  (CUSTOMERS || []).forEach(c => nm(c && c.name));
  (VENDORS || []).forEach(v => nm(v && (v.name || v)));
  (CONTRACTS || []).forEach(c => nm(c && c.name));
  return { data: out, names: Array.from(names).sort() };
})()
