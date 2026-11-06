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

test('AI 通知（審查）：全形、零寬、其他網域、IP、各種 scheme、短網址、email 都擋；版號與規格不誤擋；只收字串；看不見的字元拿掉', () => {
  ['example。com', 'example．com', 'ｈｔｔｐｓ：／／a', 'ｗｗｗ．ａｂｃ．ｔｗ', 'example.xyz', 'x.top', '1.2.3.4', 'lin.ee/abc', 'line://ti/p/x', 'mailto:a', 'tel:0912', 'a\u200b.com', 'http\u200b://a.b', 'a .com', 'a.b/c', '找 a@b']
    .forEach(t => assert.equal(n.buildNotify({ text: t }).err, '不能放網址', JSON.stringify(t)));
  ['H300 L=10M*5 支，v6.0.123 已上線', '11/01 F25P2 打設 5 支', '✅【報價草稿送出】做完了｜要你做：到 AI 草稿按確認']
    .forEach(t => assert.equal(n.buildNotify({ text: t }).text, t));
  assert.equal(n.buildNotify({ title: ['a'] }).err, '格式不正確');
  assert.equal(n.buildNotify({ text: { a: 1 } }).err, '格式不正確');
  assert.equal(n.buildNotify({ text: 'a\u202eb\u200bc\u2066d' }).text, 'abcd');
});

test('AI 通知上限（v6.0.134，Lotion 11/02）：每天 6 則；LINE 本月已用 ≥180／200 只記在 FJ、不推；查不到額度照常推', () => {
  assert.equal(n.NOTIFY_DAILY, 6);
  assert.equal(n.NOTIFY_MONTH_LIMIT, 200);
  assert.equal(n.NOTIFY_MONTH_STOP, 180);
  assert.equal(n.monthHold(179), false);
  assert.equal(n.monthHold(180), true);
  assert.equal(n.monthHold(200), true);
  assert.equal(n.monthHold(null), false);
  assert.equal(n.monthHold(undefined), false);
  assert.equal(n.monthHold(NaN), false);
});

test('v6.0.182 安全類（level:safety）：🚨 開頭、等級只收 safety／不填、同一句 30 分鐘 1 則、每天 30 則', () => {
  assert.equal(n.NOTIFY_SAFETY_DAILY, 30);
  assert.equal(n.NOTIFY_SAFETY_GAP_MS, 30 * 60000);
  assert.deepEqual(n.buildNotify({ text: '2 個倉沒停損', level: 'safety' }), { text: '🚨2 個倉沒停損', level: 'safety' });
  assert.deepEqual(n.buildNotify({ text: '🚨已經有記號', level: 'SAFETY' }), { text: '🚨已經有記號', level: 'safety' });
  assert.deepEqual(n.buildNotify({ title: '風控警報', todo: '馬上看倉位', level: 'safety' }), { text: '🚨【風控警報】｜要你做：馬上看倉位', level: 'safety' });
  assert.deepEqual(n.buildNotify({ text: '一般', level: 'normal' }), { text: '一般' });
  assert.equal(n.buildNotify({ text: 'x', level: 'urgent' }).err, '等級只能是 safety 或不填');
  assert.equal(n.buildNotify({ text: 'x', level: 1 }).err, '格式不正確');
  assert.equal(n.buildNotify({ text: '看 a.com', level: 'safety' }).err, '不能放網址');
  assert.ok(/超過 100 字/.test(n.buildNotify({ text: '字'.repeat(100), level: 'safety' }).err));   // 加了 🚨 一起算
  assert.equal(n.safetyKey('🚨2 個倉沒停損'), n.safetyKey('🚨2  個倉沒停損​'));
  assert.notEqual(n.safetyKey('🚨2 個倉沒停損'), n.safetyKey('🚨3 個倉沒停損'));
  const t0 = 1_800_000_000_000;
  assert.equal(n.safetyGapOk(null, t0), true);
  assert.equal(n.safetyGapOk(t0 - 29 * 60000, t0), false);
  assert.equal(n.safetyGapOk(t0 - 30 * 60000, t0), true);
  assert.equal(n.safetyGapOk(t0 + 5000, t0), true);   // 時鐘倒退不卡死
});
