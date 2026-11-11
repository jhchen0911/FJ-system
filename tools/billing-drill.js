// 請款整條演練（合成資料，本機資料模式，不連雲端）：node tools/billing-drill.js <網站資料夾> <截圖資料夾>（CHROMIUM_PATH 指定瀏覽器）
// 日報卡 → 請款單草稿卡 → 存檔 → 待送業主卡 → 業主確認卡 → 發票 → 收款卡
const { chromium } = require('playwright'); const path = require('path');
const ROOT = process.argv[2], OUT = process.argv[3];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const pg = await b.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|ERR_|CORS/.test(m.text())) errs.push(m.text()); });
  await pg.goto('file://' + path.join(ROOT, 'index.html')); await pg.waitForTimeout(2500);
  const log = [];
  const shot = async (n, t) => { await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(OUT, n + '.png') }); log.push([n, t]); };
  const ev = (f, a) => pg.evaluate(f, a);
  await ev(() => {
    window.printInvById = () => {}; window.__cm = () => { ['fy-modal'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }); document.querySelectorAll('.modal-bg,.overlay').forEach((e) => { e.style.display = 'none'; }); const gc = document.getElementById('gen-confirm'); if (gc) gc.style.display = 'none'; }; P.removeRate = 30; window._draftMark = function (id, st) { if (DRAFTS[id]) DRAFTS[id].status = st; return Promise.resolve(true); };
    const td = localToday(), d = (n) => _dAdd(td, n), cut = parseInt(_dAdd(td, 3).slice(8), 10);
    Q = [{ id: 'qDrill', name: '（範例營造）範例路擋土支撐工程', client: '範例營造', awarded: true, ownerPay: { cut: cut }, t: { total: 0 },
      items: [{ desc: 'H型鋼樁 H300 L=12M 打設＋拔除', unit: '支', qty: 100, price: 1500 }, { desc: '第一層水平支撐 H300 組立及拆除', unit: 'M', qty: 200, price: 800 }],
      dailyLogs: [] }];
    INV = []; INVOICE_RECS = [];
    DRAFTS = { ddrill01: { id: 'ddrill01', type: 'dailyLog', by: 'line-bot', byName: 'LINE 機器人', at: Date.now(), status: 'pending', summary: '施工日報：範例路　' + d(-2),
      payload: { qid: 'qDrill', date: d(-2), answers: ['1. 今天打設 H300 型鋼樁 40 支\n2. 第一層支撐組立 120M\n3. 人 6、吊車 1'], photos: [] } } };
    _todoBuild(true); openDecList('dlQty'); document.querySelectorAll('#dec-box [onclick*="decToggle"]').forEach((e) => e.click());
  });
  await shot('1_日報卡', 'LINE 日報草稿卡：拆出 H300 打設 40 支、支撐組立 120M（組立及拆除判成打設，健檢 H2）');
  await ev(async () => { await _DEC.dlQty.ok(DRAFTS.ddrill01); window.__cm(); });
  await ev(() => { _todoBuild(true); window.__cm(); openDecList('invDraft'); document.querySelectorAll('#dec-box [onclick*="decToggle"]').forEach((e) => e.click()); });
  await shot('2_請款單草稿卡', '本月請款單草稿卡：每個工項寫「這期請幾 %、累計幾 %」（H300 打設＋拔除 → 打設那期 70%，健檢 H5）');
  await ev(async () => { const L = _decItems('invDraft'); await _DEC.invDraft.ok(L[0]); window.__cm(); });
  await pg.waitForTimeout(800);
  await shot('3_請款單編輯頁', '確認後開第 1 期請款單（狀態草稿），數量依日報帶入，請款 % 照合約');
  await ev(() => { saveInvoice(); });
  await ev(() => { openDecList('invSend'); document.querySelectorAll('#dec-box [onclick*="decToggle"]').forEach((e) => e.click()); });
  await shot('4_待送業主卡', '存檔後「請款單草稿待送出」卡：金額照真正存檔算出（健檢 H1：原本永遠 0）');
  const amt = await ev(() => _isAmt(INV[0]));
  await ev(async () => { await _DEC.invSend.ok(_decItems('invSend')[0]); await new Promise((r) => setTimeout(r, 300)); window.__cm(); window.__cm(); });
  await ev(() => { DRAFTS.dokdrill = { id: 'dokdrill', type: 'invOk', by: 'ai@example.com', at: Date.now(), status: 'pending', summary: '', payload: _invOkClean({ qid: 'qDrill', text: '第 1 期數量沒問題，請開發票', from: '工地主任' }) }; openDecList('invOk'); document.querySelectorAll('#dec-box [onclick*="decToggle"]').forEach((e) => e.click()); });
  await shot('5_業主確認卡', '業主回覆請款單卡（AI 讀回覆 → Lotion 確認才記「業主已確認」）');
  await ev(async () => { await _DEC.invOk.ok(_decItems('invOk')[0]); window.__cm(); });
  await ev(() => { const inv = INV[0], g = _invEinvGross(inv), s = _einvSplit(g); INVOICE_RECS.unshift({ id: 'irdrill', number: 'XX12345678', date: localToday(), buyer: '範例營造', net: s.net, tax: s.tax, amount: s.gross, linkedInvId: inv.id, status: 'issued' }); saveInvoiceRecs(); _invStSync(); renderInvList && renderInvList(); go('acct'); try { acctTab('ar'); } catch (e) {} });
  await shot('6_已開發票', '登錄發票（照抄範例金額）後，請款單狀態自動變「已開發票」');
  await ev(() => { const inv = INV[0], o = _rvClean({ qid: 'qDrill', kind: 'cash', amt: _isAmt(inv) - 30, date: localToday(), fee: 30 }); DRAFTS.rvdrill = { id: 'rvdrill', type: 'recvSlip', by: 'ai@example.com', at: Date.now(), status: 'pending', summary: '', payload: Object.assign(o, { invId: inv.id }) }; openDecList('recvIn'); document.querySelectorAll('#dec-box [onclick*="decToggle"]').forEach((e) => e.click()); });
  await shot('7_收款卡', '收款登錄卡：匯款金額＋匯費＝應收，確認＝打開收款視窗帶好數字');
  await ev(() => { _DEC.recvIn.ok(_decItems('recvIn')[0]); });
  await shot('8_收款視窗', '收款視窗（Lotion 按確認才入帳）');
  await ev(() => { confirmReceipt(); });
  const fin = await ev(() => ({ st: _invStOf(INV[0]), log: (INV[0].stLog || []).map((x) => x.st + '｜' + x.why), rate: INV[0].items[0].payRate, cum: _invItemCumPct(INV[0].items[0]), amt: _isAmt(INV[0]), ph: (Q[0].dailyLogs[0].progressRows || []).map((r) => [r.itemIdx, r.qty, r.ph]) }));
  await ev(() => { loadInvoice(INV[0].id); go('invoice-edit'); });
  await shot('9_完成', '整條跑完：狀態「已收款」，狀態紀錄每一步都有');
  console.log(JSON.stringify({ amt, fin, errs, log }, null, 1));
  await b.close();
})();
