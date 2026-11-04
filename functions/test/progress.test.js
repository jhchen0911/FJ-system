// 改版第 5 步 5d #9 實際進度回填（functions/ops/progress.js）——全部假資料
const test = require('node:test');
const assert = require('node:assert');
const P = require('../ops/progress.js');

const quotes = {
  m: { id: 'm', name: '主約', awarded: true, items: [
    { desc: 'H 型鋼樁打設', unit: 'M', qty: 30, price: 100 },
    { desc: 'H 型鋼樁拔除', unit: 'M', qty: 30, price: 50 },
    { desc: '鋼板樁', cat: 'both', unit: '片', qty: 10 },
    { desc: '減項', qty: 1, price: -500 },
    { sec: true, desc: '標題' },
  ], dailyLogs: [
    { date: '2026-11-02', progressRows: [{ itemIdx: 0, qty: 10 }, { itemIdx: 2, qty: 4, ph: 'install' }] },
    { date: '2026-11-01', progressRows: [{ itemIdx: 0, qty: 12 }, { itemIdx: 3, qty: 1 }, { itemIdx: -1, note: '備註' }] },
    { date: '2026-11-03', progressRows: [{ itemIdx: 0, qty: 8 }, { itemIdx: 1, qty: 5 }, { itemIdx: 2, qty: 2, ph: 'remove' }, { itemIdx: 4, qty: 1 }, { itemIdx: 9, qty: 1 }] },
    { date: '2026-11-04', photoOnly: true, progressRows: [{ itemIdx: 0, qty: 99 }] },
  ] },
  add: { id: 'add', name: '追加', awarded: true, parentId: 'm', items: [{ desc: '構台裝設', unit: '式', qty: 1 }], dailyLogs: [{ date: '2026-11-03', progressRows: [{ itemIdx: 0, qty: 1 }] }] },
  lost: { id: 'lost', awarded: false, items: [{ desc: 'x' }], dailyLogs: [{ date: '2026-11-01', progressRows: [{ itemIdx: 0, qty: 1 }] }] },
  nop: { id: 'nop', awarded: true, items: [{ desc: 'x' }], dailyLogs: [{ date: '2026-11-01', progressRows: [{ itemIdx: 0, qty: 1 }] }] },   // 沒有專案
};
const projects = { p_m: { id: 'p_m', qid: 'm' }, p_nop: { id: 'p_nop', qid: 'nop', voidAt: 5 } };

test('打設累計、首末日、達合約量那天；拔除分開；追加掛主約專案；減項與只有照片的不算', () => {
  const r = P.build({ quotes, projects, now: 7 });
  assert.deepStrictEqual(Object.keys(r.byPid), ['p_m']);
  const it = r.byPid.p_m;
  const k0 = P.itemKey(0, 'H 型鋼樁打設', 'm');
  assert.deepStrictEqual([it[k0].first, it[k0].last, it[k0].cum, it[k0].doneDate, it[k0].days], ['2026-11-01', '2026-11-03', 30, '2026-11-03', 3]);
  const k1 = P.itemKey(1, 'H 型鋼樁拔除', 'm');
  assert.deepStrictEqual([it[k1].cum, it[k1].rCum, it[k1].rFirst], [0, 5, '2026-11-03']);
  const k2 = P.itemKey(2, '鋼板樁', 'm');
  assert.deepStrictEqual([it[k2].cum, it[k2].rCum], [4, 2]);
  assert.ok(!it[P.itemKey(3, '減項', 'm')]);
  const ka = P.itemKey(0, '構台裝設', 'add');
  assert.strictEqual(it[ka].qid, 'add');
  assert.ok(Object.values(it).every((x) => !('price' in x) && !('amount' in x)));   // 不放金額
});

test('對不到工項（指到標題、列號超出）→ 工務待辦；作廢的專案不回填', () => {
  const r = P.build({ quotes, projects, now: 7 });
  assert.deepStrictEqual(r.mismatch, [{ qid: 'm', name: '主約', n: 2 }]);
  const t = P.todoOf(r.mismatch, 7);
  assert.ok(/2 筆日報數量對不到工項/.test(t.m.text) && t.m.src === 'progress');
});

test('工項 key＝報價 id＋列號＋說明第一行的雜湊（說明第二行改了不變、列號或報價不同會變）', () => {
  assert.strictEqual(P.itemKey(0, 'A\n舊', 'q'), P.itemKey(0, 'A\n新', 'q'));
  assert.notStrictEqual(P.itemKey(0, 'A', 'q'), P.itemKey(1, 'A', 'q'));
  assert.notStrictEqual(P.itemKey(0, 'A', 'm'), P.itemKey(0, 'A', 'add'));
  assert.match(P.itemKey(0, 'A'), /^k[0-9a-f]{12}$/);
});

test('主約與追加同一列同名工項不互相覆蓋（審查）', () => {
  const qs = { m: { id: 'm', awarded: true, items: [{ desc: '打設', qty: 10 }], dailyLogs: [{ date: '2026-11-01', progressRows: [{ itemIdx: 0, qty: 3 }] }] },
    a: { id: 'a', awarded: true, parentId: 'm', items: [{ desc: '打設', qty: 5 }], dailyLogs: [{ date: '2026-11-02', progressRows: [{ itemIdx: 0, qty: 2 }] }] } };
  const r = P.build({ quotes: qs, projects: { p_m: { id: 'p_m' } }, now: 1 });
  const v = Object.values(r.byPid.p_m).map((x) => [x.qid, x.cum]).sort();
  assert.deepStrictEqual(v, [['a', 2], ['m', 3]]);
});
