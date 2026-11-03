/* 豐有工程管理系統．計算模組：路數明細／定尺組合／構台下母索淨空／圖面覆核（v6.0.157，小批次；設計見 docs/路數明細_設計筆記.md）
 * 純計算：掛在 window.FJC.route；Node：require('./calc/route.js').route
 * 規則同其他 calc：對外函式只能新增，不能改既有參數或意義。
 *
 *   net(wall, wSpec, jack)            叫料淨長＝壁間 − 2×圍令型鋼高 − 千斤頂本體
 *   combo(net, o)                     一路的定尺組合（o：maxLen 單支最長、mids 中間樁位置[]、x0 第一支起點、minGap 接頭離中間樁最小距離、jackTol 千斤頂可伸長）
 *   fill(rem, jackTol)                零頭補法：千斤頂伸長或短節
 *   check(pieces, o)                 排法檢查：接頭落在中間樁窗口（前一支＋0.5～與下一支的中點）、離交叉點 ≥ 0.5 → 違反原因[]
 *   parse(str)                        手改的定尺組合字串「12.5+10.5」→ [12.5,10.5]
 *   row(r, o)                         一路完整結果（含手改組合、雙支撐、接頭檢查）
 *   spares(results)                   全案短節：同長度合計 ×1.1 無條件進位
 *   csv(text)                         CSV 匯入：層,路編號,方向,壁間長度,單雙,定尺組合,備註,中間樁位置 M,交叉點位置 M（逗號分隔，上層支撐才填）
 *   clearance(o)                      構台下淨空＝帽梁底 −（三角架高程＋型鋼高）；帽梁高程沒填用 原地面−1.0（預設值，請確認）
 *   brace(space, o)                   斜撐／角撐裝不裝：空間 ≥ 最長 2.5−0.10 裝、2.1～2.4 待確認、更小不裝
 *   review(items, threshold)          報價數量 vs 圖面量測的差異（一般 10%、占總價一成以上 5%；只標示、不擋送出）
 *
 * 口徑（Lotion 11/03）：
 *   ① 接頭避開中間樁（接頭合板會讓支撐架不平中間樁托架）與交叉點（上層支撐架在下層上），離中心至少 0.5 M；每個接頭落在「前一支中間樁＋0.5 到與下一支中間樁的中點」之間（Lotion 11/03 再更正）：
 *     先排接頭位置與支承，再考慮長度，條件相同才等長；排不出來照長度排、標紅寫原因；沒有中間樁位置＝不檢查並標示。
 *     位置從該路起點壁面量起；第一支從起點圍令內側（x0＝圍令型鋼高）開始，千斤頂與短節在終點端，接頭位置＝x0＋前幾支合計。
 *   ② 短節備品：全案同一長度合計 ×1.1 無條件進位。③ 短節不算接頭（不加合板、對鎖螺絲）。④ 雙支撐兩支同規格同組合。
 */
(function (root) {
  'use strict';
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var c = function (x) { return Math.round(x * 100); };            // 以公分整數運算，避免小數誤差
  var STOCK = (function () { var a = []; for (var x = 100; x <= 1300; x += 50) if (x !== 1100 && x !== 1150) a.push(x); return a; })();   // 1～13 M 每 0.5，沒有 11、11.5
  var SHORTS = [10, 12, 15, 20, 30, 40, 50, 60];
  var SPEC_H = { H300: 0.30, H350: 0.35, H400: 0.40, H414: 0.414, H428: 0.428 };
  var DEF = { braceMin: 2.2, braceMax: 2.5, jack: 0.7, max1: 13, max2: 10, minGap: 0.5, jackTol: 0.15, clear: 1.5, capDrop: 1.0 };

  function specH(s) { s = String(s || '').replace(/^2/, ''); return SPEC_H[s] != null ? SPEC_H[s] : 0.35; }
  function net(wall, wSpec, jack) { return r2(num(wall) - 2 * specH(wSpec) - (jack == null || jack === '' ? DEF.jack : num(jack))); }

  // 零頭補法：≤ jackTol 由千斤頂伸長；否則短節最少支數（先 1 只、補不到才 2 只）、總長不超過零頭、剩下 ≤ jackTol
  function fill(rem, jackTol) {
    var R = c(rem), T = c(jackTol == null ? DEF.jackTol : jackTol);
    if (R < 0) return null;
    if (R <= T) return { shorts: [], jack: R };
    for (var k = 1; k <= 2; k++) {
      var best = null;
      var pick = function (start, left, cur, sum) {
        if (left === 0) { if (sum <= R && R - sum <= T && (!best || sum > best.sum)) best = { sum: sum, s: cur.slice() }; return; }
        for (var i = start; i < SHORTS.length; i++) { cur.push(SHORTS[i]); pick(i, left - 1, cur, sum + SHORTS[i]); cur.pop(); }
      };
      pick(0, k, [], 0);
      if (best) return { shorts: best.s.sort(function (a, b) { return b - a; }).map(function (x) { return x / 100; }), jack: R - best.sum };
    }
    return null;
  }

  function jointsOf(pieces, x0) { var j = [], s = c(x0 || 0); for (var i = 0; i < pieces.length - 1; i++) { s += c(pieces[i]); j.push(s / 100); } return j; }
  // 排法檢查（Lotion 11/03 原話：「料1與圍令接合後的長度要超過中間樁A至少50cm，但不能超過中間樁A、B中間的長度，以此類推」）：
  //   ① 沿架設方向，每個接頭要落在「前一支中間樁＋gap（0.5 M）」到「前一支中間樁與下一支中間樁的中點」之間（最後一支中間樁之後，下一點＝終點壁面）；
  //     接頭在第一支中間樁之前也不行（料 1 一定要跨過中間樁 A）。這同時涵蓋接頭離中間樁 ≥ 0.5 M 與懸臂。
  //   ② 上層支撐的接頭離交叉點中心（架在下層支撐上的位置）至少 gap。
  //   位置一律從該路起點壁面量起、單位公分整數。回傳違反原因（空＝合格）
  function winMsg(x, MC, G, END) {
    var prev = null, next = null;
    MC.forEach(function (m) { if (m < x && (prev == null || m > prev)) prev = m; if (m >= x && (next == null || m < next)) next = m; });
    if (prev == null) return '接頭 ' + r2(x / 100) + ' M 在第一支中間樁（' + r2(next / 100) + ' M）之前';
    if (x < prev + G) return '接頭 ' + r2(x / 100) + ' M 離中間樁 ' + r2(prev / 100) + ' M 不到 ' + r2(G / 100) + ' M';
    var to = next != null ? next : END;
    if (to != null && isFinite(to) && x > (prev + to) / 2 + 0.5) return '接頭 ' + r2(x / 100) + ' M 超過中間樁 ' + r2(prev / 100) + ' M 與' + (next != null ? '中間樁 ' + r2(next / 100) + ' M ' : '終點壁面') + '的中點 ' + r2((prev + to) / 200) + ' M';
    return null;
  }
  function layCheck(pieces, X0, MC, XC, G, END) {
    var bad = [], b = X0;
    for (var i = 0; i < pieces.length - 1; i++) {
      b += pieces[i];
      if (MC.length) { var w = winMsg(b, MC, G, END); if (w) bad.push(w); }
      XC.forEach(function (m) { if (Math.abs(b - m) < G) bad.push('接頭 ' + r2(b / 100) + ' M 離交叉點 ' + r2(m / 100) + ' M 不到 ' + r2(G / 100) + ' M'); });
    }
    return bad;
  }

  // 一路的定尺組合。o：{ maxLen, mids 中間樁位置[], cross 交叉點位置[], x0 第一支起點, end 終點壁面（＝壁間長度）, minGap, jackTol }
  //   回傳 { pieces[M], total, rem, shorts[], jack(cm), joints, jointPos[], midChk:'ok'|'none'|'conflict'|'single', bad[] 違反原因, err }
  //   先排「每個接頭落在中間樁窗口內（前一支＋0.5～與下一支的中點）、避開交叉點」，再取總長最接近淨長，條件相同才等長；排不出來就照長度排、midChk＝conflict、bad 寫原因
  function combo(N, o) {
    o = o || {};
    var NN = c(N), MAX = c(o.maxLen || DEF.max1), x0 = num(o.x0), gap = o.minGap == null ? DEF.minGap : num(o.minGap);
    var mids = (o.mids || []).map(num).filter(function (x) { return x > 0; }), cross = (o.cross || []).map(num).filter(function (x) { return x > 0; });
    var tol = o.jackTol == null ? DEF.jackTol : num(o.jackTol);
    if (!(NN > 0)) return { err: '淨長不足', pieces: [], total: 0, rem: 0, shorts: [], jack: 0, joints: 0, jointPos: [], midChk: 'single', bad: [] };
    var sd = STOCK.filter(function (x) { return x <= MAX; }).reverse();
    var minFill = c(0.6 * 2 + tol);   // 零頭最多兩只短節＋千斤頂
    var n0 = Math.max(1, Math.ceil((NN - minFill) / MAX - 1e-9));   // 審查：零頭可由短節／千斤頂補，13.10 用 1 支 13＋伸長 10 cm，不拆 2 支
    var X0 = c(x0), MC = mids.map(c), XC = cross.map(c), G = c(gap), chk = MC.length + XC.length > 0;
    var END = o.end > 0 ? c(o.end) : null;
    var jOk = function (pos) { var x = X0 + pos; if (MC.length && winMsg(x, MC, G, END)) return false; for (var i = 0; i < XC.length; i++) if (Math.abs(x - XC[i]) < G) return false; return true; };
    var stepOk = function (k, n, pos, np, use) { return !use || k + 1 === n || jOk(np); };
    // 依序排 n 支、只用 lens 長度、合計＝T：回傳由起點到終點的順序（每步取能完成的最長一支），不行回 null
    var seq = function (n, T, lens, use) {
      var memo = {};
      var can = function (k, pos) {
        var key = k + ':' + pos; if (memo[key] != null) return memo[key];
        var ok = false;
        if (k === n) ok = pos === T;
        else for (var i = 0; i < lens.length && !ok; i++) {
          var np = pos + lens[i];
          if (np > T || !stepOk(k, n, pos, np, use)) continue;
          ok = can(k + 1, np);
        }
        return (memo[key] = ok);
      };
      if (!can(0, 0)) return null;
      var out = [], pos = 0;
      for (var k = 0; k < n; k++) for (var i = 0; i < lens.length; i++) {
        var np = pos + lens[i];
        if (np <= T && stepOk(k, n, pos, np, use) && can(k + 1, np)) { out.push(lens[i]); pos = np; break; }
      }
      return out;
    };
    // 偏好序：總長最接近淨長（不超過、零頭補得到）→ 各支最等長（最長−最短最小）→ 最長那支較長
    var search = function (n, use) {
      for (var T = Math.floor(NN / 50) * 50; T >= NN - minFill && T > 0; T -= 50) {
        var f = fill((NN - T) / 100, tol); if (!f) continue;
        if (!seq(n, T, sd, use)) continue;
        for (var sp = 0; sp <= sd[0] - sd[sd.length - 1]; sp += 50) {
          for (var hi = 0; hi < sd.length; hi++) {
            var lens = sd.filter(function (x) { return x <= sd[hi] && x >= sd[hi] - sp; });
            var o2 = seq(n, T, lens, use);
            if (o2) return { sum: T, f: f, order: o2 };
          }
        }
      }
      return null;
    };
    var best = null, conflict = false;
    for (var n = n0; n <= n0 + 2 && !best; n++) best = search(n, chk);
    if (!best && chk) { for (var n2 = n0; n2 <= n0 + 2 && !best; n2++) best = search(n2, false); conflict = !!best; }
    if (!best) return { err: '找不到可用的定尺組合', pieces: [], total: 0, rem: r2(N), shorts: [], jack: 0, joints: 0, jointPos: [], midChk: 'single', bad: [] };
    var pieces = best.order.map(function (x) { return x / 100; }), jp = jointsOf(pieces, x0);
    return {
      pieces: pieces, total: best.sum / 100, rem: (NN - best.sum) / 100, shorts: best.f.shorts, jack: best.f.jack,
      joints: pieces.length - 1, jointPos: jp, bad: conflict ? layCheck(best.order, X0, MC, XC, G, END) : [],
      midChk: !chk ? (pieces.length < 2 ? 'single' : 'none') : (conflict ? 'conflict' : 'ok')
    };
  }

  function parse(s) {
    var a = String(s == null ? '' : s).replace(/[＋，,、\s]+/g, '+').split('+').map(function (x) { return x.replace(/[MmＭ米]$/, ''); });
    var out = []; a.forEach(function (x) { var m = x.match(/^(\d+(?:\.\d+)?)(?:[x×*](\d+))?$/); if (!m) return; for (var i = 0; i < (m[2] ? parseInt(m[2], 10) : 1); i++) out.push(parseFloat(m[1])); });
    return out.filter(function (x) { return x > 0; });
  }
  function parseBad(s) { return String(s == null ? '' : s).replace(/[＋，,、\s]+/g, '+').split('+').map(function (x) { return x.replace(/[MmＭ米]$/, ''); }).filter(function (x) { return x && !/^(\d+(?:\.\d+)?)(?:[x×*](\d+))?$/.test(x); }); }
  function mids(s) { return String(s == null ? '' : s).split(/[,，、;；\s]+/).map(num).filter(function (x) { return x > 0; }); }

  // 一路完整結果。r：{ ly, id, dir, wall, dbl('雙'|'單'|''), combo 手改字串, mids, note }；o：{ wSpec 該層圍令, sMult 該層支撐倍數, jack, max1, max2, minGap, jackTol }
  function row(r, o) {
    o = o || {};
    var ly = Math.max(1, Math.round(num(r.ly)) || 1);
    var maxLen = ly === 1 ? (num(o.max1) || DEF.max1) : (num(o.max2) || DEF.max2);
    var N = net(r.wall, o.wSpec, o.jack), M = mids(r.mids), X = mids(r.cross), x0 = specH(o.wSpec), tol = o.jackTol == null ? DEF.jackTol : num(o.jackTol);
    var gap = o.minGap == null || o.minGap === '' ? DEF.minGap : num(o.minGap);
    var dblS = String(r.dbl || '').trim();
    var mult = dblS === '雙' || dblS === '2' ? 2 : (dblS === '單' || dblS === '1' ? 1 : (num(o.sMult) || 1));
    var auto = combo(N, { maxLen: maxLen, mids: M, cross: X, x0: x0, end: num(r.wall), minGap: gap, jackTol: tol }), res = auto, manual = false, warn = [];
    var mp = parse(r.combo), mpBad = parseBad(r.combo);
    if (mp.length) {
      manual = true;
      var sum = c(mp.reduce(function (a, b) { return a + b; }, 0)), NN = c(N), f = fill((NN - sum) / 100, tol), jp = jointsOf(mp, x0);
      if (sum > NN) warn.push('手改組合 ' + r2(sum / 100) + ' M 超過淨長 ' + N + ' M');
      else if (!f) warn.push('手改組合零頭 ' + r2((NN - sum) / 100) + ' M 短節補不到');
      if (mp.some(function (x) { return STOCK.indexOf(c(x)) < 0; })) warn.push('手改組合有非定尺長度');
      if (mpBad.length) warn.push('手改組合看不懂：' + mpBad.join('、'));
      if (mp.some(function (x) { return c(x) > c(maxLen); })) warn.push('手改組合超過第 ' + ly + ' 層單支最長 ' + maxLen + ' M');
      var bad = layCheck(mp.map(c), c(x0), M.map(c), X.map(c), c(gap), c(num(r.wall)) || null);
      var mc = !(M.length + X.length) ? (mp.length < 2 ? 'single' : 'none') : (bad.length ? 'conflict' : 'ok');
      res = { pieces: mp, total: sum / 100, rem: (NN - sum) / 100, shorts: f ? f.shorts : [], jack: f ? f.jack : 0, joints: mp.length - 1, jointPos: jp, midChk: mc, bad: bad };
    }
    if (res.err) warn.push(res.err);
    if (res.midChk === 'conflict') warn.push('排不出合格的組合：' + (res.bad || []).join('；'));
    return {
      ly: ly, id: String(r.id || ''), dir: String(r.dir || ''), wall: num(r.wall), net: N, mult: mult, maxLen: maxLen, manual: manual,
      pieces: res.pieces, total: res.total, rem: r2(res.rem), shorts: res.shorts, jack: res.jack, joints: res.joints, jointPos: res.jointPos, midChk: res.midChk,
      mids: M, cross: X, bad: res.bad || [], auto: auto.pieces, supM: r2(Math.max(0, N) * mult), jointsN: res.joints * mult, shortsN: res.shorts.length * mult, note: String(r.note || ''), warn: warn
    };
  }

  // 全案短節：同長度合計 ×1.1 無條件進位（雙支撐兩支都算）
  function spares(results) {
    var cnt = {};
    (results || []).forEach(function (x) { (x.shorts || []).forEach(function (s) { var k = r2(s); cnt[k] = (cnt[k] || 0) + (x.mult || 1); }); });
    var out = Object.keys(cnt).map(parseFloat).sort(function (a, b) { return a - b; }).map(function (k) { return { len: k, n: cnt[k], order: Math.ceil(cnt[k] * 1.1 - 1e-9) }; });
    return { rows: out, n: out.reduce(function (a, b) { return a + b.n; }, 0), order: out.reduce(function (a, b) { return a + b.order; }, 0) };
  }

  // CSV：層,路編號,方向,壁間長度,單雙,定尺組合,備註,中間樁位置 M,交叉點位置 M（多個位置用逗號分隔、整格用雙引號包起來）；第一列是標題就略過
  function csv(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/), rows = [], errs = [];
    var split = function (s) { var out = [], cur = '', q = false; for (var i = 0; i < s.length; i++) { var ch = s[i]; if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',' || ch === '\t') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(function (x) { return x.trim(); }); };
    lines.forEach(function (ln, i) {
      if (!ln.trim()) return;
      var f = split(ln);
      if (i === 0 && !(num(f[3]) > 0) && /層|路|壁/.test(ln)) return;
      var ly = Math.round(num(String(f[0]).replace(/^L|第|層$/g, ''))), wall = num(f[3]);
      if (!(ly >= 1) || !(wall > 0)) { errs.push('第 ' + (i + 1) + ' 列：層或壁間長度不對'); return; }
      var dir = /橫|H/i.test(f[2] || '') ? '橫' : '縱';
      rows.push({ ly: ly, id: f[1] || '', dir: dir, wall: wall, dbl: /雙|2/.test(f[4] || '') ? '雙' : (/單|1/.test(f[4] || '') ? '單' : ''), combo: f[5] || '', note: f[6] || '', mids: f[7] || '', cross: f[8] || '' });
    });
    return { rows: rows, errs: errs };
  }

  // 構台下淨空＝帽梁底 − 支撐頂（三角架高程＋型鋼高；或支撐中心＋型鋼高÷2）。o：{ triEl 三角架高程, capEl 構台帽高程（填帽頂即可，帽頂鋼板 1～2 cm 直接當帽梁底；空白＝原地面−capDrop）, capRef 'top' 時另扣 capH（預留）, groundEl 原地面高程, supEl 支撐中心高程, sSpec 支撐規格, clear 門檻 }
  function clearance(o) {
    o = o || {};
    var tri = o.triEl != null && o.triEl !== '' && isFinite(parseFloat(o.triEl));   // 三角架高程（下支撐下緣＝三角托架面，Lotion 11/03）優先；支撐中心高程 supEl 保留相容
    if (!tri && (o.supEl == null || o.supEl === '' || !isFinite(parseFloat(o.supEl)))) return null;
    var def = o.capEl == null || o.capEl === '' || !isFinite(parseFloat(o.capEl));
    var capEl = def ? num(o.groundEl) - (o.capDrop == null || o.capDrop === '' ? DEF.capDrop : num(o.capDrop)) : num(o.capEl);
    var bottom = o.capRef === 'top' ? capEl - num(o.capH) : capEl;
    var top = tri ? num(o.triEl) + specH(o.sSpec) : num(o.supEl) + specH(o.sSpec) / 2;   // 支撐頂
    var cl = r2(bottom - top);
    var th = o.clear == null || o.clear === '' ? DEF.clear : num(o.clear);
    return { clear: cl, pull: cl >= th - 1e-9, isDef: def, bottom: r2(bottom), th: th };
  }

  // 斜撐／角撐（固定長度的料，角撐＝斜撐同長；Lotion 11/03）：可用空間 ≥ 最長 − 0.10 M 才裝（最多凸出 10 cm）；
  //   介於「最短 − 0.10」與「最長 − 0.10」之間標待確認；更小不裝。o：{ min 最短（2.2）, max 最長（2.5，預設用它做空間檢查）, over 可凸出（0.10）}
  //   可用空間要等量測檔（HQ JSON，11/05 定格式）才有，畫面先不接
  function brace(space, o) {
    o = o || {};
    var mn = o.min == null || o.min === '' ? DEF.braceMin : num(o.min), mx = o.max == null || o.max === '' ? DEF.braceMax : num(o.max), ov = o.over == null || o.over === '' ? 0.1 : num(o.over);
    if (space == null || space === '' || !isFinite(parseFloat(space))) return { fit: 'none' };
    var S = c(num(space));
    if (S >= c(mx - ov)) return { fit: 'yes' };
    if (S >= c(mn - ov)) return { fit: 'check', note: '空間 ' + r2(S / 100) + ' M，介於 ' + r2(mn - ov) + '～' + r2(mx - ov) + ' M，待確認' };
    return { fit: 'no', note: '空間 ' + r2(S / 100) + ' M 不到 ' + r2(mn - ov) + ' M，不裝' };
  }

  // 圖面覆核：items [{ idx, desc, unit, qty 報價數量, meas 圖面量測, amt 該項金額 }]；total 總價（未稅）
  function review(items, total) {
    var T = num(total) || (items || []).reduce(function (a, b) { return a + num(b.amt); }, 0), out = [];
    (items || []).forEach(function (it) {
      if (it.meas == null || it.meas === '' || !(num(it.meas) > 0)) return;
      var d = (num(it.qty) - num(it.meas)) / num(it.meas), big = T > 0 && num(it.amt) >= T * 0.1, th = big ? 0.05 : 0.10;
      out.push({ idx: it.idx, desc: it.desc || '', unit: it.unit || '', qty: num(it.qty), meas: num(it.meas), pct: Math.round(d * 1000) / 10, big: big, th: th * 100, bad: Math.abs(d) > th + 1e-9 });
    });
    return { rows: out, nBad: out.filter(function (x) { return x.bad; }).length };
  }

  // 排法檢查（給手改組合與對照表用）：pieces[M]、o：{ x0, mids[], cross[], wall 終點壁面, minGap } → 違反原因[]（空＝合格）
  function check(pieces, o) { o = o || {}; return layCheck((pieces || []).map(c), c(num(o.x0)), (o.mids || []).map(num).filter(function (x) { return x > 0; }).map(c), (o.cross || []).map(num).filter(function (x) { return x > 0; }).map(c), c(o.minGap == null ? DEF.minGap : num(o.minGap)), num(o.wall) > 0 ? c(num(o.wall)) : null); }

  var api = { brace: brace, check: check, STOCK: STOCK.map(function (x) { return x / 100; }), SHORTS: SHORTS.map(function (x) { return x / 100; }), DEF: DEF, specH: specH, net: net, fill: fill, combo: combo, parse: parse, mids: mids, row: row, spares: spares, csv: csv, clearance: clearance, review: review };
  root.FJC = root.FJC || {};
  root.FJC.route = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FJC;
})(typeof window !== 'undefined' ? window : globalThis);
