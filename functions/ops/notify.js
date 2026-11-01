// v6.0.123 AI 通知：AI 帳號（陳軒唯讀）或 Lotion 本人用 LINE「陳軒｜AI 助理」傳一行短訊息給 Lotion（純邏輯，單元測試 functions/test/notify.test.js）
// 安全：收件人固定是 LINE 擁有者（lineCfg/owners，只有管理員能改），發送的人不能指定；只收短文字（≤100 字、不能有網址）；
//       只有下面名單的帳號能發；每天最多 30 則，超過丟掉並記錄；紀錄保留 180 天。
'use strict';
const NOTIFY_SENDERS = ['jhchen0911@gmail.com', 'hsuanchen911@gmail.com'];   // Lotion 本人、AI 帳號（陳軒唯讀）
const NOTIFY_DAILY = 30;
const NOTIFY_MAX = 100;
const NOTIFY_KEEP_MS = 180 * 86400000;
// 審查：先 NFKC（全形字母、全形冒號斜線變半形）、拿掉零寬與方向控制字元、把「。．｡」當成點，再擋網址樣式
const INVIS_RE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
const LINK_RES = [
  /[a-z0-9-]+\s*\.\s*[a-z]{2,}/i,          // 網域：example.com、lin.ee、x.top、a . b
  /\d+\s*\.\s*\d+\s*\.\s*\d+\s*\.\s*\d+/,   // IP（版號 v6.0.123 只有三段，不會擋到）
  /[a-z][a-z0-9+.-]*:\/\//i,               // 任何 scheme://
  /\b(mailto|line|tel|sms|data|javascript|intent|file)\s*:/i,
  /@/,                                    // email 與 @提及
  /[a-z0-9-]+\.[a-z0-9-]+\/\S/i,          // a.b/c 這類短網址
];
function notifyAllowed(email) { return NOTIFY_SENDERS.indexOf(String(email || '').toLowerCase()) >= 0; }
const len = s => Array.from(s).length;   // 中文、表情符號都算一個字
// 送出的文字：拿掉看不見的字元、控制字元壓成空白（保留全形標點，「｜」「：」不變）
function clean(s) {
  return String(s).replace(INVIS_RE, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// 檢查用：NFKC 後全形字母／冒號／斜線變半形，「。．｡」當成點
const forCheck = s => s.normalize('NFKC').replace(INVIS_RE, '').replace(/[。．｡]/g, '.');

// body：{title, todo} → 「✅【標題】做完了｜要你做：…」；或 {text} 整句自己寫。只收字串。回傳 {text} 或 {err}
function buildNotify(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  for (const k of ['title', 'todo', 'text']) if (b[k] != null && typeof b[k] !== 'string') return { err: '格式不正確' };
  let text = clean(b.text || '');
  if (!text) {
    const title = clean(b.title || ''), todo = clean(b.todo || '');
    if (!title) return { err: '請填標題' };
    text = '✅【' + title + '】做完了' + (todo ? '｜要你做：' + todo : '');
  }
  if (len(text) > NOTIFY_MAX) return { err: '超過 ' + NOTIFY_MAX + ' 字（目前 ' + len(text) + ' 字）' };
  const chk = forCheck(text);
  if (LINK_RES.some(re => re.test(chk))) return { err: '不能放網址' };
  return { text };
}

module.exports = { NOTIFY_SENDERS, NOTIFY_DAILY, NOTIFY_MAX, NOTIFY_KEEP_MS, notifyAllowed, buildNotify };
