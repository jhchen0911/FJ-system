// 改版第 5 步 5b：雲端每日提醒（後端 10／12／13／17／20／24）
// 算法一律用 calc/todo.js（前端畫面同一份；部署前 tools/copy-calc.js 複製到 functions/calc/），這裡只負責把 RTDB 的資料整理成陣列再呼叫。
// 兩週並行期：結果寫 fydata/health/remind（管理員與唯讀帳號讀得到），前端資料健檢「雲端每日提醒」卡逐類比對；不寫總覽待辦。
'use strict';
process.env.TZ = 'Asia/Taipei';   // calc/todo.js 用本地時間算日期，跟台灣的瀏覽器一樣
const FJC = require('../calc/invoice.js');
require('../calc/todo.js');

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function decKey(k) { return String(k).replace(/~d~/g, '.').replace(/~h~/g, '#').replace(/~s~/g, '$').replace(/~sl~/g, '/').replace(/~lb~/g, '[').replace(/~rb~/g, ']'); }
function tpeDay(ms) { return new Date((ms || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10); }
// 請款單上雲時工項會壓縮（_invPack）；提醒只用 totals／收款紀錄／保留款欄位，不必還原工項
function unpack(inv) { return inv; }
// 報價的發包（rfqs）、成本卡、成本單價只在 private quoteSens：接回報價複本
function withSens(quotes, sens) {
  const S = {}; Object.keys(sens || {}).forEach((k) => { S[decKey(k)] = sens[k]; });
  // 接回發包（rfqs）、成本卡（costs）、工項成本單價（est，鑰匙同前端 _sensKeyOf：有 _uid 用它、沒有用 #列號）
  return quotes.map((q) => {
    const s = S[q.id]; if (!s) return q;
    const c = Object.assign({}, q);
    if (Array.isArray(s.rfqs)) c.rfqs = s.rfqs;
    if (Array.isArray(s.costs)) c.costs = s.costs;
    if (s.est && typeof s.est === 'object') {
      const est = {}; Object.keys(s.est).forEach((k) => { est[decKey(k)] = s.est[k]; });   // 審查：上雲時 # 編成 ~h~，要先還原
      c.items = (q.items || []).map((it, i) => { if (!it) return it; const k = it._uid ? String(it._uid) : ('#' + i); return est[k] != null ? Object.assign({}, it, { estCost: est[k] }) : it; });
    }
    return c;
  });
}
// 跟前端 _todoKeys 同一套鑰匙
function keysOf(v) {
  v = v || {}; const K = {
    rent: (v.rent || []).map((x) => x.qid), rentSoon: (v.rentSoon || []).map((x) => x.qid + '#' + x.idx), recv: (v.recv || []).map((x) => x.id),
    ret: (v.ret || []).map((x) => x.proj), close: (v.close || []).map((x) => x.qid), rfqVer: (v.rfqVer || []).map((x) => x.qid),
    bill: (v.bill || []).map((x) => x.qid), overrun: (v.overrun || []).map((x) => x.qid + '#' + x.n),   // 5c
  };
  Object.keys(K).forEach((k) => { K[k] = K[k].map(String).sort(); });
  return K;
}
// inp＝{shared:{quotes,invoices,contracts,customers,params,qHistory}, priv:{payables,matLedger,quoteSens}, now}
function buildRemind(inp) {
  inp = inp || {}; const sh = inp.shared || {}, pv = inp.priv || {}, now = inp.now || Date.now();
  const quotes = withSens(arr(sh.quotes), pv.quoteSens || {});
  const hist = {}; Object.keys(sh.qHistory || {}).forEach((k) => { hist[decKey(k)] = arr(sh.qHistory[k]); });
  const params = sh.params || {};
  const def = { cut: 25, delay: 1, day: 20 };
  const v = FJC.todo.build({ quotes, invoices: arr(sh.invoices).map(unpack), contracts: arr(sh.contracts), customers: arr(sh.customers), payables: arr(pv.payables), matLedger: arr(pv.matLedger),
    histOf: (id) => hist[id] || [] }, { today: tpeDay(now), now, tax: params.tax, payDef: def, inv: FJC.inv });
  const counts = {}; Object.keys(v).forEach((k) => { counts[k] = (v[k] || []).length; });
  return { at: now, day: tpeDay(now), counts, keys: keysOf(v),
    // 明細只放案名／期別／天數（金額留在只有管理員讀得到的節點也一樣不放，前端要金額自己算）
    list: {
      rent: v.rent.map((x) => ({ qid: x.qid, name: x.name, n: x.n, maxD: x.maxD })),
      rentSoon: v.rentSoon.map((x) => ({ qid: x.qid, name: x.name, idx: x.idx, desc: x.desc, expiry: x.expiry, left: x.left })),
      recv: v.recv.map((x) => ({ id: x.id, d: x.d, date: x.date })),
      ret: v.ret.map((x) => ({ proj: x.proj, qid: x.qid, due: x.due, overdue: x.overdue, date: x.date, src: x.src })),
      close: v.close, rfqVer: v.rfqVer,
      bill: (v.bill || []).map((x) => ({ qid: x.qid, name: x.name, cutDate: x.cutDate, left: x.left, items: x.items })),
      overrun: (v.overrun || []).map((x) => ({ qid: x.qid, name: x.name, n: x.n, rows: x.rows.map((r) => ({ idx: r.idx, desc: r.desc, pct: r.pct })) })),
      ticket: v.ticket.map((x) => ({ id: x.id, dueDate: x.dueDate, dd: x.dd })),
    } };
}
// v6.0.174：RTDB 不收 undefined／NaN，鍵名不能有 . # $ / [ ]（真實資料的工項說明、案名可能有）→ 寫入前整理一次
function rtdbSafe(v) {
  if (v === undefined || (typeof v === 'number' && !isFinite(v))) return null;
  if (Array.isArray(v)) return v.map(rtdbSafe);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { const x = rtdbSafe(v[k]); if (x !== null) o[String(k).replace(/[.#$\/\[\]]/g, '_') || '_'] = x; });
    return o;
  }
  return v;
}
module.exports = { buildRemind, keysOf, tpeDay, rtdbSafe };
