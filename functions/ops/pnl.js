// 改版第 5 步 5c #16：月損益快照、結案損益快照（雲端；單元測試 functions/test/pnl.test.js，冒煙測試拿同一份假資料跟前端 _shRptYear 逐值比對）
// 算法一律用 calc 模組（calc/report.js 的 yearMgmt／taxAdj、calc/invoice.js、calc/payable.js），這裡只做「資料準備」：
// 跟前端 _mgmtData／_mgmtCostEntries／_mgmtExtraExp／_invRetention／_retPctOf／_instDef／_shareAutoCalc 一行對一行（改前端那幾個函式要同步改這裡，冒煙測試會抓不一致）。
// 結案損益：同一套管理用口徑，按專案（主約＋追加）加總營收、施工成本、已付抽成佣金介紹費 → 結案後凍結一份。
// 第 18 項 結案實際成本匯出：只匯出，不改資料（costExportCsv）。
'use strict';

function req(name) {   // 部署時 calc/ 由 tools/copy-calc.js 複製到 functions/calc/；在 repo 裡測試直接讀根目錄 calc/
  try { return require('../calc/' + name); } catch (e) { return require('../../calc/' + name); }
}
const FJC = Object.assign({}, req('invoice.js'), req('payable.js'), req('report.js'));

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function decKey(k) { return String(k).replace(/~d~/g, '.').replace(/~h~/g, '#').replace(/~s~/g, '$').replace(/~sl~/g, '/').replace(/~lb~/g, '[').replace(/~rb~/g, ']'); }
// 同前端 _deepDecodeKeys：整棵還原（審查：巢狀物件的 key 也可能被編碼）
function deepDec(o) { if (Array.isArray(o)) return o.map(deepDec); if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach((k) => { r[decKey(k)] = deepDec(o[k]); }); return r; } return o; }
function num(x) { const n = parseFloat(x); return isFinite(n) ? n : 0; }
// 台北日期（前端 _ymd 用裝置本地時間；FJ 的裝置都在台灣）
function tpeYmd(ts) { return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10); }
const SHARE_SALARY_MONTH = 150000;   // 同前端 SHARE_SALARY_MONTH

// 報價：共用區的報價＋private 的 quoteSens（costs）合併——同前端 _applyQuoteSensAll 之後的 Q
function mergeQuotes(sharedQuotes, quoteSens) {
  const sens = {}; Object.keys(quoteSens || {}).forEach((k) => { sens[decKey(k)] = quoteSens[k]; });
  return arr(sharedQuotes).filter((q) => q && q.id).map((q) => Object.assign({}, q, sens[q.id] && sens[q.id].costs ? { costs: sens[q.id].costs } : {}));
}

function ctx(inp0) {
  const inp = deepDec(inp0 || {});
  const P = inp.params || {}, Q = mergeQuotes(inp.quotes, inp.quoteSens), INV = arr(inp.invoices), PAY = arr(inp.payables);
  const PAID = {}; Object.keys(inp.paidLog || {}).forEach((k) => { PAID[decKey(k)] = inp.paidLog[k]; });
  const taxR = FJC.inv.taxR(P.tax), taxM = FJC.inv.taxM(P.tax);
  const removeRate = (() => { const v = P.removeRate; if (v == null || v === '') return 30; const x = parseFloat(v); return isNaN(x) ? 30 : Math.max(0, Math.min(100, x)); })();
  const instDef = Math.max(0, 100 - removeRate);
  const ownerRetPct = (q) => { const r = q && q.deduct && q.deduct.ret; return (r != null && r !== '') ? (parseFloat(r) || 0) : 0; };
  const retQOf = (inv) => { if (!inv) return null; const id = inv.quoteId || inv.sourceQid; return (id && Q.find((x) => x.id === id)) || (inv.project ? Q.find((x) => !x.parentId && x.name === inv.project) : null) || null; };
  const retPctOf = (inv) => { const v = inv && inv.retentionPct; if (v != null && v !== '') return parseFloat(v) || 0; if (inv && inv.retention && inv.kind !== 'retReturn') return 10; return ownerRetPct(retQOf(inv)); };
  const retention = (inv) => { if (!inv || !inv.retention || inv.retentionReturned) return 0; return FJC.inv.retention(inv, taxR, retPctOf(inv)); };
  const isIntro = (c) => !!(c && c.type === 'sub' && (c.isIntro || c.followOf));
  const costCat = (c) => c.type === 'sub' ? '承包（發包）' : c.type === 'labor' ? '點工' : c.type === 'own' ? '自有（材料機具）' : '額外支出';
  const paidHard = (p) => { if (!p) return false; if (p.status === 'paid') return true; const l = PAID[p.id]; return !!(l && (+l.paidAt || 0) > (+l.unpaidAt || 0)); };
  const paidOn = (p) => { if (!(p && paidHard(p) && !p.voidAt)) return ''; let d = String(p.paidDate || p.date || ''); if (!d && p.paidAt) d = tpeYmd(p.paidAt); if (!d) { const L = PAID[p.id]; if (L && L.paidAt) d = tpeYmd(L.paidAt); } return d; };
  function costEntries() {
    const out = [];
    Q.forEach((q) => { arr(q.costs).forEach((c) => {
      if (isIntro(c)) return;
      const cat = costCat(c), pers = (c.type === 'sub' || c.rental) ? FJC.pay.periods(c).filter((p) => p && !p.isRet) : [];
      if (pers.length) { pers.forEach((per) => { let k; try { k = FJC.pay.periodCalc(c, per, instDef); } catch (e) { return; } out.push({ date: per.date || c.date || '', amt: k.amt, cat, qid: q.id }); }); return; }
      out.push({ date: c.date || '', amt: parseFloat(c.amt) || 0, cat, qid: q.id });
    }); });
    return out;
  }
  function extraExp() {
    const out = [], intro = {};
    Q.forEach((q) => { arr(q.costs).forEach((c) => { if (isIntro(c)) intro[c.id] = q.id; }); });
    PAY.forEach((p) => {
      if (!p || !p.id) return; const d = paidOn(p); if (!d) return; const id = String(p.id); let cat = '', cid = '';
      if (/^pay_sales_/.test(id)) cat = '業務抽成'; else if (/^comm_/.test(id)) cat = '業主端佣金';
      else { cid = p.costId && intro[p.costId] ? p.costId : ''; if (!cid) Object.keys(intro).some((k) => { if (id === 'pay' + k || id.indexOf('pay' + k + '_') === 0) { cid = k; return true; } return false; }); if (cid) cat = '介紹費'; }
      if (!cat) return;
      // qid 只給結案損益按專案加總用（年度損益不看 qid，跟前端一樣）；介紹費應付沒有 quoteId → 從介紹費卡反查
      out.push({ date: d, amt: Math.round(parseFloat(p.amount) || 0), cat, qid: p.quoteId || (cid ? intro[cid] : '') || '' });
    });
    return out;
  }
  const data = { invoices: INV, expenses: arr(inp.expenses), payslips: arr(inp.payslips), costEntries: costEntries(), extraExp: extraExp() };
  return { P, Q, INV, PAY, taxM, taxR, retention, data };
}

// 同前端 _shareMonths（now 用台北時間）
function shareMonths(y, now) { const t = new Date(now + 8 * 3600 * 1000); const cy = String(t.getUTCFullYear()); if (y < cy) return 12; if (y > cy) return 0; return t.getUTCMonth() + 1; }

// 年度管理用損益：跟前端 _shRptYear 的 yearMgmt＋taxAdj 同一個呼叫（不含分潤、得標、財務、各案這些畫面用的附加欄位）
function yearMgmt(inp, Y, now) {
  const c = ctx(inp);
  const hrEstimate = (y) => FJC.rpt.shareAutoMgmt(c.data, y, { taxM: c.taxM, months: shareMonths(y, now), salaryMonth: SHARE_SALARY_MONTH }, { taxM: c.taxM, retention: c.retention }).salary;
  const d = FJC.rpt.yearMgmt(c.data, String(Y), { taxM: c.taxM, retention: c.retention, rcvIn: FJC.inv.rcvIn, hrEstimate });
  FJC.rpt.taxAdj(d);
  return { d, c };
}
const SNAP_KEYS = ['revTax', 'ret', 'revNet', 'recv', 'cost', 'gross', 'exp', 'hr', 'hrEst', 'pretax', 'vat', 'inctax', 'afterTax'];
function pick(d) { const o = {}; SNAP_KEYS.forEach((k) => { if (d[k] !== undefined) o[k] = d[k]; }); o.costByCat = d.costByCat || {}; o.expByCat = d.expByCat || {}; o.monthly = d.monthly || []; return o; }

// 月損益快照：ym＝'YYYY-MM'（通常是上個月）→ {ym, at, ytd（該年的管理用損益）, month（該月 rev／cost／recv）}
// 審查：ytd 是「算的當下」的整年累計（凍結上個月時已含本月初的資料）；要看截至該月底的累計用 cum（1 月到該月的各月加總）
function monthSnap(inp, ym, now) {
  const Y = ym.slice(0, 4), m = parseInt(ym.slice(5, 7), 10);
  const { d } = yearMgmt(inp, Y, now);
  const mm = (d.monthly || []).slice(0, m), cum = { rev: 0, cost: 0, recv: 0 };
  mm.forEach((x) => { cum.rev += x.rev || 0; cum.cost += x.cost || 0; cum.recv += x.recv || 0; });
  return { ym, at: now, basis: 'mgmt', ytdAsOf: now, ytd: pick(d), cum, month: (d.monthly || [])[m - 1] || { m, rev: 0, cost: 0, recv: 0 } };
}

// 結案損益：已結案的主約（含追加），同一套管理用口徑按專案加總。
// 審查：結案後還可能補付抽成、介紹費、廠商最後一期 → 結案後 90 天內每天重算（firstAt 記第一次），過了 90 天才凍結；done＝已凍結（不重算）的報價 id
const CLOSE_SETTLE_MS = 90 * 86400000;
function frozenIds(prev, now) { const out = {}; Object.keys(prev || {}).forEach((k) => { const s = prev[k]; if (s && now - (s.firstAt || s.at || 0) > CLOSE_SETTLE_MS) out[s.qid || decKey(k)] = 1; }); return out; }
function closeSnaps(inp, done, now, prev) {
  const pv = {}; Object.keys(prev || {}).forEach((k) => { const s = prev[k]; if (s) pv[s.qid || decKey(k)] = s; });
  const c = ctx(inp), out = {};
  c.Q.filter((q) => q.awarded && !q.parentId && q.closed && !(done && done[q.id])).forEach((q) => {
    const ids = {}; ids[q.id] = 1; c.Q.forEach((x) => { if (x.parentId === q.id) ids[x.id] = 1; });
    const invs = c.INV.filter((i) => i && i.kind !== 'retReturn' && (ids[i.quoteId] || ids[i.sourceQid] || (!i.quoteId && !i.sourceQid && i.project === q.name)));
    const rev = Math.round(invs.reduce((a, i) => a + FJC.rpt.invRev(i, c.taxM, c.retention), 0));
    const ce = c.data.costEntries.filter((e) => ids[e.qid]);
    const cost = Math.round(ce.reduce((a, e) => a + num(e.amt), 0));
    const comm = Math.round(c.data.extraExp.filter((e) => ids[e.qid]).reduce((a, e) => a + num(e.amt), 0));   // 已付的業務抽成、業主端佣金、介紹費
    const costByCat = {}; ce.forEach((e) => { costByCat[e.cat] = Math.round((costByCat[e.cat] || 0) + num(e.amt)); });
    out[q.id] = { qid: q.id, name: String(q.name || '').slice(0, 60), at: now, firstAt: (pv[q.id] && (pv[q.id].firstAt || pv[q.id].at)) || now, basis: 'mgmt', revNet: rev, cost, gross: rev - cost, comm, net: rev - cost - comm, nInv: invs.length, costByCat };
  });
  return out;
}

// 第 18 項：結案損益快照的成本分類 → CSV（FJ 只出檔，回寫系統外的單價庫由陳軒做）
function costExportCsv(snaps) {
  const rows = [['報價id', '工程名稱', '成本分類', '金額（未稅）', '快照日期']];
  Object.keys(snaps || {}).sort().forEach((k) => { const s = snaps[k] || {}; Object.keys(s.costByCat || {}).sort().forEach((cat) => rows.push([s.qid || k, s.name || '', cat, Math.round(num(s.costByCat[cat])), s.at ? tpeYmd(s.at) : ''])); });
  // 審查：開頭是 = + - @ 的字加 ' 防 Excel 公式注入（金額是數字不受影響）
  const cell = (v) => { let t = String(v == null ? '' : v); if (typeof v === 'string' && /^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
}

module.exports = { CLOSE_SETTLE_MS, frozenIds, deepDec, ctx, yearMgmt, monthSnap, closeSnaps, costExportCsv, mergeQuotes, shareMonths, SNAP_KEYS, tpeYmd };
