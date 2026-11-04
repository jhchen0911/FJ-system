// 改版第 5 步 5c #16 月損益／結案損益快照、#18 結案實際成本匯出（functions/ops/pnl.js）——全部假資料
// 跟前端 _shRptYear 逐值一致的比對在 tests/smoke.js（同一份假資料兩邊各算一次）
const test = require('node:test');
const assert = require('node:assert');
const N = require('../ops/pnl.js');

const now = Date.UTC(2026, 10, 4, 2);   // 2026-11-04 台北上午
const inp = {
  params: { tax: 5, removeRate: 30 },
  quotes: {
    m: { id: 'm', name: '假主約', awarded: true, closed: true, deduct: { ret: 5 } },
    a: { id: 'a', name: '假追加', awarded: true, parentId: 'm' },
    o: { id: 'o', name: '假進行中', awarded: true },
  },
  quoteSens: {
    m: { costs: [{ id: 'c1', type: 'labor', date: '2026-10-05', amt: 30000 }, { id: 'c2', type: 'sub', date: '2026-10-01', amt: 0, isIntro: true }] },
    a: { costs: [{ id: 'c3', type: 'own', date: '2026-10-20', amt: 5000 }] },
    o: { costs: [{ id: 'c4', type: 'labor', date: '2026-11-02', amt: 7000 }] },
  },
  invoices: {
    i1: { id: 'i1', quoteId: 'm', date: '2026-10-25', totals: { curTotal: 100000, total: 105000 }, receivedDate: '2026-10-30', receivedAmt: 105000 },
    i2: { id: 'i2', quoteId: 'o', date: '2026-11-03', totals: { curTotal: 20000, total: 21000 } },
  },
  payables: { p1: { id: 'payc2_intro', costId: 'c2', amount: 3000, status: 'paid', paidDate: '2026-10-28' }, p2: { id: 'pay_sales_m', quoteId: 'm', amount: 2000, status: 'pending' } },
  paidLog: { pay_sales_m: { paidAt: Date.UTC(2026, 9, 31, 4) } },   // 帳本記已付（10/31 台北）
  expenses: [{ id: 'e1', date: '2026-10-10', amount: 1050, tax: 50, number: 'AB12345678', cat: '文具' }],
  payslips: [{ ym: '2026-10', gross: 40000, coCost: 4000 }],
};

test('年度管理用損益：營收未稅、施工成本（介紹費不算）、費用（有發票扣進項稅、已付抽成與介紹費依實付日）、人事', () => {
  const { d } = N.yearMgmt(inp, '2026', now);
  assert.strictEqual(d.revNet, 120000);
  assert.strictEqual(d.cost, 42000);
  assert.strictEqual(d.exp, 1000 + 3000 + 2000);
  assert.strictEqual(d.hr, 44000);
  assert.strictEqual(d.pretax, 120000 - 42000 - 6000 - 44000);
  assert.deepStrictEqual(d.monthly[9], { m: 10, rev: 100000, cost: 35000, recv: d.monthly[9].recv });
});

test('月損益快照：上個月那一列＋今年累計', () => {
  const s = N.monthSnap(inp, '2026-10', now);
  assert.strictEqual(s.ym, '2026-10'); assert.strictEqual(s.basis, 'mgmt');
  assert.strictEqual(s.month.rev, 100000); assert.strictEqual(s.month.cost, 35000);
  assert.strictEqual(s.ytd.revNet, 120000);
  assert.ok(!('payables' in s) && !('quotes' in s));
});

test('結案損益：主約＋追加加總、進行中的不算、已凍結的不重算；成本分類給 #18 匯出', () => {
  const c = N.closeSnaps(inp, {}, now);
  assert.deepStrictEqual(Object.keys(c), ['m']);
  assert.deepStrictEqual([c.m.revNet, c.m.cost, c.m.comm, c.m.gross, c.m.net], [100000, 35000, 5000, 65000, 60000]);
  assert.deepStrictEqual(c.m.costByCat, { '點工': 30000, '自有（材料機具）': 5000 });
  assert.deepStrictEqual(N.closeSnaps(inp, { m: 1 }, now), {});
  const csv = N.costExportCsv(c);
  assert.match(csv, /^﻿報價id,工程名稱,成本分類,金額（未稅）/);
  assert.match(csv, /m,假主約,點工,30000/);
});
