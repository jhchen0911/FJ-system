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
// 新格式日報（Lotion 11/11）：問句範本、拆數量跟前端同一份 calc/dailyparse.js
let DL = null; try { DL = require('../calc/dailyparse.js').dl; } catch (e) { DL = require('../../calc/dailyparse.js').dl; }

const ADDON_RE = /(追加|多做|順便|加做|變更)/;
const ADDON_TAG_RE = /^\s*#\s*追加\s*/;
const ALARM_WORDS = ['裂', '變形', '湧砂', '沉陷', '傾斜'];
const PHOTO_WINDOW_MS = 10 * 60 * 1000;
const NEG_RE = /(沒有|沒|没|無|无|未|不|並無|并无|非)/;   // 關鍵字前 3 個字內有否定詞 → 不算（「沒有裂縫」「無變形」「不用追加」）
const PENDING_MAX = 50;                                   // 待綁定名單上限：陌生人灌不爆設定
const INBOX_BUDGET_MS = 240 * 1000;                       // v6.0.144 審查：一次 webhook 最多花 240 秒存檔（函式上限 300 秒），超過的記 error 請重傳，不會無聲遺失
const MAX_FILE_BYTES = 100 * 1024 * 1024;                 // 超過 100MB 的影片／檔案不存，只記一筆（v6.0.144：50→100MB，改串流存檔）

const DEFAULT_TEXTS = {
  inboxAck: '收到，之後的檔案會一起收。傳完打一行案名就好。',   // v6.0.153：同一批只回這一則
  inboxNote: '第 {no} 批 {n} 個檔案：{text}，已記下',   // v6.0.178 寫清楚第幾批（Lotion 11/05 兩案連傳被併成一批）
  inboxMore: '第 {no} 批補充：{text}，已記下',
  inboxNext: '好，接下來傳的檔案記成：{text}',
  inboxFail: '這個檔案沒存成功，請重傳：{name}',
  inboxBig: '這個檔案超過 {mb}MB 沒存，請改傳雲端連結：{name}',
  daily3: '今天辛苦了，麻煩回三件事：\n1. 今天做了哪些？（工項、數量）\n2. 幾個人、什麼機具？\n3. 有沒有問題、等待或追加？',
  remind: '昨天的施工日報還沒回，麻煩照昨天的格式補一下，謝謝。',
  alarm: '{site}工地群組出現「{word}」，請判斷是否停工。',
  noReply2: '{site}工地群組連兩天沒有回施工日報。',
  dailyCo: '今天辛苦了，請複製下面格式回報（一個工地一段，可以貼好幾段；補昨天的只改日期）：\n【日期】{date}\n【工地】\n【今天】\n【明天】\n【問題】',
  // v6.0.234 新格式（Lotion 11/11 定案）：17:30 送預先填好的範本；這一段是範本上面的說明（工務只複製【日期】以下）
  dailyFmtHead: '今天辛苦了，請複製【日期】以下整段，填好再傳（一個工地一段）：\n．今天做了：一行一項，編號＋打設／拔除／組立／拆除＋數量，例「1 打設 12」「1 拔除 40 這段拔完」，單位不用寫\n．人和機具：例「人 5、怪手 1、吊車 1」\n．問題：追加、等料、等吊車、有異狀都寫這裡',
};
// v6.0.119～121 的舊預設（沒有【日期】）：存過固定句子沒改這句的，當成新預設（v6.0.122）
const OLD_DAILYCO = '今天辛苦了，請照下面格式回報（一個工地一段，可以貼好幾段）：\n【工地】地名\n【今天】\n【明天】\n【問題】';

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
const OLD_INBOXNOTE = '這批 {n} 個檔案：{text}，已記下';   // v6.0.153～176 預設：存過沒改的換成新預設（寫第幾批）
const OLD_INBOXACK = '收到，{n} 個檔案，歸到哪一案？';   // v6.0.153 前的預設：存過沒改的換新預設
function textsOf(cfg) { const T = Object.assign({}, DEFAULT_TEXTS, (cfg && cfg.texts) || {}); if (T.dailyCo === OLD_DAILYCO) T.dailyCo = DEFAULT_TEXTS.dailyCo; if (T.inboxAck === OLD_INBOXACK) T.inboxAck = DEFAULT_TEXTS.inboxAck; if (T.inboxNote === OLD_INBOXNOTE) T.inboxNote = DEFAULT_TEXTS.inboxNote; if (T.remind === '昨天的施工日報還沒回，麻煩補一下三件事，謝謝。') T.remind = DEFAULT_TEXTS.remind; return T; }   // v6.0.234 舊提醒句（三件事）換新

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
// v6.0.234：範本的說明行和【本工地工項】那段不算工務寫的字（工項名稱、說明裡有「追加」不能觸發追加草稿）
function stripTpl(text, T) {
  let t = DL.stripList(String(text || ''));
  const head = String((T && T.dailyFmtHead) || DEFAULT_TEXTS.dailyFmtHead).split('\n').map(l => l.trim()).filter(Boolean);
  if (head.length) t = t.split('\n').filter(l => head.indexOf(l.trim()) < 0).join('\n');
  return t;
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
const CO_TAGS = { '工地': 'site', '今天': 'today', '今天做了': 'today', '人和機具': 'crew', '本工地工項': 'list', '明天': 'tomorrow', '問題': 'issue', '日期': 'date' };   // v6.0.234 新格式三個欄位
// 補傳日期（v6.0.121）：一行只寫日期才算，例「10/31」「10/31 補」「10月31日 補傳」「日期：10/31」「2026/10/31」「115/10/31」
//   （審查：避免「H300 1/2」「3/4 吋」這類規格被當成日期）；只認收到當天往前 7 天內（含當天），跨年回推
const DATE_LINE = /^(?:日期\s*[:：]?\s*)?(?:(\d{2,4})\s*[\/年.-]\s*)?(\d{1,2})\s*[\/月.-]\s*(\d{1,2})\s*日?\s*(?:[（(]?\s*(?:補傳|補報|補)\s*[）)]?)?$/;
// 括號包起來的日期（Lotion 11/1）：「［10/31］」「[10/31]」「【10/31】」，後面接空白或直接接內文都算
const DATE_BRACKET = /^[［\[【]\s*(?:(\d{2,4})\s*[\/年.-]\s*)?(\d{1,2})\s*[\/月.-]\s*(\d{1,2})\s*日?\s*(?:補傳|補報|補)?\s*[］\]】]/;
// 回傳 {ymd, raw}：ymd＝採用的日期（'' 表示不採用）；raw＝有寫日期但超出範圍或不合法時的原文（給草稿提示）
function parseDateLine(text, refYmd) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(DATE_LINE) || l.match(DATE_BRACKET); if (!m) continue;
    const ymd = _mdToYmd(+m[2], +m[3], refYmd);
    return ymd ? { ymd, raw: '' } : { ymd: '', raw: l.slice(0, 20) };
  }
  return { ymd: '', raw: '' };
}
function _mdToYmd(mo, d, refYmd) {
  if (!refYmd || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const y = +refYmd.slice(0, 4);
  const mk = yy => yy + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  let ymd = mk(y); if (ymd > refYmd) ymd = mk(y - 1);   // 1/2 補 12/31 → 去年
  const dt = new Date(ymd + 'T00:00:00Z'); if (dt.getUTCMonth() + 1 !== mo) return '';   // 2/30 之類
  const diff = Math.round((Date.parse(refYmd + 'T00:00:00Z') - dt.getTime()) / 86400000);
  return diff >= 0 && diff <= 7 ? ymd : '';
}
function parseMD(text, refYmd) { return parseDateLine(text, refYmd).ymd; }
function parseCoReport(text, refYmd) {
  const t = String(text || '').replace(/\r/g, '');
  if (!/【\s*工地\s*】/.test(t)) return [];
  const out = []; let cur = null, key = '';
  const re = /【\s*(本工地工項|今天做了|人和機具|工地|今天|明天|問題|日期)\s*】/g; let m; const segs = [];
  while ((m = re.exec(t))) { segs.push({ tag: m[1], start: m.index, end: re.lastIndex }); }
  let pre = null;   // 【工地】前面就先寫的欄位（順序寫反）→ 併到第一段
  // 日期：訊息開頭（第一個【】之前）寫的日期套用全部段落；【日期】套用它所在的段落與之後的段落
  const p0 = parseDateLine(segs.length ? t.slice(0, segs[0].start) : '', refYmd);
  let curDate = p0.ymd, curRaw = p0.raw;
  segs.forEach((g, i) => {
    const val = t.slice(g.end, i + 1 < segs.length ? segs[i + 1].start : t.length).trim();
    key = CO_TAGS[g.tag];
    if (key === 'list') return;   // 範本列的工項清單：不是回報內容
    if (key === 'date') {
      const p = parseDateLine(val, refYmd);
      if (p.ymd || p.raw) {
        curDate = p.ymd; curRaw = p.raw;
        // 【日期】寫在這段還沒有內容時才改這段（審查：放在下一段【工地】前當標題，不回頭改上一段）
        if (cur && !cur.today && !cur.tomorrow && !cur.issue && !cur.crew) { cur.date = p.ymd; cur.dateRaw = p.raw; }
      }
      return;
    }
    if (key === 'site') {
      cur = { site: val.split('\n')[0].trim().slice(0, 60), today: '', crew: '', tomorrow: '', issue: '', date: curDate, dateRaw: curRaw }; out.push(cur);
      const rest = val.split('\n').slice(1).join('\n').trim(); if (rest) cur.today = rest.slice(0, 1000);
      if (pre) { Object.keys(pre).forEach(k => { cur[k] = (pre[k] + (cur[k] ? '\n' + cur[k] : '')).slice(0, 1000); }); pre = null; }
    } else if (cur) cur[key] = (cur[key] ? cur[key] + '\n' : '') + val.slice(0, 1000);
    else if (val) { pre = pre || {}; pre[key] = (pre[key] ? pre[key] + '\n' : '') + val.slice(0, 1000); }
  });
  // 空白格式（把機器人的範本原樣貼回）、地名還是「地名」的段落不算
  const EMPTY = /^(無|没有|沒有|none|-|－|—)?$/i;
  return out.filter(b => b.site && !/^(地名|地點|工地名稱?)$/.test(b.site) && !(EMPTY.test(b.today.trim()) && EMPTY.test(b.tomorrow.trim()) && EMPTY.test(b.issue.trim()) && EMPTY.test(String(b.crew || '').trim())));
}
const _nrmSite = (x) => String(x || '').replace(/[\s()（）［］\[\]「」『』\-－_／/、，,.。]/g, '').toLowerCase();
// 地名對專案：專案名稱（格式「（業主）地名工程名稱」）含地名、或地名含專案短名；只有唯一一案對得上才算，否則待分類
function matchSite(sites, site) {
  const a = _nrmSite(site); if (a.length < 2) return '';
  // 先看手動對過的地名（keys 完全相同），再看名稱包含
  const exact = Object.keys(sites || {}).filter(qid => (Array.isArray((sites[qid] || {}).keys) ? sites[qid].keys : []).some(k => _nrmSite(k) === a));
  if (exact.length === 1) return exact[0];
  // 回報開頭也常寫（業主），例「(八九) 範例科技 F25P2」→ 比對名稱時一樣拿掉（v6.0.120）
  const b = _nrmSite(String(site || '').replace(/^\s*[（(][^）)]*[）)]/, '')), key = b.length >= 2 ? b : a;
  const hits = Object.keys(sites || {}).filter(qid => {
    const s = sites[qid] || {}; const names = [String(s.name || '').replace(/^\s*[（(][^）)]*[）)]/, '')].concat(Array.isArray(s.keys) ? s.keys : []).map(_nrmSite).filter(n => n.length >= 2);   // 開頭（業主）不比對，免得寫業主名就對到
    return names.some(n => n.indexOf(key) >= 0 || key.indexOf(n) >= 0);
  });
  return hits.length === 1 ? hits[0] : '';
}
function coBlockText(b) { return ['【今天】' + (b.today || '')].concat(b.crew ? ['【人和機具】' + b.crew] : []).concat(['【明天】' + (b.tomorrow || ''), '【問題】' + (b.issue || '')]).join('\n'); }   // v6.0.234 有寫人和機具才多一欄（前端只拆【今天】那段）
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
  const t0 = deps.now ? deps.now() : Date.now();
  for (const ev of events || []) {
    try { out.push(await handleEvent(ev, cfg, T, deps, t0)); } catch (e) {
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

// v6.0.153 一對一收件「批次」：fydata/lineInboxBatch/<userId> = {id, start, last, n, ids:{訊息id:1}, note, pendNote, pendAt}
const BATCH_GAP_MS = 3 * 60 * 1000;      // 上一個檔案後 3 分鐘內＝同一批
const NOTE_WIN_MS = 10 * 60 * 1000;      // 文字與檔案前後 10 分鐘內＝這批的案名／備註
const BATCH_IDS_MAX = 200;
const MEDIA_T = { image: '照片', video: '影片', audio: '語音', file: '檔案' };
// 審查：LINE 轉傳多個檔會平行送 webhook → 批次狀態用交易更新（deps.txn），沒有交易的測試環境退回讀改寫
async function _batchTx(deps, key, fn) {
  if (deps.txn) return await deps.txn(key, fn);
  const v = fn((await deps.dbGet(key)) || null); if (v !== undefined) await deps.dbSet(key, v); return v;
}
// v6.0.178（Lotion 11/05：10:43 傳案 1 的 3 個檔＋案名、10:45 傳案 2 的 1 張圖＋案名 → 圖被併進同一批、第二行字蓋掉整批備註）：
//   ① 一批收到案名文字就「關閉」：之後的檔案一律開新批，不管有沒有超過 3 分鐘
//   ② 已有案名的批（傳檔後打字、或先打字後傳檔）10 分鐘內再打字：「補充」「備註」開頭＝附加到這批；其他＝下一批的案名（不再蓋掉這批）
//   ③ 回覆寫第幾批（台北時間每天從 1 起算）
const MORE_RE = /^(補充|備註)[\s:：,，、]*/;
function _tpeDay(ts) { return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10); }
async function inboxBatchFile(deps, uid, msgId, now) {
  const key = 'fydata/lineInboxBatch/' + uid;
  let first = false, alone = false;
  const v = await _batchTx(deps, key, (cur0) => {
    const cur = cur0 || {}; first = false; alone = false;
    if (cur.id && now < (cur.start || 0) - BATCH_GAP_MS) { alone = true; return undefined; }   // 很久以前的重送檔：自成一批，不蓋掉目前這批
    let b;
    // 審查：關閉之前就傳出、但比案名晚到的檔（平行投遞／重送：時間早於案名、晚於這批開始前 3 分鐘）→ 併回這批、帶這批的案名，不另開一批蓋掉
    const late = cur.id && cur.closed && cur.closedAt && now <= cur.closedAt && now >= (cur.start || 0) - BATCH_GAP_MS;
    if (cur.id && (late || (!cur.closed && now - (cur.last || 0) <= BATCH_GAP_MS))) b = Object.assign({}, cur, { last: Math.max(cur.last || 0, now), n: (cur.n || 0) + 1 });
    else {
      first = true;
      const no = cur.id && _tpeDay(cur.start || 0) === _tpeDay(now) ? (cur.no || 1) + 1 : 1;
      b = { id: msgId, start: now, last: now, n: 1, ids: {}, no };
      if (cur.pendNote && now - (cur.pendAt || 0) <= NOTE_WIN_MS && now >= (cur.pendAt || 0)) b.note = cur.pendNote;   // 先打字、後傳檔（用過就清掉）
    }
    const ids = Object.assign({}, b.ids || {}); if (Object.keys(ids).length < BATCH_IDS_MAX) ids[msgId] = 1; b.ids = ids;
    return b;
  });
  if (alone || !v) return { id: msgId, first: true, note: '', n: 1, no: 0 };
  return { id: v.id, first, note: v.note || '', n: v.n, no: v.no || 1 };
}
// 回傳 { batch, n, total, no, mode: 'name'（這批的案名）|'more'（補充）|'next'（下一批的案名）|'' }
async function inboxBatchText(deps, uid, msgId, text, now) {
  const key = 'fydata/lineInboxBatch/' + uid;
  let hit = null;
  await _batchTx(deps, key, (cur0) => {
    const cur = cur0 || {}; hit = null;
    if (!text) return undefined;
    const inWin = cur.id && now - (cur.last || 0) <= NOTE_WIN_MS && now >= (cur.start || 0);
    const pendNext = cur.pendNote && cur.pendNext && now - (cur.pendAt || 0) <= NOTE_WIN_MS;
    if (pendNext) {   // 審查：已經說了下一批的案名、還沒傳檔 → 再打的字（含補充）都接在下一批的案名後面，不動上一批
      const pn = (String(cur.pendNote) + '；' + (text.replace(MORE_RE, '').trim() || text)).slice(0, 400);
      hit = { mode: 'next', note: pn };
      return Object.assign({}, cur, { pendNote: pn, pendAt: now });
    }
    if (inWin && !cur.note) {   // ① 這批還沒有案名：這行就是案名，這批關閉
      hit = { mode: 'name', batch: cur.id, ids: Object.keys(cur.ids || {}), n: cur.n || 0, no: cur.no || 1, note: text.slice(0, 400) };
      return Object.assign({}, cur, { note: text.slice(0, 400), closed: true, closedAt: now, pendNote: null, pendAt: null, pendNext: null });
    }
    if (inWin && MORE_RE.test(text)) {   // ② 補充／備註：附加到這批
      const add = text.replace(MORE_RE, '').trim() || text, note = (String(cur.note) + '；' + add).slice(0, 400);
      hit = { mode: 'more', batch: cur.id, ids: Object.keys(cur.ids || {}), n: cur.n || 0, no: cur.no || 1, note, add };
      return Object.assign({}, cur, { note, closed: true, closedAt: Math.max(cur.closedAt || 0, now) });
    }
    if (inWin) {   // ② 這批已有案名、不是補充：當成下一批的案名，這批關閉（不蓋掉）
      hit = { mode: 'next', note: text.slice(0, 400) };
      return Object.assign({}, cur, { closed: true, closedAt: Math.max(cur.closedAt || 0, now), pendNote: text.slice(0, 400), pendAt: now, pendNext: true });
    }
    const keep = cur.pendNote && now - (cur.pendAt || 0) <= NOTE_WIN_MS;   // 審查：傳檔前連打兩行 → 兩行都留
    return Object.assign({}, cur, { pendNote: ((keep ? cur.pendNote + '；' : '') + text).slice(0, 400), pendAt: now });
  });
  if (!hit) return { batch: '', mode: '' };
  if (hit.mode === 'next') return { batch: '', mode: 'next', note: hit.note };
  // 審查：一次寫完這批每個檔的備註（不逐筆寫，避免大批次拖到逾時）
  const up = {}; hit.ids.forEach((id) => { up['fydata/lineInbox/' + id + '/note'] = hit.note; });
  try { if (deps.dbUpdate) await deps.dbUpdate(up); else for (const k of Object.keys(up)) await deps.dbSet(k, hit.note); } catch (e) { (deps.log || console.error)('line.batchNote', e); }
  return { batch: hit.batch, n: hit.ids.length, total: hit.n, no: hit.no, mode: hit.mode, add: hit.add || '' };
}

async function handleEvent(ev, cfg, T, deps, t0) {
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
      const name = msg.type === 'file' ? safeName(msg.fileName) : (msg.id + '.' + extOf(msg));
      const path = 'line/inbox/' + date + '/' + msg.id + '_' + name;
      const base = { id: msg.id, at: now, date, from: src.userId, type: msg.type, fileName: msg.fileName || name };
      // 審查：下載前先「認領」（status:'saving'），LINE 在下載途中重送也不會重複下載、重複回覆、蓋掉已歸檔的狀態
      if (deps.claim && !(await deps.claim('fydata/lineInbox/' + msg.id, Object.assign({}, base, { status: 'saving' })))) return { kind: 'dup' };
      // v6.0.153 回覆合併：同一批（上一個檔案後 3 分鐘內）只回第一則，其餘靜默收下；回覆一律用該則自己的 replyToken（不吃推播額度）
      const b = await inboxBatchFile(deps, src.userId, msg.id, now);
      base.batch = b.id; if (b.note) base.note = b.note;
      let replied = false;
      const say = async (txt) => {
        if (!txt) return;
        if (!replied && ev.replyToken) { replied = true; try { await deps.reply(ev.replyToken, txt); } catch (e) { (deps.log || console.error)('line.reply', e); } return; }   // 審查：回覆失敗不改推播（LINE 可能其實送到了，推播會重複又吃額度）
        await safePush(deps, src.userId, txt);   // 只有第一則（權杖拿去回「收到」）存檔失敗時才推播：每批最多一則
      };
      const mb = Math.round(MAX_FILE_BYTES / 1048576), nm = msg.fileName || (MEDIA_T[msg.type] || '檔案');
      const big = msg.fileSize > MAX_FILE_BYTES;
      if (b.first) await say((b.no > 1 ? '第 ' + b.no + ' 批：' : '') + fill(T.inboxAck, { n: 1 }) + (b.note ? '（已記下：' + b.note + '）' : '') + (big ? '\n' + fill(T.inboxBig, { mb, name: nm }) : ''));
      else if (big) await say(fill(T.inboxBig, { mb, name: nm }));
      if (big) { await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size: msg.fileSize, status: 'tooBig' })); return { kind: 'tooBig' }; }
      const elapsed = (deps.now ? deps.now() : Date.now()) - (t0 || 0);
      if (t0 != null && elapsed > INBOX_BUDGET_MS) {
        await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size: msg.fileSize || 0, status: 'error', err: '這一批檔案太多太大，時間不夠存，請重傳這個檔案' }));
        await say(fill(T.inboxFail, { name: nm }));
        return { kind: 'inboxErr', reason: 'budget' };
      }
      let size = 0;
      try {
        if (deps.saveContent) {   // v6.0.144：串流（邊收邊寫 Storage，不把整個檔案放進記憶體）
          const r = await deps.saveContent(msg.id, path, MAX_FILE_BYTES);
          if (r && r.tooBig) { await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size: r.size || 0, status: 'tooBig' })); await say(fill(T.inboxBig, { mb, name: nm })); return { kind: 'tooBig' }; }
          size = (r && r.size) || 0;
        } else {
          const c = await deps.fetchContent(msg.id);
          if (c.buf && c.buf.length > MAX_FILE_BYTES) { await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size: c.buf.length, status: 'tooBig' })); await say(fill(T.inboxBig, { mb, name: nm })); return { kind: 'tooBig' }; }
          await deps.putFile(path, c.buf, c.contentType || 'application/octet-stream');
          size = (c.buf && c.buf.length) || 0;
        }
      } catch (e) {
        // 已經回「收到」了：存檔失敗要記一筆 error（FJ 收件匣看得到），也要回一句請重傳
        await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size: msg.fileSize || 0, status: 'error', err: String(e && e.message || e).slice(0, 200) }));
        (deps.log || console.error)('line.inboxSave', e);
        await say(fill(T.inboxFail, { name: nm }));
        return { kind: 'inboxErr' };
      }
      await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign(base, { size, path, status: 'new' }));
      return { kind: 'inboxFile', path };
    }
    if (msg.type === 'text') {
      // v6.0.153：文字＝這批的案名／備註。前 10 分鐘內有檔案 → 記到這批每個檔、回一句；沒有 → 先記著，10 分鐘內傳來的檔案會帶上
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (deps.claim && !(await deps.claim('fydata/lineInbox/' + msg.id, { id: msg.id, at: now, date, from: src.userId, type: 'text', status: 'saving' }))) return { kind: 'dup' };   // 審查：文字重送不重複回覆
      const r = await inboxBatchText(deps, src.userId, msg.id, text, now);
      await deps.dbSet('fydata/lineInbox/' + msg.id, Object.assign({ id: msg.id, at: now, date, from: src.userId, type: 'text', text: String(msg.text || '').slice(0, 1000) },
        r.batch ? { status: 'filed', batch: r.batch, note: (r.mode === 'more' ? '補充到第 ' : '已記到第 ') + r.no + ' 批 ' + r.n + ' 個檔案' } : (r.mode === 'next' ? { status: 'new', note: '下一批的案名' } : { status: 'new' })));
      const rtxt = r.mode === 'more' ? fill(T.inboxMore, { no: r.no, text: r.add }) : r.mode === 'next' ? fill(T.inboxNext, { text: r.note || text }) : (r.batch ? fill(T.inboxNote, { no: r.no, n: r.n, text }) + (r.total > r.n ? '（只記到前 ' + r.n + ' 個）' : '') : '');
      if (rtxt && ev.replyToken) { try { await deps.reply(ev.replyToken, rtxt); } catch (e) { (deps.log || console.error)('line.reply', e); } }
      return { kind: 'inboxText', batch: r.batch || '' };
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
    const own = stripTpl(text, T);   // v6.0.234：範本說明與工項清單不算
    const w = alarmWord(own);
    if (w) { await pushOwners(cfg, deps, fill(T.alarm, { site: siteName(g), word: w })); res.alarm = w; }
    if (isAddon(own)) {
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
    rec.path = path;
    if (msg.type === 'image') {
      // 這個人 10 分鐘內只回報了一個工地 → 掛上去；回報了兩個以上工地就不掛（分不出是哪個）
      const day = (await deps.dbGet(coPath)) || {};
      const mine = Object.keys(day).map(k => Object.assign({ key: k }, day[k])).filter(r => r && r.user === user && r.at >= now - PHOTO_WINDOW_MS && r.at <= now + PHOTO_WINDOW_MS);
      if (mine.length === 1) { await deps.dbSet(coPath + '/' + mine[0].key + '/photos/' + msg.id, path); rec.claimed = mine[0].key; }
    }
    await deps.dbSet(base, rec);   // 最後才寫：前面任何一步失敗，LINE 重送時還能重做
    return { kind: 'coMedia', path };
  }
  if (msg.type !== 'text') return { kind: 'skip', type: msg.type };
  const text = String(msg.text || '').slice(0, 4000);
  rec.text = text;
  const blocks = parseCoReport(text, date);
  const res = { kind: 'coText', blocks: blocks.length };
  if (!blocks.length) {
    // 沒用格式：照樣看警報字（工地名寫群組名）
    const w0 = alarmWord(stripTpl(text, T));
    if (w0) { await pushOwners(cfg, deps, fill(T.alarm, { site: siteName(cfg.groups[gid]), word: w0 })); res.alarm = w0; }
    await deps.dbSet(base, rec);
    return res;
  }
  // 這則之前 10 分鐘同一人傳的照片：只有一段時一起掛
  let prevPhotos = [];
  if (blocks.length === 1) {
    const logs = (await deps.dbGet('fydata/lineLog/' + gid + '/' + date)) || {};
    prevPhotos = Object.keys(logs).map(k => logs[k]).filter(r => r && r.path && r.type === 'image' && !r.claimed && r.user === user && r.at >= now - PHOTO_WINDOW_MS && r.at <= now);
  }
  res.qids = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], qid = matchSite(cfg.sites, b.site);
    const photos = {}; prevPhotos.forEach(r => { photos[r.id] = r.path; });
    const day = b.date || date;   // 補傳：內文寫的日期；沒寫＝收到日期
    await deps.dbSet(coPath + '/' + msg.id + '_' + i, { at: now, user, msgId: msg.id, site: b.site, qid, today: b.today, crew: b.crew || '', tomorrow: b.tomorrow, issue: b.issue, photos, day, dateRaw: b.dateRaw || '' });
    for (const r of prevPhotos) await deps.dbSet('fydata/lineLog/' + gid + '/' + date + '/' + r.id + '/claimed', msg.id + '_' + i);   // 一張照片只掛一個工地
    res.qids.push(qid);
    const all = stripTpl([b.today, b.tomorrow, b.issue].join('\n'), T);
    const w = alarmWord(all);
    if (w) { await pushOwners(cfg, deps, fill(T.alarm, { site: b.site, word: w })); res.alarm = w; }
    if (isAddon(all)) {
      const q = parseQty(all);
      await deps.createDraft({ id: 'dl' + msg.id + '_' + i, type: 'addon', by: 'line-bot', byName: 'LINE 機器人', at: now, status: 'pending',
        summary: ('現場追加：' + b.site + (qid ? '' : '（待分類）') + '　' + (b.issue || b.today)).slice(0, 200),
        payload: { qid, site: b.site, unmatched: !qid, groupId: gid, date: day, backfill: day !== date, recvDate: date, text: coBlockText(b), user, qty: q ? q.qty : null, unit: q ? q.unit : '', photos: Object.keys(photos).map(k => photos[k]), msgId: msg.id } });
    }
  }
  await deps.dbSet(base, rec);   // 最後才寫（同上：失敗可重送）
  return res;
}

async function pushOwners(cfg, deps, text) {
  const ids = Object.keys((cfg && cfg.owners) || {});
  let ok = 0;
  for (const id of ids) if (await safePush(deps, id, text)) ok++;   // 一位推不到，其他人照推
  return ok;
}

// ── 17:30 日報問句（v6.0.234 起：預先填好日期、工地、本工地還沒做完的工項（短編號）的範本；編號清單存 lineDaily/<群組>/<日期>/list/<報價id>，20:00 帶進草稿）──
// deps.getQuote(qid) → 報價（已解碼）；沒有就只列日期、工地
async function _askList(deps, qid) {
  if (!qid || !deps.getQuote) return [];
  try { const q = await deps.getQuote(qid); return q ? DL.askList(q.items, q.dailyLogs) : []; } catch (e) { (deps.log || console.error)('line.askList', qid, e); return []; }
}
// 公司大群組：最近 14 天在這個群組回報過、對得到專案的工地（最多 5 個，最近的在前）
async function _coRecentSites(deps, cfg, gid, date) {
  const seen = {};
  for (let k = 1; k <= 14; k++) {
    const day = (await deps.dbGet('fydata/lineCo/' + gid + '/' + addDays(date, -k))) || {};
    Object.keys(day).forEach(x => { const r = day[x]; if (r && r.qid && cfg.sites && cfg.sites[r.qid] && !(r.qid in seen)) seen[r.qid] = k; });
  }
  return Object.keys(seen).sort((a, b) => seen[a] - seen[b]).slice(0, 5);
}
async function dailyAsk(deps, now) {
  const cfg = (await deps.getCfg()) || {}; const T = textsOf(cfg); const date = tpeDate(now), md = date.slice(5).replace('-', '/');
  let n = 0;
  for (const gid of Object.keys(cfg.groups || {})) {
    const g = cfg.groups[gid]; if (!g || (!g.qid && g.mode !== 'company') || g.daily === false) continue;
    if (await deps.dbGet('fydata/lineDaily/' + gid + '/' + date + '/askedAt')) continue;   // 排程重跑：今天問過就不再問
    const blocks = [], lists = {};
    if (g.mode === 'company') {
      for (const qid of await _coRecentSites(deps, cfg, gid, date)) { const L = await _askList(deps, qid); blocks.push({ site: String((cfg.sites[qid] || {}).name || '').replace(/^\s*[（(][^）)]*[）)]/, '').trim().slice(0, 40), list: L }); if (L.length) lists[qid] = L; }
    } else { const L = await _askList(deps, g.qid); blocks.push({ site: siteName(g), list: L }); if (L.length) lists[g.qid] = L; }
    const txt = DL.askText(T.dailyFmtHead, blocks, md);
    if (!(await safePush(deps, gid, txt))) continue;   // 這個群組推不到（例如機器人被移出），其他群組照問
    if (Object.keys(lists).length) await deps.dbSet('fydata/lineDaily/' + gid + '/' + date + '/list', lists);
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
      payload: { qid: g.qid, groupId: gid, date, answers: day.askedAt ? c.texts.map(x => stripTpl(x, textsOf(cfg))) : [], dayTexts: c.allTexts.slice(-30), photos: c.photos.slice(0, 20), replied, fmtList: day.list || null } });
    n++;
  }
  return n;
}

// 公司大群組 20:00：同一工地當天所有回報合成一份日報草稿；對不到工地的每段各一份「待分類」草稿（在 FJ 選工程再確認）
// late=true（隔天 08:00 補跑）：只收 20:00 之後才回報、還沒進草稿的段落，草稿 id 加 L，不跟前一晚的撞
async function coCompile(deps, cfg, gid, date, now, late) {
  const day = (await deps.dbGet('fydata/lineCo/' + gid + '/' + date)) || {};
  const rows = Object.keys(day).map(k => Object.assign({ key: k }, day[k])).filter(r => r && r.site && !r.compiled).sort((a, b) => (a.at || 0) - (b.at || 0));
  const by = {};
  rows.forEach(r => { const k = (r.qid || ('?' + r.key)) + '|' + (r.day || date); (by[k] = by[k] || []).push(r); });
  let n = 0;
  for (const k of Object.keys(by)) {
    const L = by[k], qid = L[0].qid || '', day = L[0].day || date, back = day !== date;
    const bad = L.map(r => r.dateRaw).filter(Boolean);   // 有寫日期但超過 7 天／不合法 → 照收到日，草稿註明
    const photos = []; L.forEach(r => Object.keys(r.photos || {}).forEach(p => photos.push(r.photos[p])));
    // 補傳的另加收到日（MMDD），不跟那一天自己的草稿撞號
    const lst = qid ? (((await deps.dbGet('fydata/lineDaily/' + gid + '/' + day + '/list/' + qid)) || (await deps.dbGet('fydata/lineDaily/' + gid + '/' + date + '/list/' + qid))) || null) : null;   // v6.0.234 那天問句的編號清單
    const id = qid ? ('dc' + gid.slice(-6) + qid.replace(/[^\w]/g, '').slice(-10) + day.replace(/-/g, '') + (back ? 'b' + date.slice(5).replace('-', '') : '') + (late ? 'L' : '')) : ('du' + gid.slice(-6) + String(L[0].key).replace(/[^\w]/g, '').slice(-16));
    await deps.createDraft({ id, type: 'dailyLog', by: 'line-bot', byName: 'LINE 機器人', at: now || Date.now(), status: 'pending',
      summary: ('施工日報' + (qid ? '' : '（待分類）') + '：' + L[0].site + '　' + day + (back ? '（補傳，' + date.slice(5) + ' 收到）' : '') + (bad.length ? '（內文日期「' + bad[0] + '」超過 7 天或不正確，先照收到日）' : '')).slice(0, 200),
      payload: { qid, site: L[0].site, unmatched: !qid, groupId: gid, date: day, backfill: back, recvDate: date, dateBad: bad.slice(0, 3), answers: L.map(r => coBlockText(r)), dayTexts: [], photos: photos.slice(0, 20), replied: true, fmtList: lst ? { [qid]: lst } : null } });
    for (const r of L) await deps.dbSet('fydata/lineCo/' + gid + '/' + date + '/' + r.key + '/compiled', id);
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
    const g = cfg.groups[gid];
    if (g && g.mode === 'company') { await coCompile(deps, cfg, gid, d1, now, true); continue; }   // 昨天 20:00 之後才回報的補成草稿（已建過的不重複）
    if (!g || !g.qid || g.daily === false) continue;
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

module.exports = { MAX_FILE_BYTES, INBOX_BUDGET_MS, BATCH_GAP_MS, NOTE_WIN_MS, verifySignature, handleEvents, dailyAsk, dailyCompile, morningCheck, processPush, pushOwners, isAddon, alarmWord, parseQty, parseCoReport, parseMD, matchSite, tpeDate, addDays, fill, DEFAULT_TEXTS, ALARM_WORDS, stripTpl };
