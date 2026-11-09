// 第 6 步 6-2a 雲端應付比對（functions/ops/paycmp.js）——全部假資料
const test = require('node:test');
const assert = require('node:assert');
const PC = require('../ops/paycmp.js');

const NOW = Date.UTC(2026, 10, 20, 0);   // 台北 2026-11-20 08:00
const OLD = NOW - 10 * 86400000;
function base() {
  return {
    params: { tax: 5, removeRate: 30, sales: [{ id: 's1', name: '假業務甲', commMode: 'rev', commVal: 1 }] },
    quotes: {
      qa: { id: 'qa', name: '假甲案', awarded: true, salesId: 's1', _mt: OLD, t: { total: 105000, sub: 100000 }, items: [{ desc: '假樁', unit: '支', qty: 10, price: 10000 }] },
      'qb~d~1': { id: 'qb.1', name: '假乙案', awarded: false, _mt: OLD, items: [] },
    },
    quoteSens: {
      qa: { _mt: OLD, costs: [
        { id: 'c1', type: 'sub', vendor: '假包商A', invoice: true, retRate: 5, rows: [{ id: 'r1', unitPrice: 1000, qty: 50 }],
          periods: [{ no: 1, date: '2026-10-25', rows: [{ rid: 'r1', qty: 10 }], early: [{ id: 'e1', amt: 3000, date: '2026-10-10' }] }, { no: 2, date: '2026-11-25', rows: [{ rid: 'r1', qty: 20 }] }],
          advances: [{ id: 'a1', amt: 2000, date: '2026-09-01' }] },
        { id: 'c2', type: 'sub', vendor: '假介紹人', isIntro: true, introPay: 'first', introCalc: 'lump', introAmt: 5000, invoice: false, rows: [] },
        { id: 'c3', type: 'sub', vendor: '假包商B', rows: [] },   // 沒計價：不在第一批
      ], comms: [{ id: 'm1', name: '假中間人', mode: 'amt', val: 1500 }] },
    },
    invoices: { i1: { id: 'i1', quoteId: 'qa', date: '2026-10-30', periodNo: 1, totals: { total: 21000 } } },
    contracts: { k1: { id: 'k1', linkedQid: 'qa', amount: 210000 } },
    payables: {},
  };
}
// 網頁應該存的樣子（這份假資料下，照前端 _syncSubPeriodPayables 等手算）
function webOK() {
  return {
    payc1_p1: { id: 'payc1_p1', costId: 'c1', to: '假包商A', amount: 0, vat: true, _mt: OLD },
    payc1_p1_ee1: { id: 'payc1_p1_ee1', costId: 'c1', to: '假包商A', amount: 3000, vat: true, _mt: OLD },
    payc1_p2: { id: 'payc1_p2', costId: 'c1', to: '假包商A', amount: 0, vat: true, _mt: OLD },
    payc1_aa1: { id: 'payc1_aa1', costId: 'c1', to: '假包商A', amount: 2000, vat: true, _mt: OLD },
    payc2_intro: { id: 'payc2_intro', costId: 'c2', to: '假介紹人', amount: 5000, vat: false, _mt: OLD },
    pay_sales_qa: { id: 'pay_sales_qa', quoteId: 'qa', to: '假業務甲', amount: 2000, vat: false, _mt: OLD },
    comm_qa_m1: { id: 'comm_qa_m1', quoteId: 'qa', to: '假中間人', amount: 1500, vat: false, _mt: OLD },
  };
}
function fill(d) {   // 金額用雲端自己算出來的（期別計價走 calc），再拿來當「網頁存的」
  const { out } = PC.expectAll(PC.ctx(Object.assign({}, d, { now: NOW })));
  const w = webOK(); out.forEach((e) => { const k = Object.keys(w).find((x) => x === e.id); if (k) { w[k].amount = e.amount; if (e.incl != null) w[k].incl = e.incl; } });
  return { out, w };
}

test('算出第一批自動應付：分包期別、提前放款、預付款、介紹費、業務抽成、佣金；沒計價的分包、沒得標的不算', () => {
  const d = base(); const { out } = fill(d);
  assert.deepStrictEqual(out.map((e) => e.id).sort(), ['comm_qa_m1', 'payc1_aa1', 'payc1_p1', 'payc1_p1_ee1', 'payc1_p2', 'payc2_intro', 'pay_sales_qa'].sort());
  const s = out.find((e) => e.id === 'pay_sales_qa'); assert.strictEqual(s.amount, 2000);   // 合約含稅 210,000 ÷ 1.05 × 1%
  const p1 = out.find((e) => e.id === 'payc1_p1'), p2 = out.find((e) => e.id === 'payc1_p2');
  assert.ok(p1.amount > 0 && p2.amount > p1.amount);
});

test('網頁存的跟雲端算的一樣 → 全部一致、ok', () => {
  const d = base(); const { w } = fill(d); d.payables = w;
  const r = PC.compare(d, NOW);
  assert.strictEqual(r.n.bad, 0, JSON.stringify(r.items));
  assert.strictEqual(r.n.ok, 7); assert.ok(r.ok);
});

test('金額不同、少一筆、多一筆、對象不同都抓得到；剛改過的算能解釋', () => {
  const d = base(); const { w } = fill(d);
  w.payc1_p2.amount += 1;                 // 金額不同
  delete w.comm_qa_m1;                    // 少一筆
  w.payc1_p9 = { id: 'payc1_p9', costId: 'c1', to: '假包商A', amount: 100, status: 'pending', _mt: OLD };   // 多一筆（沒付）
  w.payc1_p8 = { id: 'payc1_p8', costId: 'c1', to: '假包商A', amount: 100, status: 'paid', _mt: OLD };      // 多一筆但已付：網頁留著，不算
  w.payc2_intro.to = '別人';              // 對象不同
  w.pay_sales_qa.amount = 1; w.pay_sales_qa._mt = NOW - 3600000;   // 一小時前剛改：能解釋
  d.payables = w;
  const r = PC.compare(d, NOW), by = {}; r.items.forEach((x) => { by[x.id] = x; });
  assert.match(by.payc1_p2.why, /amount/); assert.strictEqual(by.comm_qa_m1.why, 'missing'); assert.strictEqual(by.payc1_p9.why, 'extra');
  assert.ok(!by.payc1_p8); assert.match(by.payc2_intro.why, /to/);
  assert.ok(by.pay_sales_qa.explained && !by.payc1_p2.explained);
  assert.strictEqual(r.n.bad, 4); assert.strictEqual(r.ok, false);
});

test('已付後改金額：本體＋差額合計對得上就一致；已付的抽成不重算；手動改稅別不比；轉換作廢的預付款不算', () => {
  const d = base(); const { w } = fill(d);
  const amt = w.payc1_p2.amount; w.payc1_p2.status = 'paid'; w.payc1_p2.amount = amt - 500;
  w.payc1_p2_d1 = { id: 'payc1_p2_d1', deltaOf: 'payc1_p2', costId: 'c1', amount: 500, status: 'pending' };
  w.pay_sales_qa.status = 'paid'; w.pay_sales_qa.amount = 999;
  w.payc2_intro.vat = true; w.payc2_intro.vatManual = true;
  w.payc1_aa1.convTo = 'payc1_p1';
  d.payables = w;
  const r = PC.compare(d, NOW);
  assert.strictEqual(r.n.bad, 0, JSON.stringify(r.items));
  assert.ok(r.n.skip >= 1);
});

test('報價 id 有「.」（雲端 key 編碼過）也找得到；沒得標的抽成、佣金不算', () => {
  const d = base(); const { w } = fill(d);
  d.quotes['qb~d~1'].salesId = 's1'; d.quotes['qb~d~1'].t = { total: 105000 };
  w['pay_sales_qb.1'] = { id: 'pay_sales_qb.1', quoteId: 'qb.1', to: '假業務甲', amount: 1000, status: 'pending', _mt: OLD };
  d.payables = w;
  const r = PC.compare(d, NOW), x = r.items.find((i) => i.id === 'pay_sales_qb.1');
  assert.ok(x && x.why === 'extra');
});

test('連續一致天數：能解釋的不中斷、沒跑的那天中斷、要跨過一次 25 日', () => {
  const days = {}; const d0 = new Date('2026-12-20T12:00:00Z');
  for (let i = 0; i < 30; i++) { const t = new Date(d0); t.setUTCDate(t.getUTCDate() - i); days[t.toISOString().slice(0, 10)] = { ok: true }; }
  let s = PC.streak(days, '2026-12-20', 25); assert.strictEqual(s.n, 30); assert.ok(s.cross && s.ready);
  days['2026-12-10'] = { ok: false }; s = PC.streak(days, '2026-12-20', 25); assert.strictEqual(s.n, 10); assert.ok(!s.ready);
  delete days['2026-12-10']; s = PC.streak(days, '2026-12-20', 25); assert.strictEqual(s.n, 10);
});

test('審查修正：報價自己的修改時間（日報）不算剛改過；成本卡剛改過才算', () => {
  const d = base(); const { w } = fill(d); w.payc1_p2.amount += 1; d.payables = w;
  d.quotes.qa._mt = NOW - 3600000;   // 今天寫了日報
  let r = PC.compare(d, NOW); assert.strictEqual(r.items.find((x) => x.id === 'payc1_p2').explained, false);
  d.quoteSens.qa._mt = NOW - 3600000;   // 成本卡剛改
  r = PC.compare(d, NOW); assert.strictEqual(r.items.find((x) => x.id === 'payc1_p2').explained, true);
});

test('審查修正：已付的期別改了廠商名稱不算不一致（網頁不改已付的對象）；介紹費已付照比', () => {
  const d = base(); const { w } = fill(d); w.payc1_p2.status = 'paid'; w.payc1_p2.to = '舊名字'; d.payables = w;
  assert.strictEqual(PC.compare(d, NOW).n.bad, 0);
});

test('審查修正：RTDB 把陣列存成物件（成本卡、期別、業務名冊）也照算', () => {
  const d = base(); const { w } = fill(d); d.payables = w;
  const s = d.quoteSens.qa; s.costs = Object.assign({}, s.costs); s.costs['0'] = Object.assign({}, s.costs['0'], { periods: Object.assign({}, s.costs['0'].periods) });
  d.params.sales = { 0: d.params.sales[0] }; s.comms = { 0: s.comms[0] };
  const r = PC.compare(d, NOW); assert.strictEqual(r.n.bad, 0, JSON.stringify(r.items)); assert.strictEqual(r.n.ok, 7);
});

test('審查修正：付款帳本記已付的抽成不重算；改成跟隨的舊介紹費網頁留著不算多出來；佣金 id 先看 quoteId', () => {
  const d = base(); const { w } = fill(d); w.pay_sales_qa.amount = 1; d.paidLog = { pay_sales_qa: { paidAt: 5, unpaidAt: 0 } };
  d.quoteSens.qa.costs[1].introPay = 'follow'; d.payables = w;
  const r = PC.compare(d, NOW);
  assert.ok(!r.items.some((x) => x.id === 'pay_sales_qa' || x.id === 'payc2_intro'), JSON.stringify(r.items));
});
