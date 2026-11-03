// 電腦端斷線警報純邏輯單元測試：node --test functions/test/heartbeat.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const hb = require('../ops/heartbeat.js');
const T = (s) => Date.parse(s);   // 用 UTC 寫；台灣時間＝UTC+8

test('斷線警報：只在台灣時間 08:00～22:59 檢查', () => {
  assert.equal(hb.hbInWindow(T('2026-11-03T00:00:00Z')), true);    // 台灣 08:00
  assert.equal(hb.hbInWindow(T('2026-11-02T23:59:00Z')), false);   // 台灣 07:59
  assert.equal(hb.hbInWindow(T('2026-11-03T14:00:00Z')), true);    // 台灣 22:00
  assert.equal(hb.hbInWindow(T('2026-11-03T15:00:00Z')), false);   // 台灣 23:00
});

test('斷線警報：超過 2 小時才發；剛好 2 小時不發；沒報到過不發；時段外不發', () => {
  const now = T('2026-11-03T06:00:00Z');   // 台灣 14:00
  assert.equal(hb.hbDecide({ at: now - 2 * 3600e3 }, now).alert, false);
  assert.deepEqual(hb.hbDecide({ at: now - 2 * 3600e3 - 1 }, now), { alert: true, key: now - 2 * 3600e3 - 1 });
  assert.equal(hb.hbDecide(null, now).why, 'never');
  assert.equal(hb.hbDecide({ at: 'x' }, now).why, 'never');
  assert.equal(hb.hbDecide({ at: 0 }, T('2026-11-03T16:00:00Z')).why, 'window');
});

test('斷線警報：同一次斷線只發一次，恢復報到後重置、下次斷線再發', () => {
  const at = T('2026-11-03T02:00:00Z'), now = at + 3 * 3600e3;
  const s = { at, alertFor: at };
  assert.equal(hb.hbDecide(s, now).why, 'sent');
  assert.equal(hb.hbDecide(s, now + 3600e3).why, 'sent');
  const back = { at: now + 10 * 60e3, alertFor: at };   // 恢復報到
  assert.equal(hb.hbDecide(back, back.at + 30 * 60e3).why, 'ok');
  assert.equal(hb.hbDecide(back, back.at + 3 * 3600e3).alert, true);
});

test('斷線警報：1 分鐘內重複報到不寫；文字含最後報到的台灣時間、沒有網址', () => {
  const now = T('2026-11-03T06:00:00Z');
  assert.equal(hb.hbShouldWrite({ at: now - 30e3 }, now), false);
  assert.equal(hb.hbShouldWrite({ at: now - 61e3 }, now), true);
  assert.equal(hb.hbShouldWrite(null, now), true);
  assert.equal(hb.hbText(T('2026-11-03T04:05:00Z')), '⚠️ 電腦端超過 2 小時沒報到，請看電腦（最後報到 11/3 12:05）');
  assert.ok(!require('../ops/notify.js').buildNotify({ text: hb.hbText(now) }).err);
});

test('斷線警報（審查）：夜間關機不算斷線——06:00 前的報到當成 06:00 起算；08:00 不叫、09:00 起 07:00 後都沒報到才叫', () => {
  const night = T('2026-11-02T14:00:00Z');   // 前一晚台灣 22:00 最後報到
  assert.equal(hb.hbDecide({ at: night }, T('2026-11-03T00:00:00Z')).alert, false);   // 台灣 08:00
  assert.equal(hb.hbDecide({ at: night }, T('2026-11-03T01:00:00Z')).alert, true);    // 台灣 09:00
  assert.equal(hb.hbDecide({ at: T('2026-11-02T23:30:00Z') }, T('2026-11-03T01:00:00Z')).alert, false);   // 07:30 有報到
  assert.equal(hb.tpeDayStart(T('2026-11-03T05:00:00Z')), T('2026-11-02T22:00:00Z'));
});
