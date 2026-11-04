// 改版第 5 步 5a：雲端每日健檢（後端 28）與後端待辦（純邏輯，不碰 Firebase；單元測試 functions/test/health.test.js）
// 判斷規則跟前端資料健檢一樣（前端 _healthAddPrj／_healthAdd689／_healthAdd637），上線後前兩週兩邊並行比對。
//   ① 得標案數 vs 專案數（第 4 步）：每張已得標主報價都要有一筆沒作廢的專案（手動刪過、立墓碑的不算）；已得標追加的主約沒得標
//   ② 已付卻記待付：付款帳本（paidLog）記載已付（paidAt > unpaidAt），應付卻不是已付
//   ③ 重複應付：同廠商、同工程、同金額、同期別的應付有兩筆（金額 > 0）
//   ④ 日報照片容量：fydata/relay/photos 的筆數與大小（Realtime Database 免費額度 1GB，超過 300MB 提醒）
'use strict';

const PHOTO_WARN_BYTES = 300 * 1024 * 1024;
const LIST_MAX = 12;

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
// Firebase 不能用的字元在前端上傳前編碼過（_fbEncKey），這裡還原（跟前端 _fbDecKey 一樣）
function decKey(k) { return String(k).replace(/~d~/g, '.').replace(/~h~/g, '#').replace(/~s~/g, '$').replace(/~sl~/g, '/').replace(/~lb~/g, '[').replace(/~rb~/g, ']'); }
function decObj(o) { const r = {}; Object.keys(o || {}).forEach((k) => { r[decKey(k)] = o[k]; }); return r; }
function money(n) { return Math.round(parseFloat(n) || 0).toLocaleString('en-US'); }
function tpeDate(ts) { return new Date((ts || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10); }

function buildHealth(inp) {
  inp = inp || {};
  const sh = inp.shared || {}, pv = inp.priv || {}, now = inp.now || Date.now();
  const quotes = arr(sh.quotes), projects = arr(sh.projects);
  const prjTomb = decObj((sh.tombs && sh.tombs.projects) || {});
  const items = [];
  const add = (key, sev, area, title, list) => { list = list || []; if (!list.length) return; items.push({ key, sev, area, title, n: list.length, list: list.slice(0, LIST_MAX) }); };
  // ① 得標案數 vs 專案數
  const byId = {}; quotes.forEach((q) => { if (q && q.id) byId[q.id] = q; });
  const mains = quotes.filter((q) => q.awarded && !q.parentId), adds = quotes.filter((q) => q.awarded && q.parentId);
  const live = projects.filter((p) => p && !p.voidAt);
  const liveQ = {}; live.forEach((p) => { liveQ[p.qid] = 1; });
  add('prj_missing', 'warn', '專案', '已得標主報價沒有專案', mains.filter((q) => !liveQ[q.id] && prjTomb['p_' + q.id] == null).map((q) => q.name || q.id));
  add('prj_orphan_add', 'warn', '專案', '追加已得標、但主報價沒有得標', adds.filter((q) => { const m = byId[q.parentId]; return !m || !m.awarded; }).map((q) => q.name || q.id));
  // ② 已付卻記待付
  const pays = arr(pv.payables), pl = decObj(pv.paidLog || {});
  add('paid_pending', 'warn', '應付', '付款帳本記載已付、應付卻是待付', pays.filter((p) => {
    if (!p || !p.id || p.status === 'paid') return false;
    const l = pl[p.id]; return !!l && (l.paidAt || 0) > (l.unpaidAt || 0);
  }).map((p) => (p.project || '') + '：' + (p.to || '') + ' NT$ ' + money(p.amount)));
  // ③ 重複應付（跟前端 _healthAdd637 同一把鑰匙）
  const seen = {}, dups = [];
  pays.forEach((p) => {
    const k = [(p.to || ''), (p.project || ''), Math.round(parseFloat(p.amount) || 0), p.costPeriod || ''].join('|');
    if (seen[k] && (parseFloat(p.amount) || 0) > 0) dups.push((p.to || '') + ' ' + (p.project || '') + ' NT$ ' + money(p.amount));
    seen[k] = 1;
  });
  add('pay_dup', 'warn', '應付', '同廠商同工程同金額的應付有兩筆', dups);
  // ④ 照片容量
  const ph = inp.photos || { count: 0, bytes: 0 };
  if ((ph.bytes || 0) > PHOTO_WARN_BYTES) add('photo_big', 'warn', '日報照片', '日報照片佔用超過 300MB', ['目前 ' + ph.count + ' 張、約 ' + Math.round(ph.bytes / 1048576) + 'MB']);
  const warn = items.filter((x) => x.sev === 'warn').reduce((a, x) => a + x.n, 0);
  return {
    at: now, day: tpeDate(now), ok: warn === 0, warn,
    counts: { quotes: quotes.length, wonMains: mains.length, wonAdds: adds.length, projects: live.length, payables: pays.length, photos: ph.count || 0, photoMB: Math.round((ph.bytes || 0) / 1048576) },
    items,
  };
}
// 後端待辦：只放「幾筆、去哪裡看」，不放金額與廠商（待辦節點一般員工也讀得到；明細在只有管理員讀得到的 fydata/health）
const TODO_TEXT = { prj_missing: '已得標主報價沒有專案', prj_orphan_add: '追加已得標、主報價沒得標', paid_pending: '付款帳本記已付、應付卻是待付', pay_dup: '疑似重複應付', photo_big: '日報照片容量偏大' };
function todoFromHealth(h) {
  const out = {};
  ((h && h.items) || []).forEach((it) => {
    if (it.sev !== 'warn') return;
    out[it.key] = { id: 'health_' + it.key, src: 'health', key: it.key, urgent: it.key === 'paid_pending', text: '系統健檢：' + (TODO_TEXT[it.key] || it.title) + ' ' + it.n + ' 筆', sub: '經營報表 › 資料健檢', go: 'health', at: h.at };
  });
  return out;
}
// 保留最近 N 天的健檢紀錄：回傳要刪的日期
function pruneDays(days, keep) { const d = (days || []).slice().sort(); return d.length > keep ? d.slice(0, d.length - keep) : []; }

module.exports = { buildHealth, todoFromHealth, pruneDays, decKey, PHOTO_WARN_BYTES, tpeDate };
