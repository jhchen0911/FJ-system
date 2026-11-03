// 豐有工程管理系統：Firebase Auth custom claims 同步（任務 7，Storage 權限長期方案 B）
// 依 RTDB 名冊替每個帳號設定 claim `fy`：
//   fydata/readers     → 'reader'（唯讀帳號，優先於其他名冊）
//   fydata/adminEmails → 'admin'
//   fydata/access      → 'staff'
//   都不在 → 移除 fy（陌生帳號）
// 名冊 key 與前端 _encEmailKey 相同：email 小寫、「.」換成「,」。
// 觸發：三份名冊任一變動即全量重算；新帳號建立時也重算一次（對方第一次登入後即取得 claim）。
// claim 變更後，使用者的 ID token 最長 1 小時才更新——前端登入時已主動 getIdToken(true) 重新取得。
const { onValueWritten } = require('firebase-functions/v2/database');
const { onRequest } = require('firebase-functions/v2/https');
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const REGION = 'asia-southeast1';   // 與 RTDB 實例（jhchen-aed9a-default-rtdb.asia-southeast1）同區
const OWNER = 'jhchen0911@gmail.com';
const dec = (k) => String(k || '').replace(/,/g, '.').toLowerCase();

async function lists() {
  const db = admin.database();
  const [acc, adm, rdr] = await Promise.all(['fydata/access', 'fydata/adminEmails', 'fydata/readers']
    .map((p) => db.ref(p).once('value').then((s) => s.val() || {})));
  // v6.0.108：readers 名冊值可為 true 或 {name}（唯讀帳號顯示名稱）
  const on = (v) => v === true || (!!v && typeof v === 'object' && !Array.isArray(v));
  const set = (o, f) => new Set(Object.keys(o).filter((k) => (f || ((v) => v === true))(o[k])).map(dec));
  return { access: set(acc), admins: set(adm), readers: set(rdr, on) };
}
function roleOf(email, L) {
  const e = String(email || '').toLowerCase();
  if (!e) return null;
  if (e === OWNER) return 'admin';
  if (L.readers.has(e)) return 'reader';
  if (L.admins.has(e)) return 'admin';
  if (L.access.has(e)) return 'staff';
  return null;
}
async function applyUser(u, L) {
  const want = roleOf(u.email, L);
  const cur = (u.customClaims || {}).fy || null;
  if (want === cur) return false;
  const claims = Object.assign({}, u.customClaims || {});
  if (want) claims.fy = want; else delete claims.fy;
  await admin.auth().setCustomUserClaims(u.uid, claims);
  return true;
}
async function syncAll() {
  const L = await lists();
  let changed = 0, token;
  do {
    const page = await admin.auth().listUsers(1000, token);
    for (const u of page.users) if (await applyUser(u, L)) changed++;
    token = page.pageToken;
  } while (token);
  return changed;
}

const watch = (path) => onValueWritten({ ref: path, region: REGION }, async () => { await syncAll(); });
exports.fyClaimsAccess = watch('/fydata/access');
exports.fyClaimsAdmins = watch('/fydata/adminEmails');
exports.fyClaimsReaders = watch('/fydata/readers');

// 新帳號建立：立即依名冊給 claim
exports.fyClaimsOnCreate = functionsV1.region(REGION).auth.user().onCreate(async (u) => {
  await applyUser(u, await lists());
});

// 手動全量重算（部署後跑一次）：只有擁有者可呼叫——帶 Authorization: Bearer <ID token>
exports.fyClaimsSyncNow = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'] }, async (req, res) => {
  try {
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).send('需要登入'); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    if (String(t.email || '').toLowerCase() !== OWNER) { res.status(403).send('只有擁有者可執行'); return; }
    res.json({ changed: await syncAll() });
  } catch (e) { res.status(500).send(String(e && e.message || e)); }
});

// ══════════ LINE 機器人（批次 F；規格見 my-agent 400_Project/line-bot/README.md）══════════
// 密鑰用 defineSecret：回國後由 Lotion 在自己電腦執行 `firebase functions:secrets:set LINE_CHANNEL_SECRET` 與
// `firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN` 貼上（不進程式碼、不進 Git、不經對話）。
// 寫進 FJ 的一律是草稿（fydata/drafts，type addon／dailyLog），要人在 FJ 按確認。
const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueCreated } = require('firebase-functions/v2/database');
const lineCore = require('./line/core.js');
const lineAdapters = require('./line/adapters.js');
const LINE_SECRET = defineSecret('LINE_CHANNEL_SECRET');
const LINE_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');
const TZ = 'Asia/Taipei';

// Webhook：LINE 後台「Webhook URL」貼這支的網址（部署後終端機會印出 lineWebhook 的網址）
exports.lineWebhook = onRequest({ region: REGION, secrets: [LINE_SECRET, LINE_TOKEN], memory: '512MiB', timeoutSeconds: 300 }, async (req, res) => {
  if (req.method !== 'POST') { res.status(200).send('ok'); return; }   // LINE 後台「驗證」用 GET／空 POST 都回 200
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  if (!lineCore.verifySignature(LINE_SECRET.value(), raw, req.get('x-line-signature'))) { res.status(401).send('bad signature'); return; }
  const events = (req.body && req.body.events) || [];
  try { await lineCore.handleEvents(events, lineAdapters.mkDeps(LINE_TOKEN.value())); } catch (e) { console.error('lineWebhook', e); }
  res.status(200).send('ok');   // 一律回 200，LINE 才不會重送
});
// 17:30 工地群組問三句（固定文字）
exports.lineDailyAsk = onSchedule({ schedule: '30 17 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN] }, async () => {
  await lineCore.dailyAsk(lineAdapters.mkDeps(LINE_TOKEN.value()), Date.now());
});
// 20:00 整理成 FJ 日報草稿
exports.lineDailyCompile = onSchedule({ schedule: '0 20 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN] }, async () => {
  await lineCore.dailyCompile(lineAdapters.mkDeps(LINE_TOKEN.value()), Date.now());
});
// 08:00 前一天沒回 → 群組提醒；連兩天沒回 → 通知 Lotion
exports.lineMorningCheck = onSchedule({ schedule: '0 8 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN] }, async () => {
  await lineCore.morningCheck(lineAdapters.mkDeps(LINE_TOKEN.value()), Date.now());
});
// 推播佇列：FJ／陳軒寫 fydata/linePush/<id>（status:'pending'）→ 推給 Lotion
exports.linePushQueue = onValueCreated({ ref: '/fydata/linePush/{id}', region: REGION, secrets: [LINE_TOKEN] }, async (event) => {
  await lineCore.processPush(event.params.id, event.data.val(), lineAdapters.mkDeps(LINE_TOKEN.value()));
});

// ══════════ v6.0.118 健檢2 #7：AI 代理（前端不再持有 Anthropic 金鑰） ══════════
// 金鑰用 defineSecret：回國後由 Lotion 在自己電腦執行 `firebase functions:secrets:set ANTHROPIC_API_KEY`，程式與 Git 都不含金鑰。
// 前端：fetch(aiProxy, {Authorization: Bearer <ID token>, body: Anthropic messages 格式})；只有員工與管理員可用、每人每天上限。
const opsCore = require('./ops/core.js');
const ANTHROPIC_KEY = defineSecret('ANTHROPIC_API_KEY');
exports.aiProxy = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], secrets: [ANTHROPIC_KEY], memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).send('只接受 POST'); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const role = t.fy || roleOf(t.email, await lists());
    if (!opsCore.aiRoleOk(role)) { res.status(403).json({ error: { message: '這個帳號不能使用 AI 功能' } }); return; }
    if ((req.rawBody ? req.rawBody.length : 0) > opsCore.AI_MAX_BODY) { res.status(413).json({ error: { message: '檔案太大' } }); return; }
    const c = opsCore.cleanAiBody(req.body);
    if (c.err) { res.status(400).json({ error: { message: c.err } }); return; }
    // 每人每天上限（RTDB fydata/aiUsage/<uid>/<日期>，網頁不可寫）
    const ref = admin.database().ref('fydata/aiUsage/' + t.uid + '/' + opsCore.tpeDate());
    const tx = await ref.transaction((n) => ((n || 0) >= opsCore.AI_DAILY_LIMIT ? undefined : (n || 0) + 1));
    if (!tx.committed) { res.status(429).json({ error: { message: '今天的 AI 使用次數已達上限（' + opsCore.AI_DAILY_LIMIT + ' 次）' } }); return; }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY.value(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(c.body),
    });
    const j = await r.json().catch(() => ({ error: { message: 'AI 服務回應格式錯誤' } }));
    if (!r.ok) await ref.transaction((n) => Math.max(0, (n || 1) - 1)).catch(() => null);   // 呼叫失敗不算一次
    res.status(r.status).json(j);
  } catch (e) {
    console.error('aiProxy', e);
    res.status(500).json({ error: { message: 'AI 代理錯誤' } });
  }
});

// ══════════ v6.0.123 AI 通知：AI 帳號／Lotion 用 LINE「陳軒｜AI 助理」傳一行短訊息給 Lotion ══════════
// 前端（FJ 總覽「通知 Lotion」或 fyNotify()）帶登入憑證呼叫；所有檢查都在這裡做：發送者名單、短文字、每天 6 則（v6.0.134）、收件人固定 LINE 擁有者。
// 紀錄 fydata/aiNotifyLog（只有管理員可讀、網頁不能寫）保留 180 天；每天計數 fydata/aiNotifyCount/<日期>（每天 6 則；_held 只記不推每天 30 則，v6.0.134）。
// v6.0.134：發送前查 LINE 本月已用則數，≥180 就只記 status:'held'（FJ 總覽顯示），不推 LINE。
const notifyCore = require('./ops/notify.js');
exports.aiNotify = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], secrets: [LINE_TOKEN] }, async (req, res) => {
  let logRef = null, logged = false, logText = '', logBy = '';
  // 不檢查 email_verified：FJ 用帳號密碼登入、兩個帳號早已存在，別人無法用同一個 email 再註冊（審查 #4 的取捨，見版本紀錄）
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const email = String(t.email || '').toLowerCase();
    if (!notifyCore.notifyAllowed(email)) { res.status(403).json({ error: { message: '這個帳號不能發通知' } }); return; }
    const db = admin.database(), now = Date.now(), day = opsCore.tpeDate(now);
    logRef = db.ref('fydata/aiNotifyLog').push(); logBy = email;
    const b = notifyCore.buildNotify(req.body);
    if (b.err) {
      // 被擋的也記，但每天最多記 30 筆（審查：避免帳號被誘導狂送時灌爆紀錄）
      const rj = await db.ref('fydata/aiNotifyCount/' + day + '_rej').transaction((n) => ((n || 0) >= notifyCore.NOTIFY_REJ_LOG ? undefined : (n || 0) + 1));
      if (rj.committed) await logRef.set({ by: email, at: now, text: String((req.body && typeof req.body.text === 'string' && req.body.text) || (req.body && typeof req.body.title === 'string' && req.body.title) || '').slice(0, 120), status: 'rejected', reason: b.err });
      res.status(400).json({ error: { message: b.err } }); return;
    }
    const cntRef = db.ref('fydata/aiNotifyCount/' + day);
    const tx = await cntRef.transaction((n) => ((n || 0) >= notifyCore.NOTIFY_DAILY ? undefined : (n || 0) + 1));
    if (!tx.committed) { await logRef.set({ by: email, at: now, text: b.text, status: 'dropped', reason: '超過每天 ' + notifyCore.NOTIFY_DAILY + ' 則' }); res.status(429).json({ error: { message: '今天的通知已達上限（' + notifyCore.NOTIFY_DAILY + ' 則）' } }); return; }
    logText = b.text;
    const deps = lineAdapters.mkDeps(LINE_TOKEN.value());
    // v6.0.134：LINE 本月額度快用完（≥180／200）→ 不推 LINE，只記在 FJ（總覽顯示），也不佔當天名額
    const used = await deps.quotaUsed();
    if (notifyCore.monthHold(used)) {
      const ht = await db.ref('fydata/aiNotifyCount/' + day + '_held').transaction((n) => ((n || 0) >= notifyCore.NOTIFY_HELD_DAILY ? undefined : (n || 0) + 1));
      await cntRef.transaction((n) => Math.max(0, (n || 1) - 1)).catch(() => null);
      if (!ht.committed) { res.status(429).json({ error: { message: 'LINE 本月額度快用完，今天只記在 FJ 的通知也已達 ' + notifyCore.NOTIFY_HELD_DAILY + ' 則' } }); return; }
      await logRef.set({ by: email, at: now, text: b.text, status: 'held', reason: 'LINE 本月已用 ' + used + '／' + notifyCore.NOTIFY_MONTH_LIMIT + '，暫停推 LINE', used }); logged = true;
      res.status(200).json({ ok: true, held: true, used, limit: notifyCore.NOTIFY_MONTH_LIMIT, text: b.text }); return;
    }
    const cfg = (await deps.getCfg()) || {};
    const sent = Object.keys(cfg.owners || {}).length ? await lineCore.pushOwners(cfg, deps, b.text) : 0;   // 收件人只看伺服器端的擁有者名單
    await logRef.set({ by: email, at: now, text: b.text, status: sent ? 'sent' : 'failed', to: sent, used: used == null ? null : used + sent }); logged = true;
    if (!sent) await cntRef.transaction((n) => Math.max(0, (n || 1) - 1)).catch(() => null);   // 沒送出不佔當天名額
    // 超過 180 天的紀錄清掉（每次最多 50 筆）
    try {
      const old = (await db.ref('fydata/aiNotifyLog').orderByChild('at').endAt(now - notifyCore.NOTIFY_KEEP_MS).limitToFirst(50).once('value')).val() || {};
      const up = {}; Object.keys(old).forEach(k => { up[k] = null; }); if (Object.keys(up).length) await db.ref('fydata/aiNotifyLog').update(up);
    } catch (e) { console.error('aiNotify.prune', e); }
    if (!sent) { res.status(502).json({ error: { message: 'LINE 沒送出（擁有者還沒設定或 LINE 推播失敗）' } }); return; }
    res.status(200).json({ ok: true, text: b.text, used: used == null ? null : used + sent, limit: notifyCore.NOTIFY_MONTH_LIMIT, quota: used == null ? 'unknown' : 'ok' });
  } catch (e) {
    console.error('aiNotify', e);
    if (logRef && !logged && logText) { try { await logRef.set({ by: logBy, at: Date.now(), text: logText, status: 'error', reason: String(e && e.message || e).slice(0, 200) }); } catch (e2) { console.error('aiNotify.log', e2); } }
    res.status(500).json({ error: { message: '通知服務錯誤' } });
  }
});

// ══════════ v6.0.118 健檢2 #13：伺服器端每日備份（不再只靠擁有者開 App） ══════════
// 每天 03:15（台北）把 RTDB fydata 整包（扣掉 backups）存到 Storage fydata/backups/server/daily/<日期>.json，
// 每月 1 日另存 monthly/<年月>.json；保留 30 份日備份、12 份月備份。Storage 規則：fydata/backups/** 只有擁有者能讀。
exports.dailyServerBackup = onSchedule({ schedule: '15 3 * * *', timeZone: TZ, region: REGION, memory: '1GiB', timeoutSeconds: 540 }, async () => {
  const now = Date.now();
  const bucket = admin.storage().bucket();
  const db = admin.database();
  const counts = {};
  const dirs = opsCore.backupDirs(now);
  // 逐個節點讀、逐個寫（不一次載入整包 fydata，避免記憶體不足）
  for (const node of opsCore.BACKUP_NODES) {
    const v = (await db.ref('fydata/' + node).once('value')).val();
    if (v == null) continue;
    if (node === 'shared' || node === 'private') Object.assign(counts, opsCore.backupPayload({ [node]: v }, now).counts);
    const buf = Buffer.from(JSON.stringify({ kind: 'fy-server-backup', version: 2, at: now, node, data: v }));
    for (const d of dirs) await bucket.file(d + node + '.json').save(buf, { contentType: 'application/json', resumable: false });
  }
  for (const d of dirs) await bucket.file(d + '_index.json').save(Buffer.from(JSON.stringify({ at: now, counts, nodes: opsCore.BACKUP_NODES })), { contentType: 'application/json', resumable: false });
  for (const [prefix, keep] of [['fydata/backups/server/daily/', opsCore.KEEP_DAILY], ['fydata/backups/server/monthly/', opsCore.KEEP_MONTHLY]]) {
    const [files] = await bucket.getFiles({ prefix });
    const del = opsCore.pruneList(files.map((f) => f.name), keep);
    for (const f of files) if (del.some((p) => f.name.indexOf(p) === 0)) await f.delete().catch((e) => console.error('prune', f.name, e));
  }
  console.log('[備份] 完成', JSON.stringify(counts));
});

// ══════════ v6.0.137 電腦端斷線警報：電腦端（Lotion-HQ）定時報到，超過 2 小時沒報到就 LINE 通知 Lotion 一次 ══════════
// 報到：電腦端在 FJ 分頁執行 fyBeat()（帶登入憑證呼叫 hqBeat），只記時間；發送者名單與 aiNotify 相同（notifyAllowed）。
// 檢查：台灣時間 08:00～22:00 每小時一次（hqBeatCheck）；同一次斷線只發一次（fydata/hqBeat/alertFor），恢復報到後重置。
// LINE 月額度保護同 aiNotify：本月已用 ≥180 則只記 fydata/aiNotifyLog（status:'held'，FJ 總覽顯示），不推 LINE。不佔 aiNotify 每天 6 則名額。
const hbCore = require('./ops/heartbeat.js');
exports.hqBeat = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'] }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const email = String(t.email || '').toLowerCase();
    if (!notifyCore.notifyAllowed(email)) { res.status(403).json({ error: { message: '這個帳號不能報到' } }); return; }
    const ref = admin.database().ref('fydata/hqBeat'), now = Date.now();
    const cur = (await ref.once('value')).val();
    if (hbCore.hbShouldWrite(cur, now)) await ref.update({ at: now, by: email });
    res.status(200).json({ ok: true, at: now, recovered: !!(cur && cur.alertFor && cur.alertFor === cur.at) });
  } catch (e) {
    console.error('hqBeat', e);
    res.status(500).json({ error: { message: '報到服務錯誤' } });
  }
});
exports.hqBeatCheck = onSchedule({ schedule: '0 8-22 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN] }, async () => {
  const db = admin.database(), now = Date.now(), ref = db.ref('fydata/hqBeat');
  const st = (await ref.once('value')).val();
  const d = hbCore.hbDecide(st, now);
  if (!d.alert) return;
  // 先佔住「這次斷線已發」：排程重跑或兩台同時跑只會有一次 committed
  const prev = st.alertFor == null ? null : st.alertFor;
  const tx = await ref.child('alertFor').transaction((c) => (c === d.key ? undefined : d.key));
  if (!tx.committed) return;
  const text = hbCore.hbText(d.key);
  const logRef = db.ref('fydata/aiNotifyLog').push();
  const undo = () => ref.child('alertFor').set(prev).catch((e) => console.error('hqBeatCheck.undo', e));   // 不用 transaction：本機快取是 null 時回 undefined 會直接放棄
  const note = (rec) => Promise.all([logRef.set(rec), ref.update({ alertAt: now })]).catch((e) => console.error('hqBeatCheck.log', e));   // 審查：已推出去後紀錄寫失敗不能放掉 alertFor，否則下個小時重推
  let used = null, sent = 0;
  try {
    const deps = lineAdapters.mkDeps(LINE_TOKEN.value());
    used = await deps.quotaUsed();
    if (notifyCore.monthHold(used)) { await note({ by: 'hqBeatCheck', at: now, text, status: 'held', reason: 'LINE 本月已用 ' + used + '／' + notifyCore.NOTIFY_MONTH_LIMIT + '，暫停推 LINE', used }); return; }
    const cfg = (await deps.getCfg()) || {};
    sent = Object.keys(cfg.owners || {}).length ? await lineCore.pushOwners(cfg, deps, text) : 0;
  } catch (e) { console.error('hqBeatCheck', e); await undo(); return; }
  if (!sent) { await undo(); await logRef.set({ by: 'hqBeatCheck', at: now, text, status: 'failed', to: 0 }).catch((e) => console.error('hqBeatCheck.log', e)); return; }   // 沒送出：放掉，下個小時再試
  await note({ by: 'hqBeatCheck', at: now, text, status: 'sent', to: sent, used: used == null ? null : used + sent });
});

// ══════════ v6.0.144 LINE 收件匣：標已歸檔（FJ 管理員畫面與電腦端 HQ 共用） ══════════
// lineInbox 網頁不能寫（規則 .write false）；改狀態一律走這支：帶登入憑證，只有擁有者／管理員（名冊）或 AI 帳號名單（同 aiNotify）可用。
// body：{id, status:'filed'|'new', qid?, caseName?, note?}；只改這幾個欄位，檔案路徑與來源不能改。
const inboxCore = require('./ops/inbox.js');
exports.lineInboxMark = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'] }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const email = String(t.email || '').toLowerCase();
    const role = t.fy || roleOf(email, await lists());
    if (!inboxCore.markAllowed(email, role)) { res.status(403).json({ error: { message: '這個帳號不能改收件匣' } }); return; }
    const c = inboxCore.cleanMark(req.body);
    if (c.err) { res.status(400).json({ error: { message: c.err } }); return; }
    const ref = admin.database().ref('fydata/lineInbox/' + c.id);
    const cur = (await ref.once('value')).val();
    if (!cur || cur.id !== c.id) { res.status(404).json({ error: { message: '找不到這筆收件' } }); return; }
    const up = inboxCore.markUpdate(cur, c, email, Date.now());
    await ref.update(up);
    res.status(200).json({ ok: true, id: c.id, status: up.status });
  } catch (e) {
    console.error('lineInboxMark', e);
    res.status(500).json({ error: { message: '收件匣服務錯誤' } });
  }
});
