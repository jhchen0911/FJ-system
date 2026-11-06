// 部署：推上 main 後由 .github/workflows/deploy-firebase.yml 自動部署（2026-11-06 起；設定見 docs/自動部署_設定步驟.md）；手動 firebase deploy 仍可用。
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
    // v6.0.182 安全類：不佔每天 6 則、LINE 本月 180 則也照推；自己的防洪＝同一句 30 分鐘 1 則、每天 30 則
    if (b.level === 'safety') {
      const sk = notifyCore.safetyKey(b.text), gapRef = db.ref('fydata/aiNotifySafe/' + sk);
      let prevAt = null;
      const g = await gapRef.transaction((v) => { prevAt = (v && typeof v.at === 'number') ? v.at : null; return notifyCore.safetyGapOk(prevAt, now) ? { at: now } : undefined; });
      if (!g.committed) { await logRef.set({ by: email, at: now, text: b.text, level: 'safety', status: 'dropped', reason: '同一則 30 分鐘內已送過' }); logged = true; res.status(429).json({ error: { message: '同一則安全通知 30 分鐘內已送過' } }); return; }
      const sRef = db.ref('fydata/aiNotifyCount/' + day + '_safety');
      const st = await sRef.transaction((n) => ((n || 0) >= notifyCore.NOTIFY_SAFETY_DAILY ? undefined : (n || 0) + 1));
      const undoGap = () => gapRef.set(prevAt == null ? null : { at: prevAt }).catch(() => null);
      if (!st.committed) { await undoGap(); await logRef.set({ by: email, at: now, text: b.text, level: 'safety', status: 'dropped', reason: '超過安全通知每天 ' + notifyCore.NOTIFY_SAFETY_DAILY + ' 則' }); logged = true; res.status(429).json({ error: { message: '今天的安全通知已達上限（' + notifyCore.NOTIFY_SAFETY_DAILY + ' 則）' } }); return; }
      logText = b.text;
      const deps = lineAdapters.mkDeps(LINE_TOKEN.value());
      const cfg = (await deps.getCfg()) || {};
      const sent = Object.keys(cfg.owners || {}).length ? await lineCore.pushOwners(cfg, deps, b.text) : 0;
      await logRef.set({ by: email, at: now, text: b.text, level: 'safety', status: sent ? 'sent' : 'failed', to: sent }); logged = true;
      if (!sent) { await sRef.transaction((n) => Math.max(0, (n || 1) - 1)).catch(() => null); await undoGap(); res.status(502).json({ error: { message: 'LINE 沒送出（擁有者還沒設定或 LINE 推播失敗）' } }); return; }
      try {   // 防洪紀錄只要留一天
        const old = (await db.ref('fydata/aiNotifySafe').orderByChild('at').endAt(now - 86400000).limitToFirst(50).once('value')).val() || {};
        const up = {}; Object.keys(old).forEach(k => { up[k] = null; }); if (Object.keys(up).length) await db.ref('fydata/aiNotifySafe').update(up);
      } catch (e) { console.error('aiNotify.safePrune', e); }
      res.status(200).json({ ok: true, level: 'safety', text: b.text, today: st.snapshot.val(), limit: notifyCore.NOTIFY_SAFETY_DAILY }); return;
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

// ══════════ 改版第 5 步 5a：雲端每日健檢（後端 28）＋後端待辦節點 ══════════
// 每天 06:40（台北）跑一次：讀 shared／private（應付、付款帳本）與日報照片容量 → fydata/health/latest、fydata/health/days/<日期>（留 30 天），
// 需要人處理的寫成後端待辦 fydata/todo/health/<key>（整個 health 子樹每次重寫：問題解決了待辦就消失）。網頁只能讀這兩個節點（規則）。
// healthRunNow：管理員手動跑一次（驗收、出問題後立刻重查），帶登入憑證呼叫。
const healthCore = require('./ops/health.js');
async function photoStats(db) {
  // 分批讀（每批 40 張；每張是整張 base64 照片，批次太大會吃光記憶體），只算筆數與大小
  const PAGE = 40;
  let count = 0, bytes = 0, last = null;
  for (;;) {
    let q = db.ref('fydata/relay/photos').orderByKey().limitToFirst(PAGE + 1);
    if (last) q = db.ref('fydata/relay/photos').orderByKey().startAt(last).limitToFirst(PAGE + 1);
    const v = (await q.once('value')).val() || {};
    const keys = Object.keys(v).filter((k) => k !== last);
    keys.forEach((k) => { const x = v[k]; count++; bytes += (x && typeof x === 'object' && typeof x.du === 'string') ? x.du.length + 60 : Buffer.byteLength(JSON.stringify(x || '')); });
    if (keys.length < PAGE) break;
    last = keys[keys.length - 1];
  }
  return { count, bytes };
}
async function runHealth() {
  const db = admin.database(), now = Date.now();
  // 只讀用得到的幾塊（不整包讀 shared）；照片統計失敗不影響其他項目
  const val = (p) => db.ref(p).once('value').then((s) => s.val() || {});
  const [quotes, projects, prjTombs, payables, paidLog] = await Promise.all([
    val('fydata/shared/quotes'), val('fydata/shared/projects'), val('fydata/shared/tombs/projects'),
    val('fydata/private/payables'), val('fydata/private/paidLog'),
  ]);
  let photos = { count: 0, bytes: 0 };
  try { photos = await photoStats(db); } catch (e) { console.error('[健檢] 照片統計失敗', e); photos = { count: 0, bytes: 0, err: 1 }; }
  const shared = { quotes, projects, tombs: { projects: prjTombs } };
  const h = healthCore.buildHealth({ shared, priv: { payables, paidLog }, photos, now });
  await db.ref('fydata/health/latest').set(h);
  await db.ref('fydata/health/days/' + h.day).set(h);
  const days = Object.keys((await db.ref('fydata/health/days').once('value')).val() || {});
  for (const d of healthCore.pruneDays(days, 30)) await db.ref('fydata/health/days/' + d).remove();
  await db.ref('fydata/todo/health').set(healthCore.todoFromHealth(h));
  console.log('[健檢] 完成', JSON.stringify(h.counts), '問題', h.warn);
  return h;
}
// ══════════ 改版第 5 步 5b：雲端每日提醒（後端 10／12／13／17／20／24，算法 calc/todo.js 與前端同一份）══════════
async function runRemind() {
  const todosCore = require('./ops/todos.js');   // 用到才載入（calc/ 在部署前才複製進來）
  const db = admin.database(), now = Date.now();
  const val = (p) => db.ref(p).once('value').then((s) => s.val() || {});
  const [quotes, invoices, contracts, customers, params, qHistory, payables, matLedger, quoteSens] = await Promise.all([
    val('fydata/shared/quotes'), val('fydata/shared/invoices'), val('fydata/shared/contracts'), val('fydata/shared/customers'), val('fydata/shared/params'), val('fydata/shared/qHistory'),
    val('fydata/private/payables'), val('fydata/private/matLedger'), val('fydata/private/quoteSens'),
  ]);
  let r;
  try {
    r = todosCore.rtdbSafe(todosCore.buildRemind({ shared: { quotes, invoices, contracts, customers, params, qHistory }, priv: { payables, matLedger, quoteSens }, now }));   // v6.0.174：去掉 undefined／不合法鍵名，RTDB 才寫得進去
    await db.ref('fydata/health/remind').set(r);   // 並行比對期只寫這裡（不寫總覽待辦）
  } catch (e) {
    // v6.0.174：失敗原因寫進 fydata/health/remindErr（資料健檢卡顯示），不只留在 log
    await db.ref('fydata/health/remindErr').set({ at: now, msg: String((e && e.message) || e).slice(0, 300) }).catch((e2) => console.error('runRemind.err', e2));
    throw e;
  }
  await db.ref('fydata/health/remindErr').set(null).catch((e) => console.error('runRemind.clearErr', e));   // 清不掉不算提醒失敗（資料已寫入）
  console.log('[提醒] 完成', JSON.stringify(r.counts));
  return r;
}
exports.dailyTodos = onSchedule({ schedule: '0 7 * * *', timeZone: TZ, region: REGION, memory: '1GiB', timeoutSeconds: 300 }, async () => { await runRemind(); });
exports.dailyHealth = onSchedule({ schedule: '40 6 * * *', timeZone: TZ, region: REGION, memory: '1GiB', timeoutSeconds: 300 }, async () => { await runHealth(); });
exports.healthRunNow = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], memory: '1GiB', timeoutSeconds: 300 }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const role = t.fy || roleOf(t.email, await lists());
    if (role !== 'admin') { res.status(403).json({ error: { message: '只有管理員可以手動執行健檢' } }); return; }
    const h = await runHealth();
    let rc = null, rerr = ''; try { rc = (await runRemind()).counts; } catch (e2) { console.error('healthRunNow.remind', e2); rerr = String((e2 && e2.message) || e2).slice(0, 300); }   // 5b：提醒一起跑
    res.json({ ok: true, at: h.at, warn: h.warn, counts: h.counts, remind: rc, remindErr: rerr });
  } catch (e) { console.error('healthRunNow', e); res.status(500).json({ error: { message: '健檢失敗' } }); }
});

// ══════════ 改版第 5 步 5a：回收筒到期清除（後端 30）══════════
// 每天 03:45（台北）清掉超過保留天數（參數 trashDays，預設 30）的回收筒紀錄；每台裝置開頁也會清，這支確保沒人開也會清。
const trashCore = require('./ops/trash.js');
exports.trashPurge = onSchedule({ schedule: '45 3 * * *', timeZone: TZ, region: REGION }, async () => {
  const db = admin.database(), now = Date.now();
  const days = (await db.ref('fydata/shared/params/trashDays').once('value')).val();
  let n = 0;
  for (const p of ['fydata/shared/trash', 'fydata/private/trashPriv']) {
    // 用 transaction：讀到寫之間有裝置剛刪了東西進回收筒，不會被蓋掉
    let removed = 0;
    await db.ref(p).transaction((v) => {
      if (v == null) { removed = 0; return v; }
      const r = trashCore.purge(v, days, now);
      removed = r.removed;
      if (!r.removed) return undefined;   // 沒東西要清：不寫
      return r.keep.length ? r.keep : null;
    });
    n += removed;
  }
  console.log('[回收筒] 清除', n, '筆（保留', trashCore.trashDays(days), '天）');
});

// ══════════ 改版第 5 步 5c #16 月損益／結案損益快照、#18 結案實際成本匯出（小批次線） ══════════
// monthlySnapshot 每天 07:25（台北）：今年累計寫 fydata/private/pnlSnap/latest（FJ 資料健檢頁跟這台裝置的 _shRptYear 逐值並行比對）；
//   上個月還沒凍結就凍結一份 fydata/private/pnlSnap/<YYYY-MM>（每月 1 日起，留 24 個月；ytd＝凍結當下的整年累計、cum＝截至該月底）；
//   已結案的專案寫 fydata/private/pnlClose/<報價 id>（結案後 90 天內每天重算，補付的抽成、介紹費、最後一期才算得到；之後凍結）。
//   算法全部走 calc 模組（functions/ops/pnl.js 只做資料準備，跟前端 _mgmtData 一行對一行）。#18 結案實際成本：FJ 從 pnlClose 匯出 CSV，只匯出不改資料。
// pnlSnapNow：管理員手動跑一次（驗收、並行比對不一致時重算）。
const pnlCore = require('./ops/pnl.js');
const pnlKey = (k) => String(k).replace(/\./g, '~d~').replace(/#/g, '~h~').replace(/\$/g, '~s~').replace(/\//g, '~sl~').replace(/\[/g, '~lb~').replace(/\]/g, '~rb~');   // 同前端 _fbEncKey
async function runPnl(now) {
  const db = admin.database();
  const val = (p) => db.ref(p).once('value').then((s) => s.val() || {});
  const [quotes, invoices, params, quoteSens, payables, paidLog, expenses, payslips, closed, snaps] = await Promise.all([
    val('fydata/shared/quotes'), val('fydata/shared/invoices'), val('fydata/shared/params'),
    val('fydata/private/quoteSens'), val('fydata/private/payables'), val('fydata/private/paidLog'), val('fydata/private/expenses'), val('fydata/private/payslips'),
    val('fydata/private/pnlClose'), db.ref('fydata/private/pnlSnap').once('value').then((s) => Object.keys(s.val() || {})),
  ]);
  const inp = { quotes, invoices, params, quoteSens, payables, paidLog, expenses, payslips };
  const today = pnlCore.tpeYmd(now), ym = today.slice(0, 7);
  const prev = (() => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); })();
  const latest = pnlCore.monthSnap(inp, ym, now);
  await db.ref('fydata/private/pnlSnap/latest').set(latest);
  if (snaps.indexOf(prev) < 0) await db.ref('fydata/private/pnlSnap/' + prev).set(pnlCore.monthSnap(inp, prev, now));
  for (const k of snaps.filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().slice(0, -24)) await db.ref('fydata/private/pnlSnap/' + k).remove();
  const cs = pnlCore.closeSnaps(inp, pnlCore.frozenIds(closed, now), now, closed), up = {};   // 結案 90 天內每天重算，之後凍結
  Object.keys(cs).forEach((qid) => { up[pnlKey(qid)] = cs[qid]; });
  if (Object.keys(up).length) await db.ref('fydata/private/pnlClose').update(up);
  console.log('[損益快照]', ym, '今年稅前', latest.ytd.pretax, '新結案', Object.keys(cs).length);
  return { ym, pretax: latest.ytd.pretax, closed: Object.keys(cs).length };
}
exports.monthlySnapshot = onSchedule({ schedule: '25 7 * * *', timeZone: TZ, region: REGION, memory: '1GiB', timeoutSeconds: 300 }, async () => {
  const db = admin.database(), now = Date.now();
  try { await runPnl(now); await db.ref('fydata/todo/pnl').set(null); }
  catch (e) {
    console.error('monthlySnapshot', e);   // 審查：失敗寫後端待辦（陳軒早報看得到），不只記 log
    await db.ref('fydata/todo/pnl').set({ fail: { id: 'pnl_fail', src: 'pnl', key: 'fail', urgent: false, text: '雲端損益快照今天沒算成功', sub: '經營報表 › 資料健檢（可按「立即重算」）', go: 'health', at: now } }).catch((e2) => console.error('monthlySnapshot.todo', e2));
  }
});
exports.pnlSnapNow = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], memory: '1GiB', timeoutSeconds: 300 }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const role = t.fy || roleOf(t.email, await lists());
    if (role !== 'admin') { res.status(403).json({ error: { message: '只有管理員可以手動執行' } }); return; }
    res.json(Object.assign({ ok: true }, await runPnl(Date.now())));
  } catch (e) { console.error('pnlSnapNow', e); res.status(500).json({ error: { message: '損益快照失敗' } }); }
});
// ══════════ 改版第 5 步 5d：整體日報（#8）、實際進度回填（#9）、待辦同步 Google 工作表（#21） ══════════
// #8 每天 21:30（台北）：讀已確認的日報（報價的 dailyLogs）→ 豐有內部群組（lineCfg/groups/<gid>.audience='internal'）直接推 LINE；
//    有營造廠的群組（沒設定也算）只建「整體日報」草稿（type dailyOut）給 Lotion 自己轉發。每個群組每天只處理一次（fydata/dailyOut/<日期>/<gid>）。
//    隔天 08:30 補跑前一天：21:30 之後才確認的工地補建草稿、當晚沒東西可推的內部群組補推。LINE 本月額度快用完（≥180）→ 內部群組也改成草稿。
//    還沒確認的工地 → 後端待辦 fydata/todo/daily（工務）；推送失敗 → 緊急待辦（陳軒看了告訴 Lotion）。
// #9 同一支排程接著跑：已確認日報 → fydata/progress/<專案 id>/<工項 key>（只有數量與日期），對不到工項 → fydata/todo/progress（工務）。
// dailyReportNow：管理員手動跑（驗收；只補當天還沒處理過的群組，已推／已建草稿的不重送），可帶 {date:'YYYY-MM-DD'}。
const dailyCore = require('./ops/daily.js');
const progressCore = require('./ops/progress.js');
const gtasksCore = require('./ops/gtasks.js');
// 跟前端 _fbEncKey 一樣（Firebase key 不能有 . # $ / [ ]）
const encKey = (k) => String(k).replace(/\./g, '~d~').replace(/#/g, '~h~').replace(/\$/g, '~s~').replace(/\//g, '~sl~').replace(/\[/g, '~lb~').replace(/\]/g, '~rb~');
async function runProgress(now) {
  const db = admin.database();
  const val = (p) => db.ref(p).once('value').then((s) => s.val() || {});
  const [quotes, projects] = await Promise.all([val('fydata/shared/quotes'), val('fydata/shared/projects')]);
  const r = progressCore.build({ quotes, projects, now });
  const out = {};
  Object.keys(r.byPid).forEach((pid) => { out[encKey(pid)] = r.byPid[pid]; });
  await db.ref('fydata/progress').set(Object.keys(out).length ? out : null);
  await db.ref('fydata/todo/progress').set(progressCore.todoOf(r.mismatch, now));
  console.log('[進度回填] 工項', r.n, '對不到', r.mismatch.length);
  return r;
}
async function runDaily(date, now) {
  const db = admin.database();
  const val = (p) => db.ref(p).once('value').then((s) => s.val() || {});
  const [quotes, cfg, pend, done] = await Promise.all([
    val('fydata/shared/quotes'), val('fydata/lineCfg'),
    db.ref('fydata/drafts').orderByChild('status').equalTo('pending').once('value').then((s) => s.val() || {}),
    val('fydata/dailyOut/' + date),
  ]);
  const p = dailyCore.plan({ quotes, cfg, pending: Object.values(pend), date, now, done });
  const deps = lineAdapters.mkDeps(LINE_TOKEN.value());
  const fails = [];
  let sends = p.sends;
  if (sends.length) {
    const used = await deps.quotaUsed();
    if (notifyCore.monthHold(used)) {   // 額度快用完：內部群組也改草稿，Lotion 自己決定要不要轉
      sends.forEach((s) => p.drafts.push({ id: 'do' + s.gid.replace(/[^\w]/g, '').slice(-10) + date.replace(/-/g, ''), type: 'dailyOut', by: 'line-bot', byName: 'LINE 機器人', at: now, status: 'pending',
        summary: ('整體日報（LINE 本月額度快用完，改草稿）：' + s.label + '　' + date).slice(0, 200), payload: { groupId: s.gid, group: String(s.label).slice(0, 40), qid: '', date, text: s.text, internal: true } }));
      sends = [];
    }
  }
  for (const s of sends) {
    // 審查：先認領（交易：沒有紀錄才寫 sending），兩支排程或手動同時跑也只有一支會推；推成功才改 sent，失敗刪掉認領（下次補推）
    const ref = db.ref('fydata/dailyOut/' + date + '/' + s.gid);
    const cl = await ref.transaction((cur) => (cur ? undefined : { at: now, kind: 'sending', label: String(s.label).slice(0, 40) }));
    if (!cl.committed) continue;
    try { await deps.push(s.gid, s.text); }
    catch (e) { console.error('[整體日報] 推送失敗', s.gid, e && e.message); fails.push(String(s.label || '群組').slice(0, 20)); await ref.remove().catch((e2) => console.error('[整體日報] 認領清除失敗', e2 && e2.message)); continue; }
    await ref.set({ at: now, kind: 'sent', label: String(s.label).slice(0, 40) }).catch((e) => console.error('[整體日報] 已推但紀錄失敗', s.gid, e && e.message));   // 已推出：紀錄失敗也不刪認領（寧可少推不重推）
  }
  for (const d of p.drafts) {
    await deps.createDraft(d);   // 同一群組同一天只建一次
    await db.ref('fydata/dailyOut/' + date + '/' + d.payload.groupId).set({ at: now, kind: 'draft', draft: d.id, label: String(d.payload.group || '').slice(0, 40) });
  }
  // 待辦依日期分 key（審查：補跑前一天不會蓋掉今天的）；同一天沒問題了就清掉，超過 2 天的一併清
  const dk = date.replace(/-/g, ''), tnew = Object.assign({}, p.todo, dailyCore.failTodo(fails, date, now));
  const tcur = (await db.ref('fydata/todo/daily').once('value')).val() || {}, tup = {};
  tup['unconf_' + dk] = tnew['unconf_' + dk] || null;
  tup['fail_' + dk] = fails.length ? tnew['fail_' + dk] : (sends.length ? null : (tcur['fail_' + dk] || null));   // 這次沒有要推的群組：保留之前的失敗紀錄（等補推成功才清）
  Object.keys(tcur).forEach((k) => { const m = k.match(/_(\d{8})$/); if (m && m[1] < lineCore.addDays(date, -2).replace(/-/g, '')) tup[k] = null; });
  await db.ref('fydata/todo/daily').update(tup);
  // 30 天前的發送紀錄清掉
  const days = Object.keys((await db.ref('fydata/dailyOut').once('value')).val() || {}).sort();
  for (const d of days) if (d < lineCore.addDays(date, -30)) await db.ref('fydata/dailyOut/' + d).remove();
  console.log('[整體日報]', date, '確認', p.confirmed.length, '推', sends.length - fails.length, '草稿', p.drafts.length, '失敗', fails.length);
  return { date, confirmed: p.confirmed.length, unconf: p.unconf.length, sent: sends.length - fails.length, drafts: p.drafts.length, fails: fails.length };
}
exports.dailyReport = onSchedule({ schedule: '30 21 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN], memory: '1GiB', timeoutSeconds: 300 }, async () => {
  const now = Date.now();
  try { await runDaily(lineCore.tpeDate(now), now); } catch (e) { console.error('dailyReport', e); }
  try { await runProgress(now); } catch (e) { console.error('dailyReport.progress', e); }
});
exports.dailyReportCatchup = onSchedule({ schedule: '30 8 * * *', timeZone: TZ, region: REGION, secrets: [LINE_TOKEN], memory: '1GiB', timeoutSeconds: 300 }, async () => {
  const now = Date.now();
  try { await runDaily(lineCore.addDays(lineCore.tpeDate(now), -1), now); } catch (e) { console.error('dailyReportCatchup', e); }
  try { await runProgress(now); } catch (e) { console.error('dailyReportCatchup.progress', e); }
});
exports.dailyReportNow = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], secrets: [LINE_TOKEN], memory: '1GiB', timeoutSeconds: 300 }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    const role = t.fy || roleOf(t.email, await lists());
    if (role !== 'admin') { res.status(403).json({ error: { message: '只有管理員可以手動執行' } }); return; }
    const now = Date.now(), today = lineCore.tpeDate(now);
    let date = String((req.body && req.body.date) || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < lineCore.addDays(today, -7)) { res.status(400).json({ error: { message: '日期只能是 7 天內' } }); return; }
    let r = {}, pr = null, err = '';
    try { r = await runDaily(date, now); } catch (e) { console.error('dailyReportNow.daily', e); err = '整體日報失敗'; }
    try { pr = await runProgress(now); } catch (e) { console.error('dailyReportNow.progress', e); err = err ? err + '、進度回填失敗' : '進度回填失敗'; }
    if (err) { res.status(500).json({ error: { message: err } }); return; }
    res.json(Object.assign({ ok: true, progress: pr.n, mismatch: pr.mismatch.length }, r));
  } catch (e) { console.error('dailyReportNow', e); res.status(500).json({ error: { message: '整體日報失敗' } }); }
});

// #21 待辦同步 Google 工作表（Lotion 11/04 選 A：雲端直接建；Lotion 一次 OAuth 授權，步驟見 docs/待辦同步Google工作表_授權操作卡.md）
// 金鑰：`firebase functions:secrets:set GTASKS_CLIENT_ID`、`GTASKS_CLIENT_SECRET`（Google Cloud 主控台建的 OAuth 用戶端；不進程式碼、不進 Git、不經對話）。
// refresh token 存 fydata/gtasks/auth（規則讀寫全 false，只有雲端程式碰得到）；給 FJ 看的狀態寫 fydata/gtasksStatus（管理員可讀，不含金鑰）。
// 觸發：fydata/todo 有變動就同步；另外每小時對一次帳（觸發漏掉、Google 暫時失敗都會補上）。
const GT_ID = defineSecret('GTASKS_CLIENT_ID');
const GT_SECRET = defineSecret('GTASKS_CLIENT_SECRET');
const crypto = require('crypto');
function gtRedirect() {
  let pid = process.env.GCLOUD_PROJECT;
  if (!pid) { try { pid = JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId; } catch (e) { console.error('gtRedirect', e && e.message); } }
  return 'https://' + REGION + '-' + pid + '.cloudfunctions.net/gtasksAuthCallback';
}
async function gtStatus(db, patch) { await db.ref('fydata/gtasksStatus').update(Object.assign({ at: Date.now() }, patch)); }
async function runGtasks() {
  const db = admin.database(), now = Date.now(), day = lineCore.tpeDate(now);
  const lock = await db.ref('fydata/gtasks/lock').transaction((cur) => (cur && now - cur < 120000 ? undefined : now));
  if (!lock.committed) { await db.ref('fydata/gtasks/dirty').set(true); return { busy: true }; }   // 正在跑：跑完會再對一次
  let last = null;
  try {
    for (let round = 0; round < 3; round++) {
      await db.ref('fydata/gtasks/dirty').set(null);
      const g = (await db.ref('fydata/gtasks').once('value')).val() || {};
      if (!g.auth || !g.auth.refresh) { await gtStatus(db, { authed: false }); return { authed: false }; }
      const todo = (await db.ref('fydata/todo').once('value')).val() || {};
      const api = gtasksCore.client({ fetch, clientId: GT_ID.value(), clientSecret: GT_SECRET.value(), refresh: g.auth.refresh });
      let r;
      try {
        r = await gtasksCore.run({ api, todo, map: g.map || {}, listId: g.listId || '', madeToday: (g.count && g.count[day]) || 0, now });
      } catch (e) {
        r = { listId: g.listId || '', map: g.map || {}, made: 0, done: 0, deferred: 0, errs: [String(e && e.message || e)], authLost: /授權失效/.test(String(e && e.message)) };
      }
      const up = { listId: r.listId || null, map: Object.keys(r.map).length ? r.map : null };
      up['count/' + day] = ((g.count && g.count[day]) || 0) + r.made;
      Object.keys(g.count || {}).forEach((d) => { if (d < lineCore.addDays(day, -7)) up['count/' + d] = null; });
      await db.ref('fydata/gtasks').update(up);
      const ft = gtasksCore.failTodo(r.errs, now);
      const cur = (await db.ref('fydata/todo/gtasks').once('value')).val();
      if (JSON.stringify(cur ? Object.keys(cur) : []) !== JSON.stringify(ft ? Object.keys(ft) : []) || (ft && cur && cur.fail && cur.fail.text !== ft.fail.text)) await db.ref('fydata/todo/gtasks').set(ft);
      await gtStatus(db, { authed: !r.authLost, lastRun: now, made: r.made, done: r.done, deferred: r.deferred, errs: r.errs.length, lastErr: r.errs.length ? String(r.errs[0]).slice(0, 160) : null, today: up['count/' + day] });
      last = r;
      if (!(await db.ref('fydata/gtasks/dirty').once('value')).val()) break;
    }
  } finally { await db.ref('fydata/gtasks/lock').set(null); }
  return last ? { made: last.made, done: last.done, errs: last.errs.length } : {};
}
exports.gtasksSync = onValueWritten({ ref: '/fydata/todo', region: REGION, secrets: [GT_ID, GT_SECRET] }, async () => { try { await runGtasks(); } catch (e) { console.error('gtasksSync', e); } });
exports.gtasksSyncHourly = onSchedule({ schedule: '20 * * * *', timeZone: TZ, region: REGION, secrets: [GT_ID, GT_SECRET] }, async () => { try { await runGtasks(); } catch (e) { console.error('gtasksSyncHourly', e); } });
// 授權第一步：FJ「授權 Google 工作表」（只有 Lotion 的帳號）→ 回傳 Google 同意畫面網址
exports.gtasksAuthStart = onRequest({ region: REGION, cors: ['https://jhchen0911.github.io'], secrets: [GT_ID] }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: { message: '只接受 POST' } }); return; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: { message: '需要登入' } }); return; }
    const t = await admin.auth().verifyIdToken(m[1]);
    if (String(t.email || '').toLowerCase() !== OWNER) { res.status(403).json({ error: { message: '只有 Lotion 的帳號可以授權' } }); return; }
    const s = crypto.randomBytes(24).toString('hex');
    await admin.database().ref('fydata/gtasks/state').set({ s, at: Date.now() });
    res.json({ ok: true, url: gtasksCore.authUrl(GT_ID.value(), gtRedirect(), s) });
  } catch (e) { console.error('gtasksAuthStart', e); res.status(500).json({ error: { message: '授權服務錯誤' } }); }
});
// 授權第二步：Google 同意後導回這裡（網址要登記在 OAuth 用戶端的「已授權的重新導向 URI」）
exports.gtasksAuthCallback = onRequest({ region: REGION, secrets: [GT_ID, GT_SECRET] }, async (req, res) => {
  const page = (ok, msg) => res.status(ok ? 200 : 400).set('Content-Type', 'text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 工作表授權</title><body style="font-family:sans-serif;padding:24px;line-height:1.7"><h3>' + (ok ? '✅ 授權完成' : '⚠️ 授權沒有完成') + '</h3><p>' + msg + '</p><p>可以關閉這個分頁，回到 FJ。</p></body>');
  try {
    const db = admin.database(), now = Date.now();
    const code = String(req.query.code || ''), state = String(req.query.state || '');
    if (req.query.error) { page(false, '你在 Google 畫面按了取消或沒有同意（' + String(req.query.error).replace(/[^\w-]/g, '').slice(0, 40) + '）。'); return; }
    const saved = (await db.ref('fydata/gtasks/state').once('value')).val();
    if (!code || !gtasksCore.stateOk(saved, state, now)) { page(false, '授權連結過期或不是從 FJ 按的，請回 FJ 重按一次「授權 Google 工作表」。'); return; }
    await db.ref('fydata/gtasks/state').set(null);
    const refresh = await gtasksCore.exchange(fetch, GT_ID.value(), GT_SECRET.value(), gtRedirect(), code);
    await db.ref('fydata/gtasks/auth').set({ refresh, at: now });
    await gtStatus(db, { authed: true, authAt: now, lastErr: null });
    try { await runGtasks(); } catch (e) { console.error('gtasksAuthCallback.sync', e); }   // 回應前先同步一次（回應後的背景工作可能被凍結）
    page(true, '之後 FJ 的後端待辦會自動出現在 Google 工作表的「' + gtasksCore.LIST_TITLE + '」清單（每天最多新建 ' + gtasksCore.DAILY_LIMIT + ' 筆），處理好會自動打勾。');
  } catch (e) { console.error('gtasksAuthCallback', e); page(false, '換取授權失敗，請回 FJ 重按一次。'); }
});
