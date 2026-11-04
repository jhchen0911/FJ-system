// 改版第 5 步 5a：回收筒到期清除（後端 30）。純邏輯，單元測試 functions/test/trash.test.js
// 共用區 fydata/shared/trash、私有區 fydata/private/trashPriv 是陣列（Firebase 可能存成物件）；保留天數 fydata/shared/params/trashDays（預設 30，1～365）
'use strict';
function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function trashDays(v) { const d = parseInt(v, 10); return d > 0 && d <= 365 ? d : 30; }
// 回傳 {keep, removed}：at 早於（現在－天數）的清掉
function purge(list, days, now) {
  const lim = (now || Date.now()) - trashDays(days) * 86400000;
  const all = arr(list), keep = all.filter((x) => (+x.at || 0) >= lim);
  return { keep, removed: all.length - keep.length };
}
module.exports = { purge, trashDays };
