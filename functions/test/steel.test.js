// M8b 主計總處營造工程物價指數（金屬製品類）解析——假資料
const test = require('node:test');
const assert = require('node:assert');
const ST = require('../ops/steel.js');
const xml = '<?xml version="1.0"?><DataSet>'
  + '<Obs><Item>(四)金屬製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M09</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE>\n<Item_VALUE>101.44</Item_VALUE></Obs>'
  + '<Obs><Item>(四)金屬製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M09</TIME_PERIOD><FREQ>M</FREQ><TYPE>年增率(%)</TYPE>\n<Item_VALUE>7.57</Item_VALUE></Obs>'
  + '<Obs><Item>(四)金屬製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M10</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE>\n<Item_VALUE>102.23</Item_VALUE></Obs>'
  + '<Obs><Item>(一)水泥及其製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M10</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE>\n<Item_VALUE>99.1</Item_VALUE></Obs>'
  + '<Obs><Item>(四)金屬製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026</TIME_PERIOD><FREQ>Y</FREQ><TYPE>原始值</TYPE>\n<Item_VALUE>100</Item_VALUE></Obs>'
  + '<Obs><Item>(四)金屬製品類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M11</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE>\n<Item_VALUE></Item_VALUE></Obs></DataSet>';
test('只取金屬製品類的月原始值（年增率、年資料、其他類、空值都不取）', () => {
  assert.deepStrictEqual(ST.parse(xml), { '2026-09': 101.44, '2026-10': 102.23 });
});
test('存回去的格式：最近 36 個月＋最新一期', () => {
  const s = {}; for (let i = 0; i < 40; i++) { const y = 2023 + Math.floor(i / 12), m = (i % 12) + 1; s[y + '-' + String(m).padStart(2, '0')] = 90 + i; }
  const b = ST.build(s, 1);
  assert.strictEqual(Object.keys(b.series).length, 36);
  assert.deepStrictEqual(b.latest, { ym: '2026-04', v: 129 });
  assert.strictEqual(b.src, 'dgbas');
});
test('格式壞掉或空的回傳空物件（雲端改出保底卡）', () => {
  assert.deepStrictEqual(ST.parse('<html>維護中</html>'), {});
  assert.strictEqual(ST.build({}, 1).latest, null);
});
