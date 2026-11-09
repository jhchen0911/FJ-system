// v6.0.190 AI 草稿上傳（functions/ops/drafts.js）——全部假資料
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
  const rm = D.build(Object.assign({}, base, { body: { type: 'quote', payload: { fields: Object.assign({}, f, { rmk: { load: '20', 'bad.key': 1, hack: { x: 1 }, extra: ['條款一', { o: 1 }, ''] } }) }, expect: { sub: 900, tax: 45, total: 945 } } }));
  assert.deepStrictEqual(rm.rec.payload.fields.rmk, { load: '20', extra: ['條款一'] });   // 審查：備註只收白名單欄位
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

test('v6.0.197 改單可改成本單價與固定條款（範本照報價新舊選）', () => {
  const OLD = String(Date.UTC(2026, 0, 1)); const qs = { k1: { id: OLD, code: 'Z1', name: '假丁案', ver: 1, items: [{ desc: '假工項A', qty: 2, price: 100, estCost: 60 }] } };
  const rp = { rmkBase: '6. 本工程無保固及保留款', rmkBaseOld: '6. 舊條款', rmk14At: Date.UTC(2026, 5, 1) };
  const body = { type: 'qchg', payload: { qid: OLD, ops: [{ op: 'set', idx: 0, match: '假工項A', fields: { estCost: 80 } }, { op: 'rmkFix', match: '舊條款', text: '新條款' }] }, expect: { sub: 200, tax: 10, total: 210 } };
  const r = D.build(Object.assign({}, base, { quotes: qs, rmkParams: rp, body }));
  assert.ok(r.rec, r.err);   // 舊報價（id 時間在切換前）用舊範本
  assert.strictEqual(D.rmkBaseFor({ id: String(Date.UTC(2027, 0, 1)) }, rp), '6. 本工程無保固及保留款');
});

test('v6.0.213 底價／目標成交價：選填、含稅、底價不能高於目標價；改單與報價單都收', () => {
  assert.deepStrictEqual(D.aimClean(null), { aim: null });
  assert.deepStrictEqual(D.aimClean({ floor: '1000000', target: 1100000.4 }), { aim: { floor: 1000000, target: 1100000 } });
  assert.deepStrictEqual(D.aimClean({ target: 5 }), { aim: { target: 5 } });
  assert.match(D.aimClean({ floor: 2, target: 1 }).err, /不能高於/);
  assert.match(D.aimClean({ floor: -1 }).err, /floor/);
  assert.match(D.aimClean('x').err, /aim/);
  const ops = [{ op: 'set', idx: 0, match: '假工項A', fields: { qty: 12 } }];
  const r = D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'q1', ops, aim: { floor: 12000, target: 13000 } }, expect: { sub: 13000, tax: 650, total: 13650 } } }));
  assert.deepStrictEqual(r.rec.payload.aim, { floor: 12000, target: 13000 });
  assert.match(D.build(Object.assign({}, base, { body: { type: 'qchg', payload: { qid: 'q1', ops, aim: { floor: 9, target: 1 } }, expect: { sub: 13000, tax: 650, total: 13650 } } })).err, /不能高於/);
  const f = { name: '假丙案', items: [{ desc: '工項', unit: '支', qty: 2, price: 500 }] };
  const r2 = D.build(Object.assign({}, base, { body: { type: 'quote', payload: { fields: f, aim: { target: 1000 } }, expect: { sub: 1000, tax: 50, total: 1050 } } }));
  assert.deepStrictEqual(r2.rec.payload.aim, { target: 1000 });
  assert.ok(!('aim' in D.build(Object.assign({}, base, { body: { type: 'quote', payload: { fields: f }, expect: { sub: 1000, tax: 50, total: 1050 } } })).rec.payload));
});

test('v6.0.213 得標率統計給報價線：只有主報價、有結果、沒被排除的；追加的工項算進主約；只回數字', () => {
  const qs = {
    a: { id: 'a', name: '甲', awarded: true, t: { total: 100 }, items: [{ desc: 'H型鋼樁打設', qty: 1, price: 100 }], bid: { res: 'won', first: 110 } },
    b: { id: 'b', name: '乙', bidStatus: 'lost', t: { total: 120 }, lostPrice: 100, items: [{ desc: 'H型鋼樁打設', qty: 1, price: 120 }], bid: { res: 'lost', first: 120 } },
    c: { id: 'c', name: '丙', bidStatus: 'lost', t: { total: 50 }, items: [{ desc: 'H型鋼樁打設', qty: 1, price: 50 }], bid: { res: 'lost', skip: { at: 1 } } },
    d: { id: 'd', name: '丁', t: { total: 50 }, items: [{ desc: 'H型鋼樁', qty: 1, price: 50 }] },
    e: { id: 'e', parentId: 'a', name: '甲追加', items: [{ desc: '水平支撐', qty: 1, price: 10 }] },
  };
  const r = D.bidStats(qs, { k: { linkedQid: 'a', amount: 99 } }, {});
  assert.strictEqual(r.n, 2); assert.strictEqual(r.minN, 5);
  const h = r.kinds.find((k) => k.kind === 'hpile'), s = r.kinds.find((k) => k.kind === 'strut');
  assert.strictEqual(h.n, 2); assert.strictEqual(h.rate, 50); assert.strictEqual(h.concPct, 10); assert.strictEqual(h.gapPct, 20); assert.strictEqual(h.ready, false);
  assert.strictEqual(s.n, 1);
  assert.ok(!JSON.stringify(r).includes('甲'));
});
