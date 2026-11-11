// 改版第 5 步 5d #8：整體日報（純邏輯，不碰 Firebase／LINE；單元測試 functions/test/daily.test.js）
// 輸入：已確認的施工日報（報價的 q.dailyLogs，人在 FJ 確認過才會在裡面）、LINE 群組設定、還沒確認的日報草稿。
// 分流（Lotion 10/21）：
//   豐有內部群組（lineCfg/groups/<gid>.audience === 'internal'）→ 雲端直接推 LINE
//   有營造廠在的群組（audience 'contractor' 或沒設定）→ 建「整體日報」草稿（type dailyOut）給 Lotion，Lotion 自己複製轉發
//   公司大群組（mode 'company'）收全部工地；單一工地群組只收自己那個工地
// 對外版（給營造廠看的）不寫包商名稱、只寫人數、不帶現場自由輸入的備註（不讓業主覺得豐有是皮包客）；兩種版本都不放金額。
'use strict';

const LINE_MAX = 4800;
const WD = ['日', '一', '二', '三', '四', '五', '六'];

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x).filter(Boolean) : []); }
function S(x) { return x == null ? '' : String(x); }
function num(x) { const n = parseFloat(x); return isFinite(n) ? n : 0; }
function fmtN(n) { n = Math.round(num(n) * 100) / 100; return String(n); }
function firstLine(s) { return S(s).split(/\r?\n/)[0].trim(); }
function md(date) { const d = new Date(date + 'T00:00:00Z'); return date.slice(5).replace('-', '/') + '（' + WD[d.getUTCDay()] + '）'; }

// 跟前端 _qNegLine 同一個判斷：減項列（單價負數）不算施工數量
function negLine(it) { return !!it && !it.sec && !it.spare && num(it.price) < 0; }
function workItem(it) { return !!it && !it.sec && !it.spare && !negLine(it); }

// 一個工地當天已確認的日報（同一天可能有停工區間那筆＋施工那筆；只有照片的那筆不算日報）
function logsOn(q, date) { return arr(q && q.dailyLogs).filter((L) => L && L.date === date && !L.photoOnly); }

function crewsOf(L) {
  if (Array.isArray(L.crews) && L.crews.length) return L.crews.filter(Boolean);
  if (L.crewV === 2) return [];   // 今天出工新格式：沒有點工就是沒有（自家員工另記 ownPpl），跟前端 _crewsOf 一樣
  const out = [];
  if (num(L.workers) > 0) out.push({ type: 'labor', vendor: '', n: num(L.workers) });
  if (num(L.subWorkers) > 0 || L.subVendor) out.push({ type: 'sub', vendor: S(L.subVendor), n: num(L.subWorkers) });
  return out;
}

// 一個工地的段落；outward=true＝給營造廠看的版本（不寫包商名稱）
function siteSection(q, Ls, outward) {
  const lines = ['【' + S(q.name || q.id).slice(0, 40) + '】'];
  const items = arr(q.items).length ? q.items : [];
  Ls.forEach((L) => {
    const st = L.status === 'stop' ? '停工' : L.status === 'pause' ? '暫停（階段性退場）' : L.status === 'stage' ? '階段完工' : '施工中';
    lines.push('狀態：' + st + (L.stopFrom && L.stopFrom !== L.date ? '（' + L.stopFrom + ' 起）' : '') + (L.weather ? '　天氣：' + S(L.weather).slice(0, 10) : ''));
    const cs = crewsOf(L).filter((c) => num(c.n) > 0 || c.vendor);
    if (cs.length) {
      if (outward) lines.push('人力：' + cs.reduce((a, c) => a + num(c.n), 0) + ' 人');
      else lines.push('人力：' + cs.map((c) => (c.type === 'sub' ? '承包' : '點工') + ' ' + num(c.n) + ' 人' + (c.vendor ? '（' + S(c.vendor).slice(0, 20) + '）' : '')).join('、'));
    }
    const rows = arr(L.progressRows);
    const done = rows.filter((r) => Number(r.itemIdx) >= 0 && num(r.qty) > 0 && workItem(items[Number(r.itemIdx)]));
    if (done.length) {
      lines.push('進度：');
      done.forEach((r) => { const it = items[Number(r.itemIdx)]; lines.push('・' + firstLine(it.desc).slice(0, 40) + ' ' + fmtN(r.qty) + S(it.unit)); });
    }
    const notes = rows.filter((r) => Number(r.itemIdx) < 0 && S(r.note).trim()).map((r) => S(r.note).replace(/^【LINE】/, '').trim());
    if (!rows.length && S(L.progress).trim()) notes.push(S(L.progress).trim());
    if (notes.length && !outward) lines.push('備註：' + notes.join('；').slice(0, 300));   // 審查：備註是現場自由輸入（可能寫到包商、金額），對外版不帶
  });
  return lines.join('\n');
}

function clip(t) { return t.length > LINE_MAX ? t.slice(0, LINE_MAX - 20) + '\n…（其餘請看 FJ）' : t; }

// 主要：算出這次要推哪些群組、要建哪些草稿、要寫哪些待辦
// inp = { quotes, cfg (lineCfg), pending (還沒確認的 dailyLog 草稿陣列), date 'YYYY-MM-DD', done ({gid:1} 這天已處理過), now }
function plan(inp) {
  const date = inp.date, cfg = inp.cfg || {}, groups = cfg.groups || {}, done = inp.done || {};
  const quotes = arr(inp.quotes).filter((q) => q && q.id && q.awarded && !q.closed);
  const byId = {}; quotes.forEach((q) => { byId[q.id] = q; });
  const confirmed = quotes.filter((q) => logsOn(q, date).length);
  const cset = {}; confirmed.forEach((q) => { cset[q.id] = 1; });
  // 還沒確認：當天有日報草稿、但這個工地還沒有確認過的日報
  const unconf = [];
  arr(inp.pending).forEach((d) => {
    const pl = (d && d.payload) || {};
    if (!d || d.type !== 'dailyLog' || d.status !== 'pending' || pl.date !== date) return;
    if (pl.qid && cset[pl.qid]) return;
    const nm = pl.qid && byId[pl.qid] ? byId[pl.qid].name : (pl.site || '（未分類）');
    if (unconf.indexOf(nm) < 0) unconf.push(S(nm).slice(0, 40));
  });
  // 沒回報：綁了工地、開了日報的群組，當天沒有確認的日報也沒有草稿
  const noRep = [];
  Object.keys(groups).forEach((gid) => {
    const g = groups[gid]; if (!g || !g.qid || g.daily === false || !byId[g.qid] || cset[g.qid]) return;
    const nm = S(byId[g.qid].name).slice(0, 40);
    if (unconf.indexOf(nm) < 0 && noRep.indexOf(nm) < 0) noRep.push(nm);
  });
  const head = (outward) => '豐有工程　施工日報 ' + md(date) + (outward ? '' : '\n已確認 ' + confirmed.length + ' 個工地' + (unconf.length ? '／未確認 ' + unconf.length : '') + (noRep.length ? '／未回報 ' + noRep.length : ''));
  const sep = '\n──────\n';
  const full = (outward) => clip(head(outward) + sep + (confirmed.length ? confirmed.map((q) => siteSection(q, logsOn(q, date), outward)).join(sep) : '（今天沒有已確認的日報）')
    + (!outward && unconf.length ? sep + '未確認：' + unconf.join('、') : '') + (!outward && noRep.length ? (unconf.length ? '\n' : sep) + '未回報：' + noRep.join('、') : ''));
  const sends = [], drafts = [];
  Object.keys(groups).forEach((gid) => {
    const g = groups[gid]; if (!g || g.report === false || done[gid]) return;
    const internal = g.audience === 'internal';
    let text = '', label = '', qid = '';
    if (g.mode === 'company') { if (!confirmed.length) return; text = full(!internal); label = S(g.name || '公司大群組'); }
    else if (g.qid && cset[g.qid] && g.daily !== false) { const q = byId[g.qid]; text = clip(head(true) + sep + siteSection(q, logsOn(q, date), !internal)); label = S(q.name); qid = q.id; }
    else return;
    if (internal) sends.push({ gid, text, label });
    else drafts.push({ id: 'do' + gid.replace(/[^\w]/g, '').slice(-10) + date.replace(/-/g, ''), type: 'dailyOut', by: 'line-bot', byName: 'LINE 機器人', at: inp.now || Date.now(), status: 'pending',
      summary: ('整體日報（營造廠群組，請複製轉發）：' + label + '　' + date).slice(0, 200),
      payload: { groupId: gid, group: label.slice(0, 40), qid, date, text } });
  });
  const todo = {};
  const dk = date.replace(/-/g, '');
  if (unconf.length) todo['unconf_' + dk] = { id: 'daily_unconf_' + dk, src: 'daily', key: 'unconf_' + dk, urgent: false, text: '整體日報：' + date.slice(5) + ' 還有 ' + unconf.length + ' 個工地日報沒確認', sub: '總覽 › AI 草稿（工務確認後再補送）', go: 'drafts', at: inp.now || Date.now() };
  return { date, confirmed: confirmed.map((q) => q.id), unconf, noRep, internalText: full(false), sends, drafts, todo };
}

// 推送失敗的待辦（陳軒看了告訴 Lotion）
function failTodo(fails, date, now) {
  const out = {};
  const dk = String(date).replace(/-/g, '');
  if (fails && fails.length) out['fail_' + dk] = { id: 'daily_fail_' + dk, src: 'daily', key: 'fail_' + dk, urgent: true, text: '整體日報：' + date.slice(5) + ' 有 ' + fails.length + ' 個群組 LINE 沒送出（' + fails.slice(0, 3).join('、') + '）', sub: '人員管理 › LINE 機器人', go: 'staff', at: now || Date.now() };
  return out;
}

module.exports = { plan, failTodo, siteSection, logsOn, negLine, workItem, md, LINE_MAX };
