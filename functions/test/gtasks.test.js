// 改版第 5 步 5d #21 待辦同步 Google 工作表（functions/ops/gtasks.js）——不連網，用假的 fetch
const test = require('node:test');
const assert = require('node:assert');
const G = require('../ops/gtasks.js');

const todo = {
  health: { pay_dup: { text: '系統健檢：疑似重複應付 2 筆', sub: '經營報表', urgent: false }, paid_pending: { text: '已付卻待付 1 筆', urgent: true } },
  daily: { unconf: { text: '整體日報：1 個工地沒確認' } },
  gtasks: { fail: { text: '同步失敗' } },   // 同步本身的錯誤不再同步回去
  bad: { x: { noText: 1 } },
};

test('攤平：排除 gtasks 來源與沒文字的、緊急的先；可只選部分來源', () => {
  const L = G.flatten(todo);
  assert.deepStrictEqual(L.map((x) => x.gid), ['health~paid_pending', 'daily~unconf', 'health~pay_dup']);
  assert.deepStrictEqual(G.flatten(todo, { srcs: { daily: true } }).map((x) => x.gid), ['daily~unconf']);
});

test('計畫：新的建、消失的打勾（不刪）、再出現取消打勾、文字變了改標題、超過每天上限延到隔天', () => {
  const L = G.flatten(todo);
  const map = { 'health~pay_dup': { task: 't1', title: '舊文字' }, 'daily~unconf': { task: 't2', title: '整體日報：1 個工地沒確認', done: true }, 'health~gone': { task: 't3', title: 'x' } };
  const p = G.plan(L, map, 49, 50);
  assert.deepStrictEqual(p.create.map((x) => x.gid), ['health~paid_pending']);
  assert.deepStrictEqual(p.reopen.map((x) => x.task), ['t2']);
  assert.deepStrictEqual(p.retitle.map((x) => x.task), ['t1']);
  assert.deepStrictEqual(p.complete.map((x) => x.task), ['t3']);
  const p2 = G.plan(L, {}, 50, 50);
  assert.strictEqual(p2.create.length, 0); assert.strictEqual(p2.deferred.length, 3);
});

test('授權網址要離線權限＋只要 Tasks 範圍；state 要相符且 10 分鐘內', () => {
  const u = new URL(G.authUrl('cid', 'https://x/cb', 'S'.repeat(32)));
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('scope'), G.SCOPE);
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://x/cb');
  const s = { s: 'a'.repeat(32), at: 1000 };
  assert.ok(G.stateOk(s, 'a'.repeat(32), 1000 + 60000));
  assert.ok(!G.stateOk(s, 'b'.repeat(32), 1000));
  assert.ok(!G.stateOk(s, 'a'.repeat(32), 1000 + G.STATE_TTL_MS + 1));
  assert.ok(!G.stateOk({ s: 'short', at: 1000 }, 'short', 1000));
});

// 假的 Google：記錄呼叫
function fakeGoogle(opt) {
  opt = opt || {};
  const calls = []; let n = 0;
  const res = (status, j) => ({ ok: status < 300, status, json: async () => j });
  const f = async (url, init) => {
    const m = (init && init.method) || 'GET'; calls.push(m + ' ' + url.replace('https://tasks.googleapis.com/tasks/v1', ''));
    if (url.indexOf('oauth2.googleapis.com/token') >= 0) return opt.badToken ? res(400, { error: 'invalid_grant' }) : res(200, { access_token: 'AT' });
    if (m === 'GET' && /\/users\/@me\/lists\?/.test(url)) return res(200, { items: opt.hasList ? [{ id: 'L1', title: '豐有' }] : [] });
    if (m === 'GET' && /\/users\/@me\/lists\//.test(url)) return opt.listGone ? res(404, {}) : res(200, { id: 'L1' });
    if (m === 'POST' && /\/users\/@me\/lists$/.test(url)) return res(200, { id: 'Lnew' });
    if (m === 'POST' && /\/tasks$/.test(url)) return res(200, { id: 'T' + (++n) });
    if (m === 'PATCH') return /t3/.test(url) && opt.t3gone ? res(404, {}) : res(200, { id: 'x' });
    return res(500, {});
  };
  return { f, calls };
}

test('執行：沒有「豐有」清單就建；建立／打勾後對應表正確；Google 端被刪的對應拿掉', async () => {
  const g = fakeGoogle({ t3gone: true });
  const api = G.client({ fetch: g.f, clientId: 'c', clientSecret: 's', refresh: 'r' });
  const r = await G.run({ api, todo, map: { 'health~gone': { task: 't3', title: 'x' } }, madeToday: 0, now: 100 });
  assert.strictEqual(r.listId, 'Lnew');
  assert.strictEqual(r.made, 3);
  assert.ok(!r.map['health~gone']);
  assert.deepStrictEqual(Object.keys(r.map).sort(), ['daily~unconf', 'health~paid_pending', 'health~pay_dup']);
  assert.strictEqual(r.errs.length, 0);
  assert.strictEqual(g.calls.filter((c) => /^POST .*\/tasks$/.test(c)).length, 3);
  // 第二次：全部已建，沒有新動作；卡片消失 → 打勾
  const g2 = fakeGoogle({ hasList: true });
  const api2 = G.client({ fetch: g2.f, clientId: 'c', clientSecret: 's', refresh: 'r' });
  const r2 = await G.run({ api: api2, todo: { health: { pay_dup: todo.health.pay_dup } }, map: r.map, listId: 'L1', madeToday: 3, now: 200 });
  assert.strictEqual(r2.made, 0); assert.strictEqual(r2.done, 2);
  assert.ok(r2.map['daily~unconf'].done && !r2.map['health~pay_dup'].done);
  // 打勾超過 30 天的對應清掉
  const r3 = await G.run({ api: api2, todo: {}, map: r2.map, listId: 'L1', madeToday: 0, now: 200 + 31 * 86400000 });
  assert.deepStrictEqual(Object.keys(r3.map), ['health~pay_dup']);   // 剛打勾的留著、打勾 31 天的清掉
  assert.ok(r3.map['health~pay_dup'].done);
});

test('授權失效：記錯誤、停止建立，寫同步失敗待辦（不放金鑰）', async () => {
  const g = fakeGoogle({ badToken: true });
  const api = G.client({ fetch: g.f, clientId: 'c', clientSecret: 's', refresh: 'r' });
  await assert.rejects(() => G.run({ api, todo, map: {}, now: 1 }), /授權失效/);
  const t = G.failTodo(['x：Google 授權失效'], 1);
  assert.strictEqual(t.fail.src, 'gtasks');
  assert.strictEqual(G.failTodo([], 1), null);
});
