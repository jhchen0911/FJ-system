// LINE 收件匣：標已歸檔的權限與欄位（node --test functions/test/inbox.test.js）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ib = require('../ops/inbox.js');

test('收件匣：擁有者、管理員、AI 帳號能改；一般員工、唯讀名冊外、沒登入不行', () => {
  assert.ok(ib.markAllowed('jhchen0911@gmail.com', null));
  assert.ok(ib.markAllowed('boss@x.com', 'admin'));
  assert.ok(ib.markAllowed('HsuanChen911@gmail.com', 'reader'));
  assert.ok(!ib.markAllowed('staff@x.com', 'staff'));
  assert.ok(!ib.markAllowed('other@x.com', 'reader'));
  assert.ok(!ib.markAllowed('', 'admin'));
});
test('收件匣：只收編號、狀態、報價編號、案名、備註；格式不對擋下', () => {
  assert.deepEqual(ib.cleanMark({ id: 'm123', status: 'filed', qid: 'q_17', caseName: ' 範例案\n二期 ', note: 'x', path: 'evil' }), { id: 'm123', status: 'filed', qid: 'q_17', caseName: '範例案 二期', note: 'x' });
  assert.ok(ib.cleanMark({ id: '../x' }).err);
  assert.ok(ib.cleanMark({ id: 'm1', status: 'deleted' }).err);
  assert.ok(ib.cleanMark({ id: 'm1', qid: 'a/b' }).err);
  assert.equal(ib.cleanMark({ id: 'm1' }).status, 'filed');
});
test('收件匣：標已歸檔記時間與誰；改回未歸檔清掉歸檔時間；存檔失敗的不能改回未歸檔', () => {
  const u = ib.markUpdate({ status: 'new' }, ib.cleanMark({ id: 'm1', status: 'filed', qid: 'q1' }), 'A@B.com', 100);
  assert.deepEqual(u, { sug: null, status: 'filed', qid: 'q1', caseName: null, note: null, markedBy: 'a@b.com', markedAt: 100, filedAt: 100 });
  assert.equal(ib.markUpdate({ status: 'filed' }, ib.cleanMark({ id: 'm1', status: 'new' }), 'a', 5).filedAt, null);
  assert.equal(ib.markUpdate({ status: 'error' }, ib.cleanMark({ id: 'm1', status: 'new' }), 'a', 5).status, 'error');
  assert.ok(!('path' in u) && !('from' in u));
});

test('v6.0.191 AI 建議歸檔：要有報價或案名；已歸檔的不收；退回建議只清建議、不動狀態與備註；清單不含下載網址', () => {
  assert.ok(ib.cleanSug({ id: 'm1' }).err);
  assert.ok(ib.cleanSug({ id: '../x', qid: 'q1' }).err);
  const c = ib.cleanSug({ id: 'm1', qid: 'q1', why: '已交給報價線\n建草稿', path: 'x' });
  assert.deepEqual(c, { id: 'm1', qid: 'q1', caseName: '', note: '', why: '已交給報價線 建草稿' });
  assert.ok(ib.sugUpdate({ status: 'filed' }, c, 'a', 1).err);
  assert.deepEqual(ib.sugUpdate({ status: 'new' }, c, 'AI@x.com', 9), { sug: { qid: 'q1', caseName: null, note: null, why: '已交給報價線 建草稿', by: 'ai@x.com', at: 9 } });
  assert.deepEqual(ib.markUpdate({ status: 'new', note: '第 1 批', sug: { qid: 'q1' } }, ib.cleanMark({ id: 'm1', status: 'unsug' }), 'a', 5), { sug: null, sugRej: { qid: 'q1', caseName: null, at: 5 }, markedBy: 'a', markedAt: 5 });
  assert.match(ib.sugUpdate({ status: 'new', sugRej: { qid: 'q1', caseName: null } }, c, 'a', 1).err, /退回過/);
  assert.ok(!ib.sugUpdate({ status: 'new', sugRej: { qid: 'q2' } }, c, 'a', 1).err);
  assert.match(ib.sugUpdate({ status: 'error' }, c, 'a', 1).err, /重傳/);
  const L = ib.openList({ a: { id: 'a', at: 100, status: 'new', path: 'line/inbox/x', sug: { qid: 'q1' } }, b: { id: 'b', at: 100, status: 'filed' }, c: { id: 'c', at: 1, status: 'new' } }, 100, 50);
  assert.deepEqual(L.map((x) => x.id), ['a']); assert.ok(!('path' in L[0]) && L[0].sug.qid === 'q1');
});
