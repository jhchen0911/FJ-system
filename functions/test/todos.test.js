// 改版第 5 步 5b：雲端每日提醒（buildRemind）＋ calc/todo.js 的保留款到期／結案判定
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../ops/todos.js');
const FJC = require('../calc/todo.js');

const NOW = Date.parse('2026-11-04T02:00:00Z');   // 台北 10:00
test('保留款到期：手填優先；沒填＝結案日＋條件月數；專案填的月數優先於條件文字；沒結案不算', () => {
  const td = FJC.todo;
  assert.strictEqual(td.retDue({ manual: '2027-01-01', closedAt: '2026-01-01', cond: '12 個月' }).date, '2027-01-01');
  assert.deepStrictEqual([td.retMonths('完工驗收後12個月無息退還'), td.retMonths('一年'), td.retMonths('半年'), td.retMonths('驗收後六個月'), td.retMonths('拆除完成後退還')], [12, 12, 6, 6, null]);
  // 審查：日期、民國年、中文數字、兩段式條件
  assert.deepStrictEqual(['114年12月31日前退還', '12月31日前', '民國 114 年驗收後退還', '十五個月', '二十個月', '一年半', '驗收後 6 個月退 50%，保固 12 個月退 50%', '驗收後 30 日內退還', '保固 1 年'].map(td.retMonths), [null, null, null, 15, 20, 18, 12, null, 12]);
  assert.strictEqual(td.retDue({ closedAt: '2026-01-31', months: '999' }).date, '');   // 手填月數超過 120 不算
  const r = td.retDue({ closedAt: '2026-01-31', cond: '驗收後 1 個月' });
  assert.strictEqual(r.date, '2026-02-28'); assert.strictEqual(r.src, 'rule');
  assert.strictEqual(td.retDue({ closedAt: '2026-03-15', cond: '12 個月', months: '3' }).date, '2026-06-15');
  assert.strictEqual(td.retDue({ cond: '12 個月' }).why, 'open');
  assert.strictEqual(td.retDue({ closedAt: '2026-03-15', cond: '驗收後退還' }).why, 'nomonths');
});
test('buildRemind：租期逾期、7 天內到期、收款逾期、保留款逾期、可結案、報價進版；鑰匙跟前端同一套', () => {
  const quotes = {
    q1: { id: 'q1', name: '甲案', awarded: true, ver: 1, items: [{ desc: 'H型鋼樁 打設', unit: 'M', qty: 10, price: 100, note: '30天租期', ot: '5' }],
      dailyLogs: [{ date: '2026-09-01', progressRows: [{ itemIdx: 0, qty: 10 }] }] },
    q2: { id: 'q2', name: '乙案', awarded: true, ver: 1, items: [{ desc: '支撐 安裝', unit: 'M', qty: 5, price: 100, note: '60天租期' }],
      dailyLogs: [{ date: '2026-09-09', progressRows: [{ itemIdx: 0, qty: 5 }] }] },
    q3: { id: 'q3', name: '丙案', awarded: true, closed: true, closedAt: Date.parse('2026-01-10T04:00:00Z'), deduct: { retCond: '結案後 6 個月退還' }, items: [] },
    q4: { id: 'q4', name: '丁案', awarded: true, ver: 2, items: [{ desc: '鋼板樁 打設 GL-12m', unit: 'M', qty: 20, price: 1 }],
      dailyLogs: [{ date: '2026-08-01', status: 'stage', stageOf: 'remove' }] },
  };
  const invoices = {
    i1: { id: 'i1', project: '甲案', quoteId: 'q1', date: '2026-08-05', expectedRecvDate: '2026-10-01', totals: { total: 1050 } },
    i3: { id: 'i3', project: '丙案', quoteId: 'q3', retention: true, retentionPct: 10, totals: { curTotal: 1000, total: 945, retention: 105 }, received: 945 },
    i4: { id: 'i4', project: '丁案', quoteId: 'q4', totals: { total: 21 }, received: 21 },
  };
  const quoteSens = { q4: { rfqs: [{ id: 'r1', quoteVer: 1, items: [{ idx: 0, desc: '鋼板樁 打設 GL-10m', qd: '鋼板樁 打設 GL-10m', unit: 'M', oq: 20 }] }] } };
  const r = T.buildRemind({ shared: { quotes, invoices, contracts: {}, customers: {}, params: { tax: 5 }, qHistory: {} }, priv: { payables: {}, matLedger: {}, quoteSens }, now: NOW });
  assert.strictEqual(r.day, '2026-11-04');
  assert.deepStrictEqual(r.keys.rent, ['q1']);            // 9/2 起算 30 天 → 10/1 到期，已逾期
  assert.deepStrictEqual(r.keys.rentSoon, ['q2#0']);      // 9/10 起算 60 天 → 11/8 到期，4 天內
  assert.deepStrictEqual(r.keys.recv, ['i1']);            // 10/1 預計收款，逾期
  assert.deepStrictEqual(r.keys.ret, ['丙案']);           // 結案 1/10 ＋ 6 個月＝7/10，已過
  assert.deepStrictEqual(r.keys.close, ['q4']);           // 沒保留款：尾款收齊＋全部完工＋包商結清＋材料退完
  assert.deepStrictEqual(r.keys.rfqVer, ['q4']);          // 詢價依據 v1、報價 v2 且深度不同
  assert.ok(!JSON.stringify(r.list).includes('1050'), '明細不放金額');
});

test('v6.0.174 rtdbSafe：去掉 undefined／NaN、鍵名不合法字元換成 _（RTDB 才寫得進去）', () => {
  const r = T.rtdbSafe({ a: undefined, b: [1, undefined, NaN], 'x.y': { 'p$q': 2, 'r/s': [3] }, c: 's', d: null, e: { f: { g: Infinity } } });
  assert.deepStrictEqual(r, { b: [1, null, null], x_y: { p_q: 2, r_s: [3] }, c: 's', e: { f: {} } });
});

test('v6.0.174 looseDate：非 ISO 請款日期（/、.、民國年）各裝置讀成同一天（iPhone 原本讀不懂）', () => {
  const L = FJC.todo.looseDate, f = (s) => { const d = L(s, null); return d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-') : null; };
  assert.deepStrictEqual(['2026-10-05', '2026/10/5', '2026.10.05', '115/10/05', '115年10月5日'].map(f), Array(5).fill('2026-10-5'));
  assert.strictEqual(f('亂打'), null);
  assert.strictEqual(f('12/31/2026'), '2026-12-31');   // 美式交給 new Date
  const ts = L('2026-09-30T20:00:00Z', null); assert.strictEqual(ts.getTime(), Date.parse('2026-09-30T20:00:00Z'));   // 帶時間照原本
});

test('v6.0.235 錢的卡 → fydata/todo/money：本月要請款、草稿待送業主、收款待登錄、預計收款、逾期催款；不寫金額', () => {
  const T = require('../ops/todos.js');
  const r = { list: { bill: [{ qid: 'q1', name: '範例案', cutDate: '2026-11-25', left: 3 }], recv: [{ id: 'i2', d: -20, date: '' }, { id: 'i3', d: 0, date: '2026-11-11' }] } };
  const inv = [{ id: 'i1', project: '範例案', periodNo: 2, st: 'draft', totals: { total: 123456 } }, { id: 'i2', project: '範例案', periodNo: 1, totals: { total: 99999 } }, { id: 'i3', project: '乙案', periodNo: 4 }, { id: 'i4', project: '範例案', periodNo: 1, kind: 'retReturn', st: 'draft' }];
  const m = T.moneyTodos(r, inv, [{ id: 'rv1', type: 'recvSlip', status: 'pending', payload: { invId: 'i2', amt: 50000 } }]);
  const texts = Object.values(m).map((x) => x.text);
  assert.equal(Object.keys(m).length, 5);
  assert.ok(texts.some((t) => /範例案：本月要請款（截止 11-25）/.test(t)));
  assert.ok(texts.some((t) => /範例案 第 2 期：請款單草稿待送業主/.test(t)));
  assert.ok(texts.some((t) => /範例案 第 1 期：收款待登錄/.test(t)));
  assert.ok(texts.some((t) => /範例案 第 1 期：逾期 20 天沒收，要催款/.test(t)));
  assert.ok(texts.some((t) => /乙案 第 4 期：今天預計收款/.test(t)));
  assert.ok(!JSON.stringify(m).match(/123456|99999|50000/), '不寫金額');
  assert.ok(Object.values(m).every((x) => x.src === 'money'));
});
