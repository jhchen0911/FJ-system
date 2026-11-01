// v6.0.123 AI 通知：AI 帳號（陳軒唯讀）或 Lotion 本人用 LINE「陳軒｜AI 助理」傳一行短訊息給 Lotion（純邏輯，單元測試 functions/test/notify.test.js）
// 安全：收件人固定是 LINE 擁有者（lineCfg/owners，只有管理員能改），發送的人不能指定；只收短文字（≤100 字、不能有網址）；
//       只有下面名單的帳號能發；每天最多 30 則，超過丟掉並記錄；紀錄保留 180 天。
'use strict';
const NOTIFY_SENDERS = ['jhchen0911@gmail.com', 'hsuanchen911@gmail.com'];   // Lotion 本人、AI 帳號（陳軒唯讀）
const NOTIFY_DAILY = 30;
const NOTIFY_MAX = 100;
const NOTIFY_KEEP_MS = 180 * 86400000;
const URL_RE = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|tw|net|org|io|app|ly|me|co|cc|gl|info|biz|dev|link|page)\b)/i;

function notifyAllowed(email) { return NOTIFY_SENDERS.indexOf(String(email || '').toLowerCase()) >= 0; }
const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const len = s => Array.from(s).length;   // 中文、表情符號都算一個字

// body：{title, todo} → 「✅【標題】做完了｜要你做：…」；或 {text} 整句自己寫。回傳 {text} 或 {err}
function buildNotify(body) {
  const b = (body && typeof body === 'object') ? body : {};
  let text = clean(b.text);
  if (!text) {
    const title = clean(b.title), todo = clean(b.todo);
    if (!title) return { err: '請填標題' };
    text = '✅【' + title + '】做完了' + (todo ? '｜要你做：' + todo : '');
  }
  if (!text) return { err: '沒有內容' };
  if (len(text) > NOTIFY_MAX) return { err: '超過 ' + NOTIFY_MAX + ' 字（目前 ' + len(text) + ' 字）' };
  if (URL_RE.test(text)) return { err: '不能放網址' };
  return { text };
}

module.exports = { NOTIFY_SENDERS, NOTIFY_DAILY, NOTIFY_MAX, NOTIFY_KEEP_MS, notifyAllowed, buildNotify };
