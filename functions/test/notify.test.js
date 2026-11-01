'use strict';
const test = require('node:test');
const assert = require('node:assert');
const n = require('../ops/notify.js');

test('AI 通知：只有 Lotion 與 AI 帳號能發（大小寫不拘），其他人、沒登入都不行', () => {
  assert.ok(n.notifyAllowed('jhchen0911@gmail.com'));
  assert.ok(n.notifyAllowed('HsuanChen911@gmail.com'));
  assert.ok(!n.notifyAllowed('staff@example.com'));
  assert.ok(!n.notifyAllowed(''));
  assert.ok(!n.notifyAllowed(undefined));
});

test('AI 通知：固定格式、100 字上限、不能有網址、換行壓成一行', () => {
  assert.deepEqual(n.buildNotify({ title: '報價草稿送出', todo: '到 AI 草稿按確認' }), { text: '✅【報價草稿送出】做完了｜要你做：到 AI 草稿按確認' });
  assert.deepEqual(n.buildNotify({ title: '備份完成' }), { text: '✅【備份完成】做完了' });
  assert.deepEqual(n.buildNotify({ text: '  第一行\n第二行  ' }), { text: '第一行 第二行' });
  assert.ok(n.buildNotify({}).err);
  assert.ok(/超過 100 字/.test(n.buildNotify({ text: '字'.repeat(101) }).err));
  assert.ok(!n.buildNotify({ text: '字'.repeat(100) }).err);
  ['看 https://x.y', '到 www.abc.tw', '網址 bit.ly/abc', 'line.me/R/ti'].forEach(t => assert.equal(n.buildNotify({ text: t }).err, '不能放網址', t));
  assert.ok(!n.buildNotify({ text: 'H300 L=10M*5 支，v6.0.123 已上線' }).err);
});
