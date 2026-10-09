#!/usr/bin/env node
/*
 * 施工計畫書圖面全數出圖（v6.0.53）
 * 用法：node tools/render-plan-drawings.js <index.html 所在目錄> <輸出目錄>
 *   輸出 <輸出目錄>/png/*.png 與 hash.json（每張圖的 md5）。
 *   改動圖庫前後各跑一次，比對兩份 hash.json 即可確認哪些圖變了；
 *   png 檔名＝圖類＋工項＋工法，直接用來送使用者檢核。
 * 圖類：圖組（FY_SHEETS 各頁）、步驟（_plStoryPNG，目前只剩水平支撐）、詳圖（_plDetailPNG）、流程（各圖組步驟的施工流程圖）
 * 需要 playwright；雲端環境設 CHROMIUM_PATH=/opt/pw-browsers/chromium。
 */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.resolve(process.argv[2] || '.'), OUT = path.resolve(process.argv[3] || 'plan-drawings');
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'png'), { recursive: true });
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage(); const perr = []; p.on('pageerror', e => perr.push(e.message));
  await p.goto('file://' + path.join(DIR, 'index.html')); await p.waitForTimeout(3000);
  const jobs = await p.evaluate(() => {
    const J = [];
    FY_SHEETS.list().forEach(s => J.push({ k: 'sheet', id: s.id, name: '圖組_' + s.code + '_' + s.title }));
    PLAN_ITEMS.forEach(it => {
      J.push({ k: 'story', id: it.id, meth: '', name: '步驟_' + (it.short || it.name) });
      J.push({ k: 'detail', id: it.id, name: '詳圖_' + (it.short || it.name) });
    });
    FY_SHEETS.list().forEach(s => J.push({ k: 'flow', id: s.id, name: '流程_' + s.code + '_' + s.title }));
    return J;
  });
  const res = {}; let n = 0;
  for (const j of jobs) {
    let imgs;
    try {
      imgs = await p.evaluate(j => {
        const it = PLAN_ITEMS.find(x => x.id === j.id); const m = {};
        if (it) (it.vars || []).forEach(v => { m[v.k] = v.d || ''; });
        const one = x => x == null ? [] : [typeof x === 'string' ? x : (x.b64 || '')];
        if (j.k === 'sheet') return (FY_SHEETS.pages(j.id, 1.5) || []).map(x => x.b64);
        if (j.k === 'story') return one(_plStoryPNG(j.id, m, j.meth));
        if (j.k === 'detail') return one(_plDetailPNG(j.id, m));
        if (j.k === 'flow') { const st = FY_SHEETS.steps(j.id) || []; return (_plFlowPages(st.map(s => s.t), {}) || []).map(x => typeof x === 'string' ? x : x.b64); }
      }, j);
    } catch (e) { imgs = ['ERR:' + String(e).split('\n')[0].slice(0, 120)]; }
    imgs = (imgs || []).filter(Boolean);
    if (!imgs.length) continue;
    res[j.name] = imgs.map((d, k) => {
      if (String(d).startsWith('ERR:')) return d;
      const buf = Buffer.from(String(d).replace(/^data:[^,]*,/, ''), 'base64');
      const fn = (j.name + (imgs.length > 1 ? ('_' + (k + 1)) : '')).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '') + '.png';
      fs.writeFileSync(path.join(OUT, 'png', fn), buf); n++;
      return fn + ' ' + crypto.createHash('md5').update(buf).digest('hex');
    });
  }
  fs.writeFileSync(path.join(OUT, 'hash.json'), JSON.stringify(res, null, 1));
  console.log('圖', n, '張；頁面錯誤', perr.length);
  await b.close();
})();
