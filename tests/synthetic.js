// 合成樣本 (a)：健檢 1 每一種算錢情境各一筆以上（假案名、假業主、假數字），每筆在乾淨的頁面上用真的程式算一次，
// 結果要和 tests/synthetic/expected.json 逐值相同（一元都不能差）。
//
//   npm run synth                  跑全部樣本（CI 用；冒煙測試之後跑）
//   node tests/synthetic.js --update   把目前算出的結果寫回 expected.json（只在「這次就是要改數字」的 PR 用，commit 要寫明哪幾筆、為什麼）
//   node tests/synthetic.js --selftest 反向驗證：故意改壞一處金額算法（請款列金額 +1 元），樣本一定要變紅
//   node tests/synthetic.js --table    印出「健檢 1 條號 → 樣本代號」對照表（docs/合成樣本對照表.md 由此產生）
//
// 規則：
//   ‧ 樣本只放假資料（案名「範例工程…」、業主「甲營造」…），不得出現真實案名、客戶、廠商、金額。
//   ‧ map.json 必須涵蓋健檢 1 第 1～39 條；每條要嘛列出樣本代號，要嘛寫明「不涉及金額」的理由。少一條就算失敗。
//   ‧ 標準答案：先照現行程式算出；G／G2 已修的條目另外手算核對（樣本的 hand 欄）。標「現況」的是健檢 1 指出、還沒修的算法，
//     之後 2b／3b 修正時，同一個 PR 更新答案並寫明原因。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'synthetic');
const ARGS = process.argv.slice(2);
const UPDATE = ARGS.includes('--update');
const SELFTEST = ARGS.includes('--selftest');
const TABLE = ARGS.includes('--table');
const ONLY = (ARGS.find(a => /^--only=/.test(a)) || '').slice(7);   // 開發用：只跑代號開頭相符的樣本（--update 時只合併這幾筆，不檢查對照表）
const ITEMS = 39;   // 健檢 1 共 39 條

function loadSamples() {
  const all = [];
  fs.readdirSync(DIR).filter(f => /^samples_.*\.js$/.test(f)).sort().forEach(f => {
    const arr = require(path.join(DIR, f));
    arr.forEach(s => { s.file = f; all.push(s); });
  });
  return all;
}
const SAMPLES_ALL = loadSamples();
const SAMPLES = ONLY ? SAMPLES_ALL.filter(s => s.id.indexOf(ONLY) === 0) : SAMPLES_ALL;
const MAP = JSON.parse(fs.readFileSync(path.join(DIR, 'map.json'), 'utf8'));
const EXPECTED_FILE = path.join(DIR, 'expected.json');
const EXPECTED = fs.existsSync(EXPECTED_FILE) ? JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8')) : {};

function tableMd() {
  const byId = {}; SAMPLES_ALL.forEach(s => { byId[s.id] = s; });
  let h = '# 合成樣本對照表（健檢 1 條號 → 樣本代號）\n\n'
    + '> 由 `node tests/synthetic.js --table` 產生，不要手改；改 `tests/synthetic/map.json` 或樣本後重新產生。\n'
    + '> 狀態：**正確**＝算法已修好或本來就對（G／G2 修的條目另有手算核對）；**現況**＝健檢 1 指出、還沒修的算法，答案記的是現在程式算出的值，修正時同一個 PR 更新。\n\n'
    + '| 條號 | 健檢 1 摘要 | 樣本 | 狀態 |\n|:-:|:--|:--|:--|\n';
  for (let n = 1; n <= ITEMS; n++) {
    const m = MAP[String(n)] || {};
    const ids = m.samples || [];
    const st = ids.length ? Array.from(new Set(ids.map(id => (byId[id] && byId[id].status) || '?'))).join('／') : '—';
    h += '| ' + n + ' | ' + (m.title || '') + ' | ' + (ids.length ? ids.join('、') : ('不涉及金額：' + (m.none || ''))) + (m.gap ? '（未涵蓋：' + m.gap + '）' : '') + ' | ' + st + ' |\n';
  }
  h += '\n## 樣本清單\n\n| 樣本 | 條號 | 情境 | 狀態 | 手算核對 |\n|:--|:--|:--|:--|:--|\n';
  SAMPLES_ALL.forEach(s => { h += '| ' + s.id + ' | ' + s.items.join('、') + ' | ' + s.title + ' | ' + s.status + ' | ' + (s.hand || '') + ' |\n'; });
  return h;
}

function checkMap() {
  const errs = [];
  const ids = new Set(SAMPLES.map(s => s.id));
  if (ids.size !== SAMPLES.length) errs.push('樣本代號重複');
  for (let n = 1; n <= ITEMS; n++) {
    const m = MAP[String(n)];
    if (!m) { errs.push('對照表缺第 ' + n + ' 條'); continue; }
    const list = m.samples || [];
    if (!list.length && !m.none) errs.push('第 ' + n + ' 條沒有樣本，也沒寫不涉及金額的理由');
    list.forEach(id => {
      if (!ids.has(id)) errs.push('第 ' + n + ' 條列的樣本 ' + id + ' 不存在');
      else if (!SAMPLES.find(s => s.id === id).items.includes(n)) errs.push('樣本 ' + id + ' 沒有標第 ' + n + ' 條');
    });
  }
  SAMPLES.forEach(s => s.items.forEach(n => { const m = MAP[String(n)]; if (!m || !(m.samples || []).includes(s.id)) errs.push('樣本 ' + s.id + ' 標了第 ' + n + ' 條，但對照表沒列'); }));
  SAMPLES.forEach(s => { if (!['正確', '現況'].includes(s.status)) errs.push('樣本 ' + s.id + ' 狀態要寫「正確」或「現況」'); });
  return errs;
}

// 每筆樣本開乾淨的頁面：Firebase 等外部套件一律不載（結果不受網路影響），本機資料從空白開始
async function runAll(browser, rootDir) {
  const out = {};
  const INDEX = 'file://' + path.join(rootDir, 'index.html');
  const reset = fs.readFileSync(path.join(DIR, 'reset.js'), 'utf8');
  for (const s of SAMPLES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
    await ctx.route(/^https?:\/\//, r => r.abort());
    // 時鐘固定從 2026-10-15 10:00（台北）起跑、照實際經過時間前進：「今天」不隨跑測試的日期改變，id 仍不重複
    await ctx.addInitScript(() => {
      const RealDate = Date, t0 = RealDate.now(), base = RealDate.UTC(2026, 9, 15, 2, 0, 0);
      const now = () => base + (RealDate.now() - t0);
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
      window.Date = FakeDate;
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(INDEX);
    await page.waitForFunction(() => typeof window.saveQ === 'function' && typeof window._invRowAmt === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    let r;
    try {
      await page.evaluate(reset);
      r = await page.evaluate('(async () => { ' + s.run.toString().replace(/^[^{]*\{/, '').replace(/\}\s*$/, '') + ' })()');
    } catch (e) { r = { __error: String(e && e.message || e).slice(0, 300) }; }
    if (errs.length) r = Object.assign({}, r, { __pageErrors: errs.slice(0, 3) });
    out[s.id] = r;
    await ctx.close();
  }
  return out;
}

function diff(exp, got) {
  const lines = [];
  const keys = Array.from(new Set(Object.keys(exp || {}).concat(Object.keys(got || {}))));
  keys.forEach(k => {
    const a = JSON.stringify((exp || {})[k]), b = JSON.stringify((got || {})[k]);
    if (a !== b) lines.push('    ' + k + '：標準答案 ' + a + '，這次 ' + b);
  });
  return lines;
}

(async () => {
  if (TABLE) { process.stdout.write(tableMd()); return; }
  const mapErrs = ONLY ? [] : checkMap();
  const docFile = path.join(ROOT, 'docs', '合成樣本對照表.md');
  if (!UPDATE && !ONLY && (!fs.existsSync(docFile) || fs.readFileSync(docFile, 'utf8') !== tableMd())) mapErrs.push('docs/合成樣本對照表.md 不是最新的：請跑 node tests/synthetic.js --table > docs/合成樣本對照表.md');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  if (SELFTEST) {
    // 反向驗證：把 app.js 複製到暫存資料夾，請款列金額 +1 元，樣本必須有不符
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fj-synth-'));
    ['index.html', 'app.js', 'sw.js', 'manifest.json'].forEach(f => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)); });
    const src = fs.readFileSync(path.join(tmp, 'app.js'), 'utf8');
    const re = /function _invRowAmt\(it\)\{/;
    if (!re.test(src)) { console.error('反向驗證：找不到 _invRowAmt，無法故意改壞'); process.exit(1); }
    fs.writeFileSync(path.join(tmp, 'app.js'), src.replace(re, 'function _invRowAmt(it){return _invRowAmt0(it)+1;}\nfunction _invRowAmt0(it){'));
    const got = await runAll(browser, tmp);
    await browser.close();
    const bad = SAMPLES.filter(s => diff(EXPECTED[s.id], got[s.id]).length).map(s => s.id);
    console.log('\n合成樣本．反向驗證（請款列金額故意 +1 元）\n' + '─'.repeat(64));
    console.log(bad.length ? ('  ✓ 抓到了：' + bad.length + ' 筆樣本變紅（' + bad.join('、') + '）') : '  ✗ 故意改壞後樣本全過——樣本沒有擋住金額錯誤');
    process.exit(bad.length ? 0 : 1);
  }

  const got = await runAll(browser, ROOT);
  await browser.close();
  if (ARGS.includes('--print')) { process.stdout.write(JSON.stringify(got, null, 1) + '\n'); return; }   // 開發用：印出算出的值，不比對、不寫檔
  if (UPDATE) {
    const errored = SAMPLES.filter(s => got[s.id] && (got[s.id].__error || got[s.id].__pageErrors));
    if (errored.length) { console.error('有樣本執行出錯，不更新：' + errored.map(s => s.id + ' ' + JSON.stringify(got[s.id])).join(' | ')); process.exit(1); }
    const cur = ONLY && fs.existsSync(EXPECTED_FILE) ? JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8')) : {};
    const merged = ONLY ? Object.assign(cur, got) : got;
    const ordered = {}; SAMPLES_ALL.forEach(s => { if (merged[s.id] !== undefined) ordered[s.id] = merged[s.id]; });
    fs.writeFileSync(EXPECTED_FILE, JSON.stringify(ordered, null, 1) + '\n');
    if (!ONLY) fs.writeFileSync(docFile, tableMd());
    console.log('已更新 expected.json（' + SAMPLES.length + ' 筆）與 docs/合成樣本對照表.md');
    return;
  }
  let failed = 0;
  console.log('\n豐有工程管理系統．合成樣本（健檢 1 算錢情境）\n' + '─'.repeat(64));
  mapErrs.forEach(e => { failed++; console.log('  ✗ ' + e); });
  SAMPLES.forEach(s => {
    const d = EXPECTED[s.id] ? diff(EXPECTED[s.id], got[s.id]) : ['    沒有標準答案（新樣本請跑 --update，並手算核對）'];
    if (d.length) failed++;
    console.log((d.length ? '  ✗ ' : '  ✓ ') + s.id + '（第 ' + s.items.join('、') + ' 條，' + s.status + '）' + s.title);
    d.forEach(l => console.log(l));
  });
  console.log('─'.repeat(64));
  console.log('  ' + (SAMPLES.length - SAMPLES.filter(s => !EXPECTED[s.id] || diff(EXPECTED[s.id], got[s.id]).length).length) + ' / ' + SAMPLES.length + ' 筆相符' + (failed ? '　✗ ' + failed + ' 項不符' : '　全部相符'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('合成樣本執行失敗：', e); process.exit(1); });
