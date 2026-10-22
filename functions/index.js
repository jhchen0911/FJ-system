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
exports.lineWebhook = onRequest({ region: REGION, secrets: [LINE_SECRET, LINE_TOKEN], memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
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

// ══════════ v6.0.112 健檢2 #7：AI 代理（前端不再持有 Anthropic 金鑰） ══════════
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

// ══════════ v6.0.112 健檢2 #13：伺服器端每日備份（不再只靠擁有者開 App） ══════════
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
