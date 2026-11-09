// 報價結果統計（改版第 7 步③ 7b，Lotion 11/09 第 5 題）：純計算，不讀畫面、不讀全域資料。
// 每張報價記結果（得標／沒得標、報價、最後成交價、讓了多少、對手價）→ 依「工項類別」統計得標率與平均讓價 →
// 滿 5 筆才給「建議目標價調 ±Y%」。只給建議，不改任何報價。
// 對外函式只能新增、不能改既有參數或意義（CLAUDE.md calc 規則）。
(function (root) {
  'use strict';
  var MIN_N = 5;
  // 工項類別：看工項說明第一行（順序有關：先比較特定的）
  var CATS = [
    ['sheet', '鋼板樁', /鋼[板鈑]樁/],
    ['rail', '鋼軌樁', /鋼軌/],
    ['hpile', 'H型鋼樁', /H\s*型?鋼|型鋼樁|H\s*\d{3}|中間[樁柱]/i],
    ['strut', '水平支撐', /支撐|圍令|斜撐|角撐|千斤頂/],
    ['deck', '構台', /構台/],
    ['prebore', '預壘樁', /預壘/],
    ['anchor', '地錨', /地錨/],
    ['ccp', 'CCP／灌漿', /CCP|灌漿|止水/i],
    ['other', '其他', null]
  ];
  function N(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function catName(c) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === c) return CATS[i][1]; return '其他'; }
  function itemCat(desc) {
    var d = String(desc == null ? '' : desc).split('\n')[0];
    for (var i = 0; i < CATS.length; i++) if (CATS[i][2] && CATS[i][2].test(d)) return CATS[i][0];
    return 'other';
  }
  // 一張報價算哪一類：金額最大的那一類（段落、備用單價、減項不算）
  function quoteCat(items) {
    var sum = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || it.sec || it.spare) return;
      var a = N(it.qty) * N(it.price); if (!(a > 0)) return;
      var c = itemCat(it.desc); sum[c] = (sum[c] || 0) + a;
    });
    var best = 'other', bv = -1;
    Object.keys(sum).forEach(function (c) { if (sum[c] > bv || (sum[c] === bv && c < best)) { best = c; bv = sum[c]; } });
    return best;
  }
  // 讓了多少：報價 − 成交價（同為未稅）；比例＝讓價 ÷ 報價（％，一位小數）
  function concede(quoted, final) {
    var q = N(quoted), f = N(final);
    if (!(q > 0) || !(f > 0)) return { amt: null, pct: null };
    return { amt: Math.round(q - f), pct: Math.round((q - f) / q * 1000) / 10 };
  }
  // 建議目標價調幅（％）：先打掉平均讓價（得標案平均讓多少，目標價就預先少多少）；
  // 得標率低於 40% 再多 −2%、高於 80% 改成 +2%（行情還有空間）；上下限 ±15%。筆數不到 5 筆不給。
  function suggest(st) {
    if (!st || !(st.n >= MIN_N)) return null;
    var y = -(st.avgConcedePct || 0);
    if (st.winRate < 40) y -= 2; else if (st.winRate > 80) y += 2;
    y = Math.max(-15, Math.min(15, y));
    return Math.round(y * 10) / 10;
  }
  // recs：[{cat, res:'won'|'lost'|'void', quoted, final}]；流標（void）不算分母
  function stats(recs) {
    var by = {};
    (Array.isArray(recs) ? recs : []).forEach(function (r) {
      if (!r || (r.res !== 'won' && r.res !== 'lost')) return;
      var c = r.cat || 'other', s = by[c] || (by[c] = { cat: c, name: catName(c), n: 0, won: 0, lost: 0, cn: 0, cs: 0 });
      s.n++; if (r.res === 'won') { s.won++; var k = concede(r.quoted, r.final); if (k.pct != null) { s.cn++; s.cs += k.pct; } } else s.lost++;
    });
    return Object.keys(by).sort().map(function (c) {
      var s = by[c];
      var o = { cat: s.cat, name: s.name, n: s.n, won: s.won, lost: s.lost,
        winRate: s.n ? Math.round(s.won / s.n * 1000) / 10 : 0,
        avgConcedePct: s.cn ? Math.round(s.cs / s.cn * 10) / 10 : 0, concedeN: s.cn, ready: s.n >= MIN_N };
      o.suggestPct = suggest(o);
      return o;
    });
  }
  var api = { MIN_N: MIN_N, CATS: CATS.map(function (c) { return [c[0], c[1]]; }), catName: catName, itemCat: itemCat, quoteCat: quoteCat, concede: concede, suggest: suggest, stats: stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FJC = root.FJC || {}; root.FJC.bid = api;
})(typeof window !== 'undefined' ? window : globalThis);
