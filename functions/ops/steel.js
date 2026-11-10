// M8b（v6.0.216）鋼價追蹤的備援來源：主計總處「營造工程物價指數」的（四）金屬製品類（月指數，民國 110 年＝100）
// 來源：政府資料開放平臺 資料集 8246（每月更新、XML、政府資料開放授權條款）https://data.gov.tw/dataset/8246
// 主要來源是中鋼盤價：由 Lotion-HQ 每月讀新聞稿做成「鋼價草稿」上傳（docs/鋼價草稿_電腦端操作.md），不在這裡抓。
'use strict';
const URL = 'https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230553/pr0501a1m.xml';
const ITEM = /^\(四\)金屬製品類/;
// XML → { 'YYYY-MM': 指數 }（只取月資料的原始值）
function parse(xml) {
  const out = {}, re = /<Obs>\s*<Item>([^<]+)<\/Item>\s*<TIME_PERIOD>(\d{4})M(\d{2})<\/TIME_PERIOD>\s*<FREQ>M<\/FREQ>\s*<TYPE>原始值<\/TYPE>\s*<Item_VALUE>([^<]*)<\/Item_VALUE>\s*<\/Obs>/g;
  let m; while ((m = re.exec(String(xml || '')))) { if (!ITEM.test(m[1])) continue; const v = parseFloat(m[4]); if (isFinite(v) && v > 0) out[m[2] + '-' + m[3]] = v; }
  return out;
}
// 存回去的那份：最近 36 個月＋最新一期
function build(series, now) {
  const ks = Object.keys(series || {}).sort().slice(-36), s = {};
  ks.forEach((k) => { s[k] = series[k]; });
  const last = ks[ks.length - 1];
  return { at: now, src: 'dgbas', url: URL, item: '(四)金屬製品類', latest: last ? { ym: last, v: s[last] } : null, series: s };
}
module.exports = { URL, parse, build };
