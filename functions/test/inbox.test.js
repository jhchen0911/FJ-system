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
  assert.deepEqual(u, { status: 'filed', qid: 'q1', caseName: null, note: null, markedBy: 'a@b.com', markedAt: 100, filedAt: 100 });
  assert.equal(ib.markUpdate({ status: 'filed' }, ib.cleanMark({ id: 'm1', status: 'new' }), 'a', 5).filedAt, null);
  assert.equal(ib.markUpdate({ status: 'error' }, ib.cleanMark({ id: 'm1', status: 'new' }), 'a', 5).status, 'error');
  assert.ok(!('path' in u) && !('from' in u));
});
