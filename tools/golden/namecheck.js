// 真名檢查：repo 是公開的，確認真實案名／業主／廠商名稱沒有出現在 repo 檔案、這個分支的 commit 訊息、PR 說明裡。
//
//   node tools/golden/namecheck.js --names <名單.json> [--base origin/main] [--extra <PR說明.txt> ...]
//
//   名單由 run.js --names 產生，只存在 Lotion-HQ 本機。只印「沒有出現」或「出現 N 個名稱、M 處」，不印名稱本身。
//   --detail 只在本機看：多列出「哪個檔案第幾行」（仍不印名稱），方便刪掉。
//   結束碼：0＝乾淨、1＝有出現、2＝參數錯誤
const fs = require('fs');
const { execFileSync } = require('child_process');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
function args(name) { const r = []; process.argv.forEach((a, i) => { if (a === '--' + name && process.argv[i + 1]) r.push(process.argv[i + 1]); }); return r; }
const NAMES = arg('names'), BASE = arg('base', 'origin/main'), DETAIL = process.argv.includes('--detail');
if (!NAMES) { console.error('用法：node tools/golden/namecheck.js --names <名單.json> [--base origin/main] [--extra <檔案>]'); process.exit(2); }

// 太短或太常見的詞（例如「工程」「台北」）會誤報，略過；名單本身已經濾掉 1 個字的
const COMMON = new Set(['工程', '公司', '營造', '台北', '新北', '桃園', '台中', '台南', '高雄', '範例', '測試']);
const names = JSON.parse(fs.readFileSync(NAMES, 'utf8')).map(s => String(s).trim()).filter(s => s.length >= 3 && !COMMON.has(s));

const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 30 });
const texts = [];   // [來源, 內容]
git(['ls-files', '-z']).split('\0').filter(Boolean).forEach(f => {
  if (/\.(png|jpe?g|gif|pdf|woff2?|ttf|ico|zip|xlsx|docx)$/i.test(f)) return;
  try { texts.push([f, fs.readFileSync(f, 'utf8')]); } catch (e) { /* 可忽略：子模組或已刪檔 */ }
});
try { texts.push(['(commit 訊息)', git(['log', '--format=%B', BASE + '..HEAD'])]); } catch (e) { console.error('找不到 ' + BASE + '，commit 訊息未檢查'); }
args('extra').forEach(f => texts.push(['(' + f + ')', fs.readFileSync(f, 'utf8')]));

let hitNames = 0, hitPlaces = 0; const where = [];
names.forEach((n, ni) => {
  let any = false;
  texts.forEach(([src, t]) => {
    let i = t.indexOf(n);
    while (i >= 0) {
      any = true; hitPlaces++;
      if (DETAIL && where.length < 200) where.push('  名單第 ' + (ni + 1) + ' 個：' + src + ' 第 ' + (t.slice(0, i).split('\n').length) + ' 行');
      i = t.indexOf(n, i + n.length);
    }
  });
  if (any) hitNames++;
});
console.log(hitNames ? '出現 ' + hitNames + ' 個名稱、' + hitPlaces + ' 處（檢查了 ' + names.length + ' 個名稱）' : '沒有出現（檢查了 ' + names.length + ' 個名稱）');
if (DETAIL && where.length) console.log(where.join('\n'));
process.exit(hitNames ? 1 : 0);
