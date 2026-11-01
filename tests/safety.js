// 健檢 3 第三節：改版前的四道安全網（只加測試、不改程式）
//   ① 同步合併：兩台裝置交錯修改、付款／改回未付的先後、墓碑、180 天沒開的舊裝置、舊版裝置上傳
//   ② 衍生應付重跑：分包期別／預付款／成本卡的自動應付重算 N 次結果完全相同；已付的那筆怎麼重算都不會被刪、不會變回待付
//   ③ 備份來回：在 A 頁匯出 → 全新 B 頁匯入 → 再匯出，兩份逐欄相同（不含時間戳）
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

// ④ 目前（v6.0.124）的包裝覆寫：函式名 → 次數。第 2a 步拆掉一個就從這裡刪一個；不能新增。
const WRAP_WHITELIST = {
  txt: 1, addSec: 1, renderProjects: 1, _pjInvHtml: 1, buildInvFromQuote: 1, renderRetention: 1, saveQ: 1, loadQ: 1, drExportPDF: 1,
  buildSubMgmtHtml: 1, _pjAdvRowsHtml: 1, delPayable: 1, editPayable: 1, togglePayVat: 1, _paySource: 1, _payIsCompany: 1,
  _shRptYear: 1, _rptBasisStrip: 1, _qiPreview: 1, showConfirm: 1, _cleanExpenseSync: 1, _advUnifyAll: 1, go: 2, matEstSave: 1, matEstCalc: 1
};
function wrapScan(src) {
  const fns = new Set([...src.matchAll(/^function\s+([\w$]+)\s*\(/gm)].map(m => m[1]));
  const hits = {};
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:window\.)?([\w$]+)\s*=\s*(?:async\s+)?function\b/gm)) if (fns.has(m[1])) hits[m[1]] = (hits[m[1]] || 0) + 1;
  return hits;
}
function testWrap(root) {
  const hits = wrapScan(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  const added = Object.keys(hits).filter(k => hits[k] > (WRAP_WHITELIST[k] || 0));
  const gone = Object.keys(WRAP_WHITELIST).filter(k => (hits[k] || 0) < WRAP_WHITELIST[k]);
  return { ok: !added.length && !gone.length, info: (added.length ? '新增包裝：' + added.join('、') + '（規則 9：改原函式本體）' : '') + (gone.length ? (added.length ? '；' : '') + '已拆掉、請從白名單刪：' + gone.join('、') : '') || '共 ' + Object.values(hits).reduce((a, b) => a + b, 0) + ' 處，與白名單相同' };
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
    res.derived = { ok: r.idempotent === true && r.paidKept === true, info: (r.err || '') + '應付 ' + r.n + ' 筆；重跑 5 次相同 ' + (r.idempotent ? '✓' : '✗') + '；已付刪期別後仍在 ' + (r.paidKept ? '✓' : '✗') };
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
    res.backup = { ok: !d && !!j1 && n.quotes.length === 1 && n.payables.length >= 2, info: d ? '第一個不同的地方：' + d : '報價、請款、應付、合約、客戶、廠商、費用逐欄相同' };
  }
  if (!only || only === 'wrap') res.wrap = testWrap(root);
  return res;
}

const NAMES = { sync: '① 同步合併', derived: '② 衍生應付重跑', backup: '③ 備份來回', wrap: '④ 包裝白名單' };
// 反向驗證：每項各故意改壞一處
const BREAK = {
  sync: [/if\(!o\|\|mt\(r\)>=mt\(o\)\)map\[r\.id\]=r;/, 'map[r.id]=r;'],                       // 合併不看修改時間，本機一律蓋雲端
  derived: [/function savePayables\(\)\{try\{_paidVanishGuard\(\);\}/, 'function savePayables(){PAYABLES=PAYABLES.filter(function(p){return !(p.status==="paid"&&p.costId==="cS1"&&/_p2$/.test(p.id));});try{_paidVanishGuard=function(){};}catch(e){}try{}'],   // 存檔時已付那筆被拿掉、救援也關掉（重跑相同那半不受影響，只有「已付仍在」會紅）
  backup: [/if\(data\.expenses\)EXPENSES=arr\(data\.expenses\);/, ''],                           // 還原漏掉費用
  wrap: [/function _modal\(title,bodyHtml,onOk\)\{/, 'var _payEffX0=_payEff;_payEff=function(p){return _payEffX0(p);};\nfunction _modal(title,bodyHtml,onOk){']   // 新增一處包裝覆寫
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  if (SELFTEST) {
    console.log('\n健檢 3 安全網．反向驗證（每項故意改壞一處）\n' + '─'.repeat(64));
    let fail = 0;
    for (const k of Object.keys(BREAK)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fj-safe-'));
      ['index.html', 'app.js', 'sw.js', 'manifest.json'].forEach(f => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)); });
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
  console.log('─'.repeat(64) + '\n  ' + (4 - fail) + ' / 4 通過' + (fail ? '　✗ ' + fail + ' 項失敗' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('安全網測試執行失敗：', e); process.exit(1); });
