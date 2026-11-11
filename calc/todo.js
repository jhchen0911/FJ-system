// 改版第 5 步 5b：提醒的純計算（前端與雲端排程 dailyTodos 共用同一份，結果才會逐筆一樣）
// 規則：不讀畫面、不讀全域資料；需要的資料（報價、請款單、今天日期、預設值）一律由參數傳入。
// 對外函式只能新增、不能改既有參數或意義（換版空檔可能舊 app.js 配新 calc）。
(function (root) {
  'use strict';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // 日期字串加減天／相差天數（本地時間；雲端程式要先設 TZ=Asia/Taipei）
  function dAdd(ds, n) { var d = new Date(ds); if (isNaN(d)) return ''; d.setDate(d.getDate() + (n || 0)); return iso(d); }
  function dDiff(a, b) { var x = new Date(a), y = new Date(b); if (isNaN(x) || isNaN(y)) return 0; x.setHours(0, 0, 0, 0); y.setHours(0, 0, 0, 0); return Math.round((y - x) / 864e5); }
  function uFix(u) { if (u == null) return ''; return String(u).replace(/[Mm]\s*[2²㎡](?![0-9])/g, 'm²').replace(/㎡/g, 'm²'); }
  function isSpare(it) { return !!(it && it.spare); }

  // ── 租期（後端 10）──
  function itemCat(it) {
    var c = it && it.cat;
    if (c === 'install') return { install: true, remove: false };
    if (c === 'remove') return { install: false, remove: true };
    if (c === 'both') return { install: true, remove: true };
    if (c === 'other') return { install: false, remove: false };
    var d = String((it && it.desc) || '');
    // 健檢 H2（11/11）：組立、鋪設、架設、吊裝、施打也算裝設（「組立及拆除」原本被判成只有拆除，組立數量記成拆除）；跟 calc/dailyparse.js、functions/ops/progress.js 同一份字表（tests/calc.js 比對）
    return { install: ['打設', '裝設', '安裝', '組立', '鋪設', '架設', '吊裝', '施打'].some(function (w) { return d.indexOf(w) >= 0; }), remove: ['拔除', '拆除', '回收', '撤除'].some(function (w) { return d.indexOf(w) >= 0; }) };
  }
  function rentDaysOf(it) {
    if (!it) return 0;
    var s = String(it.note || '') + ' ' + String(it.desc || '');
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
    s = s.replace(/[不免][含計收算]?\s*\d*\s*[天日]?\s*租\s*期/g, ' ');
    var m = s.match(/(\d+(?:\.\d+)?)\s*[天日]\s*[)）]?\s*租\s*期/) || s.match(/租\s*期\s*[:：（(]{0,2}\s*(\d+(?:\.\d+)?)\s*[天日]/) || s.match(/租\s*期\s*[:：]?\s*(\d+(?:\.\d+)?)(?!\d)/);
    return m ? Math.round(parseFloat(m[1]) || 0) : 0;
  }
  function prPhase(q, r) {
    var it = ((q && q.items) || [])[Number(r && r.itemIdx)] || {};
    var c = itemCat(it);
    if (c.install && c.remove && r && (r.ph === 'remove' || r.ph === 'install')) return r.ph;
    return (c.remove && !c.install) ? 'remove' : 'install';
  }
  function itemProgress(q, idx) {
    var ins = [], rem = [];
    ((q && q.dailyLogs) || []).forEach(function (L) {
      ((L && L.progressRows) || []).forEach(function (r) {
        if (!r || Number(r.itemIdx) !== Number(idx)) return;
        var n = parseFloat(r.qty) || 0; if (n <= 0) return;
        (prPhase(q, r) === 'remove' ? rem : ins).push({ date: L.date || '', qty: n, from: L.backfillFrom || '', done: !!r.batchDone });
      });
    });
    var byD = function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; };
    ins.sort(byD); rem.sort(byD);
    var it = ((q && q.items) || [])[idx] || {};
    var target = Math.abs(parseFloat(it.qty) || 0);
    var cum = 0, doneDate = '';
    ins.forEach(function (r) { cum += r.qty; if (!doneDate && target > 0 && cum >= target - 1e-6) doneDate = r.date; });
    var rcum = 0, remDone = ''; rem.forEach(function (r) { rcum += r.qty; });
    var remTarget = cum > 0 ? cum : target; if (remTarget > 0) { var rc2 = 0; rem.forEach(function (r) { rc2 += r.qty; if (!remDone && rc2 >= remTarget - 1e-6) remDone = r.date; }); }
    var catS = itemCat(it), stIns = '', stRem = '';
    ((q && q.dailyLogs) || []).forEach(function (L) {
      if (!L || L.status !== 'stage') return; var d = L.stageDate || L.date || ''; if (!d) return;
      if (L.stageOf === 'remove') { if (catS.remove && (!stRem || d < stRem)) stRem = d; }
      else if (catS.install && d > stIns) stIns = d;
    });
    var installLast = ins.length ? ins[ins.length - 1].date : '';
    if (stIns && stIns > installLast) installLast = stIns;
    if (!doneDate && stIns) doneDate = stIns;
    var removeFirst = rem.length ? rem[0].date : (stRem || '');
    return { n: ins.length + rem.length, nInstall: ins.length, nRemove: rem.length,
      first: ins.length ? (ins[0].from && ins[0].from < ins[0].date ? ins[0].from : ins[0].date) : '', last: ins.length ? ins[ins.length - 1].date : '',
      installLast: installLast, stageInstall: stIns, stageRemove: stRem,
      removeFirst: removeFirst, removeLast: rem.length ? rem[rem.length - 1].date : (stRem || ''), removeDone: remDone || stRem || '', remLogs: rem, stageRemove2: stRem,
      cum: cum, removeCum: rcum, target: target, doneDate: doneDate };
  }
  function rentEndMode(q) { return (q && q.rentEnd === 'removeDone') ? 'removeDone' : 'removeFirst'; }
  function rentOldQty(pg, qty) { var c = pg && (parseFloat(pg.cum) || 0); if (!(c > 0) || c >= qty || (pg && pg.stageInstall)) return qty; return Math.round(c * 100) / 100; }
  function rentBatchList(pg) {
    var rem = (pg && pg.remLogs) || [], anyDone = rem.some(function (r) { return r.done; }), out = [], acc = 0;
    rem.forEach(function (r) { acc += r.qty; if (anyDone && r.done) { out.push({ date: r.date, qty: acc }); acc = 0; } });
    return { closed: out, open: acc, stage: (pg && pg.stageRemove2) || '', noTick: !anyDone };
  }
  function rentBatchQtyDays(pg, qty, startISO, endISO) {
    var cap = (pg && (parseFloat(pg.cum) || 0) > 0) ? parseFloat(pg.cum) : qty;
    var B = rentBatchList(pg), rows = [], left = Math.min(qty > 0 ? qty : cap, cap > 0 ? cap : Infinity), tot = 0, n = 0;
    var span = Math.max(0, dDiff(startISO, endISO) + 1);
    B.closed.forEach(function (b) { if (left <= 0) return; var q2 = Math.min(b.qty, left); left -= q2; n++;
      var d = Math.max(0, Math.min(dDiff(startISO, b.date) + 1, span)); tot += q2 * d; rows.push({ no: n, date: b.date, qty: q2, days: d }); });
    if (left > 0 && pg && pg.removeDone && !B.stage) { n++; var d3 = Math.max(0, Math.min(dDiff(startISO, pg.removeDone) + 1, span)); tot += left * d3; rows.push({ no: n, date: pg.removeDone, qty: left, days: d3 }); left = 0; }
    if (left > 0) {
      if (B.stage) { n++; var d2 = Math.max(0, Math.min(dDiff(startISO, B.stage) + 1, span)); tot += left * d2; rows.push({ no: n, date: B.stage, qty: left, days: d2 }); }
      else { rows.push({ no: n + 1, date: '', qty: left, days: span, open: true }); tot += left * span; }
    }
    return { qtyDays: tot, rows: rows, noTick: !!B.noTick && (!!((pg && pg.remLogs) || []).length || !!(pg && pg.removeDone) || !!B.stage) };
  }
  // v6.0.225 Lotion 11/10：分段拔樁的逾期租金改照「時段」列（金額不變）——時段 1＝起算日到第一批完成日（含），在場＝全部；
  // 時段 k＝上一批完成日隔天到這一批完成日（含），在場＝還沒拔走的支數；最後還沒拔完的算到 endISO。完成日早於起算日的批次＝0 天（直接扣掉在場量）。
  // 跟 rentBatchQtyDays 同一份批次（同 pg、qty、期間），回傳 { qtyDays（一定等於 rentBatchQtyDays 的 qtyDays）, segs:[{no,from,to,qty,days}] }
  function rentSegments(pg, qty, startISO, endISO) {
    var bq = rentBatchQtyDays(pg, qty, startISO, endISO), rows = bq.rows.slice(), segs = [], tot = 0;
    var onsite = rows.reduce(function (a, r) { return a + (parseFloat(r.qty) || 0); }, 0);
    var cur = startISO, n = 0;
    var push = function (to, q) { var d = Math.max(0, dDiff(cur, to) + 1); if (d > 0 && q > 0) { n++; segs.push({ no: n, from: cur, to: to, qty: Math.round(q * 1000) / 1000, days: d }); tot += q * d; } };
    rows.filter(function (r) { return !r.open && r.date; }).sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : (String(a.date) > String(b.date) ? 1 : 0); }).forEach(function (r) {
      if (cur > endISO) return;
      if (r.date >= cur) { var to = r.date < endISO ? r.date : endISO; push(to, onsite); cur = dAdd(to, 1); }
      onsite -= (parseFloat(r.qty) || 0);
    });
    if (onsite > 1e-9 && cur <= endISO) push(endISO, onsite);
    return { qtyDays: Math.round(tot * 1000) / 1000, segs: segs, base: bq };
  }
  // today：今天（YYYY-MM-DD，由呼叫端給）
  // 健檢 M4（11/11）：報價把打設、拔除分成兩列（「H型鋼 打設」「H型鋼 拔除」）→ 兩列連起來看：租期跟著打設那列、拔除那列的日報讓租金停
  //   配對＝一列只有打設、一列只有拔除，工項名稱拿掉動作字之後一樣、單位一樣，而且只有唯一一對
  function _pairKey(it) { return String((it && it.desc) || '').split('\n')[0].replace(/打設|裝設|安裝|組立|鋪設|架設|吊裝|施打|拔除|拆除|回收|撤除|及|與|和|＋|\+|、|[\s　（）()]/g, '').toUpperCase(); }
  function pairOf(q, idx) {
    var its = (q && q.items) || [], it = its[idx]; if (!it || it.sec) return null;
    var c = itemCat(it); if (c.install === c.remove) return null;
    var k = _pairKey(it), u = uFix(it.unit || ''); if (k.length < 2) return null;
    var hits = []; its.forEach(function (x, j) { if (j === idx || !x || x.sec) return; var cx = itemCat(x); if (cx.install === c.install || cx.remove === c.remove) return; if (_pairKey(x) === k && uFix(x.unit || '') === u) hits.push(j); });
    return hits.length === 1 ? { idx: hits[0], role: c.install ? 'install' : 'remove' } : null;
  }
  function rentStatus(q, idx, endDate, today) {
    var it = ((q && q.items) || [])[idx]; if (!it || it.sec) return null;
    if ((parseFloat(it.qty) || 0) <= 0 || (parseFloat(it.price) || 0) < 0) return null;   // 減帳列（負數量）、減項列（負數單價）沒有租期
    var pr = pairOf(q, idx), its0 = (q && q.items) || [];
    var days = rentDaysOf(it);
    if (pr && pr.role === 'install' && days <= 0) { days = rentDaysOf(its0[pr.idx]); if (days > 0 && !(parseFloat((String(it.ot || '').match(/[\d.]+/) || [0])[0]) > 0)) it = Object.assign({}, it, { ot: its0[pr.idx].ot, otu: its0[pr.idx].otu }); }   // 審查：租期、逾期單價寫在拔除那列也算
    if (days <= 0) return null;
    if (pr && pr.role === 'remove' && (rentDaysOf(its0[pr.idx]) > 0 || days > 0)) return null;   // 健檢 M4：租期一律算在打設那列（拔除那列不另算）
    var pg = itemProgress(q, idx);
    if (pr) { var pg2 = itemProgress(q, pr.idx); if (!pg.removeFirst && pg2.removeFirst) pg = Object.assign({}, pg, { removeFirst: pg2.removeFirst, removeLast: pg2.removeLast, removeDone: pg2.removeDone, remLogs: pg2.remLogs, stageRemove2: pg2.stageRemove2, stageRemove: pg2.stageRemove, removeCum: pg2.removeCum, pairIdx: pr.idx }); }
    var base = pg.installLast || pg.doneDate || pg.last;
    if (!base) return null;
    var start = dAdd(base, 1);
    var expiry = dAdd(start, days - 1);
    var end = endDate || ((q && q.closed && q.closedAt) ? iso(new Date(q.closedAt)) : today);
    var mode = rentEndMode(q);
    if (mode === 'removeDone') { if (pg.removeDone && pg.removeDone < end) end = pg.removeDone; }
    else if (pg.removeFirst && pg.removeFirst < end) end = pg.removeFirst;
    var over = Math.max(0, dDiff(expiry, end));
    var price = parseFloat((String(it.ot || '').match(/[\d.]+/) || [0])[0]) || 0;
    var qty = Math.abs(parseFloat(it.qty) || 0);
    if (mode !== 'removeDone') qty = rentOldQty(pg, qty);
    var head = { pairIdx: pr ? pr.idx : null, idx: idx, desc: String(it.desc || '').split('\n')[0], unit: it.unit || '', days: days, installDate: base, removeFirst: pg.removeFirst || '', estimated: !pg.doneDate, cum: pg.cum, target: pg.target,
      start: start, expiry: expiry, endDate: end, overDays: over, endMode: mode, removeDone: pg.removeDone || '' };
    if (mode === 'removeDone' && over > 0) {
      var bq = rentBatchQtyDays(pg, qty, dAdd(expiry, 1), end);
      return Object.assign(head, { batches: bq.rows, qtyDays: bq.qtyDays, otPrice: price, otUnit: it.otu || '', qty: qty, amount: Math.round(price * bq.qtyDays) });
    }
    return Object.assign(head, { otPrice: price, otUnit: it.otu || '', qty: qty, amount: Math.round(price * qty * over) });
  }
  function rentScan(q, endDate, today) {
    var out = [];
    ((q && q.items) || []).forEach(function (it, i) { var s = rentStatus(q, i, endDate, today); if (s) out.push(s); });
    out.sort(function (a, b) { return b.overDays - a.overDays; });
    return out;
  }
  // 逾期租金待辦（總覽「租期已逾期」）：進行中的得標主報價，有工項逾期就一筆
  function rentTodos(quotes, today) {
    var out = [];
    (quotes || []).filter(function (q) { return q && q.awarded && !q.parentId && !q.closed; }).forEach(function (q) {
      var over = rentScan(q, today, today).filter(function (x) { return x && x.overDays > 0; });
      if (over.length) out.push({ qid: q.id, name: q.name || '', n: over.length, amt: over.reduce(function (a, x) { return a + (x.amount || 0); }, 0), maxD: Math.max.apply(null, over.map(function (x) { return x.overDays; })) });
    });
    return out;
  }
  // 租期快到（到期前 7 天，後端 10「到期前 7 天 → 今天卡片」）：還沒拔除、到期日在 0～7 天內
  function rentSoon(quotes, today) {
    var out = [];
    (quotes || []).filter(function (q) { return q && q.awarded && !q.parentId && !q.closed; }).forEach(function (q) {
      rentScan(q, today, today).forEach(function (s) {
        if (s.overDays > 0 || s.removeFirst) return;
        var left = dDiff(today, s.expiry); if (left < 0 || left > 7) return;
        out.push({ qid: q.id, name: q.name || '', idx: s.idx, desc: s.desc, expiry: s.expiry, left: left });
      });
    });
    return out;
  }

  // ── 預計收款日（後端 12）──
  // o＝專案 q.ownerPay、c＝客戶資料、def＝{delay,cut,day}、payDefV＝q.payDefV
  function recvRule(o, c, def, payDefV) {
    o = o || {}; c = c || {}; def = def || { delay: 1, cut: 25, day: 20 };
    var num = function (v) { var x = (v == null || v === '') ? NaN : parseFloat(v); return isNaN(x) ? null : x; }, pk = function (a, b) { var x = num(a); return x != null ? x : num(b); };
    var R = null;
    if (num(o.delay) != null || num(o.day) != null) R = { src: '專案', cut: pk(o.cut, c.payDue), delay: pk(o.delay, c.payMonthDelay), day: pk(o.day, c.recvDay), cashPct: pk(o.cashPct, c.payTermCash), ticketDays: pk(o.ticketDays, c.payTermTicket) };
    else if (c.recvRuleOn) R = { src: '客戶', cut: num(c.payDue), delay: num(c.payMonthDelay), day: num(c.recvDay), cashPct: num(c.payTermCash), ticketDays: num(c.payTermTicket) };
    if (!R) return null;
    R.cpSet = R.cashPct != null || R.ticketDays != null;
    R.delay = R.delay == null ? def.delay : Math.max(0, Math.round(R.delay)); R.ticketDays = R.ticketDays == null ? 0 : Math.max(0, Math.round(R.ticketDays));
    if (R.cashPct == null) R.cashPct = R.ticketDays > 0 ? 0 : 100; R.cashPct = Math.max(0, Math.min(100, R.cashPct));
    R.cut = Math.max(1, Math.min(31, Math.round(R.cut || def.cut)));
    var dayDef = payDefV === 2 ? def.day : (R.cut || def.cut);
    R.day = Math.max(1, Math.min(31, Math.round(R.day || dayDef)));
    return R;
  }
  function byRule(dateISO, R) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || '')); if (!m || !R) return null;
    var y = +m[1], mo = +m[2] - 1, dd = +m[3], bm = mo + ((R.cut && dd > R.cut) ? 1 : 0), tm = bm + R.delay;
    var last = new Date(y, tm + 1, 0).getDate(), pay = new Date(y, tm, R.day ? Math.min(R.day, last) : last);
    var tk = (R.ticketDays > 0 && R.cashPct < 100) ? new Date(y, tm, pay.getDate() + R.ticketDays) : null;
    return { date: iso(pay), ticketDate: tk ? iso(tk) : '' };
  }
  // R＝recvRule 的結果（沒有規則傳 null）
  function expectedDate(inv, R) {
    if (inv && inv.recvOv && inv.recvOv.date) return { date: inv.recvOv.date, est: false, src: 'manual', reason: inv.recvOv.reason || '' };
    if (R && inv.date && (!inv.expectedRecvDate || inv.recvRule === 1)) { var k = byRule(inv.date, R); if (k) return { date: k.date, est: true, src: 'rule', rule: R, ticketDate: k.ticketDate }; }
    if (inv.expectedRecvDate) return { date: inv.expectedRecvDate, est: false };
    var y = 0, m = 0;
    if (inv.date && /^\d{4}-\d{2}/.test(inv.date)) { var p1 = inv.date.split('-'); y = parseInt(p1[0]); m = parseInt(p1[1]); }
    else if (inv.month) {
      var m1 = String(inv.month).match(/^(\d{4})[-/](\d{1,2})/), m2 = String(inv.month).match(/^(\d{2,3})年(\d{1,2})月/);
      if (m1) { y = parseInt(m1[1]); m = parseInt(m1[2]); } else if (m2) { y = parseInt(m2[1]) + 1911; m = parseInt(m2[2]); }
    }
    if (!y || !m) return null;
    var delay = (inv.payMonthDelay === '' || inv.payMonthDelay == null) ? 1 : (parseInt(inv.payMonthDelay) || 0);
    if (delay < 1) delay = 1;
    var dom = parseInt(inv.recvDay) || parseInt(inv.payDue) || 0;
    var t = dom ? new Date(y, m - 1 + delay, dom) : new Date(y, m - 1 + delay + 1, 0);
    return { date: iso(t), est: true };
  }
  // v6.0.174：請款日期寬鬆解析（2026-10-05／2026/10/5／2026.10.05／115/10/05／115年10月5日），一律當地時間；
  // 原本 new Date(字串) 在 iPhone Safari 遇到非 ISO 格式會變 Invalid Date → 手機少一筆逾期提醒、電腦有
  function looseDate(s, fb) {
    var t = String(s == null ? '' : s).trim();
    // 帶時間（ISO 時間戳）照原本解析；年份只認西元 4 位數（1990～2100）或民國 3 位數（90～199），其他（如 12/31/2026）交給 new Date
    var m = /T\d/.test(t) ? null : /^(\d{3,4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?!\d)/.exec(t);
    if (m) { var y = +m[1]; if (y >= 90 && y < 200) y += 1911; if (y >= 1990 && y <= 2100 && +m[2] >= 1 && +m[2] <= 12) return new Date(y, +m[2] - 1, +m[3]); }
    var d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d : fb;
  }
  // 收款提醒（總覽「預計明天／今天收款、逾期未收」）：inv 需帶 ar（未收金額）與 exp（expectedDate 的結果）；nowMs＝現在
  function recvTodos(rows, nowMs) {
    var out = [], now = new Date(nowMs);
    var du = function (ds) { var p = ds.split('-'); return Math.ceil((new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])).getTime() - now.getTime()) / 864e5); };
    (rows || []).forEach(function (x) {
      var inv = x.inv; if (!inv || inv.receivedConfirmed) return; if (!(x.ar > 0)) return;
      if (x.exp) { var d = du(x.exp.date); if (d > 1) return; out.push({ id: inv.id, d: d, date: x.exp.date, ar: x.ar }); return; }
      var recvDay = parseInt(inv.recvDay) || parseInt(inv.payDue) || 0; if (!recvDay) return;
      var payDelay = parseInt(inv.payMonthDelay) || 0, baseDate = looseDate(inv.date, now);
      var dueD = new Date(baseDate.getFullYear(), baseDate.getMonth() + payDelay, recvDay), overDays = Math.floor((now.getTime() - dueD.getTime()) / 864e5);
      if (overDays > 0 && overDays < 1825) out.push({ id: inv.id, d: -overDays, date: '', ar: x.ar });
    });
    return out;
  }

  // ── 保留款到期（後端 13；Lotion 11/04：起算＝系統結案日，＋合約寫的月數；手填日期優先）──
  // 從退還條件文字抓月數：「完工驗收後 12 個月」「一年」「一年半」「半年」「十八個月」；抓不到或不合理（不在 1～120）回 null
  // 審查：日期（12月31日、114年12月）、民國年（114 年）不算；有好幾段（6 個月退一半、12 個月退一半）取最長的，不提早報逾期
  var CNM = [['三十六', 36], ['二十四', 24], ['二十', 20], ['十八', 18], ['十五', 15], ['十二', 12], ['十一', 11], ['十', 10], ['一', 1], ['二', 2], ['兩', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9]];
  function retMonths(cond) {
    var s = String(cond || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
    s = s.replace(/\d+\s*年\s*\d+\s*月(\s*\d+\s*[日號])?/g, ' ').replace(/\d+\s*月\s*\d+\s*[日號]/g, ' ').replace(/(民國|中華民國)\s*\d+\s*年/g, ' ');
    var c = [], m, re;
    re = /(\d+(?:\.\d+)?)\s*個\s*月/g; while ((m = re.exec(s))) c.push(Math.round(parseFloat(m[1])));
    re = /(?:^|[^\d年.])(\d+)\s*月(?!\s*\d)(?![日號份底初中])/g; while ((m = re.exec(s))) c.push(parseInt(m[1], 10));
    re = /(\d+(?:\.\d+)?)\s*年(半)?(?!\s*\d*\s*月)(?![度])/g; while ((m = re.exec(s))) { var y = parseFloat(m[1]); if (y > 0 && y <= 10) c.push(Math.round(y * 12) + (m[2] ? 6 : 0)); }
    if (/(^|[^一二兩三四五六七八九十])半年/.test(s)) c.push(6);
    CNM.forEach(function (p) { if (new RegExp(p[0] + '\\s*個\\s*月').test(s)) { var rest = s.replace(new RegExp('[一二兩三四五六七八九十]+' + '(?=' + p[0] + '\\s*個\\s*月)'), ''); if (rest === s) c.push(p[1]); } });
    re = /([一二兩三])\s*年(半)?/g; while ((m = re.exec(s))) { var cy = { 一: 1, 二: 2, 兩: 2, 三: 3 }[m[1]]; c.push(cy * 12 + (m[2] ? 6 : 0)); }
    c = c.filter(function (n) { return n >= 1 && n <= 120; });
    return c.length ? Math.max.apply(null, c) : null;
  }
  function addMonths(isoDate, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || '')); if (!m) return '';
    var y = +m[1], mo = +m[2] - 1 + n, d = +m[3], last = new Date(y, mo + 1, 0).getDate();
    return iso(new Date(y, mo, Math.min(d, last)));
  }
  // o＝{manual:手填預計退還日, closedAt:結案時間（毫秒或日期）, cond:退還條件文字, months:專案填的月數}
  // 回傳 {date, src:'manual'|'rule'|'', months, base, why}
  function retDue(o) {
    o = o || {};
    if (o.manual) return { date: String(o.manual), src: 'manual', months: null, base: '', why: '' };
    var mo = (o.months != null && o.months !== '' && isFinite(parseFloat(o.months))) ? Math.round(parseFloat(o.months)) : retMonths(o.cond);
    if (mo != null && !(mo >= 0 && mo <= 120)) mo = null;   // 審查：手填也限 0～120
    if (mo == null) return { date: '', src: '', months: null, base: '', why: o.cond ? 'nomonths' : 'nocond' };
    if (!o.closedAt) return { date: '', src: '', months: mo, base: '', why: 'open' };
    var base = typeof o.closedAt === 'number' ? iso(new Date(o.closedAt)) : String(o.closedAt).slice(0, 10);
    return { date: addMonths(base, mo), src: 'rule', months: mo, base: base, why: '' };
  }

  // ── 結案判定（後端 17；Lotion 10/21：有保留款＝收回＋包商結清；沒保留款＝最後一期款收齊＋包商結清＋材料退完）──
  // o＝{q, hasRet, retLeft（未退保留款）, invs:[{ar}], allDone（日報全部完工或合約已完工）, payLeft（未付應付筆數）, matLeft（在場材料筆數）}
  function closeReady(o) {
    o = o || {}; var q = o.q;
    if (!q || q.closed || !q.awarded || q.parentId) return null;
    var why = [];
    if (o.payLeft > 0) why.push('pay');
    if (o.hasRet) { if (o.retLeft > 0) why.push('ret'); if (o.matLeft > 0) why.push('mat'); }   // 健檢（11/11）：有保留款的案子也要材料退完才出結案卡
    else {
      if (!(o.invs || []).length || (o.invs || []).some(function (x) { return x.ar > 0; })) why.push('recv');
      if (!o.allDone) why.push('done');
      if (o.matLeft > 0) why.push('mat');
    }
    return { qid: q.id, ok: !why.length, why: why };
  }

  // ── 報價改版連動（後端 20）：詢價單／分包依據的報價版次落後、而且工項真的有差 ──
  function rfqKey(d) { return String(d || '').split('\n')[0].replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ''); }
  function rfqGL(d) { return (String(d || '').match(/GL\s*[-－]?\s*[\d.]+\s*m?(?:\s*[～~至\-－]\s*[-－]?\s*[\d.]+\s*m?)?/gi) || []).map(function (x) { return x.replace(/\s+/g, ''); }).join('、'); }
  // hist＝這張報價的版次紀錄陣列（Q_HISTORY[qid]）
  function rfqBaseVer(q, r, hist) {
    if (r && r.quoteVer) return { ver: parseInt(r.quoteVer) || 1, inferred: false };
    var t = (r && (r.ts || Date.parse(String(r.date || '') + 'T23:59:59'))) || 0;
    var hs = (hist || []).filter(function (e) { return e && e.formal && (e.savedAt || 0) > t; });
    return { ver: hs.length ? Math.min.apply(null, hs.map(function (e) { return e.ver || 1; })) : ((q && q.ver) || 1), inferred: true };
  }
  function rfqQuoteDiff(q, r, hist) {
    var rfqs = (q && Array.isArray(q.rfqs)) ? q.rfqs : [];
    var cur = (q && q.ver) || 1, b = rfqBaseVer(q, r, hist), out = { ver: cur, base: b.ver, inferred: b.inferred, diffs: [], added: [], map: {}, any: false };
    if (!q || !r || r.status === 'labor' || b.ver >= cur) return out;
    var se = (hist || []).find(function (x) { return x && x.formal && (x.ver || 1) === b.ver && x.snapshot; }), snap = se ? se.snapshot : null;
    var sItems = (snap && Array.isArray(snap.items)) ? snap.items : null, qi = q.items || [];
    var findK = function (arr, k) { for (var j = 0; j < arr.length; j++) { var x = arr[j]; if (x && !x.sec && rfqKey(x.desc) === k) return j; } return -1; };
    (r.items || []).forEach(function (it) {
      var idx = parseInt(it.idx), bi = null;
      if (it.qd != null) bi = { desc: it.qd, unit: it.unit, qty: it.oq };
      else if (sItems) { var k0 = rfqKey(it.desc), bj = (sItems[idx] && rfqKey(sItems[idx].desc) === k0) ? idx : findK(sItems, k0); if (bj >= 0) bi = { desc: sItems[bj].desc, unit: sItems[bj].unit, qty: sItems[bj].qty }; }
      if (!bi) bi = { desc: it.desc, unit: it.unit, qty: null, legacy: true };
      var k = rfqKey(bi.desc), ni = (qi[idx] && !qi[idx].sec && rfqKey(qi[idx].desc) === k) ? idx : findK(qi, k), nm = String(bi.desc || '').split('\n')[0];
      if (ni < 0) { out.diffs.push({ t: 'del', idx: idx, desc: nm }); return; }
      out.map[idx] = ni; var ci = qi[ni];
      var d0 = String(bi.desc || '').trim(), d1 = String(ci.desc || '').trim(); if (bi.legacy) { d0 = d0.split('\n')[0]; d1 = d1.split('\n')[0]; }
      var g0 = rfqGL(d0), g1 = rfqGL(d1);
      if (g0 !== g1) out.diffs.push({ t: 'depth', idx: idx, ni: ni, desc: nm, from: g0 || '—', to: g1 || '—' });
      else if (d0.replace(/\s+/g, '') !== d1.replace(/\s+/g, '')) out.diffs.push({ t: 'desc', idx: idx, ni: ni, desc: nm, from: d0, to: d1 });
      if (bi.qty != null && bi.qty !== '' && Math.abs((parseFloat(bi.qty) || 0) - (parseFloat(ci.qty) || 0)) > 1e-9) out.diffs.push({ t: 'qty', idx: idx, ni: ni, desc: nm, from: parseFloat(bi.qty) || 0, to: parseFloat(ci.qty) || 0, unit: uFix(ci.unit || '') });
      if (bi.unit && uFix(bi.unit || '') !== uFix(ci.unit || '')) out.diffs.push({ t: 'unit', idx: idx, ni: ni, desc: nm, from: uFix(bi.unit || ''), to: uFix(ci.unit || '') });
    });
    if (sItems) { var allK = {}; rfqs.forEach(function (x) { (x.items || []).forEach(function (it) { allK[rfqKey(it.desc)] = 1; }); });
      qi.forEach(function (x) { if (!x || x.sec || isSpare(x) || (parseFloat(x.price) || 0) < 0 || !String(x.desc || '').trim()) return; var k = rfqKey(x.desc); if (findK(sItems, k) < 0 && !allK[k]) out.added.push(String(x.desc || '').split('\n')[0]); }); }
    out.any = out.diffs.length > 0;
    return out;
  }
  // 每張進行中的得標主報價：有幾張詢價／分包還沒跟上新版次；histOf(qid)＝版次紀錄
  function rfqVerTodos(quotes, histOf) {
    var out = [];
    (quotes || []).forEach(function (q) {
      if (!q || q.parentId || q.closed || !q.awarded) return;
      var rs = Array.isArray(q.rfqs) ? q.rfqs : [];
      var n = rs.filter(function (r) { return rfqQuoteDiff(q, r, histOf ? histOf(q.id) : []).any; }).length;
      if (n) out.push({ qid: q.id, name: q.name || '', ver: q.ver || 1, n: n });
    });
    return out;
  }

  // ── 期票兌現（後端 24，寫好先不啟用）：未兌現、7 天內到期或已到期 ──
  function ticketTodos(invs, nowMs) {
    var out = [], now = new Date(nowMs);
    (invs || []).forEach(function (inv) {
      (Array.isArray(inv && inv.receipts) ? inv.receipts : []).forEach(function (r) {
        if (!r || r.kind !== 'ticket' || !((parseFloat(r.amt) || 0) > 0) || r.status !== 'hold' || !r.dueDate) return;
        var dd = Math.ceil((new Date(r.dueDate).getTime() - now.getTime()) / 864e5); if (dd > 7) return;
        out.push({ id: inv.id, ticketNo: r.ticketNo || '', dueDate: r.dueDate, dd: dd, amt: parseFloat(r.amt) || 0 });
      });
    });
    return out;
  }

  // ── 請款單工項還原（雲端讀到的是壓縮過的；表跟 app.js _INV_K 一樣，冒煙測試比對）──
  var INV_K = { type: 't', desc: 'd', unit: 'u', contractPrice: 'cp', contractQty: 'cq', prevQty: 'pq', prevAmt: 'pa', curQty: 'q', curDays: 'cd', curAmt: 'a', note: 'n', cumQty: 'mq', cumAmt: 'ma', payRate: 'r',
    installCum: 'ic', removeCum: 'rc', prevPayRate: 'pr', otPrice: 'op', otUnit: 'ou', cat: 'ct', phase: 'ph', discDays: 'dd', discAsk: 'da', discNote: 'dn' };
  var INV_KR = (function () { var r = {}; Object.keys(INV_K).forEach(function (k) { r[INV_K[k]] = k; }); return r; })();
  function invUnpack(inv) {
    if (!inv || typeof inv !== 'object' || !inv._ip) return inv;
    var c = Object.assign({}, inv);
    c.items = Array.isArray(inv.items) ? inv.items.map(function (o) { if (!o || typeof o !== 'object') return o; var it = {}; Object.keys(o).forEach(function (k) { if (INV_KR[k]) it[INV_KR[k]] = o[k]; else it[k] = o[k]; }); return it; }) : [];
    delete c._ip; return c;
  }

  // ── 超支檢查（後端 15；Lotion 10/19：實際成本 ≧ 報價成本 110%；10/21：每月只查、不回寫單價庫）──
  function effQtyMap(q, invs) {
    var map = {};
    (invs || []).forEach(function (inv) {
      if (!inv) return; if (!(inv.quoteId === q.id || (!inv.quoteId && inv.project === q.name))) return;
      (inv.items || []).forEach(function (x) { if (!x || x.type === 'sec' || x.origContractQty == null) return; map[String(x.desc || '').trim()] = parseFloat(x.contractQty) || 0; });
    });
    return map;
  }
  function effQty(map, it) { var k = String((it && it.desc) || '').trim(); return (map && map[k] != null) ? map[k] : (parseFloat(it && it.qty) || 0); }
  function itemActual(q, i) {
    var it = ((q && q.items) || [])[i]; if (!it || it.sec || isSpare(it)) return null;
    var cat = itemCat(it), stI = '', stR = '';
    ((q && q.dailyLogs) || []).forEach(function (L) { if (!L || L.status !== 'stage') return; var d = L.stageDate || L.date || ''; if (!d) return; if (L.stageOf === 'remove') { if (!stR || d < stR) stR = d; } else if (d > stI) stI = d; });
    if (!stI && !stR) return null;
    var pg = itemProgress(q, i);
    if ((cat.install || !cat.remove) && stI && pg.cum > 0) return { qty: Math.round(pg.cum * 100) / 100, date: stI, ph: 'install' };
    if (cat.remove && !cat.install && stR && pg.removeCum > 0) return { qty: Math.round(pg.removeCum * 100) / 100, date: stR, ph: 'remove' };
    return null;
  }
  function actQtyMap(q, invs) { var m = effQtyMap(q, invs); ((q && q.items) || []).forEach(function (it, i) { var a = itemActual(q, i); if (a) m[String(it.desc || '').trim()] = a.qty; }); return m; }
  function costByItem(q) {
    var map = {}, unassigned = 0, n = ((q && q.items) || []).length;
    var ok = function (v) { var i = parseInt(v); return !isNaN(i) && i >= 0 && i < n; };
    ((q && q.costs) || []).forEach(function (c) {
      if (c.type === 'sub' && c.rows && c.rows.length) {
        c.rows.forEach(function (r) { var amt = (parseFloat(r.qty) || 0) * (parseFloat(r.unitPrice) || 0); if (ok(r.linkedItemIdx)) map[r.linkedItemIdx] = (map[r.linkedItemIdx] || 0) + amt; else unassigned += amt; });
      } else { var amt2 = parseFloat(c.amt) || 0; if (ok(c.linkedItemIdx)) map[c.linkedItemIdx] = (map[c.linkedItemIdx] || 0) + amt2; else unassigned += amt2; }
    });
    return { map: map, unassigned: unassigned };
  }
  // 每個工項：報價成本（生效數量 × 成本單價）有填、實際成本 ≧ ratio 倍 → 超支（同工程專案「工項成本分析」的算法）
  function overrun(q, invs, ratio) {
    ratio = ratio || 1.1; var att = costByItem(q), em = actQtyMap(q, invs), out = [];
    ((q && q.items) || []).forEach(function (it, i) {
      if (!it || it.sec || isSpare(it) || (parseFloat(it.price) || 0) < 0) return;   // 減項列（負數單價）不查超支
      var est = effQty(em, it) * (parseFloat(it.estCost) || 0), act = att.map[i] || 0;
      if (est > 0 && act >= est * ratio - 1e-6) out.push({ idx: i, desc: String(it.desc || '').split('\n')[0], est: Math.round(est), act: Math.round(act), pct: Math.round(act / est * 100) });
    });
    return out;
  }

  // ── 每月請款（後端 11）：各案請款截止日前 5 天，有新日報數量、這期還沒開單 → 本月要請款的工地＋草稿數量 ──
  // cut＝截止日（每月幾號；專案 q.ownerPay.cut ＞ 客戶 payDue ＞ 預設 25）；這一期＝上個截止日隔天～這個截止日
  function cutOf(q, cust, def) {
    var o = (q && q.ownerPay) || {}, c = cust || {}, x = parseFloat(o.cut); if (!(x >= 1)) x = parseFloat(c.payDue); if (!(x >= 1)) x = (def && def.cut) || 25;   // 審查：0／空白不算截止日
    return Math.max(1, Math.min(31, Math.round(x)));
  }
  function cycleOf(today, cut) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today)); var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var endM = d > Math.min(cut, new Date(y, mo + 1, 0).getDate()) ? mo + 1 : mo;
    var end = new Date(y, endM, Math.min(cut, new Date(y, endM + 1, 0).getDate()));
    var prev = new Date(y, endM - 1, Math.min(cut, new Date(y, endM, 0).getDate()));
    return { start: dAdd(iso(prev), 1), end: iso(end) };
  }
  // o＝{q, invs（這案的請款單）, cust, def, today}；回傳 null 或 {qid,name,cutDate,left,since,items:[{idx,desc,unit,qty}]}
  function monthBill(o) {
    var q = o.q; if (!q || !q.awarded || q.parentId || q.closed) return null;
    var cy = cycleOf(o.today, cutOf(q, o.cust, o.def)), left = dDiff(o.today, cy.end);
    if (left < 0 || left > 5) return null;
    var invs = (o.invs || []).filter(function (i) { return i && i.kind !== 'retReturn'; });
    var from = dAdd(cy.end, -20);   // 審查：截止日後幾天才開上一期的單（例：25 日截止、26 日開）不算這期；這期的單＝截止日前 20 天內開的
    if (invs.some(function (i) { var d = String(i.date || ''); return d >= from && d <= cy.end; })) return null;   // 這期已開單
    var last = invs.map(function (i) { return String(i.date || ''); }).sort().pop() || '';
    var qty = {};
    ((q && q.dailyLogs) || []).forEach(function (L) {
      var d = String((L && L.date) || ''); if (!d || d <= last || d > cy.end) return;
      ((L && L.progressRows) || []).forEach(function (r) { var n = parseFloat(r && r.qty) || 0; if (n > 0) { var i = Number(r.itemIdx); qty[i] = (qty[i] || 0) + n; } });
    });
    var items = Object.keys(qty).map(function (k) { var it = (q.items || [])[+k] || {}; return { idx: +k, desc: String(it.desc || '').split('\n')[0], unit: uFix(it.unit || ''), qty: Math.round(qty[k] * 100) / 100 }; })
      .filter(function (x) { var it = (q.items || [])[x.idx]; return it && !it.sec && !((parseFloat(it.price) || 0) < 0); });
    // 健檢 M1（11/11）：只有逾期租金、沒有新日報的月份也要出請款單草稿（逾期租金單獨觸發）
    var rent = []; try { rent = rentScan(q, cy.end, o.today).filter(function (x) { return x && x.overDays > 0; }).map(function (x) { return { idx: x.idx, desc: String(x.desc || '').split('\n')[0], overDays: x.overDays, amount: x.amount || 0, end: cy.end }; }); } catch (e) { rent = []; }
    if (!items.length && !rent.length) return null;
    return { qid: q.id, name: q.name || '', cutDate: cy.end, left: left, since: last, items: items, rent: rent, rentOnly: !items.length };
  }

  // ── 全部提醒一次算（雲端 dailyTodos 與前端並行比對共用）──
  // d＝{quotes, invoices, contracts, customers, payables, matLedger, histOf(qid)}；ctx＝{today, now, tax, payDef:{cut,delay,day}, inv:FJC.inv}
  // 回傳 {rent:[], rentSoon:[], recv:[], ret:[], close:[], rfqVer:[], ticket:[]}（只放案名、期別、天數；金額只在 amt 欄，寫進雲端待辦前由呼叫端決定要不要帶）
  function build(d, ctx) {
    d = d || {}; ctx = ctx || {};
    var I = ctx.inv, today = ctx.today, now = ctx.now, taxR = I.taxR(ctx.tax), taxM = I.taxM(ctx.tax);
    var quotes = (d.quotes || []).filter(Boolean), invs = (d.invoices || []).filter(Boolean), cts = (d.contracts || []).filter(Boolean), custs = (d.customers || []).filter(Boolean);
    var qById = {}; quotes.forEach(function (q) { if (q.id) qById[q.id] = q; });
    var qOf = function (inv) { var id = inv.quoteId || inv.sourceQid; return (id && qById[id]) || (inv.project ? quotes.find(function (x) { return !x.parentId && x.name === inv.project; }) : null) || null; };
    var custOf = function (inv, q) { var n = String((inv && inv.client) || (q && q.client) || '').trim(); return n ? (custs.find(function (c) { return c.name === n; }) || null) : null; };
    var ownerRetPct = function (q) { var r = q && q.deduct && q.deduct.ret; return (r != null && r !== '') ? (parseFloat(r) || 0) : 0; };
    var retPctOf = function (inv) { var v = inv && inv.retentionPct; if (v != null && v !== '') return parseFloat(v) || 0; if (inv && inv.retention && inv.kind !== 'retReturn') return 10; return ownerRetPct(qOf(inv)); };
    var offset = function (inv) { return (parseFloat(inv.recvFee) || 0) + (parseFloat(inv.recvDeduct) || 0) + (parseFloat(inv.recvHold) || 0) + ((inv.allow) ? (parseFloat(inv.allow.amt) || 0) : 0); };
    var arOf = function (inv) { return (!inv || inv.receivedConfirmed) ? 0 : I.ar(inv, offset(inv)); };
    var expOf = function (inv) { var R = null; if (!(inv.recvOv && inv.recvOv.date)) { var q = qOf(inv); R = recvRule((q && q.ownerPay) || {}, custOf(inv, q) || {}, ctx.payDef, q && q.payDefV); } return expectedDate(inv, R); };
    var out = { rent: rentTodos(quotes, today), rentSoon: rentSoon(quotes, today), recv: [], ret: [], close: [], rfqVer: rfqVerTodos(quotes, d.histOf), ticket: ticketTodos(invs, now) };
    out.recv = recvTodos(invs.map(function (inv) { return { inv: inv, ar: arOf(inv), exp: (!inv.receivedConfirmed && arOf(inv) > 0) ? expOf(inv) : null }; }), now);
    // 保留款（同前端 _retentionRows）
    var byProj = {};
    invs.forEach(function (inv) {
      var held = (!inv.retention || inv.retentionReturned) ? 0 : I.retention(inv, taxR, retPctOf(inv));
      var retAll = (!inv.retention) ? 0 : ((inv.totals && parseFloat(inv.totals.curTotal)) ? Math.round(inv.totals.curTotal * taxM * retPctOf(inv) / 100) : ((inv.totals && parseFloat(inv.totals.retention)) || 0));
      var hold = I.hold(inv), holdRet = I.holdRetCash(inv).amt;
      if (!retAll && !hold && !holdRet) return;
      var k = inv.project || '（未命名）';
      var o = byProj[k] = byProj[k] || { proj: k, accr: 0, returned: 0, pending: 0, hold: 0, q: null };
      if (!o.q) o.q = qOf(inv);
      o.accr += retAll; if (inv.retentionReturned) o.returned += retAll; else o.pending += held;
      o.hold += hold; o.returned += holdRet;
    });
    var retByQ = {};
    Object.keys(byProj).forEach(function (k) {
      var r = byProj[k], ct = cts.find(function (c) { return c.name === r.proj; });
      var done = !!(ct && (ct.status === 'completed' || ct.status === 'done')), left = r.pending + r.hold;
      var dd = (r.q && r.q.deduct) || {}, rd = retDue({ manual: dd.retDue, closedAt: r.q && r.q.closed ? r.q.closedAt : null, cond: dd.retCond, months: dd.retMonths });
      if (r.q) { var rid = r.q.parentId || r.q.id, rb = retByQ[rid] = retByQ[rid] || { accr: 0, left: 0 }; rb.accr += r.accr; rb.left += left; }   // 審查：追加案的保留款算回主約
      if (left > 0 && (done || (rd.date && rd.date < today))) out.ret.push({ proj: r.proj, qid: r.q ? r.q.id : '', due: done, overdue: !!(rd.date && rd.date < today), date: rd.date, src: rd.src, amt: left });
    });
    // 結案判定
    var pays = (d.payables || []).filter(Boolean), mats = (d.matLedger || []).filter(Boolean);
    quotes.forEach(function (q) {
      if (!q.awarded || q.parentId || q.closed) return;
      var ids = [q.id].concat(quotes.filter(function (x) { return x.parentId === q.id; }).map(function (x) { return x.id; }));
      var my = invs.filter(function (inv) { return inv.kind !== 'retReturn' && (ids.indexOf(inv.quoteId) >= 0 || ids.indexOf(inv.sourceQid) >= 0 || (!inv.quoteId && !inv.sourceQid && inv.project === q.name)); });
      var ct = cts.find(function (c) { return c.linkedQid === q.id || c.name === q.name; });
      var stage = null; (q.dailyLogs || []).forEach(function (L) { if (!L || L.status !== 'stage') return; var dt = L.stageDate || L.date || ''; if (!stage || dt > (stage.stageDate || stage.date || '')) stage = L; });
      var allDone = !!((ct && (ct.status === 'completed' || ct.status === 'done')) || (stage && stage.stageOf === 'remove'));
      if (!allDone && !my.length) return;   // 還沒開工請款也沒完工：不判斷
      var payLeft = pays.filter(function (p) { return (ids.indexOf(p.quoteId) >= 0 || (!p.quoteId && p.project === q.name)) && !p.voidAt && !p.planned && p.status !== 'paid' && (parseFloat(p.amount) || 0) > 0; }).length;   // 審查：預估應付（planned）跟前端一樣不算
      var matLeft = mats.filter(function (r) { return r.name && (r.projQid === q.id || (!r.projQid && q.name && r.loc === q.name)) && (parseFloat(r.qty) || 0) > 0 && r.kind !== '一次性'; }).length;
      var rq = retByQ[q.id] || { accr: 0, left: 0 };
      var c = closeReady({ q: q, hasRet: rq.accr > 0, retLeft: rq.left, invs: my.map(function (inv) { return { ar: arOf(inv) }; }), allDone: allDone, payLeft: payLeft, matLeft: matLeft });
      if (c && c.ok) out.close.push({ qid: q.id, name: q.name || '' });
    });
    // 每月請款、超支（5c）
    var U = invs.map(invUnpack);
    out.bill = []; out.overrun = [];
    quotes.forEach(function (q) {
      if (!q.awarded || q.parentId || q.closed) return;
      var mine = U.filter(function (i) { return i.kind !== 'retReturn' && (i.quoteId === q.id || i.sourceQid === q.id || (!i.quoteId && !i.sourceQid && i.project === q.name)); });
      var mb = monthBill({ q: q, invs: mine, cust: custOf({}, q), def: ctx.payDef, today: today }); if (mb) out.bill.push(mb);
      if (Array.isArray(q.costs) && q.costs.length) { var ov = overrun(q, U, 1.1); if (ov.length) out.overrun.push({ qid: q.id, name: q.name || '', n: ov.length, rows: ov }); }
    });
    return out;
  }
  var todo = { pairOf: pairOf, dAdd: dAdd, dDiff: dDiff, itemCat: itemCat, rentDaysOf: rentDaysOf, prPhase: prPhase, itemProgress: itemProgress, rentEndMode: rentEndMode, rentOldQty: rentOldQty,
    rentBatchList: rentBatchList, rentBatchQtyDays: rentBatchQtyDays, rentSegments: rentSegments, rentStatus: rentStatus, rentScan: rentScan, rentTodos: rentTodos, rentSoon: rentSoon,
    recvRule: recvRule, byRule: byRule, expectedDate: expectedDate, recvTodos: recvTodos, looseDate: looseDate,
    retMonths: retMonths, addMonths: addMonths, retDue: retDue, closeReady: closeReady,
    rfqKey: rfqKey, rfqGL: rfqGL, rfqBaseVer: rfqBaseVer, rfqQuoteDiff: rfqQuoteDiff, rfqVerTodos: rfqVerTodos, ticketTodos: ticketTodos, build: build,
    INV_K: INV_K, invUnpack: invUnpack, effQtyMap: effQtyMap, effQty: effQty, itemActual: itemActual, actQtyMap: actQtyMap, costByItem: costByItem, overrun: overrun, cutOf: cutOf, cycleOf: cycleOf, monthBill: monthBill };
  root.FJC = root.FJC || {}; root.FJC.todo = todo;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FJC;
})(typeof window !== 'undefined' ? window : globalThis);
