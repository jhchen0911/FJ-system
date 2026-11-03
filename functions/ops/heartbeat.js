// v6.0.137 電腦端斷線警報：電腦端（Lotion-HQ）定時「報到」，排程每小時檢查，超過 2 小時沒報到就用 LINE 通知 Lotion 一次（純邏輯，單元測試 functions/test/heartbeat.test.js）
// 資料：fydata/hqBeat = { at: 最後報到時間, by: 報到帳號, alertFor: 已經為哪一次報到發過警報（＝當時的 at）, alertAt }
// 同一次斷線只發一次：發警報時記 alertFor＝at；恢復報到後 at 變新的、和 alertFor 不同，下次斷線才會再發。
'use strict';
const HB_STALE_MS = 2 * 3600 * 1000;   // 超過 2 小時沒報到 → 警報
const HB_MIN_GAP_MS = 60 * 1000;       // 1 分鐘內重複報到只回 ok、不再寫（避免迴圈灌寫入）
const HB_HOUR_FROM = 8, HB_HOUR_TO = 22; // 台灣時間 08:00～22:00 才檢查（含 22 點那次）
const HB_DAY_START = 6;                 // 審查：夜間關機不算斷線——當天 06:00 前的報到一律當成 06:00 起算（08:00 不會因為前一晚沒報到就叫，09:00 起照常：07:00 後都沒報到才叫）

function tpeHour(now) { return new Date(now + 8 * 3600 * 1000).getUTCHours(); }
function hbInWindow(now) { const h = tpeHour(now); return h >= HB_HOUR_FROM && h <= HB_HOUR_TO; }
// 當天台灣 06:00 的時間戳
function tpeDayStart(now) { const d = new Date(now + 8 * 3600 * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HB_DAY_START) - 8 * 3600 * 1000; }
function tpeStamp(ts) { const d = new Date(ts + 8 * 3600 * 1000); const p = (n) => String(n).padStart(2, '0'); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); }

// 要不要發警報。沒報到過（還沒設定）不發；時段外不發；已經為這次報到發過不發。
function hbDecide(state, now) {
  const s = (state && typeof state === 'object') ? state : {};
  if (!hbInWindow(now)) return { alert: false, why: 'window' };
  if (typeof s.at !== 'number' || !isFinite(s.at)) return { alert: false, why: 'never' };
  if (now - Math.max(s.at, tpeDayStart(now)) <= HB_STALE_MS) return { alert: false, why: 'ok' };
  if (s.alertFor === s.at) return { alert: false, why: 'sent' };
  return { alert: true, key: s.at };
}
// 報到要不要寫（1 分鐘內重複的不寫）
function hbShouldWrite(state, now) { const at = state && state.at; return !(typeof at === 'number' && now - at >= 0 && now - at < HB_MIN_GAP_MS); }
function hbText(at) { return '⚠️ 電腦端超過 2 小時沒報到，請看電腦（最後報到 ' + tpeStamp(at) + '）'; }

module.exports = { HB_DAY_START, tpeDayStart, HB_STALE_MS, HB_MIN_GAP_MS, HB_HOUR_FROM, HB_HOUR_TO, tpeHour, hbInWindow, hbDecide, hbShouldWrite, hbText };
