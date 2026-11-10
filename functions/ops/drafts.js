// v6.0.190 AI 草稿上傳（不靠操作網頁）：AI 唯讀帳號用指令列工具 tools/fy-draft.js 登入後呼叫雲端 fyDraft，
// 這裡做跟網頁一樣的試算與檢查（對位與小計用 calc/qdraft.js，和前端 fyQuoteChange 同一份），過了才寫 fydata/drafts。
// 純邏輯、可在 Node 測（functions/test/drafts.test.js）；讀寫資料庫在 index.js。
const FJC = require('../calc/qdraft.js');
const D = FJC.qd;

const TYPES = { qchg: 1, quote: 1, bid: 1, ownerCard: 1, rfqReply: 1 };   // v6.0.225 ownerCard＝合約條件卡（contract-check 產出的 fj-contract-card/1）
const MAX_PENDING = 50;   // 每個送件人同時待確認的上限   // 只開這三種；其他草稿照舊從網頁送
const BID_TO = { awarded: '得標', '': '待回覆', nego: '議價中', lost: '未得標', void: '流標' };
const LOST = ['價格過高', '規格不符', '工期不符', '業主關係', '未回應', '其他'];
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const S = (v, n) => String(v == null ? '' : v).slice(0, n);
const N = (v) => { const x = D.num(v); return x == null ? null : x; };
const fmt = (n) => Math.round(+n || 0).toLocaleString('en-US');

// 同前端 _rmkBaseFor／_rmkQOld：第 14 條切換前建立的舊報價用舊範本
function rmkBaseFor(q, rp) {
  const at = +rp.rmk14At || 0, id = String((q && q.id) || ''), t = /^\d{12,14}$/.test(id) ? +id : 0;
  return (at && rp.rmkBaseOld && q && t < at) ? String(rp.rmkBaseOld) : String(rp.rmkBase || '');
}
function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
// 找報價：qid 優先；只給報價編號時要唯一
function findQuote(quotes, ref) {
  const L = arr(quotes).filter((q) => q && q.id);
  if (ref.qid) return { q: L.find((q) => q.id === ref.qid) || null };
  if (ref.code) { const h = L.filter((q) => String(q.code || '') === String(ref.code)); if (h.length > 1) return { err: '報價編號 ' + ref.code + ' 有 ' + h.length + ' 張，請改用 qid' }; return { q: h[0] || null }; }
  return { q: null };
}
// 試算要對：AI 附上它算的未稅／稅／含稅，跟這裡算的一樣才收（防止 AI 以為改成 A、其實套出 B）
function expectOk(exp, t) {
  if (!exp || typeof exp !== 'object') return '要附 expect：{sub, tax, total}（你算的未稅、稅額、含稅）';
  const bad = [];
  if (Math.abs((+exp.sub || 0) - t.sub) > 0.5) bad.push('未稅 你算 ' + fmt(exp.sub) + '、系統算 ' + fmt(t.sub));
  if (Math.round(+exp.tax || 0) !== t.tax) bad.push('稅額 你算 ' + fmt(exp.tax) + '、系統算 ' + fmt(t.tax));
  if (Math.abs((+exp.total || 0) - t.total) > 0.5) bad.push('含稅 你算 ' + fmt(exp.total) + '、系統算 ' + fmt(t.total));
  return bad.length ? '試算對不上：' + bad.join('；') : '';
}
function cleanItems(its) {
  return arr(its).slice(0, 300).map((it) => {
    const o = { desc: S(it.desc, 500), unit: S(it.unit, 20), qty: N(it.qty), price: N(it.price), note: S(it.note, 200), sec: !!it.sec };
    if (it.spare) o.spare = true;
    return o;
  });
}

// v6.0.209 底價／目標成交價（含稅，選填）：payload.aim＝{floor, target}；只有管理員看得到（套用後存在報價的 private 欄位 bidAim）
function aimClean(x) {
  if (x == null) return { aim: null };
  if (typeof x !== 'object') return { err: 'aim 要是 {floor, target}' };
  const one = (v, k) => { if (v == null || v === '') return null; const n = D.num(v); if (n == null || !(n > 0) || n > 1e10) return k; return Math.round(n); };
  const f = one(x.floor, 'floor'), t = one(x.target, 'target');
  if (f === 'floor') return { err: '底價（aim.floor）要是大於 0 的含稅金額' };
  if (t === 'target') return { err: '目標成交價（aim.target）要是大於 0 的含稅金額' };
  if (f == null && t == null) return { aim: null };
  if (f != null && t != null && f > t) return { err: '底價不能高於目標成交價' };
  const o = {}; if (f != null) o.floor = f; if (t != null) o.target = t; return { aim: o };
}
// v6.0.225 廠商回價（rfqReply）：AI 讀廠商回傳的報價（照片／PDF）→ 草稿。詢價單在 private（這裡讀不到），只對報價工項；詢價單號 rno 由 FJ 端再對。
//   prices：[{idx 或 match（工項說明第一行的一段）, price（未稅單價）}]；lump：{total, idxs 或 match[]}（一式）；extras：[{name, amt}]（豐有要提供的材料／隱藏成本）；diffs：範圍差異文字
function itemIdx(q, x) {
  const its = arr(q.items);
  if (x.idx != null && x.idx !== '') { const i = parseInt(x.idx, 10); if (!(i >= 0 && i < its.length) || !its[i] || its[i].sec) return { err: '工項 idx ' + S(x.idx, 10) + ' 不在這張報價' }; return { i }; }
  const m = S(x.match, 60).replace(/\s+/g, ''); if (!m) return { err: '每一項要給 idx 或 match' };
  const hit = []; its.forEach((it, i) => { if (it && !it.sec && !it.spare && String(it.desc || '').split('\n')[0].replace(/\s+/g, '').indexOf(m) >= 0) hit.push(i); });
  if (hit.length !== 1) return { err: '「' + m + '」對到 ' + hit.length + ' 個工項，請改用 idx' };
  return { i: hit[0] };
}
function replyClean(q, pl) {
  const v = (pl.vendor && typeof pl.vendor === 'object') ? pl.vendor : {};
  const name = S(v.name, 80).trim(); if (!name) return { err: '要填廠商名稱（vendor.name）' };
  const out = { rno: S(pl.rno, 40).trim(), vendor: { name, contact: S(v.contact, 40), tel: S(v.tel, 40), taxid: S(v.taxid, 10) }, recv: /^\d{4}-\d{2}-\d{2}$/.test(S(pl.recv, 10)) ? S(pl.recv, 10) : '', prices: [], note: S(pl.note, 300), src: S(pl.src, 200) };
  const seen = {};
  for (const x of arr(pl.prices).slice(0, 100)) {
    const r = itemIdx(q, x || {}); if (r.err) return { err: r.err };
    const p = D.num(x.price); if (p == null || !(p >= 0) || p > 1e8) return { err: '第 ' + (r.i + 1) + ' 項單價不對' };
    if (seen[r.i]) return { err: '第 ' + (r.i + 1) + ' 項重複' }; seen[r.i] = 1;
    out.prices.push({ idx: r.i, price: p });
  }
  if (pl.lump != null) {
    const L = (typeof pl.lump === 'object') ? pl.lump : {}; const t = D.num(L.total); if (t == null || !(t > 0) || t > 1e10) return { err: '一式總價（lump.total）要大於 0' };
    const idxs = [];
    for (const x of arr(L.idxs).map((i) => ({ idx: i })).concat(arr(L.match).map((m) => ({ match: m }))).slice(0, 100)) { const r = itemIdx(q, x); if (r.err) return { err: r.err }; if (seen[r.i]) return { err: '第 ' + (r.i + 1) + ' 項同時有單價和一式' }; if (idxs.indexOf(r.i) < 0) idxs.push(r.i); }
    if (!idxs.length) return { err: '一式要列涵蓋哪些工項（lump.idxs 或 lump.match）' };
    out.lump = { total: t, idxs };
  }
  if (!out.prices.length && !out.lump) return { err: '沒有任何單價或一式總價' };
  out.extras = arr(pl.extras).slice(0, 20).map((e) => ({ name: S(e && e.name, 60), amt: D.num(e && e.amt) || 0 })).filter((e) => e.name.trim() && e.amt > 0);
  out.diffs = arr(pl.diffs).slice(0, 20).filter((t) => typeof t === 'string').map((t) => S(t, 200)).filter((t) => t.trim());
  return { p: out };
}
// v6.0.225 合約條件卡（fj-contract-card/1）：只收純資料（字串≤2000、陣列≤50、物件≤60 欄、深度≤6；鍵名只能英數 _ -，資料庫不收 . $ # [ ] /）
const CARD_TOP = ['billing', 'retention', 'rent'];
function cardClean(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return { err: '要附 card：contract-check 產出的合約條件卡（JSON 物件）' };
  if (card.schema != null && card.schema !== 'fj-contract-card/1') return { err: '合約條件卡格式版本 ' + S(card.schema, 40) + ' 不支援（需要 fj-contract-card/1）' };
  if (!CARD_TOP.some((k) => card[k] && typeof card[k] === 'object')) return { err: '合約條件卡至少要有 billing、retention、rent 其中一段' };
  let bad = '';
  const cl = (v, d) => {
    if (bad) return null;
    if (v == null) return null;
    if (typeof v === 'string') return v.slice(0, 2000);
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v;
    if (d > 6) { bad = '合約條件卡層數太深'; return null; }
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => cl(x, d + 1)).filter((x) => x != null);
    if (typeof v === 'object') { const o = {}; Object.keys(v).slice(0, 60).forEach((k) => { if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) { bad = '合約條件卡欄位名稱「' + S(k, 40) + '」不合法'; return; } const x = cl(v[k], d + 1); if (x != null) o[k] = x; }); return o; }
    return null;
  };
  const out = cl(card, 0); if (bad) return { err: bad };
  let n = 0; CARD_TOP.forEach((k) => { if (out[k] && typeof out[k] === 'object') n += Object.keys(out[k]).length; });
  if (JSON.stringify(out).length > 60000) return { err: '合約條件卡太大（上限約 60KB）' };
  return { card: out, n };
}
// body＝{type, payload, summary?, expect}；回傳 {rec} 或 {err, detail?}
function build(o) {
  const { email, name, body, quotes, taxR, now, id } = o, rp = o.rmkParams || {};
  const b = (body && typeof body === 'object') ? body : {};
  const type = S(b.type, 20), pl = (b.payload && typeof b.payload === 'object') ? b.payload : {};
  if (!TYPES[type]) return { err: '這個工具只收 qchg（改單）、quote（報價單）、bid（得標狀態）、ownerCard（合約條件卡）、rfqReply（廠商回價）；其他草稿請從網頁送' };
  if (!ID_RE.test(String(id || ''))) return { err: '草稿 id 不對' };
  let payload, summary;
  if (type === 'qchg') {
    const f = findQuote(quotes, { qid: S(pl.qid, 80), code: S(pl.code, 60) }); if (f.err) return { err: f.err };
    const q = f.q; if (!q) return { err: '找不到這張報價（qid 或 code）' };
    const ops = D.clean(Array.isArray(pl.ops) ? pl.ops : []);
    const plan = D.plan(q, ops, fmt, { rmkBase: rmkBaseFor(q, rp) });   // v6.0.196 固定條款改字（範本跟前端 _rmkBaseFor 同一規則）
    if (plan.bad) return { err: '有動作對不上：' + plan.rows.filter((r) => !r.ok).map((r) => r.act + '：' + r.why).join('；'), detail: plan.rows };
    const t0 = D.totals(q.items, taxR), t1 = D.totals(plan.items, taxR);
    const ee = expectOk(b.expect, t1); if (ee) return { err: ee, detail: plan.rows };
    payload = { qid: q.id, code: S(q.code, 60), baseVer: q.ver || 1, baseMt: q._mt || 0, ops };
    const am = aimClean(pl.aim); if (am.err) return { err: am.err }; if (am.aim) payload.aim = am.aim;
    summary = (S(b.summary, 140).trim() || (S(q.code, 40) + ' ' + S(q.name, 60) + ' V' + (q.ver || 1) + ' 改單 ' + plan.rows.length + ' 項')) + '（未稅 ' + fmt(t0.sub) + ' → ' + fmt(t1.sub) + '）';
  } else if (type === 'quote') {
    const base = S(pl.base, 80); let bq = null;
    if (base) { bq = findQuote(quotes, { qid: base }).q; if (!bq) return { err: '找不到原報價（base）' }; }
    const f0 = (pl.fields && typeof pl.fields === 'object') ? pl.fields : {};
    const fields = {}; ['code', 'client', 'name', 'loc', 'contact', 'phone', 'date'].forEach((k) => { if (f0[k] != null) fields[k] = S(f0[k], 300); });
    if (!String(fields.name || '').trim()) return { err: '要填工程名稱（fields.name）' };
    fields.items = cleanItems(f0.items);
    if (!fields.items.some((it) => !it.sec && it.desc.trim())) return { err: '沒有任何工項' };
    const badIt = fields.items.findIndex((it) => !it.sec && (!D.numOk(it.qty, 1e7) || !D.numOk(it.price, 1e9) || it.qty < 0 || (it.price < 0 && !(it.qty > 0))));
    if (badIt >= 0) return { err: '第 ' + (badIt + 1) + ' 列數量或單價不對（數量不能是負的、減項的數量要大於 0）' };
    fields.exs = arr(f0.exs).slice(0, 50).map((e) => ({ desc: S(e.desc, 200), amt: N(e.amt) || 0 }));
    if (f0.rmk && typeof f0.rmk === 'object' && !Array.isArray(f0.rmk)) {   // 審查：備註只收白名單欄位與自訂條款（不讓任意結構或不合法的 key 進資料庫）
      const r = {}; Object.keys(f0.rmk).forEach((k) => { if (D.has(D.RMK, k) && f0.rmk[k] != null && typeof f0.rmk[k] !== 'object') r[k] = S(f0.rmk[k], k === 'spareTxt' ? 300 : 60); });
      if (Array.isArray(f0.rmk.extra)) r.extra = f0.rmk.extra.slice(0, 50).filter((t) => typeof t === 'string').map((t) => S(t, 300)).filter((t) => t.trim());
      fields.rmk = r;
    }
    const t = D.totals(fields.items, taxR), ee = expectOk(b.expect, t); if (ee) return { err: ee };
    fields.t = t;
    payload = { base, baseMt: bq ? (bq._mt || 0) : 0, baseName: bq ? S(bq.name, 200) : '', fields };
    const am = aimClean(pl.aim); if (am.err) return { err: am.err }; if (am.aim) payload.aim = am.aim;
    summary = (base ? '修改：' : '新報價：') + S(fields.name, 80) + '／' + S(fields.client, 60) + '　合計 NT$ ' + fmt(t.total);
  } else if (type === 'rfqReply') {
    const f = findQuote(quotes, { qid: S(pl.qid, 80), code: S(pl.code, 60) }); if (f.err) return { err: f.err };
    const q = f.q; if (!q) return { err: '找不到這張報價（qid 或 code）' };
    if (!q.awarded) return { err: '這案還沒得標，不能填廠商回價' };
    const rr = replyClean(q, pl); if (rr.err) return { err: rr.err };
    payload = Object.assign({ qid: q.id, qName: S(q.name, 200) }, rr.p);
    summary = S(b.summary, 140).trim() || (S(q.name, 60) + '：' + rr.p.vendor.name + ' 回價 ' + (rr.p.rno || '') + '（' + (rr.p.lump ? '一式 ' + fmt(rr.p.lump.total) : rr.p.prices.length + ' 項單價') + '）');
  } else if (type === 'ownerCard') {
    const f = findQuote(quotes, { qid: S(pl.qid, 80), code: S(pl.code, 60) }); if (f.err) return { err: f.err };
    const q = f.q; if (!q) return { err: '找不到這張報價（qid 或 code）' };
    const cc = cardClean(pl.card); if (cc.err) return { err: cc.err };
    payload = { qid: q.id, qName: S(q.name, 200), fname: S(pl.fname, 120), card: cc.card };
    summary = S(b.summary, 140).trim() || (S(q.name, 80) + '：合約條件卡（' + cc.n + ' 欄）');
  } else {
    const f = findQuote(quotes, { qid: S(pl.qid, 80), code: S(pl.code, 60) }); if (f.err) return { err: f.err };
    const q = f.q; if (!q) return { err: '找不到這張報價（qid 或 code）' };
    if (q.awarded) return { err: '已得標案件不能用草稿改狀態' };
    const to = S(pl.to, 10); if (!Object.prototype.hasOwnProperty.call(BID_TO, to)) return { err: 'to 只能是 awarded／（空白＝待回覆）／nego／lost／void' };
    const from = q.bidStatus || '';
    const lostReason = to === 'lost' ? (LOST.indexOf(S(pl.lostReason, 20)) >= 0 ? S(pl.lostReason, 20) : '其他') : '';
    const note = S(pl.note, 200).trim();
    payload = { qid: q.id, qName: S(q.name, 200), from, to, lostReason, note };
    summary = S(q.name, 80) + '：' + BID_TO[from] + ' → ' + BID_TO[to] + (lostReason ? '（' + lostReason + '）' : '') + (note ? '　' + note : '');
  }
  const rec = { id, type, by: String(email || '').toLowerCase(), byName: S(name, 60), at: now, status: 'pending', summary: S(summary, 200), payload };
  return { rec };
}
// 送出後要標成「已被取代」的舊草稿（同送件人＋同種＋同報價、較早的 pending）
function superseded(rec, all) {
  const k = D.draftKey(rec); if (!k) return [];
  return Object.keys(all || {}).filter((id) => { const d = all[id]; return d && id !== rec.id && d.id === id && ID_RE.test(id) && d.status === 'pending' && (+d.at || 0) <= (+rec.at || 0) && D.draftKey(d) === k; });
}
function withdrawErr(d, email) {
  if (!d) return '找不到這張草稿';
  if (String(d.by || '').toLowerCase() !== String(email || '').toLowerCase()) return '只能撤回自己送的草稿';
  if (d.status !== 'pending') return '這張已經是「' + String(d.status) + '」，不能撤回';
  return '';
}
function mine(all, email) {
  const em = String(email || '').toLowerCase();
  return Object.keys(all || {}).map((k) => all[k]).filter((d) => d && d.status === 'pending' && String(d.by || '').toLowerCase() === em)
    .sort((a, b) => (+a.at || 0) - (+b.at || 0)).map((d) => ({ id: d.id, type: d.type, at: d.at, summary: d.summary }));
}
// v6.0.209 報價得標率統計給報價線讀（action bidStats）：跟前端 _bidRecRows／_bidTune／_bidKindStats 一行對一行（冒煙測試同一份假資料兩邊比）
let BID = null; try { BID = require('../calc/bid.js').bid; } catch (e) { BID = require('../../calc/bid.js').bid; }
function bidStats(quotes, contracts, params, quoteSens) {
  // 得標結果 q.bid 存在 private 的 quoteSens（跟前端 _applyQuoteSens 一樣接回去；key 已經 deepDec 過）
  const SS = quoteSens || {};
  const Q = (Array.isArray(quotes) ? quotes : Object.values(quotes || {})).filter((q) => q && q.id).map((q) => { const s = SS[q.id]; return (s && s.bid && typeof s.bid === 'object') ? Object.assign({}, q, { bid: s.bid }) : q; });
  const CT = (Array.isArray(contracts) ? contracts : Object.values(contracts || {})).filter(Boolean);
  const ctAmt = (q) => { const c = CT.find((x) => x.linkedQid === q.id) || CT.find((x) => x.name && x.name === q.name); return c ? (parseFloat(c.amount) || 0) : 0; };   // 同 _ctAmtOf
  const rows = Q.filter((q) => !q.parentId && q.bid && q.bid.res && !q.bid.skip).map((q) => {
    const items = []; [q].concat(Q.filter((x) => x.parentId === q.id)).forEach((x) => (Array.isArray(x.items) ? x.items : Object.values(x.items || {})).forEach((it) => items.push(it)));
    return { kinds: BID.mainKinds(items), v: BID.view(q, { ctAmt: ctAmt(q) }) };   // 同前端：佔 10% 以上的類別才算
  });
  const t = (params && params.bidTune && typeof params.bidTune === 'object') ? params.bidTune : {};
  const opt = { minN: parseInt(t.minN) || 5, tune: { lo: t.lo != null ? +t.lo : 40, hi: t.hi != null ? +t.hi : 60, maxDown: t.maxDown != null ? +t.maxDown : 10, maxUp: t.maxUp != null ? +t.maxUp : 5 } };
  return { n: rows.length, minN: opt.minN, kinds: BID.exportRows(BID.stats(rows, opt)) };
}
module.exports = { replyClean, cardClean, bidStats, aimClean, rmkBaseFor, TYPES, MAX_PENDING, build, superseded, withdrawErr, mine, expectOk, findQuote };
