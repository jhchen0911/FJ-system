// 第 3a 步：計算模組（calc/*.js）在 Node 裡單獨跑（不開瀏覽器）。數字與合成樣本 (a)、手算一致。
//   npm run calc
const path = require('path');
const FJC = require(path.join(__dirname, '..', 'calc', 'invoice.js'));
const I = FJC.inv;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info: info || '' });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 稅率：空白＝5、0 合法
check('稅率：空白＝5%、0 是免稅、字串照讀', I.taxR('') === 5 && I.taxR(null) === 5 && I.taxR(0) === 0 && I.taxR('8') === 8 && I.taxM(5) === 1.05 && I.taxM(0) === 1);
// 請款合計：未稅 100,000、稅 5%、保留款 10%、清潔費 10‰
const t = I.totals([60000, 40000], { taxR: 5, retOn: true, retPct: 10, cleanPermil: 10 });
check('請款合計：100,000＋稅 5,000－保留款 10,500－清潔費含稅 1,050＝93,450', t.curTotal === 100000 && t.tax === 5000 && t.retention === 10500 && t.clean === 1000 && t.cleanGross === 1050 && t.total === 93450, JSON.stringify(t));
const t0 = I.totals([100000], { taxR: 5, retOn: false, retPct: 10 });
check('沒勾保留款＝不扣', t0.retention === 0 && t0.total === 105000);
// 保留款（含稅基礎）
check('保留款：本期 100,000×1.05×10%＝10,500；已退還＝0', I.retention({ retention: true, totals: { curTotal: 100000 } }, 5, 10) === 10500 && I.retention({ retention: true, retentionReturned: true, totals: { curTotal: 100000 } }, 5, 10) === 0);
check('保留款：本期 0 時沿用存檔的保留款金額', I.retention({ retention: true, totals: { curTotal: 0, retention: 3000 } }, 5, 10) === 3000);
// 已收款三種（合成樣本 B25b）
const iv = { received: 95000, receivedDate: '2026-09-30', recvHold: 5000, holdRetLog: [{ amt: 5000, date: '2026-10-10' }] };
check('已收款：業主付款 95,000、全部現金 100,000（B25b）', I.rcvOwner(iv) === 95000 && I.rcv(iv) === 100000);
check('依月份歸屬：9 月 95,000、10 月 5,000', I.rcvIn(iv, '2026-09') === 95000 && I.rcvIn(iv, '2026-10') === 5000 && I.rcvIn(iv, '2026') === 100000);
check('當場扣款退還上限＝recvHold（舊版抄到下一期的多出部分不算）', I.holdRetCash({ recvHold: 3000, holdRetAmt: 5000, holdRetDate: '2026-10-01' }).amt === 3000);
check('另記的保留款退還', eq(I.retSepCash({ retentionSep: true, retentionReturned: true, retentionReceivedAmt: '10500', retentionReturnedDate: '2026-12-01' }), { amt: 10500, date: '2026-12-01' }));
check('未退的當場扣款', I.hold(iv) === 0 && I.hold({ recvHold: 5000 }) === 5000);
// 應收
check('應收：93,450－收 50,000－抵銷 25＝43,425；已結清＝0', I.ar({ totals: { total: 93450 }, received: 50000 }, 25) === 43425 && I.ar({ totals: { total: 93450 }, receivedConfirmed: true }, 0) === 0 && I.ar({ totals: { total: 100 }, received: 500 }, 0) === 0);
// 本期發票應開金額（合成樣本 B25：折讓模式清潔費不扣）
const b25 = { cleanMode: 'allow', totals: I.totals([100000], { taxR: 5, cleanPermil: 10 }) };
check('發票應開：折讓模式 105,000、稅 5,000（B25）', I.einvGross(b25) === 105000 && eq(I.einvSplit(105000, 5), { net: 100000, tax: 5000, gross: 105000 }));
check('發票應開：直接扣除模式扣清潔費 103,950', I.einvGross({ cleanMode: 'net', totals: b25.totals }) === 103950 && I.einvGross({ totals: b25.totals }) === 103950);
check('免稅案發票稅額 0', eq(I.einvSplit(100000, 0), { net: 100000, tax: 0, gross: 100000 }));
// calc 不能碰全域資料：模組原始碼裡不准出現 P. / Q. / INV / document / window.（除了最後掛載）
const src = require('fs').readFileSync(path.join(__dirname, '..', 'calc', 'invoice.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('calc/invoice.js 不讀畫面與全域資料', !/\b(P|Q|INV|PAYABLES|CONTRACTS)\b\s*[.[]|document\.|localStorage/.test(src));

// 每個 calc 檔都要：index.html 載入（在 app.js 之前）、sw.js 的 CALC_FILES 有列（離線才開得起來）
{
  const fs = require('fs'), R = path.join(__dirname, '..');
  const files = fs.readdirSync(path.join(R, 'calc')).filter(f => /\.js$/.test(f));
  const idx = fs.readFileSync(path.join(R, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
  const appAt = idx.indexOf('<script src="app.js');
  const bad = files.filter(f => { const at = idx.indexOf('<script src="calc/' + f + '?v='); return at < 0 || at > appAt || sw.indexOf("'./calc/" + f + "'") < 0; });
  check('calc 檔都在 index.html（app.js 之前）與 sw.js 安裝預載清單', files.length > 0 && !bad.length, bad.join('、'));
}
let fail = 0;
console.log('\n計算模組（Node 單獨跑）\n' + '─'.repeat(64));
results.forEach(r => { if (!r.ok) fail++; console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '　' + r.info)); });
console.log('─'.repeat(64) + '\n  ' + (results.length - fail) + ' / ' + results.length + ' 通過' + (fail ? '　✗ ' + fail + ' 項失敗' : ''));
process.exit(fail ? 1 : 0);
