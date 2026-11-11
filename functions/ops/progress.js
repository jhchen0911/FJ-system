// 改版第 5 步 5d #9：實際進度回填（純邏輯；單元測試 functions/test/progress.test.js）
// 已確認的施工日報（q.dailyLogs 的數量列）→ 每個專案每個工項的實際日期與累計數量，雲端寫 fydata/progress/<專案 id>/<工項 key>。
// 7c 的整案排程讀這裡填「實際開始／實際完成」。只放數量與日期，不放金額（唯讀帳號也讀得到）。
//   工項 key＝「報價 id＋報價工項列號＋說明第一行」的雜湊（主線 11/04；審查加報價 id，主約與追加不撞）：列號會因插列變動，前端讀時用 qid＋name（說明第一行）對回去。
//   打設／拔除分開累計（跟前端 _itemCat／_prPhase 同一套判斷）；減項列（單價負數，前端 _qNegLine）不回填。
//   對不到工項的數量列（列號超出、指到分段標題／備用單價／減項）→ 後端待辦給工務。
'use strict';
const crypto = require('crypto');
const D = require('./daily.js');

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function num(x) { const n = parseFloat(x); return isFinite(n) ? n : 0; }
function firstLine(s) { return String(s == null ? '' : s).split(/\r?\n/)[0].trim(); }

// 審查：主約與追加的同列同名工項會撞 key → 雜湊再加報價 id（7c 讀時用 qid＋name 對回去）
function itemKey(idx, desc, qid) { return 'k' + crypto.createHash('sha1').update(String(qid || '') + '|' + String(idx) + '|' + firstLine(desc)).digest('hex').slice(0, 12); }

// 跟前端 _itemCat 一樣：有指定類別用類別，沒指定用說明關鍵字推定
function itemCat(it) {
  const c = it && it.cat;
  if (c === 'install') return { install: true, remove: false };
  if (c === 'remove') return { install: false, remove: true };
  if (c === 'both') return { install: true, remove: true };
  if (c === 'other') return { install: false, remove: false };
  const d = String((it && it.desc) || '');
  // 健檢 H2（11/11）：組立、鋪設、架設、吊裝、施打也算裝設（「組立及拆除」原本被判成只有拆除，組立數量記成拆除）；跟 calc/dailyparse.js、functions/ops/progress.js 同一份字表（tests/calc.js 比對）
    return { install: ['打設', '裝設', '安裝', '組立', '鋪設', '架設', '吊裝', '施打'].some(function (w) { return d.indexOf(w) >= 0; }), remove: ['拔除', '拆除'].some(function (w) { return d.indexOf(w) >= 0; }) };
}
// 跟前端 _prPhase 一樣
function phaseOf(it, r) {
  const c = itemCat(it || {});
  if (c.install && c.remove && r && (r.ph === 'remove' || r.ph === 'install')) return r.ph;
  return (c.remove && !c.install) ? 'remove' : 'install';
}

function pidOf(q) { return 'p_' + (q.parentId || q.id); }

// inp = { quotes, projects, now } → { byPid: {pid: {key: {...}}}, mismatch: [{qid, name, n}], n }
function build(inp) {
  const quotes = arr(inp.quotes).filter((q) => q && q.id && q.awarded);
  const live = {}; arr(inp.projects).forEach((p) => { if (p && p.id && !p.voidAt) live[p.id] = 1; });
  const byPid = {}, mismatch = []; let n = 0;
  quotes.forEach((q) => {
    const pid = pidOf(q); if (!live[pid]) return;
    const items = Array.isArray(q.items) ? q.items : arr(q.items);
    const acc = {}; let bad = 0;
    arr(q.dailyLogs).forEach((L) => {
      if (!L || !L.date || L.photoOnly) return;
      arr(L.progressRows).forEach((r) => {
        const idx = Number(r.itemIdx), qty = num(r.qty);
        if (!(idx >= 0) || qty <= 0) return;   // 備註列（itemIdx -1）、沒數量的不算
        const it = items[idx];
        if (!it || it.sec || it.spare) { bad++; return; }
        if (D.negLine(it)) return;   // 減項列不回填
        const k = itemKey(idx, it.desc, q.id);
        const a = acc[k] || (acc[k] = { qid: q.id, idx, name: firstLine(it.desc).slice(0, 60), unit: String(it.unit || '').slice(0, 10), target: Math.abs(num(it.qty)), first: '', last: '', cum: 0, days: 0, rFirst: '', rLast: '', rCum: 0, _d: {} });
        const ph = phaseOf(it, r);
        if (ph === 'remove') { a.rCum += qty; if (!a.rFirst || L.date < a.rFirst) a.rFirst = L.date; if (L.date > a.rLast) a.rLast = L.date; }
        else { a.cum += qty; if (!a.first || L.date < a.first) a.first = L.date; if (L.date > a.last) a.last = L.date; a._d[L.date] = (a._d[L.date] || 0) + qty; }
      });
    });
    Object.keys(acc).forEach((k) => {
      const a = acc[k];
      // 達合約量那天＝打設完成日（照日期排序累加）
      let c = 0; a.doneDate = '';
      Object.keys(a._d).sort().forEach((d) => { c += a._d[d]; if (!a.doneDate && a.target > 0 && c >= a.target - 1e-6) a.doneDate = d; });
      a.days = Object.keys(a._d).length; delete a._d;
      a.cum = Math.round(a.cum * 1000) / 1000; a.rCum = Math.round(a.rCum * 1000) / 1000;
      a.src = 'dailyLogs'; a.at = inp.now || Date.now();
      (byPid[pid] = byPid[pid] || {})[k] = a; n++;
    });
    if (bad) mismatch.push({ qid: q.id, name: String(q.name || q.id).slice(0, 40), n: bad });
  });
  return { byPid, mismatch, n };
}

function todoOf(mismatch, now) {
  const out = {};
  (mismatch || []).forEach((m) => {
    const key = String(m.qid).replace(/[.#$/[\]]/g, '_').slice(0, 60);
    out[key] = { id: 'progress_' + key, src: 'progress', key, urgent: false, text: '進度回填：「' + m.name + '」有 ' + m.n + ' 筆日報數量對不到工項', sub: '工務：到日報把工項改對（報價插列或刪列後常見）', go: 'dash', at: now || Date.now() };
  });
  return out;
}

module.exports = { build, todoOf, itemKey, itemCat, phaseOf, pidOf };
