// 真實黃金樣本 (b) 比對：基準結果 vs 這次結果。只印「通過」或「差異 N 筆＋欄位類別」，不印金額、不印 id 以外的東西。
//
//   node tools/golden/compare.js <基準.json> <這次.json> [--detail]
//   node tools/golden/compare.js --selftest      反向驗證：故意改一個數字，一定要抓到「差異 1 筆」
//
//   --detail 只在 Lotion-HQ 本機看：多列出有差異的 id 與欄位名（仍不印金額），方便告訴 AI 是哪一類算法變了
// 結束碼：0＝通過、1＝有差異、2＝參數錯誤
const fs = require('fs');

const CAT = {
  quote: { total: '報價含稅總價', sub: '報價未稅小計', tax: '報價稅額', ext: '報價附加項', cost: '報價成本', gross: '報價毛利', net: '報價淨利', '*': '報價其他' },
  stat: { quoteTotal: '專案合約額', base: '專案合約額', origTotal: '專案合約額', curTotal: '專案合約額', won: '專案合約額', billed: '專案已請款', recv: '專案已收款', ar: '專案應收', retHeld: '專案保留款', costNet: '專案成本', subTotal: '分包總額', subBilled: '分包已計價', payTotal: '應付總額', payPaid: '應付已付', profit: '專案毛利', '*': '專案其他' },
  inv: { curTotal: '每期請款未稅', tax: '每期請款稅額', total: '每期請款含稅', stored: '每期請款含稅（存檔值）', retention: '每期保留款', ret: '每期保留款', clean: '每期扣款', cleanGross: '每期扣款', rcv: '每期實收', ar: '每期應收', '*': '每期請款其他' },
  sub: { '*': '分包計價／付款' },
  pay: { eff: '應付每期金額', paid: '應付付款狀態', '*': '應付其他' },
  year: { '*': '股東報表年度數字' }
};
const catOf = (sec, f) => (CAT[sec] && (CAT[sec][f] || CAT[sec]['*'])) || sec;

function compare(a, b) {
  const diffs = [];
  Object.keys(CAT).forEach(sec => {
    const A = a[sec] || {}, B = b[sec] || {};
    new Set(Object.keys(A).concat(Object.keys(B))).forEach(id => {
      if (!(id in B)) { diffs.push({ sec, id, f: '(整筆消失)', cat: catOf(sec, '*') + '：整筆消失' }); return; }
      if (!(id in A)) { diffs.push({ sec, id, f: '(多出一筆)', cat: catOf(sec, '*') + '：多出一筆' }); return; }
      const x = A[id] || {}, y = B[id] || {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach(f => {
        if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) diffs.push({ sec, id, f, cat: catOf(sec, f) });
      });
    });
  });
  return diffs;
}
function report(diffs, detail) {
  if (!diffs.length) return '通過';
  const by = {}; diffs.forEach(d => { by[d.cat] = (by[d.cat] || 0) + 1; });
  let s = '差異 ' + diffs.length + ' 筆：' + Object.keys(by).sort().map(k => k + ' ' + by[k]).join('、');
  if (detail) s += '\n' + diffs.slice(0, 200).map(d => '  ' + d.sec + ' ' + d.id + ' ' + d.f).join('\n');
  return s;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    const base = { quote: { q1: { total: 105 } }, stat: { q1: { billed: 50, recv: 40 } }, inv: { i1: { total: 52.5, tax: 2.5 } }, sub: {}, pay: { p1: { eff: 10, paid: 1 } }, year: { 2026: { revTax: 52.5 } } };
    const same = JSON.parse(JSON.stringify(base));
    const bad = JSON.parse(JSON.stringify(base)); bad.inv.i1.total += 1;
    const r1 = report(compare(base, same)), r2 = report(compare(base, bad));
    const ok = r1 === '通過' && r2 === '差異 1 筆：每期請款含稅 1';
    console.log('反向驗證：相同→「' + r1 + '」；改一元→「' + r2 + '」' + (ok ? '　✓' : '　✗'));
    process.exit(ok ? 0 : 1);
  }
  const files = args.filter(a => !a.startsWith('--'));
  if (files.length !== 2) { console.error('用法：node tools/golden/compare.js <基準.json> <這次.json> [--detail]'); process.exit(2); }
  const [a, b] = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const diffs = compare(a, b);
  console.log(report(diffs, args.includes('--detail')));
  process.exit(diffs.length ? 1 : 0);
}
module.exports = { compare, report };
