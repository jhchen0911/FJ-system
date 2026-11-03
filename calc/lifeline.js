/* 豐有工程管理系統．計算模組：安全母索（改版第 3c 步，v6.0.136）
 * 安全母索頁與材料估算共用同一套算法（Lotion 11/03 決定合併）。純計算：掛在 window.FJC.ll；Node：require('./calc/lifeline.js').ll
 * 規則同其他 calc：對外函式只能新增，不能改既有參數或意義。
 *
 *   calc(st, forms)
 *     st：{ perim 每層周圍長度, perimRuns 周圍路數, layers 層數, deductLayers 扣構台下的層數, unit 'cm'|'m'（區塊每路長度的單位）,
 *           useSpare 是否計端部預留, waste 損耗%, form 預設形式 'wire'|'rope',
 *           f：{ wire|rope：{ spec, spare 每路端部預留 M, reel 每捲 M, acc [每路配件數×3] } },
 *           zones：[{ name, deck 是否構台下, form ''=跟預設, v|h：{ runs 宣告路數, rows：[{ n 路數, len 每路長 }] } }] }
 *     forms：{ wire|rope：{ label, specs：[[規格, kg/m]] } }
 *   口徑（Lotion 11/03）：周圍一路＝1 倍周長（不乘圍令倍數）；構台下扣長度、配件也不算構台下的路，但端部預留照全部路數算（不扣）；
 *         需求長度＝（淨長＋端部預留）×（1＋損耗%）；黃色立柱＝淨長 ÷ 2.5 M。逐層：第 1～扣除層數層各扣構台下長度（全部扣除以總長為上限）。
 */
(function (root) {
  'use strict';
  var num = function (x) { var n = typeof x === 'string' ? parseFloat(x) : x; return (typeof n === 'number' && isFinite(n)) ? n : 0; };
  var int = function (x) { return Math.max(0, Math.round(num(x))); };
  var UNIT = { cm: 0.01, m: 1 };
  var FORMS = ['wire', 'rope'];

  function specW(forms, t, spec) { var F = (forms && forms[t]) || {}; var s = (F.specs || []).find(function (x) { return x[0] === spec; }); return s ? s[1] : 0; }

  function calc(st, forms) {
    st = st || {}; forms = forms || {};
    var u = UNIT[st.unit] || 0.01;
    var dirOf = function (dir) {
      var rows = (dir && dir.rows) || [];
      var cnt = rows.reduce(function (a, r) { return a + num(r.n); }, 0);
      var len = rows.reduce(function (a, r) { return a + num(r.n) * num(r.len) * u; }, 0);
      var dec = num(dir && dir.runs);
      return { cnt: cnt, len: len, dec: dec, ok: dec > 0 ? (Math.abs(dec - cnt) < 1e-9) : null };
    };
    var zones = (st.zones || []).map(function (z) {
      var V = dirOf(z.v), H = dirOf(z.h);
      return { name: z.name || '', deck: !!z.deck, own: z.form || '', form: (z.form === 'wire' || z.form === 'rope') ? z.form : st.form, v: V, h: H, len: V.len + H.len, runs: V.cnt + H.cnt };
    });
    var perim = num(st.perim), layers = int(st.layers), dl = Math.min(layers, int(st.deductLayers)), waste = num(st.waste);
    var T = {}, used = [], warn = [];
    FORMS.forEach(function (t) {
      var zs = zones.filter(function (z) { return z.form === t; });
      var pick = function (deck, key) { return zs.filter(function (z) { return !!z.deck === deck; }).reduce(function (a, z) { return a + z[key]; }, 0); };
      var zoneLen = pick(false, 'len'), deckLen = pick(true, 'len'), zoneRuns = pick(false, 'runs'), deckRuns = pick(true, 'runs');
      var pm = (st.form === t) ? perim : 0, pr = (st.form === t) ? int(st.perimRuns) : 0;
      var fp = ((st.f || {})[t]) || {};
      var spareLen = num(fp.spare), reel = num(fp.reel), w = specW(forms, t, fp.spec);
      var perLayer = pm + zoneLen, layerRuns = zoneRuns + pr, detail = [], spare = 0;
      var deduct = Math.min(perLayer * layers, deckLen * dl), rem = deduct;   // 構台下扣除＝構台下長×扣除層數（以總長為上限，同既有 Excel）
      for (var i = 0; i < layers; i++) {
        var ded = i < dl ? Math.min(deckLen, rem) : 0, sp = st.useSpare ? layerRuns * spareLen : 0;
        rem -= ded; spare += sp;
        detail.push({ L: i + 1, wal: pm, sup: zoneLen, ded: ded, len: perLayer - ded, runs: layerRuns, spare: sp });
      }
      if (deckLen > 0 && perLayer <= 0) warn.push(((forms[t] || {}).label || t) + '：構台下區塊標了這個形式，但沒有同形式的一般區塊或周長可供扣除，扣除未生效');
      var gross = perLayer * layers, net = gross - deduct;
      var runs = Math.max(0, Math.round(layerRuns * layers - deckRuns * dl));   // 實際拉的路數（配件用）：構台下沒拉
      var need = (net + spare) * (1 + waste / 100);
      var r = { form: t, label: (forms[t] || {}).label || t, spec: fp.spec, unitW: w, zoneCount: zs.length, used: zs.length > 0 || st.form === t,
        perim: pm, perimRuns: pr, zoneLen: zoneLen, deckLen: deckLen, zoneRuns: zoneRuns, deckRuns: deckRuns,
        perLayer: perLayer, gross: gross, deduct: deduct, net: net, runs: runs, spareRuns: layerRuns * layers, spare: spare, need: need,
        reels: reel > 0 ? Math.ceil(need / reel) : 0, reel: reel, kg: need * w, yellow: net / 2.5, layers: detail,
        acc: (fp.acc || [0, 0, 0]).map(function (n) { return runs * int(n); }) };
      T[t] = r; if (r.used) used.push(r);
    });
    var bad = [];
    zones.forEach(function (z) { if (z.v.ok === false) bad.push((z.name || '區塊') + ' 縱向'); if (z.h.ok === false) bad.push((z.name || '區塊') + ' 橫向'); });
    var sum = function (k) { return used.reduce(function (a, x) { return a + x[k]; }, 0); };
    return { zones: zones, T: T, used: used, mixed: used.length > 1, layers: layers, deductLayers: dl, perim: perim, waste: waste,
      perLayer: sum('perLayer'), gross: sum('gross'), deduct: sum('deduct'), net: sum('net'), runs: sum('runs'), spare: sum('spare'),
      need: sum('need'), reels: sum('reels'), kg: sum('kg'), yellow: sum('yellow'), zoneLen: sum('zoneLen'), deckLen: sum('deckLen'), bad: bad, warn: warn };
  }

  var ll = { calc: calc, specW: specW };
  var FJC = root.FJC || (root.FJC = {});
  FJC.ll = ll;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
