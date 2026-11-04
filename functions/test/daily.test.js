// 改版第 5 步 5d #8 整體日報（functions/ops/daily.js）——全部假資料
const test = require('node:test');
const assert = require('node:assert');
const D = require('../ops/daily.js');

const date = '2026-11-04';
const quotes = {
  a: { id: 'a', name: '甲案', awarded: true, items: [{ desc: 'H 型鋼樁打設\n第二行', unit: 'M', qty: 100, price: 500 }, { sec: true, desc: '一、標題' }, { desc: '議價減項', qty: 1, price: -3000 }],
    dailyLogs: [{ date, status: 'work', weather: '晴', crews: [{ type: 'labor', n: 2 }, { type: 'sub', vendor: '假工程行', n: 5 }],
      progressRows: [{ itemIdx: 0, qty: 24 }, { itemIdx: 2, qty: 1 }, { itemIdx: -1, note: '【LINE】下午下雨停半天' }] }] },
  b: { id: 'b', name: '乙案', awarded: true, items: [{ desc: '鋼板樁打設', unit: '片', qty: 50 }], dailyLogs: [{ date, photoOnly: true }] },   // 只有照片＝沒確認
  c: { id: 'c', name: '丙案', awarded: true, items: [], dailyLogs: [] },
  z: { id: 'z', name: '已結案', awarded: true, closed: true, dailyLogs: [{ date, status: 'work' }] },
};
const cfg = { groups: {
  Gco: { mode: 'company', name: '公司大群組', audience: 'internal' },
  Ga: { qid: 'a', name: '甲案群', daily: true },                         // 沒設定＝有營造廠 → 草稿
  Gai: { qid: 'a', name: '甲案內部', daily: true, audience: 'internal' },  // 內部 → 直接推
  Gb: { qid: 'b', name: '乙案群', daily: true },
  Gc: { qid: 'c', name: '丙案群', daily: true },
} };
const pending = [{ id: 'x', type: 'dailyLog', status: 'pending', payload: { qid: 'b', date } }, { id: 'y', type: 'dailyLog', status: 'pending', payload: { qid: 'a', date } }];

test('內部群組直接推、營造廠群組（含沒設定）只建草稿；未確認／未回報列給內部', () => {
  const p = D.plan({ quotes, cfg, pending, date, now: 1 });
  assert.deepStrictEqual(p.confirmed, ['a']);
  assert.deepStrictEqual(p.unconf, ['乙案']);         // 甲案草稿雖然 pending，但已經有確認的日報 → 不算未確認
  assert.deepStrictEqual(p.noRep, ['丙案']);
  assert.deepStrictEqual(p.sends.map((s) => s.gid).sort(), ['Gai', 'Gco']);
  assert.deepStrictEqual(p.drafts.map((d) => d.payload.groupId), ['Ga']);
  const co = p.sends.find((s) => s.gid === 'Gco').text;
  assert.match(co, /已確認 1 個工地／未確認 1／未回報 1/);
  assert.match(co, /未確認：乙案/); assert.match(co, /未回報：丙案/);
  assert.match(co, /承包 5 人（假工程行）/);           // 內部版寫包商
  assert.match(co, /H 型鋼樁打設 24M/);
  assert.doesNotMatch(co, /第二行|議價減項|已結案/);   // 只寫說明第一行、減項不算數量、已結案不列
  assert.match(co, /備註：下午下雨停半天/);
  assert.ok(p.todo.unconf && /1 個工地日報沒確認/.test(p.todo.unconf.text));
});

test('對外版（營造廠）不寫包商名稱、不寫未確認名單、不放金額', () => {
  const p = D.plan({ quotes, cfg, pending, date, now: 1 });
  const t = p.drafts[0].payload.text;
  assert.match(t, /人力：7 人/);
  assert.doesNotMatch(t, /假工程行|承包|未確認|未回報|NT\$|500|3000/);
  assert.strictEqual(p.drafts[0].type, 'dailyOut');
  assert.match(p.drafts[0].id, /^[A-Za-z0-9_-]{4,40}$/);   // 草稿 id 要過規則格式
});

test('公司大群組沒設定 audience＝當作有營造廠：整份做成草稿；已處理過的群組不重送', () => {
  const c2 = { groups: { Gco: { mode: 'company', name: '公司大群組' }, Ga: { qid: 'a', daily: true } } };
  const p = D.plan({ quotes, cfg: c2, pending: [], date, now: 1, done: { Ga: 1 } });
  assert.strictEqual(p.sends.length, 0);
  assert.deepStrictEqual(p.drafts.map((d) => d.payload.groupId), ['Gco']);
  assert.doesNotMatch(p.drafts[0].payload.text, /假工程行/);
});

test('沒有已確認日報：不推、不建草稿；report:false 的群組跳過', () => {
  const p = D.plan({ quotes: { b: quotes.b }, cfg, pending, date: date, now: 1 });
  assert.strictEqual(p.sends.length + p.drafts.length, 0);
  const p2 = D.plan({ quotes, cfg: { groups: { Gai: { qid: 'a', audience: 'internal', report: false } } }, date, now: 1 });
  assert.strictEqual(p2.sends.length, 0);
});

test('太長截斷在 LINE 上限內；推送失敗寫緊急待辦', () => {
  const big = { id: 'g', name: '大案', awarded: true, items: [{ desc: 'x', unit: 'M' }], dailyLogs: [{ date, progressRows: Array.from({ length: 900 }, () => ({ itemIdx: 0, qty: 1 })) }] };
  const p = D.plan({ quotes: { big }, cfg: { groups: { G: { qid: 'g', audience: 'internal' } } }, date, now: 1 });
  assert.ok(p.sends[0].text.length <= D.LINE_MAX);
  const f = D.failTodo(['公司大群組'], date, 1);
  assert.ok(f.fail.urgent && /1 個群組/.test(f.fail.text));
  assert.deepStrictEqual(D.failTodo([], date, 1), {});
});
