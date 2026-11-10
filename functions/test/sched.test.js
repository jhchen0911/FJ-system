// 改版第 5 步 5d #25 排程倒推、#26 材料送審擋進場（functions/ops/sched.js；寫好不啟用）——全部假資料
const test = require('node:test');
const assert = require('node:assert');
const S = require('../ops/sched.js');

const today = '2026-11-04';
const projects = [
  { id: 'p_a', no: '2026-001', sched: [
    { id: 's1', name: '道路挖掘許可', kind: 'permit', start: '2026-11-20' },             // 16 天後、預設提前 30 → 提醒
    { id: 's2', name: 'H 型鋼', kind: 'material', start: '2026-12-31', item: 'H 型鋼' }, // 57 天後、預設 14 → 不提醒；沒核可 → 擋
    { id: 's3', name: '技師簽證', kind: 'engineer', start: '2026-11-06', lead: 5 },        // 2 天後 → 緊急
    { id: 's4', name: '已辦', kind: 'permit', start: '2026-11-05', doneAt: '2026-11-01' },
    { id: 's5', name: '鋼板樁', kind: 'material', start: '2026-11-08', item: '鋼板樁' },  // 已核可 → 不擋
  ], docs: [{ kind: 'matSubmit', item: '鋼板樁', approvedAt: '2026-10-30' }] },
  { id: 'p_b', no: '2026-002' },
  { id: 'p_c', voidAt: 1 },
];

test('寫好不啟用', () => { assert.strictEqual(S.ENABLED, false); });

test('#25 倒推：到提前天數才提醒、3 天內緊急、完成的不提醒、沒建排程給 Lotion', () => {
  const t = S.backward(projects, today);
  const by = Object.fromEntries(Object.values(t).map((x) => [x.key, x]));
  assert.ok(/該辦證：道路挖掘許可（16 天後開始）/.test(by.p_a_s1.text) && !by.p_a_s1.urgent);
  assert.ok(by.p_a_s3.urgent && /該催技師/.test(by.p_a_s3.text));
  assert.ok(!by.p_a_s2 && !by.p_a_s4);
  assert.ok(/還沒建整案排程/.test(by.p_b_nosched.text));
  assert.ok(!Object.keys(by).some((k) => /^p_c/.test(k)));
});

test('#26 送審沒核可 → 不能排進場；核可的不擋', () => {
  const t = S.matBlock(projects, today);
  const ks = Object.keys(t);
  assert.deepStrictEqual(ks, ['p_a_mat_s2']);
  assert.ok(/不能排進場：H 型鋼/.test(t.p_a_mat_s2.text) && !t.p_a_mat_s2.urgent);
});

test('接線：送審文件第 7 步線形狀（cat 材料送審＋st ok）也算核可；檔名含材料名稱也算', () => {
  const P = [{ id: 'p1', sched: [{ id: 's1', kind: 'material', item: 'H350', start: '2026-12-01' }, { id: 's2', kind: 'material', item: '鋼板樁', start: '2026-12-01' }], docs: { d1: { id: 'd1', name: 'H350 材質證明.pdf', cat: '材料送審', st: 'ok' }, d2: { id: 'd2', name: '鋼板樁送審.pdf', cat: '材料送審', st: 'wait' } } }];
  const out = S.matBlock(P, '2026-11-20');
  assert.deepStrictEqual(Object.keys(out), ['p1_mat_s2']);
});
test('接線：build 預設不出「還沒建整案排程」卡；schedCount 數有填排程的專案', () => {
  const P = [{ id: 'p1' }, { id: 'p2', sched: [{ id: 'x', kind: 'permit', name: '開挖許可', start: '2026-11-25' }] }, { id: 'p3', voidAt: 1 }];
  const a = S.build(P, '2026-11-20'), b = S.build(P, '2026-11-20', { noSched: true });
  assert.ok(!Object.keys(a).some((k) => /nosched/.test(k)) && Object.keys(a).length === 1);
  assert.ok(Object.keys(b).some((k) => /p1_nosched/.test(k)));
  assert.deepStrictEqual(S.schedCount(P), { live: 2, withSched: 1 });
});
