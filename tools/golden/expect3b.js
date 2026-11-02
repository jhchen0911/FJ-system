// 第 3b 步（v6.0.135）預期差異清單核對：base.json（main 的程式）vs branch.json（3b 分支），只允許清單上的欄位變、而且能算的要等於理論值。
//
//   node tools/golden/expect3b.js --snapshot <快照.json> --base <base.json> --branch <branch.json> [--out <私人清單.json>]
//
//   會變（清單 docs/3b_預期差異清單.md）：
//     B1 專案毛利 stat.profit ＝ round(合約 base ÷ (1＋稅率)) − 施工成本 costNet（理論值逐案核對）
//     B4 報價毛利／淨利 quote.gross／net ＝ 未稅小計 sub − 成本 cost（− 附加 ext）（理論值逐張核對）
//     A1～A6 股東報表年度 year.revNet／cost／gross／exp／pretax／cap（口徑改變，只核對「有變的欄位在這幾個裡面」）
//   不能變：其他所有欄位（含 year.revTax／ret／recv／hr／drawn、每期請款、分包、應付、專案已請／已收／應收／合約）
//   只印一行「符合預期／不符預期＋筆數」，不印案名與金額；--out 另存含 id 與欄位的私人清單（只放 %USERPROFILE%\FJ-golden\）
const fs = require('fs');
function arg(n) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; }
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const SNAP = arg('snapshot'), BASE = arg('base'), BR = arg('branch'), OUT = arg('out');
if (!SNAP || !BASE || !BR) { console.error('用法：node tools/golden/expect3b.js --snapshot <快照.json> --base <base.json> --branch <branch.json> [--out <私人清單.json>]'); process.exit(2); }
let snap, base, br;
try { snap = read(SNAP); base = read(BASE); br = read(BR); } catch (e) { console.error('檔案讀不到或不是有效的 JSON'); process.exit(2); }
const pr = (snap.params && typeof snap.params === 'object') ? snap.params : {};
const tR = (pr.tax != null && pr.tax !== '' && isFinite(parseFloat(pr.tax))) ? parseFloat(pr.tax) : 5, tm = 1 + tR / 100;
const R = x => Math.round(Number(x) * 100) / 100;
const YEAR_OK = { revNet: 1, cost: 1, gross: 1, exp: 1, pretax: 1, cap: 1 };
const cnt = { profit: 0, quote: 0, year: {} }, wrong = [], outside = [];
['quote', 'stat', 'inv', 'sub', 'pay', 'year'].forEach(sec => {
  const A = base[sec] || {}, B = br[sec] || {};
  new Set(Object.keys(A).concat(Object.keys(B))).forEach(id => {
    const x = A[id] || {}, y = B[id] || {};
    if (!(id in A) || !(id in B)) { outside.push(sec + ' ' + id + ' (整筆)'); return; }
    let qDiff = false;
    new Set(Object.keys(x).concat(Object.keys(y))).forEach(f => {
      if (JSON.stringify(x[f]) === JSON.stringify(y[f])) return;
      if (sec === 'stat' && f === 'profit') {
        cnt.profit++;
        const exp = R(Math.round((y.base || 0) / tm) - (y.costNet || 0));
        if (Math.abs(exp - (y.profit || 0)) > 0.01) wrong.push('stat ' + id + ' profit');
        return;
      }
      if (sec === 'quote' && (f === 'gross' || f === 'net')) {
        qDiff = true;
        const exp = R((y.sub || 0) - (y.cost || 0) - (f === 'net' ? (y.ext || 0) : 0));
        if (Math.abs(exp - (y[f] || 0)) > 0.02) wrong.push('quote ' + id + ' ' + f);
        return;
      }
      if (sec === 'year' && YEAR_OK[f]) { cnt.year[f] = (cnt.year[f] || 0) + 1; return; }
      outside.push(sec + ' ' + id + ' ' + f);
    });
    if (qDiff) cnt.quote++;
  });
});
const yTxt = Object.keys(YEAR_OK).filter(k => cnt.year[k]).map(k => ({ revNet: '營收', cost: '成本', gross: '毛利', exp: '費用', pretax: '稅前', cap: '分潤上限' })[k] + ' ' + cnt.year[k]).join('、') || '無';
const ok = !outside.length && !wrong.length;
console.log((ok ? '符合預期' : '不符預期') + '：專案毛利 ' + cnt.profit + ' 案、報價毛利淨利 ' + cnt.quote + ' 張（理論值不符 ' + wrong.length + ' 筆）；股東報表年度：' + yTxt + '；清單外 ' + outside.length + ' 筆');
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ cnt, wrong, outside }, null, 1));
process.exit(ok ? 0 : 1);
