// 真實黃金樣本 (b)：用「某一版程式」把凍結快照算一遍，輸出關鍵數字（只用 id 當鍵，不含案名）。
//
//   node tools/golden/run.js --snapshot <快照.json> --out <結果.json> [--names <名單.json>] [--root <程式資料夾>]
//
//   --snapshot  Lotion-HQ 從正式版匯出的全量備份（exportData 產生的 JSON），只放在 %USERPROFILE%\FJ-golden\，不進 repo
//   --out       算出的數字（之後給 compare.js 比對）
//   --names     另存真實名稱清單（案名、業主、廠商、合約名）給 namecheck.js 用，只存在本機
//   --root      要用哪一份程式算（預設＝本 repo）；比對分支時指向分支的資料夾
//
// 做法：開一個斷網的無頭瀏覽器 → 時鐘固定在快照匯出時間（「今天」不隨執行日期改變）→ 用系統自己的「匯入備份」載入快照
//      → 在頁面裡用系統自己的算法算（tools/golden/page-extract.js）。不登入、不連雲端、不改任何正式資料。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const SNAP = arg('snapshot'), OUT = arg('out'), NAMES = arg('names');
const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
if (!SNAP || !OUT) { console.error('用法：node tools/golden/run.js --snapshot <快照.json> --out <結果.json> [--names <名單.json>] [--root <程式資料夾>]'); process.exit(2); }

(async () => {
  const json = fs.readFileSync(SNAP, 'utf8');
  let snap; try { snap = JSON.parse(json); } catch (e) { console.error('快照不是有效的 JSON'); process.exit(2); }
  if (!snap.version || !snap.quotes) { console.error('快照格式不符（要用系統的「全量備份」檔）'); process.exit(2); }
  const t0 = Date.parse(snap.exportDate || '') || Date.UTC(2026, 9, 15, 2, 0, 0);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW', acceptDownloads: false });
  await ctx.route(/^https?:\/\//, r => r.abort());   // 斷網：不連 Firebase，結果只看程式與快照
  await ctx.addInitScript((base) => {
    const RealDate = Date, s = RealDate.now();
    const now = () => base + (RealDate.now() - s);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
    window.Date = FakeDate;
  }, t0);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => typeof window.importData === 'function' && typeof window._pjStat === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  // 用系統的「匯入備份」載入（與 Lotion 手動還原同一條路）
  await page.evaluate((txt) => { importData(new File([txt], 'snapshot.json', { type: 'application/json' })); }, json);
  await page.waitForSelector('#import-confirm-ok', { state: 'visible', timeout: 30000 });
  await page.click('#import-confirm-ok');
  await page.waitForFunction((n) => Array.isArray(window.Q) ? Q.length === n : (typeof Q !== 'undefined' && Q.length === n), snap.quotes.length, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(fs.readFileSync(path.join(__dirname, 'page-extract.js'), 'utf8'));
  await browser.close();
  if (r.data.meta.quotes !== snap.quotes.length) { console.error('快照沒有完整載入（報價筆數不符），請把畫面錯誤告訴 AI'); process.exit(1); }
  r.data.meta.pageErrors = errs.length;
  fs.writeFileSync(OUT, JSON.stringify(r.data, null, 1));
  if (NAMES) fs.writeFileSync(NAMES, JSON.stringify(r.names, null, 1));
  const d = r.data;
  console.log('完成：程式 ' + d.meta.app + '｜得標案 ' + Object.keys(d.stat).length + '｜請款單 ' + Object.keys(d.inv).length + '｜分包 ' + Object.keys(d.sub).length + '｜應付 ' + Object.keys(d.pay).length + '｜年度 ' + Object.keys(d.year).length + (errs.length ? '｜頁面錯誤 ' + errs.length + ' 則' : ''));
})().catch(e => { console.error('執行失敗：' + String(e && e.message || e).slice(0, 200)); process.exit(1); });
