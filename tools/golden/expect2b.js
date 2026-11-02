// 第 2b 步（v6.0.128）預期差異清單：從凍結快照算出「理論上會變的案子」，再和 compare.js 的實際差異逐筆對照。
//
//   node tools/golden/expect2b.js --snapshot <快照.json> --base <base.json> --branch <branch.json> [--out <私人清單.json>]
//
//   2b 會改到黃金樣本的只有一個欄位：專案統計的「已收款」（stat.recv）——原本只加另記的保留款退還，漏了「業主當場扣款、之後退還」的現金。
//   理論值：該案（主案＋追加）每張請款單已退還的當場扣款（holdRetLog／holdRetAmt，上限＝該期 recvHold）加總＝已收款增加的金額。
//   開立發票預填金額、管理費率建議值也會變，但不在黃金樣本裡（不是存檔數字）。
//   只印「清單 N 案；實際差異 M 筆；清單外 K 筆；金額不符 J 筆」，不印案名與金額；--out 另存含 id 與差額的私人清單（只放 %USERPROFILE%\FJ-golden\）
const fs = require('fs');
function arg(n) { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; }
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const SNAP = arg('snapshot'), BASE = arg('base'), BR = arg('branch'), OUT = arg('out');
if (!SNAP || !BASE || !BR) { console.error('用法：node tools/golden/expect2b.js --snapshot <快照.json> --base <base.json> --branch <branch.json> [--out <私人清單.json>]'); process.exit(2); }
let snap, base, br;
try { snap = read(SNAP); base = read(BASE); br = read(BR); } catch (e) { console.error('檔案讀不到或不是有效的 JSON'); process.exit(2); }
const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []);
const quotes = arr(snap.quotes), invs = arr(snap.invoices);
// 當場扣款已退還（與 app.js _holdRetEntries 同一算法：逐筆、上限＝recvHold）
function holdRet(inv) {
  const cap = parseFloat(inv.recvHold) || 0;
  const L = Array.isArray(inv.holdRetLog) && inv.holdRetLog.length ? inv.holdRetLog : ((parseFloat(inv.holdRetAmt) || 0) > 0 ? [{ amt: parseFloat(inv.holdRetAmt) || 0 }] : []);
  let left = cap, sum = 0; L.forEach(e => { const a = Math.min(Math.max(0, parseFloat(e && e.amt) || 0), left); if (a > 0) { sum += a; left -= a; } });
  return sum;
}
const expect = {};
Object.keys(base.stat || {}).forEach(qid => {
  const ids = new Set([qid].concat(quotes.filter(q => q && q.parentId === qid).map(q => q.id)));
  const names = new Set(quotes.filter(q => q && ids.has(q.id)).map(q => q.name));
  const d = invs.filter(i => i && i.kind !== 'retReturn' && (ids.has(i.quoteId) || ids.has(i.sourceQid) || (!i.quoteId && !i.sourceQid && names.has(i.project)))).reduce((a, i) => a + holdRet(i), 0);
  if (d > 0) expect[qid] = Math.round(d);
});
// 實際差異：只看 stat.recv；其他任何欄位有差都算清單外
const actual = {}, outside = [];
['quote', 'stat', 'inv', 'sub', 'pay', 'year'].forEach(sec => {
  const A = base[sec] || {}, B = br[sec] || {};
  new Set(Object.keys(A).concat(Object.keys(B))).forEach(id => {
    const x = A[id] || {}, y = B[id] || {};
    new Set(Object.keys(x).concat(Object.keys(y))).forEach(f => {
      if (JSON.stringify(x[f]) === JSON.stringify(y[f])) return;
      if (sec === 'stat' && f === 'recv') actual[id] = Math.round((y[f] || 0) - (x[f] || 0));
      else outside.push(sec + ' ' + id + ' ' + f);
    });
  });
});
const notInList = Object.keys(actual).filter(id => !(id in expect));
const missing = Object.keys(expect).filter(id => !(id in actual));
const wrongAmt = Object.keys(actual).filter(id => id in expect && actual[id] !== expect[id]);
const ok = !outside.length && !notInList.length && !missing.length && !wrongAmt.length;
console.log((ok ? '符合預期' : '不符預期') + '：清單 ' + Object.keys(expect).length + ' 案；實際差異 ' + Object.keys(actual).length + ' 案（專案已收款）；清單外 ' + (notInList.length + outside.length) + ' 筆；清單上沒變 ' + missing.length + ' 案；金額不符 ' + wrongAmt.length + ' 案');
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ expect, actual, outside, notInList, missing, wrongAmt }, null, 1));
process.exit(ok ? 0 : 1);
