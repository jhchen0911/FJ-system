// 改版第 4 步 4a 驗收：用真實黃金樣本 (b) 的快照，檢查「專案資料集」建檔結果（Lotion-HQ 本機跑，不連雲端、不改正式資料）。
//
//   node tools/golden/projects-check.js --snapshot <快照.json> --base <main 程式資料夾> [--root <4a 程式資料夾>]
//
//   --snapshot  exportData 產生的全量備份（只放在 %USERPROFILE%\FJ-golden\，不進 repo）
//   --base      上線前的程式（main），用來比「舊資料集」前後是否一字不差
//   --root      4a 的程式（預設＝本 repo）
//
// 檢查（全部只印筆數與通過／不通過，不印案名、金額、id）：
//   1. 專案筆數（不含作廢）＝得標主報價數（含已結案）；已得標追加全部掛進主約的專案
//   2. 每筆專案的每條連結（報價、合約、請款單）都打得開；連不到的筆數
//   3. 舊資料集（報價、合約、業主請款單、應付、付款帳本、發票紀錄）：4a 版載入後的內容雜湊＝main 版載入後的內容雜湊
//   4. 案號：沒有重號、格式都是 年份-流水號
// 結束碼：0＝全部通過、1＝有不通過、2＝參數錯誤
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const SNAP = arg('snapshot'), BASE = arg('base');
const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
if (!SNAP || !BASE) { console.error('用法：node tools/golden/projects-check.js --snapshot <快照.json> --base <main 程式資料夾> [--root <4a 程式資料夾>]'); process.exit(2); }

async function load(browser, root, json, t0) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.addInitScript((base) => {
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(base); } static now() { return base; } }
    window.Date = FakeDate;
  }, t0);
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(path.resolve(root), 'index.html'));
  await page.waitForFunction(() => typeof window.importData === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate((txt) => { importData(new File([txt], 'snapshot.json', { type: 'application/json' })); }, json);
  await page.waitForSelector('#import-confirm-ok', { state: 'visible', timeout: 30000 });
  await page.click('#import-confirm-ok');
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => {
    const out = { colls: {
      quotes: JSON.stringify(Q), contracts: JSON.stringify(CONTRACTS), invoices: JSON.stringify(INV), payables: JSON.stringify(PAYABLES),
      paidLog: JSON.stringify(typeof PAID_LOG !== 'undefined' ? PAID_LOG : {}), invoiceRecs: JSON.stringify(INVOICE_RECS) } };
    if (typeof PROJECTS === 'undefined') return out;
    try { _prjSync({ noSave: true }); } catch (e) { out.err = String(e && e.message || e).slice(0, 80); }
    const live = PROJECTS.filter(p => p && !p.voidAt);
    const mains = Q.filter(q => q && q.awarded && !q.parentId), adds = Q.filter(q => q && q.awarded && q.parentId);
    const closed = mains.filter(q => q.closed).length;
    let broken = 0, links = 0;
    live.forEach(p => { const L = _prjLinks(p); links += L.quotes.length + L.contracts.length + L.invoices.length; broken += L.missing.length; });
    const addHung = adds.filter(a => { const p = _prjOfQ(a.id); return p && !p.voidAt && (p.addQids || []).includes(a.id); }).length;
    const nos = live.map(p => p.no), dupNo = nos.length - new Set(nos).size, badNo = nos.filter(n => !/^\d{4}-\d{3,}$/.test(n || '')).length;
    out.prj = { projects: live.length, mains: mains.length, closed, adds: adds.length, addHung, links, broken, dupNo, badNo, voided: PROJECTS.length - live.length };
    return out;
  });
  await ctx.close();
  return r;
}

(async () => {
  let json, snap;
  try { json = fs.readFileSync(SNAP, 'utf8').replace(/^﻿/, ''); snap = JSON.parse(json); } catch (e) { console.error('快照讀不到或不是有效的 JSON'); process.exit(2); }
  if (!snap.version || !snap.quotes) { console.error('快照格式不符（要用系統的「全量備份」檔）'); process.exit(2); }
  const t0 = Date.parse(snap.exportDate || '') || Date.UTC(2026, 9, 15, 2, 0, 0);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const a = await load(browser, BASE, json, t0), b = await load(browser, ROOT, json, t0);
  await browser.close();
  const h = s => crypto.createHash('md5').update(s).digest('hex').slice(0, 10);
  const rows = [];
  const ok = (name, pass, detail) => rows.push({ name, pass, detail });
  if (!b.prj) { console.error('--root 的程式沒有專案資料集（_prjSync），請指向 4a 分支'); process.exit(2); }
  const p = b.prj;
  ok('專案筆數＝得標主報價數（含已結案）', p.projects === p.mains, `專案 ${p.projects}、得標主報價 ${p.mains}（其中已結案 ${p.closed}）、作廢 ${p.voided}`);
  ok('已得標追加全部掛進主約的專案', p.addHung === p.adds, `已得標追加 ${p.adds}、掛上 ${p.addHung}`);
  ok('每條連結都打得開', p.broken === 0, `連結 ${p.links} 條、連不到 ${p.broken}`);
  ok('案號沒有重號、格式正確', p.dupNo === 0 && p.badNo === 0, `重號 ${p.dupNo}、格式不對 ${p.badNo}`);
  Object.keys(a.colls).forEach(k => ok('舊資料集內容一致：' + k, a.colls[k] === b.colls[k], `main ${h(a.colls[k])}／4a ${h(b.colls[k])}`));
  if (b.err) ok('對帳沒有錯誤', false, b.err);
  console.log('\n4a 專案資料集驗收（真實黃金樣本）\n' + '─'.repeat(60));
  rows.forEach(r => console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + '　' + r.detail));
  const bad = rows.filter(r => !r.pass).length;
  console.log('─'.repeat(60) + '\n  ' + (bad ? `✗ ${bad} 項不通過` : '全部通過'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('執行失敗：', e && e.message); process.exit(2); });
