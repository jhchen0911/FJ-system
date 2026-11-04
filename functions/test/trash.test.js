// 改版第 5 步 5a：回收筒到期清除
const test = require('node:test');
const assert = require('node:assert');
const T = require('../ops/trash.js');
const D = 86400000, now = Date.UTC(2026, 10, 4);
test('預設 30 天；超過才清', () => {
  const r = T.purge([{ id: 'a', at: now - 31 * D }, { id: 'b', at: now - 29 * D }], undefined, now);
  assert.deepStrictEqual(r.keep.map((x) => x.id), ['b']); assert.strictEqual(r.removed, 1);
});
test('測試專案設 1 天：昨天刪的今天清、今天刪的留著；物件形態也能處理', () => {
  const r = T.purge({ 0: { id: 'a', at: now - 2 * D }, 1: { id: 'b', at: now - 3600000 } }, 1, now);
  assert.deepStrictEqual(r.keep.map((x) => x.id), ['b']);
});
test('天數不合理時用 30', () => { assert.strictEqual(T.trashDays('abc'), 30); assert.strictEqual(T.trashDays(0), 30); assert.strictEqual(T.trashDays(999), 30); assert.strictEqual(T.trashDays('7'), 7); });
