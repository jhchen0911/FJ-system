// 改版第 5 步 5a：伺服器每日備份還原演練（Lotion-HQ 電腦上跑；只用在「測試專案」）
//   node tools/backup-restore-prep.js <下載的備份資料夾>
// 備份資料夾＝Storage fydata/backups/server/daily/<日期>/ 底下的檔（每個節點一個 <節點>.json，外層是 {kind,version,at,node,data}，另有 _index.json）。
// 這支把每個 <節點>.json 拆出 data 存成 <節點>.data.json（給 firebase database:set 寫回測試專案），並印出 _index.json 記的筆數，
// 還原後到 test.html 的「經營報表 › 資料健檢」對筆數。只印筆數，不印內容。
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('用法：node tools/backup-restore-prep.js <備份資料夾>'); process.exit(2); }
const idx = fs.existsSync(path.join(dir, '_index.json')) ? JSON.parse(fs.readFileSync(path.join(dir, '_index.json'), 'utf8')) : null;
const out = [];
fs.readdirSync(dir).filter((f) => /\.json$/.test(f) && f !== '_index.json' && !/\.data\.json$/.test(f)).forEach((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!j || j.kind !== 'fy-server-backup' || !j.node) { console.warn('略過（不是伺服器備份檔）：' + f); return; }
  const dst = path.join(dir, j.node + '.data.json');
  fs.writeFileSync(dst, JSON.stringify(j.data));
  out.push(j.node);
});
console.log('已拆出 ' + out.length + ' 個節點：' + out.join('、'));
if (idx) { console.log('備份時間：' + new Date(idx.at).toLocaleString('zh-TW')); console.log('備份當下筆數：' + JSON.stringify(idx.counts)); }
console.log('\n寫回「測試專案」（一個節點一行，只能用 fj-system-test）：');
out.forEach((n) => console.log('firebase database:set /fydata/' + n + ' "' + path.join(dir, n + '.data.json') + '" --project fj-system-test -f'));
