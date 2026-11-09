// 第 6 步 6-2a：衍生應付的雲端比對（先比對、不寫應付；Lotion 11/07 第 5、6 題定案）
// 雲端用同一套算法（calc/payable.js、calc/comm.js、calc/todo.js）把「應該有的自動應付」重算一份，跟網頁存的 fydata/private/payables 逐筆比。
// 這裡只做資料準備，跟前端一行對一行（改前端下面這些函式要同步改這裡，冒煙測試拿同一份假資料兩邊逐筆比對）：
//   _syncSubPeriodPayables（分包期別、保留款退還、提前放款、預付款）、syncCostToPayable 的分派、_introSyncCard／_introTrigger／_introAmtOf／_introBase（介紹費）、
//   _salesCommSync／_salesCommCfg／_salesCommNorm／_salesBase／_salesProfitBase／_salesUnitQty（業務抽成）、_commSync／_commList／_commFromReferral（業主端佣金）。
// 第一批範圍（設計文件第 7 題）：分包期別、保留款退還、預付款、介紹費、業務抽成、業主端佣金。薪資類、自有材料整筆應付不比。
// 比的欄位：對象、金額（已付後有差額另立 _d<n> 的，本體＋差額合計）、含稅（incl，只比還沒付的）、開不開發票（手動改過稅別的不比）。
//   到期日不比：網頁已存的到期日會保留（舊期別不回溯），雲端沒有「舊值」可對；切換（6-2b）時到期日照舊由網頁保留。
// 已付（含付過一部分）的抽成／佣金網頁不再重算 → 列為「已付不重算」，不算不一致。
'use strict';
process.env.TZ = 'Asia/Taipei';   // calc/todo.js 用本地時間，跟台灣的瀏覽器一樣

function req(name) {   // 部署時 calc/ 由 tools/copy-calc.js 複製到 functions/calc/；在 repo 裡測試直接讀根目錄 calc/
  try { return require('../calc/' + name); } catch (e) { return require('../../calc/' + name); }
}
const FJC = Object.assign({}, req('invoice.js'), req('payable.js'), req('comm.js'), req('todo.js'));

const EXPLAIN_MS = 36 * 3600 * 1000;   // 第 6 題：36 小時內改過的（網頁剛改、雲端還沒跑到）＝能解釋的時間差，不中斷連續一致
const STREAK_DAYS = 28;                // 連續 4 週
const DAYS_KEEP = 70;

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function decKey(k) { return String(k).replace(/~d~/g, '.').replace(/~h~/g, '#').replace(/~s~/g, '$').replace(/~sl~/g, '/').replace(/~lb~/g, '[').replace(/~rb~/g, ']'); }
function deepDec(o) { if (Array.isArray(o)) return o.map(deepDec); if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach((k) => { r[decKey(k)] = deepDec(o[k]); }); return r; } return o; }
function num(x) { const n = parseFloat(x); return isFinite(n) ? n : 0; }
function tpeYmd(ts) { return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function uFix(u) { if (u == null) return ''; return String(u).replace(/[Mm]\s*[2²㎡](?![0-9])/g, 'm²').replace(/㎡/g, 'm²'); }   // 同前端 _uFix
const SALES_MODES = { rev: 1, profit: 1, amt: 1, unit: 1 };   // 同前端 _SALES_MODES 的鍵

// 成本卡裡的陣列（明細列、期別、期別明細、提前放款、預付款）也可能被 RTDB 存成物件
function normCost(c) {
  if (!c || typeof c !== 'object') return c;
  const o = Object.assign({}, c);
  ['rows', 'periods', 'advances'].forEach((k) => { if (o[k] != null) o[k] = arr(o[k]); });
  if (o.periods) o.periods = o.periods.map((per) => { const x = Object.assign({}, per); if (x.rows != null) x.rows = arr(x.rows); if (x.early != null) x.early = arr(x.early); return x; });
  return o;
}
// 報價：共用區的報價＋private 的 quoteSens（成本卡、業務抽成、佣金、成本單價、報價成本合計）——同前端 _applyQuoteSensAll 之後的 Q
function mergeQuotes(sharedQuotes, quoteSens) {
  const S = {}; Object.keys(quoteSens || {}).forEach((k) => { S[decKey(k)] = quoteSens[k]; });
  return arr(sharedQuotes).filter((q) => q && q.id).map((q) => {
    const s = S[q.id], c = Object.assign({}, q); if (!s) return c;
    if (s.costs) c.costs = arr(s.costs).map(normCost);   // 審查：RTDB 有洞的陣列會回物件 → 一律 arr()
    if (s.comm && typeof s.comm === 'object') c.comm = s.comm;
    if (s.comms && arr(s.comms).length) c.comms = arr(s.comms); else if (s.referral) c.referral = s.referral;
    if (s.t && typeof s.t === 'object') c.t = Object.assign({}, q.t || {}, s.t);
    c._sensMt = num(s._mt);
    return c;
  });
}

function ctx(inp0) {
  const inp = deepDec(inp0 || {});
  const P = Object.assign({}, inp.params || {}), Q = mergeQuotes(inp.quotes, inp.quoteSens), INV = arr(inp.invoices).map((i) => FJC.todo.invUnpack(i)), CT = arr(inp.contracts), PAY = arr(inp.payables);
  if (P.sales != null) P.sales = arr(P.sales);
  const PAID = inp.paidLog || {};   // 付款帳本（已付的最後防線）：網頁 _payPaidAny 也看它
  const taxR = FJC.inv.taxR(P.tax), taxM = FJC.inv.taxM(P.tax);
  const removeRate = (() => { const v = P.removeRate; if (v == null || v === '') return 30; const x = parseFloat(v); return isNaN(x) ? 30 : Math.max(0, Math.min(100, x)); })();
  const instDef = Math.max(0, 100 - removeRate);
  const today = tpeYmd(inp.now || Date.now());
  const kids = (q) => Q.filter((x) => x && x.parentId === q.id);
  const ctOf = (q) => CT.find((c) => c.linkedQid === q.id) || CT.find((c) => c.name && c.name === q.name) || null;   // 同 _ctAmtOf／_introBase
  const ctAmtOf = (q) => { const ct = ctOf(q); return ct ? num(ct.amount) : 0; };
  const addsWonAmt = (q) => kids(q).filter((x) => x.awarded).reduce((s, x) => { const a = ctAmtOf(x); return s + (a > 0 ? a : num(x.t && x.t.total)); }, 0);
  const wonAmt = (q) => { const a = ctAmtOf(q); return (a > 0 ? a : num(q.t && q.t.total)) + addsWonAmt(q); };
  const invsOfQuote = (q) => { const nm = String(q.name || '').trim(), seen = {}, out = []; INV.forEach((i) => { if (!i || seen[i.id]) return; const hit = i.quoteId === q.id || i.sourceQid === q.id || (!i.quoteId && !i.sourceQid && nm && String(i.project || '').trim() === nm); if (hit) { seen[i.id] = 1; out.push(i); } }); return out; };
  const invsOfQuoteAll = (q) => { const seen = {}, out = []; [q].concat(kids(q)).forEach((qq) => invsOfQuote(qq).forEach((i) => { if (i.kind === 'retReturn') return; if (!seen[i.id]) { seen[i.id] = 1; out.push(i); } })); return out; };
  return { P, Q, INV, CT, PAY, PAID, taxR, taxM, instDef, today, kids, ctOf, ctAmtOf, wonAmt, invsOfQuoteAll };
}

// ── 分包期別、保留款退還、提前放款、預付款（同 _syncSubPeriodPayables；開頭的修復 _advPayHeal 等是改資料的，存回去之後雲端讀到的就是修好的）──
function subExpect(C, q, c, webById, out) {
  const vendor = c.vendor || '';
  if (!vendor || vendor === '公司支出（自付）') return;   // 網頁：撤掉沒付的（已付保留）→ 雲端什麼都不該有
  const inv = FJC.pay.invoice(c), advI = FJC.pay.advInclAlloc(c, C.taxR, C.instDef);
  const early = (per) => (per && Array.isArray(per.early)) ? per.early : [];
  FJC.pay.periods(c).forEach((per) => {
    const pid = FJC.pay.payId(c.id, per), k = FJC.pay.periodCalc(c, per, C.instDef), es = per.isRet ? 0 : early(per).reduce((a, e) => a + Math.round(num(e.amt)), 0);
    const amt = per.isRet ? k.amt : Math.max(0, k.pay - es);
    if (per.isRet || amt > 0) {
      const e = { id: pid, kind: per.isRet ? 'ret' : 'period', qid: q.id, cid: c.id, to: vendor, amount: amt, vat: inv };
      if (!per.isRet && k.adv > 0 && inv && advI[per.no] != null) {
        const ei = early(per).reduce((a2, x) => a2 + Math.round(Math.round(num(x.amt)) * C.taxM), 0);
        e.incl = Math.max(0, Math.round(k.net * C.taxM) - advI[per.no] - ei);
      }
      if (!per.isRet && per.inclFix && inv && Math.round(+per.inclFix.pay) === Math.round(amt) && (per.inclFix.net == null || Math.round(+per.inclFix.net) === Math.round(+k.net || 0)) && (per.inclFix.tr == null || +per.inclFix.tr === +C.taxR)) e.incl = Math.round(+per.inclFix.v);
      out.push(e);
    }
    if (!per.isRet) early(per).forEach((x) => out.push({ id: FJC.pay.earlyId(c.id, per, x), kind: 'early', qid: q.id, cid: c.id, to: vendor, amount: Math.round(num(x.amt)), vat: inv }));
  });
  FJC.pay.advs(c).forEach((a) => {
    const id = FJC.pay.advPayId(c.id, a), w = webById[id];
    if (w && w.convTo) return;   // 6-1b 已轉成付款紀錄的不重建
    out.push({ id, kind: 'adv', qid: q.id, cid: c.id, to: vendor, amount: Math.round(num(a.amt)), vat: inv });
  });
}

// ── 介紹費（非跟隨：同 _introSyncCard）──
const introFollows = (f) => !!f && (!f.introPay || f.introPay === 'follow' || f.introPay === 'b2b');
const introCalcOf = (f) => f.introCalc || ((f.rows || []).some((r) => r.ppm != null) ? 'm' : 'pc');
function introTrigger(C, q, f) {
  const pay = f.introPay || 'follow';
  if (pay === 'first') { const inv = C.invsOfQuoteAll(q).slice().sort((a, b) => (parseInt(a.periodNo) || 1) - (parseInt(b.periodNo) || 1))[0]; return inv ? (inv.date || C.today) : ''; }
  if (pay === 'done') { if (q.closed) return 'closed'; const ct = C.ctOf(q); return (ct && (ct.status === 'completed' || ct.status === 'done')) ? C.today : ''; }
  if (pay === 'remove') { let L = ''; (q.dailyLogs || []).forEach((x) => { if (x && x.status === 'stage' && x.stageOf === 'remove') { const d = x.stageDate || x.date || ''; if (!L || d < L) L = d; } }); return L; }
  return '';
}
function introBase(C, q) { const a = C.ctAmtOf(q); return a > 0 ? Math.round(a / C.taxM) : Math.round((q.t && q.t.sub) || 0); }
function introAmtOf(C, q, f) {
  const calc = introCalcOf(f);
  if (calc === 'pct') return Math.round(introBase(C, q) * num(f.introAmt) / 100);
  if (calc === 'lump') return Math.round(num(f.introAmt));
  const em = FJC.todo.actQtyMap(q, C.INV); let t = 0;
  (f.rows || []).forEach((r) => { let qn = num(r.qty); const it = (r.linkedItemIdx >= 0 && q.items) ? q.items[r.linkedItemIdx] : null; if (it) { const e = FJC.todo.effQty(em, it); if (e > 0) qn = e; } t += qn * num(r.unitPrice); });
  return Math.round(t);
}
function introExpect(C, q, f, out) {
  const pid = 'pay' + f.id + '_intro', trig = introTrigger(C, q, f);
  const adv = FJC.pay.advs(f).reduce((a, x) => a + Math.round(num(x.amt)), 0);
  const amt = Math.max(0, introAmtOf(C, q, f) - adv);
  if (!trig || amt <= 0 || !f.vendor) return;
  out.push({ id: pid, kind: 'intro', qid: q.id, cid: f.id, to: f.vendor, amount: amt, vat: FJC.pay.invoice(f) });
}

// ── 業務抽成、業主端佣金（同 _salesCommSync／_commSync；算法 calc/comm.js）──
function commNorm(c) {
  if (!c || typeof c !== 'object') return null;
  const mode = c.mode === 'pct' ? 'rev' : c.mode, val = c.val != null ? parseFloat(c.val) : (c.mode === 'amt' ? parseFloat(c.amt) : parseFloat(c.rate));
  if (!SALES_MODES[mode] || !(val > 0)) return null;
  const o = { mode, val }; if (mode === 'unit') o.unit = uFix(String(c.unit || '支').trim() || '支'); return o;
}
function salesById(C, id) { const a = Array.isArray(C.P.sales) ? C.P.sales : []; return id ? (a.find((x) => x && x.id === id) || null) : null; }
function salesCfg(C, q) {
  if (!q || !q.salesId) return null;
  const o = commNorm(q.comm); if (o) return o;
  const sp = salesById(C, q.salesId); if (!sp) return null;
  return commNorm({ mode: sp.commMode || (sp.defRate > 0 ? 'rev' : ''), val: sp.commVal != null && sp.commVal !== '' ? sp.commVal : sp.defRate, unit: sp.commUnit });
}
function unitQty(C, q, unit) {   // 同 _salesUnitQty
  const u = uFix(unit || '支'), all = [q].concat(C.kids(q)), descs = {}; let contract = 0, billed = 0;
  all.forEach((x) => { const m = FJC.todo.effQtyMap(x, C.INV); (x.items || []).forEach((it) => { if (!it || it.sec || (!it.spare && num(it.price) < 0) || uFix(it.unit || '') !== u) return; contract += Math.abs(FJC.todo.effQty(m, it)) || 0; descs[String(it.desc || '').trim()] = 1; }); });
  C.INV.forEach((i) => { if (!i) return; const same = (i.quoteId && all.some((x) => x.id === i.quoteId)) || String(i.project || '').trim() === String(q.name || '').trim(); if (!same) return;
    (i.items || []).forEach((x) => { if (!x || x.type === 'sec' || x.type === 'rental' || x.neg) return; if (!descs[String(x.desc || '').trim()]) return; const r = x.payRate == null ? 100 : parseFloat(x.payRate); billed += num(x.curQty) * (isFinite(r) ? r : 100) / 100; }); });
  return { unit: u, contract: Math.round(contract * 100) / 100, billed: Math.round(billed * 100) / 100 };
}
// 毛利基礎的成本：前端 _projCostTotal 先 recalcCostAmt 再加總 c.amt；雲端讀存好的 c.amt（每次改成本卡都會重算並存回）
function getFor(C, q, cfg) {
  const base = () => FJC.comm.salesBase(C.wonAmt(q), C.taxM);
  return {
    base,
    profit: () => { const all = [q].concat(C.kids(q)); const cost = all.reduce((a, x) => a + arr(x.costs).reduce((b, c) => b + num(c.amt), 0), 0); const est = cost > 0 ? 0 : all.reduce((a, x) => a + num(x.t && x.t.cost), 0); return FJC.comm.profitBase(base(), cost, est); },
    unit: () => unitQty(C, q, cfg && cfg.unit),
    rate: () => 0,   // 應付金額（due）用不到收款進度
  };
}
function salesExpect(C, q, out) {
  if (!q || !q.id || q.parentId) return;
  const cfg = salesCfg(C, q), sp = salesById(C, q.salesId), who = sp ? (sp.name || '') : '';
  const amt = q.awarded ? ((cfg && cfg.mode === 'unit') ? Math.round(unitQty(C, q, cfg.unit).billed * cfg.val) : FJC.comm.amount(cfg, getFor(C, q, cfg))) : 0;
  if (amt > 0 && who) out.push({ id: 'pay_sales_' + q.id, kind: 'sales', qid: q.id, to: who, amount: amt, vat: false });
}
function commList(q) {
  if (Array.isArray(q.comms) && q.comms.length) return q.comms.filter((c) => c && c.name);
  const ref = q.referral; if (!ref || !ref.name) return [];   // 同 _commFromReferral（網頁讀到時一次性轉換）
  const cap = num(ref.cap), rate = num(ref.rate), amt = num(ref.amount) || num(ref.fixAmt), fixed = ref.mode === 'amt' || cap > 0 || !(rate > 0);
  return [{ id: 'ref', name: String(ref.name), mode: fixed ? 'amt' : 'rev', val: fixed ? Math.round(amt) : rate }];
}
function commExpect(C, q, out) {
  if (!q || !q.id || q.parentId) return;
  commList(q).forEach((c) => {
    const cfg = commNorm(c), id = c.id === 'ref' ? ('comm_' + q.id) : ('comm_' + q.id + '_' + c.id), amt = q.awarded ? FJC.comm.due(cfg, getFor(C, q, cfg)) : 0;
    if (amt > 0) out.push({ id, kind: 'comm', qid: q.id, to: c.name, amount: amt, vat: false });
  });
}

// ── 全部算一次 → 跟網頁比 ──
function expectAll(C) {
  const webById = {}; C.PAY.forEach((p) => { if (p && p.id) webById[p.id] = p; });
  const out = [], scope = { cids: {}, qids: {}, intro: {} };
  C.Q.forEach((q) => {
    arr(q.costs).forEach((c) => {
      if (!c || !c.id) return;
      // 同 syncCostToPayable 的分派
      if (c.type === 'sub' && c.isIntro && !introFollows(c)) { scope.cids[c.id] = q.id; scope.intro[c.id] = 1; subExpect(C, q, c, webById, out); introExpect(C, q, c, out); return; }
      if (c.type === 'own' && c.rental) { scope.cids[c.id] = q.id; if (FJC.pay.periods(c).length) subExpect(C, q, c, webById, out); return; }
      if (c.type === 'sub' && (FJC.pay.periods(c).length || FJC.pay.advs(c).length)) { scope.cids[c.id] = q.id; subExpect(C, q, c, webById, out); return; }
      // 其他（沒計價的分包、自有材料整筆）不在第一批
    });
    if (!q.parentId) { scope.qids[q.id] = 1; salesExpect(C, q, out); commExpect(C, q, out); }
  });
  return { out, webById, scope };
}
const paidHard = (p, PAID) => { if (!p) return false; if (p.status === 'paid') return true; const l = PAID && PAID[p.id]; return !!(l && (+l.paidAt || 0) > (+l.unpaidAt || 0)); };   // 同前端 _payPaidHard
const locked = (p, PAID) => !!p && (paidHard(p, PAID) || FJC.pay.paysOf(p).length > 0);   // 同前端 _payPaidAny／_payLocked
function inScopeWeb(p, scope) {   // 網頁存的應付，哪些是第一批的自動應付
  const id = String(p.id || '');
  if (p.deltaOf) return false;   // 差額筆跟著本體算
  let m = id.match(/^pay_sales_(.+)$/); if (m) return !!scope.qids[m[1]];
  if (/^comm_/.test(id)) { if (p.quoteId) return !!scope.qids[p.quoteId]; return Object.keys(scope.qids).some((qid) => id === 'comm_' + qid || id.indexOf('comm_' + qid + '_') === 0); }   // 審查：先看 quoteId，報價 id 含底線也不會認錯
  if (p.costId && scope.cids[p.costId] && id.indexOf('pay' + p.costId + '_') === 0) {
    if (id === 'pay' + p.costId + '_intro' && !scope.intro[p.costId]) return false;   // 審查：網頁 keep 永遠留著 _intro（改成跟隨後的舊筆不會刪）
    return true;
  }
  return false;
}
function compare(inp, now) {
  now = now || Date.now();
  const C = ctx(Object.assign({}, inp, { now })), { out, webById, scope } = expectAll(C);
  const qById = {}; C.Q.forEach((q) => { qById[q.id] = q; });
  // 審查：「剛改過」只看跟應付有關的：這筆應付自己、成本卡（quoteSens）、這案的請款單、合約；報價本身的修改時間（每天的日報都會動）不算
  const relMt = {}; const bump = (qid, t) => { if (qid && num(t) > num(relMt[qid])) relMt[qid] = num(t); };
  C.Q.forEach((q) => { bump(q.id, q._sensMt); if (q.parentId) bump(q.parentId, q._sensMt); });
  C.INV.forEach((i) => { const t = num(i._mt || i.updatedAt); [i.quoteId, i.sourceQid].forEach((id) => { if (id) { bump(id, t); const q = qById[id]; if (q && q.parentId) bump(q.parentId, t); } }); if (!i.quoteId && !i.sourceQid && i.project) C.Q.forEach((q) => { if (String(q.name || '').trim() === String(i.project).trim()) bump(q.id, t); }); });
  C.CT.forEach((c) => { const t = num(c._mt || c.updatedAt); if (c.linkedQid) bump(c.linkedQid, t); else C.Q.forEach((q) => { if (c.name && q.name === c.name) bump(q.id, t); }); });
  const fam = {}; C.PAY.forEach((p) => { if (p && p.deltaOf) (fam[p.deltaOf] = fam[p.deltaOf] || []).push(p); });
  const exp = {}; out.forEach((e) => { exp[e.id] = e; });
  const recent = (w, qid) => { const t = Math.max(num(w && w._mt), num(w && w.updatedAt), num(relMt[qid])); return t > 0 && now - t < EXPLAIN_MS; };
  const items = []; let ok = 0, skip = 0;
  const add = (o) => { o.explained = recent(webById[o.id], o.qid); o.name = (qById[o.qid] && qById[o.qid].name) || ''; items.push(o); };
  out.forEach((e) => {
    const w = webById[e.id];
    if (!w) { add({ id: e.id, kind: e.kind, qid: e.qid, why: 'missing', cloud: { to: e.to, amount: e.amount } }); return; }
    if (w.voidAt) { add({ id: e.id, kind: e.kind, qid: e.qid, why: 'void', cloud: { amount: e.amount }, web: { amount: num(w.amount) } }); return; }
    if ((e.kind === 'sales' || e.kind === 'comm') && locked(w, C.PAID)) { skip++; return; }   // 已付（含付過一部分）網頁不再重算
    const tot = Math.round(num(w.amount) + (fam[e.id] || []).reduce((a, d) => a + num(d.amount), 0));
    const diffs = [];
    if (tot !== Math.round(e.amount)) diffs.push('amount');
    const paidBody = e.kind !== 'intro' && w.status === 'paid';   // 審查：已付的期別／保留款／提前放款／預付款網頁不再改對象和稅別（只另立差額）→ 只比金額
    if (!paidBody && String(w.to || '') !== String(e.to || '')) diffs.push('to');
    if (!paidBody && !w.vatManual && !!w.vat !== !!e.vat && e.kind !== 'sales' && e.kind !== 'comm') diffs.push('vat');
    if (!locked(w, C.PAID) && (w.incl == null ? null : Math.round(+w.incl)) !== (e.incl == null ? null : e.incl)) diffs.push('incl');
    if (!diffs.length) { ok++; return; }
    add({ id: e.id, kind: e.kind, qid: e.qid, why: diffs.join(','), cloud: { to: e.to, amount: e.amount, vat: !!e.vat, incl: e.incl == null ? null : e.incl }, web: { to: w.to || '', amount: tot, vat: !!w.vat, incl: w.incl == null ? null : Math.round(+w.incl) } });
  });
  C.PAY.forEach((p) => {
    if (!p || !p.id || exp[p.id] || !inScopeWeb(p, scope)) return;
    if (locked(p, C.PAID) || p.convTo || p.voidAt) { skip++; return; }   // 已付、已轉換、已作廢的網頁都留著，不算多出來
    const qid = p.quoteId || scope.cids[p.costId] || '';
    add({ id: p.id, kind: 'extra', qid, why: 'extra', web: { to: p.to || '', amount: Math.round(num(p.amount)) } });
  });
  const bad = items.filter((x) => !x.explained).length;
  items.sort((a, b) => (a.explained - b.explained) || String(a.id).localeCompare(String(b.id)));
  return { at: now, day: tpeYmd(now), n: { exp: out.length, ok, skip, diff: items.length, bad, explained: items.length - bad }, ok: bad === 0, items: items.slice(0, 200) };
}
// 連續一致天數（從最近一天往回數；能解釋的不中斷，沒跑的那天中斷）＋這段期間有沒有跨過一次 25 日（月請款）
function streak(days, today, cutDay) {
  let n = 0, d = today, cross = false; const cd = parseInt(cutDay) || 25;
  for (let i = 0; i < DAYS_KEEP; i++) {
    const r = days && days[d]; if (!r || !r.ok) break;
    n++; if (+d.slice(8, 10) === cd) cross = true;
    const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); d = t.toISOString().slice(0, 10);
  }
  return { n, cross, ready: n >= STREAK_DAYS && cross };
}
module.exports = { ctx, expectAll, compare, streak, mergeQuotes, EXPLAIN_MS, STREAK_DAYS, DAYS_KEEP, tpeYmd };
