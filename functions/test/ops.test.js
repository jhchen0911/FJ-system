// AI 代理與每日備份的純邏輯單元測試：node --test functions/test/ops.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ops = require('../ops/core.js');

test('AI 代理：只放行白名單欄位、模型名稱、max_tokens 上限', () => {
  const r = ops.cleanAiBody({ model: 'claude-sonnet-5', max_tokens: 99999, messages: [{ role: 'user', content: 'x' }], metadata: { a: 1 }, tools: [{}] });
  assert.ok(r.body && r.body.max_tokens === 2000 && !r.body.tools && !r.body.metadata);
  assert.ok(ops.cleanAiBody({ model: 'gpt-4', messages: [{}] }).err);
  assert.ok(ops.cleanAiBody({ model: 'claude-x', messages: [] }).err);
  assert.ok(ops.cleanAiBody(null).err);
});
test('AI 代理：只有員工與管理員可用', () => {
  assert.ok(ops.aiRoleOk('admin') && ops.aiRoleOk('staff'));
  assert.ok(!ops.aiRoleOk('reader') && !ops.aiRoleOk(null) && !ops.aiRoleOk(undefined));
});
test('每日備份：檔名用台北日期、每月 1 日另存月備份', () => {
  assert.deepEqual(ops.backupPaths(Date.parse('2026-10-31T17:00:00Z')), ['fydata/backups/server/daily/2026-11-01.json', 'fydata/backups/server/monthly/2026-11.json']);
  assert.deepEqual(ops.backupPaths(Date.parse('2026-10-22T03:00:00Z')), ['fydata/backups/server/daily/2026-10-22.json']);
});
test('每日備份：保留最新 30 份、只刪日期檔名', () => {
  const names = []; for (let i = 1; i <= 35; i++) names.push('fydata/backups/server/daily/2026-' + (i <= 31 ? '10-' + String(i).padStart(2, '0') : '11-0' + (i - 31)) + '.json');
  names.push('fydata/backups/server/daily/readme.txt');
  const del = ops.pruneList(names, 30);
  assert.equal(del.length, 5); assert.equal(del[0], 'fydata/backups/server/daily/2026-10-01.json');
  assert.ok(!del.some((n) => /readme/.test(n)));
});
test('每日備份內容：不含 backups 本身、附筆數', () => {
  const p = ops.backupPayload({ backups: { x: 1 }, shared: { quotes: { a: {}, b: {} }, customers: [1, 2, 3] }, private: { payables: [1] } }, 1);
  assert.ok(!p.data.backups && p.counts.quotes === 2 && p.counts.customers === 3 && p.counts.payables === 1 && p.kind === 'fy-server-backup');
});
