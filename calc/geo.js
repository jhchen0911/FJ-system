// 擴充線 B（Lotion 11/11）：鑽探地層地圖（最小版）的純計算——不讀畫面、不讀全域資料，值由參數傳入。
// 每案 q.geo＝{lat,lng,addr,soil:{fill,main,n,gw},src,at,draft}；座標由電腦端（Lotion-HQ）轉好跟地層草稿一起上傳（B-1）。
// 前端 app.js（FJC.geo）與雲端 fyDraft（functions/ops/drafts.js，type geo）共用 clean；對外函式只能新增、不能改既有參數或意義。
(function (root) {
  'use strict';
  function num(v) { var n = parseFloat(v); return isNaN(n) ? NaN : n; }
  function S(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 200); }
  // 台灣本島＋離島的大致範圍；超出就當成座標打錯（經緯度對調最常見）
  var BOX = { lat0: 21.5, lat1: 26.6, lng0: 118.0, lng1: 122.5 };
  function okLL(lat, lng) { return isFinite(lat) && isFinite(lng) && lat >= BOX.lat0 && lat <= BOX.lat1 && lng >= BOX.lng0 && lng <= BOX.lng1; }
  // 一案的地層資料：只收白名單欄位、長度有上限；座標不合理回 err（不猜）。
  // 欄位對電腦端鑽探摘要 CSV（陳軒 11/12）：soil.fill 回填層文字、fillDepth 回填底深 m（範圍取最大值）、layers 主要土層（由上而下 →）、
  //   nText N 值範圍、gw {obs 觀測, tmp 設計臨時, perm 設計永久}；method 抽取方式（PDF文字／OCR／轉引）、acc 座標來源（精度旗標）、
  //   unit 鑽探單位、rptDate 報告日期、rpt 報告檔相對路徑、folder 案件資料夾、note 備註、src 來源說明。舊名 main／n／gw 字串照收。
  function fillDepthOf(v, txt) {
    var n = num(v); if (isFinite(n) && n > 0 && n < 100) return Math.round(n * 100) / 100;
    var m = String(txt || '').replace(/[－−–—]/g, '-').match(/\d+(?:\.\d+)?(?=\s*m)/gi);   // 「GL-0～-2.8m」→ 2.8（取最大值）
    if (!m) return null; var x = Math.max.apply(null, m.map(parseFloat)); return x > 0 && x < 100 ? x : null;
  }
  function clean(g) {
    g = (g && typeof g === 'object') ? g : {};
    var s = (g.soil && typeof g.soil === 'object') ? g.soil : {}, gw = s.gw, gwo = (gw && typeof gw === 'object') ? gw : { obs: gw };
    var o = { lat: null, lng: null, addr: S(g.addr, 120),
      soil: { fill: S(s.fill, 120), fillDepth: fillDepthOf(s.fillDepth, s.fill), layers: S(s.layers != null ? s.layers : s.main, 300), nText: S(s.nText != null ? s.nText : s.n, 200),
        gw: { obs: S(gwo.obs, 60), tmp: S(gwo.tmp, 60), perm: S(gwo.perm, 60) } },
      method: S(g.method, 20), acc: S(g.acc, 40), unit: S(g.unit, 60), rptDate: S(g.rptDate, 20), rpt: S(g.rpt, 200), folder: S(g.folder, 120), note: S(g.note, 300), src: S(g.src, 80) };
    // 擴充線 B-6：不掛報價的舊案。old＝FJ 沒有報價（CSV 第 11 欄「FJ查無報價」或 old:true）；res＝當時結果（得標／失標／報價中／流標）
    var fj = S(g.fjStatus, 20), rs = S(g.res, 20);
    if (g.old === true || /查無報價/.test(fj)) o.old = true;
    var rr = /^(won|得標)$/.test(rs) ? 'won' : (/^(lost|失標|未得標)$/.test(rs) ? 'lost' : (/^(void|流標)$/.test(rs) ? 'void' : (/^(open|報價中|未定)$/.test(rs) ? 'open' : '')));
    if (rr) o.res = rr;
    var lat = num(g.lat), lng = num(g.lng);
    if (g.lat == null || g.lat === '' || g.lng == null || g.lng === '') return { err: '沒有座標（電腦端查不到' + (o.acc ? '：' + o.acc : '') + '）', g: null, part: o };
    if (!okLL(lat, lng)) {
      if (okLL(lng, lat)) return { err: '座標好像經緯度對調了（lat 要在 21.5～26.6、lng 要在 118～122.5）', part: o };
      return { err: '座標不在台灣範圍（lat 21.5～26.6、lng 118～122.5）', part: o };
    }
    o.lat = Math.round(lat * 1e6) / 1e6; o.lng = Math.round(lng * 1e6) / 1e6;
    return { g: o };
  }
  // 要人工確認的：OCR 讀的數字、概略位置（里中心）
  function needCheck(g) { var w = []; if (g && /OCR/i.test(g.method || '')) w.push('OCR 讀的數字要人工確認'); if (g && /里中心|概略/.test(g.acc || '')) w.push('位置是概略（' + g.acc + '）'); return w; }
  function hasSoil(g) { var s = g && g.soil, w = s && s.gw; return !!(s && (s.fill || s.layers || s.main || s.nText || s.n || (w && (typeof w === 'object' ? (w.obs || w.tmp || w.perm) : w)))); }
  // 兩點距離（公里，haversine）
  function dist(a, b) {
    var R = 6371, rad = Math.PI / 180, dLat = (num(b.lat) - num(a.lat)) * rad, dLng = (num(b.lng) - num(a.lng)) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(num(a.lat) * rad) * Math.cos(num(b.lat) * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  // 半徑 r 公里內的舊案：list＝[{id, lat, lng, ...}]，排除自己（selfId），由近到遠；km 取到 0.01
  function near(list, pt, r, selfId) {
    if (!pt || !okLL(num(pt.lat), num(pt.lng))) return [];
    var R = num(r) > 0 ? num(r) : 2;
    return (list || []).filter(function (x) { return x && x.id !== selfId && okLL(num(x.lat), num(x.lng)); })
      .map(function (x) { var o = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k]; o.km = Math.round(dist(pt, x) * 100) / 100; return o; })
      .filter(function (x) { return x.km <= R + 1e-9; })
      .sort(function (a, b) { return a.km - b.km; });
  }
  // 接工率（跟前端 _bidStat 同一套）：得標 ÷（得標＋未得標）；議價中、待回覆、流標不算。res：'won'／'lost'／'open'／'void'
  function rate(list) {
    var w = 0, l = 0, o = 0, v = 0;
    (list || []).forEach(function (x) { var r = x && x.res; if (r === 'won') w++; else if (r === 'lost') l++; else if (r === 'void') v++; else o++; });
    return { won: w, lost: l, open: o, void: v, decided: w + l, rate: (w + l) ? Math.round(w / (w + l) * 1000) / 10 : null };
  }
  // 點位圖（沒有底圖，B-2）：以 pt 為圓心、半徑 r 公里的圈畫在 size×size 的方框；回傳每點 {x,y}（像素，北朝上）
  function plot(points, pt, r, size) {
    var R = num(r) > 0 ? num(r) : 2, W = num(size) > 0 ? num(size) : 240, c = W / 2, pad = 10, k = (c - pad) / R;
    var kmLat = 111.32, kmLng = 111.32 * Math.cos(num(pt.lat) * Math.PI / 180);
    return (points || []).map(function (p) {
      var dx = (num(p.lng) - num(pt.lng)) * kmLng, dy = (num(p.lat) - num(pt.lat)) * kmLat;
      return { x: Math.round((c + dx * k) * 10) / 10, y: Math.round((c - dy * k) * 10) / 10 };
    });
  }
  var geo = { BOX: BOX, okLL: okLL, clean: clean, needCheck: needCheck, fillDepthOf: fillDepthOf, hasSoil: hasSoil, dist: dist, near: near, rate: rate, plot: plot };
  if (typeof module !== 'undefined' && module.exports) module.exports = { geo: geo };
  if (root) { root.FJC = root.FJC || {}; root.FJC.geo = geo; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
