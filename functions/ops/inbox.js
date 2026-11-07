// v6.0.144 LINE 收件匣：標已歸檔的權限與欄位檢查（純邏輯，單元測試 functions/test/inbox.test.js）
'use strict';
const { NOTIFY_SENDERS } = require('./notify.js');
const OWNER = 'jhchen0911@gmail.com';
const STATUSES = ['filed', 'new', 'unsug'];   // unsug（v6.0.191）：只清掉 AI 的歸檔建議，狀態不動
// 擁有者、名冊裡的管理員（claim fy＝admin）、AI 帳號名單（與 aiNotify 相同，電腦端 HQ 用）
function markAllowed(email, role) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  return e === OWNER || role === 'admin' || NOTIFY_SENDERS.indexOf(e) >= 0;
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
function cleanMark(b) {
  b = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
  const id = String(b.id || '');
  if (!/^\w{1,40}$/.test(id)) return { err: '收件編號不正確' };
  const status = String(b.status || 'filed');
  if (STATUSES.indexOf(status) < 0) return { err: '狀態只能是 filed、new 或 unsug' };
  const qid = clean(b.qid, 60);
  if (qid && !/^[\w-]+$/.test(qid)) return { err: '報價編號格式不正確' };
  return { id, status, qid, caseName: clean(b.caseName, 100), note: clean(b.note, 200) };
}
// 只改狀態與歸檔資訊；路徑、檔名、來源不動
function markUpdate(cur, c, email, now) {
  if (c.status === 'unsug') return { sug: null, markedBy: String(email || '').toLowerCase(), markedAt: now };   // v6.0.191 退回 AI 建議：不動狀態、案名與備註
  const up = { sug: null, status: c.status, qid: c.qid || null, caseName: c.caseName || null, note: c.note || null, markedBy: String(email || '').toLowerCase(), markedAt: now };
  up.filedAt = c.status === 'filed' ? now : null;
  if (cur && (cur.status === 'error' || cur.status === 'tooBig') && c.status === 'new') up.status = cur.status;   // 存檔失敗／太大的不能改回「未歸檔」假裝有檔案
  return up;
}
// v6.0.191 AI 建議歸檔：AI 帳號處理過（已下載、交給報價線、建了草稿）就寫一筆建議，Lotion 在總覽拍板卡一次確認
function cleanSug(b) {
  b = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
  const id = String(b.id || '');
  if (!/^\w{1,40}$/.test(id)) return { err: '收件編號不正確' };
  const qid = clean(b.qid, 60);
  if (qid && !/^[\w-]+$/.test(qid)) return { err: '報價編號格式不正確' };
  const caseName = clean(b.caseName, 100);
  if (!qid && !caseName) return { err: '要給報價（qid）或案名（caseName）' };
  return { id, qid, caseName, note: clean(b.note, 200), why: clean(b.why, 120) };
}
function sugUpdate(cur, c, email, now) {
  if (!cur) return { err: '找不到這筆收件' };
  if (cur.status === 'filed') return { err: '這筆已經歸檔了' };
  return { sug: { qid: c.qid || null, caseName: c.caseName || null, note: c.note || null, why: c.why || null, by: String(email || '').toLowerCase(), at: now } };
}
// 給 AI 看的未歸檔清單（不含下載網址）
function openList(all, now, keepMs) {
  return Object.keys(all || {}).map((k) => all[k]).filter((x) => x && x.id && x.status !== 'filed' && (+x.at || 0) >= now - keepMs)
    .sort((a, b) => (b.at || 0) - (a.at || 0)).map((x) => ({ id: x.id, at: x.at, type: x.type, fileName: x.fileName || null, size: x.size || null, status: x.status, note: x.note || null, text: x.type === 'text' ? String(x.text || '').slice(0, 300) : undefined, sug: x.sug || null }));
}
module.exports = { markAllowed, cleanMark, markUpdate, STATUSES, cleanSug, sugUpdate, openList };
