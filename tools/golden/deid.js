// 去識別化複本：把凍結快照（全量備份）轉成「名字都換成代號、金額一毛不動」的複本，給測試專案 fj-system-test 匯入用。
//
//   node tools/golden/deid.js --snapshot <快照.json> --out <去識別化.json> [--map <對照表.json>]
//
//   ‧ 案名、業主／客戶、廠商、聯絡人、人員、業務 → 固定代號（同一個名字永遠換成同一個代號，所以「同名比對」的算法結果不變）
//     業主名稱裡的「營造／建設／開發／工程」字尾保留（業主類型統計靠它判斷）
//   ‧ 拿掉：薪資（hr／payslips）、零用金（petty）、操作紀錄、管理員清單、所有圖片（證件、簽名、照片 data:）、合約條件卡全文
//   ‧ 遮掉：電話、Email、身分證號、統一編號、銀行帳號、地址
//   ‧ 金額、數量、日期、id 全部保留 → 用 run.js 算原快照與複本、compare.js 比對，必須「通過」（證明去識別化沒動到金額）
//   ‧ --map 對照表（真名→代號）只存在 Lotion-HQ 本機的 %USERPROFILE%\FJ-golden\，不上傳、不進 repo
//   最後會自己掃一遍：複本裡還找得到幾個原本的名字（只印個數）
const fs = require('fs');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const SNAP = arg('snapshot'), OUT = arg('out'), MAP = arg('map');

// 整個集合拿掉（薪資、零用金、操作紀錄、管理員）
const DROP_COLLS = ['hr', 'payslips', 'petty', 'activityLog', 'workerSens'];
// 這些欄位整個拿掉（圖片、簽名、卡片全文、證件）
const DROP_KEYS = /^(photos?|imgs?|images?|idImg|idImgs|idPhoto|sign|signature|sig|linePhotos|ownerCard|attach|attachments|files|logo|stamp|seal|avatar)$/i;
// 這些欄位內容遮掉（聯絡方式、證號、帳號、地址）
const MASK_KEYS = /^(phone|phones|tel|tel2|mobile|cell|fax|email|mail|line|lineId|idNo|idno|nid|taxId|taxid|uniNo|uni|gui|vat_no|bank|bankName|bankBranch|bankAcct|bankHolder|bankNo|acct|account|accNo|acctName|holder|addr|address|addr2|siteAddr|zip|birthday|birth|emerg|emergTel|insNo)$/i;
// 欄位名 → 代號類別（name 依所在集合判斷）
const KEY_CAT = { client: 'C', owner: 'C', customer: 'C', builder: 'C', vendor: 'V', to: 'V', payee: 'V', sub: 'V', supplier: 'V', project: 'P', projName: 'P', contact: 'H', attn: 'H', envAttn: 'H', person: 'H', byName: 'H', staff: 'H', leader: 'H', foreman: 'H', sales: 'H', salesName: 'H', createdBy: 'H', by: 'H' };
const COLL_NAME_CAT = { quotes: 'P', contracts: 'P', customers: 'C', vendors: 'V', workers: 'H', sales: 'H', readers: 'H', qHistory: 'P' };
const PREFIX = { P: '工程P', C: '業主C', V: '廠商V', H: '人員H' };
const KEEP_SUFFIX = ['營造', '建設', '開發', '工程'];

function deid(snap) {
  // 1. 收集真名
  const found = { P: new Set(), C: new Set(), V: new Set(), H: new Set() };
  const add = (cat, s) => { if (typeof s === 'string') { s = s.trim(); if (s.length >= 2 && !/^[\w.:@-]+$/.test(s)) found[cat].add(s); } };   // 純英數（id、uid）不當名字；英文廠商名通常有空格或中文 };
  (function walk(o, coll) {
    if (Array.isArray(o)) { o.forEach(x => walk(x, coll)); return; }
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (k === 'name' && COLL_NAME_CAT[coll]) add(COLL_NAME_CAT[coll], v);
      else if (KEY_CAT[k] && typeof v === 'string') add(KEY_CAT[k], v);
      if (v && typeof v === 'object') walk(v, COLL_NAME_CAT[k] ? k : coll);
    });
  })(snap, '');
  (snap.vendors || []).forEach(v => { if (typeof v === 'string') add('V', v); });
  // 2. 指定代號（依名字排序，同一份快照每次產生的代號相同）
  const map = {}; const seen = new Set();
  ['C', 'V', 'P', 'H'].forEach(cat => {
    let n = 0;
    Array.from(found[cat]).sort().forEach(s => {
      if (seen.has(s)) return; seen.add(s);
      n++;
      const suf = cat === 'C' ? (KEEP_SUFFIX.find(x => s.indexOf(x) >= 0) || '') : '';
      map[s] = PREFIX[cat] + String(n).padStart(3, '0') + suf;
    });
  });
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);   // 長的先換，避免「甲營造股份有限公司」被「甲營造」先換掉一半
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = keys.length ? new RegExp(keys.map(esc).join('|'), 'g') : null;
  const scrub = s => {
    if (s.startsWith('data:')) return '';
    if (re) s = s.replace(re, m => map[m]);
    return s
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'x@example.com')
      .replace(/(^|[^\w])09\d{2}-?\d{3}-?\d{3}(?!\d)/g, '$10900-000-000')
      .replace(/(^|[^\w])\(?0\d{1,2}\)?[-\s]?\d{3,4}-\d{3,4}(?!\d)/g, '$100-0000-0000')
      .replace(/(^|[^\w])[A-Z][12]\d{8}(?!\d)/g, '$1A100000000');
  };
  // 3. 產生複本
  const out = (function walk(o, k) {
    if (typeof o === 'string') return MASK_KEYS.test(k || '') ? '' : scrub(o);
    if (Array.isArray(o)) return o.map(x => walk(x, k));
    if (!o || typeof o !== 'object') return o;
    const r = {};
    Object.keys(o).forEach(key => {
      if (DROP_KEYS.test(key)) return;
      const v = o[key];
      if (MASK_KEYS.test(key) && v && typeof v === 'object') return;
      r[re ? key.replace(re, m => map[m]) : key] = walk(v, key);
    });
    return r;
  })(snap, '');
  DROP_COLLS.forEach(c => { if (c in out) out[c] = []; });
  delete out.admins;   // 管理員清單不帶：匯入時才不會把測試專案的管理員清空
  out.uploadedBy = '';
  // 4. 自己掃：複本裡還有幾個原名（3 個字以上才算，2 個字的人名容易和一般用詞撞）
  const txt = JSON.stringify(out);
  const left = keys.filter(s => s.length >= 3 && txt.indexOf(s) >= 0).length;
  return { out, map, left, counts: { P: found.P.size, C: found.C.size, V: found.V.size, H: found.H.size } };
}

if (require.main === module) {
  if (!SNAP || !OUT) { console.error('用法：node tools/golden/deid.js --snapshot <快照.json> --out <去識別化.json> [--map <對照表.json>]'); process.exit(2); }
  const r = deid(JSON.parse(fs.readFileSync(SNAP, 'utf8')));
  fs.writeFileSync(OUT, JSON.stringify(r.out));
  if (MAP) fs.writeFileSync(MAP, JSON.stringify(r.map, null, 1));
  console.log('完成：案名 ' + r.counts.P + '、業主 ' + r.counts.C + '、廠商 ' + r.counts.V + '、人員 ' + r.counts.H + ' 個換成代號；複本裡殘留原名 ' + r.left + ' 個' + (r.left ? '（請告訴 AI 個數，用 --detail 不會印名字）' : ''));
  process.exit(r.left ? 1 : 0);
}
module.exports = { deid };
