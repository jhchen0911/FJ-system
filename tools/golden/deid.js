// 去識別化複本：把凍結快照（全量備份）轉成「名字都換成代號、金額一毛不動」的複本，給測試專案 fj-system-test 匯入用。
//
//   node tools/golden/deid.js --snapshot <快照.json> --out <去識別化.json> [--map <對照表.json>]
//
//   ‧ 案名、業主／客戶、廠商、聯絡人、人員、業務 → 固定代號（同一個名字永遠換成同一個代號，「同名比對」的算法結果不變）
//     業主名稱裡的「營造／建設／開發／工程」字尾保留（業主類型統計靠它判斷）；系統用的固定字（公司支出（自付）、（已刪除）…）不換
//   ‧ 名字欄（vendor、client、to、contact…）整欄等於名單才換；其他文字裡出現 3 個字以上的名字才換（2 個字的容易撞到一般用詞）
//   ‧ 拿掉：薪資（hr／payslips）、零用金（petty）、操作紀錄、所有圖片（證件、簽名、照片 data:）、合約條件卡全文、
//     施工計畫書草稿與附件庫、工具存檔、角色權限、管理員清單（後兩者不帶，匯入時才不會改到測試專案的權限）
//   ‧ 遮掉：電話、傳真、Email、身分證號、統一編號、銀行與帳號、戶名、地址、郵遞區號、緊急聯絡人、血型、生日、工地地點
//     手機／身分證／Email 只認「前後不接英數字」的完整一段；id（系統產生的時間戳）裡剛好長得像的片段不動
//   ‧ 清空：所有網址與檔案路徑（Storage 下載網址、附件檔名是使用者取的，可能含姓名或身分證號；算錢用不到）
//   ‧ 金額、數量、日期、id 全部保留 → run.js 算原快照與複本、compare.js --deid 比對必須「通過」
//     （薪資、零用金拿掉了，股東報表年度裡跟它們有關的欄位不比，見 compare.js 的 DEID_SKIP）
//   ‧ --map 對照表（真名→代號）只存在 Lotion-HQ 本機的 %USERPROFILE%\FJ-golden\，不上傳、不進 repo
//   最後自己掃一遍：複本裡還找得到幾個原名、幾個像電話／身分證／Email 的字串（只印個數），有就結束碼 1
const fs = require('fs');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }

const DROP_COLLS = ['hr', 'payslips', 'petty', 'activityLog', 'workerSens'];          // 清成空陣列
const DELETE_TOP = ['admins', 'pagePerms', 'planState', 'planAttLib', 'toolrecs', 'toolStates', 'uploadedBy'];   // 整個不帶
const DROP_KEYS = /^(photos?|imgs?|images?|idImgs?|idPhoto|sign|signature|sig|linePhotos|slips|ownerCard|attach|attachments|files|logo|stamp|seal|avatar)$/i;
// 文字欄位遮掉（只遮字串；同名的數字欄，例如信封版面座標 zipX、薪資 tel 津貼，原樣保留）
const MASK_KEYS = /(addr|tel|phone|fax|mail|idno|^nid$|taxid|^uni(no)?$|^gui$|bank|acct|account|holder|^emg|emerg|birth|blood|zip|insno|lineid|^loc$|^boss$|url$|^href$|^fname$|filename|^spath$|storagepath)/i;
// 名字欄 → 代號類別（name 只在下列集合的第一層才算名字；工項、成本、材料的 name 是品名，不換）
const KEY_CAT = { client: 'C', customer: 'C', builder: 'C', vendor: 'V', to: 'V', payee: 'V', supplier: 'V', project: 'P', projName: 'P',
  contact: 'H', siteContact: 'H', companyContact: 'H', attn: 'H', envAttn: 'H', person: 'H', byName: 'H', leader: 'H', foreman: 'H', salesName: 'H', who: 'H', partner: 'H' };
const TOP_NAME_CAT = { quotes: 'P', contracts: 'P', customers: 'C', vendors: 'V', workers: 'H', qHistory: 'P', invoices: 'P' };
// 網址與檔案路徑一律清空（算錢用不到）：Storage 下載網址、附件檔名可能帶真名或身分證號
const URLISH = /^(https?:|gs:|blob:|data:)|firebasestorage|storage\.googleapis/i;
const FILEISH = /^[^\s]*\/[^\s]*\.(jpe?g|png|gif|webp|heic|pdf|xlsx?|docx?|csv|zip)(\?.*)?$|^[^\s\/]+\.(jpe?g|png|gif|webp|heic|pdf|xlsx?|docx?)$/i;
const PREFIX = { P: '工程P', C: '業主C', V: '廠商V', H: '人員H' };
const KEEP_SUFFIX = ['營造', '建設', '開發', '工程'];
// 系統固定字（程式拿來判斷的哨兵值），不是名字
const SENTINEL = /^(（.*）|\(.*\)|公司支出（自付）|公司|自有|系統|本公司|現場|其他|未指定|待定|業主|廠商|無)$/;

// 疑似個資的個數（只算前後不接英數字的完整一段；遮罩後的代換值 A100000000、x@example.com 不算）
function piiCount(txt) {
  return (txt.match(/(?<![\w])09\d{2}-?\d{3}-?\d{3}(?![\w])/g) || []).length
    + (txt.match(/(?<![\w])[A-Z][12]\d{8}(?![\w])/g) || []).filter(x => x !== 'A100000000').length
    + (txt.match(/(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+(?![\w-])/g) || []).filter(x => x !== 'x@example.com').length;
}

function deid(snap) {
  const found = { P: new Set(), C: new Set(), V: new Set(), H: new Set() };
  const add = (cat, s) => {
    if (typeof s !== 'string') return; s = s.trim();
    if (s.length < 2 || SENTINEL.test(s) || /^[\w.:@\-\s]+$/.test(s) && !/\s/.test(s)) return;   // 純英數無空格（id、uid）不是名字
    found[cat].add(s);
  };
  // 1. 收集真名：名字欄（任何深度）＋特定集合第一層的 name
  (function walk(o, top, depth) {
    if (Array.isArray(o)) { o.forEach(x => walk(x, top, depth)); return; }
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (k === 'name' && depth === 1 && TOP_NAME_CAT[top]) add(TOP_NAME_CAT[top], v);
      else if (KEY_CAT[k]) add(KEY_CAT[k], v);
      if (v && typeof v === 'object') walk(v, depth === 0 ? k : top, depth + 1);   // 深度＝上面有幾層物件；陣列不算一層
    });
  })(snap, '', 0);
  (snap.vendors || []).forEach(v => { if (typeof v === 'string') add('V', v); });
  const pr = snap.params || {};
  (pr.sales || []).forEach(s => s && add('H', s.name));
  ['boss', 'contact'].forEach(k => add('H', pr[k]));
  Object.keys(pr.envBook || {}).forEach(k => add('C', k));
  // 2. 指定代號（依名字排序，同一份快照每次產生的代號相同）
  const map = {}; const seen = new Set();
  ['C', 'V', 'P', 'H'].forEach(cat => {
    let n = 0;
    Array.from(found[cat]).sort().forEach(s => {
      if (seen.has(s)) return; seen.add(s); n++;
      const suf = cat === 'C' ? (KEEP_SUFFIX.find(x => s.indexOf(x) >= 0) || '') : '';
      map[s] = PREFIX[cat] + String(n).padStart(3, '0') + suf;
    });
  });
  const longs = Object.keys(map).filter(s => s.length >= 3).sort((a, b) => b.length - a.length);   // 長的先換
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = longs.length ? new RegExp(longs.map(esc).join('|'), 'g') : null;
  // 偵測與遮罩都要求「前後不接英數字」：時間戳 id（…0912345678…）、網址參數裡剛好長得像手機／身分證的片段不算
  const PHONE = /(?<![\w])(09\d{2}[-\s]?\d{3}[-\s]?\d{3}|\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{4})(?![\w])/g;
  const IDNO = /(?<![\w])[A-Z][12]\d{8}(?![\w])/g;
  const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+(?![\w-])/g;
  const scrub = s => {
    if (URLISH.test(s) || FILEISH.test(s)) return '';   // 網址、檔案路徑：檔名是使用者取的，可能含姓名、身分證號
    const t = s.trim();
    if (map[t] != null) return map[t];          // 整串就是名字
    if (re) s = s.replace(re, m => map[m]);
    return s.replace(EMAIL, 'x@example.com').replace(PHONE, '00-0000-0000').replace(IDNO, 'A100000000');
  };
  // 3. 產生複本
  const out = (function walk(o, k) {
    if (typeof o === 'string') {
      if (MASK_KEYS.test(k || '')) return '';
      if (KEY_CAT[k] || k === 'name') { const t = o.trim(); if (map[t] != null) return map[t]; }
      return scrub(o);
    }
    if (Array.isArray(o)) return o.map(x => walk(x, k));
    if (!o || typeof o !== 'object') return o;
    const r = {};
    Object.keys(o).forEach(key => {
      if (DROP_KEYS.test(key)) return;
      const nk = map[key] != null ? map[key] : (re ? key.replace(re, m => map[m]) : key);   // 以名字當鍵的物件（信封通訊錄）
      r[nk] = walk(o[key], key);
    });
    return r;
  })(snap, '');
  DROP_COLLS.forEach(c => { if (c in out) out[c] = []; });
  DELETE_TOP.forEach(c => { delete out[c]; });
  // 4. 自己掃：複本裡還有幾個原名（3 個字以上）、幾個像電話／身分證／Email 的字串
  const txt = JSON.stringify(out);
  const left = longs.filter(s => txt.indexOf(s) >= 0).length;
  const pii = piiCount(txt);
  return { out, map, left, pii, counts: { P: found.P.size, C: found.C.size, V: found.V.size, H: found.H.size } };
}

if (require.main === module) {
  const SNAP = arg('snapshot'), OUT = arg('out'), MAP = arg('map');
  if (!SNAP || !OUT) { console.error('用法：node tools/golden/deid.js --snapshot <快照.json> --out <去識別化.json> [--map <對照表.json>]'); process.exit(2); }
  let snap; try { snap = JSON.parse(fs.readFileSync(SNAP, 'utf8').replace(/^﻿/, '')); } catch (e) { console.error('快照讀不到或不是有效的 JSON'); process.exit(2); }
  const r = deid(snap);
  fs.writeFileSync(OUT, JSON.stringify(r.out));
  if (MAP) fs.writeFileSync(MAP, JSON.stringify(r.map, null, 1));
  const bad = r.left || r.pii;
  console.log('完成：案名 ' + r.counts.P + '、業主 ' + r.counts.C + '、廠商 ' + r.counts.V + '、人員 ' + r.counts.H + ' 個換成代號；複本裡殘留原名 ' + r.left + ' 個、疑似電話／身分證／Email ' + r.pii + ' 個' + (bad ? '　✗ 先不要匯入，把這行告訴 AI' : '　✓'));
  process.exit(bad ? 1 : 0);
}
module.exports = { deid, piiCount };
