// v6.0.144 LINE 收件匣：標已歸檔的權限與欄位檢查（純邏輯，單元測試 functions/test/inbox.test.js）
'use strict';
const { NOTIFY_SENDERS } = require('./notify.js');
const OWNER = 'jhchen0911@gmail.com';
const STATUSES = ['filed', 'new'];
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
  if (STATUSES.indexOf(status) < 0) return { err: '狀態只能是 filed 或 new' };
  const qid = clean(b.qid, 60);
  if (qid && !/^[\w-]+$/.test(qid)) return { err: '報價編號格式不正確' };
  return { id, status, qid, caseName: clean(b.caseName, 100), note: clean(b.note, 200) };
}
// 只改狀態與歸檔資訊；路徑、檔名、來源不動
function markUpdate(cur, c, email, now) {
  const up = { status: c.status, qid: c.qid || null, caseName: c.caseName || null, note: c.note || null, markedBy: String(email || '').toLowerCase(), markedAt: now };
  up.filedAt = c.status === 'filed' ? now : null;
  if (cur && (cur.status === 'error' || cur.status === 'tooBig') && c.status === 'new') up.status = cur.status;   // 存檔失敗／太大的不能改回「未歸檔」假裝有檔案
  return up;
}
module.exports = { markAllowed, cleanMark, markUpdate, STATUSES };
