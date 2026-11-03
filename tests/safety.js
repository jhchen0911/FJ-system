// 健檢 3 第三節：改版前的四道安全網（只加測試、不改程式）
//   ① 同步合併：兩台裝置交錯修改、付款／改回未付的先後、墓碑、180 天沒開的舊裝置、舊版裝置上傳
//   ② 衍生應付重跑：分包期別／預付款／成本卡的自動應付重算 N 次結果完全相同；已付的那筆怎麼重算都不會被刪、不會變回待付；手動應付切稅別、刪除正常
//   ③ 備份來回：在 A 頁做資料、取全量備份內容（exportData 用的同一份 _syncPayload）→ 全新 B 頁用 importData 匯入 → 再取一次，兩份逐欄相同（不含時間戳）；
//      報價、請款、應付、合約、客戶、廠商、費用、薪資、薪資單、零用金、材料台帳、單價歷史、分潤、專案（4a）都放資料，沒放到就算失敗
//   ⑤ 金額寫法：讀已收款只能經 _invRcvOwner／_invRcv，稅率不准寫死 1.05（第 2b 步）
//   ④ 包裝白名單：程式裡「用 x=function 覆寫同名函式」的地方只能是白名單上這幾個（第 2a 步拆包裝時同步刪白名單）
//
//   npm run safety              跑四項
//   node tests/safety.js --selftest   反向驗證：每項各故意改壞一處，該項一定要變紅
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');
const RESET = fs.readFileSync(path.join(__dirname, 'synthetic', 'reset.js'), 'utf8');

// ④ 包裝白名單：第 2a 步（v6.0.127）已全部拆完，白名單清空——之後一處都不能新增（規則 9：改原函式本體）。
//    掃描範圍：同名頂層函式（含 async）被「X=function／X=async function／X=箭頭函式」重新指定，連函式內同名的區域變數也算（容易看錯）
const WRAP_WHITELIST = {};
function wrapScan(src) {
  const fns = new Set([...src.matchAll(/^(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/gm)].map(m => m[1]));
  const hits = {};
  for (const m of src.matchAll(/(?:^|[;{}\s,])(?:window\.)?([\w$]+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/gm)) if (fns.has(m[1])) hits[m[1]] = (hits[m[1]] || 0) + 1;
  // 最外層（第 0 欄）把同名函式重新指定成任何東西也算：例如漏刪的別名「var _fCore=f」會讓 _fCore 指回包裝、無限遞迴（2a 審查抓到）
  const seen = new Set();
  for (const m of src.matchAll(/^(?:var\s+|let\s+|const\s+|window\.)?([\w$]+)\s*=(?![=>])|^var\s+[^;\n]*?,\s*([\w$]+)\s*=(?![=>])/gm)) {
    const n = m[1] || m[2]; if (!fns.has(n) || seen.has(m.index)) continue; seen.add(m.index);
    if (!/^(?:window\.)?[\w$]+\s*=\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/.test(m[0] + src.slice(m.index + m[0].length, m.index + m[0].length + 20))) hits[n] = (hits[n] || 0) + 1;
  }
  return hits;
}
// ⑤ 金額寫法（第 2b 步，v6.0.128）：讀「已收款」只能經 _invRcvOwner／_invRcv（另記保留款退還才不會漏）；稅率不准寫死 1.05
function testMoneyStatic(root) {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const bad = [];
  src.split('\n').forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    const c2 = code.replace(/\bd\.received\s*\/\s*10000/g, '');   // rProfit 的月資料 d.received（不是請款單）
    if (/\.received\b(?!\s*=[^=])/.test(c2) && !/^function _invRcvOwner\(/.test(l)) bad.push('第 ' + (i + 1) + ' 行直接讀 received');
    if (/[*\/]\s*1\.05\b|1\.05\s*\*/.test(code) && /amt|amount|total|tot\b|tax|price|cost|稅|金額|fmt\(/i.test(code)) bad.push('第 ' + (i + 1) + ' 行寫死 1.05');   // 只看算錢的行（圖面座標的 1.05 不算）
  });
  return { ok: !bad.length, info: bad.length ? bad.slice(0, 5).join('、') : '已收款只走 _invRcvOwner／_invRcv、沒有寫死 1.05' };
}
function testWrap(root) {
  const hits = wrapScan(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  const added = Object.keys(hits).filter(k => hits[k] > (WRAP_WHITELIST[k] || 0));
  const gone = Object.keys(WRAP_WHITELIST).filter(k => (hits[k] || 0) < WRAP_WHITELIST[k]);
  return { ok: !added.length && !gone.length, info: (added.length ? '新增包裝：' + added.join('、') + '（規則 9：改原函式本體）' : '') + (gone.length ? (added.length ? '；' : '') + '已拆掉、請從白名單刪：' + gone.join('、') : '') || (Object.keys(WRAP_WHITELIST).length ? '共 ' + Object.values(hits).reduce((a, b) => a + b, 0) + ' 處，與白名單相同' : '0 處（第 2a 步已全部拆完）') };
}

// ① 同步合併（在頁面裡跑）
const SYNC = async () => {
  const day = 86400000, now = Date.now(), r = {};
  const ids = a => a.map(x => x.id + ':' + (x.v || x.status || '')).sort().join(',');
  // 交錯修改：A 本機較新、B 雲端較新、C 只有雲端、D 只有本機
  TOMBS = {};
  const m1 = _mergeColl([{ id: 'A', v: 'L', _mt: 200 }, { id: 'B', v: 'L', _mt: 100 }, { id: 'D', v: 'L', _mt: 50 }],
    [{ id: 'A', v: 'C', _mt: 150 }, { id: 'B', v: 'C', _mt: 300 }, { id: 'C', v: 'C', _mt: 10 }], 'quotes', {});
  r.interleave = ids(m1) === 'A:L,B:C,C:C,D:L';
  // 付款先後：雲端已付（paidAt 500），本機待付但重算過 _mt 較新、沒按過改回未付 → 仍是已付
  const p1 = _mergeColl([{ id: 'P1', status: 'pending', amount: 100, _mt: 900 }], [{ id: 'P1', status: 'paid', paidAt: 500, paidDate: '2026-10-01', amount: 100, _mt: 500 }], 'payables', {});
  // 真的按了改回未付（unpaidAt 700 晚於 paidAt 500）→ 待付
  const p2 = _mergeColl([{ id: 'P2', status: 'pending', unpaidAt: 700, amount: 100, _mt: 700 }], [{ id: 'P2', status: 'paid', paidAt: 500, amount: 100, _mt: 500 }], 'payables', {});
  // 反過來：本機已付較舊、雲端待付較新但沒有 unpaidAt → 已付
  const p3 = _mergeColl([{ id: 'P3', status: 'paid', paidAt: 400, amount: 100, _mt: 400 }], [{ id: 'P3', status: 'pending', amount: 100, _mt: 800 }], 'payables', {});
  r.payOrder = p1[0].status === 'paid' && p1[0].paidDate === '2026-10-01' && p2[0].status !== 'paid' && p3[0].status === 'paid';
  // 墓碑：雲端墓碑殺掉本機那筆；本機墓碑殺掉雲端那筆
  const t1 = _mergeColl([{ id: 'X', _mt: 999 }, { id: 'Y', _mt: 1 }], [{ id: 'Z', _mt: 1 }], 'quotes', { quotes: { X: now } });
  TOMBS = { quotes: { Z: now } };
  const t2 = _mergeColl([{ id: 'Y', _mt: 1 }], [{ id: 'Z', _mt: 5 }], 'quotes', {});
  r.tombs = ids(t1) === 'Y:,Z:' && ids(t2) === 'Y:';
  // 180 天沒開的舊裝置：本機那筆 200 天前改的、雲端較新 → 雲端勝；200 天前的舊墓碑會被清掉，同編號的新記錄不會被當成已刪
  TOMBS = { quotes: { OLD: now - 200 * day, NEW: now - 10 * day } };
  const pruned = _tombPrune();
  const o1 = _mergeColl([{ id: 'S', v: 'L', _mt: now - 200 * day }, { id: 'NEW', v: 'L', _mt: now - 200 * day }], [{ id: 'S', v: 'C', _mt: now - day }, { id: 'OLD', v: 'C', _mt: now }], 'quotes', {});
  r.oldDevice = pruned === 1 && ids(o1) === 'OLD:C,S:C';
  TOMBS = {};
  // 舊版裝置：雲端最低版本高於本機 → 擋上傳；沒設最低版本 → 不擋
  const before = _MIN_VER;
  _MIN_VER = 'v6.9.999'; const blocked = _verBlocked() && _verGuard('測試') === true;
  _MIN_VER = ''; const free = !_verBlocked() && _verGuard('測試') === false;
  _MIN_VER = before;
  r.oldVersion = blocked && free;
  return r;
};

// ② 衍生應付重跑（在頁面裡跑）
const DERIVED = async () => {
  const card = { id: 'cS1', type: 'sub', vendor: '乙工程行', amt: 1000000, invoice: true, rows: [{ id: 'r1', linkedItemIdx: 0, qty: 1000, unitPrice: 1000 }],
    advances: [{ id: 'a1', amt: 300000, date: '2026-09-01' }],
    periods: [{ no: 1, date: '2026-09-30', rows: [{ rid: 'r1', qty: 400 }], adv: 150000 }, { no: 2, date: '2026-10-31', rows: [{ rid: 'r1', qty: 300 }], adv: 150000 }] };
  const labor = { id: 'cS2', type: 'labor', vendor: '丁工班', amt: 50000 };
  Q = [{ id: 'qS1', name: '範例工程S1', client: '甲營造', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 1000, price: 1200 }], t: {}, costs: [card, labor], exs: [], rmk: {}, _mt: 1 },
    { id: 'qS2', name: '範例工程S2', client: '甲營造', items: [{ desc: 'A', unit: 'M', qty: 1, price: 1 }], t: {}, costs: [], exs: [], rmk: {}, _mt: 1 }];
  const snap = () => JSON.stringify(PAYABLES.filter(p => p && /cS[12]/.test(p.id + '|' + (p.costId || ''))).map(p => {
    const o = {}; Object.keys(p).sort().forEach(k => { if (!/^(_mt|ts|updatedAt|createdAt|_at)$/.test(k)) o[k] = p[k]; }); return o;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const rerun = () => { _syncSubPeriodPayables(Q[0], card); syncCostToPayable(Q[0], labor); loadQ('qS2'); saveQ(); loadQ('qS1'); saveQ(); };
  const r = {};
  rerun(); const s0 = snap();
  let same = true; for (let i = 0; i < 5; i++) { rerun(); if (snap() !== s0) same = false; }
  r.n = JSON.parse(s0).length;
  r.idempotent = same && r.n >= 3;
  // 第 2 期付掉，之後重跑 5 次、刪掉第 2 期再重跑：那筆還在、仍是已付
  const p2 = PAYABLES.find(p => p.costId === 'cS1' && /_p2$/.test(p.id));
  if (!p2) { r.paidKept = false; return r; }
  payMarkPaid(p2.id, '2026-11-05'); __synOk();
  const amt = _payEff(p2);
  for (let i = 0; i < 5; i++) rerun();
  card.periods = card.periods.slice(0, 1); card._mt = Date.now();
  for (let i = 0; i < 3; i++) rerun();
  savePayables();
  const after = PAYABLES.find(p => p.id === p2.id);
  r.paidKept = !!after && after.status === 'paid' && _payEff(after) === amt;
  // 手動應付（非自動產生）：切稅別、刪除要真的作用、不能出錯（2a 審查：漏刪別名時這三個會無限遞迴）
  try {
    PAYABLES.push({ id: 'mS1', to: '丁工班', amount: 100, status: 'pending', _mt: 1 });
    togglePayVat('mS1', false);
    const vatOff = PAYABLES.find(p => p.id === 'mS1').vat === false;
    const sc = window.showConfirm; window.showConfirm = (t, h, ok) => ok();
    try { delPayable('mS1'); } finally { window.showConfirm = sc; }
    r.manual = vatOff && !PAYABLES.some(p => p.id === 'mS1');
  } catch (e) { r.manual = false; r.err = String(e && e.message || e).slice(0, 80); }
  return r;
};

// ③ 備份來回：A 頁做資料、匯出；B 頁（全新）匯入、再匯出
const BUILD = async () => {
  // 用合成樣本 A14b 那種資料：報價、分包卡（預付款＋兩期）、應付、請款單、客戶、廠商、費用
  const card = { id: 'cB1', type: 'sub', vendor: '乙工程行', amt: 1000000, invoice: true, rows: [{ id: 'r1', linkedItemIdx: 0, qty: 1000, unitPrice: 1000 }],
    advances: [{ id: 'a1', amt: 300000, date: '2026-09-01' }], periods: [{ no: 1, date: '2026-09-30', rows: [{ rid: 'r1', qty: 400 }], adv: 150000 }] };
  Q = [{ id: 'qB1', name: '範例工程B1', client: '甲營造', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 1000, price: 1200 }], t: {}, costs: [card], exs: [], rmk: {}, _mt: 1 }];
  _syncSubPeriodPayables(Q[0], card);
  INV = [{ id: 'iB1', quoteId: 'qB1', sourceQid: 'qB1', project: '範例工程B1', client: '甲營造', periodNo: 1, date: '2026-10-01', items: [{ desc: '鋼板樁', unit: 'M', contractQty: 1000, curQty: 300, price: 1200, payRate: 100 }], received: 100000, _mt: 1 }];
  _recalcInvAmounts(INV[0]);
  CUSTOMERS.push({ id: 'cuB1', name: '甲營造', ownerType: '營造廠' }); VENDORS.push({ id: 'veB1', name: '乙工程行' });
  EXPENSES.push({ id: 'exB1', date: '2026-10-02', amount: 1234, cat: '雜支' });
  CONTRACTS.push({ id: 'ctB1', linkedQid: 'qB1', name: '範例工程B1', amount: 1260000 });
  // 匯入時另外處理的集合也放資料，才不會空過
  HR = [{ id: 'hrB1', name: '範例人員', h: { base: 40000 }, _mt: 1 }];
  PAYSLIPS = [{ id: 'ps_hrB1_2026-09', hrId: 'hrB1', ym: '2026-09', name: '範例人員', gross: 40000, coCost: 5000, status: 'paid', _mt: 1 }];
  PETTY = [{ id: 'pcB1', date: '2026-09-10', amount: 800, _mt: 1 }];
  MAT_LEDGER = [{ id: 'mlB1', date: '2026-09-01', item: '鋼板樁', qty: 10, _mt: 1 }];
  SHARE_PROFIT = { cfg: { 2026: { netProfit: 0, retentionAdd: 0, wcAdd: 0, machineSelfPay: 0 } }, draws: [{ id: 'dB1', date: '2026-09-30', amount: 1000 }] };
  COST_HIST = [{ id: 'chB1', desc: '鋼板樁', unit: 'M', cost: 900 }];
  if (typeof _prjSync === 'function') _prjSync();   // 4a：真實裝置開頁就會對帳建專案（得標主報價 qB1 → p_qB1），備份才帶得到
  return JSON.stringify(_syncPayload().data);
};
const EXPORT = async () => { return JSON.stringify(_syncPayload().data); };
function norm(json) {
  const d = JSON.parse(json);
  ['ts', 'uploadedAt', 'uploadedBy', 'exportDate', 'activityLog'].forEach(k => delete d[k]);
  if (d.toolStates) delete d.toolStates._mt;   // 工具表單的存檔時間，匯入時重蓋，不是資料
  // 依 id 排序（匯入後順序可能不同），鍵排序
  const sortDeep = o => Array.isArray(o) ? o.map(sortDeep).sort((a, b) => (a && a.id && b && b.id) ? String(a.id).localeCompare(String(b.id)) : 0)
    : (o && typeof o === 'object') ? Object.keys(o).sort().reduce((r, k) => { r[k] = sortDeep(o[k]); return r; }, {}) : o;
  return sortDeep(d);
}
function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  return p;
}

async function newPage(browser, root) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.addInitScript(() => {
    const RealDate = Date, t0 = RealDate.now(), base = RealDate.UTC(2026, 9, 15, 2, 0, 0);
    const now = () => base + (RealDate.now() - t0);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
    window.Date = FakeDate;
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForFunction(() => typeof window.saveQ === 'function' && typeof window._mergeColl === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(RESET);
  return { ctx, page, errs };
}
const body = f => '(async () => { ' + f.toString().replace(/^[^{]*\{/, '').replace(/\}\s*$/, '') + ' })()';

async function runAll(browser, root, only) {
  const res = {};
  if (!only || only === 'sync') {
    const { ctx, page } = await newPage(browser, root);
    let r; try { r = await page.evaluate(body(SYNC)); } catch (e) { r = { err: String(e.message).slice(0, 120) }; }
    const bad = Object.keys(r).filter(k => r[k] !== true);
    res.sync = { ok: !bad.length && Object.keys(r).length === 5, info: bad.length ? '不符：' + bad.join('、') : '交錯修改、付款先後、墓碑、180 天舊裝置、舊版上傳' };
    await ctx.close();
  }
  if (!only || only === 'derived') {
    const { ctx, page } = await newPage(browser, root);
    let r; try { r = await page.evaluate(body(DERIVED)); } catch (e) { r = { err: String(e.message).slice(0, 120) }; }
    res.derived = { ok: r.idempotent === true && r.paidKept === true && r.manual === true, info: (r.err ? r.err + '；' : '') + '應付 ' + r.n + ' 筆；重跑 5 次相同 ' + (r.idempotent ? '✓' : '✗') + '；已付刪期別後仍在 ' + (r.paidKept ? '✓' : '✗') + '；手動應付切稅別／刪除 ' + (r.manual ? '✓' : '✗') };
    await ctx.close();
  }
  if (!only || only === 'backup') {
    const A = await newPage(browser, root);
    let j1, e1 = ''; try { j1 = await A.page.evaluate(body(BUILD)); } catch (e) { j1 = null; e1 = String(e.message).slice(0, 160); }
    await A.ctx.close();
    const B = await newPage(browser, root);
    let j2 = null;
    if (j1) {
      await B.page.evaluate(t => { importData(new File([t], 'b.json', { type: 'application/json' })); }, j1);
      await B.page.waitForSelector('#import-confirm-ok', { state: 'visible', timeout: 15000 }).catch(() => {});
      await B.page.click('#import-confirm-ok').catch(() => {});
      await B.page.waitForTimeout(1500);
      j2 = await B.page.evaluate(body(EXPORT)).catch(() => null);
    }
    await B.ctx.close();
    const d = j1 && j2 ? firstDiff(norm(j1), norm(j2), '') : '(沒有產生備份' + (j1 ? '' : '：' + e1) + ')';
    const n = j1 ? JSON.parse(j1) : {};
    const filled = ['quotes', 'invoices', 'payables', 'contracts', 'customers', 'vendors', 'expenses', 'hr', 'payslips', 'petty', 'matLedger', 'costHist', 'projects'].filter(k => !(Array.isArray(n[k]) && n[k].length));
    res.backup = { ok: !d && !!j1 && !filled.length && n.shareProfit && n.shareProfit.draws.length === 1, info: d ? '第一個不同的地方：' + d : filled.length ? '這些集合沒放到資料、等於沒測：' + filled.join('、') : '報價、請款、應付、合約、客戶、廠商、費用、薪資、薪資單、零用金、材料台帳、單價歷史、分潤逐欄相同' };
  }
  if (!only || only === 'wrap') res.wrap = testWrap(root);
  if (!only || only === 'money') res.money = testMoneyStatic(root);
  return res;
}

const NAMES = { sync: '① 同步合併', derived: '② 衍生應付重跑', backup: '③ 備份來回', wrap: '④ 包裝白名單', money: '⑤ 金額寫法' };
// 反向驗證：每項各故意改壞一處
const BREAK = {
  sync: [/if\(!o\|\|mt\(r\)>=mt\(o\)\)map\[r\.id\]=r;/, 'map[r.id]=r;'],                       // 合併不看修改時間，本機一律蓋雲端
  derived: [/function savePayables\(\)\{try\{_paidVanishGuard\(\);\}/, 'function savePayables(){PAYABLES=PAYABLES.filter(function(p){return !(p.status==="paid"&&p.costId==="cS1"&&/_p2$/.test(p.id));});try{_paidVanishGuard=function(){};}catch(e){}try{}'],   // 存檔時已付那筆被拿掉、救援也關掉（重跑相同那半不受影響，只有「已付仍在」會紅）
  backup: [/if\(data\.expenses\)EXPENSES=arr\(data\.expenses\);/, ''],                           // 還原漏掉費用
  money: [/function _modal\(title,bodyHtml,onOk\)\{/, 'function _rcvX(i){return parseFloat(i.received)||0;}\nfunction _modal(title,bodyHtml,onOk){'],   // 新增一處直接讀 received
  wrap: [/function _modal\(title,bodyHtml,onOk\)\{/, 'var _payEffX0=_payEff;_payEff=function(p){return _payEffX0(p);};\nfunction _modal(title,bodyHtml,onOk){']   // 新增一處包裝覆寫
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  if (SELFTEST) {
    console.log('\n健檢 3 安全網．反向驗證（每項故意改壞一處）\n' + '─'.repeat(64));
    let fail = 0;
    for (const k of Object.keys(BREAK)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fj-safe-'));
      ['index.html', 'app.js', 'sw.js', 'manifest.json'].forEach(f => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)); }); if (fs.existsSync(path.join(ROOT, 'calc'))) fs.cpSync(path.join(ROOT, 'calc'), path.join(tmp, 'calc'), { recursive: true });   // v6.0.130 計算模組
      const src = fs.readFileSync(path.join(tmp, 'app.js'), 'utf8');
      if (!BREAK[k][0].test(src)) { fail++; console.log('  ✗ ' + NAMES[k] + '：找不到要改壞的地方'); continue; }
      fs.writeFileSync(path.join(tmp, 'app.js'), src.replace(BREAK[k][0], BREAK[k][1]));
      const r = (await runAll(browser, tmp, k))[k];
      if (r.ok) fail++;
      console.log((r.ok ? '  ✗ ' : '  ✓ ') + NAMES[k] + (r.ok ? '：改壞了還是通過——這道網沒擋住' : '：抓到了（' + r.info + '）'));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    await browser.close();
    process.exit(fail ? 1 : 0);
  }
  const res = await runAll(browser, ROOT);
  await browser.close();
  console.log('\n健檢 3 安全網（同步合併／衍生應付／備份來回／包裝白名單）\n' + '─'.repeat(64));
  let fail = 0;
  Object.keys(NAMES).forEach(k => { if (!res[k].ok) fail++; console.log((res[k].ok ? '  ✓ ' : '  ✗ ') + NAMES[k] + '　' + res[k].info); });
  console.log('─'.repeat(64) + '\n  ' + (Object.keys(NAMES).length - fail) + ' / ' + Object.keys(NAMES).length + ' 通過' + (fail ? '　✗ ' + fail + ' 項失敗' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('安全網測試執行失敗：', e); process.exit(1); });
