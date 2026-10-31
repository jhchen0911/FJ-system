// 健檢2 #7／#13（v6.0.118）：AI 代理與伺服器端每日備份的純邏輯（不碰 Firebase／網路，單元測試 functions/test/ops.test.js）
'use strict';

// ── AI 代理：前端不再持有金鑰，改帶登入憑證呼叫 aiProxy，由伺服器加上金鑰轉給 Anthropic ──
const AI_MAX_TOKENS = 2000;            // 單次回覆上限（前端各功能用 500～1500）
const AI_MAX_BODY = 30 * 1024 * 1024;  // 請求上限（照片／PDF base64；鑽探報告 PDF 前端上限 20MB，base64 後約 27MB）
const AI_DAILY_LIMIT = 200;            // 每人每天呼叫上限（擋帳號被盜時灌爆費用）
const AI_ROLES = ['admin', 'staff'];   // 唯讀帳號（reader）與陌生帳號不可用

// 檢查並整理前端送來的 body：只放行 model／max_tokens／messages／system／temperature，其他欄位丟掉
function cleanAiBody(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { err: '格式錯誤' };
  const model = String(b.model || '');
  if (!/^claude-[a-z0-9.-]{1,60}$/.test(model)) return { err: '不支援的模型' };
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 20) return { err: '訊息格式錯誤' };
  const mt = Math.min(AI_MAX_TOKENS, Math.max(1, parseInt(b.max_tokens, 10) || 800));
  const out = { model, max_tokens: mt, messages: b.messages };
  if (typeof b.system === 'string') out.system = b.system.slice(0, 20000);
  if (typeof b.temperature === 'number' && b.temperature >= 0 && b.temperature <= 1) out.temperature = b.temperature;
  return { body: out };
}
function aiRoleOk(role) { return AI_ROLES.indexOf(role) >= 0; }

// ── 每日備份：fydata 整包（扣掉 backups 本身）存 Storage fydata/backups/server/daily/<日期>.json；每月 1 日另存 monthly/<年月>.json ──
const KEEP_DAILY = 30, KEEP_MONTHLY = 12;
function tpeDate(ts) { return new Date((ts || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10); }
// 備份資料夾：daily/<日期>/、每月 1 日另存 monthly/<年月>/；每個 RTDB 節點一個檔（逐個讀、逐個寫，記憶體高峰只有一個節點）
function backupDirs(now) {
  const d = tpeDate(now);
  const out = ['fydata/backups/server/daily/' + d + '/'];
  if (d.slice(8, 10) === '01') out.push('fydata/backups/server/monthly/' + d.slice(0, 7) + '/');
  return out;
}
function backupPaths(now) { return backupDirs(now); }
// 依資料夾名稱（日期）排序，回傳要刪的舊資料夾前綴
function pruneList(names, keep) {
  const dirs = [];
  names.forEach((n) => { const m = String(n).match(/^(.*\/(\d{4}-\d{2}(-\d{2})?)\/)/); if (m && dirs.indexOf(m[1]) < 0) dirs.push(m[1]); });
  dirs.sort();
  return dirs.length > keep ? dirs.slice(0, dirs.length - keep) : [];
}
// 要備份的 RTDB 節點（fydata 底下；backups 本身不備份）
const BACKUP_NODES = ['shared', 'private', 'relay', 'access', 'adminEmails', 'adminUids', 'readers', 'logs', 'drafts', 'bank', 'workerSens', 'workerSensIn', 'tombReq',
  'lineCfg', 'lineInbox', 'lineLog', 'lineDaily', 'linePush', 'lineErr', 'aiUsage'];
function backupPayload(fydata, now) {
  const v = Object.assign({}, fydata || {});
  delete v.backups;   // 不備份備份
  const counts = {};
  ['quotes', 'invoices', 'contracts', 'customers', 'vendors', 'workers'].forEach((k) => {
    const c = v.shared && v.shared[k];
    counts[k] = c ? Object.keys(c).length : 0;
  });
  ['payables', 'expenses'].forEach((k) => {
    const c = v.private && v.private[k];
    counts[k] = c ? Object.keys(c).length : 0;
  });
  return { kind: 'fy-server-backup', version: 1, at: now || Date.now(), counts, data: v };
}

module.exports = { cleanAiBody, aiRoleOk, AI_DAILY_LIMIT, AI_MAX_BODY, backupDirs, backupPaths, pruneList, backupPayload, BACKUP_NODES, KEEP_DAILY, KEEP_MONTHLY, tpeDate };
