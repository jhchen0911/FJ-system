// 改版第 5 步 5a：雲端每日健檢（functions/ops/health.js）
const test = require('node:test');
const assert = require('node:assert');
const H = require('../ops/health.js');

const shared = {
  quotes: {
    q1: { id: 'q1', name: '甲案', awarded: true },                       // 有專案
    q2: { id: 'q2', name: '乙案', awarded: true, closed: true },          // 已結案、沒專案 → 缺
    q3: { id: 'q3', name: '丙案', awarded: true },                       // 專案被手動刪（墓碑）→ 不算缺
    q4: { id: 'q4', name: '丁追加', awarded: true, parentId: 'q1' },     // 主約有得標 → 正常
    q5: { id: 'q5', name: '戊追加', awarded: true, parentId: 'q9' },     // 主約不存在 → 孤兒
    q6: { id: 'q6', name: '己案' },                                      // 沒得標
  },
  projects: { p_q1: { id: 'p_q1', qid: 'q1', no: '2026-001' }, p_q6: { id: 'p_q6', qid: 'q6', no: '2026-002', voidAt: 1 } },
  tombs: { projects: { p_q3: 123 } },
};
const priv = {
  payables: {
    a: { id: 'pay1_p1', to: '甲工程行', project: '甲案', amount: 1000, costPeriod: '1', status: 'pending' },
    b: { id: 'pay1_p2', to: '甲工程行', project: '甲案', amount: 1000, costPeriod: '1', status: 'pending' },   // 重複
    c: { id: 'pay.x', to: '乙工程行', project: '乙案', amount: 500, status: 'pending' },                      // 帳本已付
    d: { id: 'pay3', to: '丙工程行', project: '丙案', amount: 300, status: 'paid' },
  },
  paidLog: { 'pay~d~x': { paidAt: 20, unpaidAt: 10 }, pay3: { paidAt: 5 } },
};

test('得標案數 vs 專案數：已結案也要有專案、墓碑不算缺、追加主約沒得標要報', () => {
  const h = H.buildHealth({ shared, priv, now: Date.UTC(2026, 10, 4) });
  const by = Object.fromEntries(h.items.map((x) => [x.key, x]));
  assert.deepStrictEqual(by.prj_missing.list, ['乙案']);
  assert.deepStrictEqual(by.prj_orphan_add.list, ['戊追加']);
  assert.strictEqual(h.counts.wonMains, 3);
  assert.strictEqual(h.counts.projects, 1);
});
test('付款帳本已付、應付待付（id 編碼還原）；重複應付', () => {
  const h = H.buildHealth({ shared, priv });
  const by = Object.fromEntries(h.items.map((x) => [x.key, x]));
  assert.strictEqual(by.paid_pending.n, 1);
  assert.match(by.paid_pending.list[0], /乙工程行 NT\$ 500/);
  assert.strictEqual(by.pay_dup.n, 1);
  assert.strictEqual(h.ok, false);
});
test('照片容量超過 300MB 才提醒', () => {
  assert.ok(!H.buildHealth({ photos: { count: 10, bytes: 1000 } }).items.some((x) => x.key === 'photo_big'));
  assert.ok(H.buildHealth({ photos: { count: 10, bytes: H.PHOTO_WARN_BYTES + 1 } }).items.some((x) => x.key === 'photo_big'));
});
test('後端待辦只放筆數、不放金額廠商；沒問題就沒有待辦', () => {
  const t = H.todoFromHealth(H.buildHealth({ shared, priv }));
  assert.ok(t.paid_pending && t.paid_pending.urgent === true && /付款帳本記已付.*1 筆/.test(t.paid_pending.text));
  assert.ok(!JSON.stringify(t).match(/NT\$|工程行/));
  assert.deepStrictEqual(H.todoFromHealth(H.buildHealth({})), {});
});
test('健檢紀錄只留最近 30 天', () => {
  const days = Array.from({ length: 35 }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(H.pruneDays(days, 30).length, 5);
  assert.strictEqual(H.pruneDays(days, 30)[0], '2026-10-01');
});
