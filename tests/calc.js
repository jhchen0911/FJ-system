// 第 3a 步：計算模組（calc/*.js）在 Node 裡單獨跑（不開瀏覽器）。數字與合成樣本 (a)、手算一致。
//   npm run calc
const path = require('path');
const FJC = require(path.join(__dirname, '..', 'calc', 'invoice.js'));
require(path.join(__dirname, '..', 'calc', 'payable.js'));
require(path.join(__dirname, '..', 'calc', 'report.js'));
require(path.join(__dirname, '..', 'calc', 'comm.js'));
require(path.join(__dirname, '..', 'calc', 'payroll.js'));
require(path.join(__dirname, '..', 'calc', 'lifeline.js')); require(path.join(__dirname, '..', 'calc', 'settle.js')); require(path.join(__dirname, '..', 'calc', 'route.js')); require(path.join(__dirname, '..', 'calc', 'vbill.js'));
const I = FJC.inv, PY = FJC.pay, R = FJC.rpt, C = FJC.comm, H = FJC.hr, LL = FJC.ll, ST = FJC.settle, RT = FJC.route;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info: info || '' });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 報價得標率紀錄（calc/bid.js，v6.0.209 小批次線，7b 後端）──
{
  const B = require(path.join(__dirname, '..', 'calc', 'bid.js')).bid;
  check('v6.0.209 得標率：工項類別看說明第一行（中間樁在 H 型鋼樁前、樁在支撐前）',
    B.kind('H型鋼樁打設 H300×300') === 'hpile' && B.kind('H型鋼中間樁打設') === 'midpile' && B.kind('鋼板樁 IV 型\n含運') === 'sheet' && B.kind('水平支撐組立（含圍令）') === 'strut'
    && B.kind('構台組立') === 'deck' && B.kind('安全母索') === 'rope' && B.kind('預壘樁 Ø50') === 'prepile' && B.kind('地錨') === 'anchor' && B.kind('雜項') === 'other' && B.kind('') === 'other');
  check('v6.0.209 得標率（審查）：最先出現的關鍵字優先、「擋土支撐」不算水平支撐、H 形／H300x300 鋼樁、RC 排樁',
    B.kind('H型鋼樁(含中間樁)') === 'hpile' && B.kind('H型鋼樁(全套管施工)') === 'hpile' && B.kind('RC排樁') === 'rcpile' && B.kind('H形鋼樁') === 'hpile' && B.kind('H300x300鋼樁打設') === 'hpile'
    && B.kind('擋土支撐工程 H型鋼樁') === 'hpile' && B.kind('H型鋼支撐') === 'strut' && B.kind('支撐拆除') === 'strut' && B.kind('CCP排樁') === 'ccp');
  check('v6.0.209 得標率（審查）：統計只算佔 10% 以上的類別；建議值正負對稱；歷史是物件也讀得到',
    eq(B.mainKinds([{ desc: 'H型鋼樁', qty: 1, price: 95 }, { desc: '安全母索', qty: 1, price: 5 }]), ['hpile']) && eq(B.mainKinds([{ desc: 'H型鋼樁', qty: 1, price: 85 }, { desc: '安全母索', qty: 1, price: 15 }]), ['hpile', 'rope'])
    && B.suggest({ ready: true, rate: 10, gapPct: 4.5 }) === -2.5 && B.firstOf({ a: { formal: true, ver: 1, snapshot: { t: { total: 7 } } } }, 1) === 7);
  const items = [{ desc: '段落', sec: true }, { desc: 'H型鋼樁打設', qty: 10, price: 1000 }, { desc: '水平支撐', qty: 1, price: 30000 }, { desc: 'H型鋼樁拔除', qty: 10, price: 500 }, { desc: '備用', qty: 1, price: 999, spare: true }, { desc: '減項', qty: 1, price: -100 }];
  check('v6.0.209 得標率：一張報價的類別依未稅金額由大到小，段落／備用單價／減項不算', eq(B.kindsOf(items), [{ kind: 'strut', amt: 30000 }, { kind: 'hpile', amt: 15000 }]), JSON.stringify(B.kindsOf(items)));
  const hist = [{ savedAt: 3, formal: true, ver: 2, snapshot: { t: { total: 90000 } } }, { savedAt: 1, formal: true, ver: 1, snapshot: { t: { total: 105000 } } }, { savedAt: 0, snapshot: { t: { total: 120000 } } }];
  check('v6.0.209 得標率：第一個正式版的總價（版次最小的正式版；沒有正式版用最舊；都沒有用現在）', B.firstOf(hist, 80000) === 105000 && B.firstOf([hist[2]], 80000) === 120000 && B.firstOf([], 80000) === 80000);
  const won = { awarded: true, t: { total: 98000 }, bid: { res: 'won', first: 105000 } }, lost = { bidStatus: 'lost', lostPrice: 90000, t: { total: 99000 }, bid: { res: 'lost', first: 99000 } };
  const vw = B.view(won, { ctAmt: 94500 }), vl = B.view(lost, {});
  check('v6.0.209 得標率：得標＝成交價用主約合約金額、讓價＝第一版－成交；沒得標＝我方最後報價、對手價沿用舊欄位、比對手高幾 %',
    vw.price === 94500 && vw.conc === 10500 && vw.concPct === 10 && vl.price === 99000 && vl.rival === 90000 && vl.gapPct === 10 && B.view(won, {}).price === 98000 && B.view({ t: {} }, {}) === null, JSON.stringify([vw, vl]));
  check('v6.0.209 得標率：現在的結果（得標／沒得標／流標／還沒決定）', B.resOf(won) === 'won' && B.resOf(lost) === 'lost' && B.resOf({ bidStatus: 'void' }) === 'void' && B.resOf({ bidStatus: 'nego' }) === '' && B.resOf(null) === '');
  const row = (res, concPct, gapPct) => ({ kinds: ['hpile'], v: { res, concPct, gapPct } });
  const four = [row('won', 5), row('lost', null, 12), row('lost', null, 8), row('lost', null, null)];
  let st = B.stats(four)[0];
  check('v6.0.209 得標率：不滿 5 筆不給建議', st.n === 4 && st.ready === false && st.adjPct === null && st.rate === 25);
  st = B.stats(four.concat([row('lost', null, null), row('void')]))[0];
  check('v6.0.209 得標率：滿 5 筆、得標率低於 40% → 建議降價＝平均比對手高的一半（流標不算）', st.n === 5 && st.ready && st.rate === 20 && st.gapPct === 10 && st.adjPct === -5, JSON.stringify(st));
  st = B.stats([row('won', 3), row('won', 1), row('won', 2), row('won', 0), row('lost')])[0];
  check('v6.0.209 得標率：得標率高於 60% → 建議往上（每多 10% 加 1%，最多 5%）；平均讓價', st.rate === 80 && st.adjPct === 2 && st.concPct === 1.5, JSON.stringify(st));
  st = B.stats([row('won'), row('won'), row('lost'), row('lost'), row('won')])[0];
  check('v6.0.209 得標率：40～60% 不動；沒有對手價時低得標率照差距推', st.adjPct === 0 && B.suggest({ ready: true, rate: 10, gapPct: null }) === -3 && B.suggest({ ready: true, rate: 0, gapPct: 50 }) === -10);
  check('v6.0.209 得標率：給報價線的統計只有數字、沒有案名金額', eq(Object.keys(B.exportRows([st])[0]).sort(), ['adjPct', 'concPct', 'gapPct', 'kind', 'label', 'lost', 'n', 'rate', 'ready', 'won'].sort()));
}
// ── 進退料 M7（calc/matmove.js，v6.0.210 小批次線）：結案實績、每月閒置浪費 ──
{
  const MV = require(path.join(__dirname, '..', 'calc', 'matmove.js')).mv;
  check('v6.0.210 M7：租金換成每 M 每天（M月÷30、M天照用、片月換不了）', MV.perMDay(30, 'M月') === 1 && MV.perMDay(2, 'M天') === 2 && MV.perMDay(5, '片月') === null && MV.perMDay(0) === null);
  const ra = MV.rentActual([{ d: '2026-10-01', o: '2026-10-31', m: 100 }, { d: '2026-10-11', m: 50 }, { d: '', m: 9 }], '2026-11-10');
  check('v6.0.210 M7：實際租期依 M 數加權（還沒退的算到結案日）', ra.m === 150 && ra.mDays === 4500 && ra.avgDays === 30 && ra.open === 1, JSON.stringify(ra));
  const im = MV.idleInMonth({ ym: '2026-10', start: '2026-10-20', batches: [{ id: 'a', d: '2026-10-01', o: '2026-11-05', m: 10 }, { id: 'b', d: '2026-10-25', m: 20 }, { id: 'c', d: '2026-09-01', o: '2026-10-15', m: 99 }], asOf: '2026-11-10', rate: 30, unit: 'M月' });
  check('v6.0.210 M7：某月閒置＝拔除完成日（或這批進場日較晚者）到退場日，切在這個月；拔除前就退的那批不算', im.cost === 260 && im.mDays === 260 && im.rows.length === 2 && im.rows[0].days === 12 && im.rows[1].days === 7, JSON.stringify(im));
  const im2 = MV.idleInMonth({ ym: '2026-11', start: '2026-10-20', batches: [{ id: 'a', d: '2026-10-01', o: '2026-11-05', m: 10 }, { id: 'b', d: '2026-10-25', m: 20 }], asOf: '2026-11-10', rate: 30, unit: 'M月' });
  check('v6.0.210 M7：下個月接著算到退場日／今天；沒有拔除完成日＝0', im2.cost === 40 + 180 && MV.idleInMonth({ ym: '2026-10', start: '', batches: [{ d: '2026-10-01', m: 1 }], asOf: '2026-11-01', rate: 30 }).cost === 0, JSON.stringify(im2));
  const lo = MV.lossOf([{ st: 'ok', dir: 'in', qid: 'q', own: true, items: [{ name: 'H', spec: '300', len: 12, qty: 10 }] }, { st: 'draft', dir: 'out', qid: 'q', items: [{ name: 'H', spec: '300', len: 12, qty: 10 }] },
    { st: 'ok', dir: 'out', qid: 'q', own: true, items: [{ name: 'H', spec: '300', len: 12, qty: 8, short: 1, dmg: 1, cond: 'repair' }] }, { st: 'ok', dir: 'xfer', fromQid: 'x', toQid: 'q', items: [{ name: 'H', spec: '300', len: 12, qty: 10 }] }], 'q');
  check('v6.0.210 M7：損耗率＝(短少＋損壞)÷進場（轉場進來也算進場；草稿不算）', lo.length === 1 && lo[0].inQty === 20 && lo[0].short === 1 && lo[0].dmg === 1 && lo[0].repair === 8 && lo[0].rate === 10, JSON.stringify(lo));
}
// ── 進退料簿（calc/matmove.js，v6.0.195 進退料統整表 M1）──
{
  const MV = require(path.join(__dirname, '..', 'calc', 'matmove.js')).mv;
  const L = [
    { id: 'a', st: 'ok', dir: 'in', qid: 'A', date: '2026-11-01', truck: 'ab-1', items: [{ name: 'H型鋼', spec: 'H350', len: 12, qty: 40 }] },
    { id: 'b', st: 'ok', dir: 'out', qid: 'A', date: '2026-11-20', truck: 'AB-1', items: [{ name: 'H型鋼', spec: 'H350', len: 12, qty: 30, short: 2 }] },
    { id: 'c', st: 'ok', dir: 'xfer', fromQid: 'A', toQid: 'B', date: '2026-11-20', truck: 'AB-1', items: [{ name: 'H型鋼', spec: 'H350', len: 12, qty: 8 }] },
    { id: 'd', st: 'draft', dir: 'in', qid: 'A', date: '2026-11-21', items: [{ name: 'H型鋼', spec: 'H350', len: 12, qty: 99 }] }];
  const sA = MV.onSite(L, 'A')['H型鋼|H350|12'], sB = MV.onSite(L, 'B')['H型鋼|H350|12'];
  check('進退料：A 案進 40、退 30＋短少 2、轉場給 B 8 → 在場 0；B 案 8 支 96M；待確認不算', sA.qty === 0 && sB.qty === 8 && sB.m === 96, JSON.stringify({ sA, sB }));
  check('進退料：同一天同車號（大小寫、空白不同）算一趟；沒車號每筆一趟', MV.trips(L) === 3 && MV.trips([{ id: 'x' }, { id: 'y' }]) === 2);
  const dirs = ['out', 'back', 'rentIn', 'rentOut', 'other'].map(d => MV.fromSlipDir(d));
  check('舊簽收單方向：倉庫→工地＝進場自有、工地→倉庫＝退場自有、租料進退、其他＝空白', JSON.stringify(dirs) === JSON.stringify([{ dir: 'in', own: true }, { dir: 'out', own: true }, { dir: 'in', own: false }, { dir: 'out', own: false }, { dir: '', own: null }]));
  const wt = { H350: { kgm: 135 }, '千斤頂': { kgpc: 40 } };
  const kgH = MV.itemKg({ spec: 'H350', len: 12, qty: 10 }, wt), kgJ = MV.itemKg({ name: '千斤頂', qty: 5 }, wt);
  check('重量：型鋼 135kg/M × 120M＝16,200kg、副件 40kg × 5＝200kg、查不到＝null', kgH === 16200 && kgJ === 200 && MV.itemKg({ spec: 'H400', len: 9, qty: 1 }, wt) === null);
  const sh = MV.shareByKg([{ key: 'A', kg: 16200 }, { key: 'B', kg: 200 }], 7001);
  check('同車依重量分攤 7,001：加總不差 1 元；缺重量回 null', sh.A + sh.B === 7001 && sh.A === 6916 && sh.B === 85 && MV.shareByKg([{ key: 'A', kg: 1 }, { key: 'B', kg: null }], 100) === null, JSON.stringify(sh));
  const ir = MV.idleRent({ pullDone: '2026-11-10', outDate: '2026-11-25', rate: 6, unit: 'M月', m: 120 });
  check('閒置多付租金：拔除完成 11/10 到退場 11/25＝15 天 × 120M × 6 元／M月 ÷30＝360、每天 24', ir.days === 15 && ir.cost === 360 && ir.perDay === 24, JSON.stringify(ir));
  check('租金單位：M天、片月', MV.rentFor(2, 'M天', 100, 0, 3) === 600 && MV.rentFor(300, '片月', 0, 10, 15) === 1500 && MV.days('2026-11-25', '2026-11-10') === 0);
}

// ── 資料庫規則：正規表示式不能有空的選項（Firebase 規則語法不接受 (a|) 這種寫法，v6.0.195 部署失敗）──
{
  const rules = require('fs').readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const res = [...rules.matchAll(/matches\(\/(.*?)\/\)/g)].map(m => m[1]);
  const bad = res.filter(r => /\|\)|\(\||\|\|/.test(r));
  check('資料庫規則的正規表示式沒有空的選項（|) 或 (| 或 ||）', res.length > 5 && !bad.length, bad.join(' ; '));
}
// v6.0.200 進退料追溯紀錄：兩個節點只能新增（!data.exists()）、不能刪（newData.exists()）、寫入者要是本人；台帳紀錄只有管理員讀
{
  const R = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules.fydata;
  const L = R.matMoveLog, A = R.matAudit;
  const once = n => n && n.$lid && /!data\.exists\(\) && newData\.exists\(\)/.test(n.$lid['.write']) && /newData\.child\('by'\)\.val\(\) === auth\.token\.email/.test(n.$lid['.validate']) && n.$lid.$other && n.$lid.$other['.validate'] === 'false';
  const RD = "root.child('fydata/readers')";
  check('v6.0.200 進退料追溯紀錄規則：只能新增、不能改刪、寫的人要是自己；台帳紀錄管理員＋唯讀帳號讀（Lotion 11/09 第 2 題 B）、工務讀不到、唯讀帳號寫不進去；修改紀錄不收其他欄位', once(L) && once(A) && !/access/.test(A['.read']) && A['.read'].includes('|| ' + RD) && A.$lid['.write'].includes('!' + RD) && !A.$lid['.write'].includes('|| ' + RD) && L.$lid['.write'].includes('!' + RD));
}

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
{ // v6.0.188 第 6 步 6-1p：放款日遇假日順延到下一個工作日
  const ok1 = PY.nextWorkday('2026-11-25', [], []) === '2026-11-25' && PY.nextWorkday('2026-04-25', [], []) === '2026-04-27' && PY.nextWorkday('2026-10-25', [], []) === '2026-10-26';   // 平日不動、週六→週一、週日→週一
  const ok2 = PY.nextWorkday('2027-02-05', ['2027-02-05', '2027-02-08'], []) === '2027-02-09';   // 週五假日→跳過週末→週一也放假→週二
  const ok3 = PY.nextWorkday('2026-12-26', [], ['2026-12-26']) === '2026-12-26' && PY.isWorkday('2026-12-26', [], ['2026-12-26']) && !PY.isWorkday('2026-12-27', [], []);   // 補行上班的週六照常
  const ok4 = PY.nextWorkday('2026-12-31', ['2026-12-31', '2027-01-01'], []) === '2027-01-04' && PY.nextWorkday('', [], []) === '' && PY.nextWorkday('bad', [], []) === 'bad';   // 跨年；空值不動
  check('v6.0.188 放款日順延：平日不動、週末→週一、連續假日跳到第一個工作日、補班週六照常、跨年、空值不動', ok1 && ok2 && ok3 && ok4, JSON.stringify({ ok1, ok2, ok3, ok4 }));
}
{ // v6.0.187 第 6 步 6-1a：同一筆應付分次付款
  const p = { amount: 1097250, vat: true, status: 'pending', pays: [{ id: 'a', amt: 576056, date: '2026-10-05', at: 1 }] };
  const ok1 = PY.eff(p, 5) === 1152113 && PY.paidSum(p, 5) === 576056 && PY.left(p, 5) === 576057 && PY.partial(p, 5) && PY.paidIn(p, '2026-10', 5) === 576056 && PY.paidIn(p, '2026-11', 5) === 0;
  const v = Object.assign({}, p, { pays: [{ id: 'a', amt: 576056, date: '2026-10-05', void: true }] });
  const ok2 = PY.paidSum(v, 5) === 0 && PY.left(v, 5) === 1152113 && !PY.partial(v, 5);
  const full = Object.assign({}, p, { status: 'paid', paidDate: '2026-11-25', pays: [{ id: 'a', amt: 576056, date: '2026-10-05' }, { id: 'b', amt: 576057, date: '2026-11-25' }] });
  const ok3 = PY.paidSum(full, 5) === 1152113 && PY.left(full, 5) === 0 && PY.paidIn(full, '2026-10', 5) === 576056 && PY.paidIn(full, '2026-11', 5) === 576057 && PY.paidIn(full, '2026', 5) === 1152113;
  const old = { amount: 100000, vat: true, status: 'paid', paidDate: '2026-09-30' };   // 舊資料沒有付款紀錄：整筆照實付日
  const ok4 = PY.paidSum(old, 5) === 105000 && PY.left(old, 5) === 0 && PY.paidIn(old, '2026-09', 5) === 105000 && PY.paidIn(old, '2026-10', 5) === 0;
  const over = { amount: 1000, vat: false, status: 'pending', pays: [{ id: 'x', amt: 1500, date: '2026-01-01' }] };   // 付超過：已付合計不超過全額
  const ok5 = PY.paidSum(over, 5) === 1000 && PY.left(over, 5) === 0 && PY.left({ amount: 1000, vat: false, voidAt: 1 }, 5) === 0;
  check('v6.0.187 分次付款：已付合計／餘額／某月實付；撤銷（void）不算；舊資料整筆照實付日；付超過不超過全額', ok1 && ok2 && ok3 && ok4 && ok5, JSON.stringify({ ok1, ok2, ok3, ok4, ok5 }));
}
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

// ── v6.0.160 圖面量測檔 v1 匯入（fixture 為去識別化的 HQ 黃金樣本，數字保留）──
{
  const fx = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'fixtures', 'measure_v1_sample.json'), 'utf8'));
  const m = RT.fromMeasure(fx);
  check('量測檔：格式 v1、3 層、規格（H350／H400）、三角架高程 GL-1.50→−1.5、斜撐可裝 36／待確認 1／建議刪除 3、角撐可裝 0', m.ok && m.L.length === 3 && m.L[0].w === 'H350' && m.L[1].s === 'H400' && m.L[0].triEl === -1.5 && m.L[0].brace.fit === 36 && m.L[0].brace.check === 1 && m.L[0].brace.del === 3 && m.L[0].brace.cFit === 0, JSON.stringify(m.L[0]).slice(0, 300));
  const v1 = m.rows.find(r => r.ly === 1 && r.id === 'V1');
  check('量測檔：每路壁間＝量測長度＋2×圍令型鋼高（29.84＋0.70＝30.54）、方向、交叉點由縱橫中心線算出並換成從壁面量（＋0.35）', m.rows.length === 30 && v1.wall === 30.54 && v1.dir === '縱' && v1.cross.split(',').length >= 3 && v1.mids === '' && !m.hasLine, JSON.stringify(v1));
  check('量測檔：信心度低列出來（結構高程 3 層）、沒有構台帽梁＝null、周長面積深度', m.low.length === 3 && /第1層 結構高程/.test(m.low[0]) && m.capEl === null && m.P === 107.1 && m.A === 616.36 && m.H === 12.3);
  check('量測檔：格式不對拒收', !RT.fromMeasure({ 格式: '別的格式' }).ok && !RT.fromMeasure(null).ok);
  check('規格字串：2-H350、2WH350*2SH350（W 圍令、S 支撐）、RH400、看不懂回 null', eq(RT.specOf('2-H350x350x12x19'), { spec: 'H350', dbl: true }) && eq(RT.specOf('WH400*SH350', 's'), { spec: 'H350', dbl: false }) && eq(RT.specOf('2WH400*2SH350', 'w'), { spec: 'H400', dbl: true }) && RT.specOf('RH400x400x13x21').spec === 'H400' && RT.specOf('') === null && RT.glOf('GL-1.95m') === -1.95 && RT.glOf({ 值: null }) === null);
  // v1.1：每路沿線（中間樁位置、交叉點）有就用；位置從圍令內緣量，換成從壁面量
  const fx2 = JSON.parse(JSON.stringify(fx)); fx2['版本細項'] = 'v1.1'; fx2['各層'][0]['每路沿線'] = { 值: [{ 編號: 1, 方向: '縱向（圖面上下）', 長度m: 29.84, 中間樁位置m: [6, 12, 18, 24], 共構樁位置m: [], 交叉點: [{ 與路: 7, 距起點m: 5 }] }], 信心度: '中' };
  const m2 = RT.fromMeasure(fx2), w1 = m2.rows.find(r => r.ly === 1 && r.id === 'V1');
  check('量測檔 v1.1：每路沿線的中間樁位置＋0.35 帶入、交叉點用檔案給的、接頭依窗口檢查', m2.hasLine && w1.mids === '6.35,12.35,18.35,24.35' && w1.cross === '5.35' && RT.row(w1, { wSpec: 'H350' }).midChk === 'ok', JSON.stringify(w1));
  // v6.0.162（Lotion 11/04）：雙圍令每端扣兩支；交叉點只給上支撐（長向）
  check('雙圍令（前後並排兩支）：2H350 每端扣 0.70 → 壁間 24.6 淨長 22.50；舊呼叫（沒傳 dblWal）照舊 23.20；單圍令不受影響', RT.row({ ly: 2, wall: 24.6 }, { wSpec: '2H350', dblWal: true }).net === 22.5 && RT.row({ ly: 2, wall: 24.6 }, { wSpec: '2H350' }).net === 23.2 && RT.row({ ly: 2, wall: 24.6 }, { wSpec: 'H350', dblWal: true }).net === 23.2 && RT.walT('2H400', true) === 0.8);
  const fx3 = JSON.parse(JSON.stringify(fx)); fx3['各層'][1]['規格']['圍令']['值'] = '2-H400x400x13x21';
  const m3 = RT.fromMeasure(fx3, { dblWal: true, upperOnly: true }), lenL2 = fx3['各層'][1]['每路支撐長度']['值'][0]['長度m'];
  const r3v = m3.rows.find(r => r.ly === 2 && r.id === 'V1'), r1h = m3.rows.find(r => r.ly === 1 && r.dir === '橫'), r1v = m3.rows.find(r => r.ly === 1 && r.id === 'V1');
  check('量測檔＋雙圍令：壁間＝量測長度＋2×兩支型鋼高（＋1.60）、沿線位置＋0.80', Math.abs(r3v.wall - (lenL2 + 1.6)) < 0.011 && m3.L[1].w === '2H400' && Number(r3v.cross.split(',')[0]) > 0.8, JSON.stringify(r3v));
  check('交叉點只給上支撐：長向（縱，約 30 M）留交叉點、短向（橫，約 18 M）清空，備註標上／下支撐', r1v.up === true && r1v.cross !== '' && /（上支撐）/.test(r1v.note) && r1h.up === false && r1h.cross === '' && /（下支撐）/.test(r1h.note));
  const eqD = { 格式: '圖面量測檔 v1', 各層: [{ 層: 1, 規格: { 圍令: { 值: 'H350' }, 支撐: { 值: 'H350' } }, 每路支撐長度: { 值: [{ 編號: 1, 方向: '縱向', 長度m: 10, 起點mm: [0, 0], 終點mm: [0, 10000] }, { 編號: 2, 方向: '橫向', 長度m: 10, 起點mm: [-5000, 5000], 終點mm: [5000, 5000] }] } }] };
  const mE = RT.fromMeasure(eqD, { upperOnly: true }), eqD2 = JSON.parse(JSON.stringify(eqD)); eqD2['各層'][0]['上支撐方向'] = { 值: '橫' };
  const mF = RT.fromMeasure(eqD2, { upperOnly: true });
  check('縱橫一樣長＝上下未定、兩向都避交叉點；檔案有「上支撐方向」以檔案為準；不傳 upperOnly 照舊兩向都給', mE.rows.every(r => r.up === null && r.cross !== '' && /上下未定/.test(r.note)) && mF.rows.find(r => r.dir === '橫').cross !== '' && mF.rows.find(r => r.dir === '縱').cross === '' && RT.fromMeasure(fx3).rows.find(r => r.ly === 1 && r.dir === '橫').cross !== '');
  const m3o = RT.fromMeasure(fx3), r3o = m3o.rows.find(r => r.ly === 2 && r.id === 'V1');
  const fx4 = JSON.parse(JSON.stringify(fx3)); fx4['各層'][1]['每路沿線'] = { 值: [{ 編號: 1, 中間樁位置m: [5, 11], 交叉點: [] }] };
  const r4 = RT.fromMeasure(fx4, { dblWal: true }).rows.find(r => r.ly === 2 && r.id === 'V1');
  const zD = JSON.parse(JSON.stringify(eqD)); zD['各層'][0]['每路支撐長度']['值'].push({ 編號: 3, 方向: '縱向', 長度m: 0 }); zD['各層'][0]['上支撐方向'] = { 值: '長向' };
  const mZ = RT.fromMeasure(zD, { upperOnly: true });
  check('審查：沒傳 dblWal 的 2H 照舊單支換算；沿線中間樁位置＋0.80 精確；長度 0 的路不影響上下判斷；看不懂的上支撐方向要警示', Math.abs(r3o.wall - (lenL2 + 0.8)) < 0.011 && r4.mids === '5.8,11.8' && mZ.rows.filter(r => r.wall > 0.7).every(r => r.up === null) && mZ.warn.some(w => /上支撐方向」看不懂/.test(w)));
  check('交叉點計算：十字交叉在中點、不相交不算', eq(RT.crossings([{ 編號: 1, 方向: '縱', 起點mm: [0, 0], 終點mm: [0, 10000] }, { 編號: 2, 方向: '橫', 起點mm: [-5000, 4000], 終點mm: [5000, 4000] }, { 編號: 3, 方向: '橫', 起點mm: [1000, 2000], 終點mm: [6000, 2000] }]), { 1: [4], 2: [5], 3: [] }));
}

// ── 第 6 步 廠商請款辨識（calc/vbill.js）——假資料 ──
{
  const V = FJC.vb;
  const card = [{ id: 'r1', desc: 'H型鋼樁打設 H350 L=12M', unit: '支', unitPrice: 900 }, { id: 'r2', desc: 'H型鋼樁拔除 H350', unit: '支', unitPrice: 600 }, { id: 'r3', desc: '鋼索 Ø12 安裝', unit: 'M', unitPrice: 28 }];
  const m1 = V.rowMatch({ text: 'Ｈ型鋼樁打設　H350 L=12M', unit: '支', up: 900 }, card);
  const m2 = V.rowMatch({ text: '鋼索φ12', unit: 'M', up: 30 }, card);
  const m3 = V.rowMatch({ text: '吊車租金', unit: '天', up: 8000 }, card);
  check('請款辨識 對位：全形／空白不影響（高）、Ø／φ 統一、對不到＝無', m1.rowId === 'r1' && m1.conf === '高' && m2.rowId === 'r3' && m3.rowId === null && m3.conf === '無', JSON.stringify([m1, m2, m3]));
  const booked = [{ vendor: '假工程行', invNo: 'AB12345678', ref: '第 3 期' }, { vendor: '假機具行', from: '2026-11-01', to: '2026-11-25', total: 52500, ref: '第 1 期' }];
  check('請款辨識 重複請款（第 4 題）：廠商＋發票號（大小寫、全形一樣）；沒有發票號用廠商＋期間＋合計', !!V.dupHit({ vendor: '假工程行 ', invNo: 'ab12345678' }, booked) && !!V.dupHit({ vendor: '假機具行', from: '2026-11-01', to: '2026-11-25', total: '52500' }, booked) && !V.dupHit({ vendor: '假機具行', from: '2026-11-01', to: '2026-11-25', total: 52600 }, booked) && !V.dupHit({ vendor: '假工程行' }, booked));
  const sc = V.sumCheck([{ qty: 40, up: 900 }, { amt: 9000 }], { sub: 45000, tax: 2250, taxMode: '外加' }, 5);
  const sc2 = V.sumCheck([{ qty: 40, up: 900 }], { sub: 36500, tax: 2000, taxMode: '外加' }, 5);
  check('請款辨識 合計檢核：逐項加總差 0、稅額 5%；差 500 與稅額不符會報', sc.diff === 0 && sc.taxOk && sc2.diff === -500 && !sc2.taxOk);
  const s1 = V.slipAmt([{ n: 2, up: 3600 }, { n: 1.5, up: 3600 }], 3500), s2 = V.slipAmt([{ n: 2, up: 3600 }], 0);
  check('請款辨識 簽單（第 7 題）：單價分包卡優先（3.5 工×3,500）、沒有卡價用簽單價並標黃', s1.amt === 12250 && !s1.yellow && s2.amt === 7200 && s2.yellow);
  check('請款辨識 單價（第 2 題）：預設分包卡、勾選才用單據價', V.unitPrice({ up: 30 }, { unitPrice: 28 }, false).up === 28 && V.unitPrice({ up: 30 }, { unitPrice: 28 }, true).up === 30 && V.unitPrice({ up: 30 }, { unitPrice: 28 }, false).diff === 2 && V.unitPrice({ up: 30 }, {}, false).src === 'bill');
  const pl = { vendor: { conf: '高' }, date: { conf: '低' }, rows: [{ rowConf: '高' }, { rowConf: '無' }], asks: [{ field: 'x', q: '要掛哪一項？' }] };
  const g0 = V.gate(pl, {}, null), g1 = V.gate(pl, { qid: 'q', cid: 'c', seen: { date: 1 }, answers: { 'rows[1].rowId': 'none', x: 'new' } }, null);
  const g2 = V.gate(pl, { qid: 'q', cid: 'c', seen: { date: 1 }, answers: { 'rows[1].rowId': 'none', x: 'new' } }, { ref: '第 3 期' }), g3 = V.gate(pl, { qid: 'q', cid: 'c', seen: { date: 1 }, answers: { 'rows[1].rowId': 'none', x: 'new' }, dupReason: '廠商重開發票' }, { ref: '第 3 期' });
  const g4 = V.gate({ needHuman: true }, { qid: 'q', cid: 'c' }, null);
  check('請款辨識 核准前的擋：沒選專案／分包卡、黃色欄位沒點、對不到的列沒選、題目沒答、重複沒寫原因、辨識失敗要人工（第 8 題）', g0.length === 5 && g1.length === 0 && g2.length === 1 && g3.length === 0 && g4.length === 1, JSON.stringify({ g0, g2, g4 }));
}
// ── AI 改單草稿（calc/qdraft.js，v6.0.190 從 app.js 搬出；雲端 fyDraft 共用）──
{
  const D = require(path.join(__dirname, '..', 'calc', 'qdraft.js')).qd;
  const q = { items: [{ desc: '假工項A\n細節', unit: '支', qty: 10, price: 1000 }, { desc: '段落', sec: true }, { desc: '假工項B', unit: 'M', qty: 5, price: 200 }, { desc: '備用', qty: 1, price: 999, spare: true }], rmk: { extra: ['舊條款'] } };
  const p1 = D.plan(q, [{ op: 'set', idx: 0, match: '假工項A', fields: { qty: 12 } }, { op: 'add', item: { desc: '假減項', unit: '式', qty: 1, price: -500 }, after: { match: '假工項B' } }, { op: 'del', match: '假工項B' }, { op: 'rmkAdd', text: '新條款' }]);
  const t1 = D.totals(p1.items, 5);
  check('AI 改單 plan：改數量、接在某列後新增減項、刪列、加條款；原報價不動；小計不含段落與備用', !p1.bad && q.items[0].qty === 10 && p1.items.length === 4 && p1.items[2].desc === '假減項' && t1.sub === 11500 && t1.tax === 575 && t1.total === 12075 && p1.rmk.extra.join('|') === '舊條款|新條款');
  const p2 = D.plan(q, [{ op: 'set', idx: 0, match: '不對的說明', fields: { qty: 1 } }, { op: 'set', match: '假工項B', fields: { constructor: 1 } }, { op: 'zap' }]);
  check('AI 改單 plan：對不上、非白名單欄位、不認得的動作都記為不通過', p2.bad === 3 && D.plan(q, []).bad === 1);
  const c = D.clean([{ op: 'set', idx: '0', match: 'x', fields: { qty: '3', hack: 1 }, extra: 'y' }]);
  check('AI 改單 clean：只留白名單欄位、數字轉型', JSON.stringify(c) === '{"op":"set","idx":0,"match":"x","fields":{"qty":3}}'.replace(/^/, '[').replace(/$/, ']'));
}
// ── v6.0.197 AI 改單：成本單價（estCost）、範本固定條款改字（rmkFix）──
{
  const D = require(path.join(__dirname, '..', 'calc', 'qdraft.js')).qd;
  const base = '1. 本報價有效期限 30 天\n2. 載重 【LOAD】 噸\n6. 本工程無保固及保留款\n7. 本工程無保固及保留款';
  const q = { items: [{ desc: '假工項A', unit: '支', qty: 10, price: 1000, estCost: 600 }], rmk: {} };
  const p1 = D.plan(q, [{ op: 'set', idx: 0, match: '假工項A', fields: { estCost: 700 } }, { op: 'rmkFix', match: '本報價有效期限 30 天', text: '本報價有效期限 60 天' }], null, { rmkBase: base });
  check('AI 改單 成本單價：改前→改後記在列上（給畫面算毛利）；固定條款改字存 rmk.ov[範本第幾行]={from,to}', !p1.bad && p1.items[0].estCost === 700 && p1.rows[0].cost.b === 600 && p1.rows[0].cost.a === 700 && JSON.stringify(p1.rmk.ov) === '{"L0":{"from":"本報價有效期限 30 天","to":"本報價有效期限 60 天"}}' && p1.rows[1].txt === 1 && q.items[0].estCost === 600);
  check('AI 改單 clean：成本給錯字不會變成清掉（留著給 plan 擋）', D.plan({ items: [{ desc: 'A', qty: 1, price: 1, estCost: 5 }] }, D.clean([{ op: 'set', idx: 0, match: 'A', fields: { estCost: 'abc' } }])).bad === 1);
  const p2 = D.plan(q, [{ op: 'rmkFix', match: '本工程無保固及保留款', text: 'x' }, { op: 'rmkFix', match: '載重 【LOAD】 噸', text: 'x' }, { op: 'set', idx: 0, match: '假工項A', fields: { estCost: -1 } }], null, { rmkBase: base });
  check('AI 改單 擋下：兩條一樣對不出、有填數字的條款、成本負數；沒給範本不能改條款', p2.bad === 3 && D.plan(q, [{ op: 'rmkFix', match: '本報價有效期限 30 天', text: 'y' }]).bad === 1);
  const q3 = { items: [{ desc: '假工項A', qty: 1, price: 1, estCost: 5 }], rmk: { ov: { L0: { from: '本報價有效期限 30 天', to: '60 天版' } } } };
  const p3 = D.plan(q3, [{ op: 'rmkFix', match: '60 天版', text: '' }, { op: 'set', idx: 0, match: '假工項A', fields: { estCost: '' } }], null, { rmkBase: base });
  check('AI 改單 回復：條款用改過的字也對得到、text 空白＝回復範本；成本給空白＝清掉', !p3.bad && !('L0' in p3.rmk.ov) && !('estCost' in p3.items[0]) && p3.rows[1].cost.a === null);
  check('AI 改單 clean：成本欄與 rmkFix 留下、轉數字', JSON.stringify(D.clean([{ op: 'set', idx: 0, fields: { estCost: '70' } }, { op: 'rmkFix', match: 'a', text: 'b', x: 1 }, { op: 'add', item: { desc: 'd', qty: 1, price: 2, estCost: '1' } }])) === '[{"op":"set","idx":0,"fields":{"estCost":70}},{"op":"rmkFix","match":"a","text":"b"},{"op":"add","item":{"desc":"d","unit":"","qty":1,"price":2,"note":"","estCost":1}}]');
}
// ── v6.0.211 M6 運費價格表、請款核對、租金期間（照 11/04 寬大請款核對的實際數字）──
{
  const MV = require(path.join(__dirname, '..', 'calc', 'matmove.js')).mv;
  const T = { base: { '新竹': 9000, '台中': 16000, '台中市中科': 16000 }, mult: { '台中': 1.8, '新竹': 1.6 }, perM: [{ pat: 'H300', rate: 30 }, { pat: 'H350', rate: 40 }, { pat: '鋼板樁', rate: 18 }], lenAdd: [{ min: 13, add: 10 }, { min: 16, add: 20 }], waitHr: 2000 };
  const a = MV.freightTrip(T, { place: '台中市中科園區', items: [{ name: '型鋼', spec: 'H300', len: 13.83, qty: 25, m: 345.74 }, { name: '型鋼', spec: 'H300', len: 16.04, qty: 3, m: 48.13 }] });
  check('M6 運費：13M／16M 長度加價、地區加成（寬大 9/18：345.74×40×1.8＝24,893、48.13×50×1.8＝4,332）', a.lines[0].amt === 24893 && a.lines[1].amt === 4332 && a.amt === 29225 && a.region === '台中市中科', JSON.stringify(a.lines));
  const b = MV.freightTrip(T, { place: '新竹縣寶山', items: [{ name: '型鋼', spec: 'H350', len: 4.7, qty: 13, m: 61.15 }], waitH: 3 });
  check('M6 運費：低於基本台收基本台（61.15×40×1.6＝3,914 → 9,000）＋等待 3 小時×2,000', b.useBase && b.amt === 15000 && b.byM === 3914, JSON.stringify(b));
  const c = MV.freightTrip(T, { place: '南投', items: [{ name: '千斤頂', spec: '', len: 0, qty: 8 }] });
  check('M6 運費：價格表沒有的地區、品項會標出來', c.noRegion && c.miss.length === 1, JSON.stringify(c));
  check('M6 請款差額：一張單差 100 以內不出卡（11/10 第 3 題 A）', MV.billDiff(29300, 29225).ok && !MV.billDiff(29400, 29225).ok && MV.billDiff(29400, 29225).diff === 175);
  const r = MV.rentPeriod([{ id: 'a', d: '2026-09-01', m: 90, o: '' }, { id: 'b', d: '2026-09-20', m: 30, o: '2026-09-25' }, { id: 'c', d: '2026-10-02', m: 9 }], '2026-09-01', '2026-09-30', 30);
  check('M6 租金期間：含頭含尾、中途進退場只算在場天數、期間外的批次不算', r.amt === 2880 && r.rows.length === 2 && r.rows[1].days === 6, JSON.stringify(r));
}
// ── v6.0.215 M8 租還是買、累計租金提醒、車型建議 ──
{
  const MV = require(path.join(__dirname, '..', 'calc', 'matmove.js')).mv;
  const a = MV.rentVsBuy({ needs: [{ m: 300, days: 120 }, { m: 200, days: 90 }], rateD: 1, buyPerM: 600, salvage: 30, store: null });
  check('M8 進料前評估：租金＝Σ M×天×日租、買的批量＝最大一筆、淨成本扣殘值、存放沒填＝null', a.rent === 54000 && a.buyM === 300 && a.buy === 180000 && a.net === 126000 && a.store === null && !a.suggestBuy, JSON.stringify(a));
  const b = MV.rentVsBuy({ needs: [{ m: 300, days: 500 }], rateD: 1, buyPerM: 600, salvage: 30, store: 5000 });
  check('M8 進料前評估：租金超過買的淨成本 → 建議買', b.suggestBuy && b.net === 131000, JSON.stringify(b));
  const c1 = MV.buyAlert({ cum: 50000, buy: 100000 }), c2 = MV.buyAlert({ cum: 65000, buy: 100000, future: 20000, futureN: 1 }), c3 = MV.buyAlert({ cum: 65000, buy: 100000, future: 20000, futureN: 0 }), c4 = MV.buyAlert({ cum: 65000, buy: 100000, future: 10000, futureN: 2 });
  check('M8 累計租金：未到 60% 不出卡；≥60% 出卡；預估 >80% 而且之後還有案子才建議買料，否則持續觀察', !c1.show && c2.show && c2.advice === '建議買料' && c3.advice === '持續觀察' && c4.advice === '持續觀察' && c2.ratio === 65 && c2.proj === 85, JSON.stringify([c2, c3, c4]));
  check('M8 車型建議：地區加成 1.6 以上平板車、以下吊板車', MV.truckFor(1.8).type === 'flat' && MV.truckFor(1.6).type === 'flat' && MV.truckFor(1.4).type === 'crane' && MV.truckFor(0).type === 'crane');
}
// v6.0.225 Lotion 11/10：分段拔樁逾期租金改照「時段」列，金額（支·天）一定要跟原本的 rentBatchQtyDays 一樣
{
  const TD = require('../calc/todo.js').todo || require('../calc/todo.js');
  const T = TD.rentSegments ? TD : TD.todo;
  const same = (pg, qty, a, b) => { const s = T.rentSegments(pg, qty, a, b), o = T.rentBatchQtyDays(pg, qty, a, b); return Math.abs(s.qtyDays - o.qtyDays) < 1e-6 ? s : null; };
  // ① 2 段：100 支，11/10 拔 40、11/25 拔 60，逾期 11/1 起算 → 100×10 ＋ 60×15 ＝ 40×10 ＋ 60×25
  const p2 = { cum: 100, remLogs: [{ date: '2026-11-10', qty: 40, done: true }, { date: '2026-11-25', qty: 60, done: true }] };
  const s2 = same(p2, 100, '2026-11-01', '2026-11-30');
  check('v6.0.225 分段拔樁時段：2 段（100×10＋60×15＝40×10＋60×25＝1900 支·天）', !!s2 && s2.qtyDays === 1900 && JSON.stringify(s2.segs.map((x) => [x.from, x.to, x.qty, x.days])) === JSON.stringify([['2026-11-01', '2026-11-10', 100, 10], ['2026-11-11', '2026-11-25', 60, 15]]), JSON.stringify(s2 && s2.segs));
  // ② 3 段：30／30／40，第三段 11/28
  const p3 = { cum: 100, remLogs: [{ date: '2026-11-05', qty: 30, done: true }, { date: '2026-11-15', qty: 30, done: true }, { date: '2026-11-28', qty: 40, done: true }] };
  const s3 = same(p3, 100, '2026-11-01', '2026-11-30');
  check('v6.0.225 分段拔樁時段：3 段（在場 100→70→40，各段天數接續、不重複不漏）', !!s3 && s3.segs.length === 3 && s3.segs.map((x) => x.qty).join() === '100,70,40' && s3.segs.map((x) => x.days).join() === '5,10,13' && s3.qtyDays === 100 * 5 + 70 * 10 + 40 * 13, JSON.stringify(s3 && s3.segs));
  // ③ 跨請款期：第一期 11/1～11/20（還沒拔完的算到 11/20），第二期 11/21～11/30 接著算；兩期加起來＝不切期
  const a = same(p2, 100, '2026-11-01', '2026-11-20'), b = same(p2, 100, '2026-11-21', '2026-11-30'), all = same(p2, 100, '2026-11-01', '2026-11-30');
  check('v6.0.225 分段拔樁時段：跨請款期（期中截斷、下一期從隔天接著算，兩期合計＝不切期）', !!a && !!b && !!all && a.qtyDays + b.qtyDays === all.qtyDays && a.segs[a.segs.length - 1].to === '2026-11-20' && a.segs[a.segs.length - 1].qty === 60 && b.segs.length === 1 && b.segs[0].from === '2026-11-21' && b.segs[0].to === '2026-11-25' && b.segs[0].qty === 60, JSON.stringify({ a: a && a.segs, b: b && b.segs }));
  // ④ 第一段早於逾期起算日：40 支 10/25 就拔完 → 時段 1＝0 天（不列），從 11/1 起算 60 支
  const pE = { cum: 100, remLogs: [{ date: '2026-10-25', qty: 40, done: true }, { date: '2026-11-25', qty: 60, done: true }] };
  const sE = same(pE, 100, '2026-11-01', '2026-11-30');
  check('v6.0.225 分段拔樁時段：第一段早於起算日（那段 0 天不列，從起算日開始算剩下的 60 支）', !!sE && sE.segs.length === 1 && sE.segs[0].from === '2026-11-01' && sE.segs[0].qty === 60 && sE.segs[0].days === 25 && sE.qtyDays === 1500, JSON.stringify(sE && sE.segs));
  // ⑤ 還沒拔完、日報沒勾完成、拔除階段完工：都跟原本一樣（隨機 300 組比對）
  let bad = 0, seed = 7; const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); };
  for (let k = 0; k < 300; k++) {
    const nb = 1 + rnd(4), logs = []; let left = 100, d = 1;
    for (let j = 0; j < nb && left > 0; j++) { d += rnd(12); const q = j === nb - 1 && rnd(2) ? left : Math.min(left, 5 + rnd(40)); left -= q; logs.push({ date: '2026-11-' + String(Math.min(d, 28)).padStart(2, '0'), qty: q, done: rnd(4) > 0 }); }
    const pg = { cum: 100, remLogs: logs, removeDone: left <= 0 ? logs[logs.length - 1].date : '', stageRemove2: rnd(10) === 0 ? '2026-11-26' : '' };
    const st = '2026-11-' + String(1 + rnd(10)).padStart(2, '0'), en = '2026-11-' + String(15 + rnd(15)).padStart(2, '0');
    if (!same(pg, 100, st, en)) bad++;
  }
  check('v6.0.225 分段拔樁時段：隨機 300 組（勾／沒勾完成、還沒拔完、拔除階段完工、各種請款期間）支·天都跟原本一樣', bad === 0, '不一樣 ' + bad + ' 組');
}
// ── v6.0.221 各規格每 M 重量（材料買價每公斤換算每 M）──
{
  const MV = require(path.join(__dirname, '..', 'calc', 'matmove.js')).mv;
  check('每 M 重量：H 型鋼 CNS 1490／JIS G 3192:2014（H300＝93、H350＝135、H400＝172，H300x300 也認得）', MV.kgPerM('H300') === 93 && MV.kgPerM('H350') === 135 && MV.kgPerM('H400') === 172 && MV.kgPerM('H300x300') === 93 && MV.kgPerM('h 350') === 135);
  check('每 M 重量：鋼板樁 JIS（III＝60、IV＝76.1、FSP-IV 也認得）、鋼軌（50KG/M＝50.4）、不認得的回 null', MV.kgPerM('III') === 60 && MV.kgPerM('FSP-IV') === 76.1 && MV.kgPerM('IV') === 76.1 && MV.kgPerM('50KG/M') === 50.4 && MV.kgPerM('37kg') === 37.2 && MV.kgPerM('覆工板') === null && MV.kgPerM('') === null);
}
// ── v6.0.227 請款鏈 2：LINE 日報文字拆工項數量（calc/dailyparse.js）。合成日報 tests/synthetic/daily-line.json：cases 12 則（寫規則時用的）＋ holdout 8 則（規則寫好才加；第一次跑 6/10，修 4 條通則後全對，已不算盲測）
{
  const DL = require(path.join(__dirname, '..', 'calc', 'dailyparse.js')).dl, F = require(path.join(__dirname, 'synthetic', 'daily-line.json'));
  const score = (set) => { let ok = 0, tot = 0, miss = []; F[set].forEach((c, i) => { const R = DL.parse(c.text, F.items).rows; tot += c.expect.length; if (R.length !== c.expect.length) miss.push(set + i + ' 列數 ' + R.length + '≠' + c.expect.length);
    c.expect.forEach((e, j) => { const r = R[j]; if (r && r.itemIdx === e[0] && r.qty === e[1] && (e[0] < 0 || r.ph === e[2]) && r.batchDone === e[3]) ok++; else miss.push(set + i + '#' + j); }); }); return { ok, tot, miss }; };
  const a = score('cases'), b = score('holdout'), c3 = score('adversarial');
  console.log('  （LINE 日報拆數量準確度：cases ' + a.ok + '/' + a.tot + '、holdout ' + b.ok + '/' + b.tot + '、審查刁鑽寫法 ' + c3.ok + '/' + c3.tot + '）');
  check('LINE 日報拆數量：合成日報 32 則逐列對（工項、數量、打設／拔除、本段完成；對不到、兩個一樣像、範圍、累計、昨天明天＝待確認 -1）', !a.miss.length && !b.miss.length && !c3.miss.length, a.miss.concat(b.miss, c3.miss).join('、'));
  const its = F.items;
  check('LINE 日報拆數量：規格數字（H350）、L=12M、第 2 層、怪手 1 台、人數不算數量；國字數量（十五支）', DL.parse('H350 支撐 架設 72 公尺', its).rows[0].qty === 72 && DL.parse('鋼板樁打設 L=12M 共 8 支', its).rows[0].qty === 8 && !DL.parse('怪手1台', its).rows.length && DL.cn2n('十五') === 15 && DL.cn2n('二十') === 20 && DL.cn2n('三') === 3 && DL.cn2n('一百') === 100 && DL.cn2n('兩百三十') === 230 && DL.norm('１,２００') === '1200');
  const logs = [{ date: '2026-11-01', progressRows: [{ itemIdx: 0, qty: 100 }, { itemIdx: 0, qty: 5, ph: 'remove' }] }, { date: '2026-11-02', photoOnly: true, progressRows: [{ itemIdx: 0, qty: 9 }] }];
  check('LINE 日報拆數量：累計只算確認過的日報（只有照片的不算）、打設拔除分開', DL.cumOf(logs, 0, 'install', (r) => r.ph === 'remove' ? 'remove' : 'install') === 100 && DL.cumOf(logs, 0, 'remove', (r) => r.ph === 'remove' ? 'remove' : 'install') === 5);
}
// ── v6.0.234 新格式日報（Lotion 11/11）：17:30 範本帶工項編號；tests/synthetic/daily-line-fmt.json 新格式、舊格式、亂寫 28 則
{
  const DL = require(path.join(__dirname, '..', 'calc', 'dailyparse.js')).dl, F = require(path.join(__dirname, 'synthetic', 'daily-line.json')), G = require(path.join(__dirname, 'synthetic', 'daily-line-fmt.json'));
  const list = DL.askList(F.items, []); let ok = 0, tot = 0; const miss = [];
  G.cases.forEach((c, i) => { const R = DL.parseFmt(c.text, list, F.items).rows; tot += Math.max(1, c.expect.length); if (R.length !== c.expect.length) { miss.push(i + '（' + c.kind + '）列數 ' + R.length + '≠' + c.expect.length); return; } if (!c.expect.length) { ok++; return; }
    c.expect.forEach((e, j) => { const r = R[j]; if (r.itemIdx === e[0] && r.qty === e[1] && (e[0] < 0 || r.ph === e[2]) && r.batchDone === e[3]) ok++; else miss.push(i + '#' + j + '（' + c.kind + '）'); }); });
  console.log('  （新格式日報準確度：' + ok + '/' + tot + '，' + G.cases.length + ' 則）');
  check('新格式日報：合成回報 ' + G.cases.length + ' 則逐列對（編號＋動作＋數量、單位照合約、這段拔完、工項名稱照舊對位；人和機具不算；範本清單、範例、清單沒有的編號不拆；單位不同、累計、範圍、動作跟工項不合＝待確認）', G.cases.length >= 20 && !miss.length, miss.join('、'));
  const same = ['cases', 'holdout', 'adversarial'].every((k) => F[k].every((c) => JSON.stringify(DL.parseFmt(c.text, [], F.items).rows) === JSON.stringify(DL.parse(c.text, F.items).rows)));
  check('新格式日報：舊寫法（沒有【】欄位）整段照原本的 parse，結果完全一樣（舊格式照收、不會被擋）', same);
  const L2 = DL.askList(F.items, [{ progressRows: [{ itemIdx: 0, qty: 120 }, { itemIdx: 2, qty: 60 }] }]);
  check('新格式日報：問句工項清單＝還沒做完的（打設做完的拿掉、打設＋拔除的要兩種都做完才拿掉）、分段標題和備用單價不列、編號 1～N 連號',
    list.length === 9 && !L2.some((e) => e.idx === 0) && L2.some((e) => e.idx === 2) && L2.every((e, i) => e.no === i + 1) && !list.some((e) => F.items[e.idx].sec || F.items[e.idx].spare)
    && !DL.askList([{ desc: '技師簽證', unit: '式', qty: 1, cat: 'other' }], []).length);
  const moved = F.items.slice(); moved.splice(0, 0, { desc: '導溝開挖', unit: 'M', qty: 10 });   // 報價在問句之後多了一列：編號照名稱找回原工項
  const rm = DL.parseFmt('【今天做了】\n1 打設 12', list, moved).rows[0];
  const gone = DL.parseFmt('【今天做了】\n1 打設 12', list, F.items.slice(1)).rows[0];
  check('新格式日報：問句之後報價改過（多一列）→ 照工項名稱找回同一項；那一項被刪了 → 待確認、不猜', rm.itemIdx === 1 && rm.qty === 12 && gone.itemIdx === -1 && /找不到/.test(gone.why));
  const T = DL.askText('說明', [{ site: 'A 案', list: list.slice(0, 2) }, { site: 'B 案', list: list.slice(0, 1) }], '11/11');
  check('新格式日報：一個群組好幾個工地＝好幾段【工地】，編號各自從 1 開始；範本的【本工地工項】不算回報內容（stripList）',
    (T.match(/【工地】/g) || []).length === 2 && /【工地】B 案\n【本工地工項】\n1 /.test(T) && !/追加/.test(DL.stripList('【本工地工項】\n1 追加 H300\n【今天做了】\n1 打設 3')) && /打設 3/.test(DL.stripList('【本工地工項】\n1 追加 H300\n【今天做了】\n1 打設 3')));
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
