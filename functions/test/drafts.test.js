// v6.0.186 AI 草稿上傳（functions/ops/drafts.js）——全部假資料
const test = require('node:test');
const assert = require('node:assert');
const D = require('../ops/drafts.js');

const quotes = {
  k1: { id: 'q1', code: '1151101', name: '假甲案', ver: 3, _mt: 9, items: [{ desc: '假工項A', unit: '支', qty: 10, price: 1000 }, { desc: '假工項B', unit: 'M', qty: 5, price: 200 }] },
  k2: { id: 'q2', code: '1151102', name: '假乙案', awarded: true, items: [] },
  k3: { id: 'q3', code: 'DUP', name: '重號一', items: [] }, k4: { id: 'q4', code: 'DUP', name: '重號二', items: [] },
};
const base = { email: 'AI@x.com', name: '陳軒（AI）', quotes, taxR: 5, now: 1000, id: 'dnew0001' };

test('改單：跟網頁同一套對位與試算；試算對上才收，草稿欄位跟網頁送的一樣', () => {
  const body = { type: 'qchg', payload: { qid: 'q1', ops: [{ op: 'set', idx: 0, match: '假工項A', fields: { qty: 12 } }] }, expect: { sub: 13000, tax: 650, total: 13650 } };
  const r = D.build(Object.assign({}, base, { body }));
  assert.ok(r.rec, r.err);
  assert.deepStrictEqual(Object.keys(r.rec).sort(), ['at', 'by', 'byName', 'id', 'payload', 'status', 'summary', 'type']);
  assert.strictEqual(r.rec.by, 'ai@x.com'); assert.strictEqual(r.rec.status, 'pending');
  assert.deepStrictEqual(r.rec.payload, { qid: 'q1', code: '1151101', baseVer: 3, baseMt: 9, ops: [{ op: 'set', idx: 0, match: '假工項A', fields: { qty: 12 } }] });
  assert.match(r.rec.summary, /未稅 11,000 → 13,000/);
});

test('改單：試算對不上、沒附 expect、動作對不上、找不到報價、編號重複都不收', () => {
  const ops = [{ op: 'set', idx: 0, match: '假工項A', fields: { qty: 12 } }];
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'q1', ops }, expect: { sub: 13000, tax: 600, total: 13600 } } })).err, /試算對不上.*稅額/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'q1', ops } } })).err, /要附 expect/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'q1', ops: [{ op: 'del', match: '沒有這列' }] }, expect: {} } })).err, /對不上/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'qX', ops }, expect: {} } })).err, /找不到/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { code: 'DUP', ops }, expect: {} } })).err, /有 2 張/);
});

test('報價單：工項清乾淨、小計含稅一致才收；得標狀態：已得標不收、to 白名單', () => {
  const f = { name: '假丙案', client: '假業主', items: [{ desc: '工項', unit: '支', qty: 2, price: 500, estCost: 300, hack: 'x' }, { desc: '減項', qty: 1, price: -100 }] };
  const r = D.build(Object.assign({}, base, { body: { type: 'quote', payload: { fields: f }, expect: { sub: 900, tax: 45, total: 945 } } }));
  assert.ok(r.rec, r.err);
  assert.ok(!('estCost' in r.rec.payload.fields.items[0]) && !('hack' in r.rec.payload.fields.items[0]));
  assert.deepStrictEqual(r.rec.payload.fields.t, { sub: 900, tax: 45, total: 945 });
  assert.match(D.build(Object.assign({}, base, { body: { type: 'quote', payload: { fields: { name: 'x', items: [{ desc: 'a', qty: -1, price: 1 }] } }, expect: { sub: -1, tax: 0, total: -1 } } })).err, /數量或單價/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'bid', payload: { qid: 'q2', to: 'lost' } } })).err, /已得標/);
  assert.match(D.build(Object.assign({}, base, { body: { type: 'bid', payload: { qid: 'q1', to: 'hack' } } })).err, /to 只能/);
  const b = D.build(Object.assign({}, base, { body: { type: 'bid', payload: { qid: 'q1', to: 'lost', lostReason: '亂寫' } } }));
  assert.strictEqual(b.rec.payload.lostReason, '其他');
  assert.match(D.build(Object.assign({}, base, { body: { type: 'irPhoto', payload: {} } })).err, /只收/);
});

test('取代、撤回、列出：只動自己的同一件 pending', () => {
  const rec = D.build(Object.assign({}, base, { body: { type: 'bid', payload: { qid: 'q1', to: 'nego' } } })).rec;
  const all = {
    dold1: { id: 'dold1', type: 'bid', by: 'ai@x.com', at: 500, status: 'pending', payload: { qid: 'q1' } },
    dold2: { id: 'dold2', type: 'qchg', by: 'ai@x.com', at: 500, status: 'pending', payload: { qid: 'q1' } },
    dold3: { id: 'dold3', type: 'bid', by: 'b@x.com', at: 500, status: 'pending', payload: { qid: 'q1' } },
    dold4: { id: 'dold4', type: 'bid', by: 'ai@x.com', at: 2000, status: 'pending', payload: { qid: 'q1' } },
    dnew0001: rec,
  };
  assert.deepStrictEqual(D.superseded(rec, all), ['dold1']);
  assert.strictEqual(D.withdrawErr(all.dold1, 'AI@x.com'), '');
  assert.match(D.withdrawErr(all.dold3, 'ai@x.com'), /自己送/);
  assert.match(D.withdrawErr(Object.assign({}, all.dold1, { status: 'applied' }), 'ai@x.com'), /不能撤回/);
  assert.match(D.withdrawErr(null, 'ai@x.com'), /找不到/);
  assert.deepStrictEqual(D.mine(all, 'ai@x.com').map((x) => x.id), ['dold1', 'dold2', 'dnew0001', 'dold4']);
});
