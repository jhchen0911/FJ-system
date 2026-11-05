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
  assert.match(d.replies[0].text, /收到，之後的檔案會一起收/);
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
  assert.equal(core.matchSite(CO.sites, '乙建設'), '');            // 開頭（業主）不比對
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

test('公司群（審查）：空白範本與「地名」不算；欄位寫在【工地】前面併到第一段', () => {
  assert.deepEqual(core.parseCoReport('【工地】地名\n【今天】\n【明天】\n【問題】'), []);
  assert.deepEqual(core.parseCoReport('【工地】興中路\n【今天】\n【明天】\n【問題】無'), []);
  const b = core.parseCoReport('【今天】打樁\n【工地】內湖');
  assert.equal(b.length, 1); assert.equal(b[0].today, '打樁');
});

test('公司群（審查）：同一張照片只掛一個工地；連報兩工地的照片不掛；20:00 後的回報隔天 08:00 補成草稿', async () => {
  const d = mkDeps(CO);
  const g = { type: 'group', groupId: 'Gco', userId: 'Uw1' };
  await core.handleEvents([{ type: 'message', timestamp: T0 - 120000, source: g, message: { id: 'i1', type: 'image' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0 - 60000, source: g, message: { id: 'a1', type: 'text', text: '【工地】興中路\n【今天】打樁' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: T0, source: g, message: { id: 'a2', type: 'text', text: '【工地】文化路\n【今天】進料' } }], d);
  const co = d.db.fydata.lineCo.Gco['2026-10-22'];
  assert.equal(Object.keys(co.a1_0.photos).length, 1);
  assert.equal(Object.keys(co.a2_0.photos).length, 0);
  await core.handleEvents([{ type: 'message', timestamp: T0 + 1000, source: g, message: { id: 'i2', type: 'image' } }], d);
  assert.ok(!co.a2_0.photos.i2 && !co.a1_0.photos.i2, '10 分鐘內報了兩個工地 → 照片不掛');
  assert.equal(await core.dailyCompile(d, T0 + 10 * 3600000), 2);
  await core.handleEvents([{ type: 'message', timestamp: T0 + 11 * 3600000, source: g, message: { id: 'a3', type: 'text', text: '【工地】興中路\n【今天】補報：拔樁' } }], d);
  await core.morningCheck(d, T0 + 24 * 3600000);
  const late = Object.values(d.drafts).filter(x => x.type === 'dailyLog' && /L$/.test(x.id));
  assert.equal(late.length, 1); assert.match(late[0].payload.answers.join(''), /補報/);
  assert.equal(Object.values(d.drafts).filter(x => x.type === 'dailyLog').length, 3);
});

test('公司群（審查）：處理中途失敗，LINE 重送時能重做（紀錄最後才寫）', async () => {
  const d = mkDeps(CO); let boom = true;
  const cd = d.createDraft; d.createDraft = async r => { if (boom) throw new Error('x'); return cd(r); };
  const ev = { type: 'message', timestamp: T0, source: { type: 'group', groupId: 'Gco', userId: 'U' }, message: { id: 'r1', type: 'text', text: '【工地】興中路\n【今天】追加 3 支' } };
  await core.handleEvents([ev], d);
  boom = false;
  await core.handleEvents([ev], d);
  assert.ok(d.drafts.dlr1_0, '重送後追加草稿建立');
});

test('公司群（v6.0.120）：回報地名開頭寫（業主）也對得到；同業主兩案用案號分開', () => {
  const S = { p1: { name: '（八九）範例科技F25P1擋土支撐工程' }, p2: { name: '（八九）範例科技F25P2擋土支撐工程' } };
  assert.equal(core.matchSite(S, '(八九) 範例科技 F25P2'), 'p2');
  assert.equal(core.matchSite(S, '（八九）範例科技F25P1'), 'p1');
  assert.equal(core.matchSite(S, '(八九) 範例科技'), '');   // 兩案都符合 → 待分類
});

// ── v6.0.121 補傳日期 ──
test('補傳日期：認得 10/31、10/31 補、10月31日；只認 7 天內；跨年', () => {
  assert.equal(core.parseMD('10/31 補', '2026-11-01'), '2026-10-31');
  assert.equal(core.parseMD('10月31日', '2026-11-01'), '2026-10-31');
  assert.equal(core.parseMD('11/1', '2026-11-01'), '2026-11-01');
  assert.equal(core.parseMD('10/20', '2026-11-01'), '');      // 超過 7 天
  assert.equal(core.parseMD('11/5', '2026-11-01'), '');       // 未來 → 當成去年 → 超過 7 天
  assert.equal(core.parseMD('12/31', '2027-01-02'), '2026-12-31');
  assert.equal(core.parseMD('2/30', '2026-03-02'), '');
  assert.equal(core.parseMD('打樁', '2026-11-01'), '');
});

test('補傳日期：開頭日期套全部段落；【日期】套所在段落；沒寫照收到日', () => {
  const R = '2026-11-01';
  let b = core.parseCoReport('10/31 補\n【工地】興中路\n【今天】打樁\n【工地】文化路\n【今天】進料', R);
  assert.deepEqual(b.map(x => x.date), ['2026-10-31', '2026-10-31']);
  b = core.parseCoReport('【工地】興中路\n【日期】10/30\n【今天】打樁\n【工地】文化路\n【今天】進料', R);
  assert.deepEqual(b.map(x => x.date), ['2026-10-30', '2026-10-30']);
  b = core.parseCoReport('【工地】興中路\n【今天】H300 L=10M*5 支', R);
  assert.equal(b[0].date, '');
});

test('補傳日期：歸到內文日期、草稿標補傳、不跟當天自己的草稿撞號；當天回報照舊', async () => {
  const d = mkDeps(CO);
  const g = { type: 'group', groupId: 'Gco', userId: 'Uw1' };
  const D1 = Date.parse('2026-10-31T04:00:00Z'), D2 = Date.parse('2026-11-01T01:00:00Z');
  await core.handleEvents([{ type: 'message', timestamp: D1, source: g, message: { id: 'x1', type: 'text', text: '【工地】興中路\n【今天】打樁 3 支' } }], d);
  await core.dailyCompile(d, D1 + 8 * 3600000);
  await core.handleEvents([{ type: 'message', timestamp: D2, source: g, message: { id: 'x2', type: 'text', text: '10/31 補\n【工地】興中路\n【今天】拔樁 2 支' } }], d);
  await core.handleEvents([{ type: 'message', timestamp: D2 + 1000, source: g, message: { id: 'x3', type: 'text', text: '【工地】興中路\n【今天】打樁 4 支' } }], d);
  await core.dailyCompile(d, D2 + 11 * 3600000);
  const ds = Object.values(d.drafts).filter(x => x.type === 'dailyLog');
  assert.equal(ds.length, 3);
  const back = ds.find(x => x.payload.backfill);
  assert.ok(back && back.payload.date === '2026-10-31' && back.payload.recvDate === '2026-11-01' && /補傳/.test(back.summary) && /拔樁/.test(back.payload.answers.join('')));
  const today = ds.find(x => x.payload.date === '2026-11-01');
  assert.ok(today && !today.payload.backfill && /打樁 4 支/.test(today.payload.answers.join('')) && !/拔樁/.test(today.payload.answers.join('')));
  assert.equal(new Set(ds.map(x => x.id)).size, 3);
});

test('補傳日期（審查）：規格數字不當日期；西元／民國年寫法；超出範圍的日期草稿註明', async () => {
  const R = '2026-11-01';
  assert.equal(core.parseMD('H300 10/31', R), '');                 // 不是整行日期
  assert.equal(core.parseMD('2026/10/31 補', R), '2026-10-31');
  assert.equal(core.parseMD('115/10/31', R), '2026-10-31');
  assert.equal(core.parseMD('日期：10/30', R), '2026-10-30');
  let b = core.parseCoReport('H300 1/2 吋\n【工地】興中路\n【今天】打樁', R);
  assert.equal(b[0].date, '');
  b = core.parseCoReport('【工地】興中路\n【今天】打樁\n【日期】10/30\n【工地】文化路\n【今天】進料', R);
  assert.deepEqual(b.map(x => x.date), ['', '2026-10-30']);       // 【日期】在第一段有內容後才寫 → 只管後面
  const d = mkDeps(CO);
  await core.handleEvents([{ type: 'message', timestamp: Date.parse('2026-11-01T02:00:00Z'), source: { type: 'group', groupId: 'Gco', userId: 'U' }, message: { id: 'z1', type: 'text', text: '10/15 補\n【工地】興中路\n【今天】打樁' } }], d);
  await core.dailyCompile(d, Date.parse('2026-11-01T12:00:00Z'));
  const x = Object.values(d.drafts).find(r => r.type === 'dailyLog');
  assert.ok(x && x.payload.date === '2026-11-01' && !x.payload.backfill && x.payload.dateBad[0] === '10/15 補' && /超過 7 天/.test(x.summary));
});

test('日期括號寫法（Lotion 11/1）：［］、[]、【】，後面接空白或內文都認；沒寫照送出時間；20:00 後才傳的當天日報歸當天', async () => {
  const R = '2026-11-01';
  assert.equal(core.parseMD('［10/31］', R), '2026-10-31');
  assert.equal(core.parseMD('[10/31] 補', R), '2026-10-31');
  assert.equal(core.parseMD('【10/31】打樁', R), '2026-10-31');
  assert.equal(core.parseMD('[10/20]', R), '');                       // 超過 7 天
  let b = core.parseCoReport('【10/31】\n【工地】興中路\n【今天】打樁', R);
  assert.equal(b[0].date, '2026-10-31');
  b = core.parseCoReport('[10/31]【工地】興中路\n【今天】打樁', R);
  assert.equal(b[0].date, '2026-10-31');
  b = core.parseCoReport('［11/1］ 【工地】興中路\n【今天】打樁', R);
  assert.equal(b[0].date, '2026-11-01');
  const d = mkDeps(CO);
  const g = { type: 'group', groupId: 'Gco', userId: 'U' };
  // 10/31 20:30（台北）才傳、寫了 10/31 → 當天 20:00 已整理過，隔天 08:00 補成草稿，日期 10/31、不算補傳
  const late = Date.parse('2026-10-31T12:30:00Z');
  await core.dailyCompile(d, Date.parse('2026-10-31T12:00:00Z'));
  await core.handleEvents([{ type: 'message', timestamp: late, source: g, message: { id: 'n1', type: 'text', text: '[10/31]\n【工地】興中路\n【今天】晚上收尾' } }], d);
  // 沒寫日期 → 照送出時間
  await core.handleEvents([{ type: 'message', timestamp: Date.parse('2026-11-01T03:00:00Z'), source: g, message: { id: 'n2', type: 'text', text: '【工地】文化路\n【今天】進料' } }], d);
  await core.morningCheck(d, Date.parse('2026-11-01T00:00:00Z'));
  await core.dailyCompile(d, Date.parse('2026-11-01T12:00:00Z'));
  const ds = Object.values(d.drafts).filter(x => x.type === 'dailyLog');
  const a = ds.find(x => /晚上收尾/.test(x.payload.answers.join('')));
  assert.ok(a && a.payload.date === '2026-10-31' && !a.payload.backfill, '20:00 後當天傳的歸當天');
  const c = ds.find(x => /進料/.test(x.payload.answers.join('')));
  assert.ok(c && c.payload.date === '2026-11-01' && !c.payload.backfill, '沒寫日期照送出時間');
});

// ── v6.0.122 範本第一行【日期】自動帶當天 ──
test('v6.0.122 範本：17:30 發的格式第一行【日期】帶當天日期；舊預設自動換新', async () => {
  const d = mkDeps(CO);
  await core.dailyAsk(d, Date.parse('2026-11-01T09:30:00Z'));
  assert.match(d.pushes[0].text, /\n【日期】11\/01\n【工地】\n【今天】\n【明天】\n【問題】$/);
  const d2 = mkDeps(Object.assign({}, CO, { texts: { dailyCo: '今天辛苦了，請照下面格式回報（一個工地一段，可以貼好幾段）：\n【工地】地名\n【今天】\n【明天】\n【問題】' } }));
  await core.dailyAsk(d2, Date.parse('2026-11-01T09:30:00Z'));
  assert.match(d2.pushes[0].text, /【日期】11\/01/);
});

test('v6.0.122 解析：範本原樣、改成前一天、【日期】空白、工地全形／半形括號都對得到', async () => {
  const R = '2026-11-01';
  const S = { p1: { name: '（八九）範例科技F25P1擋土支撐工程' }, p2: { name: '（八九）範例科技F25P2擋土支撐工程' } };
  const tpl = d => '今天辛苦了，請複製下面格式回報（一個工地一段，可以貼好幾段；補昨天的只改日期）：\n【日期】' + d + '\n【工地】（八九）範例科技F25P2\n【今天】打設H300, L=10M*5支\n【明天】續打\n【問題】無';
  let b = core.parseCoReport(tpl('11/01'), R);
  assert.equal(b.length, 1); assert.equal(b[0].date, '2026-11-01'); assert.equal(core.matchSite(S, b[0].site), 'p2');   // 範本原樣（全形括號）
  b = core.parseCoReport(tpl('10/31'), R);
  assert.equal(b[0].date, '2026-10-31');                                                                               // 改成前一天
  b = core.parseCoReport(tpl(''), R);
  assert.equal(b[0].date, '');                                                                                         // 【日期】空白 → 照送出時間
  b = core.parseCoReport('【日期】\n【工地】(八九) 範例科技 F25P1\n【今天】進料', R);
  assert.equal(b[0].date, ''); assert.equal(core.matchSite(S, b[0].site), 'p1');                                      // 半形括號
  assert.deepEqual(core.parseCoReport('【日期】11/01\n【工地】\n【今天】\n【明天】\n【問題】', R), []);                // 範本沒填 → 不建草稿
  // 實際流程：範本原樣送出 → 當天草稿、對到 F25P2
  const d = mkDeps({ owners: {}, groups: { Gco: { mode: 'company', name: '豐有工程' } }, sites: S });
  await core.handleEvents([{ type: 'message', timestamp: Date.parse('2026-11-01T04:26:00Z'), source: { type: 'group', groupId: 'Gco', userId: 'U' }, message: { id: 't1', type: 'text', text: tpl('11/01') } }], d);
  await core.dailyCompile(d, Date.parse('2026-11-01T12:00:00Z'));
  const x = Object.values(d.drafts).find(r => r.type === 'dailyLog');
  assert.ok(x && x.payload.qid === 'p2' && x.payload.date === '2026-11-01' && !x.payload.backfill && !x.payload.unmatched);
});

test('v6.0.144／153 收件：一次 webhook 傳 3 個檔只回一句，先回再存；重送不再回', async () => {
  const d = mkDeps(CFG); const order = [];
  d.reply = async (t, text) => { order.push('reply'); d.replies.push({ t, text }); };
  const put0 = d.putFile; d.putFile = async (p, b) => { order.push('put'); return put0(p, b); };
  const ev = id => ({ type: 'message', timestamp: T0, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'file', fileName: id + '.pdf', fileSize: 10 } });
  await core.handleEvents([ev('f1'), ev('f2'), ev('f3')], d);
  assert.equal(d.replies.length, 1); assert.match(d.replies[0].text, /收到，之後的檔案會一起收/); assert.equal(order[0], 'reply');
  assert.deepEqual(Object.keys(d.db.fydata.lineInbox).sort(), ['f1', 'f2', 'f3']);
  await core.handleEvents([ev('f1')], d);
  assert.equal(d.replies.length, 1);
});
test('v6.0.144 收件：超過 100MB 的不存、回覆裡說明；串流存檔（saveContent）與存檔失敗記 error', async () => {
  const d = mkDeps(CFG);
  await core.handleEvents([{ type: 'message', timestamp: T0, replyToken: 'rb', source: { type: 'user', userId: 'Uowner' }, message: { id: 'b1', type: 'video', fileSize: 101 * 1048576 } }], d);
  assert.equal(d.db.fydata.lineInbox.b1.status, 'tooBig'); assert.match(d.replies[0].text, /超過 100MB 沒存/);
  const saved = []; d.saveContent = async (id, path, max) => { saved.push({ id, path, max }); return id === 's2' ? { tooBig: true, size: max + 1 } : { size: 1234 }; };
  const e = id => ({ type: 'message', timestamp: T0, replyToken: 'r', source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  await core.handleEvents([e('s1'), e('s2')], d);
  assert.equal(d.db.fydata.lineInbox.s1.status, 'new'); assert.equal(d.db.fydata.lineInbox.s1.size, 1234); assert.equal(saved[0].max, core.MAX_FILE_BYTES);
  assert.equal(d.db.fydata.lineInbox.s2.status, 'tooBig'); assert.equal(Object.keys(d.files).length, 0);
  d.saveContent = async () => { throw new Error('網路斷了'); };
  await core.handleEvents([e('s3')], d);
  assert.equal(d.db.fydata.lineInbox.s3.status, 'error'); assert.match(d.db.fydata.lineInbox.s3.err, /網路斷了/);
});

test('v6.0.144 審查：下載前先認領，下載中的重送不重複下載也不重複回覆；超過時間預算的記 error 請重傳', async () => {
  const d = mkDeps(CFG); const claimed = {};
  d.claim = async (p, v) => { if (claimed[p] || d.dbGetSync) return false; claimed[p] = 1; await d.dbSet(p, v); return true; };
  let saves = 0; d.saveContent = async () => { saves++; return { size: 10 }; };
  const ev = { type: 'message', timestamp: T0, replyToken: 'r', source: { type: 'user', userId: 'Uowner' }, message: { id: 'c1', type: 'image' } };
  await core.handleEvents([ev], d);
  claimed['fydata/lineInbox/c1'] = 1;   // 第二次投遞：已認領
  await core.handleEvents([ev], d);
  assert.equal(saves, 1); assert.equal(d.replies.length, 1); assert.equal(d.db.fydata.lineInbox.c1.status, 'new');
  let t = 0; d.now = () => t; const e2 = id => ({ type: 'message', timestamp: T0, replyToken: 'r', source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'file', fileName: id + '.pdf' } });
  d.saveContent = async () => { t += core.INBOX_BUDGET_MS + 1; return { size: 10 }; };
  await core.handleEvents([e2('k1'), e2('k2')], d);
  assert.equal(d.db.fydata.lineInbox.k1.status, 'new'); assert.equal(d.db.fydata.lineInbox.k2.status, 'error'); assert.match(d.db.fydata.lineInbox.k2.err, /請重傳/);
});

test('v6.0.153 回覆合併：同一批（3 分鐘內）分開送來也只回第一則；隔超過 3 分鐘才算新的一批', async () => {
  const d = mkDeps(CFG);
  const ev = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'file', fileName: id + '.pdf', fileSize: 10 } });
  for (const [id, t] of [['b1', T0], ['b2', T0 + 60e3], ['b3', T0 + 170e3], ['b4', T0 + 400e3], ['b5', T0 + 450e3]]) await core.handleEvents([ev(id, t)], d);
  assert.equal(d.replies.length, 2); assert.equal(d.replies[0].t, 'rb1'); assert.equal(d.replies[1].t, 'rb4');   // b4 距 b3 超過 3 分鐘＝新的一批
  assert.equal(d.db.fydata.lineInbox.b2.batch, 'b1'); assert.equal(d.db.fydata.lineInbox.b5.batch, 'b4');
  assert.equal(Object.keys(d.files).length, 5);
});
test('v6.0.153 回覆合併：傳完打一行字＝這批的案名，記到這批每個檔、回一句；先打字後傳檔也帶上', async () => {
  const d = mkDeps(CFG);
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  const tx = (id, t, text) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'text', text } });
  await core.handleEvents([f('p1', T0), f('p2', T0 + 30e3)], d);
  await core.handleEvents([tx('t1', T0 + 120e3, '推薦人：範例業務')], d);
  assert.equal(d.db.fydata.lineInbox.p1.note, '推薦人：範例業務'); assert.equal(d.db.fydata.lineInbox.p2.note, '推薦人：範例業務');
  assert.match(d.replies[d.replies.length - 1].text, /第 1 批 2 個檔案：推薦人：範例業務，已記下/);
  assert.equal(d.db.fydata.lineInbox.t1.status, 'filed');
  // 過了 10 分鐘的文字不算這批：照舊記一筆文字、不回
  const n0 = d.replies.length; await core.handleEvents([tx('t2', T0 + 20 * 60e3, '另一件事')], d);
  assert.equal(d.replies.length, n0); assert.equal(d.db.fydata.lineInbox.t2.status, 'new');
  // 先打字（t2），5 分鐘內傳檔 → 新的一批帶上這行字，回覆也說已記下
  await core.handleEvents([f('p3', T0 + 25 * 60e3)], d);
  assert.equal(d.db.fydata.lineInbox.p3.note, '另一件事'); assert.match(d.replies[d.replies.length - 1].text, /已記下：另一件事/);
});
test('v6.0.153 回覆合併：存檔失敗照樣回（不是第一則用自己的回覆權杖；第一則權杖已用掉才推播）', async () => {
  const d = mkDeps(CFG);
  d.saveContent = async (id) => { if (id === 'e2' || id === 'e1') throw new Error('壞了'); return { size: 1 }; };
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'file', fileName: id + '.pdf' } });
  await core.handleEvents([f('e1', T0)], d);   // 第一則：回「收到」用掉權杖，失敗改推播
  assert.equal(d.replies.length, 1); assert.equal(d.pushes.length, 1); assert.match(d.pushes[0].text, /沒存成功，請重傳：e1\.pdf/);
  await core.handleEvents([f('e2', T0 + 30e3)], d);   // 同一批第二則：靜默，但失敗要回（用自己的權杖）
  assert.equal(d.replies.length, 2); assert.equal(d.replies[1].t, 're2'); assert.match(d.replies[1].text, /沒存成功，請重傳：e2\.pdf/); assert.equal(d.pushes.length, 1);
  await core.handleEvents([f('e3', T0 + 60e3)], d);   // 成功的不回
  assert.equal(d.replies.length, 2);
});
test('v6.0.153 舊預設回覆「收到，{n} 個檔案，歸到哪一案？」存在設定裡沒改過 → 換成新預設', async () => {
  const d = mkDeps(Object.assign({}, CFG, { texts: { inboxAck: '收到，{n} 個檔案，歸到哪一案？' } }));
  await core.handleEvents([{ type: 'message', timestamp: T0, replyToken: 'r', source: { type: 'user', userId: 'Uowner' }, message: { id: 'o1', type: 'image' } }], d);
  assert.match(d.replies[0].text, /之後的檔案會一起收/);
});

test('v6.0.153 審查：傳檔前連打兩行都留；回覆失敗不改推播；很舊的重送檔不蓋掉目前這批；文字重送不重回；有交易時兩個平行的第一則只回一次', async () => {
  const d = mkDeps(CFG);
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  const tx = (id, t, text) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'text', text } });
  await core.handleEvents([tx('a1', T0, '範例營造')], d); await core.handleEvents([tx('a2', T0 + 60e3, '內湖案')], d);
  await core.handleEvents([f('q1', T0 + 120e3)], d);
  assert.equal(d.db.fydata.lineInbox.q1.note, '範例營造；內湖案');
  // 回覆失敗：不推播
  const p0 = d.pushes.length; d.reply = async () => { throw new Error('LINE 500'); };
  await core.handleEvents([f('q2', T0 + 30 * 60e3)], d);
  assert.equal(d.pushes.length, p0);
  // 很舊的重送檔（比這批開始早超過 3 分鐘）：自成一批，不蓋掉目前這批
  const cur = JSON.stringify(d.db.fydata.lineInboxBatch.Uowner);
  await core.handleEvents([f('q0', T0 - 60 * 60e3)], d);
  assert.equal(JSON.stringify(d.db.fydata.lineInboxBatch.Uowner), cur);
  // 文字重送（有認領）：只回一次
  const d2 = mkDeps(CFG); const claimed = {};
  d2.claim = async (p, v) => { if (claimed[p]) return false; claimed[p] = 1; await d2.dbSet(p, v); return true; };
  await core.handleEvents([f('w1', T0)], d2); const n1 = d2.replies.length;
  claimed['fydata/lineInbox/w9'] = 1;   // 模擬同一則文字已在處理中
  await core.handleEvents([tx('w9', T0 + 60e3, '某案')], d2);
  assert.equal(d2.replies.length, n1);
  // 交易：兩則檔案平行到，都讀到空的批次 → 交易讓第二個重跑，只有一個是第一則
  const d3 = mkDeps(CFG); let lock = Promise.resolve();
  d3.txn = async (path, fn) => { const run = lock.then(async () => { const cur = await d3.dbGet(path); const v = fn(cur || null); if (v !== undefined) await d3.dbSet(path, v); return v; }); lock = run.catch(() => {}); return run; };
  await Promise.all([core.handleEvents([f('x1', T0)], d3), core.handleEvents([f('x2', T0 + 1000)], d3)]);
  assert.equal(d3.replies.length, 1); assert.deepEqual(Object.keys(d3.db.fydata.lineInboxBatch.Uowner.ids).sort(), ['x1', 'x2']);
});

// v6.0.178 Lotion 11/05：10:43 傳案 1 的 3 個檔＋案名、10:45 傳案 2 的 1 張圖＋案名（3 分鐘內）→ 不能併成一批、第二行字不能蓋掉第一批
test('v6.0.178 分批：案名打完這批就關閉（3 分鐘內的檔案也開新批）；第二批的字不蓋掉第一批；回覆寫第幾批', async () => {
  const d = mkDeps(CFG);
  const f = (id, t, ty) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: Object.assign({ id, type: ty || 'file', fileSize: 10 }, ty === 'image' ? {} : { fileName: id + '.pdf' }) });
  const tx = (id, t, text) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'text', text } });
  const T = Date.UTC(2026, 10, 5, 2, 43);   // 台北 10:43
  await core.handleEvents([f('a1', T), f('a2', T + 5e3), f('a3', T + 10e3)], d);
  await core.handleEvents([tx('n1', T + 40e3, '業主詢價單（業務 假甲）')], d);
  await core.handleEvents([f('b1', T + 120e3, 'image')], d);   // 10:45，距上一個檔不到 3 分鐘
  await core.handleEvents([tx('n2', T + 150e3, '業主詢價單-假乙介紹')], d);
  const I = d.db.fydata.lineInbox;
  ['a1', 'a2', 'a3'].forEach((k) => { assert.equal(I[k].note, '業主詢價單（業務 假甲）'); assert.equal(I[k].batch, 'a1'); });
  assert.equal(I.b1.batch, 'b1'); assert.equal(I.b1.note, '業主詢價單-假乙介紹');
  const R = d.replies.map((r) => r.text);
  assert.match(R.find((x) => /業務 假甲/.test(x)), /^第 1 批 3 個檔案：/);
  assert.match(R.find((x) => /^第 2 批：收到/.test(x)) || '', /^第 2 批：收到/);   // 第二批第一個檔的回覆寫第 2 批
  assert.match(R[R.length - 1], /^第 2 批 1 個檔案：業主詢價單-假乙介紹，已記下/);
});
test('v6.0.178 分批：已有案名後「補充」「備註」附加到這批；其他字＝下一批的案名（先打字後傳檔），不蓋掉這批', async () => {
  const d = mkDeps(CFG);
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  const tx = (id, t, text) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'text', text } });
  await core.handleEvents([f('c1', T0), f('c2', T0 + 5e3)], d);
  await core.handleEvents([tx('m1', T0 + 30e3, '範例案 A')], d);
  await core.handleEvents([tx('m2', T0 + 60e3, '補充：含平面圖')], d);
  assert.equal(d.db.fydata.lineInbox.c1.note, '範例案 A；含平面圖'); assert.equal(d.db.fydata.lineInbox.c2.note, '範例案 A；含平面圖');
  assert.match(d.replies[d.replies.length - 1].text, /^第 1 批補充：含平面圖，已記下/);
  await core.handleEvents([tx('m3', T0 + 90e3, '範例案 B')], d);   // 不是補充：下一批的案名
  assert.equal(d.db.fydata.lineInbox.c1.note, '範例案 A；含平面圖');   // 沒被蓋掉
  assert.match(d.replies[d.replies.length - 1].text, /接下來傳的檔案記成：範例案 B/);
  assert.equal(d.db.fydata.lineInbox.m3.status, 'new');
  await core.handleEvents([f('c3', T0 + 100e3)], d);   // 3 分鐘內，但上一批已關閉 → 新批、帶「範例案 B」
  assert.equal(d.db.fydata.lineInbox.c3.batch, 'c3'); assert.equal(d.db.fydata.lineInbox.c3.note, '範例案 B');
  await core.handleEvents([f('c4', T0 + 110e3)], d);   // 先打字後傳檔的批：還沒關閉，後續檔案照樣併進來
  assert.equal(d.db.fydata.lineInbox.c4.batch, 'c3'); assert.equal(d.db.fydata.lineInbox.c4.note, '範例案 B');
  await core.handleEvents([tx('m4', T0 + 130e3, '備註 急件')], d);
  assert.equal(d.db.fydata.lineInbox.c3.note, '範例案 B；急件'); assert.equal(d.db.fydata.lineInbox.c1.note, '範例案 A；含平面圖');
});
test('v6.0.178 固定句子：存過沒改的舊預設「這批 {n} 個檔案」換成新預設（寫第幾批）', async () => {
  const d = mkDeps(Object.assign({}, CFG, { texts: { inboxNote: '這批 {n} 個檔案：{text}，已記下' } }));
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  await core.handleEvents([f('o1', T0)], d);
  await core.handleEvents([{ type: 'message', timestamp: T0 + 30e3, replyToken: 'rt', source: { type: 'user', userId: 'Uowner' }, message: { id: 'ot', type: 'text', text: '範例案' } }], d);
  assert.match(d.replies[d.replies.length - 1].text, /^第 1 批 1 個檔案：範例案/);
});

test('v6.0.178 審查：比案名晚到的同批檔（平行投遞／重送）併回這批、帶案名，不另開一批；下一批案名連打兩行都留、補充接在下一批', async () => {
  const d = mkDeps(CFG);
  const f = (id, t) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'image' } });
  const tx = (id, t, text) => ({ type: 'message', timestamp: t, replyToken: 'r' + id, source: { type: 'user', userId: 'Uowner' }, message: { id, type: 'text', text } });
  await core.handleEvents([f('a1', T0), f('a2', T0 + 5e3)], d);
  await core.handleEvents([tx('n1', T0 + 40e3, '範例案 甲')], d);
  await core.handleEvents([f('a3', T0 + 10e3)], d);   // 10 秒時傳出、案名之後才到
  const I = d.db.fydata.lineInbox, B = d.db.fydata.lineInboxBatch.Uowner;
  assert.equal(I.a3.batch, 'a1'); assert.equal(I.a3.note, '範例案 甲'); assert.equal(B.id, 'a1'); assert.equal(B.no, 1);
  assert.ok(!d.replies.some((r) => /第 2 批/.test(r.text)));
  // 下一批的案名連打兩行（含補充）：都接在下一批，不動上一批
  await core.handleEvents([tx('n2', T0 + 60e3, '範例案 乙')], d);
  await core.handleEvents([tx('n3', T0 + 70e3, '補充：業務假丙')], d);
  assert.equal(I.a1.note, '範例案 甲'); assert.match(d.replies[d.replies.length - 1].text, /接下來傳的檔案記成：範例案 乙；業務假丙/);
  await core.handleEvents([f('b1', T0 + 90e3)], d);
  assert.equal(I.b1.batch, 'b1'); assert.equal(I.b1.note, '範例案 乙；業務假丙');
  assert.ok(!d.db.fydata.lineInboxBatch.Uowner.pendNext);   // 用過就清掉
});
