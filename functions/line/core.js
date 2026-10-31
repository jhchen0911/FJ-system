// 豐有 LINE 機器人（批次 F）核心邏輯：不直接碰 Firebase／LINE，全部透過 deps 注入，方便單元測試（functions/test/line.test.js）。
// 規格：my-agent 400_Project/line-bot/README.md（2026-10-21 第二版：Firebase Cloud Functions）
//   ① 轉傳歸檔：只收「擁有者」（RTDB fydata/lineCfg/owners 名單內的 LINE userId）一對一傳來的檔案／照片／文字 → Storage line/inbox/<日期>/ ＋ fydata/lineInbox 紀錄
//   ② 現場追加：已綁定工程的工地群組，出現追加關鍵字或「#追加」→ FJ 草稿（fydata/drafts，type:'addon'），前後 10 分鐘的照片附上
//   ③ 施工日報：群組白天的照片與文字記到 fydata/lineLog；17:30 問三句（固定文字）；20:00 整理成 FJ 日報草稿（type:'dailyLog'）；
//      隔天 08:00 前沒回 → 群組提醒一次；連兩天沒回 → 通知擁有者；回答出現事故前兆字 → 立刻通知擁有者
//   推播：FJ 或陳軒寫 fydata/linePush/<id>（status:'pending'）→ 推給擁有者，成功改 status:'sent'
// 原則：寫進 FJ 的一律是草稿（要人在 FJ 按確認）；機器人在群組主動發的文字只用 fydata/lineCfg/texts 裡 Lotion 定稿的固定句子。
'use strict';
const crypto = require('crypto');

const ADDON_RE = /(追加|多做|順便|加做|變更)/;
const ADDON_TAG_RE = /^\s*#\s*追加\s*/;
const ALARM_WORDS = ['裂', '變形', '湧砂', '沉陷', '傾斜'];
const PHOTO_WINDOW_MS = 10 * 60 * 1000;
const NEG_RE = /(沒有|沒|没|無|无|未|不|並無|并无|非)/;   // 關鍵字前 3 個字內有否定詞 → 不算（「沒有裂縫」「無變形」「不用追加」）
const PENDING_MAX = 50;                                   // 待綁定名單上限：陌生人灌不爆設定
const MAX_FILE_BYTES = 50 * 1024 * 1024;                  // 超過 50MB 的影片／檔案不存，只記一筆

const DEFAULT_TEXTS = {
  inboxAck: '收到，{n} 個檔案，歸到哪一案？',
  daily3: '今天辛苦了，麻煩回三件事：\n1. 今天做了哪些？（工項、數量）\n2. 幾個人、什麼機具？\n3. 有沒有問題、等待或追加？',
  remind: '昨天的施工日報還沒回，麻煩補一下三件事，謝謝。',
  alarm: '{site}工地群組出現「{word}」，請判斷是否停工。',
  noReply2: '{site}工地群組連兩天沒有回施工日報。',
  dailyCo: '今天辛苦了，請照下面格式回報（一個工地一段，可以貼好幾段）：\n【工地】地名\n【今天】\n【明天】\n【問題】',
};

function verifySignature(secret, rawBody, signature) {
  if (!secret || !signature || rawBody == null) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(mac), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 台北日期（YYYY-MM-DD）與時間
function tpeDate(ts) {
  const d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
}
function textsOf(cfg) { return Object.assign({}, DEFAULT_TEXTS, (cfg && cfg.texts) || {}); }

// 找到「沒被否定」的關鍵字：前 3 個字內有否定詞就跳過，同一句後面若再出現且沒被否定仍算
function _hitNotNegated(t, word) {
  let i = t.indexOf(word);
  while (i >= 0) {
    if (!NEG_RE.test(t.slice(Math.max(0, i - 3), i))) return true;
    i = t.indexOf(word, i + word.length);
  }
  return false;
}
function isAddon(text) {
  const t = String(text || '');
  if (ADDON_TAG_RE.test(t)) return true;
  return ['追加', '多做', '順便', '加做', '變更'].some(w => _hitNotNegated(t, w));
}
function alarmWord(text) { const t = String(text || ''); return ALARM_WORDS.find(w => _hitNotNegated(t, w)) || ''; }
// 「#追加 鋼板樁 12 支」→ {qty:12, unit:'支'}；沒寫數量回 null
function parseQty(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(支|根|米|m|M|公尺|式|處|片|組|天|台|車|噸|t)/);
  return m ? { qty: parseFloat(m[1]), unit: m[2] } : null;
}
function isOwner(cfg, userId) { return !!(userId && cfg && cfg.owners && cfg.owners[userId]); }
function groupOf(cfg, groupId) { const g = groupId && cfg && cfg.groups && cfg.groups[groupId]; return g && g.qid ? g : null; }
function siteName(g) { return (g && (g.name || g.qName)) || '（未命名）'; }
// ── 公司大群組（v6.0.119 批次 I）：一個群組多個工地，工務用固定格式回報，依【工地】地名對到 FJ 專案 ──
function coGroupOf(cfg, groupId) { const g = groupId && cfg && cfg.groups && cfg.groups[groupId]; return g && g.mode === 'company' ? g : null; }
const CO_TAGS = { '工地': 'site', '今天': 'today', '明天': 'tomorrow', '問題': 'issue' };
// 「【工地】內湖\n【今天】打樁 12 支\n【明天】…\n【問題】無」→ [{site, today, tomorrow, issue}]；一則訊息可有多段【工地】
function parseCoReport(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (!/【\s*工地\s*】/.test(t)) return [];
  const out = []; let cur = null, key = '';
  const re = /【\s*(工地|今天|明天|問題)\s*】/g; let m; const segs = [];
  while ((m = re.exec(t))) { segs.push({ tag: m[1], start: m.index, end: re.lastIndex }); }
  segs.forEach((g, i) => {
    const val = t.slice(g.end, i + 1 < segs.length ? segs[i + 1].start : t.length).trim();
    key = CO_TAGS[g.tag];
    if (key === 'site') { cur = { site: val.split('\n')[0].trim().slice(0, 60), today: '', tomorrow: '', issue: '' }; out.push(cur); const rest = val.split('\n').slice(1).join('\n').trim(); if (rest) cur.today = rest.slice(0, 1000); }
    else if (cur) cur[key] = (cur[key] ? cur[key] + '\n' : '') + val.slice(0, 1000);
  });
  return out.filter(b => b.site);
}
const _nrmSite = (x) => String(x || '').replace(/[\s()（）［］\[\]「」『』\-－_／/、，,.。]/g, '').toLowerCase();
// 地名對專案：專案名稱（格式「（業主）地名工程名稱」）含地名、或地名含專案短名；只有唯一一案對得上才算，否則待分類
function matchSite(sites, site) {
  const a = _nrmSite(site); if (a.length < 2) return '';
  // 先看手動對過的地名（keys 完全相同），再看名稱包含
  const exact = Object.keys(sites || {}).filter(qid => (Array.isArray((sites[qid] || {}).keys) ? sites[qid].keys : []).some(k => _nrmSite(k) === a));
  if (exact.length === 1) return exact[0];
  const hits = Object.keys(sites || {}).filter(qid => {
    const s = sites[qid] || {}; const names = [s.name].concat(Array.isArray(s.keys) ? s.keys : []).map(_nrmSite).filter(n => n.length >= 2);
    return names.some(n => n.indexOf(a) >= 0 || a.indexOf(n) >= 0);
  });
  return hits.length === 1 ? hits[0] : '';
}
function coBlockText(b) { return ['【今天】' + (b.today || ''), '【明天】' + (b.tomorrow || ''), '【問題】' + (b.issue || '')].join('\n'); }
function extOf(msg) {
  if (msg.type === 'image') return 'jpg';
  if (msg.type === 'video') return 'mp4';
  if (msg.type === 'audio') return 'm4a';
  const n = String(msg.fileName || ''); const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1).replace(/[^\w]/g, '').slice(0, 8) || 'bin' : 'bin';
}
function safeName(n) { return String(n || '').replace(/[\\/#?%*:|"<>\s]/g, '_').slice(0, 80); }
const MEDIA = { image: 1, video: 1, audio: 1, file: 1 };

// ── webhook：逐筆事件 ──
// deps: getCfg() / fetchContent(msgId) → {buf, contentType} / putFile(path, buf, contentType) / dbSet(path, val) / dbPush(path, val) → key
//       dbGet(path) / reply(token, text) / push(to, text) / createDraft(rec) / findAddonDrafts(groupId, sinceTs) / appendDraftPhotos(id, paths) / log(...)
async function handleEvents(events, deps) {
  const cfg = (await deps.getCfg()) || {};
  const T = textsOf(cfg);
  const out = [];
  for (const ev of events || []) {
    try { out.push(await handleEvent(ev, cfg, T, deps)); } catch (e) {
      (deps.log || console.error)('line.handleEvent', e);
      out.push({ ev: ev && ev.type, err: String(e && e.message || e) });
      // 失敗的事件留一筆紀錄（webhook 一律回 200，不記就永久遺失）
      try {
        const m = (ev && ev.message) || {};
        await deps.dbSet('fydata/lineErr/' + Date.now() + '_' + String(m.id || 'x').replace(/[^\w]/g, '').slice(0, 24), { at: Date.now(), type: ev && ev.type, msgType: m.type || '', msgId: m.id || '', src: (ev && ev.source && ev.source.type) || '', err: String(e && e.message || e).slice(0, 300) });
      } catch (e2) { (deps.log || console.error)('line.lineErr', e2); }
    }
  }
  return out;
}
async function safePush(deps, to, text) {
  try { await deps.push(to, text); return true; } catch (e) { (deps.log || console.error)('line.push', to, e); return false; }
}
function _pendCount(cfg, kind) { return Object.keys((cfg && cfg.pending && cfg.pending[kind]) || {}).length; }
async function _addPending(cfg, deps, kind, id, val) {
  const cur = cfg && cfg.pending && cfg.pending[kind];
  if (!(cur && cur[id]) && _pendCount(cfg, kind) >= PENDING_MAX) return false;
  await deps.dbSet('fydata/lineCfg/pending/' + kind + '/' + id, val);
  return true;
}

async function handleEvent(ev, cfg, T, deps) {
  const src = ev.source || {}, now = ev.timestamp || Date.now(), date = tpeDate(now);
  // 加入群組：記到待綁定清單，不主動發話（群組發話只用定稿句子）
  if (ev.type === 'join' && src.type === 'group') {
    await _addPending(cfg, deps, 'groups', src.groupId, { at: now });
    return { kind: 'join', groupId: src.groupId };
  }
  if (ev.type !== 'message' || !ev.message) return { kind: 'skip', type: ev.type };
  const msg = ev.message;
  if (!/^\w{1,40}$/.test(String(msg.id || ''))) return { kind: 'skip', reason: 'badId' };

  // ① 一對一：只收擁有者
  if (src.type === 'user') {
    if (!isOwner(cfg, src.userId)) {
      await _addPending(cfg, deps, 'users', src.userId, { at: now, text: msg.type === 'text' ? String(msg.text || '').slice(0, 40) : msg.type });
      return { kind: 'unknownUser', userId: src.userId };
    }
    // webhook 重送：同一則訊息已處理過就略過（不重複回覆）
    if (await deps.dbGet('fydata/lineInbox/' + msg.id + '/id')) return { kind: 'dup' };
    if (MEDIA[msg.type]) {
      if (msg.fileSize > MAX_FILE_BYTES) {
        await deps.dbSet('fydata/lineInbox/' + msg.id, { id: msg.id, at: now, date, from: src.userId, type: msg.type, fileName: msg.fileName || '', size: msg.fileSize, status: 'tooBig' });
        return { kind: 'tooBig' };
      }
      const c = await deps.fetchContent(msg.id);
      if (c.buf && c.buf.length > MAX_FILE_BYTES) {
        await deps.dbSet('fydata/lineInbox/' + msg.id, { id: msg.id, at: now, date, from: src.userId, type: msg.type, fileName: msg.fileName || '', size: c.buf.length, status: 'tooBig' });
        return { kind: 'tooBig' };
      }
      const name = msg.type === 'file' ? safeName(msg.fileName) : (msg.id + '.' + extOf(msg));
      const path = 'line/inbox/' + date + '/' + msg.id + '_' + name;
      await deps.putFile(path, c.buf, c.contentType || 'application/octet-stream');
      await deps.dbSet('fydata/lineInbox/' + msg.id, { id: msg.id, at: now, date, from: src.userId, type: msg.type, fileName: msg.fileName || name, size: (c.buf && c.buf.length) || 0, path, status: 'new' });
      if (ev.replyToken) { try { await deps.reply(ev.replyToken, fill(T.inboxAck, { n: 1 })); } catch (e) { (deps.log || console.error)('line.reply', e); } }
      return { kind: 'inboxFile', path };
    }
    if (msg.type === 'text') {
      // 文字＝附帶說明（例：「稻田 內湖興中路」），掛到最近 10 分鐘內收到的檔案
      await deps.dbSet('fydata/lineInbox/' + msg.id, { id: msg.id, at: now, date, from: src.userId, type: 'text', text: String(msg.text || '').slice(0, 1000), status: 'new' });
      return { kind: 'inboxText' };
    }
    return { kind: 'skip', type: msg.type };
  }

  // ②③ 群組
  if (src.type === 'group') {
    const co = coGroupOf(cfg, src.groupId);
    if (co) return await handleCoGroup(ev, msg, src, now, date, cfg, T, deps);
    const g = groupOf(cfg, src.groupId);
    if (!g) { await _addPending(cfg, deps, 'groups', src.groupId, { at: now, lastAt: now }); return { kind: 'unboundGroup', groupId: src.groupId }; }
    const base = 'fydata/lineLog/' + src.groupId + '/' + date + '/' + msg.id;
    if (await deps.dbGet(base + '/id')) return { kind: 'dup' };   // webhook 重送：不重複警報、不重複附照片
    let rec = { id: msg.id, at: now, user: src.userId || '', type: msg.type };
    if (MEDIA[msg.type]) {
      if (msg.fileSize > MAX_FILE_BYTES) { await deps.dbSet(base, Object.assign(rec, { status: 'tooBig', size: msg.fileSize })); return { kind: 'tooBig' }; }
      const c = await deps.fetchContent(msg.id);
      if (c.buf && c.buf.length > MAX_FILE_BYTES) { await deps.dbSet(base, Object.assign(rec, { status: 'tooBig', size: c.buf.length })); return { kind: 'tooBig' }; }
      const path = 'line/group/' + src.groupId + '/' + date + '/' + msg.id + '.' + extOf(msg);
      await deps.putFile(path, c.buf, c.contentType || 'application/octet-stream');
      rec.path = path;
      await deps.dbSet(base, rec);
      // 追加前後 10 分鐘的照片：附到最近的追加草稿
      if (msg.type === 'image') {
        const ds = (await deps.findAddonDrafts(src.groupId, now - PHOTO_WINDOW_MS)) || [];
        for (const d of ds) await deps.appendDraftPhotos(d.id, [path]);
      }
      return { kind: 'groupMedia', path };
    }
    if (msg.type !== 'text') return { kind: 'skip', type: msg.type };
    const text = String(msg.text || '').slice(0, 2000);
    rec.text = text;
    await deps.dbSet(base, rec);
    const res = { kind: 'groupText' };
    const w = alarmWord(text);
    if (w) { await pushOwners(cfg, deps, fill(T.alarm, { site: siteName(g), word: w })); res.alarm = w; }
    if (isAddon(text)) {
      // 前 10 分鐘的照片一起附上
      const before = ((await deps.dbGet('fydata/lineLog/' + src.groupId + '/' + date)) || {});
      const photos = Object.keys(before).map(k => before[k]).filter(r => r && r.path && r.type === 'image' && r.at >= now - PHOTO_WINDOW_MS && r.at <= now).map(r => r.path);
      const q = parseQty(text);
      const id = 'dl' + msg.id;
      await deps.createDraft({ id, type: 'addon', by: 'line-bot', byName: 'LINE 機器人', at: now, status: 'pending',
        summary: ('現場追加：' + siteName(g) + '　' + text.replace(ADDON_TAG_RE, '')).slice(0, 200),
        payload: { qid: g.qid, groupId: src.groupId, date, text, user: src.userId || '', qty: q ? q.qty : null, unit: q ? q.unit : '', photos, msgId: msg.id } });
      res.addon = id;
    }
    return res;
  }
  return { kind: 'skip', src: src.type };
}

// 公司大群組：所有訊息照樣記 lineLog；有【工地】格式的文字逐段存 fydata/lineCo/<群組>/<日期>/<訊息id>_<段>，
// 同一人前後 10 分鐘的照片掛到他這則回報（只有一段時才掛，免得放錯工地）；警報、追加照工地群組的規則，工地名用地名
async function handleCoGroup(ev, msg, src, now, date, cfg, T, deps) {
  const gid = src.groupId, user = src.userId || '';
  const base = 'fydata/lineLog/' + gid + '/' + date + '/' + msg.id;
  if (await deps.dbGet(base + '/id')) return { kind: 'dup' };
  const rec = { id: msg.id, at: now, user, type: msg.type };
  const coPath = 'fydata/lineCo/' + gid + '/' + date;
  if (MEDIA[msg.type]) {
    if (msg.fileSize > MAX_FILE_BYTES) { await deps.dbSet(base, Object.assign(rec, { status: 'tooBig', size: msg.fileSize })); return { kind: 'tooBig' }; }
    const c = await deps.fetchContent(msg.id);
    if (c.buf && c.buf.length > MAX_FILE_BYTES) { await deps.dbSet(base, Object.assign(rec, { status: 'tooBig', size: c.buf.length })); return { kind: 'tooBig' }; }
    const path = 'line/group/' + gid + '/' + date + '/' + msg.id + '.' + extOf(msg);
    await deps.putFile(path, c.buf, c.contentType || 'application/octet-stream');
    rec.path = path; await deps.dbSet(base, rec);
    if (msg.type === 'image') {
      // 這個人 10 分鐘內的回報只有一段 → 掛上去
      const day = (await deps.dbGet(coPath)) || {};
      const mine = Object.keys(day).map(k => Object.assign({ key: k }, day[k])).filter(r => r && r.user === user && r.at >= now - PHOTO_WINDOW_MS && r.at <= now + PHOTO_WINDOW_MS);
      const msgs = {}; mine.forEach(r => { (msgs[r.msgId] = msgs[r.msgId] || []).push(r); });
      const lastMsg = Object.keys(msgs).sort((x, y) => (msgs[y][0].at || 0) - (msgs[x][0].at || 0))[0];
      if (lastMsg && msgs[lastMsg].length === 1) await deps.dbSet(coPath + '/' + msgs[lastMsg][0].key + '/photos/' + msg.id, path);
    }
    return { kind: 'coMedia', path };
  }
  if (msg.type !== 'text') return { kind: 'skip', type: msg.type };
  const text = String(msg.text || '').slice(0, 4000);
  rec.text = text; await deps.dbSet(base, rec);
  const blocks = parseCoReport(text);
  const res = { kind: 'coText', blocks: blocks.length };
  if (!blocks.length) {
    // 沒用格式：照樣看警報字（工地名寫群組名）
    const w0 = alarmWord(text);
    if (w0) { await pushOwners(cfg, deps, fill(T.alarm, { site: siteName(cfg.groups[gid]), word: w0 })); res.alarm = w0; }
    return res;
  }
  // 這則之前 10 分鐘同一人傳的照片：只有一段時一起掛
  let prevPhotos = [];
  if (blocks.length === 1) {
    const logs = (await deps.dbGet('fydata/lineLog/' + gid + '/' + date)) || {};
    prevPhotos = Object.keys(logs).map(k => logs[k]).filter(r => r && r.path && r.type === 'image' && r.user === user && r.at >= now - PHOTO_WINDOW_MS && r.at <= now);
  }
  res.qids = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], qid = matchSite(cfg.sites, b.site);
    const photos = {}; prevPhotos.forEach(r => { photos[r.id] = r.path; });
    await deps.dbSet(coPath + '/' + msg.id + '_' + i, { at: now, user, msgId: msg.id, site: b.site, qid, today: b.today, tomorrow: b.tomorrow, issue: b.issue, photos });
    res.qids.push(qid);
    const all = [b.today, b.tomorrow, b.issue].join('\n');
    const w = alarmWord(all);
    if (w) { await pushOwners(cfg, deps, fill(T.alarm, { site: b.site, word: w })); res.alarm = w; }
    if (isAddon(all)) {
      const q = parseQty(all);
      await deps.createDraft({ id: 'dl' + msg.id + '_' + i, type: 'addon', by: 'line-bot', byName: 'LINE 機器人', at: now, status: 'pending',
        summary: ('現場追加：' + b.site + (qid ? '' : '（待分類）') + '　' + (b.issue || b.today)).slice(0, 200),
        payload: { qid, site: b.site, unmatched: !qid, groupId: gid, date, text: coBlockText(b), user, qty: q ? q.qty : null, unit: q ? q.unit : '', photos: Object.keys(photos).map(k => photos[k]), msgId: msg.id } });
    }
  }
  return res;
}

async function pushOwners(cfg, deps, text) {
  const ids = Object.keys((cfg && cfg.owners) || {});
  let ok = 0;
  for (const id of ids) if (await safePush(deps, id, text)) ok++;   // 一位推不到，其他人照推
  return ok;
}

// ── 17:30 問三句：已綁定且開啟日報的群組 ──
async function dailyAsk(deps, now) {
  const cfg = (await deps.getCfg()) || {}; const T = textsOf(cfg); const date = tpeDate(now);
  let n = 0;
  for (const gid of Object.keys(cfg.groups || {})) {
    const g = cfg.groups[gid]; if (!g || (!g.qid && g.mode !== 'company') || g.daily === false) continue;
    if (await deps.dbGet('fydata/lineDaily/' + gid + '/' + date + '/askedAt')) continue;   // 排程重跑：今天問過就不再問
    if (!(await safePush(deps, gid, g.mode === 'company' ? T.dailyCo : T.daily3))) continue;   // 這個群組推不到（例如機器人被移出），其他群組照問
    await deps.dbSet('fydata/lineDaily/' + gid + '/' + date + '/askedAt', now || Date.now());
    n++;
  }
  return n;
}

// 一個群組某天的回覆（問三句之後的文字＋整天的照片）
function _dayContent(logs, askedAt) {
  const L = Object.keys(logs || {}).map(k => logs[k]).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
  const texts = L.filter(r => r.type === 'text' && r.text && (!askedAt || r.at >= askedAt)).map(r => r.text);
  const photos = L.filter(r => r.type === 'image' && r.path).map(r => r.path);
  const allTexts = L.filter(r => r.type === 'text' && r.text).map(r => r.text);
  return { texts, photos, allTexts };
}

// ── 20:00 整理成日報草稿 ──
async function dailyCompile(deps, now) {
  const cfg = (await deps.getCfg()) || {}; const date = tpeDate(now);
  let n = 0;
  for (const gid of Object.keys(cfg.groups || {})) {
    const g = cfg.groups[gid];
    if (g && g.mode === 'company') { n += await coCompile(deps, cfg, gid, date, now); continue; }
    if (!g || !g.qid || g.daily === false) continue;
    const logs = (await deps.dbGet('fydata/lineLog/' + gid + '/' + date)) || {};
    const day = (await deps.dbGet('fydata/lineDaily/' + gid + '/' + date)) || {};
    const c = _dayContent(logs, day.askedAt);
    const replied = !!day.askedAt && c.texts.length > 0;   // 當天沒問（17:30 排程沒跑）就不算回了
    await deps.dbSet('fydata/lineDaily/' + gid + '/' + date + '/replied', replied);
    if (!replied && !c.photos.length && !c.allTexts.length) continue;
    await deps.createDraft({ id: 'dd' + gid.slice(-8) + date.replace(/-/g, ''), type: 'dailyLog', by: 'line-bot', byName: 'LINE 機器人', at: now || Date.now(), status: 'pending',
      summary: ('施工日報：' + siteName(g) + '　' + date + (replied ? '' : '（尚未回三句）')).slice(0, 200),
      payload: { qid: g.qid, groupId: gid, date, answers: day.askedAt ? c.texts : [], dayTexts: c.allTexts.slice(-30), photos: c.photos.slice(0, 20), replied } });
    n++;
  }
  return n;
}

// 公司大群組 20:00：同一工地當天所有回報合成一份日報草稿；對不到工地的每段各一份「待分類」草稿（在 FJ 選工程再確認）
async function coCompile(deps, cfg, gid, date, now) {
  const day = (await deps.dbGet('fydata/lineCo/' + gid + '/' + date)) || {};
  const rows = Object.keys(day).map(k => Object.assign({ key: k }, day[k])).filter(r => r && r.site).sort((a, b) => (a.at || 0) - (b.at || 0));
  const by = {};
  rows.forEach(r => { const k = r.qid || ('?' + r.key); (by[k] = by[k] || []).push(r); });
  let n = 0;
  for (const k of Object.keys(by)) {
    const L = by[k], qid = L[0].qid || '';
    const photos = []; L.forEach(r => Object.keys(r.photos || {}).forEach(p => photos.push(r.photos[p])));
    const id = qid ? ('dc' + gid.slice(-6) + qid.replace(/[^\w]/g, '').slice(-10) + date.replace(/-/g, '')) : ('du' + gid.slice(-6) + String(L[0].key).replace(/[^\w]/g, '').slice(-16));
    await deps.createDraft({ id, type: 'dailyLog', by: 'line-bot', byName: 'LINE 機器人', at: now || Date.now(), status: 'pending',
      summary: ('施工日報' + (qid ? '' : '（待分類）') + '：' + L[0].site + '　' + date).slice(0, 200),
      payload: { qid, site: L[0].site, unmatched: !qid, groupId: gid, date, answers: L.map(r => coBlockText(r)), dayTexts: [], photos: photos.slice(0, 20), replied: true } });
    n++;
  }
  return n;
}

// ── 08:00 檢查前一天沒回：群組提醒一次；連兩天沒回 → 通知擁有者 ──
async function morningCheck(deps, now) {
  const cfg = (await deps.getCfg()) || {}; const T = textsOf(cfg);
  const today = tpeDate(now), d1 = addDays(today, -1), d2 = addDays(today, -2);
  let reminded = 0, escalated = 0;
  for (const gid of Object.keys(cfg.groups || {})) {
    const g = cfg.groups[gid]; if (!g || !g.qid || g.daily === false) continue;
    const y1 = (await deps.dbGet('fydata/lineDaily/' + gid + '/' + d1)) || null;
    if (!y1 || !y1.askedAt || y1.replied || y1.reminded) continue;
    // 早上補回也算（問三句之後到現在有文字）
    const logs1 = (await deps.dbGet('fydata/lineLog/' + gid + '/' + d1)) || {};
    const logs0 = (await deps.dbGet('fydata/lineLog/' + gid + '/' + today)) || {};
    if (_dayContent(logs1, y1.askedAt).texts.length || _dayContent(logs0, 0).texts.length) continue;
    if (!(await safePush(deps, gid, T.remind))) continue;
    await deps.dbSet('fydata/lineDaily/' + gid + '/' + d1 + '/reminded', true);
    reminded++;
    const y2 = (await deps.dbGet('fydata/lineDaily/' + gid + '/' + d2)) || null;
    // 前天：20:00 整理之後才回的也算有回（以當天紀錄重算，不只看 replied 旗標）
    let replied2 = !!(y2 && y2.replied);
    if (y2 && y2.askedAt && !replied2) {
      const logs2 = (await deps.dbGet('fydata/lineLog/' + gid + '/' + d2)) || {};
      replied2 = _dayContent(logs2, y2.askedAt).texts.length > 0;
    }
    if (y2 && y2.askedAt && !replied2) { if (await pushOwners(cfg, deps, fill(T.noReply2, { site: siteName(g) }))) escalated++; }
  }
  return { reminded, escalated };
}

// ── 推播佇列：fydata/linePush/<id> {text, to?:'owners', status:'pending'} ──
async function processPush(id, rec, deps) {
  if (!rec || rec.status !== 'pending' || !rec.text) return false;
  const cfg = (await deps.getCfg()) || {};
  const text = String(rec.text).slice(0, 4900);
  const owners = Object.keys(cfg.owners || {}).length;
  const n = await pushOwners(cfg, deps, text);
  await deps.dbSet('fydata/linePush/' + id + '/status', !owners ? 'noOwner' : n ? 'sent' : 'failed');   // failed：FJ 看得出沒送到
  await deps.dbSet('fydata/linePush/' + id + '/sentAt', Date.now());
  return n > 0;
}

module.exports = { verifySignature, handleEvents, dailyAsk, dailyCompile, morningCheck, processPush, isAddon, alarmWord, parseQty, parseCoReport, matchSite, tpeDate, addDays, fill, DEFAULT_TEXTS, ALARM_WORDS };
