/* 豐有工程管理系統．計算模組：LINE 日報文字拆成工項數量（v6.0.224，請款鏈 2；陳軒派工 11/10，Lotion 定案「拆數量、Lotion 確認才入帳」）
 * 純計算：不讀畫面、不讀全域資料，值由參數傳入。掛在 window.FJC.dl；Node：require('./calc/dailyparse.js').dl。
 * 對外函式只能新增，不能改既有參數或意義（換版空檔可能舊 app.js 配新 calc）。
 *
 * parse(text, items) → { rows:[{itemIdx, qty, unit, ph, batchDone, text, sure, why}], skip:[文字] }
 *   - 一段文字＝一行再用「，、；。」切開；同一行前一段講了工項、後一段才講數量（「打設鋼板樁，共 20 支」）會接起來看
 *   - 數量：數字（含一～九十九的國字）＋單位（支、根、M、片、組…）；「L=12M」「第 2 層」「H300」不算數量
 *   - 打設或拔除：看「打設、裝設、架設…／拔除、拆除、回收…」；本段完成：「完成、打完、拔完…」（「未完成、還沒完成」不算）
 *   - 對工項：跟報價工項說明第一行比材料關鍵字與規格（H300、III、50KG…），打設／拔除要跟工項類別合得來；
 *     對不到或有兩個以上一樣像 → sure:false、itemIdx:-1（卡片標「待確認」，不猜）
 *   - 人數、機具（吊車、怪手）那幾行不算工項數量
 * 規則式拆解（不是大型語言模型），跟 functions/ops/progress.js 的打設／拔除判斷同一套（itemCat）。
 */
(function (root) {
  'use strict';
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var TERMS = ['H型鋼', '型鋼', '鋼軌樁', '鋼軌', '鋼板樁', '中間樁', '中間柱', '共構樁', '水平支撐', '支撐', '圍令', '斜撐', '角撐', '千斤頂', '構台', '覆工板', '覆工', '地錨', '預壘樁', '背填', 'CCP', '基樁', '安全母索', '母索', '導溝', '鋪路鐵板', '鐵板', '排樁', '短節', '托架', '鋼筋籠', '砂漿', '根固'];
  var SAME = { '型鋼': 'H型鋼', '鋼軌': '鋼軌樁', '中間柱': '中間樁', '水平支撐': '支撐', '覆工': '覆工板', '母索': '安全母索' };
  var PH_IN = /打設|施打|打入|打樁|插打|壓入|植入|裝設|安裝|架設|組立|鋪設|吊放|吊裝|打(?!完)|裝(?!完)/;
  var PH_RM = /拔除|拔樁|拔起|拔出|拔了|拔|拆除|拆|回收|撤除|吊離/;
  var DONE = /完成|打完|拔完|拆完|做完|裝完|結束|收尾|全部(?:打|拔|拆)好/;
  var NOT_DONE = /未完成|沒完成|尚未|還沒|還未|未做完|沒做完/;
  var NON_ITEM = /人數|工人|師傅|點工|機具|吊車|怪手|挖土機|發電機|天氣|下雨|停工|收工|出工/;
  var UNSURE = /累計|共計|合計|總共|總計|昨天|昨日|前天|前日|明天|明日|預計|預定|下週|待會|等一下|剩下|還剩|尚有/;   // 不是今天做的量，交給人
  var RANGE = /\d\s*[-~～到至]\s*\d/;
  var UNIT = '支|根|公尺|米|M|m|片|組|處|座|孔|台|噸|T|式|只|個|顆|段|㎡|M2|m2|平方公尺';
  var CN = { '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cn2n(s) {
    if (!s) return NaN; if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    var m = /^(?:([一二兩三四五六七八九])百)?(?:([一二兩三四五六七八九])?(十))?([一二三四五六七八九])?$/.exec(s);   // 一～九百九十九（審查：一百、一百二十）
    if (!m || !(m[1] || m[3] || m[4])) return s.length === 1 && CN[s] != null ? CN[s] : NaN;
    if (m[1] && !m[3] && m[4] && s.indexOf('零') < 0 && s.length === 3) return NaN;   // 「一百五」口語不收，交給人
    return (m[1] ? CN[m[1]] * 100 : 0) + (m[3] ? (m[2] ? CN[m[2]] : (m[1] ? 1 : 1)) * 10 : 0) + (m[4] ? CN[m[4]] : 0);
  }
  // 全形數字→半形、千分位逗號拿掉（審查：「1,200 支」不能變 200）
  function norm(t) { return String(t || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[．]/g, '.').replace(/(\d)[,，](\d{3})(?!\d)/g, '$1$2'); }
  function normUnit(u) { u = String(u || '').trim(); if (/^(M|m|公尺|米)$/.test(u)) return 'M'; if (/^(支|根)$/.test(u)) return '支'; if (/^(㎡|M2|m2|平方公尺)$/.test(u)) return 'M2'; if (/^(T|噸)$/.test(u)) return 'T'; return u; }
  function firstLine(s) { return String(s == null ? '' : s).split(/\r?\n/)[0]; }
  function terms(s) { s = String(s || '').toUpperCase().replace(/[\s　]/g, ''); var out = {};
    TERMS.forEach(function (t) { if (s.indexOf(t.toUpperCase()) >= 0) out[SAME[t] || t] = 1; });
    if (out['H型鋼'] && (out['鋼軌樁'] || out['鋼板樁'])) delete out['H型鋼'];
    return out; }
  function specs(s) { s = String(s || '').toUpperCase().replace(/[\s　]/g, ''); var out = {}, m, re = /H(\d{3})/g;
    while ((m = re.exec(s))) out['H' + m[1]] = 1;
    re = /(\d{2})KG/g; while ((m = re.exec(s))) out[m[1] + 'KG'] = 1;
    re = /(?:^|[^A-Z])(IV|III|II|VL)(?![A-Z])/g; while ((m = re.exec(s))) out[m[1]] = 1;
    return out; }
  // 跟 functions/ops/progress.js、calc/todo.js 的 itemCat 一樣
  function itemCat(it) { var c = it && it.cat; if (c === 'install') return { i: 1, r: 0 }; if (c === 'remove') return { i: 0, r: 1 }; if (c === 'both') return { i: 1, r: 1 }; if (c === 'other') return { i: 0, r: 0 };
    var d = String((it && it.desc) || ''); return { i: /打設|裝設|安裝/.test(d) ? 1 : 0, r: /拔除|拆除/.test(d) ? 1 : 0 }; }
  function isLine(it) { return it && !it.sec && !it.spare && !(num(it.price) < 0 && num(it.qty) > 0) && String(it.desc || '').trim(); }
  // 一段文字裡的數量（排除 L=12M、第 2 層、長 9M、H300）
  function qtyOf(s) {
    var re = new RegExp('([0-9]+(?:\\.[0-9]+)?|[一二兩三四五六七八九十百]{1,5})\\s*(' + UNIT + ')(?![A-Za-z0-9])', 'g'), m, best = null;
    while ((m = re.exec(s))) {
      var pre = s.slice(Math.max(0, m.index - 2), m.index);
      if (/L\s*[=＝]?\s*$|長\s*$|深\s*$|間距\s*$|@\s*$|第\s*$|每\s*$|[A-Za-z]$/i.test(pre)) continue;   // 規格（H350）的數字不是數量
      if (NON_ITEM.test(s.slice(Math.max(0, m.index - 4), m.index))) continue;   // 「怪手1台」「人數8人」不是工項數量
      var n = cn2n(m[1]); if (!(n > 0)) continue;
      var u = normUnit(m[2]); if (!best || (best.u === 'M' && u !== 'M')) best = { n: n, u: u };   // 同一段有「12M」跟「15支」→ 用支數
    }
    return best;
  }
  function lastAt(re, s) { var g = new RegExp(re.source, 'g'), m, at = -1; while ((m = g.exec(s))) { at = m.index; if (!m[0].length) g.lastIndex++; } return at; }
  function phaseOf(s) { var rm = lastAt(PH_RM, s), ins = lastAt(PH_IN, s); if (rm < 0 && ins < 0) return ''; return rm > ins ? 'remove' : 'install'; }   // 兩種都有：離數量最近（最後出現）的為準
  function match(seg, ph, unit, items) {
    var T = terms(seg), S = specs(seg), tk = Object.keys(T), sk = Object.keys(S), best = [], bs = 0;
    if (!tk.length && !sk.length) return { idx: -1, why: '看不出是哪個工項' };
    items.forEach(function (it, i) {
      if (!isLine(it)) return;
      var d = firstLine(it.desc), IT = terms(d), IS = specs(d), sc = 0, hit = 0;
      tk.forEach(function (t) { if (IT[t]) { sc += 3; hit++; } });
      if (!tk.length) sk.forEach(function (k) { if (IS[k]) { sc += 3; hit++; } });   // 只寫規格（「H350 拔除 4 支」）：看規格
      if (!hit) return;
      if (tk.length && sk.length && Object.keys(IS).length) { var any = sk.some(function (k) { return IS[k]; }); if (!any) return; sc += 2; }   // 審查：回報寫了規格（IV）跟工項規格（III）不同＝不是這一項
      var c = itemCat(it); if (!c.i && /組立|鋪設|架設|吊裝/.test(d)) c = { i: 1, r: c.r };   // 對位用：構台組立、覆工板鋪設也算裝設
      if (ph === 'remove' && !c.r && c.i) return; if (ph === 'install' && !c.i && c.r) return;
      if (ph && ((ph === 'remove' && c.r) || (ph === 'install' && c.i))) sc += 1;
      var iu = normUnit(it.unit); if (unit && iu) sc += (iu === unit) ? 1 : -1;
      if (sc > bs) { bs = sc; best = [i]; } else if (sc === bs) best.push(i);
    });
    if (!best.length || bs <= 0) return { idx: -1, why: '報價裡沒有對得上的工項' };
    if (best.length > 1) return { idx: -1, why: '有 ' + best.length + ' 個工項一樣像，請選', cand: best };
    return { idx: best[0], why: '' };
  }
  function parse(text, items) {
    items = Array.isArray(items) ? items : []; var rows = [], skip = [];
    var qre = new RegExp('([0-9]+(?:\\.[0-9]+)?|[一二兩三四五六七八九十百]{1,5})\\s*(' + UNIT + ')(?![A-Za-z0-9])', 'g');
    norm(text).split(/\r?\n/).forEach(function (line) {
      line = line.replace(/^[\s　]*(?:\d+[.、)]|[-•・*])\s*/, '').trim(); if (!line) return;
      var ctx = '', linePh = '', lastSeg = '';
      // 切段：逗號、頓號、分號、句號；同一段有兩個以上數量再從每個數量後面切開（審查：「H300 8支 鋼板樁 20支」）
      var pieces = [];
      line.split(/[，,、；;。]/).forEach(function (pc) { pc = pc.trim(); if (!pc) return; var m, last = 0, cut = []; qre.lastIndex = 0;
        while ((m = qre.exec(pc))) { var pre = pc.slice(Math.max(0, m.index - 2), m.index); if (/L\s*[=＝]?\s*$|長\s*$|深\s*$|間距\s*$|@\s*$|第\s*$|每\s*$|[A-Za-z]$/i.test(pre)) continue; cut.push(m.index + m[0].length); }
        if (cut.length < 2) { pieces.push(pc); return; } cut.forEach(function (e, i) { var t = pc.slice(last, i === cut.length - 1 ? pc.length : e).trim(); last = e; if (t) pieces.push(t); }); });
      pieces.forEach(function (pc) {
        var q = qtyOf(pc);
        if (!q) { if (phaseOf(pc)) linePh = phaseOf(pc); if (Object.keys(terms(pc)).length || phaseOf(pc)) ctx = (ctx + ' ' + pc).trim();
          else if (DONE.test(pc) && !NOT_DONE.test(pc) && rows.length) rows[rows.length - 1].batchDone = true;   // 「…20支，這段完成」
          return; }
        if (NON_ITEM.test(pc) && !Object.keys(terms(pc)).length) { skip.push(pc); return; }
        var hasT = Object.keys(terms(pc)).length || Object.keys(specs(pc)).length;
        var seg = hasT ? (phaseOf(pc) ? pc : (ctx ? ctx + ' ' + pc : pc)) : (ctx ? (ctx + ' ' + pc).trim() : (lastSeg ? lastSeg.replace(/[0-9一二兩三四五六七八九十百]+\s*(支|根|M|片)/g, '') + ' ' + pc : pc));   // 「下午續打 9 支」接同一行上一筆的工項
        var ph = phaseOf(pc) || (hasT ? phaseOf(ctx) : '') || linePh;   // 審查：這一段自己寫了打設／拔除就只看這一段
        var m = match(seg, ph, q.u, items), why = m.why || '';
        if (m.idx >= 0 && (UNSURE.test(pc) || RANGE.test(pc))) { why = RANGE.test(pc) ? '數量是範圍，請確認' : '「' + (pc.match(UNSURE) || [''])[0] + '」不一定是今天做的量，請確認'; m = { idx: -1, cand: [m.idx] }; }
        if (phaseOf(pc)) linePh = phaseOf(pc); lastSeg = seg;
        var it = m.idx >= 0 ? items[m.idx] : null;
        if (it && !ph) { var c = itemCat(it); ph = (c.r && !c.i) ? 'remove' : 'install'; }
        rows.push({ itemIdx: m.idx, qty: q.n, unit: q.u, ph: ph || '', batchDone: DONE.test(pc) && !NOT_DONE.test(pc), text: seg.slice(0, 120), sure: m.idx >= 0, why: why, cand: m.cand || null });
      });
    });
    return { rows: rows, skip: skip };
  }
  // 累計（已確認的日報＋這次）跟合約數量比：logs＝q.dailyLogs，phOf(row)＝打設／拔除判斷（前端 _prPhase）
  function cumOf(logs, idx, ph, phOf) { var s = 0; (logs || []).forEach(function (L) { if (!L || L.photoOnly) return; (L.progressRows || []).forEach(function (r) { if (r && Number(r.itemIdx) === idx && num(r.qty) > 0 && (!phOf || phOf(r) === ph)) s += num(r.qty); }); }); return Math.round(s * 1000) / 1000; }
  var dl = { parse: parse, cumOf: cumOf, qtyOf: qtyOf, terms: terms, specs: specs, cn2n: cn2n, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = { dl: dl };
  root.FJC = root.FJC || {}; root.FJC.dl = dl;
})(typeof window !== 'undefined' ? window : globalThis);
