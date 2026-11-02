// 第 3a 步：計算模組（calc/*.js）在 Node 裡單獨跑（不開瀏覽器）。數字與合成樣本 (a)、手算一致。
//   npm run calc
const path = require('path');
const FJC = require(path.join(__dirname, '..', 'calc', 'invoice.js'));
require(path.join(__dirname, '..', 'calc', 'payable.js'));
const I = FJC.inv, PY = FJC.pay;
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
const fs0 = require('fs'), calcDir = path.join(__dirname, '..', 'calc');
fs0.readdirSync(calcDir).filter(f => /\.js$/.test(f)).forEach(f => {
  const src = fs0.readFileSync(path.join(calcDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 在乾淨沙盒裡載入：模組本身不能碰任何外部名稱（只有 globalThis 掛 FJC）
  // 載入後把每個對外函式用幾組常見參數各呼叫一次：函式內部偷用全域名稱（P、_taxM、window…）會丟 ReferenceError
  let clean = true;
  try {
    const g = {}; require('vm').runInNewContext(src, { globalThis: g, module: undefined });
    const inv0 = { id: 'i', items: [], totals: { curTotal: 100, tax: 5, total: 105 }, retention: true, received: 50, recvHold: 5, holdRetLog: [{ amt: 5, date: '2026-01-01' }] };
    const card0 = { id: 'c', rows: [{ id: 'r', unitPrice: 10, stage: 1 }], periods: [{ no: 1, rows: [{ rid: 'r', qty: 1, qi: 1 }], adv: 1 }], advances: [{ id: 'a', amt: 5 }] };
    const argsets = [[], [inv0, 5, 10], [{ amount: 100, retentionPct: 5 }, 5], [card0, card0.periods[0], 100], [card0, 5, 100], [card0.rows[0], card0.periods[0].rows[0], 100], [[1, 2], { taxR: 5, retOn: true, retPct: 10 }], [105, 5], ['c', { no: 1, id: 'x' }, { id: 'e' }], [inv0, '2026']];
    Object.values(g.FJC || {}).forEach(mod => Object.values(mod).forEach(fn => argsets.forEach(a => { try { fn.apply(null, a); } catch (e) { if (e instanceof ReferenceError || /is not defined/.test(e && e.message)) throw e; } })));
  } catch (e) { clean = false; }
  check('calc/' + f + ' 不讀畫面與全域資料（乾淨沙盒載入並逐一呼叫）', clean && !/\b(P|Q|INV|PAYABLES|CONTRACTS)\b\s*[.[]|document\.|localStorage/.test(src));
});

// ── 應付與分包計價（calc/payable.js）──
check('應付含稅：1,000 未稅×1.05＝1,050；未稅應付照原額；有含稅 incl 用 incl', PY.eff({ amount: 1000 }, 5) === 1050 && PY.eff({ amount: 1000, vat: false }, 5) === 1000 && PY.eff({ amount: 1000, incl: 1049 }, 5) === 1049 && PY.vatAmt({ amount: 1000 }, 5) === 50);
check('廠商保留款：含稅 10,500×5%＝525；已付不計', PY.retention({ amount: 10000, retentionPct: 5 }, 5) === 525 && PY.retention({ amount: 10000, retentionPct: 5, status: 'paid' }, 5) === 0);
const card = { id: 'c1', invoice: true, retRate: 5, rows: [{ id: 'r1', qty: 1000, unitPrice: 1000 }, { id: 'r2', qty: 40, unitPrice: 500, stage: 1, inst: 70 }],
  advances: [{ id: 'a1', amt: 359988 }],
  periods: [{ no: 1, rows: [{ rid: 'r1', qty: 400 }], adv: 200000 }, { no: 2, rows: [{ rid: 'r1', qty: 300 }, { rid: 'r2', qi: 40, qr: 0 }], adv: 159988 }, { no: 3, isRet: true, amt: 35700 }] };
const p1 = PY.periodCalc(card, card.periods[0], 100);
check('分包第 1 期：400×1,000＝400,000、保留 5%＝20,000、抵扣預付 200,000、應付 180,000', p1.amt === 400000 && p1.ret === 20000 && p1.net === 380000 && p1.adv === 200000 && p1.pay === 180000, JSON.stringify(p1));
const p2 = PY.periodCalc(card, card.periods[1], 100);
check('分段工項：裝設 40 支×70%×500＝14,000（列的裝設％優先於預設）', p2.amt === 300000 + 14000, JSON.stringify(p2));
check('期別存當時的裝設％（pr.ins）優先，之後改列的％不回溯', PY.periodCalc(card, { no: 9, rows: [{ rid: 'r2', qi: 40, qr: 0, ins: 50 }] }, 100).amt === 10000);
check('保留款退還期：只付退還金額', eq(PY.periodCalc(card, card.periods[2], 100), { amt: 35700, ret: 0, net: 35700, adv: 0, pay: 35700 }));
check('抵扣預付不超過本期淨額', PY.periodCalc(card, { no: 8, rows: [{ rid: 'r1', qty: 1 }], adv: 999999 }, 100).adv === 950);
const al = PY.advInclAlloc(card, 5, 100);
check('預付款含稅抵扣（合成樣本 A14b）：預付 359,988×1.05＝377,987，第 1 期 210,000、第 2 期 167,987，合計＝已付含稅預付', al[1] === 210000 && al[2] === 167987 && al[1] + al[2] === 377987, JSON.stringify(al));
check('廠商請款單價可核實覆寫、應付 id 規則', PY.rowPrice({ unitPrice: 1000 }, { up: 990 }) === 990 && PY.rowPrice({ unitPrice: 1000 }, { up: '' }) === 1000 && PY.payId('c1', { no: 2 }) === 'payc1_p2' && PY.payId('c1', { no: 3, isRet: true }) === 'payc1_r3' && PY.advPayId('c1', { id: 'a1' }) === 'payc1_aa1');

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
