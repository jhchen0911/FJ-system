// 改版第 5 步 5d #25、#26：排程倒推提醒、材料送審擋進場（純邏輯；單元測試 functions/test/sched.test.js）
// 寫好、不啟用（需求書：5 寫好、7c 啟用）——整案排程與送審文件的畫面 7c 才做，index.js 沒有排程會呼叫這裡。
// 7c 啟用時：把 ENABLED 改 true、index.js 每天讀 fydata/shared/projects 跑 backward()＋matBlock()，結果寫 fydata/todo/sched。
// 預設資料形狀（專案 p._PRJ_SLOTS 的 sched／docs；7c 定案時若欄位不同，改這裡的讀法即可，測試一起改）：
//   p.sched = [{ id, name, kind: 'permit'|'material'|'engineer'|'work', start: 'YYYY-MM-DD', lead: 提前天數, doneAt?, item?（材料名稱） }]
//   p.docs  = [{ id, kind: 'matSubmit', item: 材料名稱, approvedAt?: 'YYYY-MM-DD' }]
'use strict';

const ENABLED = false;
const LEAD_DEF = { permit: 30, material: 14, engineer: 21 };   // 沒填提前天數時的預設（陳軒建議；7c 再請 Lotion 確認）
const VERB = { permit: '該辦證', material: '該備料', engineer: '該催技師' };

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function safeKey(s) { return String(s).replace(/[.#$/[\]]/g, '_').slice(0, 80); }

// #25 排程倒推：今天 ≥ 開始日 − 提前天數、還沒完成 → 卡片；專案進行中但沒建排程 → 給 Lotion
function backward(projects, today) {
  const out = {};
  arr(projects).forEach((p) => {
    if (!p || !p.id || p.voidAt || p.closedAt) return;
    const S = arr(p.sched);
    if (!S.length) { out[safeKey(p.id + '_nosched')] = { src: 'sched', key: safeKey(p.id + '_nosched'), urgent: false, text: '排程倒推：專案 ' + (p.no || p.id) + ' 還沒建整案排程', sub: 'Lotion：工程專案 › 排程', go: 'dash' }; return; }
    S.forEach((s) => {
      if (!s || !VERB[s.kind] || s.doneAt || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.start || ''))) return;
      const lead = s.lead != null && isFinite(+s.lead) ? +s.lead : LEAD_DEF[s.kind];
      const left = dayDiff(today, s.start);
      if (left > lead) return;
      const k = safeKey(p.id + '_' + (s.id || s.name));
      out[k] = { src: 'sched', key: k, urgent: left <= 3, text: VERB[s.kind] + '：' + String(s.name || '').slice(0, 40) + (left >= 0 ? '（' + left + ' 天後開始）' : '（已過開始日 ' + (-left) + ' 天）'), sub: '專案 ' + (p.no || p.id) + ' › 排程', go: 'dash' };
    });
  });
  return out;
}

// #26 材料送審擋進場：排程上的材料進場（kind material 且有 item）沒有核可的送審文件 → 「不能排進場」
function matBlock(projects, today) {
  const out = {};
  arr(projects).forEach((p) => {
    if (!p || !p.id || p.voidAt || p.closedAt) return;
    const ok = {}; arr(p.docs).forEach((d) => { if (d && d.kind === 'matSubmit' && d.approvedAt && d.item) ok[String(d.item).trim()] = 1; });
    arr(p.sched).forEach((s) => {
      if (!s || s.kind !== 'material' || s.doneAt || !s.item) return;
      if (ok[String(s.item).trim()]) return;
      if (s.start && dayDiff(today, s.start) > 60) return;   // 兩個月以後的先不吵
      const k = safeKey(p.id + '_mat_' + (s.id || s.item));
      out[k] = { src: 'sched', key: k, urgent: !!s.start && dayDiff(today, s.start) <= 7, text: '不能排進場：' + String(s.item).slice(0, 30) + ' 材料送審還沒核可', sub: '專案 ' + (p.no || p.id) + ' › 送審文件', go: 'dash' };
    });
  });
  return out;
}

module.exports = { ENABLED, backward, matBlock, LEAD_DEF };
