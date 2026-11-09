// 單據列印指紋（改版第 7 步：共用 A4 單據引擎「印出來一字不差」的證明）
//
//   node tools/golden/doc-print.js --out <結果.json> [--root <程式資料夾>] [--snapshot <快照.json>]
//   node tools/golden/doc-print.js --expect tests/synthetic/docs.json      （CI：合成樣本，跟標準答案逐張比對）
//   node tools/golden/doc-print.js --update                                （只在「這次就是要改單據內容」的 PR 用）
//   node tools/golden/doc-print.js --cmp <改前.json> <改後.json>           （黃金樣本：main 與分支各跑一次再比）
//
// 做法：開一個斷網、時鐘固定的無頭瀏覽器，載入資料（沒給 --snapshot ＝ 內建假資料；給了＝用系統自己的「匯入備份」載入快照），
//      把「匯出 PDF」「原生列印」最後交給引擎的那一份完整 HTML 攔下來（不真的產生 PDF），每張單據算 md5。
//      攔的是每個列印入口（報價單、原生列印、請款單（列表與編輯器兩條路）、詢價單、分包工程承攬合約書、保留款退還請款單），
//      所以底層怎麼重構都沒關係：只要入口交出去的內容一字不差，指紋就相同。
//      輸出只有「單據種類:id → 指紋」，不含案名、金額、內容（快照的真實資料不會出現在結果檔）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, def) { const i = process.argv.indexOf('--' + name); const v = i > 0 ? process.argv[i + 1] : undefined; return (v && !/^--/.test(v)) ? v : def; }
const ARGS = process.argv.slice(2);
const DEF_EXPECT = path.join(__dirname, '..', '..', 'tests', 'synthetic', 'docs.json');

if (require.main === module && ARGS[0] === '--cmp') {
  const a = JSON.parse(fs.readFileSync(ARGS[1], 'utf8')), b = JSON.parse(fs.readFileSync(ARGS[2], 'utf8'));
  process.exit(report(a, b, '改前', '改後') ? 1 : 0);
}

function report(exp, got, la, lb) {
  const keys = Array.from(new Set(Object.keys(exp.docs || {}).concat(Object.keys(got.docs || {})))).sort();
  let bad = 0;
  console.log('\n單據列印指紋比對（' + la + ' vs ' + lb + '）\n' + '─'.repeat(64));
  keys.forEach(k => {
    const a = (exp.docs || {})[k], b = (got.docs || {})[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log('  ✗ ' + k + '：' + (a ? '' : la + '沒有這張') + (b ? '' : lb + '沒有這張') + (a && b ? '內容不同' : '')); }
  });
  const errs = (got.errors || []).concat(exp.errors || []);
  errs.forEach(e => { bad++; console.log('  ✗ 執行錯誤：' + e); });
  console.log('─'.repeat(64));
  console.log('  ' + (keys.length - bad) + ' / ' + keys.length + ' 張相同' + (bad ? '　✗ ' + bad + ' 項不同' : '　全部一字不差'));
  return bad;
}

// ── 內建假資料（只放假案名、假金額；repo 是公開的）──
function fixture() {
  const items = [
    { sec: true, desc: '一、擋土設施' },
    { desc: '鋼軌樁打設\n（含運搬）', unit: '支', qty: '120', price: '1850', note: '', ot: '12', otu: '$/支/天' },
    { desc: 'H型鋼樁 H300×300\n（根固處理）', unit: 'M', qty: '960.5', price: '720', note: '依圖面', estCost: 600 },
    { desc: '備用：增打鋼軌樁', unit: '支', qty: '1', price: '2100', spare: true, note: '' },
    { sec: true, desc: '二、支撐' },
    { desc: '水平支撐 H350（第一層）', unit: '噸', qty: '42.3', price: '5200', note: '' },
    { desc: '減項：業主自備鋼板', unit: '式', qty: '1', price: '-15000', note: '' },
  ];
  const q = { id: 'qDOC1', code: 'D2601', name: '範例工程甲', client: '甲營造股份有限公司', contact: '王先生', tel: '02-1234-5678', loc: '台北市範例路 1 號', date: '2026-10-01',
    awarded: true, exs: [], rmk: {}, _mt: 1, items, costs: [
      { id: 'cDOC1', type: 'sub', vendor: '乙工程行', rows: [{ linkedItemIdx: 1, qty: 120, unitPrice: 1500 }, { linkedItemIdx: 2, qty: 960.5, unitPrice: 600, scope: 'A 區' }, { lump: true, desc: '機具進出場', qty: 1, unitPrice: 30000 }] }
    ], rfqs: [
      { id: 'rDOC1', no: 'RFQ-D2601-01', date: '2026-10-05', scope: '鋼軌樁打設', deadline: '2026-10-12', contact: '陳小姐', tel: '0912-000-000', status: 'sent', vendors: [],
        items: [{ desc: '鋼軌樁打設\n（含運搬）', unit: '支', qty: 120 }, { desc: 'H型鋼樁 H300×300', unit: 'M', qty: 960.5, scope: 'A 區' }] }
    ], deduct: { ret: 5, retCond: '完工驗收後 60 日' } };
  const inv1 = { id: 'iDOC1', sourceQid: 'qDOC1', quoteId: 'qDOC1', project: '範例工程甲', client: '甲營造股份有限公司', periodNo: 1, date: '2026-10-25', retention: true, retentionPct: 5,
    items: [{ type: 'item', desc: '鋼軌樁打設', unit: '支', contractPrice: 1850, contractQty: 120, prevQty: 0, curQty: 60, payRate: 100 },
      { type: 'item', desc: 'H型鋼樁 H300×300', unit: 'M', contractPrice: 720, contractQty: 960.5, prevQty: 0, curQty: 400.25, payRate: 70 }] };
  const inv2 = { id: 'iDOC2', sourceQid: 'qDOC1', quoteId: 'qDOC1', project: '範例工程甲', client: '甲營造股份有限公司', periodNo: 2, date: '2026-11-25', retention: true, retentionPct: 5,
    items: [{ type: 'item', desc: '鋼軌樁打設', unit: '支', contractPrice: 1850, contractQty: 120, prevQty: 60, curQty: 60, payRate: 100 },
      { type: 'item', desc: 'H型鋼樁 H300×300', unit: 'M', contractPrice: 720, contractQty: 960.5, prevQty: 400.25, curQty: 560.25, payRate: 70 }] };
  const ret = { id: 'irDOC1', kind: 'retReturn', project: '範例工程甲', client: '甲營造股份有限公司', quoteId: 'qDOC1', date: '2026-12-20', periodNo: '退', items: [], retention: false, retentionPct: 0,
    totals: { curTotal: 0, tax: 0, total: 0, retention: 0 }, retRet: { amt: 12000, rows: [{ periodNo: 1, date: '2026-10-25', pct: 5, amt: 7000 }, { periodNo: 2, date: '2026-11-25', pct: 5, amt: 4000 }], holds: [{ periodNo: 2, date: '2026-12-05', amt: 1000 }], cond: '完工驗收後 60 日', done: false } };
  const vendors = [{ id: 'vDOC1', name: '乙工程行', taxid: '12345675', addr: '新北市範例區範例街 2 號', contact: '李老闆', boss: '李老闆', phone: '02-2222-3333' }];
  const P0 = { company: '範例工程有限公司', addr: '台北市範例區範例路 100 號', tel: '02-8888-0000', email: 'demo@example.com', taxid: '87654321', boss: '張範例', tax: 5 };
  return { Q: [q], INV: [inv1, inv2, ret], VENDORS: vendors, P: P0 };
}

// 在頁面裡執行：攔下列印入口交出去的 HTML
async function capture(page, mode) {
  return page.evaluate(async (mode) => {
    const docs = {}, errors = [];
    let last = null;
    window._printViaIframe = function (html, fn, ls) { last = { html: String(html), fn: String(fn || ''), ls: !!ls }; };
    window._printNativeHTML = function (html, fn) { last = { html: String(html), fn: String(fn || ''), ls: null, native: true }; };
    window.showConfirm = function (t, msg, ok) { const d = document.createElement('div'); d.id = '__dp_cf'; d.style.display = 'none'; d.innerHTML = msg; document.body.appendChild(d); try { ok(); } finally { d.remove(); } };
    window.toast = function () { };
    const take = (key, fn) => {
      last = null;
      try { fn(); } catch (e) { errors.push(key + '：' + (mode === 'fixture' ? String(e && e.message || e).slice(0, 120) : '執行出錯（' + String(e && e.name || 'Error') + '）')); return; }   // 快照模式不印錯誤內容（可能含真實資料）
      if (last) docs[key] = last; else if (mode === 'fixture') errors.push(key + '：沒有交出列印內容'); else docs[key] = { html: '（沒有交出列印內容）', fn: '', ls: null };   // 快照：沒交出的也列一筆，比對時兩邊要一樣
    };
    const qs = (Q || []).filter(q => q && q.id);
    qs.forEach(q => {
      take('quote:' + q.id, () => exportQuotePDF(q.id));
      take('quoteNative:' + q.id, () => exportQuotePDFNative(q.id));
    });
    (INV || []).filter(v => v && v.id).forEach(v => {
      take((v.kind === 'retReturn' ? 'retReturn:' : 'inv:') + v.id, () => printInvById(v.id));
    });
    // 請款單編輯器那一條路（printInvoice／printInvNative）：只跑假資料（真實快照的編輯器狀態跟列表那條同一份內容）
    if (mode === 'fixture') {
      (INV || []).filter(v => v && v.id && v.kind !== 'retReturn').forEach(v => {
        try { loadInvoice(v.id); } catch (e) { errors.push('loadInvoice ' + v.id + '：' + e.message); return; }
        take('invEditor:' + v.id, () => printInvoice());
        take('invNative:' + v.id, () => printInvNative());
      });
      try { go('quotes'); } catch (e) { /* 可忽略 */ }
    }
    qs.forEach(q => {
      (Array.isArray(q.rfqs) ? q.rfqs : []).forEach(r => {
        if (!r || !r.id) return;
        take('rfq:' + q.id + ':' + r.id, () => { _rfqQid = q.id; rfqPrint(r.id); });
      });
      (q.costs || []).filter(c => c && c.type === 'sub' && c.vendor).forEach(c => {
        take('subContract:' + q.id + ':' + c.id, () => {
          eid = q.id;
          const keep = c.signDate; c.signDate = '2026-10-10';
          try { openSubContractDoc(c.id); } finally { if (keep === undefined) delete c.signDate; else c.signDate = keep; }
        });
      });
    });
    return { docs, errors };
  }, mode);
}

module.exports = { fixture };
if (require.main === module) (async () => {
  const { chromium } = require('playwright');
  const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
  const SNAP = arg('snapshot');
  const OUT = arg('out');
  const EXPECT = ARGS.includes('--expect') ? (arg('expect') || DEF_EXPECT) : null;
  const UPDATE = ARGS.includes('--update');
  const mode = SNAP ? 'snapshot' : 'fixture';
  let json = null, snap = null;
  if (SNAP) {
    try { json = fs.readFileSync(SNAP, 'utf8').replace(/^﻿/, ''); snap = JSON.parse(json); } catch (e) { console.error('快照讀不到或不是有效的 JSON'); process.exit(2); }
  }
  const t0 = snap ? (Date.parse(snap.exportDate || '') || Date.UTC(2026, 9, 15, 2, 0, 0)) : Date.UTC(2026, 9, 15, 2, 0, 0);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.addInitScript((base) => {
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(base); } static now() { return base; } }
    window.Date = FakeDate;
    Math.random = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  }, t0);
  const page = await ctx.newPage();
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push(String(e.message).slice(0, 120)));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => typeof window.exportQuotePDF === 'function' && typeof window.importData === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  if (SNAP) {
    await page.evaluate((txt) => { importData(new File([txt], 'snapshot.json', { type: 'application/json' })); }, json);
    await page.waitForSelector('#import-confirm-ok', { state: 'visible', timeout: 30000 });
    await page.click('#import-confirm-ok');
    await page.waitForFunction((n) => typeof Q !== 'undefined' && Q.length === n, snap.quotes.length, { timeout: 60000 }).catch(() => { });
    await page.waitForTimeout(5000);
  } else {
    await page.evaluate((fx) => {
      Object.assign(P, fx.P);
      Q.length = 0; fx.Q.forEach(q => Q.push(q));
      INV.length = 0; fx.INV.forEach(v => INV.push(v));
      VENDORS.length = 0; fx.VENDORS.forEach(v => VENDORS.push(v));
      Q.forEach(q => { try { loadQ(q.id); q.t = calcT(); } catch (e) { /* 可忽略：舊版沒有 */ } });
      INV.forEach(v => { if (v.kind !== 'retReturn') try { _recalcInvAmounts(v); } catch (e) { /* 可忽略 */ } });
    }, fixture());
    await page.waitForTimeout(300);
  }
  const r = await capture(page, mode);
  await browser.close();
  const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const out = { kind: 'fy-doc-print', mode, at: new Date().toISOString(), docs: {}, errors: r.errors.concat(pageErrs.map(e => 'page：' + e)) };
  Object.keys(r.docs).sort().forEach(k => { const d = r.docs[k]; out.docs[k] = { html: md5(d.html), fn: md5(d.fn), ls: d.ls, len: d.html.length }; });
  if (UPDATE) { fs.writeFileSync(DEF_EXPECT, JSON.stringify({ docs: out.docs }, null, 1) + '\n'); console.log('已更新 ' + path.relative(process.cwd(), DEF_EXPECT) + '（' + Object.keys(out.docs).length + ' 張）'); return; }
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n'); console.log('已寫入 ' + OUT + '：' + Object.keys(out.docs).length + ' 張單據' + (out.errors.length ? '，' + out.errors.length + ' 個錯誤' : '')); }
  if (EXPECT) { const exp = JSON.parse(fs.readFileSync(EXPECT, 'utf8')); process.exit(report(exp, out, '標準答案', '這次') ? 1 : 0); }
  if (!OUT && !EXPECT) console.log(JSON.stringify(out, null, 1));
  if (out.errors.length) process.exit(1);
})().catch(e => { console.error('單據列印指紋執行失敗：', e); process.exit(1); });
