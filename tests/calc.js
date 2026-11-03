// 第 3a 步：計算模組（calc/*.js）在 Node 裡單獨跑（不開瀏覽器）。數字與合成樣本 (a)、手算一致。
//   npm run calc
const path = require('path');
const FJC = require(path.join(__dirname, '..', 'calc', 'invoice.js'));
require(path.join(__dirname, '..', 'calc', 'payable.js'));
require(path.join(__dirname, '..', 'calc', 'report.js'));
require(path.join(__dirname, '..', 'calc', 'comm.js'));
require(path.join(__dirname, '..', 'calc', 'payroll.js'));
require(path.join(__dirname, '..', 'calc', 'lifeline.js')); require(path.join(__dirname, '..', 'calc', 'settle.js')); require(path.join(__dirname, '..', 'calc', 'route.js'));
const I = FJC.inv, PY = FJC.pay, R = FJC.rpt, C = FJC.comm, H = FJC.hr, LL = FJC.ll, ST = FJC.settle, RT = FJC.route;
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
    const R0 = { invoices: [inv0], quotes: [{ costs: [{ amt: 1, date: '2026-01-01' }] }], expenses: [{ date: '2026-01-01', amount: 1 }], payslips: [] }, F0 = { taxM: 1.05, retention: () => 0, rcvIn: () => 0, hrEstimate: () => 0 };
    const G0 = { base: () => 1, profit: () => 1, unit: () => ({ contract: 1, billed: 1 }), rate: () => 1 };
    const argsets = [[], [{ mode: 'unit', val: 1 }, G0], [{ mode: 'rev', val: 1 }, G0], [{ base: 1, days: 1 }], [R0, '2026', F0], [R0, '2026', { taxM: 1.05, months: 1, salaryMonth: 1 }, F0], [{ expByCat: {}, revNet: 1, pretax: 1, exp: 1 }], [inv0, 5, 10], [{ amount: 100, retentionPct: 5 }, 5], [card0, card0.periods[0], 100], [card0, 5, 100], [card0.rows[0], card0.periods[0].rows[0], 100], [[1, 2], { taxR: 5, retOn: true, retPct: 10 }], [105, 5], ['c', { no: 1, id: 'x' }, { id: 'e' }], [inv0, '2026']];
    Object.values(g.FJC || {}).forEach(mod => Object.values(mod).forEach(fn => argsets.forEach(a => { try { fn.apply(null, a); } catch (e) { if (e instanceof ReferenceError || /is not defined/.test(e && e.message)) throw e; } })));
  } catch (e) { clean = false; console.error("[sandbox]", f, e && e.message); }
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

// ── 經營報表（calc/report.js）：年度損益、稅別調整、分潤估算 ──
{
  const invs = [I.totals([100000], { taxR: 5, retOn: true, retPct: 10 }), I.totals([200000], { taxR: 5 })].map((t, k) => ({ id: 'i' + k, date: k ? '2026-03-10' : '2026-02-10', retention: !k, totals: t, received: k ? 210000 : 94500, receivedDate: k ? '2026-04-10' : '2026-03-10' }));
  const quotes = [{ id: 'q', costs: [{ type: 'sub', amt: 150000, date: '2026-02-20' }, { type: 'own', amt: 30000, date: '2026-03-01' }, { type: 'sub', amt: 99999, date: '2025-12-31' }] }];
  const expenses = [{ date: '2026-05-01', amount: 20000, cat: '辦公' }, { date: '2026-05-01', amount: 15000, cat: '營業稅' }, { date: '2026-06-01', amount: 5000, cat: '營所稅' }, { date: '2026-05-02', amount: 9999, costRef: 'x' }];
  const fn = { taxM: 1.05, retention: v => I.retention(v, 5, v.retention ? 10 : 0), rcvIn: I.rcvIn, hrEstimate: () => 60000 };
  const d = R.year({ invoices: invs, quotes, expenses, payslips: [{ ym: '2026-04', gross: 40000, coCost: 6000 }] }, 2026, fn);
  check('年度損益：營收含保留款未稅 300,000、成本 180,000、毛利 120,000、費用 40,000、人事 46,000、稅前 34,000', d.revTax === 304500 && d.ret === 10500 && d.revNet === 300000 && d.cost === 180000 && d.gross === 120000 && d.exp === 40000 && d.hr === 46000 && !d.hrEst && d.pretax === 34000, JSON.stringify(d).slice(0, 300));
  check('年度實收依收款日、成本分類、月別', d.recv === 304500 && d.costByCat['承包（發包）'] === 150000 && d.costByCat['自有（材料機具）'] === 30000 && d.monthly[1].rev === 100000 && d.monthly[2].rev === 200000 && d.monthly[2].recv === 94500 && d.monthly[3].recv === 210000);
  R.taxAdj(d);
  check('營業稅代收代付不算費用、營所稅列稅後：費用 20,000、稅前 54,000、稅後 49,000', d.vat === 15000 && d.inctax === 5000 && d.exp === 20000 && d.pretax === 54000 && d.afterTax === 49000);
  const d0 = R.year({ invoices: invs, quotes, expenses: [], payslips: [] }, '2026', fn);
  check('沒有薪資單：有營運活動的年度用人事估算；沒活動的年度不估', d0.hr === 60000 && d0.hrEst && R.year({ invoices: [], quotes: [], expenses: [], payslips: [] }, '2024', fn).hr === 0);
  const sa = R.shareAuto({ invoices: invs, quotes, expenses }, '2026', { taxM: 1.05, months: 10, salaryMonth: 150000 }, fn);
  check('分潤估算：營收含保留款、扣成本費用與估計薪資；循環資金增額（手算 (322,000−8,333.25)×23/30＝240,478）', sa.rev === 315000 && sa.cost === 180000 && sa.exp === 40000 && sa.salary === 3000000 && sa.netProfit === 0 && sa.wcAdd === 240478, JSON.stringify(sa));
}

// ── 抽成／佣金（calc/comm.js）：合成樣本 A21 合約含稅 3,357,900 → 未稅 3,198,000 → 5% 抽成 159,900 ──
{
  const get = (base, profit, unit, rate) => ({ base: () => base, profit: () => profit, unit: () => unit, rate: b => b ? rate.b : rate.c });
  check('抽成基礎：合約含稅 3,357,900 ÷ 1.05＝3,198,000', C.salesBase(3357900, 1.05) === 3198000);
  const g = get(3198000, 1000000, { contract: 300, billed: 120 }, { c: 0.5, b: 0.8 });
  check('營收 5%＝159,900；毛利 10%＝100,000；固定額照填；每支 500 × 合約 300＝150,000', C.amount({ mode: 'rev', val: 5 }, g) === 159900 && C.amount({ mode: 'profit', val: 10 }, g) === 100000 && C.amount({ mode: 'amt', val: 30000 }, g) === 30000 && C.amount({ mode: 'unit', val: 500 }, g) === 150000);
  check('已計提：總額×收款進度 50%＝79,950；每單位＝已請 120×500×(已收÷已請 80%)＝48,000', C.accr({ mode: 'rev', val: 5 }, g) === 79950 && C.accr({ mode: 'unit', val: 500 }, g) === 48000);
  check('應付金額：每單位隨已請量（120×500＝60,000），其他＝總額', C.due({ mode: 'unit', val: 500 }, g) === 60000 && C.due({ mode: 'rev', val: 5 }, g) === 159900 && C.due(null, g) === 0);
  let called = 0; const lazy = { base: () => { called++; return 100; }, profit: () => { called++; return 0; }, unit: () => { called++; return { contract: 0, billed: 0 }; }, rate: () => 0 };
  C.amount({ mode: 'amt', val: 1 }, lazy);
  check('基礎數字用到才算（固定額不算合約、毛利、數量）', called === 0);
  check('毛利基礎：有實際成本用實際、沒有用預估、不為負；收款進度上限 1', C.profitBase(1000, 300, 999) === 700 && C.profitBase(1000, 0, 400) === 600 && C.profitBase(1000, 2000, 0) === 0 && C.rcvRate({ contractTotal: 100, rcv: 150, billed: 0 }) === 1 && C.rcvRate({ billed: 0, rcv: 1 }, true) === 0);
}
// ── 薪資單（calc/payroll.js）──
{
  const s = H.slip({ payType: 'day', base: '1500', days: '22', tel: 500, other: '', extra: 1000.4, laborSelf: 700, healthSelf: 500, pensionSelf: 0, otherDed: 'x', laborCo: 2000, healthCo: 1500, pensionCo: 1980 });
  check('薪資單：日薪 1,500×22＝33,000＋津貼 500＋加班 1,000＝應發 34,500；扣 1,200；實發 33,300；公司負擔 5,480', s.baseAmt === 33000 && s.gross === 34500 && s.ded === 1200 && s.net === 33300 && s.coCost === 5480 && s.other === 0 && s.otherDed === 0);
  check('月薪：照底薪', H.slip({ payType: 'month', base: 40000 }).gross === 40000);
}
// ── 期票現金比例、分包超量 ──
check('收款現金比例：空白／0／非數字＝全現金；60＝0.6；超過 100＝1', I.cashPct({}) === 1 && I.cashPct({ cashPct: 0 }) === 1 && I.cashPct({ cashPct: 'x' }) === 1 && I.cashPct({ cashPct: 60 }) === 0.6 && I.cashPct({ cashPct: 150 }) === 1);
{
  const c = { rows: [{ id: 'r1', qty: 100, unitPrice: 1000, linkedItemIdx: 0 }], periods: [{ no: 1, rows: [{ rid: 'r1', qty: 80 }] }, { no: 2, rows: [{ rid: 'r1', qty: 30 }] }, { no: 3, absorb: true, rows: [{ rid: 'r1', qty: 5 }] }] };
  const o = PY.overStat(c);
  check('分包超量：合約 100、累計 115 → 超 15、第 2 期 10 向業主請、第 3 期 5 我方吸收', o.overAmt === 15000 && o.toOwner === 10000 && o.absorbed === 5000 && o.overQty.r1 === 15 && o.absorbQtyByItem[0] === 5 && o.overQtyByItem[0] === 15, JSON.stringify(o));
}

// ── 安全母索：與豐有既有 Excel「安全母索（多區塊轉換檔）」逐格一致（v5.393 起的冒煙測試；v6.0.141 獨立母索頁併入全套後移到這裡，直接驗 FJC.ll.calc）──
{
  const FORMS = { wire: { label: '鋼索', specs: [['Ø9.53mm（3/8″）', 0.35], ['Ø12.7mm（1/2″）', 0.63], ['Ø16mm（5/8″）', 0.99]] },
                  rope: { label: '特多龍繩', specs: [['Ø16mm', 0.17], ['Ø18mm', 0.21], ['Ø20mm', 0.26]] } };
  const F = () => ({ wire: { spec: 'Ø12.7mm（1/2″）', spare: 1.5, reel: 200, acc: [8, 1, 2] }, rope: { spec: 'Ø16mm', spare: 2, reel: 200, acc: [4, 1, 2] } });
  const Z = (name, deck, form, v, h) => ({ name, deck, form, v: { runs: v[0], rows: v[1].map(x => ({ n: x[0], len: x[1] })) }, h: { runs: h[0], rows: h[1].map(x => ({ n: x[0], len: x[1] })) } });
  // ① 原 Excel「工作表1」：縱向 279.1＋橫向 289.4＋周長 207 ＝ 775.5 m
  let c = LL.calc({ perim: 207, perimRuns: 1, layers: 1, deductLayers: 1, unit: 'cm', useSpare: false, waste: 0, form: 'wire', f: F(),
    zones: [Z('第一區', false, '', [7, [[2, 5650], [2, 4830], [2, 2590], [1, 1770]]], [9, [[3, 4575], [1, 3925], [4, 2425], [1, 1590]]]), Z('構台下', true, '', [0, [[0, 0]]], [0, [[0, 0]]])] }, FORMS);
  check('安全母索 Excel：單區塊 縱 279.1＋橫 289.4＋周長 207＝775.5 M', c.zones[0].v.len === 279.1 && c.zones[0].h.len === 289.4 && c.zoneLen === 568.5 && c.net === 775.5);
  // ② 原 Excel「多區塊(轉換檔)」：縱橫 2973.75、構台下 849、3 層扣一層 ＝ 9275.25 m
  const ZONES = () => [
    Z('第一區', false, '', [9, [[2, 4693], [7, 5112]]], [8, [[8, 5943]]]), Z('第二區', false, '', [9, [[9, 5112]]], [8, [[6, 5512], [2, 4579]]]),
    Z('第三區', false, '', [7, [[7, 3217]]], [5, [[5, 4573]]]), Z('第四區', false, '', [9, [[5, 3217], [3, 2746], [1, 2591]]], [5, [[1, 3397], [1, 5292], [3, 5512]]]),
    Z('轉換檔', false, '', [1, [[1, 8600]]], [1, [[1, 10300]]]), Z('構台下', true, '', [11, [[6, 6400], [5, 1300]]], [19, [[16, 1300], [3, 6400]]])];
  const base = { perim: 401, perimRuns: 1, layers: 3, deductLayers: 1, unit: 'cm', useSpare: false, waste: 0, form: 'wire' };
  c = LL.calc(Object.assign({}, base, { f: F(), zones: ZONES() }), FORMS);
  check('安全母索 Excel：多區塊＋扣構台下 縱橫 2973.75、構台下 849、3 層扣 1 層＝9275.25 M；宣告路數與明細相符', c.zoneLen === 2973.75 && c.deckLen === 849 && c.perLayer === 3374.75 && c.gross === 10124.25 && c.net === 9275.25 && c.bad.length === 0);
  const zb = ZONES(); zb[0].v.runs = 99;
  check('安全母索：宣告路數與明細不符會被抓出', LL.calc(Object.assign({}, base, { f: F(), zones: zb }), FORMS).bad.join('') === '第一區 縱向');
  // ③ 端部預留與損耗：(9275.25＋63路×3層×1.5)×1.05（配件路數 159＝63×3−30）
  c = LL.calc(Object.assign({}, base, { useSpare: true, waste: 5, f: F(), zones: ZONES() }), FORMS);
  check('安全母索：總路數 159、端部預留（構台下不扣）與損耗計入需求長度、折捲', c.runs === 159 && Math.abs(c.need - (9275.25 + 283.5) * 1.05) < 1e-6 && c.reels === Math.ceil(c.need / 200));
  // ④ 兩種形式混用：長度、路數、配件分開彙總；構台下每層最多扣到該層同形式長度
  const zm = ZONES(); zm[2].form = 'rope'; zm[5].form = 'rope';
  c = LL.calc(Object.assign({}, base, { useSpare: true, waste: 5, f: F(), zones: zm }), FORMS);
  check('安全母索：特多龍繩／鋼索混用分開彙總（鋼索 8762.73、特多龍繩 907.68、路數 153／6、配件各自依形式）',
    Math.abs(c.T.wire.net - 8762.73) < 1e-6 && Math.abs(c.T.rope.net - 907.68) < 1e-6 && Math.abs(c.net - 9670.41) < 1e-6 && c.mixed && c.used.length === 2
    && c.T.wire.runs === 153 && c.T.rope.runs === 6 && c.runs === 159 && c.T.wire.unitW > c.T.rope.unitW && c.T.wire.acc[0] === 153 * 8 && c.T.rope.acc[0] === 6 * 4);
  c = LL.calc(Object.assign({}, base, { form: 'rope', f: F(), zones: ZONES() }), FORMS);
  check('安全母索：整案改特多龍繩——鋼索不出現、長度整包搬過去', !c.T.wire.used && Math.abs(c.T.rope.net - 9275.25) < 1e-6 && c.used.length === 1);
  // ⑤ 構台下形式沒有對應區塊：不扣成負數並提出警告
  c = LL.calc({ perim: 200, perimRuns: 1, layers: 3, deductLayers: 1, unit: 'cm', useSpare: false, waste: 0, form: 'wire', f: F(),
    zones: [Z('第一區', false, '', [2, [[2, 5000]]], [2, [[2, 4000]]]), Z('構台下', true, 'rope', [1, [[1, 3000]]], [0, [['', '']]])] }, FORMS);
  check('安全母索：構台下形式無對應區塊不扣成負數、提出警告', c.T.rope.net === 0 && c.T.rope.need === 0 && c.warn.length === 1 && c.T.wire.net === 1140);
}
// ── 第 3c 步：安全母索合一、清潔費一次扣、完工結算差異表 ──
{
  const forms = { wire: { label: '鋼索', specs: [['A', 0.5]] }, rope: { label: '特多龍繩', specs: [['B', 0.2]] } };
  const st = { perim: 100, perimRuns: 1, layers: 3, deductLayers: 1, unit: 'm', useSpare: true, waste: 5, form: 'wire', f: { wire: { spec: 'A', spare: 1.5, reel: 200, acc: [2, 1, 0] } },
    zones: [{ name: '一般', deck: false, form: '', v: { rows: [{ n: 4, len: 25 }] }, h: { rows: [{ n: 2, len: 50 }] } }, { name: '構台下', deck: true, form: '', v: { rows: [{ n: 2, len: 20 }] }, h: { rows: [] } }] };
  const r = LL.calc(st, forms);
  // 每層 100＋200＝300 × 3 層＝900，扣構台下 40×1 層＝860；路數 7×3−2＝19（配件）；端部預留 7×3×1.5＝31.5（構台下不扣）；需求 (860＋31.5)×1.05＝936.075
  check('安全母索：每層 300×3 層−構台下 40＝860；配件路數 19；端部預留 31.5（構台下不扣）；需求 936.075；5 捲；黃色立柱 344', r.net === 860 && r.runs === 19 && r.spare === 31.5 && Math.abs(r.need - 936.075) < 1e-9 && r.reels === 5 && r.yellow === 344 && r.T.wire.acc[0] === 38 && r.T.wire.layers[0].len === 260 && r.T.wire.layers[1].len === 300);
  const big = LL.calc(Object.assign({}, st, { zones: [st.zones[0], { name: '構台下', deck: true, form: '', v: { rows: [{ n: 1, len: 500 }] }, h: { rows: [] } }] }), forms);
  check('安全母索：構台下填太大（500＞每層 300）只扣到該層長度——淨長 600、逐層 0／300／300，不會少算', big.net === 600 && big.T.wire.layers.map(x => x.len).join('/') === '0/300/300');
  const t = I.totals2([100000], { taxR: 5, cleanFixed: 6000 }), t0 = I.totals2([100000], { taxR: 5, cleanPermil: 10 });
  const tc = I.totals2([4000], { taxR: 5, cleanFixed: 6000 });
  check('清潔費一次扣：本期未稅 4,000 不夠扣 6,000 → 只扣 4,000、總計 0（其餘順延，不出現負數）', tc.clean === 4000 && tc.total === 0);
  check('清潔費一次扣：未稅 6,000（含稅 6,300）→ 總計 98,700；沒填一次扣＝照 ‰（同 totals）', t.clean === 6000 && t.cleanGross === 6300 && t.total === 98700 && t0.total === I.totals([100000], { taxR: 5, cleanPermil: 10 }).total);
  const d = ST.diff([{ idx: 0, desc: 'H 型鋼樁', unit: 'M', price: 1000, stmtQty: 950, billedQty: 1000, dailyQty: 1000, addQty: 0 },
    { idx: 1, desc: '追加', unit: 'M', price: 500, stmtQty: 0, billedQty: 40, dailyQty: 40, addQty: 40 },
    { idx: 2, desc: '支撐', unit: 'T', price: 2000, stmtQty: 12, billedQty: 10, dailyQty: 12, addQty: 0 }], { clean: { pct: 0.3, took: 6000, finalNet: 1800000 }, retention: 52500 });
  check('完工結算差異表：少 50M×1,000＝−50,000（業主扣減）；追加 40M 沒進結算書；多 2T 漏請、請款沒跟上日報；清潔費應 5,400 已扣 6,000', d.rows[0].amt === -50000 && /業主扣減/.test(d.rows[0].reasons.join()) && /追加未納入/.test(d.rows[1].reasons.join()) && /漏請/.test(d.rows[2].reasons.join()) && /沒跟上日報/.test(d.rows[2].reasons.join()) && d.nDiff === 3 && d.sumAmt === -50000 - 20000 + 4000 && d.clean.should === 5400 && d.clean.diff === -600 && d.retention === 52500);
}


// ── 路數明細／定尺組合（calc/route.js，v6.0.158；設計筆記 docs/路數明細_設計筆記.md 試算 A～E）──
{
  const ex = [[1, 24.6, 'H350', 23.2, '12.5+10.5', [0.2], 0, 1], [2, 24.6, 'H350', 23.2, '8+7.5+7.5', [0.2], 0, 2], [1, 17.35, 'H350', 15.95, '8+7.5', [0.4], 5, 1],
    [2, 30.8, 'H400', 29.3, '10+9.5+9.5', [0.3], 0, 2], [1, 9.3, 'H300', 8, '8', [], 0, 0]];
  const got = ex.map(e => RT.row({ ly: e[0], wall: e[1] }, { wSpec: e[2] }));
  check('定尺組合：設計筆記試算 A～E 逐例相同（淨長、組合、短節、千斤頂伸長、接頭）', got.every((r, i) => r.net === ex[i][3] && r.pieces.join('+') === ex[i][4] && eq(r.shorts, ex[i][5]) && r.jack === ex[i][6] && r.joints === ex[i][7]),
    got.map(r => r.net + ':' + r.pieces.join('+') + ':' + r.shorts + ':' + r.jack).join(' | '));
  check('定尺：1～13 M 每 0.5、沒有 11／11.5；第 1 層最長 13、第 2 層起 10', RT.STOCK.length === 23 && RT.STOCK.indexOf(11) < 0 && RT.STOCK.indexOf(11.5) < 0 && got[1].pieces.every(x => x <= 10) && got[0].maxLen === 13 && got[1].maxLen === 10);
  check('沒填中間樁位置＝不檢查（叫料單標「接頭位置未檢查中間樁」）；單支沒有接頭', got[0].midChk === 'none' && got[4].midChk === 'single');
  // 接頭窗口（Lotion 11/03 原話：料1與圍令接合後的長度要超過中間樁A至少50cm，但不能超過中間樁A、B中間的長度，以此類推）
  const lw = RT.row({ ly: 1, wall: 24.6, mids: '5,11,17,23' }, { wSpec: 'H350' });
  check('接頭窗口：Lotion 例（到中間樁 A 5 M、A 到 B 6 M；窗口 5.5～8.0、11.5～14.0…）→ 每個接頭都落在某支中間樁的窗口內、合格', lw.midChk === 'ok' && lw.jointPos.every(j => [5, 11, 17].some(m => j >= m + 0.5 && j <= m + 3)) && !RT.check(lw.pieces, { x0: 0.35, mids: [5, 11, 17, 23], wall: 24.6 }).length, lw.pieces.join('+') + ' @' + lw.jointPos);
  const m1 = RT.row({ ly: 1, wall: 24.6, mids: '6.8,12.9,18.6' }, { wSpec: 'H350' });
  check('接頭窗口：A 例中間樁 6.8／12.9／18.6 → 9.5＋13（接頭 9.85＝6.8 與 12.9 的中點）', m1.pieces.join('+') === '9.5+13' && eq(m1.jointPos, [9.85]) && m1.midChk === 'ok' && !m1.warn.length, m1.pieces.join('+'));
  const ck = o => RT.check(o.p, { x0: 0.35, mids: o.m, wall: 24.6, minGap: o.g }).join();
  check('排法檢查原因：超過中點、在第一支中間樁之前、離中間樁不到 0.5', /接頭 12\.85 M 超過中間樁 6\.8 M 與中間樁 12\.9 M 的中點 9\.85 M/.test(ck({ p: [12.5, 10.5], m: [6.8, 12.9, 18.6] }))
    && /接頭 5\.35 M 在第一支中間樁（6\.8 M）之前/.test(ck({ p: [5, 18], m: [6.8, 12.9] })) && /接頭 6\.85 M 離中間樁 6\.8 M 不到 0\.5 M/.test(ck({ p: [6.5, 16.5], m: [6.8, 12.9] })));
  check('接頭離中間樁最小距離是參數（改 0.01 M 時接頭 6.85 可接受）', ck({ p: [6.5, 16.5], m: [6.8, 12.9], g: 0.01 }) === '');
  const m2 = RT.row({ ly: 2, wall: 24.6, mids: '8.4,16' }, { wSpec: 'H350' });
  check('B 例中間樁 8.4／16 → 每個接頭都在窗口內（8.9～12.2、16.5～20.3）', m2.midChk === 'ok' && !RT.check(m2.pieces, { x0: 0.35, mids: [8.4, 16], wall: 24.6 }).length && m2.jointPos.every(j => (j >= 8.9 && j <= 12.2) || (j >= 16.5 && j <= 20.3)), m2.pieces.join('+') + ' @' + m2.jointPos);
  const m5 = RT.row({ ly: 2, wall: 24.6, mids: '20' }, { wSpec: 'H350' });
  check('排不出來：只有 20 M 一支中間樁（第 2 層最長 10 M 跨不過去）→ 照長度排、標紅寫原因', m5.midChk === 'conflict' && /接頭 .* 在第一支中間樁（20 M）之前/.test(m5.warn.join()));
  const m4 = RT.row({ ly: 2, wall: 24.6, mids: '6,12,18', cross: '8,16' }, { wSpec: 'H350' });
  check('交叉點：上層支撐接頭離交叉點中心 ≥ 0.5、同時在中間樁窗口內', m4.midChk === 'ok' && m4.jointPos.every(j => [6, 12, 18, 8, 16].every(x => Math.abs(j - x) >= 0.5)) && !RT.check(m4.pieces, { x0: 0.35, mids: [6, 12, 18], cross: [8, 16], wall: 24.6 }).length, m4.pieces.join('+'));
  const bad = []; for (let x = 0.5; x < 60; x += 0.5) bad.push(x);
  const t0 = Date.now(), m3 = RT.row({ ly: 2, wall: 60, mids: bad.join(',') }, { wSpec: 'H350' });
  check('中間樁密到怎麼排都會碰到：照長度排、標紅寫原因（排不出合格的組合：接頭…不到 0.5 M）、不會卡住（< 1 秒）', m3.midChk === 'conflict' && /排不出合格的組合：接頭 .*不到 0\.5 M/.test(m3.warn.join()) && m3.pieces.length === 6 && Date.now() - t0 < 1000);
  check('審查：零頭可由千斤頂／短節補時不多拆一支（13.10→13＋伸長 10 cm；26.10→13＋13；10.40 第 2 層→10＋短節 0.4）', RT.combo(13.1, { maxLen: 13 }).pieces.join('+') === '13' && RT.combo(26.1, { maxLen: 13 }).pieces.join('+') === '13+13' && RT.combo(10.4, { maxLen: 10 }).pieces.join('+') === '10' && eq(RT.combo(10.4, { maxLen: 10 }).shorts, [0.4]));
  check('審查：手改組合看不懂的字要警示；壁間太短（淨長 ≤ 0）支撐 M 不會變負', /手改組合看不懂：9x/.test(RT.row({ ly: 1, wall: 24.6, combo: '10+9x' }, { wSpec: 'H350' }).warn.join()) && RT.row({ ly: 1, wall: 1 }, { wSpec: 'H350' }).supM === 0);
  const mm = RT.row({ ly: 2, wall: 30.8, combo: '10+9.5x2', mids: '5,10.4,15,20,25' }, { wSpec: 'H400' }), mo = RT.row({ ly: 2, wall: 24.6, combo: '13+10' }, { wSpec: 'H350' });
  check('手改組合：照手改、檢查中間樁（10.4 離接頭 10.4 太近）、超過該層最長要警示', mm.manual && mm.pieces.join('+') === '10+9.5+9.5' && mm.midChk === 'conflict' && /超過第 2 層單支最長/.test(mo.warn.join()));
  const d = RT.row({ ly: 2, wall: 30.8, dbl: '雙' }, { wSpec: 'H400' });
  check('雙支撐：兩支同組合、支撐 M／接頭／短節都 ×2', d.mult === 2 && d.supM === 58.6 && d.jointsN === 4 && d.shortsN === 2 && d.pieces.join('+') === '10+9.5+9.5');
  const sp = RT.spares([{ shorts: [0.2], mult: 1 }, { shorts: [0.2], mult: 2 }, { shorts: [0.2, 0.1], mult: 1 }, { shorts: [0.2], mult: 1 }]);
  check('短節備品：全案同長度合計×1.1 無條件進位（0.2×5→6、0.1×1→2）', eq(sp.rows, [{ len: 0.1, n: 1, order: 2 }, { len: 0.2, n: 5, order: 6 }]) && sp.order === 8);
  check('零頭：≤15cm 千斤頂伸長；0.45 用 0.4＋伸長 5cm；1 只補不到才 2 只', eq(RT.fill(0.15), { shorts: [], jack: 15 }) && eq(RT.fill(0.45), { shorts: [0.4], jack: 5 }) && eq(RT.fill(0.95), { shorts: [0.6, 0.3], jack: 5 }) && RT.fill(2) === null);
  const cv = RT.csv('層,路編號,方向,壁間長度,單雙,定尺組合,備註,中間樁位置 M,交叉點位置 M\n1,V1,縱,24.6,雙,,,"6.2,12.9","8,16"\n第2層,H1,橫,30.80,,10+9.5x2,備註\n3,X,縱,0,,,,');
  check('CSV 匯入：略過標題、中間樁位置用雙引號、層可寫「第2層」、壁間 0 的列報錯', cv.rows.length === 2 && cv.rows[0].mids === '6.2,12.9' && cv.rows[0].cross === '8,16' && cv.rows[0].dbl === '雙' && cv.rows[1].ly === 2 && cv.rows[1].dir === '橫' && cv.errs.length === 1);
  const c1 = RT.clearance({ supEl: -3, groundEl: 0, sSpec: 'H350' }), c2 = RT.clearance({ supEl: -1.5, capEl: -0.8, sSpec: 'H350' }), c3 = RT.clearance({ supEl: -3, capEl: -0.5, capRef: 'top', capH: 0.4, sSpec: 'H350' });
  check('構台下淨空：帽梁沒填＝原地面−1.0（預設值）；淨空＝帽梁底−(支撐中心＋型鋼高÷2)；≥1.5 才拉；高程填梁頂時扣梁高', c1.isDef && c1.clear === 1.83 && c1.pull && !c2.isDef && c2.clear === 0.52 && !c2.pull && c3.clear === 1.93 && RT.clearance({ groundEl: 0 }) === null);
  const c4 = RT.clearance({ triEl: -3, groundEl: 0, sSpec: 'H350' });
  check('構台下淨空用三角架高程（下支撐下緣，Lotion 11/03）：支撐頂＝三角架＋型鋼高 → −1−(−3＋0.35)＝1.65', c4.clear === 1.65 && c4.pull && c4.isDef);
  check('斜撐／角撐固定長度：空間 ≥ 2.4 裝、2.1～2.4 待確認、< 2.1 不裝、沒資料不判斷；長度是參數', RT.brace(2.4).fit === 'yes' && RT.brace(2.39).fit === 'check' && RT.brace(2.1).fit === 'check' && RT.brace(2.09).fit === 'no' && RT.brace('').fit === 'none' && RT.brace(2.3, { max: 2.4 }).fit === 'yes');
  const rv = RT.review([{ idx: 0, qty: 109, meas: 100, amt: 50 }, { idx: 1, qty: 106, meas: 100, amt: 900 }, { idx: 2, qty: 120, meas: 100, amt: 50 }, { idx: 3, qty: 5, meas: '' }], 1000);
  check('圖面覆核：一般工項 10%、占總價一成以上 5%；沒量測不比', rv.rows.length === 3 && !rv.rows[0].bad && rv.rows[1].bad && rv.rows[1].big && rv.rows[2].bad && rv.nBad === 2);
}

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
