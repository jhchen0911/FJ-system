/* 豐有工程管理系統．計算模組：LINE 日報文字拆成工項數量（v6.0.227，請款鏈 2；陳軒派工 11/10，Lotion 定案「拆數量、Lotion 確認才入帳」）
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
        if (!q && DONE.test(pc) && !NOT_DONE.test(pc) && rows.length && !Object.keys(terms(pc)).length) { rows[rows.length - 1].batchDone = true; return; }   // v6.0.234：「這段拔完」本身有「拔」字，先當本段完成看
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
  // ── 新格式（Lotion 11/11：「LINE 的日報直接改格式，讓系統好判斷，工務也不會混亂」）──
  // askList(items, logs) → [{no, idx, label, unit}]：17:30 問句列的「本工地工項」（還沒做完的、短編號 1～N，最多 max 項）
  //   做完＝能打設的打設累計 ≥ 合約數量、能拔除的拔除累計 ≥ 合約數量（兩種都不是的工項：任何數量累計 ≥ 合約數量）
  function _cat2(it) { var c = itemCat(it), d = firstLine(it && it.desc); if (!c.i && /組立|鋪設|架設|吊裝/.test(d)) c = { i: 1, r: c.r }; return c; }
  function _phOf(r) { return r && r.ph === 'remove' ? 'remove' : 'install'; }
  function askList(items, logs, max) {
    items = Array.isArray(items) ? items : []; max = max > 0 ? max : 15; var out = [];
    items.forEach(function (it, i) {
      if (out.length >= max || !isLine(it) || !(num(it.qty) > 0) || (it && it.cat === 'other')) return;   // 技師簽證這類（類別「其他」）不列
      var c = _cat2(it), q = num(it.qty), ins = cumOf(logs, i, 'install', _phOf), rm = cumOf(logs, i, 'remove', _phOf);
      var done = (c.i || c.r) ? ((!c.i || ins >= q - 1e-9) && (!c.r || rm >= q - 1e-9)) : (ins + rm >= q - 1e-9);
      if (done) return;
      out.push({ no: out.length + 1, idx: i, label: firstLine(it.desc).replace(/\s+/g, ' ').trim().slice(0, 30), unit: String(it.unit || '') });
    });
    return out;
  }
  var FMT_TAGS = { '日期': 'date', '工地': 'site', '本工地工項': 'list', '今天做了': 'today', '今天': 'today', '人和機具': 'crew', '明天': 'tomorrow', '問題': 'issue' };
  var FMT_RE = /【\s*(本工地工項|今天做了|人和機具|日期|工地|今天|明天|問題)\s*】/g;
  // sections(text) → {date, site, list, today, crew, tomorrow, issue, tagged}：沒有任何【】欄位＝tagged:false（舊寫法）
  function sections(text) {
    var t = String(text || '').replace(/\r/g, ''), out = { tagged: false }, segs = [], m; FMT_RE.lastIndex = 0;
    while ((m = FMT_RE.exec(t))) segs.push({ k: FMT_TAGS[m[1]], s: m.index, e: FMT_RE.lastIndex });
    if (!segs.length) return out;
    out.tagged = true;
    segs.forEach(function (g, i) { var v = t.slice(g.e, i + 1 < segs.length ? segs[i + 1].s : t.length).trim(); out[g.k] = (out[g.k] ? out[g.k] + '\n' : '') + v; });
    return out;
  }
  // 範本的 【本工地工項】 那段（工項名稱可能有「追加」「變更」字樣）拿掉，給警報／追加判斷用
  function stripList(text) { var t = String(text || ''); if (!/【\s*本工地工項\s*】/.test(t)) return t; return t.replace(/【\s*本工地工項\s*】[^]*?(?=【|$)/g, ''); }
  var ACT_IN = /打設|施打|打入|裝設|安裝|架設|組立|鋪設|吊裝|打(?!完)|裝(?!完)/, ACT_RM = /拔除|拔樁|拔|拆除|拆|回收|撤除/;
  var NO_LINE = /^(\d{1,2})(?!\d|\.\d)\s*[.、)）:：]?\s*(?![支根片組處座孔台噸個顆段只式米公人位名工]|M(?![A-Za-z])|m(?![A-Za-z])|T(?![A-Za-z]))(.*)$/;
  function _numIn(s) { var re = new RegExp('([0-9]+(?:\\.[0-9]+)?|[一二兩三四五六七八九十百]{1,5})\\s*(' + UNIT + ')?(?![A-Za-z0-9])', 'g'), m;
    while ((m = re.exec(s))) { var pre = s.slice(Math.max(0, m.index - 2), m.index); if (/L\s*[=＝]?\s*$|長\s*$|深\s*$|第\s*$|每\s*$|[A-Za-z]$/i.test(pre)) continue; var n = cn2n(m[1]); if (n > 0) return { n: n, u: m[2] ? normUnit(m[2]) : '' }; }
    return null; }
  // 清單上那一項還在報價的同一列（報價改過就用名稱找；找不到 → -1）
  function _listIdx(e, items) {
    if (!e) return -1; var lb = String(e.label || '').replace(/\s+/g, ' ').trim(), at = items[e.idx];
    var same = function (it) { return isLine(it) && firstLine(it.desc).replace(/\s+/g, ' ').trim().slice(0, 30) === lb; };
    if (at && same(at)) return e.idx;
    var hits = []; items.forEach(function (it, i) { if (same(it)) hits.push(i); }); return hits.length === 1 ? hits[0] : -1;
  }
  // parseFmt(text, list, items) → 跟 parse 一樣的 {rows, skip}，另加 fmt（有沒有用新格式）、crew／tomorrow／issue（原文）
  //   有【今天做了】（或舊的【今天】）→ 只拆那一段，一行一項：「編號＋動作＋數量（＋這段拔完）」照 list 對工項、單位照合約；
  //   寫工項名稱的那行照 parse 的對位規則；【人和機具】不算工項數量；【本工地工項】是範本，不拆
  //   沒有任何【】欄位（舊寫法、自由寫）→ 整段照 parse
  function parseFmt(text, list, items) {
    items = Array.isArray(items) ? items : []; list = Array.isArray(list) ? list : [];
    var S = sections(norm(text));
    if (!S.tagged || S.today == null) { var P0 = parse(text, items); P0.fmt = false; return P0; }
    var rows = [], skip = [], byNo = {}; list.forEach(function (e) { if (e && e.no) byNo[e.no] = e; });
    var LINES = []; String(S.today || '').split('\n').forEach(function (raw) { raw.split(/[，,、；;]\s*(?=\d{1,2}(?![\d.])\s*[.、)）:：]?\s*(?:打|拔|組|拆|裝|架|鋪|施|吊|回|撤|安))/).forEach(function (x) { LINES.push(x); }); });   // 「1 打設 12、2 拔除 3」一行寫兩項
    LINES.forEach(function (raw) {
      var line = raw.replace(/^[\s　]*[-•・*]\s*/, '').trim(); if (!line || /^[（(]?\s*例/.test(line) || /^[（(].*[）)]$/.test(line)) return;
      var m = NO_LINE.exec(line);
      if (m && byNo[+m[1]]) {
        var e = byNo[+m[1]], rest = m[2] || '', idx = _listIdx(e, items), it = idx >= 0 ? items[idx] : null;
        var q = _numIn(rest), ph = ACT_RM.test(rest) ? 'remove' : (ACT_IN.test(rest) ? 'install' : ''), bd = DONE.test(rest) && !NOT_DONE.test(rest), why = '', cand = null;
        var c = it ? _cat2(it) : { i: 0, r: 0 }, iu = it ? String(it.unit || '') : String(e.unit || '');
        if (!ph && it) ph = (c.r && !c.i) ? 'remove' : (c.i && !c.r ? 'install' : '');
        if (idx < 0) why = '第 ' + e.no + ' 項（' + e.label + '）在報價裡找不到了（報價改過），請選';
        else if (!q) why = '沒寫數量';
        else if (!ph) why = '沒寫打設還是拔除';
        else if (ph === 'remove' && !c.r && c.i) why = '這個工項只有打設，寫的是拔除';
        else if (ph === 'install' && !c.i && c.r) why = '這個工項只有拔除，寫的是打設';
        else if (q.u && iu && normUnit(iu) !== q.u) why = '寫的單位（' + q.u + '）跟合約（' + iu + '）不同';
        else if (UNSURE.test(rest) || RANGE.test(rest)) why = RANGE.test(rest) ? '數量是範圍，請確認' : '「' + (rest.match(UNSURE) || [''])[0] + '」不一定是今天做的量，請確認';
        if (why && idx >= 0) cand = [idx];
        rows.push({ itemIdx: why ? -1 : idx, qty: q ? q.n : 0, unit: normUnit(iu) || (q && q.u) || '', ph: ph, batchDone: bd, text: line.slice(0, 120), sure: !why, why: why, cand: cand, no: e.no });
        return;
      }
      var P1 = parse(line, items);
      P1.rows.forEach(function (r) { rows.push(r); });
      if (!P1.rows.length) skip.push(line.slice(0, 60));
    });
    String(S.crew || '').split('\n').forEach(function (l) { l = l.trim(); if (l && !/^[（(]?\s*例/.test(l)) skip.push('人和機具：' + l.slice(0, 60)); });
    return { rows: rows, skip: skip, fmt: true, crew: S.crew || '', tomorrow: S.tomorrow || '', issue: S.issue || '' };
  }
  // askText(head, blocks, ymd) → 17:30 問句：blocks＝[{site, list}]（一個群組好幾個工地＝好幾段，編號各自從 1 開始）
  function askText(head, blocks, md) {
    var B = (blocks && blocks.length) ? blocks : [{ site: '', list: [] }];
    return String(head || '') + '\n' + B.map(function (b) {
      return '【日期】' + md + '\n【工地】' + (b.site || '') + '\n' + (b.list && b.list.length ? '【本工地工項】\n' + b.list.map(function (e) { return e.no + ' ' + e.label; }).join('\n') + '\n' : '') + '【今天做了】\n\n【人和機具】\n\n【明天】\n\n【問題】\n';
    }).join('\n');
  }
  var dl = { parse: parse, cumOf: cumOf, qtyOf: qtyOf, terms: terms, specs: specs, cn2n: cn2n, norm: norm, askList: askList, parseFmt: parseFmt, sections: sections, stripList: stripList, askText: askText };
  if (typeof module !== 'undefined' && module.exports) module.exports = { dl: dl };
  root.FJC = root.FJC || {}; root.FJC.dl = dl;
})(typeof window !== 'undefined' ? window : globalThis);
