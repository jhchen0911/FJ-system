// LINE 機器人核心單元測試：node --test functions/test/（不需 Firebase、不需網路）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const core = require('../line/core.js');

function mkDeps(cfg) {
  const db = {}, files = {}, pushes = [], replies = [], drafts = {};
  const get = p => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), db);
  const set = (p, v) => { const ks = p.split('/'); let o = db; ks.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  return {
    db, files, pushes, replies, drafts,
    getCfg: async () => cfg,
    fetchContent: async id => ({ buf: Buffer.from('X' + id), contentType: 'image/jpeg' }),
    putFile: async (path, buf) => { files[path] = buf; },
    dbSet: async (p, v) => set(p, v),
    dbGet: async p => get(p),
    reply: async (t, text) => replies.push({ t, text }),
    push: async (to, text) => pushes.push({ to, text }),
    createDraft: async rec => { drafts[rec.id] = rec; },
    findAddonDrafts: async (gid, since) => Object.values(drafts).filter(d => d.type === 'addon' && d.payload.groupId === gid && d.at >= since),
    appendDraftPhotos: async (id, paths) => { drafts[id].payload.photos = drafts[id].payload.photos.concat(paths); },
    log: () => {},
  };
}
const CFG = { owners: { Uowner: { name: 'Lotion' } }, groups: { Gsite: { qid: 'q1', name: '內湖興中路' }, Goff: { qid: 'q2', name: '關閉案', daily: false } } };
const T0 = Date.parse('2026-10-22T02:00:00Z');   // 台北 10:00

test('簽章驗證：正確才通過、竄改失敗', () => {
  const body = '{"events":[]}', sec = 'test-secret';
  const sig = crypto.createHmac('sha256', sec).update(body).digest('base64');
  assert.ok(core.verifySignature(sec, body, sig));
  assert.ok(!core.verifySignature(sec, body + ' ', sig));
  assert.ok(!core.verifySignature(sec, body, ''));
  assert.ok(!core.verifySignature('', body, sig));
});

test('① 擁有者一對一傳照片 → 存 line/inbox、記紀錄、回覆「收到」', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, replyToken: 'r1', source: { type: 'user', userId: 'Uowner' }, message: { id: 'm1', type: 'image' } }], d);
  const p = Object.keys(d.files)[0];
  assert.match(p, /^line\/inbox\/2026-10-22\/m1_m1\.jpg$/);
  assert.equal(d.db.fydata.lineInbox.m1.path, p);
  assert.match(d.replies[0].text, /收到，1 個檔案/);
});

test('① 陌生人一對一：不存檔、只記到待綁定名單', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: { type: 'user', userId: 'Ux' }, message: { id: 'm2', type: 'image' } }], d);
  assert.equal(Object.keys(d.files).length, 0);
  assert.ok(d.db.fydata.lineCfg.pending.users.Ux);
  assert.equal(d.replies.length, 0);
});

test('② 群組「追加」→ 草稿（含前 10 分鐘照片），之後 10 分鐘內的照片也附上；不直接寫正式資料', async () => {
  const d = mkDeps(CFG);
  const g = { type: 'group', groupId: 'Gsite', userId: 'Uw' };
  await core.handleEvents([{ type: 'message', timestamp: T0 - 5 * 60000, source: g, message: { id: 'p1', type: 'image' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: g, message: { id: 't1', type: 'text', text: '#追加 鋼板樁 12 支' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0 + 3 * 60000, source: g, message: { id: 'p2', type: 'image' } }], d);
  const dr = d.drafts.dlt1;
  assert.ok(dr && dr.type === 'addon' && dr.status === 'pending' && dr.payload.qid === 'q1');
  assert.equal(dr.payload.qty, 12); assert.equal(dr.payload.unit, '支');
  assert.equal(dr.payload.photos.length, 2);
  assert.ok(!d.db.fydata.shared, '不得寫入正式資料');
});

test('② 未綁定群組：只記待綁定，不存訊息', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: { type: 'group', groupId: 'Gnew' }, message: { id: 'x1', type: 'text', text: '追加' } }], d);
  assert.ok(d.db.fydata.lineCfg.pending.groups.Gnew);
  assert.equal(Object.keys(d.drafts).length, 0);
});

test('③ 事故前兆字 → 立刻通知擁有者（不分析）', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: { type: 'group', groupId: 'Gsite' }, message: { id: 'a1', type: 'text', text: '北側擋土壁有裂縫' } }], d);
  assert.equal(d.pushes.length, 1);
  assert.equal(d.pushes[0].to, 'Uowner');
  assert.match(d.pushes[0].text, /內湖興中路工地群組出現「裂」，請判斷是否停工/);
});

test('③ 17:30 問三句只發給開啟日報的已綁定群組；20:00 整理成日報草稿', async () => {
  const d = mkDeps(CFG);
  const ask = Date.parse('2026-10-22T09:30:00Z');   // 台北 17:30
  assert.equal(await core.dailyAsk(d, ask), 1);
  assert.equal(d.pushes[0].to, 'Gsite'); assert.match(d.pushes[0].text, /今天做了哪些/);
  const g = { type: 'group', groupId: 'Gsite', userId: 'Uw' };
  await core.handleEvents([{ type: 'message', timestamp: ask - 3600000, source: g, message: { id: 'ph', type: 'image' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: ask + 600000, source: g, message: { id: 'ans', type: 'text', text: '1. 打設 H 型鋼 8 支 2. 4 人、吊車 1 台 3. 無' } }], d);
  assert.equal(await core.dailyCompile(d, Date.parse('2026-10-22T12:00:00Z')), 1);
  const dr = Object.values(d.drafts).find(x => x.type === 'dailyLog');
  assert.ok(dr && dr.status === 'pending' && dr.payload.replied && dr.payload.photos.length === 1 && /打設 H 型鋼/.test(dr.payload.answers[0]));
});

test('③ 隔天 08:00 沒回 → 群組提醒一次；連兩天沒回 → 通知擁有者', async () => {
  const d = mkDeps(CFG);
  core.dailyAsk; // eslint
  d.db.fydata = { lineDaily: { Gsite: { '2026-10-21': { askedAt: 1, replied: false }, '2026-10-20': { askedAt: 1, replied: false } } } };
  const r = await core.morningCheck(d, Date.parse('2026-10-22T00:00:00Z'));   // 台北 08:00
  assert.deepEqual(r, { reminded: 1, escalated: 1 });
  assert.ok(d.pushes.some(p => p.to === 'Gsite' && /還沒回/.test(p.text)));
  assert.ok(d.pushes.some(p => p.to === 'Uowner' && /連兩天沒有回/.test(p.text)));
  const r2 = await core.morningCheck(d, Date.parse('2026-10-22T00:00:00Z'));
  assert.deepEqual(r2, { reminded: 0, escalated: 0 }, '同一天不重複提醒');
});

test('推播佇列：pending → 推給擁有者並改 sent；已送出的不再送', async () => {
  const d = mkDeps(CFG);
  assert.ok(await core.processPush('n1', { text: '早報：今天唯一的一件事…', status: 'pending' }, d));
  assert.equal(d.pushes.length, 1); assert.equal(d.db.fydata.linePush.n1.status, 'sent');
  assert.ok(!(await core.processPush('n1', { text: 'x', status: 'sent' }, d)));
});

test('固定句子可由 lineCfg.texts 覆寫', async () => {
  const d = mkDeps(Object.assign({}, CFG, { texts: { daily3: 'Lotion 定稿的三句' } }));
  await core.dailyAsk(d, T0);
  assert.equal(d.pushes[0].text, 'Lotion 定稿的三句');
});

// ── 批次 F 審查修正 ──
test('否定詞不觸發：「沒有裂縫」「無變形」「不用追加」不警報、不建草稿；「北側有裂縫，沒有變形」仍警報', () => {
  assert.equal(core.alarmWord('沒有裂縫'), '');
  assert.equal(core.alarmWord('3. 無變形、無沉陷'), '');
  assert.equal(core.alarmWord('北側有裂縫，沒有變形'), '裂');
  assert.ok(!core.isAddon('3. 沒有追加'));
  assert.ok(!core.isAddon('今天不用加做'));
  assert.ok(core.isAddon('業主要追加 3 支'));
  assert.ok(core.isAddon('#追加 沒有照片'));
});

test('一個群組推播失敗，其他群組照問；推不到的不記 askedAt；重跑不重問', async () => {
  const d = mkDeps({ owners: {}, groups: { Gbad: { qid: 'q1', name: 'A' }, Gok: { qid: 'q2', name: 'B' } } });
  d.push = async (to, text) => { if (to === 'Gbad') throw new Error('LINE API 403'); d.pushes.push({ to, text }); };
  const ask = Date.parse('2026-10-22T09:30:00Z');
  assert.equal(await core.dailyAsk(d, ask), 1);
  assert.deepEqual(d.pushes.map(p => p.to), ['Gok']);
  assert.ok(!(d.db.fydata.lineDaily.Gbad));
  assert.equal(await core.dailyAsk(d, ask + 60000), 0, '同一天重跑不重問');
});

test('webhook 重送同一則訊息：不重複警報', async () => {
  const d = mkDeps(CFG);
  const ev = { type: 'message', timestamp: T0, source: { type: 'group', groupId: 'Gsite' }, message: { id: 'r1', type: 'text', text: '擋土壁傾斜' } };
  await core.handleEvents([ev], d); await core.handleEvents([ev], d);
  assert.equal(d.pushes.length, 1);
});

test('17:30 沒問（排程沒跑）→ 20:00 整理不算已回', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: { type: 'group', groupId: 'Gsite' }, message: { id: 't9', type: 'text', text: '早安' } }], d);
  await core.dailyCompile(d, Date.parse('2026-10-22T12:00:00Z'));
  const dr = Object.values(d.drafts).find(x => x.type === 'dailyLog');
  assert.ok(dr && dr.payload.replied === false && dr.payload.answers.length === 0);
});

test('推播佇列：擁有者推不到 → status failed（FJ 看得出來）；陌生人待綁定名單有上限', async () => {
  const d = mkDeps(CFG); d.push = async () => { throw new Error('401'); };
  assert.ok(!(await core.processPush('n2', { text: 'x', status: 'pending' }, d)));
  assert.equal(d.db.fydata.linePush.n2.status, 'failed');
  const users = {}; for (let i = 0; i < 50; i++) users['U' + i] = { at: 1 };
  const d2 = mkDeps({ owners: {}, groups: {}, pending: { users } });
  await core.handleEvents([{ type: 'message', timestamp: T0, source: { type: 'user', userId: 'Unew' }, message: { id: 'z1', type: 'text', text: 'hi' } }], d2);
  assert.ok(!(d2.db.fydata && d2.db.fydata.lineCfg));
});

// ── v6.0.119 批次 I：公司大群組固定格式回報 ──
const CO = { owners: { Uowner: { name: 'Lotion' } }, groups: { Gco: { mode: 'company', name: '豐有工務群' } },
  sites: { qA: { name: '（甲營造）內湖興中路擋土工程' }, qB: { name: '（乙建設）板橋文化路基樁工程' }, qC: { name: '（丙營造）內湖成功路工程' } } };

test('公司群：解析多段【工地】格式', () => {
  const b = core.parseCoReport('【工地】興中路\n【今天】打樁 12 支\n【明天】續打\n【問題】無\n\n【工地】文化路\n【今天】進料\n【明天】\n【問題】等圖');
  assert.equal(b.length, 2);
  assert.equal(b[0].site, '興中路'); assert.equal(b[0].today, '打樁 12 支'); assert.equal(b[1].issue, '等圖');
  assert.deepEqual(core.parseCoReport('今天打樁'), []);
});

test('公司群：地名唯一對到才歸案；對到兩案或沒對到＝待分類', () => {
  assert.equal(core.matchSite(CO.sites, '興中路'), 'qA');
  assert.equal(core.matchSite(CO.sites, '板橋 文化路'), 'qB');    // 空白去掉後被專案名包含
  assert.equal(core.matchSite(CO.sites, '內湖'), '');              // 兩案都有內湖 → 不猜
  assert.equal(core.matchSite(CO.sites, '台中'), '');
  assert.equal(core.matchSite(Object.assign({}, CO.sites, { qC: { name: CO.sites.qC.name, keys: ['內湖'] } }), '內湖'), 'qC');   // 手動對過的地名優先
});

test('公司群：回報存 lineCo、20:00 每工地一份日報草稿、對不到的待分類、追加與警報照常', async () => {
  const d = mkDeps(CO);
  const g = { type: 'group', groupId: 'Gco', userId: 'Uw1' };
  await core.handleEvents([{ type: 'message', timestamp: T0 - 60000, source: g, message: { id: 'img1', type: 'image' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: g, message: { id: 'c1', type: 'text', text: '【工地】興中路\n【今天】打樁 12 支\n【明天】續打\n【問題】擋土壁有裂縫' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0 + 1000, source: { type: 'group', groupId: 'Gco', userId: 'Uw2' }, message: { id: 'c2', type: 'text', text: '【工地】內湖\n【今天】追加鋼板樁 5 支\n【明天】\n【問題】' } }], d);
  const co = d.db.fydata.lineCo.Gco['2026-10-22'];
  assert.equal(co.c1_0.qid, 'qA');
  assert.ok(Object.values(co.c1_0.photos).some(p => /img1/.test(p)), '前 10 分鐘同一人的照片掛上');
  assert.equal(co.c2_0.qid, '');
  assert.ok(d.pushes.some(p => /興中路/.test(p.text) && /裂/.test(p.text)), '警報用地名通知擁有者');
  const addon = d.drafts.dlc2_0; assert.ok(addon && addon.payload.unmatched && addon.payload.qty === 5);
  const n = await core.dailyCompile(d, T0 + 10 * 3600000);
  assert.equal(n, 2);
  const ds = Object.values(d.drafts).filter(x => x.type === 'dailyLog');
  assert.ok(ds.some(x => x.payload.qid === 'qA' && /打樁 12 支/.test(x.payload.answers.join('\n')) && x.payload.photos.length === 1));
  assert.ok(ds.some(x => x.payload.qid === '' && x.payload.unmatched && /待分類/.test(x.summary)));
});

test('公司群：17:30 發固定格式；隔天 08:00 不提醒公司群', async () => {
  const d = mkDeps(CO);
  assert.equal(await core.dailyAsk(d, T0 + 7.5 * 3600000), 1);
  assert.match(d.pushes[0].text, /【工地】/);
  const r = await core.morningCheck(d, T0 + 24 * 3600000);
  assert.equal(r.reminded, 0);
});
