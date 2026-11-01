// 真實黃金樣本 (b) 工具自我檢查（不用真實資料）：拿合成樣本的假資料做一份「假快照」，把整條流程跑一遍——
//   ① run.js 擷取有算出東西　② deid.js 去識別化後再擷取，數字必須和原本完全相同（compare.js「通過」），且假名字、假電話都不見
//   ③ 故意改壞一處金額算法（請款列金額 +1 元）再擷取，compare.js 一定要報差異　④ compare.js --selftest
//   npm run golden
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools', 'golden');
const SYN = path.join(__dirname, 'synthetic');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fj-golden-'));
const node = (args) => { try { return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const FAKE = { client: '試驗名稱甲營造股份有限公司', vendor: '試驗名稱乙鋼鐵行', person: '試驗聯絡人丙', phone: '0912-345-678', email: 'someone@example.org' };

async function makeSnapshot(file) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.addInitScript(() => {
    const RealDate = Date, t0 = RealDate.now(), base = RealDate.UTC(2026, 9, 15, 2, 0, 0);
    const now = () => base + (RealDate.now() - t0);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
    window.Date = FakeDate;
  });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => typeof window.saveQ === 'function' && typeof window._invRowAmt === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  // 合成樣本一筆接一筆跑在同一頁（資料累積成一份多案的假快照）
  const samples = [];
  fs.readdirSync(SYN).filter(f => /^samples_.*\.js$/.test(f)).sort().forEach(f => require(path.join(SYN, f)).forEach(s => samples.push(s)));
  // 每筆樣本在清空的頁面上跑，跑完把各集合收起來；最後合併成一份多案的假快照（id 重複的後者略過）
  let ok = 0;
  const reset = fs.readFileSync(path.join(SYN, 'reset.js'), 'utf8');
  await page.evaluate(() => { window.__acc = { Q: [], INV: [], PAYABLES: [], CONTRACTS: [], CUSTOMERS: [], VENDORS: [], EXPENSES: [] }; });
  for (const s of samples) {
    await page.evaluate(reset);
    try { await page.evaluate('(async () => { ' + s.run.toString().replace(/^[^{]*\{/, '').replace(/\}\s*$/, '') + ' })()'); ok++; } catch (e) { /* 可忽略：個別樣本出錯，其餘照樣收 */ }
    await page.evaluate(() => {
      const src = { Q, INV, PAYABLES, CONTRACTS, CUSTOMERS, VENDORS, EXPENSES };
      Object.keys(src).forEach(k => { const have = new Set(__acc[k].map(x => x && (x.id || JSON.stringify(x)))); (src[k] || []).forEach(x => { const id = x && (x.id || JSON.stringify(x)); if (!have.has(id)) { have.add(id); __acc[k].push(JSON.parse(JSON.stringify(x))); } }); });
    });
  }
  await page.evaluate(() => {
    Q = __acc.Q; INV = __acc.INV;
    PAYABLES.length = 0; __acc.PAYABLES.forEach(x => PAYABLES.push(x));
    CONTRACTS.splice(0); __acc.CONTRACTS.forEach(x => CONTRACTS.push(x));
    CUSTOMERS.length = 0; __acc.CUSTOMERS.forEach(x => CUSTOMERS.push(x));
    VENDORS.length = 0; __acc.VENDORS.forEach(x => VENDORS.push(x));
    EXPENSES.length = 0; __acc.EXPENSES.forEach(x => EXPENSES.push(x));
  });
  const data = await page.evaluate((F) => {
    // 塞假的聯絡資料，檢查去識別化有沒有遮掉
    const q = Q.find(x => x.awarded) || Q[0];
    if (q) { q.client = F.client; q.contact = F.person; q.phone = F.phone; }
    CUSTOMERS.push({ id: 'cu_fake', name: F.client, phone: F.phone, email: F.email, taxId: '12345678', addr: '某市某路 1 號' });
    VENDORS.push({ id: 've_fake', name: F.vendor, bank: '某銀行', acct: '000123456789', contact: F.person });
    INV.forEach(i => { if (q && i.quoteId === q.id) i.client = F.client; });
    const d = JSON.parse(JSON.stringify(_syncPayload().data));
    d.exportDate = new Date().toISOString();
    d.hr = [{ id: 'hr1', name: F.person, h: { base: 50000 } }];
    // 薪資單：去識別化會拿掉，股東報表 hr／稅前會變 → compare --deid 不比這幾欄
    d.payslips = [{ id: 'ps_hr1_2026-09', hrId: 'hr1', ym: '2026-09', name: F.person, gross: 50000, coCost: 6000, status: 'paid' }];
    d.petty = [{ id: 'pc1', date: '2026-09-10', amount: 800, note: F.person }];
    // 系統哨兵值與品名不能被當成名字換掉（公司支出（自付）、成本列品名「租金」）
    const q2 = d.quotes.find(x => x.awarded && x.costs) || d.quotes[0];
    q2.costs = (q2.costs || []).concat([{ id: 'cSelf', type: 'own', vendor: '公司支出（自付）', name: '租金', amt: 3000, date: '2026-09-15' }]);
    return d;
  }, FAKE);
  await browser.close();
  fs.writeFileSync(file, JSON.stringify(data));
  return { ok, total: samples.length, quotes: data.quotes.length, invoices: (data.invoices || []).length };
}

(async () => {
  const results = [];
  const check = (name, pass, info) => { results.push(pass); console.log((pass ? '  ✓ ' : '  ✗ ') + name + (info ? '　' + info : '')); };
  console.log('\n真實黃金樣本工具．自我檢查（假資料）\n' + '─'.repeat(64));
  const snap = path.join(tmp, 'snapshot.json');
  const mk = await makeSnapshot(snap);
  check('假快照', mk.quotes > 0 && mk.invoices > 0, '樣本 ' + mk.ok + '/' + mk.total + '、報價 ' + mk.quotes + '、請款單 ' + mk.invoices);

  const base = path.join(tmp, 'base.json');
  const r1 = node([path.join(TOOLS, 'run.js'), '--snapshot', snap, '--out', base, '--names', path.join(tmp, 'names.json'), '--root', ROOT]);
  const b = r1.code === 0 ? JSON.parse(fs.readFileSync(base, 'utf8')) : null;
  check('run.js 擷取', !!b && Object.keys(b.stat).length > 0 && Object.keys(b.inv).length > 0 && Object.keys(b.year).length > 0 && Object.keys(b.quote).length > 0, r1.out.trim().split('\n').pop());
  const errField = b ? JSON.stringify(b).indexOf('__err') : 0;
  check('擷取沒有算到出錯的欄位', errField < 0);
  const names = r1.code === 0 ? JSON.parse(fs.readFileSync(path.join(tmp, 'names.json'), 'utf8')) : [];
  check('名單有收到假業主、假廠商', names.includes(FAKE.client) && names.includes(FAKE.vendor));
  check('結果檔不含名字', b && !JSON.stringify(b).includes(FAKE.client) && !JSON.stringify(b).includes(FAKE.vendor));

  const dfile = path.join(tmp, 'deid.json');
  const r2 = node([path.join(TOOLS, 'deid.js'), '--snapshot', snap, '--out', dfile, '--map', path.join(tmp, 'map.json')]);
  const dtxt = fs.existsSync(dfile) ? fs.readFileSync(dfile, 'utf8') : '';
  check('deid.js 殘留原名 0 個', r2.code === 0, r2.out.trim());
  const leak = [FAKE.client, FAKE.vendor, FAKE.person, '0912-345-678', FAKE.email, '12345678', '000123456789', '某市某路', '"salary"'].map((s, i) => dtxt.includes(s) ? i : -1).filter(i => i >= 0);
  check('假名字、電話、Email、統編、帳號、地址、薪資都不見', !!dtxt && !leak.length, leak.length ? '還在：第 ' + leak.map(i => i + 1).join('、') + ' 項' : '');
  check('業主代號保留「營造」字尾', /業主C\d{3}營造/.test(dtxt));
  check('哨兵值「公司支出（自付）」與品名「租金」沒被換掉', dtxt.includes('公司支出（自付）') && dtxt.includes('"租金"'));
  check('薪資、零用金清空', (() => { try { const j = JSON.parse(dtxt); return !j.payslips.length && !j.petty.length && !j.hr.length && !('admins' in j) && !('pagePerms' in j); } catch (e) { return false; } })());
  const deidOut = path.join(tmp, 'deid-out.json');
  const r3 = node([path.join(TOOLS, 'run.js'), '--snapshot', dfile, '--out', deidOut, '--root', ROOT]);
  const r4 = r3.code === 0 ? node([path.join(TOOLS, 'compare.js'), base, deidOut, '--deid']) : { code: 1, out: r3.out };
  const r4b = r3.code === 0 ? node([path.join(TOOLS, 'compare.js'), base, deidOut]) : { code: 0, out: '' };
  check('拿掉薪資後，不加 --deid 會報股東報表差異（確認薪資真的有進年度數字）', r4b.code === 1 && /股東報表年度數字/.test(r4b.out), r4b.out.trim());
  check('去識別化後金額完全相同', r4.code === 0 && r4.out.trim() === '通過', r4.out.trim());

  // 反向驗證：請款列金額故意 +1 元，比對一定要報差異
  const bad = path.join(tmp, 'bad'); fs.mkdirSync(bad);
  ['index.html', 'app.js', 'sw.js', 'manifest.json'].forEach(f => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(bad, f)); });
  const src = fs.readFileSync(path.join(bad, 'app.js'), 'utf8');
  fs.writeFileSync(path.join(bad, 'app.js'), src.replace(/function _invRowAmt\(it\)\{/, 'function _invRowAmt(it){return _invRowAmt0(it)+1;}\nfunction _invRowAmt0(it){'));
  const badOut = path.join(tmp, 'bad-out.json');
  const r5 = node([path.join(TOOLS, 'run.js'), '--snapshot', snap, '--out', badOut, '--root', bad]);
  const r6 = r5.code === 0 ? node([path.join(TOOLS, 'compare.js'), base, badOut]) : { code: 0, out: r5.out };
  check('故意改壞金額 → 比對抓到差異', r6.code === 1 && /^差異 \d+ 筆：/.test(r6.out.trim()) && !/\d{4,}/.test(r6.out.replace(/^差異 \d+ 筆/, '')), r6.out.trim().slice(0, 120));
  const r7 = node([path.join(TOOLS, 'compare.js'), '--selftest']);
  check('compare.js 反向驗證', r7.code === 0, r7.out.trim());

  console.log('─'.repeat(64));
  const fail = results.filter(x => !x).length;
  console.log('  ' + (results.length - fail) + ' / ' + results.length + ' 通過' + (fail ? '　✗ ' + fail + ' 項失敗' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('自我檢查執行失敗：', e); process.exit(1); });
