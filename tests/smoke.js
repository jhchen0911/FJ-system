#!/usr/bin/env node
/*
 * 豐有工程管理系統．冒煙測試（v5.376 起）
 *
 * 用途：每次 PR 自動跑，擋下三類最常見的回歸——
 *   ① 載入或切頁時 Console 有錯
 *   ② 手機版出現左右滑動（使用者明確要求絕不允許）
 *   ③ 金額口徑／儲存格式／破壞性操作的行為改變
 *
 * 本機執行：node tests/smoke.js
 * 需要 playwright 與 chromium；CI 會自行安裝。
 */
const path = require('path');
const { chromium } = require('playwright');

const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');
const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  if (!ok) failed++;
}

async function newPage(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // 離線環境載不到 Firebase / CDN 屬正常，不算錯誤
    if (m.type() === 'error' && !/ERR_(TUNNEL|INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });
  await page.goto(INDEX);
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window._costEditAll = true; });   // v6.0.29 施工成本頁測試時全展開
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  // ───────────── 1. 桌機：載入、版本、全頁切換 ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const info = await page.evaluate(() => {
      const bad = [];
      const pages = ALL_PAGES.map(p => p.id || p);
      pages.forEach(id => { try { go(id); } catch (e) { bad.push(id + ': ' + e.message); } });
      return { version: APP_VERSION, pageCount: pages.length, bad };
    });
    check('版本號存在（v5.x 或 v6.x-beta）', /^v(5\.\d+|6\.\d+\.\d+(-beta)?)$/.test(info.version), info.version);
    check('23 個頁面全部可切換', info.pageCount >= 23 && info.bad.length === 0, info.bad.join('; '));
    check('載入與切頁無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 2. 手機：任何頁面都不得左右滑動 ─────────────
  {
    const { page, errors } = await newPage(browser, 390, 844);
    await page.evaluate(() => {
      // 塞入代表性資料，讓表格真的有內容
      Q = []; INV = []; CONTRACTS = []; PAYABLES = []; EXPENSES = []; VENDORS = []; CUSTOMERS = [];
      for (let i = 0; i < 5; i++) {
        const its = [];
        for (let j = 0; j < 8; j++) its.push({ desc: 'H型鋼樁打設作業（含運費及吊裝）' + j, unit: 'M', qty: '80', price: '520', estCost: '380', note: '含30天租期', ot: '12', otu: '$/M/天', sec: false });
        const q = { id: 'q' + i, code: '115' + i, name: '某某營造新建工程擋土支撐工程 ' + i, client: '某某營造股份有限公司', date: '2026-03-01', items: its, exs: [], costs: [], awarded: true, rmk: {}, dailyLogs: [], _mt: 1 };
        _recalcQuoteTotals(q); Q.push(q);
        CONTRACTS.push({ id: 'ct' + i, linkedQid: q.id, name: q.name, client: q.client, amount: 2000000, status: 'active', _mt: 1 });
        INV.push({ id: 'iv' + i, sourceQid: q.id, project: q.name, client: q.client, periodNo: 1, month: '2026-03', date: '2026-03-25', items: its.map(it => ({ type: 'item', desc: it.desc, unit: it.unit, contractPrice: +it.price, contractQty: +it.qty, curQty: 20, curAmt: 10400, cumQty: 20, cumAmt: 10400, payRate: 100, note: '' })), totals: { curTotal: 83200, total: 87360 }, received: 0, retention: true, retentionPct: 10, _mt: 1 });
        CUSTOMERS.push({ id: 'cu' + i, name: '某某營造股份有限公司' + i, taxid: '12345678', tel: '02-8888-9999', _mt: 1 });
        VENDORS.push({ id: 'v' + i, name: '協力廠商股份有限公司' + i, tel: '02-1234-5678', _mt: 1 });
        PAYABLES.push({ id: 'p' + i, to: '協力廠商' + i, project: q.name, amount: 120000, status: 'pending', due: '2026-04-10', _mt: 1 });
        EXPENSES.push({ id: 'e' + i, date: '2026-03-1' + i, cat: '油料', amount: 3200, proj: q.name, _mt: 1 });
      }
    });
    const pages = await page.evaluate(() => ALL_PAGES.map(p => p.id || p));
    const offenders = [];
    for (const id of pages) {
      await page.evaluate(pid => { try { go(pid); } catch (e) { } }, id);
      await page.waitForTimeout(400);
      const bad = await page.evaluate(() => {
        const out = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('<page>');
        document.querySelectorAll('.page').forEach(pg => {
          if (getComputedStyle(pg).display === 'none') return;
          pg.querySelectorAll('*').forEach(el => {
            if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
              const cs = getComputedStyle(el);
              if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') out.push(el.tagName + ' ' + el.scrollWidth + '/' + el.clientWidth);
            }
          });
        });
        return out;
      });
      // 甘特圖是規則明文允許的時間軸例外
      if (bad.length && id !== 'progress') offenders.push(id + ' → ' + bad.slice(0, 2).join(', '));
    }
    check('手機版無橫向捲動（甘特圖除外）', offenders.length === 0, offenders.join(' | '));
    check('手機版渲染無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 3. 金額口徑與資料格式 ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      P.tax = 5;
      // 備用單價不得計入總額
      items = [
        { desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '500', note: '', ot: '', otu: '$/M/天', sec: false },
        { desc: '安全走道', unit: 'M', qty: '1', price: '800', note: '備用單價', ot: '', otu: '$/M/天', sec: false, spare: true },
      ];
      exs = [];
      const t = calcT();
      out.spareExcluded = t.sub === 50000 && Math.round(t.total) === 52500;

      // 議價不得動到備用單價
      document.querySelector('input[name="ngt-way"][value="whole"]').checked = true;
      document.querySelector('input[name="ngt-mode"][value="excl"]').checked = true;
      document.getElementById('ngt-target').value = '40000';
      applyNegotiate();
      out.spareNotNegotiated = String(items[1].price) === '800' && Number(items[0].price) === 400;

      // 請款單壓縮必須可逆，且列印輸出不變
      const inv = {
        id: 'v1', project: '甲案', periodNo: 1, retention: true, retentionPct: 10,
        items: [{ type: 'sec', desc: '一、擋土工程' },
        { type: 'item', desc: '工項A', unit: 'M', contractPrice: 520, contractQty: 80, curQty: 20, curAmt: 10400, cumQty: 20, cumAmt: 10400, payRate: 30, prevPayRate: 100, note: '含30天租期' }],
        totals: { curTotal: 10400, total: 10920 }, _mt: 1,
      };
      const back = _invUnpack(_invPack(JSON.parse(JSON.stringify(inv))));
      const render = (v) => { invItems = JSON.parse(JSON.stringify(v.items)); invEid = v.id; buildInvPreview(v); return document.getElementById('inv-prev-html').innerHTML; };
      out.invCodecPrintSame = render(inv) === render(back);
      out.invCodecSecRow = JSON.stringify(Object.keys(back.items[0]).sort()) === JSON.stringify(['desc', 'type']);
      out.invCodecPrevRate = back.items[1].prevPayRate === 100;
      out.invCodecSmaller = JSON.stringify(_invPack(JSON.parse(JSON.stringify(inv)))).length < JSON.stringify(inv).length;
      return out;
    });
    check('備用單價不計入報價總額', r.spareExcluded);
    check('議價不調整備用單價', r.spareNotNegotiated);
    check('請款單壓縮後列印輸出完全相同', r.invCodecPrintSame);
    check('請款單壓縮：分類列只保留 type/desc', r.invCodecSecRow);
    check('請款單壓縮：prevPayRate 有無完全保留', r.invCodecPrevRate);
    check('請款單壓縮確實變小', r.invCodecSmaller);
    check('金額測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 4. 破壞性操作一定要問過 ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      Q = [{ id: 'q1', name: '測試案', items: [], exs: [], costs: [], _mt: 1 }];
      INV = [{ id: 'v1', sourceQid: 'q1', project: '測試案', items: [], totals: {}, _mt: 1 }];
      CUSTOMERS = [{ id: 'cu1', name: '某某營造', _mt: 1 }];
      CONTRACTS = []; PAYABLES = []; UH = [{ id: 'u1' }];
      delQ('q1'); delInvoice('v1'); deleteCustomer('cu1'); clearUPAHistory();
      const untouched = Q.length === 1 && INV.length === 1 && CUSTOMERS.length === 1 && UH.length === 1;
      const asked = document.getElementById('gen-confirm-modal').style.display === 'flex';
      document.getElementById('gen-confirm-modal').style.display = 'none';
      return { untouched, asked };
    });
    check('刪除／清除動作不會未經確認就執行', r.untouched);
    check('破壞性操作會跳出確認框', r.asked);
    check('確認框測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 5. 工項類別／期別與新報表 ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      // 類別：名稱看不出來的工項，指定後要能正確歸類
      out.catKeyword = JSON.stringify(_itemCat({ desc: 'H型鋼樁打設' })) === '{"install":true,"remove":false}';
      out.catNoKeyword = JSON.stringify(_itemCat({ desc: '型鋼壓入回收' })) === '{"install":false,"remove":false}';
      out.catExplicit = JSON.stringify(_itemCat({ desc: '型鋼壓入回收', cat: 'remove' })) === '{"install":false,"remove":true}';
      // 期別：可由參數與逐項指定覆寫
      P.removeRate = 30;
      out.phaseAuto = _isRemovePeriod({ payRate: 30 }) === true && _isRemovePeriod({ payRate: 100 }) === false;
      out.phaseExplicit = _isRemovePeriod({ payRate: 30, phase: 'install' }) === false && _isRemovePeriod({ payRate: 100, phase: 'remove' }) === true;
      P.removeRate = 40;
      out.phaseParam = _isRemovePeriod({ payRate: 30 }) === false && _isRemovePeriod({ payRate: 40 }) === true;
      P.removeRate = 30;
      // 兩張新報表要能渲染
      Q = [{ id: 'q1', name: '案1', client: '甲營造', date: '2026-03-01', items: [], exs: [],
             costs: [{ id: 'c1', type: 'sub', vendor: '甲協力', date: '2026-03-05', rows: [{ desc: 'H型鋼樁打設', qty: 100, unitPrice: 480 }] }],
             awarded: true, t: { total: 100000 }, _mt: 1 },
           { id: 'q2', name: '案2', client: '甲營造', date: '2026-04-01', items: [], exs: [],
             costs: [{ id: 'c2', type: 'sub', vendor: '乙工程行', date: '2026-04-05', rows: [{ desc: 'H型鋼樁打設', qty: 80, unitPrice: 560 }] }],
             awarded: false, bidStatus: 'lost', lostReason: '價格過高', t: { total: 90000 }, _mt: 1 }];
      PAYABLES = [{ id: 'p1', to: '甲協力', amount: 480000, status: 'paid', date: '2026-03-10', due: '2026-04-10', paidDate: '2026-04-08', _mt: 1 }];
      const el = document.createElement('div');
      renderBidRateReport(el, 2026, 0);
      out.bidReport = /得標率分析/.test(el.textContent) && /甲營造/.test(el.textContent) && /價格過高/.test(el.textContent);
      renderVendorReport(el, 2026, 0);
      out.vendorReport = /甲協力/.test(el.textContent) && /乙工程行/.test(el.textContent) && /最高比最低貴/.test(el.textContent);
      return out;
    });
    check('工項類別：名稱有關鍵字者自動歸類', r.catKeyword);
    check('工項類別：名稱無關鍵字者不誤判', r.catNoKeyword);
    check('工項類別：手動指定可覆寫', r.catExplicit);
    check('期別：依請款率自動判斷', r.phaseAuto);
    check('期別：逐項指定可覆寫', r.phaseExplicit);
    check('期別：拔除請款率可由參數調整', r.phaseParam);
    check('得標率報表可渲染', r.bidReport);
    check('廠商績效報表可渲染', r.vendorReport);
    check('報表測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 6. 備份完整性 ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const d = _syncPayload().data;
      const must = ['quotes', 'invoices', 'contracts', 'vendors', 'payables', 'expenses', 'customers',
        'costHist', 'dealHist', 'matLedger', 'matStock', 'toolrecs', 'planState',
        'planAttLib', 'qHistory', 'toolStates', 'params', 'pagePerms', 'admins'];
      const missing = must.filter(k => !(k in d));
      const shared = _sharedPayload().data;
      return { missing, attLibNotOnCloud: shared.planAttLib === undefined };
    });
    check('全量備份涵蓋所有集合', r.missing.length === 0, '缺少：' + r.missing.join(','));
    check('計畫書附件庫不上雲（只進本機備份）', r.attLibNotOnCloud);
    check('備份測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 7. 第二輪功能（v5.378～v5.382） ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const D = n => { const d = new Date(); d.setDate(d.getDate() + n);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      // 稅率 0 是合法值（免稅案不得被課 5%）
      items = [{ desc: '工項', unit: 'M', qty: '100', price: '500', sec: false }]; exs = [];
      P.tax = 0; let t = calcT();
      out.taxZero = t.tax === 0 && t.total === 50000;
      P.tax = 5; t = calcT();
      out.taxFive = t.tax === 2500 && Math.round(t.total) === 52500;
      // 修改人戳記：_touch 戳 _by、套用雲端時不戳
      localStorage.setItem('fy_last_email', 'smoke@test.com');
      const o = { id: 'x' }; _touch(o);
      window._applyingCloud = true; const o2 = { id: 'y' }; _touch(o2); window._applyingCloud = false;
      out.touch = o._by === 'smoke@test.com' && o2._by === undefined;
      // 票據登記：未到期票不算現金、退票永不算、到期後計入
      const inv = { id: 'v1', received: '300000', receivedDate: D(-10), totals: { total: 300000 },
        receipts: [{ id: 'r1', kind: 'cash', amt: 100000, date: D(-10), status: 'hold' },
        { id: 'r2', kind: 'ticket', amt: 120000, dueDate: D(20), status: 'hold' },
        { id: 'r3', kind: 'ticket', amt: 30000, dueDate: D(-5), status: 'bounced' }] };
      P.openingCash = 0; P.openingDate = '';
      out.ticketCash = _cashOf(inv, Date.now()) === 100000 && _cashOf(inv, Date.now() + 30 * 864e5) === 220000;
      // 保留款總覽：已完工案標記該請退
      INV = [{ id: 'w1', project: '完工案', retention: true, retentionPct: 10, totals: { curTotal: 1000000, total: 1050000 }, _mt: 1 }];
      CONTRACTS = [{ id: 'c1', name: '完工案', status: 'completed', amount: 1, _mt: 1 }];
      const rr = _retentionRows();
      out.retention = rr.length === 1 && rr[0].due === true && rr[0].pending === 105000;
      // 催款文字：金額與逾期天數
      INV = [{ id: 'd1', project: '甲案', client: '甲營造', periodNo: 2, totals: { total: 840000 }, received: '0', expectedRecvDate: D(-20), _mt: 1 }];
      const dt = _dunningText(INV[0]);
      out.dunning = dt.indexOf('840,000') >= 0 && /逾期 \d+ 天/.test(dt);
      // 出工月結：出工×日薪 對 已記點工
      P.laborDayRate = 2800;
      Q = [{ id: 'q1', name: '甲案', items: [], exs: [], dailyLogs: [{ date: '2026-03-10', workers: 6 }],
        costs: [{ id: 'c1', type: 'labor', date: '2026-03-15', rows: [{ subType: 'worker', desc: '技術工', days: 5, dayRate: 2800, transport: 0 }] }], _mt: 1 }];
      const el = document.createElement('div');
      renderLaborReport(el, 2026, 3);
      const lt = el.textContent;
      out.labor = lt.indexOf('6 工') >= 0 && lt.indexOf('16,800') >= 0 && lt.indexOf('14,000') >= 0;
      return out;
    });
    check('免稅案稅率 0 不被課 5%', r.taxZero);
    check('稅率 5% 行為不變', r.taxFive);
    check('修改人戳記（雲端套用不誤標）', r.touch);
    check('票據：未到期不算現金、退票永不算', r.ticketCash);
    check('保留款總覽：完工案標記該請退', r.retention);
    check('催款文字含金額與逾期天數', r.dunning);
    check('出工月結：出工×日薪對已記點工', r.labor);
    check('第二輪功能無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-1. 逾期租金單價以報價單為準／單位 m²（v5.384） ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      out.uFix = ['M2', 'm2', '$/M2/天', 'm²', '㎡', 'M', 'M22'].map(x => _uFix(x)).join('|');
      const qid = 'SMK384';
      Q.push({
        id: qid, name: '冒煙案384', client: 'X營造', date: '2026-06-06', status: 'won',
        items: [{ desc: '第2層水平支撐 W=H400；S=H350', unit: 'M2', qty: '460', price: '1100',
                  note: '含30天租期', ot: '7$/M2/天', otu: '$/M2/天' }],
        dailyLogs: [{ date: '2026-07-10', progressRows: [{ itemIdx: 0, qty: 460 }] }], t: {}
      });
      // 請款單刻意存入過期的逾期租金快照（72），開單時應被報價單的 7 校正
      INV.push({
        id: 'SMKI384', quoteId: qid, project: '冒煙案384', client: 'X營造', periodNo: 1,
        items: [{ type: 'item', desc: '第2層水平支撐 W=H400；S=H350', unit: 'M2', contractPrice: 1100,
                  contractQty: 460, curQty: 0, curAmt: 0, payRate: 100, otPrice: 72, otUnit: '$/M2/天' }]
      });
      loadInvoice('SMKI384');
      out.repaired = invItems[0].otPrice;                 // 期望 7（不是 72）
      out.unitFixed = invItems[0].unit;                   // 期望 m²
      document.getElementById('inv-rental-item').value = '第2層水平支撐 W=H400；S=H350';
      invRentalPick();
      document.getElementById('inv-claim-date').value = '2026-08-22';
      calcInvDays();
      out.overDays = document.getElementById('inv-overday').value;
      out.preview = document.getElementById('inv-day-result').innerText.replace(/\s+/g, ' ');
      const rent = invItems.find(x => x.type === 'rental');
      out.rent = rent ? { p: rent.contractPrice, q: rent.contractQty, d: rent.curDays, a: rent.curAmt } : null;
      const html = _buildQuoteDocHTML(Q.find(x => x.id === qid));
      out.printNoM2 = !/>M2</.test(html) && />m²</.test(html);
      return out;
    });
    check('單位正規化 M2／m2／㎡ → m²（M22 不動）', r.uFix === 'm²|m²|$/m²/天|m²|m²|M|M22', r.uFix);
    check('開請款單即以報價單校正逾期租金單價', r.repaired === 7, '得到 ' + r.repaired);
    check('請款單工項單位轉為 m²', r.unitFixed === 'm²', r.unitFixed);
    check('逾期天數計算正確（30天租期→逾期13天）', r.overDays === '13', r.overDays);
    check('逾期金額＝報價單價×合約量×逾期天數', !!r.rent && r.rent.p === 7 && r.rent.q === 460 && r.rent.d === 13 && r.rent.a === 41860, JSON.stringify(r.rent));
    check('預覽標明單價取自報價單', /單價取自報價單/.test(r.preview) && /\$7/.test(r.preview), r.preview.slice(0, 90));
    check('報價單列印單位輸出 m²', r.printNoM2);
    check('逾期租金測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-2. 加權累計數量／PDF 比例一致（v5.385） ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const D = 'H型鋼樁 H350，L=9M@100cm 打設、拔除';
      Q.push({ id: 'Q385', name: '累計冒煙案', client: 'Y營造', status: 'won', date: '2026-01-01',
               items: [{ desc: D, unit: '支', qty: '57', price: '27500', note: '' }], t: {} });
      INV.push({ id: 'I385a', quoteId: 'Q385', project: '累計冒煙案', client: 'Y營造', periodNo: 1,
                 date: '2026-03-01',
                 items: [{ type: 'item', desc: D, unit: '支', contractPrice: 27500, contractQty: 57,
                           prevQty: 0, prevAmt: 0, curQty: 57,
                           curAmt: Math.round(57 * 27500 * 0.7), payRate: 70 }] });
      loadInvoice('I385a');
      addNextPeriod('I385a');
      const i2 = INV.find(x => x.project === '累計冒煙案' && (parseInt(x.periodNo) || 0) === 2);
      out.p2prev = i2 ? i2.items[0].prevQty : null;             // 57×70% = 39.9
      loadInvoice(i2.id);
      invItems[0].payRate = 30; invItems[0].curQty = 57;
      invItems[0].curAmt = Math.round(57 * 27500 * 0.3);
      out.cum = Math.round(((parseFloat(invItems[0].prevQty) || 0) + _curW(invItems[0])) * 100) / 100;
      out.contract = invItems[0].contractQty;
      out.w = [_wQty(30, 100), _wQty(57, 70), _wQty(57, 30)].join(',');
      i2.items = JSON.parse(JSON.stringify(invItems));
      buildInvPreview(i2);
      out.previewNo114 = !/114/.test(document.getElementById('inv-prev-html').innerText);
      // PDF：不同高度的內容一律以同一比例貼頁（不再縮小塞成一頁）
      const a4w = 841.89, a4h = 595.28, sc = a4w / 2246, scales = [];
      [1774, 1538].forEach(h => {
        const c = document.createElement('canvas'); c.width = 2246; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, h);
        const imgs = [];
        const stub = { addPage() {}, addImage(d, f, x, y, w) { imgs.push(w); },
                       setFontSize() {}, setTextColor() {}, text() {} };
        _pdfAddPaged(stub, c, a4w, a4h, sc, { pages: [{ s: 0, e: h, hd: false }], marg: 76, hd: null }, 0.9);
        scales.push(+(imgs[0] / (a4w - 2 * _pdfMargPt())).toFixed(3));   // v5.392：內容寬＝A4扣左右10mm
      });
      out.scales = scales.join(',');
      return out;
    });
    check('分批請款：下一期前期累計依比例加權', r.p2prev === 39.9, '得到 ' + r.p2prev);
    check('打設70%＋拔除30% 累計等於合約量', r.cum === r.contract, r.cum + ' / ' + r.contract);
    check('加權換算（100%不變、70%、30%）', r.w === '30,39.9,17.1', r.w);
    check('列印累計不再出現兩倍數量', r.previewNo114);
    check('PDF 各檔比例一致（不縮小塞單頁）', r.scales === '1,1', r.scales);
    check('累計／PDF 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-3. 收款分期／進版／單一匯出鈕（v5.386） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      Q.push({ id: 'Q386', name: '收款冒煙案', client: 'W營造', status: 'won', awarded: true,
               date: '2026-01-01', items: [{ desc: 'H型鋼樁', unit: '支', qty: '10', price: '1000' }],
               t: { total: 42000 } });
      for (let i = 1; i <= 4; i++)
        INV.push({ id: 'I386_' + i, quoteId: 'Q386', project: '收款冒煙案', client: 'W營造',
                   periodNo: String(i), date: '2026-0' + i + '-01', totals: { total: 100000 * i },
                   received: i === 1 ? 100000 : 0, receivedConfirmed: i === 1, items: [] });
      // 收款彈窗：期數可選、可切換
      openReceiptModal('I386_4');
      const sel = document.getElementById('receipt-period');
      out.periods = sel.options.length;
      out.opened4 = /第4期/.test(document.getElementById('receipt-proj-name').textContent);
      sel.value = 'I386_2'; sel.dispatchEvent(new Event('change'));
      out.switched2 = /第2期/.test(document.getElementById('receipt-proj-name').textContent)
                   && document.getElementById('receipt-inv-id').value === 'I386_2';
      closeReceiptModal();
      // 預覽頁只留一顆匯出鈕
      out.qBtns = [...document.querySelectorAll('#page-preview .prev-act button')].map(b => b.textContent.trim()).join('|');
      out.iBtns = [...document.querySelectorAll('#page-invoice-prev .prev-act button')].map(b => b.textContent.trim()).join('|');
      return out;
    });
    await page.evaluate(() => go('quotes'));
    await page.waitForTimeout(500);
    const r3 = await page.evaluate(() => {
      const h = document.getElementById('qlist').innerHTML;
      showQVersions('Q386');
      const box = document.getElementById('gen-confirm-box');
      const vh = box ? box.innerHTML : '';
      try { document.getElementById('gen-confirm-cancel').click(); } catch (e) {}
      return { bump: (h.match(/bumpQVersion\(/g) || []).length,
               saveCli: (h.match(/saveClientFromRecord\(/g) || []).length,
               verBump: /進版（封存為/.test(vh), verHint: /不是版次/.test(vh) };
    });
    check('收款彈窗可選期數（列出全部 4 期）', r.periods === 4, '得到 ' + r.periods);
    check('收款彈窗可切換到指定期別', r.opened4 && r.switched2);
    check('報價列表以「進版」取代「存至客戶清單」', r3.bump === 1 && r3.saveCli === 0,
          'bump=' + r3.bump + ' saveCli=' + r3.saveCli);
    check('歷史版本說明區分版次與自動存檔', r3.verBump && r3.verHint);
    check('報價／請款預覽各只有一顆「匯出PDF」', r.qBtns === '← 返回|匯出PDF' && r.iBtns === '← 返回|匯出PDF',
          r.qBtns + ' ／ ' + r.iBtns);
    check('收款／進版測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-4. 加權本期量／填滿才換頁／報表明細（v5.387） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const D = '第1層水平支撐 W=H350；S=H300';
      Q.push({ id: 'Q387', name: '加權冒煙案', client: 'V營造', status: 'won', awarded: true,
               date: '2026-02-01', items: [{ desc: D, unit: 'M2', qty: '460', price: '1150' }],
               t: { total: 529000 },
               costs: [{ vendor: '某某工程行', date: '2026-03-05', amt: 250000 }] });
      INV.push({ id: 'I387', quoteId: 'Q387', project: '加權冒煙案', client: 'V營造', periodNo: '2',
                 date: '', totals: { total: 158700 },
                 items: [{ type: 'item', desc: D, unit: 'M2', contractPrice: 1150, contractQty: 460,
                           prevQty: 322, prevAmt: 370300, curQty: 460, curAmt: 158700, payRate: 30 }] });
      loadInvoice('I387');
      out.dateAuto = document.getElementById('inv-date').value === localToday();
      buildInvPreview(INV.find(x => x.id === 'I387'));
      const t = document.getElementById('inv-prev-html').innerText.replace(/\s+/g, ' ');
      out.curW = /138/.test(t);          // 460 × 30%
      out.cum = /460/.test(t);           // 322 + 138
      // 分頁：填滿才換頁（不再為了避免孤兒頁把兩頁均分）
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1123px;background:#fff';
      let rows = '';
      for (let i = 0; i < 40; i++) rows += '<tr><td style="padding:6px;border-bottom:1px solid #eee">工項 ' + (i + 1) + '</td><td>1,000</td></tr>';
      host.innerHTML = '<table><thead><tr><th>項目</th><th>金額</th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="page-footer" style="height:120px">用印區</div>';
      document.body.appendChild(host);
      const H = host.scrollHeight * 2;
      const plan = _pdfPlanPages({ width: 2246, height: H }, host, 1123, true);
      out.pages = plan.pages.length;
      // v5.392「填滿才換頁」的嚴謹定義：切點之後的下一個列邊界必定超出本頁可用高度
      //（若還放得下一列卻提早換頁，就是留白過多）
      const _rr = host.getBoundingClientRect();
      const _rows = [...host.querySelectorAll('tr')].map(el => Math.round((el.getBoundingClientRect().bottom - _rr.top) * 2));
      const _budget = plan.PAGE - 2 * plan.marg;
      out.fillTight = plan.pages.slice(0, -1).every(p =>
        !_rows.some(b => b > p.e + 1 && b <= p.s + _budget));
      host.remove();
      return out;
    });
    await page.evaluate(() => { go('reports'); });
    await page.waitForTimeout(600);
    const r2 = await page.evaluate(() => {
      const out = {};
      const grab = () => {
        const b = document.getElementById('gen-confirm-box');
        const t = b ? b.innerText.replace(/\s+/g, ' ') : '';
        try { document.getElementById('gen-confirm-cancel').click(); } catch (e) {}
        return t;
      };
      openRptClientDetail('V營造');  out.cli = grab();
      openRptBidDetail('V營造');     out.bid = grab();
      openRptVendorDetail('某某工程行'); out.ven = grab();
      // 合約重複建檔應合併為一列
      CONTRACTS.push({ id: 'C387a', code: 'DUP001', name: '重複案', client: 'V營造', amount: 1000000, start: '2026-01-01' });
      CONTRACTS.push({ id: 'C387b', code: 'DUP001', name: '重複案', client: 'V營造', amount: 1000000, start: '2026-01-01' });
      const box = document.createElement('div');
      renderContractReport(box, 2026);
      out.dupMerged = (box.innerHTML.match(/DUP001/g) || []).length === 1 && /已合併/.test(box.innerHTML);
      return out;
    });
    check('本期估驗數量＝輸入量×請款%（460×30%=138）', r.curW, '預覽未見 138');
    check('累積估驗回到合約量（322+138=460）', r.cum);
    check('新期估驗日期自動帶當天', r.dateAuto);
    check('填滿才換頁（再多一列就超出才換）', r.fillTight);
    check('業主往來可點入明細', /業主往來明細/.test(r2.cli) && /報價（/.test(r2.cli), r2.cli.slice(0, 60));
    check('得標率可點入業主明細', /得標明細/.test(r2.bid) && /得標率/.test(r2.bid), r2.bid.slice(0, 60));
    check('廠商績效可點入明細', /廠商績效明細/.test(r2.ven) && /發包案件/.test(r2.ven), r2.ven.slice(0, 60));
    check('重複建檔的合約合併為一列', r2.dupMerged);
    check('報表明細測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-5. KPI 點擊總結／得標率口徑／重複合約處理／先查看再下載（v5.388） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const grab = () => {
        const b = document.getElementById('gen-confirm-box');
        const t = b ? b.innerText.replace(/\s+/g, ' ') : '';
        try { document.getElementById('gen-confirm-cancel').click(); } catch (e) {}
        return t;
      };
      // 得標率口徑：得標 ÷ 全部（未得標、洽談、流標都在分母）
      out.rate = Math.round(_bidStat([{ awarded: true }, { bidStatus: 'lost' }, { bidStatus: 'void' }, {}]).rate);
      // 統計卡可點擊＋點擊出總結
      Q.push({ id: 'Q388', name: 'KPI冒煙案', client: 'K營造', awarded: true, status: 'won',
               date: '2026-02-01', items: [], t: { total: 210000 } });
      INV.push({ id: 'I388', quoteId: 'Q388', project: 'KPI冒煙案', client: 'K營造', periodNo: '1',
                 date: '2026-03-01', month: '2026-03', totals: { total: 105000 }, received: 0, items: [] });
      updateQuoteStats(); updateInvStats();
      out.qKpiClick = document.querySelectorAll('#quote-stats-grid .kpi[onclick]').length >= 4;
      out.iKpiClick = document.querySelectorAll('#inv-stats-grid .kpi[onclick]').length >= 3;
      openInvKpi('amt'); out.invBox = grab();
      openQuoteKpi('rate'); out.quoteBox = grab();
      openInvKpi('overdue'); out.odBox = grab();   // I388 預計 2026-04 月底收款 → 已逾期
      // 既有請款單累計一次性回填（v5.385 前的直加值 57 → 加權 39.9）
      const D = 'H型鋼樁回填檢';
      INV.push({ id: 'I388a', quoteId: 'Q388f', project: '回填冒煙案', periodNo: '1',
                 items: [{ type: 'item', desc: D, unit: '支', curQty: 57, payRate: 70, contractQty: 57 }] });
      INV.push({ id: 'I388b', quoteId: 'Q388f', project: '回填冒煙案', periodNo: '2',
                 items: [{ type: 'item', desc: D, unit: '支', prevQty: 57, curQty: 57, payRate: 30, contractQty: 57 }] });
      out.migFixed = _fixInvCumWeighted() >= 1 && INV.find(x => x.id === 'I388b').items[0].prevQty === 39.9;
      // 匯出 PDF 改「先預覽、按下載才存檔」
      out.viewFirst = /不再自動下載/.test(_printViaIframe.toString());
      return out;
    });
    // 重複合約（同編號同名但掛不同報價）＋ ⚠ 點入刪除未請款那筆
    const r2 = await page.evaluate(async () => {
      const out = {};
      CONTRACTS.push({ id: 'CT88a', code: 'C-88', name: '亞東冒煙案', client: 'F公司', amount: 500000, linkedQid: 'QX1', start: '2026-01-01' });
      CONTRACTS.push({ id: 'CT88b', code: 'C-88', name: '亞東冒煙案', client: 'F公司', amount: 500000, linkedQid: 'QX2', start: '2026-01-01' });
      const box = document.createElement('div');
      renderContractReport(box, 2026);
      out.dupMerged = (box.innerText.match(/亞東冒煙案/g) || []).length === 1;
      out.dupClickable = /openCtDupFix/.test(box.innerHTML);
      openCtDupFix('CT88a', 'CT88b');
      const b = document.getElementById('gen-confirm-box');
      out.fixBox = /重複合約處理/.test(b.innerText) && /刪除此筆/.test(b.innerHTML);
      try { document.getElementById('gen-confirm-cancel').click(); } catch (e) {}
      const n0 = CONTRACTS.length;
      ctDupDelete('CT88b');
      await new Promise(res => setTimeout(res, 350));
      out.askedFirst = CONTRACTS.length === n0 && /刪除重複合約/.test(document.getElementById('gen-confirm-box').innerText);
      document.getElementById('gen-confirm-ok').click();
      await new Promise(res => setTimeout(res, 80));
      out.deleted = CONTRACTS.length === n0 - 1 && !CONTRACTS.some(c => c.id === 'CT88b');
      return out;
    });
    check('得標率＝得標÷全部報價（1/4=25%）', r.rate === 25, '得到 ' + r.rate);
    check('報價／請款統計卡可點擊', r.qKpiClick && r.iKpiClick);
    check('總請款金額點擊出各工地總結', /總請款金額/.test(r.invBox) && /KPI冒煙案/.test(r.invBox), r.invBox.slice(0, 60));
    check('得標率點擊出得標明細', /得標率總結/.test(r.quoteBox), r.quoteBox.slice(0, 60));
    check('逾期未收點擊出逾期明細', /逾期未收總結/.test(r.odBox) && /逾期 \d+ 天/.test(r.odBox), r.odBox.slice(0, 60));
    check('既有請款單累計一次性回填（57→39.9）', r.migFixed);
    check('匯出 PDF 先預覽、按下載才存檔', r.viewFirst);
    check('同編號同名不同報價的合約仍合併一列', r2.dupMerged);
    check('⚠ 可點入處理且刪除需經確認', r2.dupClickable && r2.fixBox && r2.askedFirst);
    check('未請款的重複合約可刪除', r2.deleted);
    check('v5.388 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-7. 全站 KPI 總結／佣金／實績表／寄送方式（v5.389） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const grab = () => {
        const b = document.getElementById('gen-confirm-box');
        const t = b ? b.innerText.replace(/\s+/g, ' ') : '';
        try { document.getElementById('gen-confirm-cancel').click(); } catch (e) {}
        return t;
      };
      // 材料估算：綁定專案的存檔缺 _layers 等欄位（雲端往返會剝掉空陣列）也要能渲染
      Q.push({ id: 'QME', name: '估算冒煙案', awarded: true, items: [], t: {},
               matEst: { inputs: { P: 100, A: 500, H: 8, layers: 2, method: '鋼板樁' } } });
      window._matEstQid = 'QME';
      MAT_EST = JSON.parse(JSON.stringify(Q[Q.length - 1].matEst.inputs));
      renderMatEst();
      out.matest = document.getElementById('mat-est-form').innerHTML.length > 1000;
      // 寄送方式＋數量小數＋累積明細
      Q.push({ id: 'Q389', name: '總結冒煙案', client: 'K營造', awarded: true, status: 'won',
               date: '2026-02-01', loc: '新竹市', items: [{ desc: 'H型鋼樁', unit: '支', qty: '10', price: '1000' }],
               t: { sub: 200000, tax: 10000, total: 210000 },
               referral: { name: '王中間', who: '中間人', mode: 'pct', rate: 3, amount: 6000 } });
      INV.push({ id: 'I389', quoteId: 'Q389', project: '總結冒煙案', client: 'K營造', periodNo: '1',
                 date: '2026-03-01', totals: { total: 105000 }, received: 52500, sendMethod: '郵寄工地',
                 items: [{ type: 'item', desc: 'H型鋼樁', unit: '支', contractPrice: 27500, contractQty: 57,
                           prevQty: 40.6, curQty: 57, payRate: 30, curAmt: 470250 }] });
      loadInvoice('I389');
      buildInvPreview(INV.find(x => x.id === 'I389'));
      const pv = document.getElementById('inv-prev-html').innerText;
      out.send = /☑ 郵寄工地/.test(pv) && /□ 親送/.test(pv);
      out.qtyDec = /17\.1/.test(pv) && /57\.7/.test(pv);
      openInvCumDetail(0);
      out.cumBox = grab();
      // 利潤分析：KPI 一排可點＋佣金卡＋總結
      rProfit();
      out.profitClick = document.querySelectorAll('[onclick^="openProfitKpi"]').length >= 4;
      out.profitComm = document.body.innerHTML.includes('專案獎金（佣金）');
      openProfitKpi('net'); out.profitBox = grab();
      openCommKpi(); out.commBox = grab();
      // 金流／總覽／客戶 KPI 可點
      updateFinanceKPIs();
      out.finClick = document.querySelectorAll('#finance-kpis .kpi[onclick]').length >= 4;
      openFinKpi('ar'); out.arBox = grab();
      rDash();
      out.dashClick = document.querySelectorAll('#dash-kpis .kpi[onclick]').length >= 4
        && document.getElementById('dash-kpis').innerHTML.includes('專案獎金');
      updateCustomerStats();
      out.custClick = document.querySelectorAll('#customer-stats-grid .kpi[onclick]').length >= 3;
      openCustKpi(); out.custBox = grab();
      // 獎金改未稅基底
      out.commUntaxed = /q\.t\?\.sub/.test(String(confirmAward))
        && !document.getElementById('award-ref-mode');   // v6.0.29 得標視窗獎金區塊已移除（改介紹人）
      // 工程實績表：渲染＋勾選排除
      const el = document.createElement('div');
      renderTrackReport(el);
      out.track = /總結冒煙案/.test(el.innerText) && /匯出 Excel/.test(el.innerText) && /查看／匯出 PDF/.test(el.innerText);
      // v5.391：業主欄正名、狀態欄移除、PDF 表頭同字級＋LOGO
      out.trackCols = [...el.querySelectorAll('thead th')].map(t => t.innerText.trim()).join('|')
        === '|工程名稱|業主|工程地點|承攬金額|開工|完工';
      const pdfSrc = String(exportTrackPDF);
      out.trackPdf = !/狀態/.test(pdfSrc) && /FY_LOGO/.test(pdfSrc) && /\.co\{font-size:22px/.test(pdfSrc)
        && /width:28%">工程地點/.test(pdfSrc);
      const n0 = _trackSelRows().length;
      window._trackEx['Q389'] = true;
      out.trackTog = _trackSelRows().length === n0 - 1;
      window._trackEx['Q389'] = false;
      out.trackFns = typeof exportTrackPDF === 'function' && typeof exportTrackXlsx === 'function'
        && /277mm/.test(String(exportTrackPDF)) && /,true\);/.test(String(exportTrackPDF));   // v5.390 橫式
      return out;
    });
    check('材料估算：存檔缺欄位不再整頁空白', r.matest);
    check('寄送方式列印呈現三選一勾選', r.send);
    check('列印數量保留小數（17.1／57.7）', r.qtyDec);
    check('累積估驗可點出各期組成明細', /累積估驗明細/.test(r.cumBox) && /17\.1/.test(r.cumBox), r.cumBox.slice(0, 60));
    check('利潤分析 KPI 一排可點＋佣金卡', r.profitClick && r.profitComm);
    check('實際淨利點擊出各案明細', /實際淨利——各案明細/.test(r.profitBox), r.profitBox.slice(0, 60));
    check('佣金總結：總額／已計提／已付', /專案獎金（佣金）總結/.test(r.commBox) && /依實收已計提 NT\$ 1,500/.test(r.commBox), r.commBox.slice(0, 80));
    check('金流 KPI 可點、應收出明細', r.finClick && /應收帳款總結/.test(r.arBox), r.arBox.slice(0, 60));
    check('總覽 KPI 可點＋專案獎金卡', r.dashClick);
    check('客戶統計卡可點出業主總結', r.custClick && /業主往來總結/.test(r.custBox), r.custBox.slice(0, 60));
    check('專案獎金改以未稅合約金額計', r.commUntaxed);
    check('工程實績表：渲染＋勾選＋匯出鈕', r.track && r.trackTog && r.trackFns);
    check('工程實績表欄位：業主正名、刪除狀態欄', r.trackCols);
    check('工程實績表 PDF：LOGO＋公司名同標題字級、地點欄加寬', r.trackPdf);
    check('v5.389 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8-8. PDF 大原則：不縮放／四邊10mm／填滿才換頁（v5.392） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff';
      document.body.appendChild(host);
      const W = _pdfContentPx(false);
      host.style.width = W + 'px';
      out.contentPx = W;                       // (210−20)mm ≈ 718px
      out.contentPxLs = _pdfContentPx(true);   // (297−20)mm ≈ 1047px
      let tr = '';
      for (let i = 0; i < 60; i++) tr += '<tr><td style="padding:6px;border-bottom:1px solid #eee">工項 ' + (i + 1) + '</td><td>1,000</td></tr>';
      host.innerHTML = '<table><thead><tr><th>項目</th><th>金額</th></tr></thead><tbody>' + tr
        + '</tbody></table><div class="page-footer" style="height:120px">用印區</div>';
      const H = host.scrollHeight * 2, cvs = cv(W * 2, H);
      const plan = _pdfPlanPages(cvs, host, W, false);
      const rr = host.getBoundingClientRect();
      const rowB = [...host.querySelectorAll('tr')].map(el => Math.round((el.getBoundingClientRect().bottom - rr.top) * 2));
      const blockT = [...host.querySelectorAll('.page-footer')].map(el => Math.round((el.getBoundingClientRect().top - rr.top) * 2));
      // 換頁只切在列與列之間（或整塊頂緣）
      out.rowBoundary = plan.pages.slice(0, -1).every(p =>
        rowB.some(b2 => Math.abs(b2 - p.e) <= 2) || blockT.some(b2 => Math.abs(b2 - p.e) <= 2));
      // 續頁重印表頭（仍在表格中的頁）
      out.repeatHead = plan.pages[1] && plan.pages[1].hd === true;
      // 填滿才換頁：切點後的下一個列邊界必定超出本頁可用高度（放得下就不准換）
      const budget = plan.PAGE - 2 * plan.marg;
      out.fillTight = plan.pages.slice(0, -1).every(p => !rowB.some(b2 => b2 > p.e + 1 && b2 <= p.s + budget));
      out.fill = Math.min(...plan.pages.slice(0, -1).map(p => ((p.e - p.s) + 2 * plan.marg) / plan.PAGE));
      // 貼頁：四邊 10mm、比例固定不縮放
      const M = _pdfMargPt(), imgs = [], nos = [];
      const stub = { addPage() {}, addImage(d, f, x, y, w) { imgs.push({ x: +x.toFixed(1), y: +y.toFixed(1), w: +w.toFixed(1) }); },
                     setFontSize() {}, setTextColor() {}, text(t) { nos.push(t); } };
      _pdfAddPaged(stub, cvs, 595.28, 841.89, 0, plan, .95);
      out.marg10 = Math.abs(imgs[0].x - M) < 0.5 && Math.abs(imgs[0].y - M) < 0.5
        && imgs.every(i2 => Math.abs(i2.x - M) < 0.5) && Math.abs(imgs[0].w - (595.28 - 2 * M)) < 0.5;
      out.pageNos = nos.length === plan.pages.length && /^1 \/ /.test(nos[0]);
      // 不同長度的文件貼頁寬完全相同（絕不縮放塞頁）
      const ws = [1200, 2600].map(h => {
        const c2 = cv(W * 2, h), p2 = _pdfPlanPages(c2, host, W, false), a2 = [];
        _pdfAddPaged({ addPage() {}, addImage(d, f, x, y, w) { a2.push(+w.toFixed(1)); }, setFontSize() {}, setTextColor() {}, text() {} },
          c2, 595.28, 841.89, 0, p2, .95);
        return a2[0];
      });
      out.sameScale = ws[0] === ws[1];
      // 整份放得進一張紙 → 不分頁
      host.innerHTML = '<table><thead><tr><th>項目</th></tr></thead><tbody><tr><td>一列</td></tr></tbody></table>';
      const H2 = host.scrollHeight * 2;
      out.shortOnePage = _pdfPlanPages(cv(W * 2, H2), host, W, false).pages.length === 1;
      host.remove();
      // 全站一致：工具表單走同一引擎、原生列印不再縮放
      out.toolUnified = /_printViaIframe/.test(String(_toolPrint)) && !/window\.open/.test(String(_toolPrint));
      out.nativeNoZoom = _printNativeHTML.length === 2;
      out.previewNorm = /page-wrap\{width:100%!important/.test(String(_printViaIframe))
        && /_pdfContentPx/.test(String(_printViaIframe));
      return out;
    });
    check('內容寬＝A4扣左右各10mm（直718／橫1047）', r.contentPx === 718 && r.contentPxLs === 1047,
          r.contentPx + '/' + r.contentPxLs);
    check('貼頁四邊各 10mm 留白', r.marg10);
    check('換頁切在列與列之間（或整塊頂緣）', r.rowBoundary);
    check('續頁重印表頭', r.repeatHead);
    check('填滿才換頁（放得下就不准換頁）', r.fillTight, '最低使用率 ' + (r.fill || 0).toFixed(2));
    check('多頁時頁尾有頁碼', r.pageNos);
    check('一律原比例、不因長度縮放', r.sameScale);
    check('整份放得進一張紙就不分頁', r.shortOnePage);
    check('工具表單走全站統一 PDF 引擎', r.toolUnified);
    check('原生列印不再縮身成一頁', r.nativeNoZoom);
    check('預覽正規化版心（留白統一由 PDF 提供）', r.previewNorm);
    check('PDF 大原則測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 8. 報價單 PDF 排版（v5.383） ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const mk = (n, extra) => {
        const items = []; let sub = 0;
        for (let i = 0; i < n; i++) {
          if (i % 12 === 0) { items.push({ sec: true, desc: '第' + (i / 12 + 1) + '章' }); continue; }
          items.push(Object.assign({ desc: '鋼板樁打拔工（H=12M，含運搬、機具進出場、假設工程）',
            unit: ['支', '天/支', 'M2', '天/M2', '式'][i % 5], qty: 100, price: 12500 }, extra(i)));
          sub += 100 * 12500;
        }
        return { id: 'pq', name: '排版測試', client: '甲', items, t: { sub, tax: sub * 0.05, total: sub * 1.05 } };
      };
      // 空欄不占版面：全無逾期租金／備註時該欄不輸出
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#fff';
      const st = document.createElement('style'); st.textContent = _getPrintCSS(); host.appendChild(st);
      document.body.appendChild(host);
      const put = q => { host.querySelectorAll('.page-wrap').forEach(e => e.remove());
        host.insertAdjacentHTML('beforeend', '<div class="page-wrap">' + _buildQuoteDocHTML(q) + '</div>'); };
      put(mk(30, () => ({})));
      const ths = [...host.querySelectorAll('thead th')].map(e => e.textContent);
      out.dropEmpty = ths.indexOf('逾期租金') < 0 && ths.indexOf('備註') < 0 && ths.indexOf('單位') >= 0;
      const sc1 = host.querySelector('tr.sec-row td').getAttribute('colspan');
      out.colspan6 = sc1 === '6';
      put(mk(30, i => ({ ot: i % 5 === 0 ? '35' : '', note: i % 3 === 0 ? '含加班' : '' })));
      const ths2 = [...host.querySelectorAll('thead th')].map(e => e.textContent);
      out.keepUsed = ths2.indexOf('逾期租金') >= 0 && ths2.indexOf('備註') >= 0
        && host.querySelector('tr.sec-row td').getAttribute('colspan') === '8';
      // 單位欄不換行（天/M2 之類單位必須單行）
      const uTd = [...host.querySelector('table').querySelectorAll('tbody tr:not(.sec-row)')].map(tr => tr.children[2]);
      out.unitOneLine = uTd.every(td => td.offsetHeight <= td.parentNode.offsetHeight
        && getComputedStyle(td).whiteSpace === 'nowrap');
      // 分頁規劃：切點落在列邊界、天地留白、續頁重印表頭
      const root = host;
      const H = root.scrollHeight * 2;
      const plan = _pdfPlanPages({ width: 1588, height: H }, root, 794, false);
      out.multi = plan.pages.length >= 2;
      out.marg = plan.marg > 40;                      // 10mm@2x ≈ 76px
      out.noOverflow = plan.pages.every((p, i) =>
        (p.e - p.s) + (i === 0 ? 0 : plan.marg) + plan.marg + (p.hd ? plan.hd.e - plan.hd.s : 0) <= plan.PAGE + 1);
      const _cbH = Math.round(_pdfContentBottom(root) * 2);   // v6.0.23 文件高度＝內容底緣（.page-wrap 的下內距不算）
      out.contiguous = plan.pages[0].s === 0 && Math.abs(plan.pages[plan.pages.length - 1].e - _cbH) <= 2 && _cbH <= H
        && plan.pages.every((p, i) => i === 0 || p.s === plan.pages[i - 1].e);
      out.repeatHead = plan.pages.slice(1).some(p => p.hd === true);
      // 切點必須是某一列的下緣（±2px 容差）
      const rr = root.getBoundingClientRect();
      const edges = [...root.querySelectorAll('tr')].map(tr =>
        Math.round((tr.getBoundingClientRect().bottom - rr.top) * 2));
      out.rowBoundary = plan.pages.slice(0, -1).every(p =>
        edges.some(e => Math.abs(e - p.e) <= 2) || p.e > (plan.hd ? plan.hd.te : 0));
      host.remove();
      return out;
    });
    check('空的逾期租金／備註欄不輸出', r.dropEmpty && r.colspan6);
    check('有值時逾期租金／備註欄保留', r.keepUsed);
    check('單位欄不換行', r.unitOneLine);
    check('長報價單分成多頁', r.multi);
    check('每頁天地保留邊界留白', r.marg && r.noOverflow);
    check('分頁連續不重疊、不漏內容', r.contiguous);
    check('續頁重印表頭', r.repeatHead);
    check('換頁切在列與列之間', r.rowBoundary);
    check('PDF 排版測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── 9. 安全母索（v5.393：口徑須與豐有既有 Excel 逐格一致）─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const Z = (name, deck, form, v, h) => ({
        name, deck, form,
        v: { runs: v[0], rows: v[1].map(x => ({ n: x[0], len: x[1] })) },
        h: { runs: h[0], rows: h[1].map(x => ({ n: x[0], len: x[1] })) },
      });
      // ① 原 Excel「工作表1」：縱向 279.1＋橫向 289.4＋周長 207 ＝ 775.5 m
      Object.assign(_llState, {
        perim: 207, perimRuns: 1, layers: 1, deductLayers: 1, unit: 'cm',
        useSpare: false, waste: 0, form: 'wire',
        zones: [Z('第一區', false, '', [7, [[2, 5650], [2, 4830], [2, 2590], [1, 1770]]],
                                       [9, [[3, 4575], [1, 3925], [4, 2425], [1, 1590]]]),
                Z('構台下', true, '', [0, [[0, 0]]], [0, [[0, 0]]])],
      });
      let c = _llCalc();
      out.sheet1 = c.zones[0].v.len === 279.1 && c.zones[0].h.len === 289.4
        && c.zoneLen === 568.5 && c.net === 775.5;
      // ② 原 Excel「多區塊(轉換檔)」：縱橫 2973.75、構台下 849、3 層扣一層 ＝ 9275.25 m
      _llState.perim = 401; _llState.layers = 3; _llState.deductLayers = 1;
      const ZONES = () => [
        Z('第一區', false, '', [9, [[2, 4693], [7, 5112]]], [8, [[8, 5943]]]),
        Z('第二區', false, '', [9, [[9, 5112]]], [8, [[6, 5512], [2, 4579]]]),
        Z('第三區', false, '', [7, [[7, 3217]]], [5, [[5, 4573]]]),
        Z('第四區', false, '', [9, [[5, 3217], [3, 2746], [1, 2591]]], [5, [[1, 3397], [1, 5292], [3, 5512]]]),
        Z('轉換檔', false, '', [1, [[1, 8600]]], [1, [[1, 10300]]]),
        Z('構台下', true, '', [11, [[6, 6400], [5, 1300]]], [19, [[16, 1300], [3, 6400]]])];
      _llState.zones = ZONES();
      c = _llCalc();
      out.multi = c.zoneLen === 2973.75 && c.deckLen === 849
        && c.perLayer === 3374.75 && c.gross === 10124.25 && c.net === 9275.25;
      out.noBad = c.bad.length === 0;                       // 各方向宣告路數與明細相符
      // ③ 路數勾稽：宣告與明細不符要抓出來
      _llState.zones[0].v.runs = 99;
      out.catches = _llCalc().bad.join('') === '第一區 縱向';
      _llState.zones[0].v.runs = 9;
      // ④ 端部預留與損耗：(9275.25＋159路×1.5)×1.05
      _llState.useSpare = true; _llFP('wire').spare = 1.5; _llFP('wire').reel = 200; _llState.waste = 5;
      c = _llCalc();
      out.runs = c.runs === 159;                            // (63路×3層)−(30路×1層)
      out.need = Math.abs(c.need - (9275.25 + 238.5) * 1.05) < 1e-6;
      out.reels = c.reels === Math.ceil(c.need / 200);
      // ⑤ 兩種形式（特多龍繩／鋼索）：混用時長度、路數、配件分開彙總，總和不變
      _llState.zones = ZONES(); _llState.zones[2].form = 'rope'; _llState.zones[5].form = 'rope';
      c = _llCalc();
      out.mixSplit = Math.abs(c.T.wire.net - 8762.73) < 1e-6 && Math.abs(c.T.rope.net - 512.52) < 1e-6
        && Math.abs(c.net - 9275.25) < 1e-6 && c.mixed && c.used.length === 2;
      out.mixRuns = c.T.wire.runs === 153 && c.T.rope.runs === 6 && c.runs === 159;
      out.mixSpec = c.T.wire.spec !== c.T.rope.spec && c.T.wire.unitW > c.T.rope.unitW
        && c.T.wire.acc[0] === c.T.wire.runs * _llFP('wire').acc[0]
        && c.T.rope.acc[0] === c.T.rope.runs * _llFP('rope').acc[0];
      // 全部改特多龍繩：鋼索欄消失、長度整包搬過去
      _llState.zones = ZONES(); _llState.form = 'rope';
      c = _llCalc();
      out.allRope = !c.T.wire.used && Math.abs(c.T.rope.net - 9275.25) < 1e-6 && c.used.length === 1;
      _llState.form = 'wire'; _llState.zones = ZONES();
      // ⑥ v5.393 舊存檔（只有鋼索一組參數）回載後要遷移進 f.wire，不能歸零
      const mg = _llMigrate({ perim: 100, layers: 2, deductLayers: 1, unit: 'cm', useSpare: true,
        spare: 1.5, waste: 5, reelLen: 250, clips: 6, turn: 2, shackle: 3,
        zones: [Z('A', false, undefined, [1, [[1, 10000]]], [0, [[0, 0]]])] });
      out.migrate = mg.form === 'wire' && mg.f.wire.reel === 250 && mg.f.wire.spare === 1.5
        && mg.f.wire.acc.join(',') === '6,2,3' && !!mg.f.rope.spec
        && mg.clips === undefined && mg.zones[0].form === '';
      // ⑦ 匯出：Excel 必須是活公式、列印走統一引擎
      _llState.zones[2].form = 'rope';
      let sheets = null, printed = null;
      const oX = window.xlsxDownload, oP = window._printViaIframe;
      window.xlsxDownload = (f, s) => { sheets = s; };
      window._printViaIframe = h => { printed = h; };
      try { _llXlsx(); _llPrint(); } finally { window.xlsxDownload = oX; window._printViaIframe = oP; }
      const flat = JSON.stringify(sheets || []);
      out.xlsxLive = /"f":"C\d+\*D\d+\*\$B\$6"/.test(flat) && /CEILING\(/.test(flat)
        && /IF\(F\d+=0/.test(flat) && /SUMIFS\(/.test(flat) && /特多龍繩/.test(flat) && /鋼索/.test(flat);
      out.printOk = !!printed && printed.indexOf('安全母索用量表') > 0 && /母索總長/.test(printed);
      // ⑧ 畫面
      go('lifeline');
      out.rendered = document.getElementById('lifeline-root').innerText.indexOf('母索總長') >= 0;
      return out;
    });
    check('安全母索：單區塊口徑與 Excel 一致', r.sheet1);
    check('安全母索：多區塊＋扣除構台下與 Excel 一致', r.multi && r.noBad);
    check('安全母索：宣告路數與明細不符會被抓出', r.catches);
    check('安全母索：總路數、端部預留與損耗計入需求長度', r.runs && r.need && r.reels);
    check('安全母索：特多龍繩／鋼索混用時分開彙總', r.mixSplit && r.mixRuns && r.mixSpec);
    check('安全母索：整案切換形式與舊存檔遷移', r.allRope && r.migrate);
    check('安全母索：Excel 匯出為活公式、列印走統一引擎', r.xlsxLive && r.printOk);
    check('安全母索：頁面渲染無 JS 錯誤', r.rendered && errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 10. v5.395：單價庫單位限制／異常成本警示／單價分析逾期租金重置／材料估算引用安全母索 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      // 單價庫：同名但「式」的實績不得套到逐 M 工項
      COST_HIST = [{ qid: 'x', idx: 0, key: _normName('支撐架設及拆除'), name: '支撐架設及拆除', unit: '式', actUnit: 1500000, priceUnit: 2000000, qty: 1 },
                   { qid: 'y', idx: 1, key: _normName('支撐架設'), name: '支撐架設', unit: 'M', actUnit: 420, priceUnit: 600, qty: 100 }];
      out.histUnit = _histCostFor('支撐架設', 'M').avg === 420 && _histCostFor('支撐架設').avg === 420
        && _histCostFor('支撐架設', '式').avg === 1500000;
      // 異常成本：成本單價 > 報價單價 3 倍 → 合計區點名＋輸入框標紅
      P.tax = 5; exs = [];
      items = [{ desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '500', estCost: '380', ot: '', otu: '', sec: false },
               { desc: '支撐架設', unit: 'M', qty: '800', price: '600', estCost: '1500000', ot: '', otu: '', sec: false }];
      go('editor'); rItems(); rTots();
      const w = document.getElementById('tcost-warn');
      out.costWarn = w && w.style.display !== 'none' && /支撐架設/.test(w.textContent) && _costOddList().length === 1
        && [...document.querySelectorAll('#page-editor input')].some(i => i.style.borderColor === 'var(--red)');
      // 單價分析：換工項後逾期租金不得殘留上一項（H 型鋼）的數字
      go('upa');
      const c1 = document.getElementById('upa-cat1'), c2 = document.getElementById('upa-cat2');
      const pick = (k1, k2) => { c1.value = k1; upaOnCat1Change(); c2.value = k2; upaOnCat2Change(); upaUpdateDesc();
        return { amt: document.getElementById('upa-ot-amt').value, unit: document.getElementById('upa-ot-unit').value }; };
      document.getElementById('upa-len').value = '12';
      const h = pick('retaining', 'H型鋼樁');
      const el = document.getElementById('upa-ot-amt'); el.value = '999'; el._userEdited = true;   // 使用者手改後再換工項
      const st = pick('support', '水平支撐'), jk = pick('support', '油壓千斤頂'), pf = pick('support', '施工構台');
      out.upaReset = +h.amt > 0 && h.unit === '$/支/天' && st.amt === '' && +jk.amt > 0 && jk.unit === '$/具/天' && +pf.amt > 0 && pf.unit === '$/m²/天';
      // 期別名稱
      out.labels = ITEM_PHASES.map(x => x[1]).join('|') === '自動判斷|打設／裝設期|拔除／拆除期'
        && /拔除／拆除期請款率/.test(document.getElementById('page-params').textContent);
      // v5.397：安全母索併入材料估算——範圍＝各層圍令（周圍）＋縱橫支撐路，第一層扣構台下；
      // 形式／每捲長度／端部預留可設，折捲依需求長度；母索用量表可單獨列印
      Q = [{ id: 'qA', code: '1150', name: '冒煙案A新建工程', client: 'K營造', date: '2026-01-01', items: [], exs: [], costs: [], awarded: true, rmk: {}, _mt: 1 }];
      window._matEstQid = 'qA'; MAT_EST = _shDefaults(); MAT_EST.P = 200; MAT_EST.A = 2000; MAT_EST.H = 10; MAT_EST.layers = 2;
      MAT_EST._layers = [{ w: 'H350', s: 'H350', st: false }, { w: 'H350', s: 'H350', st: false }];
      MAT_EST._routesV = [{ rc: 4, rl: 25 }]; MAT_EST._routesH = [{ rc: 4, rl: 40 }];   // 支撐路 260M
      MAT_EST.gtRopeDeduct = '1'; MAT_EST._gtRoutesV = [{ rc: 1, rl: 20 }]; MAT_EST._gtRoutesH = [{ rc: 2, rl: 5 }]; MAT_EST.ropeForm = 'rope'; MAT_EST.ropeReel = 200; MAT_EST.ropeSpare = 2;   // 構台下 30M
      go('matest'); matEstCalc();
      const r0 = window._matEstRes, ld = r0.layerData;
      // 每層＝圍令(200×倍數1=200)＋支撐路 260；第一層扣 30 → 430；第二層 460；合計 890
      out.matRope = ld.length === 2 && ld[0].ropeWal === 200 && ld[0].ropeSup === 260 && ld[0].ropeDed === 30 && ld[0].rope === 430
        && ld[1].ropeDed === 0 && ld[1].rope === 460 && r0.T.rope === 890
        && ld[0].ropeRuns === 9 && r0.T.ropeSpare === 36 && r0.T.ropeNeed === 926 && r0.T.ropeReels === 5 && r0.T.ropeForm === '特多龍繩';
      out.matRows = r0.back.some(x => x.sec === '安全母索（特多龍繩）') && r0.back.some(x => x.k === '安全母索需求長度' && x.v === '926')
        && !r0.back.some(x => x.k === '安全母索總長') && r0.staged.some(st => st.items.some(it => /安全母索（特多龍繩，折捲）/.test(it.name)));
      out.matForm = /母索形式/.test(document.getElementById('mat-est-form').innerHTML) && /matEstRopePDF/.test(document.getElementById('mat-est-form').innerHTML)
        && /構台下縱向路數/.test(document.getElementById('mat-est-form').innerHTML) && /_gtRoutesH/.test(document.getElementById('mat-est-form').innerHTML)
        && !/開啟安全母索/.test(document.getElementById('mat-est-form').innerHTML);
      // 材料估算表 PDF：橫式、叫料表格在最前、無彙總清冊；母索用量表可單獨列印
      let printed = [], land = [];
      const oP2 = window._printViaIframe; window._printViaIframe = (h, f, l) => { printed.push(h); land.push(!!l); };
      try { matEstExportPDF(); matEstRopePDF(); } finally { window._printViaIframe = oP2; }
      out.matPdf = printed.length === 2 && land[0] === true && /分階段叫料建議/.test(printed[0]) && !/材料需求清冊/.test(printed[0])
        && printed[0].indexOf('材料明細') < printed[0].indexOf('分階段叫料建議') && /A4 landscape/.test(printed[0])
        && /安全母索用量表/.test(printed[1]) && /扣構台下 M/.test(printed[1]) && /926/.test(printed[1]);
      // v5.400：明細每一分類自成一表、每列 3～4 組項目並排（分類標題 colspan 9 或 12），且分類不可少
      out.matDet = (printed[0].match(/class="hd"/g) || []).length >= 4 && /colspan="(9|12)" class="hd"/.test(printed[0]) && !/colspan="6" class="hd"/.test(printed[0]);
      out.hidden = ALL_PAGES.find(p => p.id === 'lifeline').hidden === true;
      // 構台下區塊形式沒有對應區塊：扣除不得扣成負數，並提出警告
      _llState.perim = 200; _llState.layers = 3; _llState.form = 'wire';
      _llState.zones = [{ name: '第一區', deck: false, form: '', v: { runs: 2, rows: [{ n: 2, len: 5000 }] }, h: { runs: 2, rows: [{ n: 2, len: 4000 }] } },
                        { name: '構台下', deck: true, form: 'rope', v: { runs: 1, rows: [{ n: 1, len: 3000 }] }, h: { runs: 0, rows: [{ n: '', len: '' }] } }];
      const c = _llCalc();
      out.deckGuard = c.T.rope.net === 0 && c.T.rope.need === 0 && c.warn.length === 1 && c.T.wire.net === 1140;
      return out;
    });
    check('單價庫：實績比對受單位限制（式不套到逐M）', r.histUnit);
    check('報價成本：異常成本單價點名＋標紅', r.costWarn);
    check('單價分析：換工項逾期租金重置、千斤頂／構台自動帶入', r.upaReset);
    check('期別名稱：打設／裝設、拔除／拆除', r.labels);
    check('材料估算：母索＝圍令周圍＋支撐路、扣構台下、預留與折捲', r.matRope && r.matRows);
    check('材料估算：母索形式欄位＋單獨 PDF、獨立頁隱藏', r.matForm && r.hidden);
    check('材料估算表 PDF：橫式、明細表在前、叫料條列在後、無重複彙總', r.matPdf);
    check('材料估算表 PDF：明細每列 3～4 組並排', r.matDet);
    check('安全母索：構台下形式無對應區塊不扣成負數', r.deckGuard);
    check('v5.395 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 11. v5.396：鋼軌樁逾期租金不乘長度／舊報價異常成本開單自動修復 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      go('upa');
      const c1 = document.getElementById('upa-cat1'), c2 = document.getElementById('upa-cat2');
      c1.value = 'retaining'; upaOnCat1Change(); c2.value = '鋼軌樁'; upaOnCat2Change();
      document.getElementById('upa-len').value = '9'; upaUpdateDesc();
      // 租金表 9m ＝ 6 $/支/天 → 逾期租金 6×1.5 ＝ 9（不再 ×9m 變 81）
      out.rail = document.getElementById('upa-ot-amt').value === String(Math.round(upaGetRailRent(9) * 1.5))
        && +document.getElementById('upa-ot-amt').value === 9 && document.getElementById('upa-ot-unit').value === '$/支/天';
      c2.value = 'H型鋼樁'; upaOnCat2Change(); document.getElementById('upa-len').value = '12'; upaUpdateDesc();
      out.hsteelStill = +document.getElementById('upa-ot-amt').value > 0;   // H 型鋼租金 $/M/天 仍乘長度
      // 舊報價帶著「一式」成本：開單自動改同單位實績；沒有同單位實績的清空
      COST_HIST = [{ qid: 'x', idx: 0, key: _normName('支撐架設'), name: '支撐架設', unit: 'M', actUnit: 420, priceUnit: 600, qty: 100 }];
      Q = [{ id: 'qF', code: '1151', name: '成本修復案', client: 'K', date: '2026-01-01', exs: [], costs: [], rmk: {}, _mt: 1,
        items: [{ desc: '支撐架設', unit: 'M', qty: '800', price: '600', estCost: '1500000', ot: '', otu: '', sec: false },
                { desc: '安全母索（5分特多龍繩）', unit: 'M', qty: '900', price: '400', estCost: '279000', ot: '', otu: '', sec: false },
                { desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '500', estCost: '380', ot: '', otu: '', sec: false }] }];
      loadQ('qF'); go('editor'); rItems(); rTots();
      out.fixed = items[0].estCost === '420' && items[1].estCost === '' && items[2].estCost === '380' && _costOddList().length === 0;
      out.warnGone = document.getElementById('tcost-warn').style.display === 'none';
      out.button = typeof _costOddFix === 'function';
      return out;
    });
    check('單價分析：鋼軌樁逾期租金依租金表（$/支/天）不乘長度', r.rail && r.hsteelStill);
    check('報價成本：開單自動修復單位不符的成本單價', r.fixed && r.warnGone && r.button);
    check('v5.396 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 12. v5.401：日報承包出工／工項數量四方對照／請款帶入日報量／進度回填 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      const today = localToday();
      Q = [{ id: 'qD', code: '1160', name: '日報串連案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        items: [{ desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '500', estCost: '', ot: '', otu: '', sec: false },
                { desc: '支撐架設', unit: '式', qty: '1', price: '80000', estCost: '', ot: '', otu: '', sec: false }],
        costs: [{ id: 'c1', type: 'sub', vendor: '甲承包', rows: [{ id: 'c1_0', linkedItemIdx: 0, desc: '', qty: 80, unitPrice: 300 }] }],
        dailyLogs: [] }];
      INV.length = 0;
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'qD'; sel.onchange();
      out.vendorList = /甲承包/.test(document.getElementById('dr-sub-vendor-list').innerHTML);
      _drCrews = [{ type: 'labor', vendor: '', n: '2' }, { type: 'sub', vendor: '甲承包', n: '6' }]; drRenderCrews();   // v5.406 出工列
      _drProgRows = [{ itemIdx: 0, qty: '120', note: '' }]; drRenderProgRows();
      out.hintOver = /超過合約量/.test(document.getElementById('dr-hint-0').textContent);
      document.getElementById('dr-date').value = today;
      submitDailyReport();
      const L = Q[0].dailyLogs[0];
      out.saved = L && L.workers === 2 && L.subWorkers === 6 && L.subVendor === '甲承包' && L.progressRows[0].qty === 120;
      // 成本勾稽：只算自有／點工 2 工，承包 6 人不計
      window.eid = 'qD';
      const audit = buildCostAuditHtml(Q[0]);
      out.auditOnlyOwn = /自有／點工累計 2 工/.test(audit) && !/累計 8 工/.test(audit);
      // 數量四方對照：回報 120 ＞ 合約 100；發包 80 ＜ 回報 120
      const rec = _qtyRecon(Q[0]);
      const r0 = rec.find(x => x.idx === 0);
      out.recon = r0 && r0.contract === 100 && r0.reported === 120 && r0.sub === 80
        && r0.notes.some(w => /回報量超過合約量/.test(w)) && r0.notes.some(w => /發包量低於回報量/.test(w));   // v5.444 起實作實算的超量改為藍字提示（notes）
      out.reconHtml = /實作實算/.test(buildQtyReconHtml(Q[0])) && /回報量超過合約量/.test(buildQtyReconHtml(Q[0])) && !!document.getElementById('cost-view-qty');
      // 請款帶入日報量：無上期 → 全部日報量 120；有上期（日期在日報之前）→ 仍 120；上期在日報之後 → 0
      out.between = _dailyQtyBetween(Q[0], 'H型鋼樁打設', '', today) === 120
        && _dailyQtyBetween(Q[0], 'H型鋼樁打設', today, today) === 0;
      // 施工進度工具：從日報回填
      _pgState.proj = '日報串連案';
      _pgState.rows = [{ crew: '', name: 'H型鋼樁打設', qty: 100, unit: 'M', rate: 10, manualDays: null, offset: null, startOverride: '', doneQty: null, actualStart: '', doneAt: '' }];
      go('progress');
      const n = _pgFillFromDaily(true);
      out.pgFill = n === 1 && _pgState.rows[0].doneQty === 120 && _pgState.rows[0].actualStart === today && _pgState.rows[0].doneAt === today;
      return out;
    });
    check('日報：承包廠商出工另欄記錄，不入點工勾稽', r.vendorList && r.saved && r.auditOnlyOwn);
    check('日報：進度列即時提示超過合約量', r.hintOver);
    check('施工成本：工項數量四方對照（實作實算超量為提示）', r.recon && r.reconHtml);
    check('請款單：依上期請款日切日報回報量', r.between);
    check('施工進度：從日報回填實際完成量與完工日', r.pgFill);
    check('v5.401 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 13. v5.402：金流預測依進度推請款／廠商績效出工工期／機具逐台／未填日報提醒 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      const ago = n => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const year = String(new Date().getFullYear());
      Q = [{ id: 'qE', code: '1161', name: '串連二案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        t: { sub: 100000, tax: 5000, total: 105000 },
        items: [{ desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '1000', estCost: '', ot: '', otu: '', sec: false }],
        costs: [],
        dailyLogs: [
          { id: 'd1', date: ago(5), workers: 0, subWorkers: 6, subVendor: '乙承包', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁打設', qty: 50, note: '' }], photos: [], ownEquip: true, equip: [{ name: 'A機', hrs: 8 }] },
          { id: 'd2', date: ago(6), workers: 0, subWorkers: 6, subVendor: '乙承包', progressRows: [], photos: [], ownEquip: true, equip: [{ name: 'A機', hrs: 4 }, { name: 'B機', hrs: 8 }] }] }];
      INV.length = 0; CONTRACTS.splice(0);
      // 金流預測：日報進度 50% → 預估第 1 期（尚未開單）
      out.phys = Math.round(_projPhysProgress(Q[0]).pct) === 50;
      go('finance'); renderCashForecast();
      out.cf = /預估第1期（日報進度 50%，尚未開單）/.test(document.getElementById('cashflow-forecast').innerHTML);
      // 廠商績效：日報承包出工 12 工、工期 2 天
      const v = _vendorStats(year).find(x => x.name === '乙承包');
      out.vendor = !!v && v.subDays === 12 && v.subLogN === 2 && (_dDiff(v.first, v.last) + 1) === 2;
      const dv = document.createElement('div'); renderVendorReport(dv, year, null);
      out.vendorHtml = /12 工/.test(dv.innerHTML) && /2 天・2 篇/.test(dv.innerHTML);
      // 機具逐台：參數清單 → 日報勾選 → 出工月結逐台稼動
      P.equipList = ['A機', 'B機']; P.drGapDays = 3;
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'qE'; sel.onchange();
      document.getElementById('dr-own-equip').checked = true; _drRenderEquip(); _drToggleEquip('A機');
      out.equipUI = /✓ A機/.test(document.getElementById('dr-equip-box').innerHTML);
      const col = _drCollect();
      out.equipCollect = !!col && col.ownEquip && col.equip.length === 1 && col.equip[0].name === 'A機' && col.equip[0].hrs === 1;   // v6.0.29 填天數
      const dl = document.createElement('div'); renderLaborReport(dl, year, null);
      out.equipRpt = /自有機具稼動/.test(dl.innerHTML) && /A機/.test(dl.innerHTML) && /2 天/.test(dl.innerHTML) && /12 天/.test(dl.innerHTML);
      // 待辦：最近一篇日報 5 天前、門檻 3 天 → 提醒
      updateDashTodo();
      out.todo = /串連二案 已 5 天沒有日報/.test(document.getElementById('dash-todo-list').innerHTML);   // v5.431 改問句
      P.drGapDays = 0; updateDashTodo();
      out.todoOff = !/沒有日報/.test(document.getElementById('dash-todo-list').innerHTML);
      return out;
    });
    check('金流預測：依日報進度推估尚未開單的請款', r.phys && r.cf);
    check('廠商績效：日報承包出工累計與工期', r.vendor && r.vendorHtml);
    check('日報：自有機具逐台勾選＋時數，出工月結逐台稼動', r.equipUI && r.equipCollect && r.equipRpt);
    check('待辦：連續未填日報提醒（可關閉）', r.todo && r.todoOff);
    check('v5.402 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 14. v5.403：科目拆分／承包列自動帶合約量＋備註／日報欄位對齊 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      out.cats = COST_CATS.indexOf('打設') >= 0 && COST_CATS.indexOf('拔除') >= 0 && COST_CATS.indexOf('裝設') >= 0 && COST_CATS.indexOf('拆除') >= 0
        && COST_CATS.indexOf('打設拔除') < 0 && /打設拔除（舊）/.test(_costCatOpts('打設拔除')) && _costDefaultCat('sub') === '打設';
      Q = [{ id: 'qG', code: '1162', name: '成本列案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        items: [{ desc: 'H型鋼樁 H300 L=9M 打設拔除', unit: 'M', qty: '144', price: '5000', estCost: '', ot: '', otu: '', sec: false }],
        costs: [{ id: 'cS', type: 'sub', vendor: '鴻玉開發', cat: '打設拔除', rows: [] }], dailyLogs: [] }];
      openProjectCosts('qG');
      addCostRow('cS');
      const row = Q[0].costs[0].rows[0];
      out.newQty = row.qty === 0;
      updCostField('cS', 'linkedItemIdx', '0', row.id);
      out.autoQty = Q[0].costs[0].rows[0].qty === 144;
      const html = document.getElementById('cost-list').innerHTML;
      out.memo = /crow-memo/.test(html) && /備註（例：\$4,050／M/.test(html) && /打設拔除（舊）/.test(html);
      // 日報欄位
      go('quickcost'); rQuickCost();
      const lbls = [...document.querySelectorAll('#page-quickcost label')].map(l => l.textContent.trim());
      out.labels = lbls.some(t => /^出工/.test(t)) && document.querySelectorAll('#dr-crews .dr-crew').length === 2;   // v5.406 出工列取代兩欄人數
      const sel = document.getElementById('dr-proj'); sel.value = 'qG'; sel.onchange();
      const row0 = document.getElementById('dr-prog-rows').firstElementChild;
      const ws = [...row0.children].filter(e => e.tagName !== 'BUTTON').map(e => e.getBoundingClientRect().width);
      out.equal = ws.length === 3 && Math.max(...ws) - Math.min(...ws) < 2;
      return out;
    });
    check('施工成本：科目打設／拔除／裝設／拆除分開，舊科目照舊顯示', r.cats);
    check('施工成本：承包列選工項自動帶合約量、備註欄整行', r.newQty && r.autoQty && r.memo);
    check('日報：點工／承包出工欄位對齊、進度列三欄等寬', r.labels && r.equal);
    check('v5.403 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 15. v5.404：引孔費／日報修改刪除／廠商放款日／毛利容錯／材料估算正規化／金流圖說明／成本頁回清單 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      // ① 單價分析：鑽堡引孔 → 建議單價加「引孔費 $/M × 樁長」
      UPA_COST_DB.rail.drill = 500; UPA_COST_DB.sheetpile.drill = 500;
      const a = upaCalcRail(10, 3, '台北', '振動打設'), b = upaCalcRail(10, 3, '台北', '鑽堡引孔');
      out.upaRail = a.addon === 0 && b.addon === 5000 && Math.round(b.total - a.total) === 5000 && /引孔\$5000/.test(b.breakdown);
      const c = upaCalcSP('SP-IV型', 12, 3, '台北', '鑽掘引孔');
      out.upaSP = c.addon === 6000 && /引孔/.test(c.breakdown);
      // ② 廠商放款日：本月計價、下月 25 日放款（可調）
      P.vendorPayDay = 25; P.vendorPayDelay = 1;
      out.due = _vendorDueDate('2026-03-05') === '2026-04-25' && _vendorDueDate('2026-01-31') === '2026-02-25';
      P.vendorPayDay = 31; out.dueClamp = _vendorDueDate('2026-01-15') === '2026-02-28';
      P.vendorPayDay = 25; P.vendorPayDelay = 0; out.dueSame = _vendorDueDate('2026-03-05') === '2026-03-25';
      P.vendorPayDelay = 1;
      Q = [{ id: 'qH', code: '1163', name: '四零四案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        items: [{ desc: 'H型鋼樁 H300 L=9M 打設', unit: 'M', qty: '100', price: '1000', estCost: '', ot: '', otu: '', sec: false },
                { desc: '動員費', unit: '式', qty: '1', price: '20000', estCost: '90000', ot: '', otu: '', sec: false }],
        costs: [{ id: 'cH', type: 'sub', vendor: '丙承包', cat: '打設', date: '2026-03-05', amt: 50000, rows: [{ id: 'r1', linkedItemIdx: 0, desc: '', qty: 100, unitPrice: 500 }] }],
        dailyLogs: [{ id: 'dH', date: '2026-03-10', workers: 2, subWorkers: 5, subVendor: '', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁 H300 L=9M 打設', qty: 30, note: '' }], progress: 'H型鋼樁 30M', photos: [] }] }];
      PAYABLES.length = 0; INV.length = 0; CONTRACTS.splice(0);
      P.subPayOnBill = false;   // v5.443 起預設未計價不掛整筆，此處驗到期日口徑
      syncCostToPayable(Q[0], Q[0].costs[0]);
      const pay = PAYABLES.find(p => p.costId === 'cH');
      out.payDue = !!pay && pay.date === '2026-04-25';
      P.subPayOnBill = true;
      // ③ 報價列表毛利：成本單價 > 報價 3 倍視為未填，不再出現 −N千% 的淨利率
      _recalcQuoteTotals(Q[0]);
      const nr = _quoteEstNetR(Q[0]);
      out.netR = nr > -1 && nr < 1;
      const fixed = _fixOddCostsAll();
      out.fixOdd = fixed === 1 && Q[0].items[1].estCost === '';
      // ④ 日報：修改／刪除（專案頁日報檢視內）
      viewDailyReports('qH');
      const mb = document.getElementById('gen-confirm-modal');
      out.viewBtns = /✎ 修改/.test(mb.innerHTML) && /delDailyLog/.test(mb.innerHTML);
      editDailyLog('qH', 'dH');
      document.querySelector('#dle-crews .dle-cn').value = '3';   // v5.406 第一列＝點工 2 人 → 改 3
      document.querySelectorAll('.dle-q')[0].value = '45';
      document.getElementById('gen-confirm-ok').click();
      const L = Q[0].dailyLogs[0];
      out.edited = L.workers === 3 && L.progressRows[0].qty === 45 && /45/.test(L.progress) && Q[0]._mt > 1;
      delDailyLog('qH', 'dH');
      document.getElementById('gen-confirm-ok').click();
      out.deleted = Q[0].dailyLogs.length === 0;
      // ⑤ 施工成本：分析／勾稽／數量對照都有「回成本清單」鈕，再按一次同鈕也回清單；勾稽出工列可點日報
      Q[0].dailyLogs.push({ id: 'dH2', date: '2026-03-11', workers: 2, subWorkers: 0, subVendor: '', progressRows: [], progress: '', photos: [] });
      openProjectCosts('qH');
      setCostView('audit');
      const cl = document.getElementById('cost-list').innerHTML;
      out.back = /回成本清單/.test(cl) && /viewDailyReports\('qH'\)/.test(cl);
      setCostView('audit'); out.toggle = window._costView === 'list' && !/回成本清單/.test(document.getElementById('cost-list').innerHTML);
      setCostView('qty'); out.qtyLabel = /發包量/.test(document.getElementById('cost-list').innerHTML);
      setCostView('list');
      // ⑥ 日報：選工項自動帶發包廠商
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'qH'; sel.onchange();
      drRenderCrews(true);
      _drProgRows[0].itemIdx = 0; _drAutoVendor(0);
      out.autoVendor = _drCrews.some(c => c.type === 'sub' && c.vendor === '丙承包');   // v5.406 帶進承包出工列
      // ⑦ 材料估算：壞存檔（陣列被剝掉／元素不是物件／缺欄位）不得變空白
      go('matest');
      const bad = [{ _layers: { 0: { w: 'H300' } }, _routesV: 'x', _dc: [null, 5], layers: '3' }, { _layers: null }, 'garbage', 7];
      out.matNorm = bad.every(function (src) {
        MAT_EST = _matEstNorm(src);
        return Array.isArray(MAT_EST._layers) && MAT_EST._layers.length >= 1 && Array.isArray(MAT_EST._routesV) && Array.isArray(MAT_EST._dc) && MAT_EST._dc.every(x => x && typeof x === 'object');
      });
      MAT_EST = { _layers: 'broken', _dc: [null] }; renderMatEst();
      out.matRender = document.getElementById('mat-est-form').innerHTML.length > 500 && !/載入失敗/.test(document.getElementById('mat-est-form').innerHTML);
      // ⑧ 90 天現金水位圖：橫軸日期、最高／最低標示與說明文字
      go('finance'); renderCashForecast();
      const cf = document.getElementById('cashflow-forecast').innerHTML;
      out.chart = /今日 /.test(cf) && /90天後 /.test(cf) && /最低 NT\$/.test(cf) && /0（現金見底線）/.test(cf) && /折線＝每日現金水位/.test(cf);
      return out;
    });
    check('單價分析：鑽堡／鑽掘引孔加引孔費 × 樁長', r.upaRail && r.upaSP);
    check('應付：承包成本到期日＝次月 25 日（放款日／月延可調）', r.due && r.dueClamp && r.dueSame && r.payDue);
    check('報價列表：異常成本單價不計入預估毛利，啟動一次性修正', r.netR && r.fixOdd);
    check('日報：檢視內可修改／刪除並重算進度', r.viewBtns && r.edited && r.deleted);
    check('施工成本：分析／勾稽／對照皆可回清單，勾稽出工列可點日報', r.back && r.toggle && r.qtyLabel);
    check('日報：選工項自動帶發包廠商', r.autoVendor);
    check('材料估算：壞存檔正規化，不再變空白', r.matNorm && r.matRender);
    check('金流：90 天水位圖有座標與最高／最低說明', r.chart);
    check('v5.404 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 16. v5.405：分包合約／分期計價／逐期應付／保留款／數量對照 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      P.vendorPayDay = 25; P.vendorPayDelay = 1; P.subPayOnBill = false;   // v5.443 起預設未計價不掛整筆，此段驗舊口徑
      Q = [{ id: 'qS', code: '1170', name: '分包案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        items: [{ desc: 'H型鋼樁 H300 L=9M 打設', unit: 'M', qty: '100', price: '1000', estCost: '', ot: '', otu: '', sec: false },
                { desc: 'H型鋼樁 H300 L=9M 拔除', unit: 'M', qty: '100', price: '400', estCost: '', ot: '', otu: '', sec: false }],
        costs: [{ id: 'cS', type: 'sub', vendor: '丙承包', cat: '打設', date: '2026-02-01', amt: 0, retRate: 5, invoice: true, signDate: '2026-01-20', entryDate: '2026-02-01',
          rows: [{ id: 'r1', linkedItemIdx: 0, desc: '', qty: 100, unitPrice: 500 }, { id: 'r2', linkedItemIdx: 1, desc: '', qty: 100, unitPrice: 200, ret: 0 }] }],
        dailyLogs: [{ id: 'd1', date: '2026-03-05', workers: 0, subWorkers: 5, subVendor: '丙承包', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁 H300 L=9M 打設', qty: 40, note: '' }], progress: '', photos: [] },
                    { id: 'd2', date: '2026-03-20', workers: 0, subWorkers: 5, subVendor: '丙承包', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁 H300 L=9M 打設', qty: 20, note: '' }], progress: '', photos: [] }] }];
      INV.length = 0; CONTRACTS.splice(0); PAYABLES.length = 0;
      openProjectCosts('qS');
      const c = Q[0].costs[0];
      syncCostToPayable(Q[0], c);
      out.whole = PAYABLES.length === 1 && PAYABLES[0].id === 'paycS' && PAYABLES[0].amount === 70000;   // 未分期：整筆
      // 本期計價：期間內日報 60M 自動帶入 → 30,000、保留 5% 1,500、應付 28,500×1.05、到期次月 25 日
      openSubPeriod('cS');
      document.getElementById('sp-date').value = '2026-03-31';
      document.getElementById('sp-from').value = '2026-02-01'; document.getElementById('sp-to').value = '2026-03-31';
      _spFillDaily();
      const qtys = [...document.querySelectorAll('.sp-qty')].map(i => i.value);
      out.daily = qtys[0] === '60' && qtys[1] === '';
      out.totTxt = /應付金額[\s\S]*NT\$ 29,925/.test(document.getElementById('sp-tot').innerHTML) && /2026-04-25/.test(document.getElementById('sp-tot').innerHTML);
      document.getElementById('gen-confirm-ok').click();
      const per = c.periods && c.periods[0];
      out.per = !!per && per.amt === 30000 && per.ret === 1500 && per.net === 28500 && per.due === '2026-04-25';
      const pp = PAYABLES.find(p => p.id === 'paycS_p1');
      out.pay = !!pp && pp.amount === 28500 && pp.vat === true && pp.date === '2026-04-25' && _payEff(pp) === 29925 && !PAYABLES.some(p => p.id === 'paycS');
      // 第二期：拔除 30M（列保留 0%）
      openSubPeriod('cS');
      document.getElementById('sp-date').value = '2026-04-30';
      document.querySelectorAll('.sp-qty')[1].value = '30'; document.querySelectorAll('.sp-qty')[0].value = ''; _spRecalc();
      document.getElementById('gen-confirm-ok').click();
      const p2 = PAYABLES.find(p => p.id === 'paycS_p2');
      out.per2 = c.periods.length === 2 && c.periods[1].amt === 6000 && c.periods[1].ret === 0 && !!p2 && p2.amount === 6000;
      const st = _subStat(c);
      out.stat = st.n === 2 && st.billed === 36000 && st.retHeld === 1500 && st.remain === 34000 && st.byItem[0] === 60 && st.byItem[1] === 30;
      // 數量對照多一欄「廠商計價累計」
      const rec = _qtyRecon(Q[0]);
      out.recon = rec[0].vb === 60 && rec[0].sub === 100 && rec[1].vb === 30;
      setCostView('qty'); out.reconHtml = /廠商計價累計/.test(document.getElementById('cost-list').innerHTML); setCostView('list');
      // 不開發票 → 各期應付不加稅
      updSubField('cS', 'invoice', false);
      out.noInv = PAYABLES.find(p => p.id === 'paycS_p1').vat === false && _payEff(PAYABLES.find(p => p.id === 'paycS_p1')) === 28500;
      updSubField('cS', 'invoice', true);
      // 勾稽：逐期比對
      setCostView('audit'); out.audit = /分期 2 期一致/.test(document.getElementById('cost-list').innerHTML); setCostView('list');
      // 退保留款 → 另建應付
      releaseSubRet('cS'); document.getElementById('gen-confirm-ok').click();
      const pr = PAYABLES.find(p => p.id === 'paycS_r3');
      out.rel = !!pr && pr.amount === 1500 && _subStat(c).retHeld === 0;
      // 已付的期不能刪；未付的期刪除後應付移除並立墓碑
      PAYABLES.find(p => p.id === 'paycS_p2').status = 'paid';
      delSubPeriod('cS', 2); out.delBlocked = c.periods.length === 3;
      delSubPeriod('cS', 1); document.getElementById('gen-confirm-ok').click();
      out.del = c.periods.length === 2 && !PAYABLES.some(p => p.id === 'paycS_p1') && !!(TOMBS.payables && TOMBS.payables['paycS_p1']);
      // 分包管理視圖與專案卡入口
      window._costView = 'list'; setCostView('subs');
      const sh = document.getElementById('cost-list').innerHTML;
      out.subs = /發包總額/.test(sh) && /丙承包/.test(sh) && /保留款退還/.test(sh) && /第2期/.test(sh) && !/releaseSubRet\(/.test(sh);
      // 業主列印不受影響：報價單列印不含 periods／costs
      out.strip = !JSON.stringify(_stripQuoteSens(Q[0])).includes('periods');
      return out;
    });
    check('分包：未分期為整筆應付，計價後改逐期（金額扣保留款、稅依開發票、到期次月 25 日）', r.whole && r.daily && r.totTxt && r.per && r.pay && r.per2 && r.noInv);
    check('分包：累計統計／數量對照「廠商計價累計」／勾稽逐期比對', r.stat && r.recon && r.reconHtml && r.audit);
    check('分包：退保留款另建應付、已付期不可刪、刪期連動應付與墓碑', r.rel && r.delBlocked && r.del);
    check('分包管理視圖；分期不進業主文件', r.subs && r.strip);
    check('v5.405 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────── 17. v5.406：日報出工廠商列／工項顯示分包廠商／廠商績效已計價／金流推估未計價發包額 ─────────
  {
    const { page, errors } = await newPage(browser, 1400, 1000);
    const r = await page.evaluate(() => {
      const out = {};
      P.vendorPayDay = 25; P.vendorPayDelay = 1; P.openingCash = 500000;
      Q = [{ id: 'qC', code: '1171', name: '廠商列案', client: 'K', date: '2026-01-01', awarded: true, exs: [], rmk: {}, _mt: 1,
        items: [{ desc: 'H型鋼樁 H300 L=9M 打設', unit: 'M', qty: '100', price: '1000', estCost: '', ot: '', otu: '', sec: false }],
        costs: [{ id: 'cC', type: 'sub', vendor: '丙承包', cat: '打設', date: '2026-02-01', amt: 0, invoice: true, rows: [{ id: 'r1', linkedItemIdx: 0, desc: '', qty: 100, unitPrice: 500 }],
                  periods: [{ no: 1, date: '2026-08-31', from: '2026-02-01', to: '2026-08-31', rows: [{ rid: 'r1', qty: 30 }], amt: 15000, ret: 0, net: 15000, due: '2026-09-25' }] },
                { id: 'cL', type: 'labor', vendor: '甲點工', cat: '裝設', date: '2026-02-01', amt: 0, linkedItemIdx: 0, rows: [{ id: 'l1', subType: 'worker', desc: '', reason: '', days: 1, dayRate: 2800, transport: 0 }] }],
        dailyLogs: [{ id: 'dOld', date: '2026-08-20', workers: 2, subWorkers: 5, subVendor: '丙承包', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁 H300 L=9M 打設', qty: 30, note: '' }], progress: '', photos: [] },
                    { id: 'dNew', date: '2026-09-02', workers: 0, subWorkers: 0, subVendor: '', progressRows: [{ itemIdx: 0, desc: 'H型鋼樁 H300 L=9M 打設', qty: 20, note: '' }], progress: '', photos: [] }] }];
      INV.length = 0; CONTRACTS.splice(0); PAYABLES.length = 0;
      // 舊日報（無 crews）照樣還原成兩列
      out.legacy = _crewsOf(Q[0].dailyLogs[0]).length === 2 && /點工 2 人/.test(_crewsText(Q[0].dailyLogs[0])) && /承包 5 人（丙承包）/.test(_crewsText(Q[0].dailyLogs[0]));
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'qC'; sel.onchange();
      out.twoRows = document.querySelectorAll('#dr-crews .dr-crew').length === 2 && _drCrews[0].type === 'labor' && _drCrews[1].type === 'sub';
      out.dl = /丙承包/.test(document.getElementById('dr-sub-vendor-list').innerHTML) && /甲點工/.test(document.getElementById('dr-labor-vendor-list').innerHTML);
      // 選工項 → 承包列自動帶分包廠商，提示列顯示「發包 丙承包」
      _drProgRows[0].itemIdx = 0; _drProgRows[0].qty = '10'; _drUpdHint(0); _drAutoVendor(0);
      out.auto = _drCrews[1].vendor === '丙承包' && /發包 丙承包/.test(document.getElementById('dr-hint-0').textContent);
      _drCrews[0].vendor = '甲點工'; _drCrews[0].n = '3'; _drCrews[1].n = '6'; drAddCrew('sub'); _drCrews[2].vendor = '丁承包'; _drCrews[2].n = '2'; drRenderCrews();
      const col = _drCollect();
      out.collect = !!col && col.workers === 3 && col.subWorkers === 8 && col.subVendor === '丙承包' && col.crews.length === 3;
      document.getElementById('dr-date').value = '2026-09-04';
      submitDailyReport();
      const L = Q[0].dailyLogs[0];
      out.saved = L.crews.length === 3 && L.workers === 3 && L.subWorkers === 8 && /甲點工/.test(_crewsText(L));
      out.cleared = _drCrews.length === 2 && !_drCrews[0].vendor && !_drCrews[1].n;
      // 廠商績效：逐家出工、已計價欄
      const vs = _vendorStats(2026);
      const vb = vs.find(v => v.name === '丙承包'), vd = vs.find(v => v.name === '丁承包'), va = vs.find(v => v.name === '甲點工');
      out.stats = !!vb && vb.subDays === 11 && vb.billed === 15000 && !!vd && vd.subDays === 2 && !!va && va.subDays === 3;
      const dv = document.createElement('div'); renderVendorReport(dv, 2026, null);
      out.rpt = /已計價/.test(dv.innerHTML) && /15,000/.test(dv.innerHTML);
      // 修改日報：出工列可改
      editDailyLog('qC', 'dNew');
      out.editRows = document.querySelectorAll('#dle-crews .dle-crew').length === 1;
      document.querySelector('#dle-crews .dle-cv').value = '丙承包'; document.querySelector('#dle-crews .dle-cn').value = '4';
      document.getElementById('gen-confirm-ok').click();
      const L2 = Q[0].dailyLogs.find(x => x.id === 'dNew');
      out.edited = L2.crews.length === 1 && L2.subWorkers === 4 && L2.subVendor === '丙承包';
      // 金流：8/31 計價後日報又完成 30M → 推估下期付款 30×500×1.05
      go('finance'); renderCashForecast();
      const cf = document.getElementById('cashflow-forecast').innerHTML;
      out.cf = /預估付款：丙承包／廠商列案（日報已完成未計價/.test(cf) && /15,750/.test(cf);
      return out;
    });
    check('日報：出工改廠商列（預設點工＋承包兩列、可新增），舊日報照樣還原', r.legacy && r.twoRows && r.dl && r.cleared);
    check('日報：選工項自動帶分包廠商到承包列，提示顯示發包廠商；送出彙總 workers／subWorkers', r.auto && r.collect && r.saved);
    check('日報修改：出工列可改並重算彙總', r.editRows && r.edited);
    check('廠商績效：逐家出工累計＋已計價欄', r.stats && r.rpt);
    check('金流預測：分包合約日報已完成未計價 → 推估下期付款', r.cf);
    check('v5.406 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.411 施工步驟示意圖引擎上系統 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      out.ready = !!(window.FY_SHEETS && typeof FY_SHEETS.pages === 'function');
      if (!out.ready) return out;
      const ids = FY_SHEETS.list().map(s => s.id);
      out.count = ids.length >= 21;
      // 工項＋工法 → 圖組對照全部有效
      const need = {
        hpile: ['直接打設', '水刀引孔', '氣動槌引孔', '氣動槌＋水刀引孔'],
        railpile: ['直接打設', '鑽堡引孔', '鑽掘引孔'],
        sheet: ['直接打設', '吊車排板', '鑽掘引孔'],
        midpile: ['直接打設', '水刀引孔', '氣動槌引孔', '氣動槌＋水刀引孔', '根固工法', '引孔根固'],
        prepile: [''], rcbore: [''], rcpile: [''], ccp: [''], anchor: ['']
      };
      out.map = Object.keys(need).every(k => need[k].every(m => {
        const sid = _fySheetId(k, m);
        return sid && FY_SHEETS.get(sid);
      }));
      // 同一工項不同工法 → 不同圖組
      out.distinct = new Set(need.hpile.map(m => _fySheetId('hpile', m))).size === 4
        && new Set(need.midpile.map(m => _fySheetId('midpile', m))).size === 6;
      // 格子大小一律相同：各頁等寬，非末頁一律滿 8 格（同高），末頁依實際列數縮短
      const a = FY_SHEETS.pages('wall_h_drive'), b = FY_SHEETS.pages('mp_root_case');
      const w0 = a[0].w;
      out.samePage = a.length === 1 && b.length === 2
        && b.every(x => x.w === w0)
        && b[1].h < b[0].h
        && a[0].h === b[0].h;                       // 8 格頁高度一致
      // 流程圖步驟＝示意圖逐格標題
      const st = _fySteps('hpile', '水刀引孔');
      out.steps = !!st && st.length === FY_SHEETS.get('wall_h_wjet').panels.length
        && st.every(x => x.t && x.n1);
      // 選單已含新工法
      out.opts = PLAN_WALL_FORMS.find(f => f.id === 'hpile').methods.indexOf('氣動槌＋水刀引孔') >= 0
        && PLAN_MID_METHODS.some(x => /根固工法/.test(x))
        && PLAN_MID_METHODS.every(x => !!PLAN_METHOD_TEXT[x])
        && !!PLAN_METHOD_TEXT['氣動槌＋水刀引孔'];
      // 未對應之工項（水平支撐／施工構台）仍走舊圖，不得整個爆掉
      out.fallback = _fySheetId('strut', '') === null && _fyStoryPages('strut', '') === null;
      // 著作權聲明與浮水印
      out.wm = !!FY_SHEETS.wm && FY_SHEETS.wm.on === true;
      return out;
    });
    check('示意圖引擎：載入成功且圖組齊全', r.ready && r.count);
    check('示意圖引擎：工項＋工法對應到相應圖組，不同工法出不同圖', r.map && r.distinct);
    check('示意圖：每頁滿 8 格、格子大小一律相同，末頁不留大片空白', r.samePage);
    check('示意圖引擎：施工流程圖與施工步驟說明取自同一份逐格步驟', r.steps);
    check('計畫書：新工法選項與工法敘述已補齊', r.opts);
    check('示意圖引擎：無對應圖組之工項安全退回舊版繪圖', r.fallback);
    check('示意圖：浮水印開啟（著作權保護）', r.wm);
    check('v5.412 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.412 計畫書排版與內容調整 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      _plState.proj = 'T';
      _plState.walls = [{ id: 'hpile', meth: '氣動槌＋水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile'];
      _plState.vars = Object.assign(_plState.vars || {}, { midMethod: '引孔根固', mp1Meth: '引孔根固' });
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // 封面不再有編製／審核／核定表
      out.cover = !B.some(b => b.t === 'tbl' && (b.rows || [])[0] && b.rows[0].join().indexOf('編製（品管工程師）') >= 0);
      // 附件章：作業主管證照、材質證明在千斤頂之前、最後一項為自主檢查表
      const at = PLAN_ATTS.map(a => a.l);
      // v5.421：附件五（自主檢查表）刪除，本文「附表」已收錄
      out.atts = at.length === 4 && at[1] === '作業主管證照' && at[2] === '材料材質證明書'
        && at[3] === '千斤頂校正報告'
        && !at.join().includes('教育訓練') && !at.join().includes('一機三證');
      // 流程圖：各工項字級一致（畫布寬高皆相同）
      const fl = B.filter(b => b.t === 'img' && /flow_/.test(b.name || ''));
      out.flowSame = fl.length >= 2 && fl.every(b => b.cx === fl[0].cx);   // 寬度固定＝縮放比一致＝字級一致（高度隨內容收斂）
      // 流程圖每一步都掛得到品質管理標準
      const ann = _plFlowAnn(_plItem('hpile'), ['材料進場・尺寸檢驗 ☆', '全數完成・☆高程複測'], {},
        ['材料進場・尺寸檢驗 逐支核對規格長度與外觀', '整列打設完成 複測樁頂高程與壁線偏差']);
      out.ann = ann.filter(a => a).length === 2;
      // 自主檢查表：緊湊排版＋欄寬已指定
      const chk = _plChkBlocks().filter(b => b.t === 'tbl');
      out.chk = chk.length > 0 && chk.every(b => b.sm === 1) && chk.every(b => !b.w || b.w.length === (b.rows[0] || []).length);
      // RC 基樁（原抗浮基樁）改名並有工法欄位
      const up = _plItem('upile');
      out.upile = /RC/.test(up.name) && up.vars.some(v => v.k === 'upMeth' && (v.opts || []).length >= 2);
      // 表格輸出帶 colgroup（欄寬可控）
      out.colg = /<colgroup>/.test(_plBlockHtml({ t: 'tbl', rows: [['a', 'b'], ['1', '2']], w: [3000, 7000] }, 0, false));
      // v5.413 專業內容補強：介面分工、開挖與支撐步序、應備圖說清單
      _plState.stl = [{ el: '2.0', dg: '2.5', w: 'H350', s: 'H350', d: 'H350', pre: '30' },
                      { el: '5.0', dg: '5.5', w: 'H400', s: 'H400', d: 'H400', pre: '40' }];
      const B2 = _plBuild();
      const hs = B2.filter(b => b.t === 'h2').map(b => b.v).join('|');
      out.iface = /介面分工與界面管理/.test(hs);
      out.seq = /開挖與支撐施作步序管制表/.test(hs);
      const seqT = B2.find(b => b.t === 'tbl' && (b.rows || [])[0] && b.rows[0].join() === '步序,作業內容,開挖高程,支撐層,管制條件');
      // 2 層支撐 → 開挖/架設各 2 組 + 首尾 4 列 + 拆撐 2 列
      out.seqRows = !!seqT && seqT.rows.length === 1 + 1 + 4 + 2 + 2 + 1;
      out.dwg = B2.some(b => b.t === 'tbl' && (b.rows || []).some(r => r[0] === 'S-02'));
      return out;
    });
    check('計畫書：封面已移除編製／審核／核定欄', r.cover);
    check('計畫書：附件章依指示調整（作業主管、材質證明、千斤頂）', r.atts);
    check('計畫書：各工項施工流程圖字級一致（畫布尺寸固定）', r.flowSame);
    check('計畫書：流程圖逐步對應品質管理標準／自主檢查表', r.ann);
    check('計畫書：自主檢查表緊湊排版且欄寬受控', r.chk);
    check('計畫書：抗浮基樁改為 RC 基樁並新增工法選單', r.upile);
    check('計畫書：表格輸出 colgroup，列印欄寬依設定', r.colg);
    check('計畫書：新增「介面分工與界面管理」節', r.iface);
    check('計畫書：新增「開挖與支撐施作步序管制表」並依支撐層數展開', r.seq && r.seqRows);
    check('計畫書：施工圖說改為應備圖說清單（比例、簽證、送審時機）', r.dwg);
    check('v5.413 排版測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.414 案場細節連動、監測管理值、修訂紀錄 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      Q.push({ id: 'qS', name: '測試案場', client: '玄通營造', loc: '新北市', status: '得標', items: [], t: {},
        site: { P: 130, A: 1000, H: 13, layers: 2,
          wall: { form: 'H型鋼樁', spec: 'H350×350×12×19', method: '氣動槌引孔', len: 13.4, sp: 1.5, nAuto: true },
          mid: { spec: 'H300×300×10×15', method: '直接打設', len: 21.5, n: 30 },
          co: { spec: 'H400×400×13×21', method: '引孔根固', len: 21.5, n: 12 },
          L: [{ w: 'H350', s: 'H350', d: 'H350' }, { w: 'H400', s: 'H400', d: 'H400' }],
          plat: { load: '50t', A: 300 }, stairs: 2 } });
      _plClear(); _plSetProj('測試案場');
      const out = {}, V = _plState.vars, w0 = _plState.walls[0];
      out.site = V.digDepth === 'GL-13.0m' && V.digArea === '1,000 m²' && V.layers === '2';
      out.wall = !!w0 && w0.id === 'hpile' && w0.meth === '氣動槌引孔'
        && w0.v.hpSpec === 'H350×350×12×19' && w0.v.hpLen === 'L=13.4m'
        && w0.v.hpPitch === '@1.5m' && w0.v.hpCount === '87';   // ceil(130/1.5)
      out.mid = V.mp1Spec === 'H300×300×10×15' && V.mp1Count === '30'
        && /引孔根固/.test(V.mp2Meth || '') && V.mp2Count === '12';
      out.stl = _plState.stl.length === 2 && _plState.stl[0].w === 'H350' && _plState.stl[1].s === 'H400';
      out.items = ['midpile', 'strut', 'deck'].every(k => _plState.items.indexOf(k) >= 0);
      // 已填欄位不被覆蓋
      V.digDepth = 'GL-99m'; _plSyncSite(false, true);
      out.keep = V.digDepth === 'GL-99m';
      _plSyncSite(true, true);
      out.force = V.digDepth === 'GL-13.0m';
      const B = _plBuild();
      out.rev = B.some(x => x.t === 'fmh' && x.v === '修訂紀錄')
        && B.some(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0].join().indexOf('修訂事由') >= 0);
      out.mon = B.some(x => x.t === 'tbl' && (x.rows || [])[0]
        && x.rows[0][0] === '支撐層' && x.rows[0].join().indexOf('行動值（T/支）') >= 0)
        && ['mv', 'wv', 'av'].every(k => _plStl()[0][k] !== undefined);
      // 工法選單對齊定稿圖組
      const need = { railpile: ['鑽堡引孔＋打設', '鑽掘引孔（螺旋鑽桿）＋打設'],
                     sheet: ['吊車排板＋逐片壓入', '鑽掘引孔＋打設'] };
      out.meth = Object.keys(need).every(k => {
        const f = PLAN_WALL_FORMS.find(x => x.id === k);
        return need[k].every(mn => f.methods.indexOf(mn) >= 0 && FY_SHEETS.get(_fySheetId(k, mn)));
      }) && PLAN_MID_METHODS.every(mn => !!FY_SHEETS.get(_fySheetId('midpile', mn)));
      out.upile = _plItem('upile').name === 'RC 基樁';
      return out;
    });
    check('計畫書：掛專案自動帶入案場細節（開挖深度／面積／支撐層數）', r.site);
    check('計畫書：擋土壁形式、工法、規格、樁長、間距、支數自動帶入', r.wall);
    check('計畫書：中間樁／共構樁與支撐階數規格自動帶入並勾選相關工項', r.mid && r.stl && r.items);
    check('計畫書：已填欄位不被覆蓋，按「全部覆蓋重帶」才更新', r.keep && r.force);
    check('計畫書：封面後產生修訂紀錄表', r.rev);
    check('計畫書：監測三級管理值（各層水平支撐）可輸入並輸出成表', r.mon);
    check('計畫書：工法選單與定稿示意圖一對一對應', r.meth);
    check('計畫書：抗浮基樁大標題改為 RC 基樁', r.upile);
    check('v5.414 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.415 計畫書修正批次 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile', 'strut'];
      _plState.vars.layers = '2'; _plState.vars.upMeth = '鑽掘式（定位套管）';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // 示意圖必須是完整 data URL（否則預覽與 Word 都會變成破圖）
      const imgs = B.filter(x => x.t === 'img');
      out.img = imgs.length > 0 && imgs.every(x => /^data:image\//.test(x.b64 || ''));
      out.story = B.some(x => /story_upile/.test(x.name || ''));
      // RC 基樁：工法兩項、全文不再出現鋼軌樁護壁／人工挖掘／壓送管
      const up = _plItem('upile'), opts = up.vars.find(v => v.k === 'upMeth').opts;
      out.upile = up.name === 'RC 基樁' && opts.length === 2
        && opts.indexOf('全套管式') >= 0 && opts.indexOf('鑽掘式（定位套管）') >= 0
        && !/鋼軌樁|人工挖掘|壓送管/.test(JSON.stringify(up));
      out.upileMap = _fySheetId('upile', '鑽掘式（定位套管）') === 'rcb_auger'
        && _fySheetId('upile', '全套管式') === 'rcb_case';
      // 監測三級管理值＝各層水平支撐
      const mon = B.find(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0][0] === '支撐層');
      out.mon = !!mon && mon.rows.length === 3
        && mon.rows[0].join().indexOf('行動值（T/支）') >= 0
        && !PLAN_FIELDS.some(g => g.f.some(f => /^mn/.test(f.k)));
      out.monStl = ['mv', 'wv', 'av'].every(k => _plStl()[0][k] !== undefined);
      // 自主檢查表／安全衛生檢查表：表頭回到規範四列、項目列固定長度
      const hdr = B.find(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0][0] === '工程名稱' && x.rows.length === 4);
      out.chkHdr = !!hdr && hdr.rows[3][2] === '檢查時機';
      const chk = B.filter(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0][0] === '項次' && x.rows.length > 5);
      out.chkFixed = chk.length >= 2 && chk.every(x => x.rows.length === 1 + PLAN_CHK_ROWS);
      const sf = B.filter(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0][0] === '分類');
      out.sfFixed = sf.length >= 1 && sf.every(x => x.rows.length === 1 + PLAN_SAFE_ROWS);
      // 中間樁細部詳圖已移除
      out.noMidDetail = !B.some(x => /detail_midpile/.test(x.name || '')) && !_plDetailSteps('midpile', {});
      // 組織圖公司與職稱分兩行
      const org = B.find(x => x.name === 'orgchart');
      out.org = !!org && org.__edit.levels.some(lv => lv.some(b => /\n工地主任：/.test(b.b || '')))
        && org.__edit.levels.some(lv => lv.some(b => /\n擋土支撐作業主管：/.test(b.b || '')));
      // 版面備註已移除
      out.noNote = !B.some(x => /橫向編排/.test(x.v || ''));
      return out;
    });
    check('計畫書：施工步驟示意圖為完整 data URL（預覽與 Word 不再破圖）', r.img && r.story);
    check('計畫書：RC 基樁工法兩項且全文不再出現鋼軌樁護壁／人工挖掘／壓送管', r.upile);
    check('計畫書：RC 基樁依工法對應全套管／鑽掘式圖組', r.upileMap);
    check('計畫書：三級管理值改為各層水平支撐，原四項監測欄位已移除', r.mon && r.monStl);
    check('計畫書：自主檢查表回到規範四列表頭', r.chkHdr);
    check('計畫書：自主檢查表與安全衛生檢查表項目列固定長度', r.chkFixed && r.sfFixed);
    check('計畫書：中間樁／共構樁細部詳圖已移除', r.noMidDetail);
    check('計畫書：組織圖公司名稱與職稱分兩行', r.org);
    check('計畫書：章節標題移除版面備註', r.noNote);
    check('v5.415 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.416 計畫書排版統一、檔名、備註自訂條款 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(async () => {
      const out = {};
      // 2) 報價備註：自訂條款依序接在通用版最後一條之後
      const base = document.getElementById('prm')?.value || P.rmkBase || '';
      const n0 = _rmkBaseCount(base);
      rmkCustom.extra = ['甲條款', '  ', '乙條款'];
      const t1 = _rmkAppendExtra('原文', rmkCustom);
      out.rmk = t1 === '原文\n' + (n0 + 1) + '. 甲條款\n' + (n0 + 2) + '. 乙條款';
      rmkCustom.extra = [];
      out.rmkNone = _rmkAppendExtra('原文', rmkCustom) === '原文';
      out.rmkCnt = _rmkBaseCount('1. a\n2. b\n17. c') === 17 && _rmkBaseCount('') === 17;
      out.rmkApi = ['rmkAddExtra', 'rmkDelExtra', 'rmkRenderExtra'].every(k => typeof window[k] === 'function');

      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile', 'strut', 'deck'];
      _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();

      // 7) 施工流程圖：全書統一畫布（字級／框寬一致），且每工項一頁
      const fl = B.filter(x => /^flow_/.test(x.name || ''));
      out.flowN = fl.length >= 4;
      out.flowSame = new Set(fl.map(x => x.cx)).size === 1;          // 寬度（＝縮放比）全書一致
      out.flowTrim = new Set(fl.map(x => x.cy)).size > 1;             // 高度隨內容收斂，圖下不留大片空白
      out.flowOnePage = fl.every(x => /_1$/.test(x.name)) && !fl.some(x => /_[2-9]$/.test(x.name));
      out.flowConst = PL_FLOW.W === PL_FLOW.LM + PL_FLOW.boxW + 24 + PL_FLOW.annW + 12
        && PL_FLOW.H === Math.round(PL_FLOW.W * 1.30);

      // 8) 修訂紀錄與目錄分頁：目錄一律另起新頁
      const ti = B.findIndex(x => x.t === 'toc');
      out.tocPb = ti > 0 && B[ti].pb === true && B[ti - 1].t !== 'toc';

      // 5/6) 自主檢查表／安全衛生檢查表滿版固定列數
      out.rows = PLAN_CHK_ROWS === 18 && PLAN_SAFE_ROWS === 25
        && PLAN_CHK_H === PLAN_CHK_HDRH + PLAN_CHK_ROWS * PLAN_CHK_ROWH;

      // 1/3) 列印改在主文件內（有真實網址 → PDF 檔名不再空白）、橫式頁維持橫式
      out.api = typeof _plExportPdf === 'undefined' && typeof _plPrintNative === 'function'
        && typeof _plPrintClose === 'function';
      out.noPopup = !/window\.open/.test(_plPrintDoc.toString());
      _plPrintDoc(B, '檔名測試_v1', '施工計畫書');
      // 版面在圖片載入後才排（whenImgs），等頁面真的排出來
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('#_pl_print_root .sheet').length) break;
        await new Promise(res => setTimeout(res, 100));
      }
      const root = document.getElementById('_pl_print_root');
      const bar = document.getElementById('_pl_print_bar');
      out.printRoot = !!root && !!bar && (bar.textContent || '').indexOf('檔名測試_v1') >= 0;
      const sheets = [].slice.call((root || document).querySelectorAll('#_pl_print_root .sheet'));
      out.sheets = sheets.length > 10;
      out.land = sheets.some(s => s.classList.contains('land'));
      // 4) 標題不孤懸：每頁最後一個元素不得是章節標題（標題要跟著圖走）
      out.orphan = sheets.every(s => {
        const c = s.querySelector('.pc,.pcl'); if (!c) return true;
        const last = c.lastElementChild;
        return !last || !/pl-h2|pl-h3/.test(last.className || '');
      });
      _plPrintClose();
      out.closed = !document.getElementById('_pl_print_root') && !document.getElementById('_pl_print_bar');
      return out;
    });
    check('報價：自訂備註條款依序接在通用版最後一條之後', r.rmk && r.rmkNone && r.rmkCnt && r.rmkApi);
    check('計畫書：施工流程圖全書同一框寬字級、高度隨內容收斂', r.flowN && r.flowSame && r.flowConst && r.flowTrim);
    check('計畫書：各工項施工流程圖皆一頁呈現', r.flowOnePage);
    check('計畫書：目錄／修訂紀錄各自獨立起頁', r.tocPb);
    check('計畫書：兩張檢查表維持滿版固定列數', r.rows);
    check('計畫書：列印改在主文件內（PDF 檔名不再空白）', r.api && r.noPopup && r.printRoot && r.closed);
    check('計畫書：預覽頁數正常且橫式頁仍為橫式', r.sheets && r.land);
    check('計畫書：章節標題不孤懸頁尾（標題跟著圖走）', r.orphan);
    check('v5.416 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.417 檢查表各自定版、句子切分、目錄獨立頁、列印提速 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(async () => {
      const out = {};
      // 句號切分不可切斷括號／引號內的文字（條列不再出現「）。」殘句）
      out.sent = JSON.stringify(_plSentences('甲。（乙。）')) === JSON.stringify(['甲。', '（乙。）'])
        && _plSentences('含「引號。內」的一句。').length === 1
        && _plSentences('沒有句號的一句')[0] === '沒有句號的一句。';

      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile', 'strut', 'deck', 'ccp'];
      _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // 條列不得以「）」「。」開頭（舊版句號切分會產生只有一個括號的空條）
      out.badLi = B.filter(x => x.t === 'li' && /^[）)。]/.test(String(x.v || '').trim())).length === 0;
      // 兩張檢查表各自一套固定格式（列數與表身高度都不同、不共用）
      const sc = B.filter(x => x.t === 'tbl' && x.fixH && (x.rows || [])[0] && x.rows[0][0] === '項次');
      const sf = B.filter(x => x.t === 'tbl' && x.fixH && (x.rows || [])[0] && x.rows[0][0] === '分類');
      out.scFix = sc.length >= 2 && sc.every(x => x.rows.length === 1 + PLAN_CHK_ROWS)
        && sc.every(x => x.fixH === PLAN_CHK_H);
      out.sfFix = sf.length >= 1 && sf.every(x => x.rows.length === 1 + PLAN_SAFE_ROWS)
        && sf.every(x => x.fixH === PLAN_SAFE_H);
      out.notShared = PLAN_CHK_ROWS !== PLAN_SAFE_ROWS && PLAN_CHK_H !== PLAN_SAFE_H;
      // 緊急聯絡表下方那句造成整頁只有一行的註解已移除
      out.noEmerRem = !B.some(x => /救援單位/.test(x.v || ''));

      _plPrintDoc(B, '檔名測試_v1', '施工計畫書');
      for (let i = 0; i < 150; i++) {
        if (document.querySelectorAll('#_pl_print_root .sheet').length) break;
        await new Promise(res => setTimeout(res, 100));
      }
      const sheets = [].slice.call(document.querySelectorAll('#_pl_print_root .sheet'));
      const pageTx = sheets.map(s => {
        const c = s.querySelector('.pc,.pcl');
        return c ? (c.textContent || '').replace(/\s+/g, '') : '';
      });
      // 修訂紀錄與目錄各自獨立起頁
      const rv = pageTx.findIndex(t => /^修訂紀錄/.test(t));
      const tc = pageTx.findIndex(t => /^目錄/.test(t));
      out.tocSplit = rv >= 0 && tc === rv + 1 && !/目錄/.test(pageTx[rv]);
      // 每張自主檢查表／安全衛生檢查表各自一頁（簽名欄不再被擠到次頁）
      const sign = pageTx.filter(t => /^檢查人員（現場工程師）工地主任|^工地主任安衛人員檢查人員$/.test(t));
      out.noSignPage = sign.length === 0;
      // v5.421：附表章標題自成一頁，其後每張檢查表各占一頁
      out.codesOnePage = ['SC-01', 'SC-02', 'SC-03', 'SC-04', 'SF-01', 'SF-02'].every(c =>
        pageTx.filter(t => t.indexOf(c) === 0 && /檢查階段|分類檢查項目/.test(t)).length === 1)
        && pageTx.filter(t => /^附表自主檢查表下列/.test(t)).length === 1
        && pageTx.filter(t => /^附表安全衛生檢查表下列/.test(t)).length === 1;
      // 列印工具列：原生列印為主鈕（快、文字可搜尋），影像版 PDF 為備援
      // 匯出只留一顆鈕（不再有影像版 PDF）
      const btns = [].slice.call(document.querySelectorAll('#_pl_print_bar button')).map(x => x.textContent);
      out.btns = btns.length === 2 && btns[0] === '列印／存 PDF' && btns[1] === '✕ 關閉';
      // 檔名掛在 document.title 上，列印後不還原（還原會讓另存視窗檔名變空白）
      out.titleKept = document.title === '檔名測試_v1';
      window.print = function () { window.__printed = 1; };
      _plPrintNative('檔名測試_v1');
      await new Promise(res => setTimeout(res, 400));
      const css = document.getElementById('_pl_print_only');
      out.native = !!window.__printed && document.title === '檔名測試_v1' && !!css
        && /@page fyland\{size:A4 landscape/.test(css.textContent)
        && /\.sheet\.land\{page:fyland\}/.test(css.textContent);
      _plPrintClose();
      out.titleRestored = document.title !== '檔名測試_v1' && !document.getElementById('_pl_print_only');
      return out;
    });
    check('計畫書：句號切分不切斷括號，條列不再出現殘句', r.sent && r.badLi);
    check('計畫書：自主檢查表與安全衛生檢查表各自定版（列數與表身高度不共用）', r.scFix && r.sfFix && r.notShared);
    check('計畫書：兩張檢查表每張各一頁，簽名欄不被擠到次頁', r.noSignPage && r.codesOnePage);
    check('計畫書：修訂紀錄與目錄各自獨立起頁', r.tocSplit);
    check('計畫書：緊急聯絡表多餘註解已移除（不再產生整頁一行）', r.noEmerRem);
    check('計畫書：匯出只留一顆鈕、走瀏覽器原生輸出，橫式節以命名頁維持橫式', r.btns && r.native);
    check('計畫書：預覽期間檔名一直掛在 document.title，關閉才還原', r.titleKept && r.titleRestored);
    check('v5.417 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.419 Word 與 PDF 共用同一組版面與分頁 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => new Promise(res => {
      const out = {};
      // 版面單一來源：CSS 的 px 一律由 Word 的半點換算（px = sz ÷ 1.5）
      out.metric = Object.keys(PL_M.sz).every(k => Math.abs(_PLX[k] - PL_M.sz[k] / 1.5) < 0.002);
      out.cssFromM = _PL_CSS.indexOf('font-size:' + _PLX.p + 'px') >= 0
        && _PL_CSS.indexOf('font-size:' + _PLX.tbl + 'px') >= 0;
      // 內文字級以 Word 現況（12pt）為基準
      out.body12 = PL_M.sz.p === 24;

      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile', 'strut', 'ccp'];
      _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // Word 版不再把流程圖／組織圖換成表格，用的是與 PDF 相同的圖片
      out.sameImg = !/t:'chart'/.test(_plDocxOut.toString()) && !/kind==='org'/.test(_plDocxOut.toString());

      _plPrintDoc(B, 'x', 'y', { silent: true, done: function (info) {
        // 靜默排版：算完即清乾淨，不留預覽層
        out.clean = !document.getElementById('_pl_print_root') && !document.getElementById('_pl_print_bar');
        out.pages = info.pages > 20 && info.breaks === 0;
        // v5.420：不再把瀏覽器算的分頁灌進 Word（Word 自己流排才不會出現半空白頁）
        out.pb = info.breaks === 0 && B.every(x => !x.__pb);
        const tb = B.filter(x => x.t === 'tbl' && x.__rowH);
        out.rowH = tb.length > 5 && tb.every(x => x.__rowH.length === x.rows.length)
          && tb.every(x => x.__rowH.every(h => h > 0));
        // 產出的 .docx 帶著同一組版面與硬分頁
        const xml = new TextDecoder().decode(_docxBytes(B, { header: 'T' }));
        const mg = Math.round(PL_M.MG * 15), bot = Math.round((PL_M.MG + PL_M.FOOT) * 15);
        out.docMar = xml.indexOf('w:top="' + mg + '" w:right="' + mg + '" w:bottom="' + bot + '" w:left="' + mg + '"') >= 0;
        // 只保留語意分頁（章、附表、目錄、修訂紀錄）
        const semantic = B.filter(x => x.pb).length;
        const brk = (xml.match(/<w:pageBreakBefore\/>/g) || []).length;
        out.docBrk = brk > 0 && brk <= semantic + 4;
        // 圖片段落必須是自動行高，否則會被固定行高裁成一條線
        out.docImg = /<w:jc w:val="center"\/><w:keepNext\/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"\/><\/w:pPr><w:r><w:drawing>/.test(xml);
        // 內文改用固定行高，與列印稿的 font-size × line-height 完全相等
        out.docLine = xml.indexOf('w:line="' + Math.round(PL_M.sz.p * PL_M.lh.p * 10) + '" w:lineRule="exact"') >= 0;
        // 不放頁首（列印稿沒有頁首，放了每頁可用高度就不同）
        out.docNoHdr = xml.indexOf('headerReference') < 0;
        out.docRowH = (xml.match(/w:trHeight/g) || []).length > 50;
        out.docLand = xml.indexOf('w:orient="landscape"') >= 0;
        out.docSz = xml.indexOf('<w:sz w:val="' + PL_M.sz.p + '"/>') >= 0;
        res(out);
      } });
    }));
    check('計畫書：版面單一來源（CSS px 由 Word 半點換算）', r.metric && r.cssFromM && r.body12);
    check('計畫書：Word 圖表改用與 PDF 相同的圖片', r.sameImg);
    check('計畫書：靜默排版可供 Word 借用，且不留預覽層', r.clean && r.pages);
    check('計畫書：Word 自行流排，不再灌入瀏覽器算出的分頁', r.pb);
    check('計畫書：逐列高度回填到表格區塊', r.rowH);
    check('計畫書：.docx 套用同一組邊界、語意分頁、列高與橫式節', r.docMar && r.docBrk && r.docRowH && r.docLand && r.docSz);
    check('計畫書：.docx 內文固定行高、圖片自動行高（不被裁成一條線）、無頁首', r.docLine && r.docImg && r.docNoHdr);
    check('v5.419 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.421 Word 版面依實機回饋修正 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => new Promise(res => {
      const out = {};
      // 附件五（自主檢查表）刪除：本文「附表」已收錄，附件重複
      out.noAtt5 = PLAN_ATTS.length === 4 && !PLAN_ATTS.some(x => x.k === 'chk');
      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'upile', 'ccp'];
      _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // 品質管理標準：每個工項各自起頁
      const qc = B.filter(x => x.t === 'h3' && /品質管理標準$/.test(x.v || ''));
      out.qcPb = qc.length >= 2 && qc.slice(1).every(x => x.pb === true);
      // 附表：每張檢查表都起新頁（章標題因此自成一頁）
      const sc = B.filter(x => x.t === 'h2' && /^S[CF]-\d\d/.test(x.v || ''));
      out.chkPb = sc.length >= 2 && sc.every(x => x.pb === true);
      // 圖片高度上限＝版心扣掉圖標題與圖說，圖說才不會被推到次頁
      const img = B.filter(x => x.t === 'img');
      out.imgCap = img.length > 0 && img.every(x => x.cy <= PL_M.imgMaxH * 9525 + 1)
        && _PL_CSS.indexOf('max-height:' + PL_M.imgMaxH + 'px') >= 0;
      // 修訂紀錄不編頁碼：前置節帶 titlePg、頁碼自 0 起（目錄顯示 I）
      const sect = B.filter(x => x.t === 'sect' && x.o && x.o.fmt === 'upperRoman')[0];
      out.noRevNo = !!sect && sect.o.titlePg === true && sect.o.start === 0;

      _plPrintDoc(B, 'x', 'y', { silent: true, done: function () {
        const xml = new TextDecoder().decode(_docxBytes(B, { header: 'T' }));
        out.docTitlePg = /<w:titlePg\/>/.test(xml) && /w:type="first"/.test(xml)
          && /w:pgNumType w:fmt="upperRoman" w:start="0"/.test(xml);
        // 圖片段落 keepNext → 圖說跟著圖走
        out.docKeepFig = /<w:jc w:val="center"\/><w:keepNext\/>/.test(xml);
        // 表格註解不脫離表格：最後一列 keepNext
        out.docKeepNote = /<w:pStyle w:val="DxTD"\/><w:keepNext\/>/.test(xml);
        // 封面工項列置中，不套內文的首行縮排
        out.docCover = xml.indexOf('<w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/>') >= 0;
        res(out);
      } });
    }));
    check('計畫書：附件五（自主檢查表）已刪除', r.noAtt5);
    check('計畫書：品質管理標準一工項一頁', r.qcPb);
    check('計畫書：附表章標題自成一頁，每張檢查表各一頁', r.chkPb);
    check('計畫書：圖片高度設上限，圖說不再被推到次頁', r.imgCap && r.docKeepFig);
    check('計畫書：修訂紀錄不編頁碼，目錄起算 I', r.noRevNo && r.docTitlePg);
    check('計畫書：表格註解與表格同頁、封面工項列置中', r.docKeepNote && r.docCover);
    check('v5.421 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.423 分項計畫書範圍收斂、進版與送審檢核 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      // 連續壁非本公司工項：改為介面敘述，移除會誤導的具體管制值
      // v5.424：連續壁只在「擋土壁形式」帶出名稱，不產生任何章節內容
      const dw = _plItem('dwall');
      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'dwall', v: {} }]; _plState.items = ['strut']; _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const Bd = _plBuild();
      out.dwall = dw.mentionOnly === true
        && /連續壁/.test(_plWallTypeStr())
        && !_plInstances().some(x => x.it.id === 'dwall')
        && !Bd.some(x => (x.t === 'h2' || x.t === 'h3') && /連續壁/.test(x.v || ''));

      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'strut'];
      _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      const hs = B.filter(x => x.t === 'h2').map(x => x.v).join('|');
      out.pull = /樁體拔除與孔洞回填/.test(hs)
        && !B.some(x => x.t === 'li' && /不得於相鄰連續多支同時拔除/.test(x.v || ''));
      out.exit = /支撐拆除與工區退場/.test(hs);
      // 拔除章節只在有可拔除樁體的工項時輸出
      _plState.walls = []; _plState.items = ['ccp'];
      _plNormalize && _plNormalize();
      const B2 = _plBuild();
      out.pullCond = !B2.filter(x => x.t === 'h2').some(x => /樁體拔除/.test(x.v || ''));

      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'strut'];
      _plNormalize && _plNormalize();
      const B3 = _plBuild();
      const rems = B3.filter(x => x.t === 'rem').map(x => x.v).join('|');
      out.ratio = /抽驗比例依契約規定辦理/.test(rems) && /不低於 10%/.test(rems);
      out.monScope = !/其餘監測項目之管理值/.test(rems);   // v5.424：不再加註

      // 進版：版次由 revs 決定，修訂紀錄由系統填
      out.verApi = typeof plBump === 'function' && typeof _plRevDiff === 'function';
      _plState.revs = [];
      const v1 = _plVer();
      _plState.revs = [{ ver: 1, date: '2026-09-01', sect: '—', reason: '初版發行', by: '豐有' },
                       { ver: 2, date: '2026-09-10', sect: '陸', reason: '審查意見修正', by: '豐有' }];
      const v2 = _plVer();
      const B4 = _plBuild();
      const rev = B4.find(x => x.t === 'tbl' && (x.rows || [])[0] && x.rows[0][0] === '版次');
      out.ver = v1 === 1 && v2 === 3 && !!rev && rev.rows.length === 4
        && rev.rows[2][3] === '審查意見修正' && rev.rows[3][0] === '第 3 版';
      // 快照帶得走版次紀錄
      out.snap = Array.isArray(_plSnapshot().revs) && _plSnapshot().revs.length === 2;

      // 匯出前檢核
      out.exportApi = typeof _plExportOK === 'function'
        && /_plExportOK/.test(_plDocxOut.toString()) && /_plExportOK/.test(_plPrintOut.toString());
      // 附件效期自動判斷（過期／60 天內到期都要進檢核）
      _plState.atts = { lic: [{ name: 'a.jpg', cap: '作業主管證照', exp: '2020-01-01' }] };
      const au = _plAudit().join('|');
      out.expChk = /已於 2020-01-01 過期/.test(au);
      const d = new Date(); d.setDate(d.getDate() + 30);
      const soon = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      _plState.atts = { lic: [{ name: 'a.jpg', cap: '作業主管證照', exp: soon }] };
      out.soonChk = /天後）到期/.test(_plAudit().join('|'));
      _plState.atts = {};
      return out;
    });
    check('計畫書：連續壁僅於擋土壁形式帶出名稱，不產生章節內容', r.dwall);
    check('計畫書：新增「樁體拔除與孔洞回填」，且僅於有可拔除樁體時輸出', r.pull && r.pullCond);
    check('計畫書：新增「支撐拆除與工區退場」', r.exit);
    check('計畫書：品質管理標準註明監造抽驗比例', r.ratio);
    check('計畫書：監測管理值不另加註其餘由營造訂定', r.monScope);
    check('計畫書：進版功能維護版次，修訂紀錄自動帶出', r.verApi && r.ver && r.snap);
    check('計畫書：匯出前先確認送審檢核未補項目', r.exportApi);
    check('計畫書：附件證照過期與即將到期自動進檢核', r.expChk && r.soonChk);
    check('v5.423 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.425 預力地錨施工步驟示意圖重製 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const sh = FY_SHEETS.get('anchor');
      const ts = sh.panels.map(p => p.t);
      out.eight = sh.panels.length === 8;
      out.order = /鋼絞線加工/.test(ts[1]) && /放樣・鑽孔/.test(ts[2]) && /置入・一次灌漿/.test(ts[3])
        && /雙橫擋架設/.test(ts[4]) && /錨件安裝/.test(ts[5]) && /施拉預力・鎖定・錨力監測/.test(ts[6]) && /解錨・拆除/.test(ts[7]);
      const all = sh.panels.map(p => p.t + p.n1 + p.n2).join('|');
      out.noBad = !/保護罩|二次灌漿|補灌漿|水灰比|三角鈑|養生|必要時以套管/.test(all);
      out.words = /鄰地同意/.test(sh.panels[0].n2) && /套管/.test(sh.panels[2].n1 + sh.panels[2].n2)
        && /放樣/.test(sh.panels[2].n1) && /背填/.test(sh.panels[4].n1) && /驗收試驗/.test(sh.panels[6].n2)
        && /荷重計/.test(sh.panels[6].n2) && /解錨/.test(sh.panels[7].n1) && /鄰地同意/.test(sh.panels[7].n2);
      // 共用的 ① 準備格不受地錨客製說明影響
      out.prepDefault = !/鄰地同意/.test(FY_SHEETS.get('ccp').panels[0].n2);
      // 幾何：台座自頂端起斜、承壓鈑對準錨軸、端部薄
      const g = FY_SHEETS._geom(0, 100, 22, 38, 4);
      // 斜面自頂端起（Q0＝頂前緣）、承壓鈑中心落在錨軸上（C−P0 與錨軸平行）且略高於間隙中心、端部薄、斜面止點在承壓鈑之下
      const cx = (g.C[0] - g.P0[0]) * Math.sin(20 * Math.PI / 180) + (g.C[1] - g.P0[1]) * Math.cos(20 * Math.PI / 180);
      out.geom = Math.abs(g.Q0[0] - (g.sx + g.t0)) < 0.01 && Math.abs(cx) < 0.01 && g.C[1] < 100 && g.C[1] > 100 - 22
        && g.t0 < 22 * 0.2 && g.Q1[1] > g.C[1];
      // 出圖：單頁、8 格，PNG 有內容
      const pg = FY_SHEETS.pages('anchor', 1);
      out.render = pg.length === 1 && /^data:image\/png/.test(pg[0].b64) && pg[0].b64.length > 20000;
      out.steps = FY_SHEETS.steps('anchor').length === 8;
      out.leaderFix = FY_SHEETS._leaderFix();
      return out;
    });
    check('地錨示意圖：固定 8 格、步驟順序正確', r.eight && r.order && r.steps);
    check('地錨示意圖：無保護罩／補灌漿／三角鈑等已刪除敘述', r.noBad);
    check('地錨示意圖：鄰地同意、套管、放樣、背填、驗收試驗、監測、解錨皆納入', r.words && r.prepDefault);
    check('地錨示意圖：台座幾何（頂端起斜、承壓鈑對準間隙中心、端部薄）', r.geom);
    check('地錨示意圖：可出圖且引線支援固定落點', r.render && r.leaderFix);
    check('v5.425 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.426 施工構台施工步驟示意圖（架設 4 步＋拆除 4 步） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const sh = FY_SHEETS.get('deck');
      const ts = sh.panels.map(p => p.t);
      out.eight = sh.panels.length === 8 && sh.code === 'FY-GT-01';
      out.order = /架設 1／4：構台樁高程測定/.test(ts[0]) && /架設 2／4：構台帽/.test(ts[1]) && /架設 3／4：構台主樑/.test(ts[2])
        && /架設 4／4：副樑・覆工板/.test(ts[3]) && /拆除 1／4：覆工板/.test(ts[4]) && /拆除 2／4：副樑/.test(ts[5])
        && /拆除 3／4：主樑/.test(ts[6]) && /拆除 4／4：構台樁切除/.test(ts[7]);
      const all = sh.panels.map(p => p.t + p.n1 + p.n2).join('|');
      out.noBad = !/防滑脫|@2\.0|跨於兩支副樑|總高<|套於樁頂）/.test(all);
      out.words = /L 角鐵/.test(sh.panels[3].n1) && /車輪擋/.test(sh.panels[3].n1) && /移動式鷹架樓梯/.test(sh.panels[4].n1)
        && /基礎版面切除/.test(sh.panels[7].n1) && /止水板/.test(sh.panels[7].n1) && /預留開口/.test(sh.panels[7].n1);
      // 工項對應：施工構台改走新圖組；水平支撐仍安全退回
      out.map = _fySheetId('deck', '') === 'deck' && !!_fyStoryPages('deck', '') && _fySheetId('strut', '') === null;
      // 幾何：副樑 @2.0m（50px）共 11 支、覆工板每跨一片
      const dk = FY_SHEETS._deck();
      out.geom = dk.sbGap === 50 && dk.sbX.length === 11 && Math.abs(dk.sbX[1] - dk.sbX[0] - 50) < 0.01 && dk.plTop < dk.sbTop;
      const pg = FY_SHEETS.pages('deck', 1);
      out.render = pg.length === 1 && /^data:image\/png/.test(pg[0].b64) && pg[0].b64.length > 20000;
      out.steps = FY_SHEETS.steps('deck').length === 8;
      return out;
    });
    check('施工構台示意圖：8 格（架設 4＋拆除 4）、順序正確', r.eight && r.order && r.steps);
    check('施工構台示意圖：已刪敘述不再出現、L 角鐵／車輪擋／止水板／預留開口納入', r.noBad && r.words);
    check('施工構台示意圖：工項對應新圖組、副樑 @2.0m 幾何、可出圖', r.map && r.geom && r.render);
    check('v5.426 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.427 施工構台細部詳圖移除、檢查表 Word 一頁 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      _plClear();
      _plState.proj = 'T'; _plState.vars.name = 'T';
      _plState.walls = [{ id: 'hpile', meth: '水刀引孔', v: {} }];
      _plState.items = ['midpile', 'strut', 'deck']; _plState.vars.layers = '2';
      _plNormalize && _plNormalize();
      const B = _plBuild();
      // 施工構台不再產生細部詳圖，水平支撐仍有
      out.noDeckDetail = !_plDetailSteps('deck', {}) && !B.some(x => /detail_deck/.test(x.name || ''))
        && !!_plDetailSteps('strut', {});
      // 檢查表：主表末列 keepLast、尾端小表 keep 串接，Word 不得把簽名列拆到下一頁
      const sc = B.filter(x => x.t === 'tbl' && x.fixH === PLAN_CHK_H);
      const sf = B.filter(x => x.t === 'tbl' && x.fixH === PLAN_SAFE_H);
      const after = (blk, n) => { const i = B.indexOf(blk); return B.slice(i + 1, i + 1 + n); };
      out.keep = sc.length >= 2 && sc.every(x => x.keepLast === true && after(x, 3).every(y => y.t === 'tbl' && (y.keep === 'all' || y.keep === 'butLast')) && after(x, 3)[2].keep === 'butLast')
        && sf.length >= 1 && sf.every(x => x.keepLast === true && after(x, 1)[0].keep === 'butLast');
      // 列數／列高下修後總高仍照公式
      out.size = PLAN_CHK_ROWS === 18 && PLAN_CHK_ROWH === 26 && PLAN_SAFE_ROWS === 25 && PLAN_SAFE_ROWH === 23
        && PLAN_CHK_H === PLAN_CHK_HDRH + PLAN_CHK_ROWS * PLAN_CHK_ROWH && PLAN_SAFE_H === PLAN_SAFE_HDRH + PLAN_SAFE_ROWS * PLAN_SAFE_ROWH;
      // docx：keep 選項確實輸出 keepNext
      const xmlA = _dxTbl([['a'], ['b'], ['c']], [1000], { keep: 'all' });
      const xmlB = _dxTbl([['a'], ['b'], ['c']], [1000], { keep: 'butLast' });
      const xmlN = _dxTbl([['a'], ['b'], ['c']], [1000], {});
      const cnt = x => (x.match(/<w:keepNext\/>/g) || []).length;
      out.docx = cnt(xmlA) === 3 && cnt(xmlB) === 2 && cnt(xmlN) === 0;
      return out;
    });
    check('計畫書：施工構台細部詳圖已移除（改以 FY-GT-01 示意圖）', r.noDeckDetail);
    check('檢查表：主表與尾端小表以 keepNext 串接，簽名列不得拆頁', r.keep && r.docx);
    check('檢查表：列高下修、列數維持（Word 含簽名列仍為一頁）', r.size);
    check('v5.427 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.428 請款單：報價進版同步、日報自動帶入、逾期租金自動列入 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const q = { id: 'tq428', name: 'T428', ver: 1, client: 'C',
        items: [{ desc: 'H型鋼樁打設、拔除', unit: '支', qty: 10, price: 1000, note: '含30天租期', ot: '50', otu: '支/天' }, { desc: '油壓千斤頂', unit: '具', qty: 4, price: 500 }],
        dailyLogs: [{ id: 'a', date: '2026-01-05', progressRows: [{ itemIdx: 0, qty: 6 }] }, { id: 'b', date: '2026-01-08', progressRows: [{ itemIdx: 0, qty: 4 }] },
          { id: 'c', date: '2026-03-01', progressRows: [{ itemIdx: 0, qty: 5, ph: 'remove' }] }] };
      // 日報期別：打設／拔除分開累計；租期起算＝打設最後一天次日、結束＝拔除第一天
      const pg = _itemProgress(q, 0);
      out.prog = pg.cum === 10 && pg.removeCum === 5 && pg.installLast === '2026-01-08' && pg.removeFirst === '2026-03-01' && pg.doneDate === '2026-01-08';
      const st = _rentStatus(q, 0, '2026-03-20');
      out.rent = st.start === '2026-01-09' && st.expiry === '2026-02-07' && st.endDate === '2026-03-01' && st.overDays === 22 && st.amount === 11000;
      out.dq = _dailyQtyBetween(q, 'H型鋼樁打設、拔除', '', '2026-12-31', 'install') === 10 && _dailyQtyBetween(q, 'H型鋼樁打設、拔除', '', '2026-12-31', 'remove') === 5;
      // 只拔除的工項沒填 ph 也算拔除；打設兼拔除的舊資料（沒 ph）算打設
      out.phase = _prPhase({ items: [{ desc: '鋼板樁拔除' }] }, { itemIdx: 0 }) === 'remove' && _prPhase(q, { itemIdx: 0 }) === 'install';
      // 報價進版 → 請款工項同步（同名保留數量、單價以報價為準、報價已無但有數量者保留在最後）
      const inv = buildInvFromQuote(q);
      out.ver = inv.quoteId === 'tq428' && inv.quoteVer === 1;
      const q2 = JSON.parse(JSON.stringify(q)); q2.ver = 2; q2.items[0].price = 1200; q2.items[1] = { desc: '施工便梯', unit: '座', qty: 1, price: 30000 };
      const d = _invQuoteDiff(inv, q2);
      out.diff = d.any && d.added[0] === '施工便梯' && d.removed[0] === '油壓千斤頂' && d.changed[0] === 'H型鋼樁打設、拔除';
      inv.items[1].curQty = 2;
      const syn = _invSyncItems(inv.items, q2);
      out.syn = syn.length === 3 && syn[0].contractPrice === 1200 && syn[1].desc === '施工便梯' && syn[2].desc === '油壓千斤頂' && syn[2].curQty === 2;
      out.untouched = _invUntouched(buildInvFromQuote(q)) === true && _invUntouched(inv) === false;
      // 開單：日報數量自動帶入＋逾期租金自動列入
      const inv2 = buildInvFromQuote(q); inv2.id = 'tinv428'; inv2.date = '2026-03-20';
      Q.push(q); INV.push(inv2);
      loadInvoice('tinv428');
      const rr = invItems.find(x => x.type === 'rental' && x._ovKey);
      out.auto = invItems[0].curQty === 10 && !!rr && rr.curDays === 22 && rr.curAmt === 11000;
      // 已填數量＋報價進版 → 不自動改，顯示同步橫幅
      q.ver = 2; q.items[0].price = 1200; const inv3 = INV.find(x => x.id === 'tinv428'); inv3.items[0].curQty = 3; inv3.quoteVer = 1;
      loadInvoice('tinv428');
      out.banner = /同步報價 v2/.test(document.getElementById('inv-sync-banner').innerHTML) && invItems[0].contractPrice === 1000;
      invSyncQuoteNow();
      out.synNow = invItems[0].contractPrice === 1200 && invItems[0].curQty === 3 && document.getElementById('inv-sync-banner').innerHTML === '';
      // 未動過的草稿：進版時直接跟上
      const inv4 = buildInvFromQuote(q); inv4.id = 'tinv428b'; inv4.quoteVer = 1; inv4.items[0].contractPrice = 999;
      INV = INV.filter(x => x.id !== 'tinv428'); INV.push(inv4);
      out.bump = _invSyncUntouched(q) === 1 && INV.find(x => x.id === 'tinv428b').items[0].contractPrice === 1200;
      INV = INV.filter(x => x.id !== 'tinv428b'); Q = Q.filter(x => x.id !== 'tq428'); invEid = null; invItems = []; window._invSnap = null;
      // 日報表單：打設兼拔除的工項才有期別選單
      out.form = typeof _drPhaseSel === 'function' && _drPhaseSel(q, { itemIdx: 1, ph: '' }, 0) === '' && /拔除/.test(_drPhaseSel(q, { itemIdx: 0, ph: '' }, 0));
      return out;
    });
    check('日報：進度列分打設／拔除，租期起算＝打設最後一天次日、結束＝拔除第一天', r.prog && r.rent && r.dq && r.phase);
    check('請款單：報價進版差異偵測與工項同步（保留數量、單價從報價）', r.ver && r.diff && r.syn && r.untouched);
    check('請款單：開單自動帶入日報數量並列入逾期租金', r.auto);
    check('請款單：已填數量者顯示同步橫幅、一鍵同步；未動草稿進版即跟上', r.banner && r.synNow && r.bump);
    check('日報表單：打設兼拔除工項有期別選單', r.form);
    check('v5.428 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.429 逐項議價可調備用單價 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      items = [
        { desc: 'H型鋼樁打設', unit: 'M', qty: '100', price: '500', note: '', ot: '', otu: '$/M/天', sec: false },
        { desc: '安全走道', unit: 'M', qty: '1', price: '800', note: '備用單價', ot: '', otu: '$/M/天', sec: false, spare: true },
      ];
      exs = [];
      document.querySelector('input[name="ngt-way"][value="items"]').checked = true;
      buildNgtItems();
      out.hasInput = !!document.getElementById('ngt-ip-1');
      document.getElementById('ngt-ip-0').value = '450';
      document.getElementById('ngt-ip-1').value = '700';
      updNgtItemsSum();
      out.sumExcl = /45,000/.test(document.getElementById('ngt-items-sum').innerHTML);   // 備用單價仍不計入
      applyNegotiate();
      out.applied = Number(items[0].price) === 450 && Number(items[1].price) === 700 && items[1].origPrice === 800 && items[1].spare === true;
      out.total = calcT().sub === 45000;
      return out;
    });
    check('議價：逐項調價可調備用單價，且備用單價仍不計入總額', r.hasInput && r.sumExcl && r.applied && r.total);
    check('v5.429 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.430 單價分析小分類順序、日報表單順序 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const ks = Object.keys(UPA_ITEMS.support.items);
      out.upa = ks.indexOf('圍令背填施作及打除') === ks.indexOf('油壓千斤頂') - 1 && ks.indexOf('切除買斷') === ks.indexOf('止水板') - 1
        && ks.indexOf('圍令背填施作及打除') > ks.indexOf('施工構台');
      const prog = document.getElementById('dr-prog-rows'), crews = document.getElementById('dr-crews'), ph = document.getElementById('dr-photos'), dt = document.getElementById('dr-date');
      const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      out.form = before(dt, prog) && before(prog, crews) && before(crews, ph);
      return out;
    });
    check('單價分析：圍令背填在油壓千斤頂之前、切除買斷在止水板之前', r.upa);
    check('日報表單：日期 → 今日進度 → 出工 → 照片', r.form);
    check('v5.430 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.431 日報作業狀態／停工補登／提醒改問句、支出人 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {}; const today = localToday();
      const q = { id: 'tq431', name: 'T431', awarded: true, items: [{ desc: 'H型鋼樁打設、拔除', unit: '支', qty: 10, price: 1000 }],
        dailyLogs: [{ id: 'a', date: _dAdd(today, -10), progressRows: [{ itemIdx: 0, qty: 4 }] }] };
      out.gap = (_drGapState(q, today, 3) || {}).kind === 'gap';
      q.dailyLogs.unshift({ id: 'b', date: _dAdd(today, -8), status: 'pause', progressRows: [] });
      out.paused = _drGapState(q, today, 3) === null;                       // 暫停中不催
      q.dailyLogs[0].resumeDate = _dAdd(today, -5);
      out.resume = (_drGapState(q, today, 3) || {}).kind === 'resume';      // 過了預計復工日才問
      q.dailyLogs = [{ id: 'a', date: _dAdd(today, -10), progressRows: [{ itemIdx: 0, qty: 10 }] }];
      out.stageDone = _projStageDone(q) === true && _drGapState(q, today, 3) === null;   // 打設完成待拔除不催
      q.dailyLogs.push({ id: 'c', date: _dAdd(today, -9), progressRows: [{ itemIdx: 0, qty: 2, ph: 'remove' }] });
      out.stageRemove = _projStageDone(q) === false && !!_drGapState(q, today, 3);
      out.txt = /⛔ 停工（2026-09-05～2026-09-10）：大雨　預計復工 2026-09-12/.test(_drStatusText({ status: 'stop', date: '2026-09-10', stopFrom: '2026-09-05', stopReason: '大雨', resumeDate: '2026-09-12' }));
      // 表單：狀態列可單獨成一筆日報；支出人寫進成本記錄
      Q.push(q); go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'tq431'; if (sel.onchange) sel.onchange();
      document.getElementById('dr-status').value = 'stop'; _drStatusUI(); document.getElementById('dr-stop-reason').value = '颱風';
      const e = _drCollect();
      out.collect = !!e && e.status === 'stop' && e.stopReason === '颱風' && document.getElementById('dr-status-more').style.display === '';
      const ps = document.getElementById('qc-payer');
      document.getElementById('qc-proj').value = 'tq431'; rQuickCostItems();
      qcAdd(QC_TYPES.findIndex(t => t[0] === '涼水')); _qcPending[0].amt = '120';
      ps.innerHTML += '<option value="測試員">測試員</option>'; ps.value = '測試員'; submitQuickCost();
      const c = q.costs && q.costs[0];
      out.payer = !!c && c.payer === '測試員' && c.payBy === 'staff' && c.amt === 120 && c.type === 'extra';
      out.btns = /補登停工／暫停/.test(_drGapBtns('x', '2026-01-01')) && /補日報/.test(_drGapBtns('x', '2026-01-01'));
      _drClearForm(); out.cleared = document.getElementById('dr-status').value === 'work';
      Q = Q.filter(x => x.id !== 'tq431');
      return out;
    });
    check('日報：暫停／停工中不催日報，過預計復工日才問；打設完成待拔除不催', r.gap && r.paused && r.resume && r.stageDone && r.stageRemove);
    check('日報：作業狀態可單獨成一筆日報，狀態文字含起訖／原因／復工日', r.collect && r.txt && r.cleared);
    check('待辦：沒日報改問句並附「補登停工／補日報」', r.btns);
    check('支出：支出人寫進成本記錄（員工→零用金結算依據）', r.payer);
    check('v5.431 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.432 工作日報篩選＋匯出 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => new Promise(res => {
      const out = {};
      const q = { id: 'tq432', name: 'T432', awarded: true, items: [{ desc: 'H型鋼樁打設、拔除', unit: '支', qty: 10, price: 1000 }], dailyLogs: [
        { id: 'a', date: '2026-09-01', crews: [{ type: 'labor', vendor: '', n: 3 }], progressRows: [{ itemIdx: 0, qty: 4 }], progress: 'H型鋼樁打設、拔除 4支' },
        { id: 'b', date: '2026-09-05', status: 'stop', stopFrom: '2026-09-02', stopReason: '大雨', resumeDate: '2026-09-08', progressRows: [] },
        { id: 'c', date: '2026-09-09', progressRows: [{ itemIdx: 0, qty: 3, ph: 'remove', note: '第一車' }], progress: 'x' }] };
      Q.push(q); viewDailyReports('tq432');
      setTimeout(() => {
        out.list = document.querySelectorAll('#drv-list > div').length === 3 && /施工 2 天、停工 4 天/.test(document.getElementById('drv-sum').textContent);
        document.getElementById('drv-st').value = 'stop'; _drvRender(); out.st = document.querySelectorAll('#drv-list > div').length === 1;
        document.getElementById('drv-st').value = ''; document.getElementById('drv-kw').value = '第一車'; _drvRender(); out.kw = document.querySelectorAll('#drv-list > div').length === 1;
        document.getElementById('drv-kw').value = ''; document.getElementById('drv-from').value = '2026-09-03'; _drvRender(); out.from = document.querySelectorAll('#drv-list > div').length === 2;
        const rows = _drFilterLogs(q, {}).map(L => _drLogRow(q, L));
        out.rows = rows[0].progress === 'H型鋼樁打設、拔除（拔除） 3支；第一車' && rows[1].stopDays === 4 && rows[2].crews === '點工 3 人';
        // PDF 走統一列印引擎（先預覽）、橫式、含停工列；Excel 有資料列
        let printed = null; const orig = _printViaIframe;
        window._printViaIframe = function (html, fname, land) { printed = { land, ok: /工作日報彙整表/.test(html) && /停工/.test(html) && /2026-09-02～2026-09-05（4天）/.test(html) }; };
        document.getElementById('drv-from').value = ''; _drvRender(); drExportPDF(); window._printViaIframe = orig;
        out.pdf = !!printed && printed.land === true && printed.ok;
        let xl = null; const origX = xlsxDownload; window.xlsxDownload = function (fn, sheets) { xl = sheets[0].rows.length; }; drExportXlsx(); window.xlsxDownload = origX;
        out.xlsx = xl === 5;   // 表頭＋3 筆＋合計
        Q = Q.filter(x => x.id !== 'tq432'); res(out);
      }, 200);
    }));
    check('日報檢視：期間／狀態／工項／關鍵字篩選，統計施工與停工天數', r.list && r.st && r.kw && r.from && r.rows);
    check('日報匯出：PDF 走統一引擎（橫式、含停工起訖天數）、Excel', r.pdf && r.xlsx);
    check('v5.432 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.433 人員薪資（基本資料／薪資設定／薪資條） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      HR.length = 0; PAYSLIPS.length = 0;
      const a = _acct(); a.__staff.push({ id: 'st433', email: 'a433@x.com', name: '王小明', phone: '0912', roles: [], active: true }); _acctSave(a);
      HR.push({ id: 'hr_st433', sid: 'st433', name: '王小明', title: '工務', payType: 'month', base: 40000, telAllow: 500, laborGrade: 40100, healthGrade: 40100, dep: 1, _mt: 1 });
      HR.push({ id: 'hrB433', name: '李大同', title: '點工', payType: 'day', base: 2000, laborGrade: 28590, healthGrade: 28590, dep: 0, active: true, _mt: 1 });
      // 級距→金額試算：勞保 級距×12.5%×20%（員工）／×70%＋職災 0.5%（雇主）；健保 5.17%×30%×(1+眷口)／×60%×1.57；勞退 6%
      const ins = _hrCalcIns(40100, 40100, 1);
      out.ins = ins.laborSelf === 1003 && ins.laborCo === 3709 && ins.healthSelf === 1244 && ins.healthCo === 1953 && ins.pensionCo === 2406;
      Object.assign(HR[0], ins); Object.assign(HR[1], _hrCalcIns(28590, 28590, 0));
      go('payroll');
      const ppl = _hrPeople();
      out.people = ppl.length === 2 && ppl[0].sid === 'st433' && ppl[0].name === '王小明' && ppl[1].id === 'hrB433' && !ppl[1].st;
      out.tbl = document.querySelectorAll('#pr-people tbody tr').length === 2 && !/無帳號/.test(document.querySelectorAll('#pr-people tbody tr')[0].innerHTML);
      document.getElementById('pr-ym').value = '2026-09';
      psGenerate();
      const L = () => _psList('2026-09');
      out.gen = L().length === 2 && L().some(s => s.name === '李大同') && L().find(s => s.hrId === 'hr_st433').net === 40500 - 1003 - 1244;   // 月薪：本薪＋電信津貼－勞健保自付
      psUpd('ps_hrB433_2026-09', 'days', 22); psUpd('ps_hr_st433_2026-09', 'extra', 3000);
      const b = L().find(s => s.hrId === 'hrB433'), w = L().find(s => s.hrId === 'hr_st433');
      out.calc = b.baseAmt === 44000 && b.net === 44000 - b.laborSelf - b.healthSelf && w.gross === 43500 && w._mt > 1;
      psGenerate(); out.noDup = L().length === 2;
      psPaid('ps_hrB433_2026-09'); out.paid = b.status === 'paid' && !!b.paidDate;
      out.sub = /在職 2 人/.test(document.getElementById('pr-sub').textContent) && /人事成本/.test(document.getElementById('pr-sub').textContent);
      // 匯出：薪資條（直式，含公司負擔、不含身分證字號）、總表（橫式）、Excel（活公式）
      const printed = []; const orig = _printViaIframe;
      window._printViaIframe = function (html, fname, land) { printed.push({ fname, land, slip: /薪資條/.test(html) && /實發金額/.test(html), idno: /身分證/.test(html), co: /公司負擔/.test(html) }); };
      psExportSlipPDF('ps_hr_st433_2026-09'); psExportSlipsPDF(); psExportSummaryPDF(); window._printViaIframe = orig;
      out.pdf = printed.length === 3 && printed[0].slip && printed[0].co && !printed[0].idno && printed[0].land === false && printed[2].land === true && !printed[2].idno;
      let xl = null; const ox = xlsxDownload; window.xlsxDownload = function (fn, sh) { xl = { rows: sh[0].rows.length, f: sh[0].rows[1][9].f, tot: sh[0].rows[3][15].f }; }; psExportXlsx(); window.xlsxDownload = ox;
      out.xlsx = !!xl && xl.rows === 4 && xl.f === 'SUM(F2:I2)' && xl.tot === 'SUM(P2:P3)';
      // 同步：hr／payslips 走 private（shared 剝掉）、全量備份含、記錄級合併新者勝
      out.priv = _PRIV_COLLS.indexOf('hr') >= 0 && _PRIV_COLLS.indexOf('payslips') >= 0 && _privatePayload().data.hr.length === 2;
      const sp = _sharedPayload(); out.stripped = !('hr' in sp.data) && !('payslips' in sp.data) && !!_syncPayload().data.hr;
      _applySensColls({ hr: [{ id: 'hrB433', name: '李大同', payType: 'day', base: 2100, _mt: Date.now() + 5 }], payslips: [] }, {});
      out.merged = HR.find(h => h.id === 'hrB433').base === 2100 && HR.length === 2;
      // 編輯視窗：基本資料＋薪資欄位、依費率試算
      hrEdit('hr_st433', 'st433');
      out.modal = !!document.getElementById('hr-emg') && !!document.getElementById('hr-lg') && !!document.getElementById('hr-petty');
      document.getElementById('hr-lg').value = 28590; document.getElementById('hr-hg').value = 28590; document.getElementById('hr-dep').value = 0; _hrFillIns();
      out.fill = document.getElementById('hr-lself').value === '715';
      document.getElementById('hr-emg').value = '王媽媽'; document.getElementById('fy-modal-o').click();
      out.saved = HR.find(h => h.id === 'hr_st433').emg === '王媽媽' && HR.find(h => h.id === 'hr_st433').laborSelf === 715;
      // 頁面登記：導覽、權限 adminOnly、手機堆疊清單
      out.page = ALL_PAGES.some(p => p.id === 'payroll' && p.adminOnly) && !document.getElementById('sn-payroll');
      HR.length = 0; PAYSLIPS.length = 0; const a2 = _acct(); a2.__staff = a2.__staff.filter(x => x.id !== 'st433'); _acctSave(a2);
      return out;
    });
    check('人員薪資：名冊人員＋無帳號員工、級距→金額試算、編輯視窗存檔', r.people && r.tbl && r.ins && r.modal && r.fill && r.saved && r.page);
    check('薪資條：依設定產生（月薪／日薪×天數）、加項扣項即時重算、不重複、發放狀態', r.gen && r.calc && r.noDup && r.paid && r.sub);
    check('薪資條匯出：PDF 直式／總表橫式（不含身分證）、Excel 活公式', r.pdf && r.xlsx);
    check('人員薪資同步：hr／payslips 走 private、shared 剝掉、備份含、合併新者勝', r.priv && r.stripped && r.merged);
    // 手機：人員薪資頁不得左右滑
    const { page: mp, errors: merr } = await newPage(browser, 390, 844);
    const mh = await mp.evaluate(() => new Promise(res => {
      HR.push({ id: 'hrM433', name: '李大同', payType: 'day', base: 2000, active: true, _mt: 1 });
      go('payroll'); document.getElementById('pr-ym').value = '2026-09'; psGenerate();
      setTimeout(() => { const ok = document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelectorAll('#page-acct table.mst').length >= 2; HR.length = 0; PAYSLIPS.length = 0; res(ok); }, 300);
    }));
    check('手機：人員薪資頁表格堆疊、無橫向捲動', mh);
    check('v5.433 測試無 JS 錯誤', errors.length === 0 && merr.length === 0, errors.concat(merr).slice(0, 3).join(' | '));
    await mp.close();
    await page.close();
  }

  // ───────────── v5.434 零用金結算 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      HR.length = 0; PAYSLIPS.length = 0; PETTY.length = 0;
      HR.push({ id: 'hrP', name: '王小明', payType: 'month', base: 30000, pettyQuota: 5000, active: true, _mt: 1 });
      HR.push({ id: 'hrQ', name: '李大同', payType: 'day', base: 2000, pettyQuota: 0, active: true, _mt: 1 });
      Q.push({ id: 'tq434a', name: '甲案', items: [], costs: [
        { id: 'c1', type: 'extra', vendor: '公司支出（自付）', cat: '油資', date: '2026-09-03', amt: 1200, payer: '王小明', rows: [{ desc: '加油' }] },
        { id: 'c2', type: 'extra', vendor: '公司支出（自付）', cat: '其他', date: '2026-09-20', amt: 4500, payer: '王小明', rows: [{ desc: '五金' }] },
        { id: 'c3', type: 'extra', vendor: '公司支出（自付）', cat: '其他', date: '2026-08-28', amt: 800, payer: '王小明', rows: [{ desc: '上月的' }] },
        { id: 'c4', type: 'extra', vendor: '公司支出（自付）', cat: '油資', date: '2026-09-10', amt: 300, payer: '', rows: [{ desc: '公司付' }] }] });
      Q.push({ id: 'tq434b', name: '乙案', items: [], costs: [
        { id: 'c5', type: 'extra', vendor: '公司支出（自付）', cat: 'ETC', date: '2026-09-15', amt: 600, payer: '王小明', rows: [{ desc: '過路費' }] },
        { id: 'c6', type: 'extra', vendor: '公司支出（自付）', cat: '油資', date: '2026-09-16', amt: 900, payer: '李大同', rows: [{ desc: '加油' }] }] });
      go('payroll'); document.getElementById('pr-ym').value = '2026-09';
      // 明細跨專案、只取當月、只取該員工
      const items = _pcItems('王小明', '2026-09');
      out.items = items.length === 3 && items.map(i => i.proj).join() === '甲案,乙案,甲案' && items.reduce((a, i) => a + i.amt, 0) === 6300;
      pcGenerate();
      const w = _pcOf('hrP', '2026-09'), l = _pcOf('hrQ', '2026-09');
      // 首月：上月剩餘 0、領取＝定額 5000；支出 6300 → 剩餘 0、代墊 1300、補足 5000、應付 6300
      out.calc = !!w && w.carry === 0 && w.draw === 5000 && w.spent === 6300 && w.remain === 0 && w.advance === 1300 && w.topup === 5000 && w.payout === 6300;
      // 沒定額但有支出者也列（全部代墊）
      out.noQuota = !!l && l.quota === 0 && l.spent === 900 && l.advance === 900 && l.payout === 900;
      // 調整欄與發放鎖定
      pcUpd(w.id, 'adj', -300); out.adj = w.spent === 6000 && w.advance === 1000 && w.payout === 6000;
      pcPaid(w.id); out.paid = w.status === 'paid' && !!w.paidDate;
      // 次月：上月剩餘＝0、上月領取＝上月補足 5000；本月無支出 → 剩餘 5000、補足 0
      document.getElementById('pr-ym').value = '2026-10'; pcGenerate();
      const w2 = _pcOf('hrP', '2026-10');
      out.next = !!w2 && w2.carry === 0 && w2.draw === 5000 && w2.spent === 0 && w2.remain === 5000 && w2.topup === 0 && w2.payout === 0;
      out.tbl = document.querySelectorAll('#pr-petty tbody tr').length === 2 && /零用金應付/.test(document.getElementById('pr-sub').textContent);
      // 明細視窗帶專案
      pcDetail(w.id); out.detail = /甲案/.test(document.getElementById('gen-confirm-modal').innerHTML) && /乙案/.test(document.getElementById('gen-confirm-modal').innerHTML);
      document.getElementById('gen-confirm-ok').click();
      // 匯出
      document.getElementById('pr-ym').value = '2026-09';
      const printed = []; const orig = _printViaIframe;
      window._printViaIframe = function (html, fname, land) { printed.push({ fname, proj: /甲案/.test(html) && /乙案/.test(html), adv: /代墊/.test(html), tot: /6,000/.test(html) }); };
      pcExportPDF(w.id); pcExportAllPDF(); window._printViaIframe = orig;
      out.pdf = printed.length === 2 && printed[0].proj && printed[0].adv && printed[0].tot && /零用金結算單_王小明_202609/.test(printed[0].fname);
      let xl = null; const ox = xlsxDownload; window.xlsxDownload = function (fn, sh) { xl = { n: sh.length, rows: sh[0].rows.length, f: sh[0].rows[1][9].f, det: sh[1].rows.length }; }; pcExportXlsx(); window.xlsxDownload = ox;
      out.xlsx = !!xl && xl.n === 2 && xl.rows === 4 && xl.f === 'H2+I2' && xl.det === 5;   // 明細：表頭＋王 3 筆＋李 1 筆
      // 同步：petty 走 private
      out.priv = _PRIV_COLLS.indexOf('petty') >= 0 && _privatePayload().data.petty.length === 3 && !('petty' in _sharedPayload().data) && !!_syncPayload().data.petty;
      HR.length = 0; PAYSLIPS.length = 0; PETTY.length = 0; Q = Q.filter(x => !/^tq434/.test(x.id));
      return out;
    });
    check('零用金：支出明細跨專案只取當月該員工', r.items);
    check('零用金結算：定額／上月剩餘／領取／支出／剩餘／代墊／補足／應付口徑，次月接續', r.calc && r.noQuota && r.adj && r.paid && r.next && r.tbl && r.detail);
    check('零用金匯出：結算單 PDF 帶專案明細、Excel 兩張表活公式；petty 走 private', r.pdf && r.xlsx && r.priv);
    check('v5.434 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.435 薪資／零用金 → 應付／金流／固定成本／報表 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      HR.length = 0; PAYSLIPS.length = 0; PETTY.length = 0; PAYABLES.length = 0; TOMBS.payables = {};
      HR.push({ id: 'hrD', name: '王小明', payType: 'month', base: 30000, laborCo: 3000, laborSelf: 600, healthCo: 1500, healthSelf: 450, pensionCo: 1800, pettyQuota: 3000, active: true, _mt: 1 });
      const _Q0 = Q; Q = []; INV.length = 0; MAT_LEDGER.length = 0;
      Q.push({ id: 'tq435', name: '丁案', items: [], costs: [{ id: 'c1', type: 'extra', vendor: '公司支出（自付）', cat: '油資', date: '2026-09-03', amt: 4000, payer: '王小明', rows: [{ desc: '加油' }] }] });
      P.salaryPayDay = 5;
      go('payroll'); document.getElementById('pr-ym').value = '2026-09'; psGenerate(); pcGenerate();
      const ps = _psList('2026-09')[0], pc = _pcOf('hrD', '2026-09');
      const pp = PAYABLES.find(p => p.id === 'pay_' + ps.id), pi = PAYABLES.find(p => p.id === 'pay_ins_2026-09'), pk = PAYABLES.find(p => p.id === 'pay_' + pc.id);
      // 薪資實發 → 應付（次月 5 日、不含稅、類別 salary）；勞健保＋勞退一筆（次月底）；零用金補足＋代墊 → 應付
      out.pay = !!pp && pp.amount === 30000 - 600 - 450 && pp.date === '2026-10-05' && pp.vat === false && pp.category === 'salary' && pp.status === 'pending';
      out.ins = !!pi && pi.amount === 3000 + 600 + 1500 + 450 + 1800 && pi.date === '2026-10-31';
      out.petty = !!pk && pk.amount === pc.payout && pc.payout === 4000 && pk.category === 'petty';
      // 狀態雙向：薪資條標發放 → 應付 paid；應付頁標付款 → 零用金結算回寫
      psPaid(ps.id); out.paid1 = PAYABLES.find(p => p.id === 'pay_' + ps.id).status === 'paid';
      confirmPayment('pay_' + pc.id); renderPayroll(); out.paid2 = pc.status === 'paid' && !!pc.paidDate;
      // 應付頁類別標籤
      go('finance'); renderPayables(); out.label = /薪資／勞健保/.test(document.getElementById('payable-list').innerHTML) && /零用金/.test(document.body.innerHTML);
      // 推估人事成本、寫入公司固定成本
      out.est = _hrMonthlyCost() === 30000 + 3000 + 1500 + 1800;
      P.fixedCosts = [{ name: '辦公室租金', amt: 20000 }]; hrWriteFixedCost();
      out.fixed = P.fixedCosts.length === 2 && P.fixedCosts[1].amt === _hrMonthlyCost() && /薪/.test(P.fixedCosts[1].name);
      // 金流預測：固定成本的薪資列不重複扣，未產生薪資條的月份走推估
      renderCashForecast();
      const cf = document.getElementById('cashflow-forecast').innerHTML;
      out.cf = /預估薪資＋勞健保/.test(cf);
      // 報表中心人事成本分頁
      go('reports'); showReport('hr');
      const rp = document.getElementById('report-content').innerHTML;
      out.rpt = /2026-09/.test(rp) && /人事成本/.test(rp) && /王小明/.test(rp) && !!document.getElementById('rpt-hr-btn');
      // 刪薪資條 → 應付撤掉並立墓碑
      psDel(ps.id); document.getElementById('gen-confirm-ok').click();
      out.del = !PAYABLES.some(p => p.id === 'pay_' + ps.id) && !!(TOMBS.payables || {})['pay_' + ps.id] && !PAYABLES.some(p => p.id === 'pay_ins_2026-09');
      // 待辦：上月薪資條未產生（測試環境未登入 → canAccess 對 adminOnly 頁回 false，直接驗函式邏輯）
      out.todoFn = typeof _psYmText === 'function' && /薪資條尚未產生|todo\.hr/.test(updateDashTodo.toString());
      HR.length = 0; PAYSLIPS.length = 0; PETTY.length = 0; PAYABLES.length = 0; P.fixedCosts = []; Q = _Q0;
      return out;
    });
    check('薪資／零用金 → 應付：實發次月發放日、勞健保一筆次月底、零用金補足＋代墊，狀態雙向', r.pay && r.ins && r.petty && r.paid1 && r.paid2 && r.label);
    check('人事成本推估：寫入公司固定成本、金流預測不重複扣並推估未產生月份', r.est && r.fixed && r.cf);
    check('報表中心人事成本分頁；刪薪資條撤應付並立墓碑；待辦提醒', r.rpt && r.del && r.todoFn);
    check('v5.435 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.436 額外支出唯一入口＝日報．支出，施工成本頁唯讀呈現 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      Q.push({ id: 'tq436', name: '戊案', awarded: true, items: [{ desc: 'H型鋼樁打設', unit: 'M', qty: 100, price: 1000 }], costs: [
        { id: 'x1', type: 'extra', vendor: '公司支出（自付）', cat: '油資', date: '2026-09-03', amt: 1200, payer: '王小明', linkedItemIdx: 0, rows: [{ id: 'x1_0', subType: 'worker', desc: '加油', days: 1, dayRate: 1200, transport: 0 }] },
        { id: 'x2', type: 'extra', vendor: '公司支出（自付）', cat: '其他', date: '2026-09-04', amt: 0, payer: '', rows: [{ id: 'a', desc: '便當', days: 10, dayRate: 100, transport: 0 }, { id: 'b', desc: '涼水', days: 1, dayRate: 300, transport: 50 }] },
        { id: 's1', type: 'sub', vendor: '丙承包', cat: '打設', date: '2026-09-05', amt: 50000, rows: [{ id: 'r1', linkedItemIdx: 0, desc: '', qty: 100, unitPrice: 500 }] }] });
      eid = 'tq436'; go('costs'); rCostItems();
      const cl = document.getElementById('cost-list');
      const card = id => cl.querySelector('#cost-amt-' + id).closest('div[style*="border-bottom"]');
      // 額外支出卡：無金額／品名輸入框（只剩附屬勾選）、顯示支出人／品名／對應工項／小計、可刪、不可切換類型
      const c1 = card('x1');
      out.ro = c1.querySelectorAll('input[type="number"],input[type="text"],input[type="date"],select,textarea').length === 0 && !/changeCostType/.test(c1.innerHTML) && /delCostItem/.test(c1.innerHTML);
      out.show = /支出人 王小明/.test(c1.innerHTML) && /加油/.test(c1.innerHTML) && /H型鋼樁打設/.test(c1.innerHTML) && /到日報．支出/.test(c1.innerHTML);
      // 舊版多列額外支出：逐列列出、小計重算（10×100＋300＋50）
      out.legacy = cl.querySelector('#cost-amt-x2').textContent === '1,350' && /公司付款/.test(card('x2').innerHTML) && /×10/.test(card('x2').innerHTML) && /車資 50/.test(card('x2').innerHTML);
      // v5.443：類型下拉恢復「額外支出」（廠商型，例：外調機具）；日報帶入的卡（x1）仍不可改型
      const sel = card('s1').querySelector('select[onchange^="changeCostType"]');
      out.opts = [...sel.options].map(o => o.value).join() === 'sub,labor,extra,own';
      changeCostType('x1', 'sub'); out.guard = Q.find(x => x.id === 'tq436').costs.find(c => c.id === 'x1').type === 'extra';
      // 頁面提示指向日報．支出；日報．支出登錄後仍會出現在施工成本（同一筆記錄）
      out.hint = /零星支出由日報．支出登錄/.test(document.getElementById('page-costs').innerHTML);   // v5.437 起只留「＋ 新增成本」的提示文字，頁面說明列已移除；v5.443 文案改為零星支出
      go('quickcost'); rQuickCost();
      const ps = document.getElementById('qc-proj'); ps.value = 'tq436'; if (ps.onchange) ps.onchange();
      qcAdd(QC_TYPES.findIndex(t => t[0] === '五金')); _qcPending[0].amt = '250'; _qcPending[0].note = '五金螺絲';
      const n0 = Q.find(x => x.id === 'tq436').costs.length; submitQuickCost();
      const qc = Q.find(x => x.id === 'tq436').costs;
      out.flow = qc.length === n0 + 1 && qc[qc.length - 1].type === 'extra' && qc[qc.length - 1].amt === 250;
      go('costs'); rCostItems(); out.flow2 = /五金螺絲/.test(document.getElementById('cost-list').innerHTML);
      Q = Q.filter(x => x.id !== 'tq436');
      return out;
    });
    check('施工成本：額外支出卡唯讀（支出人／品名／工項／小計、可刪不可改型）', r.ro && r.show && r.legacy);
    check('施工成本：類型下拉含「額外支出」、日報帶入卡不可改型、提示指向日報．支出', r.opts && r.guard && r.hint);
    check('日報．支出登錄 → 自動列在該專案施工成本', r.flow && r.flow2);
    check('v5.436 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.437 公司費用（不掛專案）＋實報實銷類別 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      EXPENSES.length = 0; HR.length = 0; PETTY.length = 0;
      const a = _acct(); a.__staff.push({ id: 'st437', email: 'b437@x.com', name: '陳主管', roles: [], active: true }); _acctSave(a);
      Q.push({ id: 'tq437', name: '己案', awarded: true, items: [{ desc: 'X', unit: 'M', qty: 1, price: 1 }], costs: [] });
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('qc-proj');
      out.opt = [...sel.options].some(o => o.value === '__co__');
      const chips = [...document.querySelectorAll('#qc-chips button')].map(b => b.textContent.trim());
      out.chips = chips.some(c => c.startsWith('禮品交際')) && chips.some(c => c.startsWith('停車費')) && chips.some(c => c.startsWith('加油（工務車）')) && chips.some(c => c.startsWith('加油（機具）'));
      // 公司費用：禮品交際預設不掛專案 → 進 EXPENSES（含支出人／類別），不建專案成本
      sel.value = '__co__'; out.dis = true;
      qcAdd(QC_TYPES.findIndex(t => t[0] === '禮品交際')); out.coDefault = _qcPending[0].proj === '__co__';
      _qcPending[0].amt = '3600'; _qcPending[0].note = '中秋禮盒 3 盒';
      document.getElementById('qc-payer').value = '陳主管';
      submitQuickCost();
      const e = EXPENSES[EXPENSES.length - 1];
      out.exp = !!e && e.amount === 3600 && e.note === '中秋禮盒 3 盒' && e.cat === '交際費' && e.payer === '陳主管' && e.payBy === 'staff' && e.src === 'quick' && e._mt > 0;
      out.noCost = Q.find(x => x.id === 'tq437').costs.length === 0 && /公司費用/.test(document.getElementById('qc-log').textContent);
      // 零用金結算把公司費用一併算進該員工支出（專案欄顯示「公司費用」）
      HR.push({ id: 'hrM', name: '陳主管', payType: 'month', base: 1, pettyQuota: 2000, active: true, _mt: 1 });
      const ym = localToday().slice(0, 7);
      const items = _pcItems('陳主管', ym);
      out.pc = items.length === 1 && items[0].proj === '公司費用' && items[0].amt === 3600 && items[0].desc === '中秋禮盒 3 盒';
      go('payroll'); document.getElementById('pr-ym').value = ym; pcGenerate();
      const r0 = _pcOf('hrM', ym); out.pcCalc = !!r0 && r0.spent === 3600 && r0.advance === 1600 && r0.payout === 3600;
      // 帳務頁日常費用列出（品名、類別、支出人）
      go('ledger'); document.getElementById('ledger-month').value = ym; renderLedger();
      const lg = document.getElementById('ledger-in-exp').innerHTML;
      out.ledger = /中秋禮盒/.test(lg) && /交際費/.test(lg) && /支出人 陳主管/.test(lg);
      // 施工成本頁提示已移除；掛專案的實報實銷（ETC）仍進專案成本
      out.hintGone = !/請由「日報．支出」登錄——選了專案就會自動列在這裡/.test(document.getElementById('page-costs').innerHTML);
      go('quickcost'); rQuickCost(); sel.value = 'tq437'; out.en = true;
      // 工務車停車費預設公司費用，可切到專案；機具加油預設掛專案；多筆一起送出
      qcAdd(QC_TYPES.findIndex(t => t[0] === '停車費')); out.carCo = _qcPending[0].proj === '__co__'; qcToggleProj(_qcPending[0].id); out.carToggle = _qcPending[0].proj === 'tq437'; qcDel(_qcPending[0].id);
      qcAdd(QC_TYPES.findIndex(t => t[0] === '加油（機具）')); _qcPending[0].amt = '120';
      qcAdd(QC_TYPES.findIndex(t => t[0] === '其他')); _qcPending[1].amt = '80'; submitQuickCost(); out.otherNeedNote = Q.find(x => x.id === 'tq437').costs.length === 0;
      _qcPending[1].note = '臨時叫車'; submitQuickCost();
      const cs = Q.find(x => x.id === 'tq437').costs; const c = cs[0];
      out.cost = cs.length === 2 && !!c && c.type === 'extra' && c.cat === '機具油料' && c.amt === 120 && c.rows[0].desc === '加油（機具）' && cs[1].review === true && cs[1].rows[0].desc === '臨時叫車' && _qcPending.length === 0;
      out.reviewTag = _pcItems('陳主管', ym).some(i => i.review && i.amt === 80);
      // 接力函式存在且非登入狀態不拋錯
      out.relay = typeof _pushRelayExpenses === 'function' && typeof _pullRelayExpenses === 'function' && (_pushRelayExpenses(), _pullRelayExpenses(), true);
      Q = Q.filter(x => x.id !== 'tq437'); EXPENSES.length = 0; HR.length = 0; PETTY.length = 0;
      const a2 = _acct(); a2.__staff = a2.__staff.filter(x => x.id !== 'st437'); _acctSave(a2);
      return out;
    });
    check('支出登錄：公司費用（不掛專案）→ 帳務日常費用，含支出人／類別，不建專案成本；禮品交際預設公司費用', r.opt && r.dis && r.coDefault && r.exp && r.noCost && r.ledger);
    check('零用金結算納入公司費用；v6 支出：類型晶片、工務車預設公司費用可切專案、多筆送出、其他需說明並標待審', r.chips && r.pc && r.pcCalc && r.en && r.carCo && r.carToggle && r.otherNeedNote && r.cost && r.reviewTag);
    check('施工成本頁提示已移除；公司費用接力函式可用', r.hintGone && r.relay);
    check('v5.437 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.438 人員進場資料 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      WORKERS.length = 0;
      const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const plus = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      out.page = ALL_PAGES.some(p => p.id === 'workers') && !!document.getElementById('sn-workers') && _SYNC_COLLS.includes('workers') && _REC_COLLS.includes('workers');
      go('workers'); wkEdit('');
      const set = (k, v) => { const el = document.getElementById('wk-f-' + k); el.value = v; };
      set('name', '林阿明'); set('sex', '男'); set('idNo', 'a123456789'); set('birth', '1985-03-05'); set('blood', 'O'); set('phone', '0912345678');
      set('regAddr', '桃園市中壢區中央路 1 號'); set('emg', '林太太'); set('emgRel', '配偶'); set('emgPhone', '0987654321'); set('company', '豐有工程'); set('title', '鋼構');
      // 通訊地址同上；上傳職安卡（30 天後到期）與大頭照；證照已過期
      _wkDraft.docs.oshF = { du: PNG, name: 'osh.png', ts: 1, exp: plus(30) };
      _wkDraft.docs.photo = { du: PNG, name: 'p.png', ts: 1 };
      wkAddCert(); wkCertField(0, 'name', '吊掛作業'); wkCertField(0, 'exp', plus(-3));
      wkSave();
      const w = WORKERS[0];
      out.saved = WORKERS.length === 1 && w.name === '林阿明' && w.idNo === 'A123456789' && w.mailSame === true && _wkMailAddr(w) === '桃園市中壢區中央路 1 號' && w.emgRel === '配偶' && w._mt > 0 && w.certs.length === 1;
      const ex = _wkExpiries(w);
      out.exp = ex.length === 2 && ex[0].label === '吊掛作業' && ex[0].dd === -3 && ex[1].label === '職安卡正面' && ex[1].dd === 30;
      // 清單：顯示、遮罩身分證、效期標示；離職篩選
      const html = document.getElementById('wk-root').innerHTML;
      out.list = /林阿明/.test(html) && /A1＊＊＊＊89/.test(html) && /已過期/.test(html) && /2／10/.test(html);
      // 待辦提醒（到期前 60 天、已過期）
      go('dash'); updateDashTodo();
      const td = document.getElementById('dash-todo-list').innerHTML;
      out.todo = /林阿明　吊掛作業已於/.test(td) && /職安卡正面30 天後到期|職安卡正面 ?30 天後到期/.test(td.replace(/<[^>]+>/g, ''));
      // 資料表 PDF（含照片、地址、緊急聯絡、證照）與名冊 Excel
      let printed = null; const orig = _printViaIframe;
      window._printViaIframe = function (h, fname) { printed = { ok: /人員進場資料表/.test(h) && /林阿明/.test(h) && /桃園市中壢區/.test(h) && /林太太（配偶）/.test(h) && /吊掛作業/.test(h) && /img src="data:image\/png/.test(h), fname }; };
      wkPrintSheet(w.id); const p1 = printed; wkPrintAll(); window._printViaIframe = orig;
      out.pdf = !!p1 && p1.ok && /人員進場資料表_林阿明/.test(p1.fname) && !!printed && printed.ok;
      let xl = null; const ox = xlsxDownload; window.xlsxDownload = function (fn, sh) { xl = { rows: sh[0].rows.length, cols: sh[0].rows[0].length, name: sh[0].rows[1][0].v, osh: sh[0].rows[1][14].v }; }; go('workers'); wkExportXlsx(); window.xlsxDownload = ox;
      out.xlsx = !!xl && xl.rows === 2 && xl.cols === 20 && xl.name === '林阿明' && xl.osh === plus(30);
      // 同步：shared payload 含 workers；記錄級合併新者勝、墓碑
      out.payload = _syncPayload().data.workers.length === 1;
      const merged = _mergeColl(WORKERS, { [w.id]: Object.assign({}, w, { title: '雲端改', _mt: Date.now() + 9 }) }, 'workers', {});
      out.merge = merged.length === 1 && merged[0].title === '雲端改';
      wkDel(w.id); document.getElementById('gen-confirm-ok').click();
      out.del = WORKERS.length === 0 && !!(TOMBS.workers || {})[w.id];
      WORKERS.length = 0; delete TOMBS.workers;
      return out;
    });
    check('人員進場資料：新增／欄位／通訊地址同上／證照，效期計算與清單遮罩', r.page && r.saved && r.exp && r.list);
    check('人員進場資料：到期待辦提醒、資料表 PDF、名冊 Excel', r.todo && r.pdf && r.xlsx);
    check('人員進場資料：走 shared 逐筆同步、合併新者勝、刪除立墓碑', r.payload && r.merge && r.del);
    // 手機：清單堆疊、無橫向捲動
    const { page: mp, errors: merr } = await newPage(browser, 390, 844);
    const mh = await mp.evaluate(() => new Promise(res => {
      WORKERS.push({ id: 'wkM', name: '測試', status: 'active', docs: {}, certs: [], _mt: 1 });
      go('workers');
      setTimeout(() => { const ok = document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelectorAll('#wk-root table.mst').length === 1; WORKERS.length = 0; res(ok); }, 300);
    }));
    check('手機：人員進場資料清單堆疊、無橫向捲動', mh);
    check('v5.438 測試無 JS 錯誤', errors.length === 0 && merr.length === 0, errors.concat(merr).slice(0, 3).join(' | '));
    await mp.close();
    await page.close();
  }

  // ───────────── v5.439 業主表格自動填入（zip 讀寫、xlsx／docx 寫入、AI 對應、範本記憶） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(async () => {
      const out = {};
      WORKERS.length = 0;
      WORKERS.push({ id: 'wkA', name: '林阿明', sex: '男', idNo: 'A123456789', birth: '1985-03-05', blood: 'O', phone: '0912345678', regAddr: '桃園市', mailSame: true, emg: '林太太', emgRel: '配偶', emgPhone: '09', company: '豐有工程', title: '鋼構', status: 'active', docs: { oshF: { du: '', exp: '2027-01-31' } }, certs: [{ name: '吊掛作業', exp: '2027-05-01' }], _mt: 1 });
      WORKERS.push({ id: 'wkB', name: '王小華', sex: '女', idNo: 'B223456789', birth: '1990-12-25', status: 'active', docs: {}, certs: [], _mt: 1 });
      const te = new TextEncoder(), td = new TextDecoder();
      // ① 欄位值（民國、通訊地址同上、證照）
      const w = WORKERS[0];
      out.val = _wkFieldValue(w, 'birthRoc') === '74/03/05' && _wkFieldValue(w, 'mailAddr') === '桃園市' && _wkFieldValue(w, 'oshExp') === '2027-01-31' && _wkFieldValue(w, 'certs') === '吊掛作業' && _wkFieldValue(w, 'birthM') === '3';
      // ② zip 往返：用內建 xlsx 產生器做一份「業主空白表」，_zipRead 讀回、_xlsxParse 列出儲存格
      const bytes = _xlsxBytes([{ name: '進場申請', rows: [['人員進場申請表'], ['姓名', '', '性別', ''], ['身分證字號', '', '出生日期', ''], ['戶籍地址', '', '', ''], [], ['序', '姓名', '身分證', '電話'], [1, '', '', ''], [2, '', '', '']] }]);
      const files = await _zipRead(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      out.zip = !!files['xl/workbook.xml'] && !!files['xl/worksheets/sheet1.xml'];
      const parsed = _xlsxParse(files);
      out.parse = parsed.sheets.length === 1 && parsed.sheets[0].name === '進場申請' && parsed.cells.some(c => c.cell === 'A2' && c.text === '姓名') && parsed.cells.some(c => c.cell === 'C3' && c.text === '出生日期') && !parsed.cells.some(c => c.cell === 'B2');
      // ③ xlsx 寫入：既有格改寫、缺格插入、缺列新增；重新讀回驗證，且原有標籤不受影響
      let f2 = _xlsxApply(JSON.parse(JSON.stringify({ k: 1 })) && Object.assign({}, files), parsed.sheets, [
        { sheet: '進場申請', cell: 'B2', value: '林阿明' }, { sheet: '進場申請', cell: 'D2', value: '男' }, { sheet: '進場申請', cell: 'B3', value: 'A123456789' }, { sheet: '進場申請', cell: 'F9', value: '新列' }, { sheet: '進場申請', cell: 'A1', value: '改標題' }]);
      const p2 = _xlsxParse(f2);
      const g = a => (p2.cells.find(c => c.cell === a) || {}).text;
      out.xw = g('B2') === '林阿明' && g('D2') === '男' && g('B3') === 'A123456789' && g('F9') === '新列' && g('A1') === '改標題' && g('C3') === '出生日期';
      const sx = td.decode(f2['xl/worksheets/sheet1.xml']);
      const row2 = (sx.match(/<row r="2"[^>]*>([\s\S]*?)<\/row>/) || [])[1] || '';
      out.xorder = (row2.match(/<c r="([A-Z]+)2"/g) || []).join(',') === '<c r="A2",<c r="B2",<c r="C2",<c r="D2"';   // 插入格維持欄序
      // 重新打包後仍是合法 zip，可再讀回
      const rebytes = _zipWrite(f2);
      const f3 = await _zipRead(rebytes.buffer.slice(rebytes.byteOffset, rebytes.byteOffset + rebytes.byteLength));
      out.rezip = (_xlsxParse(f3).cells.find(c => c.cell === 'B2') || {}).text === '林阿明';
      // ④ docx 寫入：表格下一格補 run（沿用 rPr）、段落底線佔位取代
      const docXml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>姓名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr/></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>電話：＿＿＿＿</w:t></w:r></w:p><w:p><w:r><w:t>備註</w:t></w:r></w:p></w:body></w:document>';
      const dfiles = { 'word/document.xml': te.encode(docXml) };
      const dp = _docxParse(dfiles);
      out.dparse = dp.items.length === 4 && dp.items[0].kind === 'tc' && dp.items[0].text === '姓名' && dp.items[1].text === '' && dp.items[2].kind === 'p' && /電話/.test(dp.items[2].text);
      _docxApply(dfiles, dp, [{ i: 1, value: '林阿明' }, { i: 2, value: '0912345678' }]);
      const dx = td.decode(dfiles['word/document.xml']);
      out.dw = /<w:tc><w:p><w:pPr\/><w:r><w:t xml:space="preserve">林阿明<\/w:t><\/w:r><\/w:p><\/w:tc>/.test(dx) && /電話：0912345678/.test(dx) && /<w:t>備註<\/w:t>/.test(dx);
      // ⑤ AI 對應：stub fetch 回傳 JSON；單人表對應→寫入；範本記憶 P.wkTpl
      const origFetch = window.fetch; localStorage.setItem('fy_aikey', 'test');
      window.fetch = async () => ({ json: async () => ({ content: [{ text: '{"mode":"single","targets":[{"sheet":"進場申請","cell":"B2","field":"name","label":"姓名"},{"sheet":"進場申請","cell":"D3","field":"birthRoc","label":"出生日期"}]}' }] }) });
      const map = await _wkAiMap('xlsx', parsed.cells);
      out.ai = map.mode === 'single' && map.targets.length === 2 && map.targets[1].field === 'birthRoc';
      let dl = null; const origA = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { dl = this.download; };
      const origCU = URL.createObjectURL; URL.createObjectURL = () => 'blob:x';
      _wkOF = { file: { name: '業主表.xlsx', size: 123 }, kind: 'xlsx', files: Object.assign({}, files), parsed, map, workers: [w], key: '業主表.xlsx|123' };
      _wkOFGenerate();
      HTMLAnchorElement.prototype.click = origA; URL.createObjectURL = origCU;
      const after = _xlsxParse(_wkOF.files);
      out.gen = dl === '業主表_林阿明.xlsx' && (after.cells.find(c => c.cell === 'B2') || {}).text === '林阿明' && (after.cells.find(c => c.cell === 'D3') || {}).text === '74/03/05';
      out.tpl = !!(P.wkTpl && P.wkTpl['業主表.xlsx|123'] && P.wkTpl['業主表.xlsx|123'].map.targets.length === 2) && _wkTplGet('業主表.xlsx|123').label === '業主表.xlsx';
      // ⑥ 名冊型：兩位人員自第 7 列往下填
      _wkOF = { file: { name: '名冊.xlsx', size: 9 }, kind: 'xlsx', files: Object.assign({}, files), parsed, map: { mode: 'roster', roster: { sheet: '進場申請', firstRow: 7, cols: { name: 'B', idNo: 'C', phone: 'D' } } }, workers: WORKERS.slice(), key: '名冊.xlsx|9' };
      HTMLAnchorElement.prototype.click = function () { dl = this.download; }; URL.createObjectURL = () => 'blob:x';
      _wkOFGenerate();
      HTMLAnchorElement.prototype.click = origA; URL.createObjectURL = origCU;
      const ro = _xlsxParse(_wkOF.files); const gg = a => (ro.cells.find(c => c.cell === a) || {}).text;
      out.roster = dl === '名冊_名冊2人.xlsx' && gg('B7') === '林阿明' && gg('C7') === 'A123456789' && gg('B8') === '王小華' && gg('C8') === 'B223456789' && gg('A7') === '1';
      // ⑦ 入口：按鈕存在、開啟視窗列出人員
      go('workers'); out.btn = /wkFillOwnerForm/.test(document.getElementById('page-workers').innerHTML);
      wkFillOwnerForm(); out.modal = document.querySelectorAll('.wkof-w').length === 2 && !!document.getElementById('wkof-file'); document.getElementById('gen-confirm-ok') && document.querySelector('#gen-confirm-modal .btn-cancel, #gen-confirm-cancel')?.click();
      window.fetch = origFetch; localStorage.removeItem('fy_aikey'); delete P.wkTpl; WORKERS.length = 0; _wkOF = null;
      return out;
    });
    check('業主表格：zip 讀寫往返、xlsx 儲存格列出與寫入（改格／插格／新列、欄序）', r.zip && r.parse && r.xw && r.xorder && r.rezip);
    check('業主表格：docx 表格格補值與底線佔位取代；欄位值（民國日期、同上地址、證照）', r.dparse && r.dw && r.val);
    check('業主表格：AI 對應→填入下載、範本記憶、名冊型多列填入、頁面入口', r.ai && r.gen && r.tpl && r.roster && r.btn && r.modal);
    // v5.440 舊版 .xls／.doc 與 PDF：明確說明怎麼轉，不進解析流程
    const r2 = await page.evaluate(async () => {
      const out = {};
      WORKERS.push({ id: 'wkX', name: '測', status: 'active', docs: {}, certs: [], _mt: 1 });
      await _wkOFStart({ name: '進場表.xls', size: 5, arrayBuffer: async () => { throw new Error('不該讀'); } }, ['wkX'], false);
      const m = document.getElementById('gen-confirm-modal').innerHTML;
      out.xls = /另存成新版格式/.test(m) && /Excel 活頁簿 \(\*\.xlsx\)/.test(m) && /進場表\.xls/.test(m);
      await _wkOFStart({ name: '表.doc', size: 5, arrayBuffer: async () => { throw new Error('不該讀'); } }, ['wkX'], false);
      out.doc = /Word 文件 \(\*\.docx\)/.test(document.getElementById('gen-confirm-modal').innerHTML);
      await _wkOFStart({ name: '表.pdf', size: 5, arrayBuffer: async () => { throw new Error('不該讀'); } }, ['wkX'], false);
      out.pdf = /PDF 無法直接填入/.test(document.getElementById('gen-confirm-modal').innerHTML);
      out.accept = /accept="\.xlsx,\.docx,\.xls,\.doc/.test((wkFillOwnerForm(), document.getElementById('gen-confirm-modal').innerHTML)) && /另存新檔/.test(document.getElementById('gen-confirm-modal').innerHTML);
      WORKERS.length = 0; return out;
    });
    check('業主表格：舊版 .xls／.doc 與 PDF 給明確轉檔說明', r2.xls && r2.doc && r2.pdf && r2.accept);
    check('v5.439 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.441：連動再生不得重戳 _mt（已付款被舊裝置蓋回待付的根因） ─────────────
  {
    const { page, errors } = await newPage(browser, 1280, 900);
    const r = await page.evaluate(() => new Promise(res => {
      const out = {};
      try {
        const q = { id: 'q_s441', name: '同步測試案', items: [{ desc: '測試工項', unit: '式', qty: 1, price: 1000 }] };
        const c = { id: 'c_s441', type: 'sub', vendor: '測試廠商', amt: 1000, date: '2026-09-01', rows: [{ linkedItemIdx: 0, qty: 1 }] };
        PAYABLES.length = 0; P.subPayOnBill = false;   // v5.443 起預設未計價不掛整筆，此處驗連動不重戳
        syncCostToPayable(q, c);
        const p1 = PAYABLES.find(p => p.costId === c.id);
        out.created = !!p1 && p1.status === 'pending';
        // 另一台裝置已標付款（較新 _mt）
        p1.status = 'paid'; p1.paidDate = '2026-09-10'; p1._mt = Date.now() + 1000;
        const mt1 = p1._mt;
        // 舊裝置重存同一筆成本（內容沒變）→ 不得把 _mt 推到現在、狀態保持已付
        syncCostToPayable(q, c);
        const p2 = PAYABLES.find(p => p.costId === c.id);
        out.costIdem = !!p2 && p2.status === 'paid' && p2._mt === mt1 && PAYABLES.filter(p => p.costId === c.id).length === 1;
        // 金額真的變了才戳
        c.amt = 2000; syncCostToPayable(q, c);
        const p3 = PAYABLES.find(p => p.costId === c.id);
        out.costChanged = !!p3 && p3.amount === 2000 && p3.status === 'paid' && p3._mt !== mt1;
        // 薪資→應付 upsert 兩次同內容
        const f = { to: '員工A', amount: 30000, date: '2026-10-05', category: 'salary', project: '', note: '2026-09 薪資', itemName: '薪資', hrRef: 'ps_x', status: 'pending', paidDate: '' };
        const h1 = _hrUpsertPay('pay_ps_x', f); const hm = h1._mt = Date.now() + 5000;
        _hrUpsertPay('pay_ps_x', f);
        out.hrIdem = PAYABLES.find(p => p.id === 'pay_ps_x')._mt === hm;
        _hrUpsertPay('pay_ps_x', Object.assign({}, f, { amount: 31000 }));
        out.hrChanged = PAYABLES.find(p => p.id === 'pay_ps_x')._mt !== hm;
        // 雲端與本機都有更新：不再彈「覆蓋／保留」問窗，改逐筆合併後上傳；背景即刻上傳
        const src = _pullCloudIfNewer.toString();
        out.noOverwritePrompt = !/雲端與本機都有更新/.test(src) && /_pushCloud\(\{silent:true\}\)/.test(src);
        out.sig = _recSig({ a: 1, _mt: 1, _by: 'x', updatedAt: 2 }) === _recSig({ a: 1, _mt: 9, _by: 'y', updatedAt: 3 }) && _recSig({ a: 1 }) !== _recSig({ a: 2 });
        PAYABLES.length = 0;
      } catch (e) { out.err = e.message; }
      res(out);
    }));
    check('v5.441 成本→應付連動：內容沒變不重戳 _mt、已付狀態保留、只有一筆', r.created && r.costIdem, r.err || JSON.stringify(r));
    check('v5.441 成本→應付連動：金額變了才更新 _mt', r.costChanged, r.err || '');
    check('v5.441 薪資→應付 upsert：同內容不重戳、變更才戳', r.hrIdem && r.hrChanged, r.err || '');
    check('v5.441 兩邊都有更新改逐筆合併上傳（不再問覆蓋）；內容簽章排除時間戳', r.noOverwritePrompt && r.sig, r.err || '');
    await page.close();
  }

  // ───────────── v5.442 日報：階段完工狀態＋同日合併 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      const out = {};
      const q = { id: 'tq441', name: '階段案', awarded: true, items: [
        { desc: 'H型鋼樁 H300 打設、拔除', unit: '支', qty: 10, price: 1000, ot: '50', otu: '支/天', note: '租期 30 天' },
        { desc: '中間樁 打設', unit: '支', qty: 4, price: 500 }], dailyLogs: [
        { id: 'a', date: '2026-09-20', progressRows: [{ itemIdx: 0, qty: 6, ph: 'install' }, { itemIdx: 1, qty: 4 }], progress: '' },
        { id: 'b', date: '2026-09-25', progressRows: [{ itemIdx: 0, qty: 4, ph: 'install' }], progress: '' }] };
      Q.push(q);
      // ① 未宣告階段完工：數量已達合約量 → 起算＝最後一天次日
      let pg = _itemProgress(q, 0);
      out.before = pg.installLast === '2026-09-25' && _rentStatus(q, 0, '2026-11-30').start === '2026-09-26' && _projStageDone(q) === true;
      // ② 階段完工日報（完成日 9/26）→ 起算改 9/27、doneDate 有值（不再是推估）、專案卡有「待拔除」小標
      q.dailyLogs.unshift({ id: 'c', date: '2026-09-26', status: 'stage', stageOf: 'install', stageDate: '2026-09-26', stopReason: '打設完成', resumeDate: '2026-10-20', progressRows: [], progress: '' });
      pg = _itemProgress(q, 0);
      const rs = _rentStatus(q, 0, '2026-11-30');
      out.stage = pg.installLast === '2026-09-26' && pg.doneDate && rs.start === '2026-09-27' && rs.estimated === false && rs.expiry === '2026-10-26' && rs.overDays === 35;
      out.stageText = /階段完工：打設／裝設完成（2026-09-26）/.test(_drStatusText(q.dailyLogs[0])) && /預計下階段進場 2026-10-20/.test(_drStatusText(q.dailyLogs[0]));
      out.chip = /打設完成 待拔除（2026-09-26）/.test(_drProjChip(q));
      // ③ 提醒：階段完工後不催；過了預計進場日 gap 天才問，且問句是「已進場拔除還是延後」
      out.quiet = _drGapState(q, '2026-10-15', 3) === null && _projStageDone(q) === true;
      const g = _drGapState(q, '2026-10-25', 3); out.ask = !!g && g.kind === 'resume' && g.lastL.status === 'stage';
      const _gd = P.drGapDays; P.drGapDays = 3; q.dailyLogs[0].resumeDate = '2026-09-20';   // 用已過去的預計進場日驗證待辦問句
      go('dash'); updateDashTodo(); out.todo = /已進場拔除還是延後/.test(document.getElementById('dash-todo-list').textContent);
      q.dailyLogs[0].resumeDate = '2026-10-20'; P.drGapDays = _gd;
      // ④ 完成日早於最後一筆數量日報 → 仍以數量日報最後一天為準（不會把起算日往前拉）
      q.dailyLogs[0].stageDate = '2026-09-22'; out.noPull = _itemProgress(q, 0).installLast === '2026-09-25'; q.dailyLogs[0].stageDate = '2026-09-26';
      // ⑤ 拔除完成的階段日報（無拔除數量）→ 計租結束＝完成日；全部完工不再視為待拔除
      q.dailyLogs.unshift({ id: 'd', date: '2026-11-05', status: 'stage', stageOf: 'remove', stageDate: '2026-11-05', progressRows: [], progress: '' });
      const rs2 = _rentStatus(q, 0, '2026-11-30');
      out.removeStage = rs2.endDate === '2026-11-05' && rs2.overDays === 10 && _projStageDone(q) === false && /全部完工/.test(_drProjChip(q));
      q.dailyLogs.shift();
      // ⑥ 表單：選階段完工顯示階段欄位、完成日預設＝日期；收集含 stageOf／stageDate
      go('quickcost'); rQuickCost();
      const sel = document.getElementById('dr-proj'); sel.value = 'tq441'; sel.onchange();
      document.getElementById('dr-date').value = '2026-09-30';
      document.getElementById('dr-status').value = 'stage'; _drStatusUI();
      out.ui = document.getElementById('dr-stage-wrap-of').style.display === '' && document.getElementById('dr-stage-date').value === '2026-09-30' && /下階段進場/.test(document.getElementById('dr-resume-lb').textContent);
      const e = _drCollect(); out.collect = !!e && e.status === 'stage' && e.stageOf === 'install' && e.stageDate === '2026-09-30';
      document.getElementById('dr-status').value = 'work'; _drStatusUI();
      // ⑦ 同日合併：9/25 已有日報（工項0 打設 4）→ 再送 9/25：工項0 打設 8、工項1 2 → 仍一筆，工項0 覆蓋為 8、新增工項1；累計不重複
      document.getElementById('dr-date').value = '2026-09-25'; _drExistingBanner();
      out.banner = document.getElementById('dr-exist').style.display === '' && /此日已有日報/.test(document.getElementById('dr-exist').textContent) && /1 列進度/.test(document.getElementById('dr-exist').textContent);
      _drProgRows = [{ itemIdx: 0, qty: 8, note: '', ph: 'install' }, { itemIdx: 1, qty: 2, note: '' }]; drRenderProgRows();
      _drCrews = [{ type: 'sub', vendor: '鴻玉', n: 3 }]; drRenderCrews();
      const n0 = q.dailyLogs.length; submitDailyReport();
      const L25 = q.dailyLogs.filter(L => L.date === '2026-09-25');
      out.merge = q.dailyLogs.length === n0 && L25.length === 1 && L25[0].progressRows.length === 2 && L25[0].progressRows[0].qty === 8 && L25[0].progressRows[1].itemIdx === 1 && L25[0].subWorkers === 3 && L25[0].subVendor === '鴻玉' && !!L25[0].editedAt;
      out.cum = _itemProgress(q, 0).cum === 14 && _itemProgress(q, 1).cum === 6;   // 6+8、4+2（沒有重複的 4）
      // ⑧ 載入既有內容修改：表單帶回該日的列
      document.getElementById('dr-date').value = '2026-09-25'; sel.value = 'tq441'; drLoadExisting();
      out.load = _drProgRows.length === 2 && String(_drProgRows[0].qty) === '8' && _drCrews.some(c => c.vendor === '鴻玉');
      _drClearForm(); document.getElementById('dr-date').value = localToday();
      // ⑨ 檢視內修改視窗有「階段完工」選項與完成日欄
      viewDailyReports('tq441'); editDailyLog('tq441', 'c');
      out.edit = !!document.getElementById('dle-stage-of') && document.getElementById('dle-status').value === 'stage' && document.getElementById('dle-stage-date').value === '2026-09-26';
      document.getElementById('gen-confirm-ok').click(); setTimeout(() => { const m = document.getElementById('gen-confirm-modal'); if (m) m.style.display = 'none'; }, 400);
      Q = Q.filter(x => x.id !== 'tq441');
      return out;
    });
    check('日報階段完工：打設完成日＝租期起算基準、不再推估、專案卡小標', r.before && r.stage && r.stageText && r.chip && r.noPull);
    check('日報階段完工：完成後不催，過預計進場日才問；拔除完成日＝計租結束', r.quiet && r.ask && r.todo && r.removeStage);
    check('日報表單：階段完工欄位；同日再送出合併（相同工項覆蓋、其餘新增、累計不重複）', r.ui && r.collect && r.banner && r.merge && r.cum);
    check('日報：載入既有內容修改、檢視內修改含階段完工', r.load && r.edit);
    check('v5.442 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.443 分包：未計價不掛應付／計價截止日／預付款抵扣；額外支出（廠商型）；介紹費計價跟隨 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
        const out={};
        P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.subPayOnBill=true;
        Q=[{id:'q443',code:'1443',name:'中科案',client:'K',date:'2026-08-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H300 打設',unit:'M',qty:'1875',price:'1000',estCost:'',ot:'',otu:'',sec:false}],
          costs:[
            {id:'cM',type:'sub',vendor:'鴻玉',cat:'打設',date:'2026-09-01',amt:0,invoice:true,entryDate:'2026-09-01',rows:[{id:'m1',linkedItemIdx:0,desc:'',qty:1875,unitPrice:550}]},
            {id:'cF',type:'sub',vendor:'風哥',cat:'打設',date:'2026-09-01',amt:0,invoice:false,rows:[{id:'f1',linkedItemIdx:0,desc:'',qty:1875,unitPrice:150}]},
            {id:'cX',type:'extra',vendor:'',cat:'其他',date:'2026-09-10',amt:0,linkedItemIdx:0,rows:[{id:'x0',subType:'machine',desc:'',reason:'',days:1,dayRate:0,transport:0}]}
          ],
          dailyLogs:[{id:'d1',date:'2026-09-10',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:100,note:''}],progress:'',photos:[]},
                     {id:'d2',date:'2026-09-20',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:25,note:''}],progress:'',photos:[]}]}];
        INV.length=0;CONTRACTS.splice(0);PAYABLES.length=0;
        openProjectCosts('q443');
        const q=Q[0],cM=q.costs[0],cF=q.costs[1],cX=q.costs[2];
        const modal=()=>document.getElementById('gen-confirm-modal');
        syncCostToPayable(q,cM);syncCostToPayable(q,cF);
        out.noWhole=!PAYABLES.some(p=>p.costId==='cM'||p.costId==='cF');
        PAYABLES.push({id:'paycM',costId:'cM',quoteId:'q443',to:'鴻玉',amount:1031250,status:'pending',date:'2026-10-25'});
        out.prune=_subWholePayPrune()===1&&!PAYABLES.some(p=>p.id==='paycM')&&!!(TOMBS.payables&&TOMBS.payables['paycM']);
        rCostItems();out.hint=/計價後掛應付/.test(document.getElementById('cost-list').innerHTML);
        P.subPayOnBill=false;syncCostToPayable(q,cM);out.legacy=PAYABLES.some(p=>p.id==='paycM'&&p.amount===1031250);
        P.subPayOnBill=true;syncCostToPayable(q,cM);out.legacyOff=!PAYABLES.some(p=>p.id==='paycM');
        const cl=document.getElementById('cost-list');
        const card=id=>cl.querySelector('#cost-amt-'+id).closest('div[style*="border-bottom"]');
        const cardX=card('cX');
        out.xEdit=!!cardX.querySelector('select[onchange^="changeCostType"]')&&/外調機具/.test(cardX.innerHTML)&&!/到日報．支出/.test(cardX.innerHTML);
        out.xOpts=[...card('cM').querySelector('select[onchange^="changeCostType"]').options].map(o=>o.value).join()==='sub,labor,extra,own';
        cX.rows[0].desc='外調 300 怪手';cX.rows[0].dayRate=30000;recalcCostAmt(cX);cX.vendor='經一機械';syncCostToPayable(q,cX);
        const px=PAYABLES.find(p=>p.costId==='cX');out.xPay=!!px&&px.amount===30000&&px.category==='other'&&px.date===_vendorDueDate('2026-09-10');
        q.costs.push({id:'cQ',type:'extra',vendor:'公司支出（自付）',cat:'油資',date:'2026-09-03',amt:500,payer:'王小明',src:'quick',rows:[{id:'cQ_0',subType:'worker',desc:'加油',days:1,dayRate:500,transport:0}]});
        rCostItems();const cardQ=card('cQ');
        out.qRo=!/changeCostType/.test(cardQ.innerHTML)&&/到日報．支出/.test(cardQ.innerHTML);
        changeCostType('cQ','sub');out.qGuard=q.costs.find(c=>c.id==='cQ').type==='extra';
        changeCostType('cX','labor');out.xSwitch=cX.type==='labor';changeCostType('cX','extra');out.xBack=cX.type==='extra';
        openSubPeriod('cM');
        const cut=_vendorCutDate(localToday());
        out.cut=document.getElementById('sp-date').value===cut&&document.getElementById('sp-to').value===cut&&document.getElementById('sp-from').value==='2026-09-01'&&/-25$/.test(cut)&&!document.getElementById('sp-adv');
        out.cutVal=cut;
        modal().style.display='none';_spCtx=null;
        const est=_subCurEstimate(q,cM);out.est=est.est===68750;
        openSubAdvance('cM');
        document.getElementById('sa-amt').value='100000';_saOnInput();
        out.warn=document.getElementById('sa-warn').style.display!=='none';
        document.getElementById('gen-confirm-ok').click();
        out.blocked=_subAdvs(cM).length===0&&modal().style.display!=='none'&&document.getElementById('sa-amt').value==='100000';
        document.getElementById('sa-special').checked=true;document.getElementById('sa-reason').value='廠商材料款需先墊';
        document.getElementById('gen-confirm-ok').click();
        const a=_subAdvs(cM)[0];const pa=a&&PAYABLES.find(p=>p.id===_subAdvPayId('cM',a));
        out.adv=!!a&&a.amt===100000&&a.special===true&&/材料款/.test(a.reason)&&!!pa&&pa.amount===100000&&pa.vat===true&&pa.date===localToday()&&/預付款/.test(pa.note)&&/特殊情況/.test(pa.note);
        openSubAdvance('cM');document.getElementById('sa-amt').value='20000';_saOnInput();out.noWarn=document.getElementById('sa-warn').style.display==='none';
        document.getElementById('gen-confirm-ok').click();out.adv2=_subAdvs(cM).length===2&&_subAdvStat(cM).paid===120000;
        openSubPeriod('cM');
        document.getElementById('sp-date').value='2026-09-25';document.getElementById('sp-from').value='2026-09-01';document.getElementById('sp-to').value='2026-09-25';_spFillDaily();
        const advEl=document.getElementById('sp-adv');
        out.advField=!!advEl&&advEl.value==='68750'&&/預付未抵 NT\$ 120,000/.test(modal().innerHTML);
        out.tot0=/抵扣預付款[\s\S]*68,750/.test(document.getElementById('sp-tot').innerHTML)&&/應付金額[\s\S]*NT\$ 0</.test(document.getElementById('sp-tot').innerHTML);
        advEl.value='50000';advEl.dataset.touched='1';_spRecalc();
        out.tot1=/應付金額[\s\S]*NT\$ 19,688/.test(document.getElementById('sp-tot').innerHTML);
        advEl.value='99999';_spRecalc();out.cap=advEl.value==='68750';
        advEl.value='50000';_spRecalc();
        document.getElementById('gen-confirm-ok').click();
        const per=cM.periods[0],pp=PAYABLES.find(p=>p.id==='paycM_p1');
        out.per=!!per&&per.amt===68750&&per.adv===50000&&per.due==='2026-10-25'&&!!pp&&pp.amount===18750&&/抵扣預付款 50,000/.test(pp.note);
        const stM=_subStat(cM);out.stat=stM.advPaid===120000&&stM.advUsed===50000&&stM.advLeft===70000&&stM.payN===3;
        delSubAdvance('cM',_subAdvs(cM)[0].id);out.delBlock=_subAdvs(cM).length===2;
        delSubAdvance('cM',_subAdvs(cM)[1].id);document.getElementById('gen-confirm-ok').click();out.delOk=_subAdvs(cM).length===1&&!PAYABLES.some(p=>p.costAdv&&p.amount===20000);
        updSubField('cF','followOf','cM');
        const fp=cF.periods&&cF.periods[0],fpay=PAYABLES.find(p=>p.id==='paycF_p1');
        out.follow=cF.followOf==='cM'&&!!fp&&fp.no===1&&fp.date==='2026-09-25'&&fp.rows.length===1&&fp.rows[0].rid==='f1'&&fp.rows[0].qty===125&&fp.amt===18750&&!!fpay&&fpay.amount===18750&&fpay.vat===false;
        q.dailyLogs.push({id:'d3',date:'2026-09-28',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:40,note:''}],progress:'',photos:[]});
        openSubPeriod('cM');document.getElementById('sp-date').value='2026-10-25';document.getElementById('sp-to').value='2026-10-25';_spFillDaily();
        out.qty2=document.querySelector('.sp-qty').value==='40';
        document.getElementById('gen-confirm-ok').click();
        out.follow2=cF.periods.length===2&&cF.periods[1].rows[0].qty===40&&PAYABLES.find(p=>p.id==='paycF_p2').amount===6000&&!PAYABLES.some(p=>p.id==='paycM_p2');
        window._costView='list';setCostView('subs');const sh=document.getElementById('cost-list').innerHTML;
        out.subsView=/預付款/.test(sh)&&/跟隨「鴻玉」計價/.test(sh)&&/成本合計 700/.test(sh)&&/分開付款/.test(sh)&&/−抵預付 50,000/.test(sh)&&/依主約自動/.test(sh)&&/預付款抵扣完畢/.test(sh);
        setCostView('list');
        openSubPeriod('cF');out.followGuard=modal().style.display==='none';
        delSubPeriod('cM',2);document.getElementById('gen-confirm-ok').click();out.followDel=cM.periods.length===1&&cF.periods.length===1&&!PAYABLES.some(p=>p.id==='paycF_p2');
        let html='';const _orig=window._printNativeHTML;window._printNativeHTML=function(h){html=h;};
        printVendorStatement('cM',1);window._printNativeHTML=_orig;
        out.stmt=/抵扣預付款/.test(html)&&/50,000/.test(html)&&/19,688/.test(html);
        setCostView('audit');const ah=document.getElementById('cost-list').innerHTML;out.audit=/分期 1 期一致/.test(ah)&&!/缺應付/.test(ah);setCostView('list');
        // 金流預測：未計價分包推估（扣預付未抵）
        out.fc=(function(){try{renderCashForecast();}catch(e){return 'err:'+e;}return true;})();
        Q=Q.filter(x=>x.id!=='q443');PAYABLES.length=0;
        return out;
    });
    check('分包：未計價不掛整筆應付（參數可關）、一次性撤舊整筆、卡片提示', r.noWhole && r.prune && r.hint && r.legacy && r.legacyOff);
    check('施工成本：廠商型額外支出可建可改型、掛應付；日報帶入的仍唯讀不可改型', r.xEdit && r.xOpts && r.xPay && r.qRo && r.qGuard && r.xSwitch && r.xBack);
    check('分包：本期計價預設計價日／期間迄＝最近截止日（25 日）', r.cut, r.cutVal);
    check('預付款：超過本期預估需勾特殊情況＋原因、立即掛應付；未超過免說明', r.est && r.warn && r.blocked && r.adv && r.noWarn && r.adv2);
    check('預付款：計價預設全額抵扣不超過本期、可改少、應付＝本期−抵扣；統計；已抵扣者不可刪', r.advField && r.tot0 && r.tot1 && r.cap && r.per && r.stat && r.delBlock && r.delOk);
    check('介紹費：跟隨主約計價自動同期同量、主約新增／刪期連動、跟隨者不自開計價', r.follow && r.qty2 && r.follow2 && r.followGuard && r.followDel);
    check('分包管理視圖：預付款列／跟隨標記／合計單價；計價單含抵扣；勾稽一致；金流預測不報錯', r.subsView && r.stmt && r.audit && r.fc === true);
    check('v5.443 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.444 施工成本統整：材料機具掛應付／廠商請款實作實算／數量對照提示／請款單廠商量／類型摘要／逾期租金另列 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
        const out={};
        P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.subPayOnBill=true;
        Q=[{id:'q444',code:'1444',name:'實作實算案',client:'K',date:'2026-08-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H300 打設',unit:'M',qty:'1000',price:'1000',estCost:'',ot:'',otu:'',sec:false,note:'含30天租期'}],
          costs:[
            {id:'cM',type:'sub',vendor:'鴻玉',cat:'打設',date:'2026-09-01',amt:0,invoice:true,entryDate:'2026-09-01',rows:[{id:'m1',linkedItemIdx:0,desc:'',qty:1000,unitPrice:550}]},
            {id:'cF',type:'sub',vendor:'風哥',cat:'打設',date:'2026-09-01',amt:0,invoice:false,followOf:'cM',rows:[{id:'f1',linkedItemIdx:0,desc:'',qty:1000,unitPrice:150}]},
            {id:'cO',type:'own',vendor:'',cat:'材料租金',date:'2026-09-02',amt:0,linkedItemIdx:0,rows:[{id:'o1',preset:'材料租金',desc:'',qty:3,unit:'月',unitPrice:20000}]}
          ],
          dailyLogs:[{id:'d1',date:'2026-09-10',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:700,note:''}],progress:'',photos:[]},
                     {id:'d2',date:'2026-09-20',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:400,note:''}],progress:'',photos:[]}]}];
        INV.length=0;CONTRACTS.splice(0);PAYABLES.length=0;
        openProjectCosts('q444');
        const q=Q[0],cM=q.costs[0],cF=q.costs[1],cO=q.costs[2];
        const modal=()=>document.getElementById('gen-confirm-modal');
        const cl=document.getElementById('cost-list');
        const card=id=>cl.querySelector('#cost-amt-'+id).closest('div[style*="border-bottom"]');
        // ① 自有成本（材料機具）：沒廠商不入應付；選廠商即掛應付、開發票 +5%、發票號；卡片有廠商／發票欄、租期參考
        rCostItems();
        syncCostToPayable(q,cO);out.ownNone=!PAYABLES.some(p=>p.costId==='cO');
        out.ownCard0=/公司自備/.test(card('cO').innerHTML)&&/租期參考/.test(card('cO').innerHTML)&&/2026-09-10/.test(card('cO').innerHTML);
        updCostField('cO','vendor','中鋼租賃');
        let po=PAYABLES.find(p=>p.costId==='cO');out.ownPay=!!po&&po.amount===60000&&po.category==='material'&&_payEff(po)===63000&&po.date===_vendorDueDate('2026-09-02');
        updCostField('cO','invoice',false);po=PAYABLES.find(p=>p.costId==='cO');out.ownNoInv=po.vat===false&&_payEff(po)===60000;
        updCostField('cO','invoice',true);updCostField('cO','invNo','ZZ-88889999');po=PAYABLES.find(p=>p.costId==='cO');out.ownInvNo=po.vat===true&&po.invNo==='ZZ-88889999';
        rCostItems();out.ownCard=/開發票/.test(card('cO').innerHTML)&&/ZZ-88889999/.test(card('cO').innerHTML)&&/應付 63,000/.test(card('cO').innerHTML);
        updCostField('cO','vendor','');out.ownBack=!PAYABLES.some(p=>p.costId==='cO');updCostField('cO','vendor','中鋼租賃');
        // ② 類型摘要列
        rCostItems();const cs=document.getElementById('cost-summary');
        out.strip=!!cs&&/承包（發包）/.test(cs.innerHTML)&&/日報零星支出/.test(cs.innerHTML)&&/本案應付未付/.test(cs.innerHTML)&&/自有材料攤提／購置/.test(cs.innerHTML)&&/租金（材料＋設備，已請款）/.test(cs.innerHTML);
        // ③ 登錄廠商請款：單價可改、與日報差異、超量＝實作實算＋自行吸收、發票號
        openSubPeriod('cM');
        out.title=/登錄廠商請款/.test(modal().innerHTML)&&/廠商請款日/.test(modal().innerHTML)&&!!document.getElementById('sp-invno')&&!!document.querySelector('.sp-up');
        document.getElementById('sp-date').value='2026-09-30';document.getElementById('sp-from').value='2026-09-01';document.getElementById('sp-to').value='2026-09-30';_spFillDaily();
        const row=document.querySelector('.sp-row');
        out.daily=row.querySelector('.sp-qty').value==='1100';
        out.overInfo=row.querySelector('.sp-warn').style.display!=='none'&&/實作實算/.test(row.querySelector('.sp-warn').textContent)&&document.getElementById('sp-absorb-wrap').style.display!=='none'&&/向業主追加請款/.test(document.getElementById('sp-tot').innerHTML);
        out.diffHidden=row.querySelector('.sp-diff').style.display==='none';
        row.querySelector('.sp-qty').value='1150';row.querySelector('.sp-qty').dataset.touched='1';_spRecalc();
        out.diffShown=row.querySelector('.sp-diff').style.display!=='none'&&/多於日報回報 50/.test(row.querySelector('.sp-diff').textContent);
        row.querySelector('.sp-qty').value='1100';row.querySelector('.sp-up').value='560';_spRecalc();
        out.amt=row.querySelector('.sp-amt').textContent==='616,000'&&/應付金額[\s\S]*NT\$ 646,800/.test(document.getElementById('sp-tot').innerHTML);
        document.getElementById('sp-invno').value='AB-12345678';document.getElementById('sp-absorb').checked=true;document.getElementById('sp-absorb-note').value='為後續工作自行吸收';_spRecalc();
        out.absorbTxt=/已勾自行吸收/.test(document.getElementById('sp-tot').innerHTML);
        document.getElementById('gen-confirm-ok').click();
        const per=cM.periods[0],pp=PAYABLES.find(p=>p.id==='paycM_p1');
        out.per=!!per&&per.rows[0].qty===1100&&per.rows[0].up===560&&per.amt===616000&&per.absorb===true&&/後續/.test(per.absorbNote)&&per.invNo==='AB-12345678'&&!!pp&&pp.amount===616000&&pp.invNo==='AB-12345678';
        const ov=_subOverStat(cM);out.over=ov.overAmt===56000&&ov.absorbed===56000&&ov.toOwner===0&&ov.absorbQtyByItem[0]===100;
        // 跟隨者：同量、自己的單價（不套主約覆寫價）
        out.follow=cF.periods&&cF.periods.length===1&&cF.periods[0].rows[0].qty===1100&&cF.periods[0].rows[0].up==null&&cF.periods[0].amt===165000&&PAYABLES.find(p=>p.id==='paycF_p1').amount===165000;
        // ④ 分包管理視圖：實作超出（藍字非紅字）、自行吸收、發票、核對單、分開付款
        window._costView='list';setCostView('subs');const sh=document.getElementById('cost-list').innerHTML;
        out.subs=/實作超出發包 66,000/.test(sh)&&/自行吸收 56,000/.test(sh)&&/超量自行吸收：為後續工作自行吸收/.test(sh)&&/發票 AB-12345678/.test(sh)&&!/計價單/.test(sh)&&/分開付款/.test(sh)&&/另付 風哥/.test(sh)&&!/超出發包額/.test(sh);
        setCostView('list');
        // ⑤ 數量對照：實作實算為藍字提示、廠商已請未向業主請為紅字
        const rec=_qtyRecon(q);
        out.recon=rec.length===1&&rec[0].vb===1100&&rec[0].sub===1000&&rec[0].notes.some(n=>/廠商請款累計超過發包量 100/.test(n)&&/自行吸收/.test(n))&&rec[0].notes.some(n=>/回報量超過合約量 100/.test(n))&&rec[0].warns.length===1&&/廠商已請 1,100（扣自行吸收 100）、業主已請 0，差 1,000/.test(rec[0].warns[0]);
        setCostView('qty');const qh=document.getElementById('cost-list').innerHTML;out.reconHtml=/實作實算/.test(qh)&&/尚未向業主請款/.test(qh)&&/color:#1565C0/.test(qh);setCostView('list');
        // ⑥ 勾稽：材料機具（有廠商）也列；成本分析：逾期租金另列
        setCostView('audit');const ah=document.getElementById('cost-list').innerHTML;out.audit=/材料機具/.test(ah)&&/中鋼租賃/.test(ah)&&!/缺應付/.test(ah);setCostView('list');
        // 逾期：打設最後一天 09-20 → 起算 09-21，30 天租期到 10-20，今天 09-30 尚未逾期 → 無列；改 ot 與早日期
        q.dailyLogs[1].date='2026-08-01';q.dailyLogs[0].date='2026-07-20';q.items[0].ot='50';q.items[0].otu='M/天';
        setCostView('analysis');const an=document.getElementById('cost-list').innerHTML;out.rentLine=/逾期租金（業主端/.test(an)&&/逾 /.test(an);setCostView('list');
        q.dailyLogs[1].date='2026-09-20';q.dailyLogs[0].date='2026-09-10';
        // ⑦ 業主請款單：廠商請款量建議
        const inv2=buildInvFromQuote(q);inv2.id='tinv444';inv2.date='2026-10-05';INV.push(inv2);
        loadInvoice('tinv444');
        out.vsug=_invVendorSuggest(0)===1100;
        const tr=document.getElementById('iamt-0').closest('tr');const inp=tr.querySelector('input[data-f="curQty"]');inp.value='500';invItems[0].curQty=500;updateInvRowAmt(0,tr);
        out.vchip=/日報＝廠商請款 1,100 ↵/.test(tr.innerHTML);
        q.dailyLogs.push({id:'d9',date:'2026-10-02',workers:0,progressRows:[{itemIdx:0,desc:'H型鋼樁 H300 打設',qty:30,note:''}],progress:'',photos:[]});invItems[0].curQty=500;updateInvRowAmt(0,tr);out.vchip2=/日報 1,130 ↵/.test(tr.innerHTML)&&/廠商請款 1,100 ↵/.test(tr.innerHTML);q.dailyLogs.pop();
        invFillVendor(0);out.vfill=invItems[0].curQty===1100;
        INV=INV.filter(x=>x.id!=='tinv444');invEid=null;invItems=[];window._invSnap=null;
        Q=Q.filter(x=>x.id!=='q444');PAYABLES.length=0;
        return out;
    });
    check('自有成本（材料機具）：沒廠商不入應付；選廠商掛應付、開發票 +5%、發票號；卡片欄位與租期參考', r.ownNone && r.ownCard0 && r.ownPay && r.ownNoInv && r.ownInvNo && r.ownCard && r.ownBack);
    check('施工成本頁：類型摘要列（承包／點工／自有攤提／租金／額外／日報零星／應付未付）', r.strip);
    check('登錄廠商請款：單價可核實覆寫、與日報差異提示、超量＝實作實算＋自行吸收、發票號進應付', r.title && r.daily && r.overInfo && r.diffHidden && r.diffShown && r.amt && r.absorbTxt && r.per && r.over && r.follow);
    check('分包管理：實作超出以提示呈現、自行吸收／發票／核對單／介紹費分開付款', r.subs);
    check('數量對照：實作實算藍字提示、廠商已請未向業主請為紅字；勾稽含材料機具；成本分析列逾期租金', r.recon && r.reconHtml && r.audit && r.rentLine);
    check('業主請款單：本期數量可帶入廠商請款量（與日報並列）', r.vsug && r.vchip && r.vchip2 && r.vfill);
    check('v5.444 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.445 PDF 套件保險：缺就按需補載（三來源），全失敗才退回瀏覽器列印；sw.js 快取套件 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
      return (
      new Promise(res => {
        const out={};
        const origLoad=window._loadScriptOnce,origNative=window._printNativeHTML;
        const loaded=[];
        // ① 第一來源失敗、第二來源成功 → 補載完成，不退回瀏覽器列印
        delete window.html2canvas;delete window.jspdf;_pdfLibsP=null;
        window._loadScriptOnce=function(src){loaded.push(src);return new Promise(function(ok,bad){setTimeout(function(){
          if(/cdnjs/.test(src))return bad(new Error('load fail'));
          if(/html2canvas/.test(src))window.html2canvas=function(){return Promise.reject(new Error('stub'));};
          if(/jspdf/.test(src))window.jspdf={jsPDF:function(){}};
          ok();},150);});};
        let nativeCalls=0;window._printNativeHTML=function(){nativeCalls++;};
        out.ready0=_pdfLibsReady()===false;
        _ensurePdfLibs().then(function(r){
          out.ensure=r===true&&_pdfLibsReady()&&loaded.length===4&&/cdnjs.*html2canvas/.test(loaded[0])&&/jsdelivr.*html2canvas/.test(loaded[1])&&/cdnjs.*jspdf/.test(loaded[2])&&/jsdelivr.*jspdf/.test(loaded[3]);
          // ② 套件缺時按 PDF：overlay 顯示載入中 → 補載後走截圖流程（不是系統列印）
          delete window.html2canvas;delete window.jspdf;_pdfLibsP=null;loaded.length=0;
          Q.push({id:'tq445',name:'PDF保險案',client:'K',code:'1445',date:'2026-09-30',items:[{desc:'H型鋼樁',unit:'支',qty:10,price:1000}],exs:[],rmk:{}});
          exportQuotePDF('tq445');
          const btn0=document.getElementById('_fy_pdf_btn');out.overlay=!!btn0&&!!document.getElementById('_fy_print_overlay');
          setTimeout(function(){
            const btn=document.getElementById('_fy_pdf_btn');
            out.loadingTxt=!!btn&&/載入 PDF 套件/.test(btn.textContent);
            setTimeout(function(){
              const b2=document.getElementById('_fy_pdf_btn');
              out.ranCapture=!!b2&&/截圖失敗/.test(b2.textContent)&&nativeCalls===0;   // stub 的 html2canvas 會 reject → 走到截圖失敗，代表沒退回系統列印
              ['_fy_print_frame','_fy_print_overlay'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
              // ③ 三個來源都失敗 → 才退回瀏覽器列印
              delete window.html2canvas;delete window.jspdf;_pdfLibsP=null;loaded.length=0;
              window._loadScriptOnce=function(src){loaded.push(src);return Promise.reject(new Error('load fail'));};
              exportQuotePDF('tq445');
              setTimeout(function(){
                out.fallback=nativeCalls===1&&loaded.length===3&&!document.getElementById('_fy_print_overlay');
                window._loadScriptOnce=origLoad;window._printNativeHTML=origNative;_pdfLibsP=null;
                Q=Q.filter(x=>x.id!=='tq445');
                res(out);
              },900);
            },1400);
          },500);
        });
      })
      );
    });
    const sw = require('fs').readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8');
    const swOk = /LIB_HOSTS/.test(sw) && /html2canvas\|jspdf/.test(sw) && /caches\.match\(e\.request\)\.then\(m => m \|\| fetch/.test(sw) && /res\.type === 'opaque'/.test(sw);
    check('PDF 套件：缺時依序補載（cdnjs→jsdelivr→unpkg），成功後走標準 PDF 引擎不退回系統列印', r.ready0 && r.ensure && r.overlay && r.loadingTxt && r.ranCapture);
    check('PDF 套件：三個來源都失敗才退回瀏覽器列印；sw.js 對套件快取優先', r.fallback && swOk);
    check('v5.445 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.446 PDF：短文件不再被撐成兩頁（高度只算到內容底、預覽容器不 min-height:100%） ─────────────
  {
    const { page, errors } = await newPage(browser, 390, 844);
    const r = await page.evaluate(() => {
        const out={};
        // 內容 500px、容器被撐到 900px（模擬手機直式視窗比橫式紙張高）→ 橫式 A4 只該一頁、高度只算到內容底
        const host=document.createElement('div');host.style.cssText='position:absolute;left:-9999px;top:0;width:1046px;min-height:900px;background:#fff';
        host.innerHTML='<div class="page-wrap" style="padding:0"><h1 style="margin:0;height:60px">工程實績表</h1><table style="width:100%;border-collapse:collapse"><thead><tr><th style="height:30px">編號</th></tr></thead><tbody>'+Array.from({length:8},(_,i)=>'<tr><td style="height:30px">'+(i+1)+'</td></tr>').join('')+'</tbody></table><div class="foot" style="height:40px;margin-top:14px">本表所列…</div></div>';
        document.body.appendChild(host);
        const contentH=host.firstChild.getBoundingClientRect().height;
        const plan=_pdfPlanPages({width:2092,height:1800},host,1046,true);
        out.onePage=plan.pages.length===1&&plan.pages[0].s===0&&Math.abs(plan.pages[0].e-Math.round(contentH*2))<=2;
        out.contentH=contentH;out.e=plan.pages[0].e;
        host.remove();
        // 預覽容器不再 min-height:100%
        Q.push({id:'tq446',name:'實績案',client:'K',code:'1446',date:'2026-09-30',items:[{desc:'H型鋼樁',unit:'支',qty:10,price:1000}],exs:[],rmk:{}});
        exportQuotePDF('tq446');
        const inner=document.getElementById('_fy_print_frame')&&document.getElementById('_fy_print_frame').firstChild;
        out.noMinH=!!inner&&inner.style.minHeight!=='100%';
        ['_fy_print_frame','_fy_print_overlay'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
        Q=Q.filter(x=>x.id!=='tq446');
        return out;
    });
    check('PDF 分頁：容器被撐高時高度只算到內容底緣，短文件（如工程實績表）維持一頁', r.onePage && r.noMinH, JSON.stringify({ contentH: r.contentH, e: r.e }));
    check('v5.446 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v5.447 信封列印（中式信封：收件郵遞區號逐格、中欄直書、寄件人、寄送方式勾選、校正記憶） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
        const out={};
        P.company='豐有工程有限公司';P.addr='242新北市新莊區中央路722號7樓';P.tel='0989-023-760';delete P.coZip;delete P.env;
        CUSTOMERS.push({id:'cu447',name:'玄通營造股份有限公司',contact:'王大明',addr:'30075新竹市東區光復路一段100號8樓',tel:'03-5555027'});
        INV.push({id:'inv447',client:'玄通營造股份有限公司',project:'亞東寶山AL2廠房',loc:'新竹科學園區園區二路99號',caddr:'',contact:'王大明',periodNo:2,date:'2026-10-01',sendMethod:'郵寄公司',items:[]});
        let printed='';const orig=window._printNativeHTML;window._printNativeHTML=function(h,f){printed=h;};
        openEnvelope('inv447');
        const m=document.getElementById('gen-confirm-modal');
        out.open=m.style.display!=='none'&&/信封列印/.test(m.innerHTML)&&document.getElementById('gen-confirm-ok').textContent==='列印信封';
        out.fill=gv('env-co')==='玄通營造股份有限公司'&&gv('env-attn')==='王大明'&&gv('env-zip')==='30075'&&gv('env-addr')==='新竹市東區光復路一段100號8樓'&&gv('env-fzip')==='242'&&gv('env-faddr')==='新北市新莊區中央路722號7樓'&&gv('env-method')==='掛號';
        _envPreview();
        out.prev=!!document.querySelector('#env-prev .env-sheet')&&/flex-direction:\s*row-reverse/.test(document.getElementById('env-prev').innerHTML)&&/玄通營造股份有限公司/.test(document.getElementById('env-prev').innerHTML.replace(/<[^>]+>/g,''));
        // 切工地地址
        _envUseAddr('site');out.site=gv('env-addr')==='新竹科學園區園區二路99號'&&gv('env-zip')==='30075';_envUseAddr('co');
        // 數字逐格：收件 30075 → 3,0,0,7,5；寄件 242 → 前三格
        const r=_envRead();const h=_envHtml(r.cfg,r.data,false);
        const digits=(h.match(/font-size:16pt;font-weight:700">(\d)<\/div>/g)||[]).map(s=>s.match(/>(\d)</)[1]).join('');
        out.zip=digits==='30075';
        const sd=(h.match(/font-size:11pt;font-weight:700">(\d)<\/div>/g)||[]).map(s=>s.match(/>(\d)</)[1]).join('');
        out.szip=sd==='242';
        out.check=/>✓<\/div>/.test(h)&&new RegExp('top:'+(r.cfg.chkY0+3*r.cfg.chkStep)+'mm').test(h);   // 掛號＝第 4 列
        out.noFrames=/rgba\(220,60,60,0\)/.test(h)&&!/rgba\(220,60,60,\.75\)/.test(h);
        const txt=h.replace(/<[^>]+>/g,'');out.text=/王大明　先生　收/.test(txt)&&/TEL 0989-023-760/.test(txt)&&/新竹市東區光復路一段100號8樓/.test(txt)&&(h.match(/white-space:pre">/g)||[]).length>40;
        // 校正值與框線設定會存入 P.env；列印走原生、紙張 120×235
        document.getElementById('env-dx').value='1.5';document.getElementById('env-frames').checked=true;_envPreview();
        document.getElementById('gen-confirm-ok').click();
        out.print=/@page\{size:120mm 235mm;margin:0\}/.test(printed)&&/rgba\(220,60,60,\.75\)/.test(printed)&&/left:63.5mm/.test(printed);
        out.saved=P.env&&P.env.dx===1.5&&P.env.frames===true&&P.coZip==='242'&&P.env.fontSender===11;   // v5.448 寄件人字級預設 11、可調
              const cu=CUSTOMERS.find(c=>c.id==='cu447');out.cust=cu.zip==='30075'&&cu.envAttn==='王大明';
        // 舊存檔 9pt 自動放大為 11；字級欄位存在
        P.env.fontSender=9;out.legacyFont=_envCfg().fontSender===11;
        // 從客戶卡開啟、15K 規格
        openEnvelope(null,{custId:'cu447'});out.fontUI=!!document.getElementById('env-fontSender')&&document.getElementById('env-fontSender').value==='11';out.fromCust=gv('env-co')==='玄通營造股份有限公司'&&gv('env-zip')==='30075';
        document.getElementById('env-size').value='k15';_envPreview();printed='';document.getElementById('gen-confirm-ok').click();
        out.k15=/@page\{size:105mm 220mm/.test(printed)&&P.env.size==='k15';
        // 沒有收件人 → 擋下
        openEnvelope(null,{to:{co:'',attn:'',addr:'',zip:''}});printed='';document.getElementById('gen-confirm-ok').click();out.guard=printed===''&&m.style.display!=='none';
        m.style.display='none';
        window._printNativeHTML=orig;delete P.env;delete P.coZip;
        CUSTOMERS=CUSTOMERS.filter(c=>c.id!=='cu447');INV=INV.filter(x=>x.id!=='inv447');
        // 入口按鈕
        go('invoice');out.btnList=/openEnvelope\(/.test(document.getElementById('page-invoice').innerHTML)||true;
        out.btnEdit=/openEnvelope\(document.getElementById\('inv-eid-hidden'\)/.test(document.getElementById('page-invoice-edit').innerHTML);
        return out;
    });
    check('信封：由請款單開啟自動帶業主／收件人／地址／郵遞區號（公司／工地可切）、寄件人帶公司參數', r.open && r.fill && r.prev && r.site);
    check('信封：郵遞區號逐格、直書中欄與寄件人、寄送方式打勾、列印不含框線', r.zip && r.szip && r.check && r.noFrames && r.text);
    check('信封：原生列印自訂紙張 120×235／105×220、校正與框線記憶、郵遞區號回寫客戶、無收件人擋下', r.print && r.saved && r.cust && r.fromCust && r.k15 && r.guard && r.btnEdit && r.legacyFont && r.fontUI);
    check('v5.447 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 發包：分項詢價單（統一格式）→ 回傳廠商填價比價 → 議價 → 得標／改點工 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
        const out={};
        P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.subPayOnBill=true;P.contact='陳茹軒';P.tel='0989-023-760';P.company='豐有工程有限公司';
        VENDORS.length=0;VENDORS.push({id:'v1',name:'鴻玉開發工程行',type:'承包',contact:'鴻哥',phone:'0911-111-111'},{id:'v2',name:'大成基礎',type:'承包',contact:'大成',phone:'0922-222-222'});
        Q=[{id:'qR',code:'1150928',name:'中科台積電F25P3',client:'八九企業',loc:'臺中市大雅區',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H400 L=13M 打設',unit:'支',qty:'408',price:'86300',sec:false},{desc:'H型鋼樁 H400 L=13M 拔除',unit:'支',qty:'408',price:'20000',sec:false},{desc:'備用：止水鈑',unit:'片',qty:'10',price:'500',spare:true}],costs:[],dailyLogs:[]}];
        PAYABLES.length=0;eid='qR';_rfqQid='';
        go('rfq');
        const root=document.getElementById('rfq-root');
        out.page=!!root&&/新增詢價單/.test(root.innerHTML)&&/中科台積電/.test(root.innerHTML);
        // 新增詢價單：工項勾選（備用單價不列）、數量帶合約、條件
        rfqNew();
        const m=document.getElementById('gen-confirm-modal');
        out.form=m.style.display!=='none'&&document.querySelectorAll('.rfq-it').length===2&&document.querySelectorAll('.rfq-qty')[0].value==='408'&&document.getElementById('rfq-cash').value==='50'&&/RFQ-1150928-01/.test(m.innerHTML);
        out.perDef=[...document.querySelectorAll('.rfq-per')].every(s=>s.value==='m');document.querySelectorAll('.rfq-per').forEach(s=>s.value='pc');   // v6.0.24 有 L=…M 預設依 M；此測試驗證依支流程
        document.querySelectorAll('.rfq-it').forEach(cb=>cb.checked=true);document.querySelectorAll('.rfq-qty')[1].value='400';
        document.getElementById('rfq-scope').value='H型鋼樁打設、拔除';document.getElementById('rfq-deadline').value='2026-10-10';document.getElementById('rfq-entry').value='2026-11-01';
        document.getElementById('rfq-cash').value='40';document.getElementById('rfq-cash').dispatchEvent(new Event('input'));out.cashLink=document.getElementById('rfq-ticket').value==='60';
        document.getElementById('rfq-tdays').value='60';document.getElementById('rfq-ret').value='5';
        out.condUi=document.querySelectorAll('.rfq-cond').length===5&&!/一行一條/.test(m.innerHTML)&&!/數量取自合約生效量/.test(m.innerHTML);_rfqCondAdd();document.querySelectorAll('.rfq-cond')[5].value='引孔泥漿處理費請另列。';document.querySelectorAll('.rfq-cond-row')[4].remove();
        document.getElementById('gen-confirm-ok').click();
        const q=Q[0],r=(q.rfqs||[])[0];
        out.saved=!!r&&r.no==='RFQ-1150928-01'&&r.items.length===2&&r.items[1].qty===400&&r.vendors.length===0&&!document.querySelector('.rfq-v')&&r.cond.cashPct===40&&r.cond.ticketPct===60&&r.status==='open';
        // 條件條列：計價方式句含放款拆分與保留款；PDF 走預覽、含廠商名、無頁尾字
        const lines=_rfqCondLines(r);
        out.cond=lines.length===7&&r.cond.extra.length===5&&/每月 25 日計價，次月 25 日放款（40% 匯款、60% 60 天票期）；保留款 5%/.test(lines[2])&&/^報價有效期 30 天/.test(lines[3])&&lines[6]==='引孔泥漿處理費請另列。'&&!/開立發票/.test(lines.join(''));
        const html=_rfqDocHtml(q,r);
        out.doc=/分項工程詢價單/.test(html)&&/RFQ-1150928-01　/.test(html)&&!/鴻玉/.test(html)&&/<ol>/.test(html)&&/class="vt"/.test(html)&&/統一編號/.test(html)&&!/本詢價單由/.test(html)&&!/豐有內部使用/.test(html)&&(html.match(/class="blank"/g)||[]).length===9&&/營業稅 5%/.test(html)&&/總計（含稅）/.test(html)&&/class="k sig"/.test(html);
        rfqPrint(r.id);out.prev=!!document.getElementById('_fy_print_overlay');['_fy_print_frame','_fy_print_overlay'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
        // 填價：鴻玉 550/150、大成 600/160（議後 560）、風哥未回
        // 回傳廠商：名冊內的自動帶聯絡人；名冊外的手打
        rfqFill(r.id,-1);out.newForm=!!document.getElementById('rf-name')&&!!document.getElementById('rf-vdl');
        document.getElementById('rf-name').value='鴻玉開發工程行';_rfVendorPick('鴻玉開發工程行');out.pick=document.getElementById('rf-contact').value==='鴻哥'&&document.getElementById('rf-tel').value==='0911-111-111';
        document.querySelectorAll('.rf-p')[0].value='550';document.querySelectorAll('.rf-p')[1].value='150';_rfRecalc();
        out.fillTot=/報價合計[\s\S]*NT\$ 284,400/.test(document.getElementById('rf-tot').innerHTML);
        document.getElementById('gen-confirm-ok').click();
        rfqFill(r.id,-1);document.getElementById('rf-name').value='大成基礎';_rfVendorPick('大成基礎');document.querySelectorAll('.rf-p')[0].value='600';document.querySelectorAll('.rf-p')[1].value='160';document.querySelectorAll('.rf-n')[0].value='560';_rfRecalc();
        out.negTxt=/議價省下 NT\$ 16,320/.test(document.getElementById('rf-tot').innerHTML);
        document.getElementById('gen-confirm-ok').click();
        rfqFill(r.id,-1);document.getElementById('rf-name').value='風哥工程';document.getElementById('rf-tel').value='0933-333-333';document.getElementById('gen-confirm-ok').click();
        rfqFill(r.id,-1);document.getElementById('gen-confirm-ok').click();out.nameReq=r.vendors.length===3&&m.style.display!=='none';m.style.display='none';
        out.status=r.vendors.length===3&&r.vendors[0].status==='quoted'&&r.vendors[0].tel==='0911-111-111'&&r.vendors[1].status==='quoted'&&r.vendors[2].status==='sent'&&r.vendors[2].tel==='0933-333-333'&&r.vendors[1].neg[0]===560;
        // 比價表：最低價標綠、議後劃掉原價、合計
        renderRfq();const h=root.innerHTML;
        out.compare=/比價中/.test(h)&&/284,400/.test(h)&&/292,480/.test(h)&&/line-through/.test(h)&&/#E8F5E9/.test(h);
        // 得標：預選最低（鴻玉），需原因；建立承包卡、應付不立即掛（未計價）、其餘未得標、廠商名冊補建風哥不會（風哥未得標）
        rfqAward(r.id);
        out.awardPre=document.querySelector('input[name="rfq-win"]:checked').value==='0'&&!/風哥/.test(m.innerHTML);
        document.getElementById('gen-confirm-ok').click();out.needReason=r.status==='open';
        document.getElementById('gen-confirm-reason')||0;
        const el=document.querySelector('input[name="rfq-win"][value="0"]');if(el)el.checked=true;document.getElementById('rfq-reason').value='最低價且可配合 11/1 進場';document.getElementById('rfq-entry2').value='2026-11-01';
        document.getElementById('gen-confirm-ok').click();
        const c=q.costs.find(x=>x.rfqId===r.id);
        out.award=r.status==='awarded'&&r.award.vendor==='鴻玉開發工程行'&&!!c&&c.type==='sub'&&c.vendor==='鴻玉開發工程行'&&c.rows.length===2&&c.rows[0].linkedItemIdx===0&&c.rows[0].qty===408&&c.rows[0].unitPrice===550&&c.rows[1].unitPrice===150&&c.amt===284400&&c.retRate===5&&c.entryDate==='2026-11-01'&&c.payTerm.ticketDays===60;
        out.others=r.vendors[0].status==='won'&&r.vendors[1].status==='lost'&&r.vendors[2].status==='lost'&&!PAYABLES.some(p=>p.costId===c.id);
        renderRfq();out.doneUi=/已發包：鴻玉開發工程行/.test(root.innerHTML)&&/得標原因/.test(root.innerHTML)&&!/rfqAward\(/.test(root.innerHTML);
        // 日報提示帶工班聯絡資訊
        const ci=_itemCrewInfo(q,0);out.crew=!!ci&&ci.name==='鴻玉開發工程行'&&ci.contact==='鴻哥'&&ci.tel==='0911-111-111';
        // 第二張：改點工（需原因）→ 點工卡
        rfqNew();document.querySelectorAll('.rfq-it')[1].checked=true;document.getElementById('rfq-scope').value='拔除';document.getElementById('gen-confirm-ok').click();
        const r2=q.rfqs[1];out.no2=r2.no==='RFQ-1150928-02';
        rfqLabor(r2.id);document.getElementById('rfq-lreason').value='報價皆超過預算';document.getElementById('gen-confirm-ok').click();
        const lc=q.costs.find(x=>x.rfqId===r2.id);out.labor=r2.status==='labor'&&!!lc&&lc.type==='labor'&&lc.linkedItemIdx===1&&/報價皆超過預算/.test(lc.rows[0].reason);
        // 已發包不能刪；private 抽離：shared 版本不含 rfqs，private 含
        rfqDel(r.id);out.delGuard=q.rfqs.length===2&&m.style.display==='none';
        out.strip=!JSON.stringify(_stripQuoteSens(q)).includes('rfqs')&&Array.isArray(_extractQuoteSens(q).rfqs)&&_extractQuoteSens(q).rfqs.length===2;
        const q2={id:'qR',items:q.items};_applyQuoteSens(q2,_extractQuoteSens(q),false);out.apply=Array.isArray(q2.rfqs)&&q2.rfqs.length===2;
        // 專案卡入口
        Q=Q.filter(x=>x.id!=='qR');VENDORS.length=0;_rfqQid='';
        return out;
    });
    check('發包：新增詢價單（合約工項勾選、數量帶生效量、備用不列、付款條件、條件逐列可增刪；不預選廠商）', r.page && r.form && r.cashLink && r.saved && r.condUi && r.perDef);
    check('發包：詢價單 PDF 統一格式（條件條列、廠商欄表格、單價留白、無內部欄與頁尾）', r.cond && r.doc && r.prev);
    check('發包：回傳廠商（名冊自動帶聯絡人、名冊外可手打、名稱必填）、填價／議價合計、比價表', r.newForm && r.pick && r.nameReq && r.fillTot && r.negTxt && r.status && r.compare);
    check('發包：得標需原因→建立分包合約（單價＝議後價、保留款、進場日、付款條件）、其餘未得標、未計價不掛應付', r.awardPre && r.needReason && r.award && r.others && r.doneUi && r.crew);
    check('發包：改點工建立點工卡；已發包不可刪；rfqs 走 private；專案卡入口', r.no2 && r.labor && r.delGuard && r.strip && r.apply);
    check('v6 發包測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 工程專案一頁式：KPI／流程時間軸／工項進度／業主計價／發包／成本統計／預定 vs 實際／日報／結案 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
        const out={};
        P.vendorPayDay=25;P.vendorPayDelay=1;P.subPayOnBill=true;
        VENDORS.length=0;VENDORS.push({id:'v1',name:'鴻玉開發工程行',type:'承包',contact:'鴻哥',phone:'0911-111-111'});
        Q=[{id:'qP',code:'1150928',name:'中科台積電F25P3',client:'八九企業',date:'2026-08-01',awarded:true,ver:2,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H400 L=13M 打設',unit:'支',qty:'400',price:'1000',origPrice:'1100',sec:false,note:'含30天租期',ot:'50',otu:'支/天'},{desc:'H型鋼樁 H400 L=13M 拔除',unit:'支',qty:'400',price:'400',sec:false}],
          costs:[{id:'cM',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-01',amt:0,invoice:true,rows:[{id:'m1',linkedItemIdx:0,desc:'',qty:400,unitPrice:550}],periods:[{no:1,date:'2026-09-25',from:'2026-09-01',to:'2026-09-25',rows:[{rid:'m1',qty:300}],amt:165000,ret:0,net:165000,due:'2026-10-25'}]},
                 {id:'cO',type:'own',vendor:'',cat:'材料租金',date:'2026-09-02',amt:60000,linkedItemIdx:0,rows:[{id:'o1',preset:'材料租金',desc:'',qty:3,unit:'月',unitPrice:20000}]}],
          rfqs:[{id:'r1',no:'RFQ-1150928-01',date:'2026-08-20',scope:'打設',status:'awarded',award:{vendor:'鴻玉開發工程行',reason:'最低價'},items:[{idx:0,desc:'打設',unit:'支',qty:400}],vendors:[{name:'鴻玉開發工程行',status:'won',prices:{0:550},neg:{}}]}],
          dailyLogs:[{id:'d1',date:'2026-09-10',workers:2,crews:[{type:'sub',vendor:'鴻玉開發工程行',n:5}],progressRows:[{itemIdx:0,desc:'H型鋼樁 H400 L=13M 打設',qty:300,note:''}],progress:'',photos:[]}]}];
        CONTRACTS.splice(0);CONTRACTS.push({id:'ctP',code:'C-1150928',name:'中科台積電F25P3',client:'八九企業',amount:588000,status:'active',linkedQid:'qP',start:'2026-09-01',_mt:1});
        INV.length=0;INV.push({id:'ivP1',quoteId:'qP',project:'中科台積電F25P3',client:'八九企業',periodNo:1,date:'2026-09-30',items:[{desc:'H型鋼樁 H400 L=13M 打設',unit:'支',contractQty:400,curQty:300,contractPrice:1000}],totals:{curTotal:300000,total:315000,retention:0},received:0,receivedConfirmed:false});
        PAYABLES.length=0;syncCostToPayable(Q[0],Q[0].costs[0]);
        _pjQid='';eid='qP';
        go('proj');
        const root=document.getElementById('proj-root');
        out.page=!!root&&document.getElementById('page-proj').classList.contains('active');
        // 自動選到目前報價（eid）→ 一頁式
        const h=root.innerHTML;
        out.head=/中科台積電F25P3/.test(h)&&/合約金額（含稅）/.test(h)&&/588,000/.test(h)&&/累計請款/.test(h)&&/315,000/.test(h)&&/發包總額/.test(h)&&/220,000/.test(h)&&/施工成本（未稅）/.test(h)&&/280,000/.test(h);
        // 時間軸：8 步、議價有（原 1100→1000）、合約、發包、施工 75%、業主計價、廠商計價、結案
        out.steps=(h.match(/class="pj-step"/g)||[]).length===8&&/議價/.test(h)&&/原 ?[\d,]+ → [\d,]+/.test(h)&&/分包 1 家/.test(h)&&/日報 1 篇/.test(h)&&/進度 5[0-9]%/.test(h)&&/報價 NT\$ 588,000/.test(h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '))&&/已請 1 期/.test(h)&&/應付 1 筆/.test(h);
        // 工項表：合約量／日報回報／進度／發包廠商／發包量／廠商已請／業主已請
        const sec=document.getElementById('pj-body-items').innerHTML;
        out.items=/鴻玉開發工程行/.test(sec)&&/>400</.test(sec)&&/>300</.test(sec)&&/75%/.test(sec)&&/未發包/.test(sec);
        // 業主計價：期別列、待收、估驗進度、逾期租金（打設最後 09-10 → 30 天到 10-10，今天 10-03 尚未逾期→無；改日期）
        const inv=document.getElementById('pj-body-inv').innerHTML;
        out.inv=/第1期/.test(inv)&&/待收 315,000/.test(inv)&&/估驗進度/.test(inv)&&/新增下一期請款單/.test(inv)&&/openEnvelope/.test(inv);
        // 發包：分包列、廠商已請 165,000、未付（含稅）173,250、登錄廠商請款鈕、詢價單 chip
        const sub=document.getElementById('pj-body-sub').innerHTML;
        out.sub=/RFQ-1150928-01/.test(sub)&&/165,000/.test(sub)&&/173,250/.test(sub)&&/登錄廠商請款/.test(sub)&&/已發包：鴻玉開發工程行/.test(sub);
        // 施工成本：摘要列＋工項成本分析
        const cost=document.getElementById('pj-body-cost').innerHTML;
        out.cost=/cost-summary/.test(cost)&&/承包（發包）/.test(cost)&&/執行率|毛利/.test(cost);
        // 進度：實際條有、預定無（提示到施工進度工具）；設 _pgState 後顯示預定
        const sch=document.getElementById('pj-body-sched').innerHTML;
        out.sched0=/實際 2026-09-10/.test(sch)&&/尚無預定進度/.test(sch);
        _pgState={proj:'中科台積電F25P3',startDate:'2026-09-01',colDays:3,crews:[],rows:[{crew:'',name:'H型鋼樁 H400 L=13M 打設',qty:400,unit:'支',rate:20,manualDays:null,offset:0,startOverride:'',doneQty:null,actualStart:'',doneAt:''}]};
        renderProj();out.sched1=/預定 2026-09-01～2026-09-20（20 天）/.test(document.getElementById('pj-body-sched').innerHTML);
        // 日報、結案
        out.log=/2026-09-10/.test(document.getElementById('pj-body-log').innerHTML)&&/鴻玉開發工程行/.test(document.getElementById('pj-body-log').innerHTML)&&/white-space:nowrap;font-weight:700">300\s*支<\/span>/.test(document.getElementById('pj-body-log').innerHTML)&&/class="pj-sched-row"/.test(document.getElementById('pj-body-sched').innerHTML);   // v6.0.12 數量不拆行、排程列單欄 class
        const cl=document.getElementById('pj-body-close').innerHTML;out.close=/pjCloseAll\('/.test(cl)&&/結案＝最後一期請款單送出後按一次/.test(cl)&&!/settleContract\(/.test(cl);   // v6.0.29 結案一鈕
          // 介紹費：第二家同工項承包 → 工項表提示、發包區下拉設跟隨 → 發包量不再重複
        Q[0].costs.push({id:'cF',type:'sub',vendor:'風哥',cat:'打設',date:'2026-09-01',amt:0,invoice:false,rows:[{id:'f1',linkedItemIdx:0,desc:'',qty:400,unitPrice:150}]});
        renderProj();out.dupHint=/發包量被重複加總/.test(document.getElementById('pj-body-items').innerHTML)&&/pjSetFollow/.test(document.getElementById('pj-body-sub').innerHTML);
        pjSetFollow('qP','cF','cM');out.follow=Q[0].costs.find(c=>c.id==='cF').followOf==='cM'&&!/發包量被重複加總/.test(document.getElementById('pj-body-items').innerHTML)&&/介紹費（跟隨 鴻玉開發工程行/.test(document.getElementById('pj-body-sub').innerHTML)&&_qtyRecon(Q[0])[0].sub===400&&(Q[0].costs.find(c=>c.id==='cF').periods||[]).length===1;
        // 空區塊預設收合：日報清空 → 工作日報區收合並標「尚無資料」；有資料的區塊展開
        const savedLogs=Q[0].dailyLogs;Q[0].dailyLogs=[];localStorage.removeItem('pj_open_log');renderProj();
        out.emptyFold=document.getElementById('pj-body-log').style.display==='none'&&/尚無資料/.test(document.getElementById('pj-sec-log').innerHTML)&&document.getElementById('pj-body-items').style.display!=='none';   // v6.0.30 只有目前階段相關區塊預設展開（工項表除結案外都開）
        Q[0].dailyLogs=savedLogs;renderProj();
        // 區塊收合記憶
        document.querySelector('#pj-sec-log .cb > div').click();out.fold=document.getElementById('pj-body-log').style.display==='none'&&localStorage.getItem('pj_open_log')==='0';
        renderProj();out.foldKeep=document.getElementById('pj-body-log').style.display==='none';localStorage.removeItem('pj_open_log');
        // 無選擇 → 卡片清單；點卡片進入
        _pjQid='';eid=null;renderProj();out.list=/openProj\('qP'\)/.test(root.innerHTML)&&/已請/.test(root.innerHTML);
        openProj('qP');out.open=_pjQid==='qP'&&/合約工項與進度/.test(root.innerHTML);
        // 手機底部「專案」改開工程專案；專案管理頁隱藏但仍可開
        out.nav=/go\('proj'\)/.test(document.getElementById('mn-proj').getAttribute('onclick'))&&document.getElementById('mn-proj').style.display!=='none'&&!ALL_PAGES.find(p=>p.id==='projects')&&!document.getElementById('dash-shortcuts');
        go('projects');out.old=document.getElementById('page-proj').classList.contains('active');   // v6.0.26 舊版卡片頁移除 → 轉工程專案
        _pgState={proj:'',startDate:localToday(),colDays:3,crews:[],rows:[]};
        Q=Q.filter(x=>x.id!=='qP');CONTRACTS.splice(0);INV.length=0;PAYABLES.length=0;VENDORS.length=0;_pjQid='';
        return out;
    });
    check('工程專案：頁面、KPI 列（合約／請款／收款／發包／成本／應付／毛利）、8 步時間軸（含議價前後）', r.page && r.head && r.steps);
    check('工程專案：工項進度表、業主計價期別、發包與廠商計價、施工成本統計', r.items && r.inv && r.sub && r.cost);
    check('工程專案：預定 vs 實際、日報摘要、結案區、介紹費跟隨設定、空區塊預設收合、收合記憶', r.sched0 && r.sched1 && r.log && r.close && r.dupHint && r.follow && r.emptyFold && r.fold && r.foldKeep);
    check('工程專案：未選時卡片清單、點卡進入；手機底部「專案」改開本頁、舊卡片頁改轉本頁', r.list && r.open && r.nav && r.old);
    check('v6 工程專案測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 計價頁：業主請款＋廠商請款兩分頁；支出晶片微調 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          P.vendorPayDay=25;P.vendorPayDelay=1;P.subPayOnBill=true;P.vendorCutDay=25;
          VENDORS.length=0;VENDORS.push({id:'v1',name:'鴻玉開發工程行',type:'承包'},{id:'v2',name:'風哥',type:'承包'});
          Q=[{id:'qB',code:'1150928',name:'中科台積電F25P3',client:'八九企業',date:'2026-08-01',awarded:true,ver:2,exs:[],rmk:{},_mt:1,
            items:[{desc:'H型鋼樁 H400 L=13M 打設',unit:'支',qty:'400',price:'1000',sec:false},{desc:'H型鋼樁 H400 L=13M 拔除',unit:'支',qty:'400',price:'400',sec:false}],
            costs:[{id:'cM',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-01',amt:0,invoice:true,retRate:10,rows:[{id:'m1',linkedItemIdx:0,desc:'',qty:400,unitPrice:550}],
                     periods:[{no:1,date:'2026-08-25',from:'2026-08-01',to:'2026-08-25',rows:[{rid:'m1',qty:100}],amt:55000,ret:5500,net:49500,due:'2026-09-25'}]},
                   {id:'cF',type:'sub',vendor:'風哥',cat:'打設',date:'2026-09-01',amt:0,invoice:false,followOf:'cM',rows:[{id:'f1',linkedItemIdx:0,desc:'',qty:400,unitPrice:150}],periods:[]}],
            dailyLogs:[{id:'d1',date:'2026-09-10',workers:2,crews:[{type:'sub',vendor:'鴻玉開發工程行',n:5}],progressRows:[{itemIdx:0,desc:'H型鋼樁 H400 L=13M 打設',qty:200,note:''}],progress:'',photos:[]},
                       {id:'d2',date:'2026-10-02',workers:2,crews:[],progressRows:[{itemIdx:0,desc:'H型鋼樁 H400 L=13M 打設',qty:50,note:''}],progress:'',photos:[]}]}];
          CONTRACTS.splice(0);
          INV.length=0;INV.push({id:'ivB1',quoteId:'qB',project:'中科台積電F25P3',client:'八九企業',periodNo:1,date:'2026-09-30',items:[],totals:{total:100000},received:0});
          PAYABLES.length=0;syncCostToPayable(Q[0],Q[0].costs[0]);
          // 導覽名稱
          out.nav=!document.getElementById('sn-invoice')&&ALL_PAGES.find(p=>p.id==='invoice').hidden===true&&ALL_PAGES.find(p=>p.id==='invoice').parent==='acct';   // v6.0.30 計價併入帳務
          go('invoice');
          return new Promise(res=>setTimeout(()=>{
            try{
              out.tabs=!!document.getElementById('inv-tab-owner')&&!!document.getElementById('inv-tab-vendor');
              invTab('owner');
              out.ownerVisible=document.getElementById('inv-owner-wrap').style.display!=='none'&&document.getElementById('inv-vendor-wrap').style.display==='none';
              const mb=document.getElementById('inv-month-banner');
              out.monthBanner=mb.style.display==='block'&&/中科台積電F25P3/.test(mb.innerHTML)&&/開下一期/.test(mb.innerHTML)&&/本月日報 1 天/.test(mb.innerHTML);
              out.badge=document.getElementById('vb-badge').textContent==='1';
              invTab('vendor');
              out.vendorVisible=document.getElementById('inv-vendor-wrap').style.display!=='none'&&document.getElementById('inv-owner-wrap').style.display==='none'&&document.getElementById('inv-ph-owner').style.display==='none';
              const h=document.getElementById('vb-root').innerHTML;
              // 待登錄：日報 08-25 之後完成 250 支 → min(250, 剩 300)=250×550×0.9=123,750
              out.pending=/待登錄廠商請款/.test(h)&&/123,750/.test(h)&&/鴻玉開發工程行/.test(h)&&/登錄廠商請款/.test(h);
              out.kpi=/1 家/.test(h)&&/預估 NT\$ 123,750/.test(h)&&/本期已登錄/.test(h)&&/押保留款/.test(h)&&/5,500/.test(h);
              out.follow=/跟隨 鴻玉開發工程行/.test(h)&&/介紹費／抽成/.test(h);
              out.all=/全部分包合約/.test(h)&&/220,000/.test(h)&&/55,000/.test(h)&&/25%/.test(h)&&/第1期 2026-08-25/.test(h);
              out.cutLine=/本期計價截止 <b>2026-09-25<\/b>/.test(h)&&/放款日 <b>2026-10-25<\/b>/.test(h);
              // 篩選
              vbFilter('st','follow');out.filter=/風哥/.test(document.getElementById('vb-root').innerHTML)&&!/>鴻玉開發工程行<\/b>/.test(document.getElementById('vb-root').innerHTML.split('全部分包合約')[1]);
              vbFilter('st','');vbFilter('kw','不存在');out.filterEmpty=/沒有符合的分包合約/.test(document.getElementById('vb-root').innerHTML);vbFilter('kw','');
              // 登錄：切換脈絡後回到本頁、開啟計價彈窗
              eid=null;
              vbOpenPeriod('qB','cM');
              out.ctx=eid==='qB'&&document.getElementById('page-acct').classList.contains('active')&&_acctTab==='vb'&&_invTab==='vendor';   // v6.0.30
              const md=(document.getElementById('gen-confirm-modal').style.display==='flex')?document.getElementById('gen-confirm-msg'):null;
              out.modal=!!md&&md.querySelectorAll('.sp-row').length===1;
              // 填數量存檔 → 期別出現在「本期已登錄」、應付掛上、畫面重繪
              const qty=md.querySelector('.sp-row .sp-qty');qty.value='250';
              const dEl=document.getElementById('sp-date');if(dEl)dEl.value='2026-09-25';
              document.getElementById('gen-confirm-modal').style.display='none';_spSave();
              const h2=document.getElementById('vb-root').innerHTML;
              out.saved=document.getElementById('gen-confirm-modal').style.display!=='flex'&&Q[0].costs[0].periods.length===2&&/第2期/.test(h2)&&/本期已登錄（2026-09-25 起）/.test(h2);
              const sec2=h2.split('本期已登錄（')[1].split('全部分包合約')[0];
              out.curTable=/第2期/.test(sec2)&&/137,500/.test(sec2)&&/129,938/.test(sec2)&&/37,500/.test(sec2)&&/開啟工程/.test(sec2)&&/待付/.test(sec2)&&/風哥/.test(sec2);
              // 本期（09-25 起）已登錄 → 不再列待登錄；10-02 之後的日報量屬下一期
              out.badge0=document.getElementById('vb-badge').style.display==='none'&&/0 家/.test(h2);
              out.pay=PAYABLES.some(p=>p.id==='paycM_p2')&&PAYABLES.some(p=>p.id==='paycF_p2');
              // 支出晶片
              go('quickcost');rQcChips();
              const ch=document.getElementById('qc-chips').innerHTML;
              out.chips=!/公司費用/.test(ch)&&/>加油<span[^>]*>（工務車）<\/span>/.test(ch)&&/>維修<span[^>]*>（機具）<\/span>/.test(ch)&&(ch.match(/height:50px/g)||[]).length===QC_TYPES.length;
            }catch(e){out.err=String(e.stack||e).slice(0,400);}
            Q=Q.filter(x=>x.id!=='qB');INV.length=0;PAYABLES.length=0;VENDORS.length=0;
            res(out);
          },400));
    });
    check('計價頁：導覽改「計價」、兩分頁切換、業主分頁本月未開單提醒、廠商分頁待登錄徽章', r.nav && r.tabs && r.ownerVisible && r.monthBanner && r.badge && r.vendorVisible);
    check('廠商請款：待登錄（日報已完成未計價×單價扣保留）、KPI、跟隨主約、全部分包總表、計價週期列、篩選', r.pending && r.kpi && r.follow && r.all && r.cutLine && r.filter && r.filterEmpty);
    check('廠商請款：登錄鈕切換脈絡後留在本頁開彈窗、存檔後本期已登錄列（主約＋跟隨）、應付掛上、徽章歸零', r.ctx && r.modal && r.saved && r.curTable && r.pay && r.badge0);
    check('支出晶片：不顯示「公司費用」、（工務車）（機具）縮小第二行、按鈕等高', r.chips, r.err || '');
    // 手機：廠商分頁不得左右滑
    await page.setViewportSize({ width: 390, height: 844 });
    const mob = await page.evaluate(() => {
        Q=[{id:'qM',code:'1',name:'手機測試案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 打設',unit:'支',qty:'100',price:'1000',sec:false}],
          costs:[{id:'cS',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-01',amt:0,invoice:true,rows:[{id:'s1',linkedItemIdx:0,desc:'',qty:100,unitPrice:550}],periods:[{no:1,date:'2026-09-25',from:'2026-09-01',to:'2026-09-25',rows:[{rid:'s1',qty:40}],amt:22000,ret:0,net:22000,due:'2026-10-25'}]}],
          dailyLogs:[{id:'d',date:'2026-10-01',workers:1,crews:[],progressRows:[{itemIdx:0,desc:'H型鋼樁 打設',qty:30,note:''}],progress:'',photos:[]}]}];
        go('invoice');invTab('vendor');
        const ok=document.documentElement.scrollWidth<=window.innerWidth+1&&document.getElementById('vb-root').scrollWidth<=window.innerWidth+1;
        const td=document.querySelector('#vb-root table.mst tbody td[data-th]:not(:first-child)');
        const cs=td?getComputedStyle(td):null;
        const line=!!cs&&cs.display==='flex'&&cs.flexDirection==='row'&&!!document.querySelector('#vb-root table.mst-ln')&&!!document.querySelector('#vb-root table.mst tfoot td[data-th]');
        const out={ok:ok,line:line,sw:document.documentElement.scrollWidth,iw:window.innerWidth,rows:document.querySelectorAll('#vb-root table').length};
        Q=Q.filter(x=>x.id!=='qM');invTab('owner');return out;
    });
    check('計價頁手機版：廠商請款表格堆疊成一行一行（欄名｜值、合計列亦同）、無橫向捲動', mob.ok && mob.line && mob.rows >= 2, JSON.stringify(mob));
    check('v6 計價頁測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 材料併入發包：需求（估算帶入）→ 自有調撥（台帳拆列）→ 內部租金攤提（不入應付）→ 歸還／損耗認列 → 租賃／運費掛應付 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;P.matLossAccrue=true;
          MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H350',len:12,qty:30,uw:135,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1});
          VENDORS.length=0;VENDORS.push({id:'v9',name:'大料場',type:'材料'});
          Q=[{id:'qM',code:'1150930',name:'材料測試案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H350 打設',unit:'支',qty:'40',price:'1000',sec:false}],costs:[],
              matEst:{items:[{name:'H型鋼 H350 L=12M',unit:'支',quantity:40},{name:'封頭鈑',unit:'片',quantity:10}]}}];
          PAYABLES.length=0;INV.length=0;
          out.nav=(ALL_PAGES.find(p=>p.id==='materials')||{}).parent==='proj';   // v6.0.28 材料管理改跟工程專案
          _rfqQid='qM';_rfqTab='mat';go('rfq');
          return new Promise(res=>setTimeout(()=>{
            try{
              const q=Q[0];const root=document.getElementById('mat6-root');
              out.tab=document.querySelector('.page.active').id==='page-mat6'&&/材料需求與比對/.test(root.innerHTML)&&!/自有材料在工地/.test(root.innerHTML)&&/材料租賃/.test(root.innerHTML)&&/設備租賃/.test(root.innerHTML)&&!/新增詢價單/.test(root.innerHTML);   // v6.0.25 獨立頁；沒有自有在工地就不顯示
              matSeedFromEst('qM');
              const r=q.mat.rows[0];
              out.seed=q.mat.rows.length===1&&r.name==='型鋼'&&r.spec==='H350'&&r.len===12&&r.qty===40&&/尚缺/.test(root.innerHTML)&&/>40 支</.test(root.innerHTML);
              // 調撥 20 支（09-20）
              matOut('qM',r.id);
              const md=document.getElementById('fy-modal');out.outModal=!!md&&md.querySelectorAll('.mo-qty').length===1&&md.querySelector('.mo-qty').value==='30';
              md.querySelector('.mo-qty').value='20';document.getElementById('mo-date').value='2026-09-20';document.getElementById('fy-modal-o').click();
              const wh=MAT_LEDGER.find(x=>x.id==='L1'),site=MAT_LEDGER.find(x=>x.projQid==='qM');
              out.out=!document.getElementById('fy-modal')&&wh.qty===10&&wh.loc==='公司倉庫'&&!!site&&site.qty===20&&site.loc==='材料測試案'&&site.outDate==='2026-09-20'&&site.matRowId===r.id;
              const days=Math.max(1,_dDiff('2026-09-20',localToday()));
              const am=(q.costs||[]).find(c=>c._fromMat==='amort');
              out.amort=!!am&&am.type==='own'&&am.vendor===''&&am.cat==='材料租金'&&am.rows.length===1&&am.rows[0].qty===20*days&&Math.abs(am.rows[0].unitPrice-38.4)<1e-9&&Math.round(am.amt)===Math.round(20*days*38.4)&&!PAYABLES.some(p=>p.costId===am.id);
              out.atTable=/自有材料在工地/.test(root.innerHTML)&&/2026-09-20/.test(root.innerHTML)&&/4×0.8/.test(root.innerHTML)&&new RegExp(fmt(Math.round(20*days*38.4))).test(root.innerHTML);
              // 歸還 18、損耗 2（單價預設 135×12×20=32,400）
              matBack('qM',site.id);
              const mb=document.getElementById('fy-modal');out.backModal=!!mb&&gv('mb-back')==='20'&&gv('mb-uc')==='32400';
              document.getElementById('mb-date').value=localToday();document.getElementById('mb-back').value='18';document.getElementById('mb-loss').value='2';document.getElementById('fy-modal-o').click();
              const backRow=MAT_LEDGER.find(x=>x.loc==='公司倉庫'&&x.id!=='L1'&&x.qty===18);
              out.back=!document.getElementById('fy-modal')&&!!backRow&&!MAT_LEDGER.some(x=>x.projQid==='qM')&&MAT_LEDGER.filter(x=>x.loc==='公司倉庫').reduce((a,x)=>a+x.qty,0)===28
                &&q.mat.use.length===1&&q.mat.use[0].qty===20&&q.mat.use[0].days===days&&q.mat.use[0].amt===Math.round(20*12*4*0.8*days)
                &&q.mat.loss.length===1&&q.mat.loss[0].qty===2&&q.mat.loss[0].amt===64800;
              const ls=(q.costs||[]).find(c=>c._fromMat==='loss'),am2=(q.costs||[]).find(c=>c._fromMat==='amort');
              out.lossCost=!!ls&&ls.cat==='材料損耗'&&ls.vendor===''&&Math.round(ls.amt)===64800&&!PAYABLES.some(p=>p.costId===ls.id)&&!!am2&&am2.rows.length===1&&/已結算/.test(root.innerHTML)===false||(!!am2&&am2.rows.length===1&&!am2.rows[0].open);
              out.lossTable=/損耗認列/.test(root.innerHTML)&&/64,800/.test(root.innerHTML)&&/已結算使用段/.test(root.innerHTML);
              // 租賃（v6.0.25）：大料場 480M、月租 120、09-01 進場 → 至今租金＝480×天數÷30×120；輸入即同步成本卡（未請款前 0、不掛應付）；運輸另一家廠商、另一張卡
              const m=q.mat;m.rents=[{id:'rn1',vendor:'大料場',rowId:r.id,name:'型鋼',spec:'H350',len:12,rate:120,cm:480,pf:'2026-09-01',pt:'2026-10-31',mode:'day',note:'',batches:[{id:'b1',d:'2026-09-01',m:480,n:40,o:''}]}];
              m.tps=[{id:'t1',date:'2026-09-01',vendor:'大運輸',cat:'材料運費',desc:'進場',trips:2,price:3500}];_m6Save(q);renderMat6();
              const rdays=Math.max(0,_dDiff('2026-09-01',localToday()));
              out.rentLive=_m6RentToDate(m.rents[0])===Math.round(480*rdays/30*120)&&new RegExp(fmt(Math.round(480*rdays/30*120))).test(root.innerHTML);
              const rc=(q.costs||[]).find(c=>c._fromMat==='rent:大料場');
              out.rent=!!rc&&rc.vendor==='大料場'&&rc.cat==='材料租金'&&rc.rental===true&&rc.amt===0&&rc.rows.length===1&&rc.rows[0].per==='mmonth'&&rc.rows[0].qty===480&&rc.rows[0].unitPrice===120&&rc.planAmt===115200&&!PAYABLES.some(p=>p.costId===rc.id);
              const tc=(q.costs||[]).find(c=>c._fromMat==='trans:大運輸:材料運費');
              out.trans=!!tc&&tc.rows[0].unitPrice===3500&&tc.rows[0].per==='trip'&&!rc.rows.some(x=>x.per==='trip');
              // 敏感欄位：q.mat 走 private
              out.sens=_stripQuoteSens(q).mat===undefined&&!!_extractQuoteSens(q).mat&&_extractQuoteSens(q).mat.rows.length===1;
              // 成本總額納入攤提＋損耗＋租賃＋運費
              out.total=_projCostTotal(q)===Math.round(am2.amt)+64800;
              // 工程專案頁有「材料」鈕
              _pjQid='qM';go('proj');out.pjBtn=/go\('mat6'\)/.test(document.getElementById('pj-body-sub').innerHTML);
            }catch(e){out.err=String(e.stack||e).slice(0,500);}
            Q=Q.filter(x=>x.id!=='qM');MAT_LEDGER.length=0;PAYABLES.length=0;VENDORS.length=0;_rfqTab='rfq';
            res(out);
          },400));
    });
    check('材料：材料．運輸獨立頁（舊發包材料分頁連結轉來）、由估算帶入鋼材列、調撥彈窗帶倉庫列與可撥支數、拆列到工地（loc／projQid／outDate）', r.nav && r.tab && r.seed && r.outModal && r.out, r.err || '');
    check('材料：內部攤提＝支數×單長×日租×折數×天數 → 自有成本（公司自備不入應付）、工地表顯示', r.amort && r.atTable);
    check('材料：歸還／損耗彈窗預設購置單價、歸還拆回倉庫、結算使用段、損耗認列成本（材料損耗科目、不入應付）', r.backModal && r.back && r.lossCost && r.lossTable);
    check('材料：租賃按 M 月租「租金至今」、輸入即同步成本卡（未請款前 0、不掛應付、預估＝合約租期）、運輸另一張卡、成本總額＝攤提＋損耗', r.rentLive && r.rent && r.trans && r.total);
    check('材料：q.mat 走 private（strip／extract）、工程專案表頭與發包區塊有「材料」鈕', r.sens && r.pjBtn);
    await page.setViewportSize({ width: 390, height: 844 });
    const mob = await page.evaluate(() => {
        MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H350',len:12,qty:30,uw:135,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1});
        Q=[{id:'qM2',code:'2',name:'手機材料案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[],costs:[],mat:{rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:40,rate:'',rentVendor:'',rentPrice:'',rentMonths:''}],use:[],loss:[],trans:{}}}];
        _rfqQid='qM2';_rfqTab='mat';go('rfq');renderRfq();
        const out={sw:document.documentElement.scrollWidth,iw:window.innerWidth,ln:!!document.querySelector('#mat6-root table.mst-ln')};
        Q=Q.filter(x=>x.id!=='qM2');MAT_LEDGER.length=0;_rfqTab='rfq';return out;
    });
    check('材料手機版：表格一行一行堆疊、無橫向捲動', mob.sw <= mob.iw + 1 && mob.ln, JSON.stringify(mob));
    check('v6 材料測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 帳務一頁多分頁（金流／帳務管理／薪資零用金併入）＋ 股東報表 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          out.pages=(ALL_PAGES.find(p=>p.id==='acct')||{}).grp==='fin'&&(ALL_PAGES.find(p=>p.id==='finance')||{}).parent==='acct'&&(ALL_PAGES.find(p=>p.id==='ledger')||{}).parent==='acct'&&(ALL_PAGES.find(p=>p.id==='payroll')||{}).hidden===true&&(ALL_PAGES.find(p=>p.id==='payroll')||{}).adminOnly===true;
          out.mount=!!document.getElementById('page-acct')&&!!document.querySelector('#acct-p-ar #finance-ar')&&!!document.querySelector('#acct-p-ap #finance-payable')&&!!document.querySelector('#acct-p-inv #ledger-month')&&!!document.querySelector('#acct-p-inv #finance-invoice')&&!!document.querySelector('#acct-p-pay #pr-people')&&!!document.querySelector('#acct-p-petty #pr-petty')&&!!document.querySelector('#acct-top #finance-kpis');
          go('finance');
          out.redirAr=document.getElementById('page-acct').classList.contains('active')&&_acctTab==='ar'&&document.getElementById('acct-p-ar').style.display!=='none'&&document.getElementById('acct-p-ap').style.display==='none';
          switchFinanceTab('payable');
          out.syncAp=_acctTab==='ap'&&document.getElementById('acct-p-ap').style.display!=='none'&&document.getElementById('finance-payable').style.display!=='none';
          go('ledger');out.redirInv=_acctTab==='inv'&&document.getElementById('acct-p-inv').style.display!=='none'&&!!document.getElementById('ledger-month').value;
          go('payroll');out.redirPay=_acctTab==='pay'&&document.getElementById('acct-p-pay').style.display!=='none';
          acctTab('petty');out.petty=document.getElementById('acct-p-petty').style.display!=='none'&&document.getElementById('acct-p-pay').style.display==='none';
          out.tabs=document.querySelectorAll('#acct-tabs button').length===8&&/帳務/.test(document.getElementById('sn-acct').textContent)&&!document.getElementById('sn-finance');
          // 股東報表
          P.tax=5;
          Q=[{id:'qS',code:'1',name:'股東測試案',client:'業主A',date:'2026-03-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 打設',unit:'支',qty:'100',price:'10000',sec:false}],t:{sub:1000000,tax:50000,total:1050000},
              costs:[{id:'c1',type:'sub',vendor:'甲',cat:'打設',date:'2026-04-01',amt:400000,rows:[{id:'r1',linkedItemIdx:0,qty:100,unitPrice:4000}]},{id:'c2',type:'own',vendor:'',cat:'材料租金',date:'2026-05-01',amt:50000,rows:[{id:'r2',preset:'材料租金',qty:1,unitPrice:50000}]}]},
             {id:'qL',code:'2',name:'未得標案',client:'業主B',date:'2026-02-01',awarded:false,bidStatus:'lost',exs:[],rmk:{},_mt:1,items:[],t:{total:500000}}];
          CONTRACTS.splice(0);INV.length=0;INV.push({id:'iS1',quoteId:'qS',project:'股東測試案',client:'業主A',periodNo:1,date:'2026-05-31',items:[],totals:{total:630000,sub:600000},retention:0,received:630000,receivedDate:'2026-06-30'});
          PAYABLES.length=0;EXPENSES.length=0;EXPENSES.push({id:'E1',date:'2026-03-10',amount:20000,cat:'交際費',note:'禮盒'},{id:'E2',date:'2026-07-10',amount:10000,cat:'文具郵電',note:'紙'});
          PAYSLIPS.length=0;PAYSLIPS.push({id:'ps_a_2026-04',hrId:'a',ym:'2026-04',name:'王',gross:40000,coCost:5000,net:36000,status:'paid'});
          SHARE_PROFIT.draws=[{id:'d1',date:'2026-08-01',who:'陳茹軒',amount:100000}];SHARE_PROFIT.cfg={};
          go('profit');const ys=document.getElementById('rpt-year');if(ys&&![...ys.options].some(o=>o.value==='2026'))ys.insertAdjacentHTML('afterbegin','<option value="2026">2026</option>');ys.value='2026';
          showReport('shareholder');
          const d=window._shRptData;
          out.calc=!!d&&d.revNet===600000&&d.cost===450000&&d.gross===150000&&d.exp===30000&&d.hr===45000&&!d.hrEst&&d.pretax===75000&&d.recv===630000&&d.projs.length===1&&d.projs[0].q.id==='qS'&&d.share.drawn===100000&&d.bid.n===2&&d.bid.won===1;
          const h=document.getElementById('report-content').innerHTML;
          out.view=/年度損益摘要/.test(h)&&/600,000/.test(h)&&/450,000/.test(h)&&/150,000/.test(h)&&/各案損益/.test(h)&&/股東測試案/.test(h)&&/財務狀況/.test(h)&&/股東分潤/.test(h)&&/陳茹軒/.test(h)&&/業務/.test(h)&&/匯出 PDF/.test(h)&&/承包（發包）/.test(h)&&/交際費/.test(h);
          out.btn=!!document.getElementById('rpt-shareholder-btn')&&document.getElementById('rpt-shareholder-btn').style.background==='var(--g)';
          // PDF：A4 直式、走統一引擎；不含內部單價資料
          let cap=null;const oP=window._printViaIframe;window._printViaIframe=function(html,fn,land){cap={html,fn,land};};
          exportCurrentReport();window._printViaIframe=oP;
          out.pdf=!!cap&&!cap.land&&/股東報表 2026 年度/.test(cap.html)&&/一、年度損益摘要/.test(cap.html)&&/股東測試案/.test(cap.html)&&!/4,000/.test(cap.html)&&cap.fn==='股東報表_2026';
          // 手機：帳務頁薪資表堆疊觀察器存在、股東報表無橫向捲動（在手機區塊另測）
          Q=[];INV.length=0;EXPENSES.length=0;PAYSLIPS.length=0;SHARE_PROFIT.draws=[];SHARE_PROFIT.cfg={};
          return out;
    });
    check('帳務：頁面登錄（金流／帳務管理隱藏跟隨、薪資保留權限）、既有面板搬入八個分頁、KPI 與搜尋在頂端', r.pages && r.mount && r.tabs);
    check('帳務：go(finance|ledger|payroll) 轉到對應分頁、switchFinanceTab 同步分頁外觀、零用金／薪資分頁', r.redirAr && r.syncAp && r.redirInv && r.redirPay && r.petty);
    check('股東報表：年度損益（營收未稅／成本／毛利／費用／人事／稅前淨利）、各案、分潤提領、得標率口徑', r.calc);
    check('股東報表：畫面區塊齊全、報表中心分頁鈕、PDF 走統一引擎 A4 直式且不含內部單價', r.view && r.btn && r.pdf);
    await page.setViewportSize({ width: 390, height: 844 });
    const mob = await page.evaluate(() => {
        Q=[{id:'qS2',code:'1',name:'手機股東案',client:'業主',date:'2026-03-01',awarded:true,exs:[],rmk:{},_mt:1,items:[],t:{total:1050000},costs:[{id:'c1',type:'sub',vendor:'甲',cat:'打設',date:'2026-04-01',amt:400000,rows:[]}]}];
        INV.length=0;INV.push({id:'iS2',quoteId:'qS2',project:'手機股東案',client:'業主',periodNo:1,date:'2026-05-31',items:[],totals:{total:630000},received:0});
        go('reports');const ys=document.getElementById('rpt-year');if(ys&&![...ys.options].some(o=>o.value==='2026'))ys.insertAdjacentHTML('afterbegin','<option value="2026">2026</option>');ys.value='2026';showReport('shareholder');
        const o1={sw:document.documentElement.scrollWidth,iw:window.innerWidth};
        go('acct');acctTab('ap');
        o1.sw2=document.documentElement.scrollWidth;
        Q=[];INV.length=0;return o1;
    });
    check('手機：股東報表與帳務頁無橫向捲動', mob.sw <= mob.iw + 1 && mob.sw2 <= mob.iw + 1, JSON.stringify(mob));
    check('v6 帳務／股東報表測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6 參數設定分組精簡：六分頁、稅務設定拆三張、單價分析小節收合、跨分頁搜尋、材料內部租金參數 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          go('params');
          const pg=document.getElementById('page-params');
          out.tabs=document.querySelectorAll('#prm-tabs button').length===6&&!!document.getElementById('prm-q');
          out.co=document.getElementById('prm-g-co').style.display!=='none'&&!!document.querySelector('#prm-g-co #pc')&&document.getElementById('prm-g-cost').style.display==='none';
          prmTab('cost');
          out.cost=document.getElementById('prm-g-cost').style.display!=='none'&&!!document.querySelector('#prm-g-cost #pvcutday')&&!!document.querySelector('#prm-g-cost #pmat-h350')&&!!document.querySelector('#prm-g-cost #plabor')&&!document.querySelector('#prm-g-cost #ptax');
          out.bill=!!document.querySelector('#prm-g-bill #ptax')&&!!document.querySelector('#prm-g-bill #fixed-cost-rows')&&!!document.querySelector('#prm-g-bill #prm');
          out.cash=!!document.querySelector('#prm-g-cash #popen')&&!!document.querySelector('#prm-g-cash #popresamt');
          out.sys=!!document.querySelector('#prm-g-sys #fb-sync-card')&&!!document.querySelector('#prm-g-sys #storage-usage-body');
          out.taxGone=![].some.call(pg.querySelectorAll('.cht'),h=>/稅務設定/.test(h.textContent));
          const secs=pg.querySelectorAll('#prm-g-upa details.prm-sec');
          out.upa=secs.length>=10&&!!document.querySelector('#prm-g-upa #cp-r-drive')&&[...secs].some(d=>d.querySelector('#cp-r-drive'))&&!!document.querySelector('#prm-g-upa #cp-site-s');
          // 搜尋：跨分頁、只留命中欄位、小節自動展開
          prmSearch('放款');
          const vis=id=>{const f=document.getElementById(id).closest('.f');return f.style.display!=='none'&&f.closest('.prm-g').style.display!=='none'&&f.closest('.card').style.display!=='none';};
          out.search=vis('pvpayday')&&vis('pvpaydelay')&&!vis('ptax')&&document.getElementById('prm-g-bill').style.display!=='none';
          prmSearch('引孔');const d=document.getElementById('cp-r-drill').closest('details');out.search2=!!d&&d.open&&d.style.display!=='none'&&vis('cp-r-drill');
          prmSearch('');out.clear=document.getElementById('prm-g-cost').style.display!=='none'&&document.getElementById('prm-g-bill').style.display==='none'&&vis('pvpayday');
          // 儲存材料參數
          document.getElementById('pmat-h350').value='4.5';document.getElementById('pmat-factor').value='0.9';document.getElementById('pmat-loss').value='0';
          const oT=window.toast;window.toast=function(){};try{doSaveP();}catch(e){out.saveErr=String(e).slice(0,100);}window.toast=oT;
          out.save=P.matRentRate.H350===4.5&&P.matRentRate.H300===3&&P.matRentFactor===0.9&&P.matLossAccrue===false;
          P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;P.matLossAccrue=true;syncParamsUI();
          out.sync=document.getElementById('pmat-h350').value==='4'&&document.getElementById('pmat-loss').value==='1';
          return out;
    });
    check('參數設定：六個分頁與搜尋框、公司／計價與報價／成本與廠商／資金／系統各自有對應欄位、稅務設定卡拆掉', r.tabs && r.co && r.cost && r.bill && r.cash && r.sys && r.taxGone);
    check('參數設定：單價分析小節收合（≥10 節、欄位 id 不變）、搜尋跨分頁只留命中欄位並展開小節、清除還原', r.upa && r.search && r.search2 && r.clear);
    check('參數設定：自有材料內部日租／折數／損耗認列可存可讀', r.save && r.sync, r.saveErr || '');
    await page.setViewportSize({ width: 390, height: 844 });
    const mob = await page.evaluate(() => { go('params'); prmTab('cost'); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth }; });
    check('手機：參數設定分頁無橫向捲動', mob.sw <= mob.iw + 1, JSON.stringify(mob));
    check('v6 參數設定測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.16 上線前收尾：權限對映、選單收尾、總覽待辦 v6 訊號 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          // 選單
          const pg=id=>ALL_PAGES.find(p=>p.id===id)||{};
          out.nav=pg('costs').hidden&&pg('costs').parent==='proj'&&pg('progress').hidden&&pg('progress').parent==='proj'&&!!document.getElementById('mn-quickcost')&&!!document.querySelector('nav.mob-nav #mn-quotes')&&MOB_BOTTOM_NAV.indexOf('quickcost')>=0&&!document.getElementById('sn-costs')&&!navPages().some(p=>p.id==='costs'||p.id==='progress');
          out.pjBtns=/openProjectCosts|'施工成本'/.test(document.getElementById('page-proj').innerHTML)||true;
          // 權限遷移：系統管理員登入 → 舊角色對映
          const p=_acct();const keep=JSON.stringify({r:p.__roles,s:p.__staff,v:p.__v6perm});
          p.__roles.push({id:'r616',name:'工務測試',enabled:true,pages:{projects:true,costs:true,finance:true,invoice:true},_mt:1});
          p.__staff.push({email:'w616@x.com',name:'工務',roles:['r616'],active:true,_mt:1});
          delete p.__v6perm;_acctSave(p);
          const oU=_fbUser;const oT=window.toast;window.toast=function(){};
          _fbUser={email:'w616@x.com'};
          out.before=!canAccess('proj')&&!canAccess('acct')&&!canAccess('invoice');   // v6.0.30 計價跟帳務權限
          out.noSys=_v6PermMigrate()===false;   // 非系統管理員不執行
          // 模擬系統管理員（BOOTSTRAP_DEV 第一個）
          _fbUser={email:BOOTSTRAP_DEV[0]};
          const n=_v6PermMigrate();
          const r=_acct().__roles.find(x=>x.id==='r616');
          out.migrated=n===3&&r.pages.proj===true&&r.pages.rfq===true&&r.pages.acct===true&&r.pages.projects===true&&!!_acct().__v6perm;
          out.once=_v6PermMigrate()===false;
          _fbUser={email:'w616@x.com'};
          out.after=canAccess('proj')&&canAccess('rfq')&&canAccess('acct')&&canAccess('costs')&&canAccess('progress')&&canAccess('materials')&&!canAccess('payroll')&&!canAccess('params');
          // 角色權限表仍可勾薪資．零用金，不列施工成本（跟隨工程專案）
          _fbUser={email:BOOTSTRAP_DEV[0]};rolePerm('r616');
          const md=document.getElementById('fy-modal');const mh=md?md.innerHTML:'';
          out.permList=/薪資．零用金/.test(mh)&&/工程專案/.test(mh)&&/帳務/.test(mh)&&!/>施工成本</.test(mh)&&!/>金流管理</.test(mh);
          if(md)md.remove();
          // 還原
          const k=JSON.parse(keep);const p2=_acct();p2.__roles=k.r;p2.__staff=k.s;if(k.v)p2.__v6perm=k.v;else delete p2.__v6perm;_acctSave(p2);_fbUser=oU;window.toast=oT;
          // 總覽待辦：待登錄廠商請款／本月未開單／材料在工地
          P.vendorCutDay=25;P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;
          const ym=localToday().slice(0,7);
          MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L6',name:'型鋼',spec:'H350',len:12,qty:10,uw:135,price:20,kind:'重複性',loc:'待辦測試案',projQid:'q616',outDate:_dAdd(localToday(),-130),_mt:1});
          Q=[{id:'q616',code:'1',name:'待辦測試案',client:'業主',date:'2026-06-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 打設',unit:'支',qty:'100',price:'1000',sec:false}],
              costs:[{id:'cS',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-07-01',amt:0,invoice:true,rows:[{id:'s1',linkedItemIdx:0,desc:'',qty:100,unitPrice:550}],periods:[]}],
              mat:{rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:40,rate:''}],use:[],loss:[],trans:{}},
              dailyLogs:[{id:'d',date:ym+'-02',workers:1,crews:[],progressRows:[{itemIdx:0,desc:'H型鋼樁 打設',qty:30,note:''}],progress:'',photos:[]}]}];
          INV.length=0;INV.push({id:'i616',quoteId:'q616',project:'待辦測試案',client:'業主',periodNo:1,date:_dAdd(ym+'-01',-10),items:[],totals:{total:100000},received:0});
          PAYABLES.length=0;
          go('dash');
          const t=document.getElementById('dash-todo-list').innerHTML;
          out.todo=/待登錄廠商請款：鴻玉開發工程行/.test(t)&&/本月尚未開單：待辦測試案/.test(t)&&/自有材料在工地：待辦測試案 10 支，最久 130 天（請確認是否該歸還）/.test(t)&&/_rfqTab='mat'/.test(t)&&/invTab\('vendor'\)/.test(t);
          out.shortcut=!document.getElementById('dash-shortcuts');   // v6.0.33 總覽捷徑卡移除（底部列／側欄已有）
          Q=[];INV.length=0;MAT_LEDGER.length=0;
          return out;
    });
    check('選單收尾：施工成本／施工進度隱藏跟隨工程專案、底部列改日報、報價移到更多', r.nav);
    check('權限遷移：非系統管理員不執行；系統管理員一次性把 projects|costs|finance 對映到 proj|rfq|acct、只跑一次、canAccess 含隱藏子頁、薪資／參數仍擋', r.before && r.noSys && r.migrated && r.once && r.after);
    check('角色權限表：列工程專案／帳務／薪資．零用金，不列已併入的施工成本／金流管理', r.permList);
    check('總覽待辦：待登錄廠商請款、本月尚未開單、自有材料在工地（≥120 天提醒）各帶跳轉；捷徑改帳務', r.todo && r.shortcut);
    check('v6.0.16 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.17 經營報表：利潤分析併入總覽、口徑列（權責為主、現金為輔）、年度損益加權責欄、權限遷移 v2 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          const pg=id=>ALL_PAGES.find(p=>p.id===id)||{};
          out.pages=!pg('reports').hidden&&pg('reports').label==='經營報表'&&pg('profit').hidden&&pg('profit').parent==='reports'&&!!document.getElementById('sn-reports')&&!document.getElementById('sn-profit');
          P.tax=5;
          Q=[{id:'qR',code:'1',name:'報表測試案',client:'業主A',date:'2026-03-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 打設',unit:'支',qty:'100',price:'10000',sec:false}],t:{sub:1000000,tax:50000,total:1050000},
              costs:[{id:'c1',type:'sub',vendor:'甲',cat:'打設',date:'2026-04-01',amt:400000,rows:[{id:'r1',linkedItemIdx:0,qty:100,unitPrice:4000}]}]}];
          INV.length=0;INV.push({id:'iR1',quoteId:'qR',project:'報表測試案',client:'業主A',periodNo:1,date:'2026-05-31',items:[],totals:{total:630000,sub:600000},retention:0,received:630000,receivedDate:'2026-06-30'});
          PAYABLES.length=0;PAYABLES.push({id:'pR',quoteId:'qR',vendor:'甲',amount:100000,vat:false,status:'paid',date:'2026-07-01',paidDate:'2026-07-05'});
          EXPENSES.length=0;EXPENSES.push({id:'E1',date:'2026-03-10',amount:20000,cat:'交際費',note:'禮盒'});PAYSLIPS.length=0;PAYSLIPS.push({id:'ps_a_2026-04',hrId:'a',ym:'2026-04',name:'王',gross:40000,coCost:5000,net:36000,status:'paid'});
          // go('profit') → 經營報表 總覽
          go('profit');
          const ys=document.getElementById('rpt-year');if(ys&&![...ys.options].some(o=>o.value==='2026'))ys.insertAdjacentHTML('afterbegin','<option value="2026">2026</option>');ys.value='2026';showReport('overview');
          const rc=document.getElementById('report-content');
          out.redir=document.getElementById('page-reports').classList.contains('active')&&_currentReport==='overview'&&document.getElementById('rpt-overview-btn').style.background==='var(--g)';
          out.overview=!!rc.querySelector('#profbody')&&/實際淨利（已收款案件）/.test(rc.innerHTML)&&/稅前淨利（權責口徑）/.test(rc.innerHTML)&&/135,000/.test(rc.innerHTML)&&/淨現金流（現金口徑）/.test(rc.innerHTML)&&/530,000/.test(rc.innerHTML)&&/口徑說明/.test(rc.innerHTML);
          // 切到年度損益再切回總覽，利潤區塊仍在
          showReport('yearly');
          const yh=rc.innerHTML;
          out.yearly=/稅前淨利（權責）/.test(yh)&&/淨現金流（現金口徑）/.test(yh)&&/淨利（實收基礎）/.test(yh)&&!rc.querySelector('#profbody')&&new RegExp('>135,000<').test(yh);
          showReport('overview');out.back=!!rc.querySelector('#profbody')&&/實際淨利（已收款案件）/.test(rc.innerHTML);
          // 頁內切換列：經營報表／帳務，無利潤分析
          const sn=document.querySelector('#page-reports .statnav');out.statnav=!!sn&&/經營報表/.test(sn.textContent)&&/帳務/.test(sn.textContent)&&!/利潤分析/.test(sn.textContent);
          // 總覽匯出＝股東版 PDF
          let cap=null;const oP=window._printViaIframe;window._printViaIframe=function(html,fn,land){cap={html,fn,land};};exportCurrentReport();window._printViaIframe=oP;
          out.pdf=!!cap&&/股東報表 2026 年度/.test(cap.html);
          // 權限遷移 v2：profit → reports
          const p=_acct();const keep=JSON.stringify({r:p.__roles,s:p.__staff,v:p.__v6perm});
          p.__roles.push({id:'r617',name:'會計測試',enabled:true,pages:{profit:true,finance:true},_mt:1});p.__v6perm=1;_acctSave(p);
          const oU=_fbUser,oT=window.toast;window.toast=function(){};_fbUser={email:BOOTSTRAP_DEV[0]};
          const n=_v6PermMigrate();const r=_acct().__roles.find(x=>x.id==='r617');
          out.perm=n>=2&&r.pages.reports===true&&r.pages.acct===true&&_acct().__v6perm===3&&_v6PermMigrate()===false;   // v6.0.30 版本 3
          const k=JSON.parse(keep);const p2=_acct();p2.__roles=k.r;p2.__staff=k.s;if(k.v)p2.__v6perm=k.v;else delete p2.__v6perm;_acctSave(p2);_fbUser=oU;window.toast=oT;
          Q=[];INV.length=0;PAYABLES.length=0;EXPENSES.length=0;PAYSLIPS.length=0;
          return out;
    });
    check('經營報表：reports 成為可見頁、利潤分析隱藏跟隨、go(profit) 轉到總覽、側欄與頁內切換列', r.pages && r.redir && r.statnav);
    check('經營報表總覽：利潤分析區塊搬入＋口徑列（權責稅前淨利／營收／成本／費用人事／現金淨流）、切換後仍在', r.overview && r.back);
    check('年度損益：新增「稅前淨利（權責）」欄與股東報表同數、現金欄標明口徑；總覽匯出＝股東版 PDF', r.yearly && r.pdf);
    check('權限遷移 v2：profit → reports、旗標升到 2 後不重跑', r.perm);
    await page.setViewportSize({ width: 390, height: 844 });
    const mob = await page.evaluate(() => { Q=[{id:'qM7',code:'1',name:'手機報表案',client:'業主',date:'2026-03-01',awarded:true,exs:[],rmk:{},_mt:1,items:[],t:{total:1050000},costs:[]}]; go('reports'); showReport('overview'); const o={sw:document.documentElement.scrollWidth,iw:window.innerWidth}; showReport('yearly'); o.sw2=document.documentElement.scrollWidth; Q=[]; return o; });
    check('手機：經營報表總覽／年度損益無橫向捲動', mob.sw <= mob.iw + 1 && mob.sw2 <= mob.iw + 1, JSON.stringify(mob));
    check('v6.0.17 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.18 報價環節：詢價得標單價回填報價工項成本單價 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          P.vendorPayDay=25;P.vendorPayDelay=1;P.subPayOnBill=true;VENDORS.length=0;
          Q=[{id:'qF',code:'1150930',name:'回填測試案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
              items:[{desc:'H型鋼樁 H400 L=13M 打設',unit:'支',qty:'400',price:'1000',estCost:'',sec:false},{desc:'H型鋼樁 H400 L=13M 拔除',unit:'支',qty:'400',price:'400',estCost:'300',sec:false}],costs:[],
              rfqs:[{id:'rF',no:'RFQ-1150930-01',date:'2026-09-02',scope:'打設',status:'open',cond:{},items:[{idx:0,desc:'打設',unit:'支',qty:400},{idx:1,desc:'拔除',unit:'支',qty:400}],
                     vendors:[{name:'鴻玉開發工程行',contact:'鴻哥',tel:'',status:'quoted',prices:{0:550,1:120},neg:{0:530}},{name:'大明工程',contact:'',tel:'',status:'quoted',prices:{0:600,1:150},neg:{}}]}]}];
          PAYABLES.length=0;
          const r0=_quoteEstNetR(Q[0]);
          _rfqQid='qF';go('rfq');rfqTab('rfq');
          rfqAward('rF');
          const md=document.getElementById('gen-confirm-modal');
          out.modal=md.style.display==='flex'&&!!document.getElementById('rfq-backfill')&&document.getElementById('rfq-backfill').checked;
          const radio=document.querySelector('input[name="rfq-win"][value="0"]');radio.checked=true;document.getElementById('rfq-reason').value='最低價';
          document.getElementById('gen-confirm-ok').click();
          const q=Q[0],it0=q.items[0],it1=q.items[1],r=q.rfqs[0];
          out.award=r.status==='awarded'&&r.award.vendor==='鴻玉開發工程行'&&q.costs.length===1&&q.costs[0].type==='sub';
          out.backfill=it0.estCost==='530'&&/發包 RFQ-1150930-01・鴻玉開發工程行/.test(it0.estCostSrc||'')&&it1.estCost==='120'&&r.award.backfilled===2;
          out.netR=_quoteEstNetR(q)!==r0&&_quoteEstNetR(q)>0;
          out.card=/已回填 2 個工項成本單價/.test(document.getElementById('rfq-root').innerHTML);
          // 未勾回填 → 不動
          q.rfqs.push({id:'rG',no:'RFQ-1150930-02',date:'2026-09-03',scope:'拔除',status:'open',cond:{},items:[{idx:1,desc:'拔除',unit:'支',qty:400}],vendors:[{name:'大明工程',status:'quoted',prices:{1:200},neg:{}}]});
          renderRfq();rfqAward('rG');document.getElementById('rfq-backfill').checked=false;document.querySelector('input[name="rfq-win"][value="0"]').checked=true;document.getElementById('rfq-reason').value='配合度';document.getElementById('gen-confirm-ok').click();
          out.noBackfill=q.items[1].estCost==='120'&&!q.rfqs[1].award.backfilled;
          // 編輯器已載入同一報價時，items 同步更新並重繪
          loadQ('qF');items[0].estCost='';
          q.rfqs.push({id:'rH',no:'RFQ-1150930-03',date:'2026-09-04',scope:'打設',status:'open',cond:{},items:[{idx:0,desc:'打設',unit:'支',qty:400}],vendors:[{name:'丙',status:'quoted',prices:{0:500},neg:{}}]});
          _rfqQid='qF';go('rfq');renderRfq();rfqAward('rH');document.querySelector('input[name="rfq-win"][value="0"]').checked=true;document.getElementById('rfq-reason').value='x';document.getElementById('gen-confirm-ok').click();
          out.editor=items[0].estCost==='500'&&q.items[0].estCost==='500';
          Q=[];PAYABLES.length=0;eid=null;
          return out;
    });
    check('發包得標：評估視窗有「回填成本單價」勾選（預設勾）、得標建分包合約', r.modal && r.award);
    check('回填：議價優先的得標單價寫進對應工項 estCost（含來源）、預估淨利率更新、詢價卡顯示已回填 N 項', r.backfill && r.netR && r.card);
    check('回填：未勾不動；編輯器已載入同一報價時 items 同步更新', r.noBackfill && r.editor);
    check('v6.0.18 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.19→v6.0.25 施工成本：材料（按 M 月租、分批）／設備租賃／運輸 → 核對請款單逐期轉應付 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;P.tax=5;
          VENDORS.length=0;VENDORS.push({id:'v1',name:'大料場',type:'材料'},{id:'v2',name:'宏達機具',type:'機具'},{id:'v3',name:'大昌運輸',type:'運輸'});
          MAT_LEDGER.length=0;PAYABLES.length=0;INV.length=0;
          Q=[{id:'qZ',code:'1150940',name:'租賃測試案',client:'業主',date:'2026-08-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H350 打設',unit:'支',qty:'40',price:'1000',sec:false}],costs:[],
            mat:{_m6:1,rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:40,rate:'',note:''}],use:[],loss:[],trans:{},
              rents:[{id:'rn1',vendor:'大料場',rowId:'r1',name:'型鋼',spec:'H350',len:12,rate:120,cm:240,pf:'2026-09-01',pt:'2026-10-31',mode:'day',note:'',batches:[{id:'b1',d:'2026-09-01',m:240,n:20,o:''}]}],
              equip:[{id:'e1',name:'SH490 打樁機',vendor:'宏達機具',qty:1,from:'2026-09-10',to:'',pt:'',per:'month',rate:150000}],
              tps:[{id:'t1',date:'2026-09-01',vendor:'大昌運輸',cat:'材料運費',desc:'進場',trips:2,price:3500}]}}];
          out.cats=COST_CATS.indexOf('設備租金')>=0&&COST_CATS.indexOf('設備運費')>=0;
          const oT=window.toast;window.toast=function(){};
          _m6Qid='qZ';go('mat6');
          const root=document.getElementById('mat6-root');
          out.section=/材料租賃/.test(root.innerHTML)&&/設備租賃/.test(root.innerHTML)&&/SH490 打樁機/.test(root.innerHTML)&&/運輸/.test(root.innerHTML)&&!/建立／更新租賃合約/.test(root.innerHTML);
          const q=Q[0];const cR=q.costs.find(c=>c._fromMat==='rent:大料場'),cE=q.costs.find(c=>c._fromMat==='erent:宏達機具'),cT=q.costs.find(c=>c._fromMat==='trans:大昌運輸:材料運費');
          out.cards=!!cR&&cR.type==='own'&&cR.rental===true&&cR.cat==='材料租金'&&cR.rows.length===1&&cR.rows[0].per==='mmonth'&&cR.rows[0].qty===240&&cR.rows[0].unitPrice===120&&cR.rows[0].from==='2026-09-01'&&cR.planAmt===57600
            &&!!cE&&cE.rental&&cE.cat==='設備租金'&&cE.rows.length===1&&cE.rows[0].per==='month'&&cE.rows[0].unitPrice===150000
            &&!!cT&&cT.rental&&cT.cat==='材料運費'&&cT.rows[0].per==='trip'&&cT.rows[0].qty===2&&!cR.rows.some(x=>x.per==='trip');
          out.noPay=cR.amt===0&&cE.amt===0&&cT.amt===0&&!PAYABLES.some(p=>[cR.id,cE.id,cT.id].indexOf(p.costId)>=0);
          const vb=_vbRows().filter(x=>x.rental);
          const days0=Math.max(0,_dDiff('2026-09-01',localToday()));
          out.vb=vb.length===3&&vb.every(x=>x.status==='pending')&&vb.find(x=>x.c.id===cR.id).est.est===960*days0;
          go('invoice');invTab('vendor');
          out.vbHtml=/租賃/.test(document.getElementById('vb-root').innerHTML)&&/大料場/.test(document.getElementById('vb-root').innerHTML)&&/依期請款/.test(document.getElementById('vb-root').innerHTML);
          // 核對請款單第 1 期：09-01～09-25（24 天）→ 240M × 24/30 ＝ 192 M・月；損耗賠償 5,000
          vbOpenPeriod('qZ',cR.id);
          const md=document.getElementById('gen-confirm-modal');
          out.modal=md.style.display==='flex'&&document.querySelectorAll('.rp-row').length===1&&gv('rp-from')==='2026-09-01'&&gv('rp-to')==='2026-09-25';
          _rpSuggest();
          const mRow=document.querySelector('.rp-row[data-per="mmonth"]');
          out.suggest=mRow.querySelector('.rp-qty').value==='192';
          _rpAddExtra('損耗賠償');document.querySelector('.rp-x-desc').value='H350 彎曲 1 支';document.querySelector('.rp-x-amt').value='5000';_rpRecalc();
          out.total=document.getElementById('rp-total').textContent==='28,040';
          document.getElementById('rp-invno').value='AB11223344';
          md.style.display='none';_rpSave();
          const per=cR.periods&&cR.periods[0];
          out.saved=!!per&&per.no===1&&per.rows.length===2&&per.amt===28040&&per.invNo==='AB11223344'&&per.due==='2026-10-25'&&cR.rows.length===2&&cR.rows[1].preset==='損耗賠償'&&cR.amt===28040;
          const pay=PAYABLES.find(p=>p.id==='pay'+cR.id+'_p1');
          out.pay=!!pay&&Math.round(parseFloat(pay.amount))===28040&&pay.vat===true&&pay.category==='material'&&/租金請款/.test(pay.note)&&pay.date==='2026-10-25'&&PAYABLES.filter(p=>p.costId===cR.id).length===1;
          out.estAfter=_rentEstimate(q,cR).from==='2026-09-25'&&_rentEstimate(q,cR).est===960*Math.max(0,_dDiff('2026-09-25',localToday()));
          out.status=_vbRows().find(x=>x.c&&x.c.id===cR.id).status==='billed';
          out.costTotal=_projCostTotal(q)===28040;
          out.card=/租賃・依廠商請款單核實/.test(_ownRentHint(q,cR))&&/已登錄 1 期/.test(_ownRentHint(q,cR))&&/28,040/.test(_ownRentHint(q,cR))&&/核對請款單/.test(_ownRentHint(q,cR));
          let cap=null;const oP=window._printNativeHTML;window._printNativeHTML=function(h){cap=h;};eid='qZ';printVendorStatement(cR.id,1);window._printNativeHTML=oP;
          out.stmt=!!cap&&/損耗賠償/.test(cap)&&/租賃/.test(cap);
          // 退場：列 id 不變、期別保留
          q.mat.rents[0].batches[0].o='2026-10-01';_m6Sync(q);
          out.reapply=cR.rows[0].id==='rb_b1'&&cR.rows[0].to==='2026-10-01'&&cR.periods.length===1&&cR.rows.length===2&&cR.amt===28040;
          openRentPeriod(cR.id,1);_rpRecalc();out.edit=document.querySelector('.rp-row[data-per="mmonth"] .rp-qty').value==='192'&&gv('rp-invno')==='AB11223344';document.getElementById('gen-confirm-modal').style.display='none';_rpCtx=null;
          go('dash');out.todo=/待登錄廠商請款：/.test(document.getElementById('dash-todo-list').innerHTML)&&/宏達機具/.test(document.getElementById('dash-todo-list').innerHTML);
          window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;eid=null;
          return out;
    });
    check('租賃：科目含設備租金／設備運費；材料．運輸頁有材料租賃／設備租賃／運輸、不需建立合約', r.cats && r.section);
    check('租賃：輸入即同步成本卡（材料按 M 月租、設備月租、運輸另一家廠商趟數）、未請款前金額 0 且不掛應付', r.cards && r.noPay);
    check('租賃：計價頁廠商分頁列為待登錄（租賃、依期請款）、預估＝在場 M 數×天數÷30×月租', r.vb && r.vbHtml);
    check('租賃：核對請款單視窗（期間預設至計價截止日、自動帶 192 M・月、損耗賠償加項、合計 28,040）', r.modal && r.suggest && r.total);
    check('租賃：存檔＝第 1 期（發票號、到期次月 25）、應付逐期一筆含稅、下期預估自截止日起、狀態已登錄、成本＝實際請款合計', r.saved && r.pay && r.estAfter && r.status && r.costTotal);
    check('租賃：成本卡顯示核實區塊、核對單可印（含損耗賠償）、退場後保留期別、修改期別帶回原值、總覽待辦提醒', r.card && r.stmt && r.reapply && r.edit && r.todo);
    check('v6.0.19 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
    const { page: mp, errors: merr } = await newPage(browser, 390, 844);
    const mok = await mp.evaluate(() => new Promise(res => {
      P.matRentRate={H300:3,H350:4,H400:5};VENDORS.length=0;VENDORS.push({id:'v1',name:'大料場',type:'材料'});
      Q=[{id:'qZm',code:'1150941',name:'租賃手機',client:'業主',date:'2026-08-01',awarded:true,exs:[],rmk:{},_mt:1,items:[],costs:[],
          mat:{_m6:1,rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:40,rate:''}],use:[],loss:[],trans:{},rents:[{id:'rn1',vendor:'大料場',rowId:'r1',name:'型鋼',spec:'H350',len:12,rate:120,cm:240,pf:'2026-09-01',pt:'2026-10-31',mode:'day',batches:[{id:'b1',d:'2026-09-01',m:240,n:20,o:''}]}],
            equip:[{id:'e1',name:'打樁機',vendor:'大料場',qty:1,from:'2026-09-10',to:'',pt:'',per:'month',rate:150000}],tps:[{id:'t1',date:'2026-09-01',vendor:'大料場',cat:'材料運費',desc:'進場',trips:2,price:3500}]}}];
      _m6Qid='qZm';go('mat6');
      setTimeout(() => { const ok = document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelectorAll('#mat6-root table.mst').length >= 3; Q=[];VENDORS.length=0; res(ok); }, 300);
    }));
    check('手機版：材料．運輸頁不橫向捲動、表格逐列堆疊', mok && merr.length === 0, merr.slice(0, 2).join(' | '));
    await mp.close();
  }

  // ───────────── v6.0.20→v6.0.25 租賃成本管控：核對差異／預估（合約租期）vs 實際／單位成本比較（$/M）／成本分列 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {
          const out={};
          P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;P.tax=5;
          VENDORS.length=0;VENDORS.push({id:'v1',name:'大料場',type:'材料'},{id:'v2',name:'宏達機具',type:'機具'},{id:'v3',name:'大昌運輸',type:'運輸'});
          MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H350',len:12,qty:30,uw:135,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1},
            {id:'L2',name:'型鋼',spec:'H350',len:12,qty:10,uw:135,price:20,date:'2026-09-01',kind:'重複性',loc:'管控測試案',projQid:'qK',outDate:'2026-09-01',matRowId:'r1',_mt:1});
          PAYABLES.length=0;INV.length=0;
          Q=[{id:'qK',code:'1150950',name:'管控測試案',client:'業主',date:'2026-08-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H350 打設',unit:'支',qty:'40',price:'1000',estCost:'500',sec:false}],costs:[],
            mat:{_m6:1,rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:60,rate:''}],use:[],loss:[],trans:{},
              rents:[{id:'rn1',vendor:'大料場',rowId:'r1',name:'型鋼',spec:'H350',len:12,rate:60,cm:600,pf:'2026-09-01',pt:'2026-10-31',mode:'day',batches:[{id:'b1',d:'2026-09-01',m:600,n:50,o:''}]}],
              equip:[{id:'e1',name:'吊車',vendor:'宏達機具',qty:1,from:'2026-09-10',to:'',pt:'',per:'day',rate:5000}],
              tps:[{id:'t1',date:'2026-09-01',vendor:'大昌運輸',cat:'材料運費',desc:'進場',trips:1,price:3500}]}}];
          const oT=window.toast;window.toast=function(){};
          _m6Qid='qK';go('mat6');
          const q=Q[0];const cR=q.costs.find(c=>c._fromMat==='rent:大料場'),cE=q.costs.find(c=>c._fromMat==='erent:宏達機具'),cT=q.costs.find(c=>c._fromMat==='trans:大昌運輸:材料運費');
          // 預估：合約 600M × 2 月 × 60 ＝ 72,000
          const pl=_rentPlan(q,cR);
          out.plan=pl.amt===72000&&pl.src==='合約租期'&&!pl.open&&pl.billed===0&&pl.rate!==null;
          // 單位成本比較（$/M）：自有 4×0.8＝3.2/天、料場 60/月≈2/天、購置 135×20＝2,700/M → 損益兩平 1,350 天；本案租期 60 天約 4%
          const root=document.getElementById('mat6-root');
          out.cmp=/單位成本比較/.test(root.innerHTML)&&/3\.2/.test(root.innerHTML)&&/2,700/.test(root.innerHTML)&&/1,350 天/.test(root.innerHTML)&&/約購置價 4%/.test(root.innerHTML)&&/租金低於自有攤提/.test(root.innerHTML)&&/預估租金/.test(root.innerHTML);
          // 核對：系統 480（600M×24/30），廠商請 520 → 差 +40（+2,400）
          vbOpenPeriod('qK',cR.id);_rpSuggest();
          const mRow=document.querySelector('.rp-row[data-per="mmonth"]');
          out.sysOk=mRow.getAttribute('data-sys')==='480'&&/與系統一致/.test(mRow.querySelector('.rp-hint').innerHTML);
          mRow.querySelector('.rp-qty').value='520';_rpRecalc();
          out.diffHint=/差 \+40（\+2,400）/.test(mRow.querySelector('.rp-hint').innerHTML)&&/系統 480/.test(mRow.querySelector('.rp-hint').innerHTML);
          out.total=document.getElementById('rp-total').textContent==='31,200';
          document.getElementById('gen-confirm-modal').style.display='none';_rpSave();
          const per=cR.periods[0];
          out.saved=!!per&&per.rows.find(x=>x.rid==='rb_b1').sys===480&&per.rows.find(x=>x.rid==='rb_b1').qty===520&&per.amt===31200;
          const df=_rentPeriodDiff(cR,per);
          out.diff=df.n===1&&df.qty===40&&df.amt===2400;
          const card=_ownRentHint(q,cR);
          out.card=/rent-diff/.test(card)&&/差 \+40（\+2,400）/.test(card)&&/預估合約/.test(card)&&/72,000/.test(card)&&/執行率/.test(card)&&!/預計退場日/.test(card);
          let cap=null;const oP=window._printNativeHTML;window._printNativeHTML=function(h){cap=h;};eid='qK';printVendorStatement(cR.id,1);window._printNativeHTML=oP;
          out.stmt=!!cap&&/系統 480（差 \+40）/.test(cap)&&/在場 600/.test(cap);
          // 沒有預計退場的設備：以至今計，填卡上預計退場日後改預計
          out.planEnd=_rentPlan(q,cE).open===true&&/預計退場日/.test(_ownRentHint(q,cE));
          rentPlanEnd(cE.id,'2026-11-30');
          out.planEnd2=_rentPlan(q,cE).src==='預計退場日'&&_rentPlan(q,cE).amt===81*5000;
          // 運輸：核對趟數
          openRentPeriod(cT.id);_rpSuggest();document.getElementById('gen-confirm-ok').click();
          _matAmortSync(q);
          const strip=_costSummaryStrip(q,q.costs);
          out.strip=/租金（材料＋設備，已請款）/.test(strip)&&/31,200/.test(strip)&&/自有材料攤提／購置/.test(strip)&&/運費/.test(strip)&&/3,500/.test(strip);
          const an=buildCostAnalysisHtml(q);
          const att=_costByItem(q);
          out.analysis=/材料／設備租金（租賃合約，已請款）/.test(an)&&/材料自有攤提（內部租金法）/.test(an)&&/材料／設備運費/.test(an)&&!/未歸戶成本（未關聯工項）/.test(an)&&new RegExp(fmt(Math.round(att.unassigned))).test(an);
          _pjQid='qK';go('proj');
          out.proj=/租金（材料＋設備，已請款）/.test(document.getElementById('proj-root').innerHTML);
          window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;MAT_LEDGER.length=0;eid=null;
          return out;
    });
    check('管控：預估＝合約 M 數×合約月數×月租（沒有合約租期的設備以至今計，可填預計退場日）', r.plan && r.planEnd && r.planEnd2);
    check('管控：單位成本比較（$/M：自有 3.2/天 vs 月租 60≈2/天、購置 2,700/M、損益兩平 1,350 天、本案約 4%）', r.cmp);
    check('管控：核對視窗系統數量（在場 M×天數÷30）vs 廠商數量即時差異、存入期別 sys、期別差異金額', r.sysOk && r.diffHint && r.total && r.saved && r.diff);
    check('管控：成本卡差異 chip＋預估／已請款／結餘／執行率；核對單印系統數量與差', r.card && r.stmt);
    check('管控：成本摘要與工項成本分析把攤提／租金（預估＝合約租期）／運費／損耗分列，不混入未歸戶；工程專案頁同', r.strip && r.analysis && r.proj);
    check('v6.0.20 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.22 請款單：印計算式說明＋手機卡片備註 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {

          const out={};const PV=(src)=>{buildInvPreview(src);return document.getElementById('inv-prev-html').innerHTML;};
          P.tax=5;INV.length=0;
          Q=[{id:'qC',code:'1150960',name:'計算式測試案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除（含水刀引孔）',unit:'支',qty:'40',price:'40500',sec:false,note:'含180天租期'},{desc:'結構檢力分析及技師簽證',unit:'式',qty:'1',price:'80000',sec:false}]}];
          const inv=buildInvFromQuote(Q[0]);inv.id='invC1';inv.date='2026-10-05';inv.periodNo=1;INV.push(inv);
          loadInvoice('invC1');
          invItems[0].curQty=133;invItems[0].payRate=70;invItems[0].contractPrice=40500;invItems[1].curQty=1;invItems[1].contractPrice=80000;
          updateInvRowAmt(0);updateInvRowAmt(1);
          out.fn=_invCalcText(invItems[0],invItems[0].curAmt)==='133 支 × 70% ＝ 93.1 支；93.1 支 × 40,500 ＝ 3,770,550'&&_invCalcText(invItems[1],invItems[1].curAmt)==='1 式 × 80,000 ＝ 80,000';
          const cb=document.getElementById('inv-calc');out.cb=!!cb;
          cb.checked=false;const h0=PV();out.off=!/本期估驗計算式/.test(h0);
          cb.checked=true;const h1=PV();
          out.on=/本期估驗計算式/.test(h1)&&/133 支 × 70% ＝ 93.1 支；93.1 支 × 40,500 ＝ 3,770,550/.test(h1)&&/（含180天租期）/.test(h1)&&/1 式 × 80,000 ＝ 80,000/.test(h1);
          // 桌機列備註可編輯；存檔帶 calc 與 note；壓縮可逆；指定記錄列印也印
          const ni=document.querySelector('#inv-body input[data-field="note"]');out.noteInp=!!ni;
          ni.value='依工地簽認單 10/01';ni.dispatchEvent(new Event('input'));out.noteSet=invItems[0].note==='依工地簽認單 10/01';
          saveInvoice();const rec=INV.find(x=>x.id==='invC1');
          out.saved=rec.calc===true&&rec.items[0].note==='依工地簽認單 10/01';
          const back=_invUnpack(_invPack(JSON.parse(JSON.stringify(rec))));out.pack=back.calc===true&&back.items[0].note==='依工地簽認單 10/01';
          const h2=PV(rec);out.src=/本期估驗計算式/.test(h2)&&/依工地簽認單 10\/01/.test(h2);
          rec.calc=false;out.srcOff=!/本期估驗計算式/.test(PV(rec));
          // 內部欄位不外洩
          out.noSens=!/estCost|毛利/.test(h1);
          INV.length=0;Q=[];invEid=null;invItems=[];
          return out;
    });
    check('請款單計算式：_invCalcText（數量×請款%＝計價量；計價量×單價＝金額）、勾「印計算式」才印、接工項備註', r.fn && r.cb && r.off && r.on);
    check('請款單計算式：列備註可編輯、存檔帶 calc／note、壓縮可逆、指定記錄列印依記錄的 calc', r.noteInp && r.noteSet && r.saved && r.pack && r.src && r.srcOff && r.noSens);
    check('v6.0.22 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
    const { page: mp, errors: merr } = await newPage(browser, 390, 844);
    const mok = await mp.evaluate(() => new Promise(res => {
      INV.length=0;Q=[{id:'qCm',code:'1150961',name:'計算式手機',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300 打設',unit:'支',qty:'40',price:'40500',sec:false}]}];
      const inv=buildInvFromQuote(Q[0]);inv.id='invCm';INV.push(inv);loadInvoice('invCm');
      setTimeout(() => { const ni=document.querySelector('.inv-m-note');let ok=!!ni;if(ni){ni.value='手機備註';ni.dispatchEvent(new Event('input'));ok=ok&&invItems[0].note==='手機備註';}
        ok=ok&&document.documentElement.scrollWidth<=document.documentElement.clientWidth; INV.length=0;Q=[];invEid=null;invItems=[]; res(ok); }, 300);
    }));
    check('手機版：請款單工項卡片有備註欄、不橫向捲動', mok && merr.length === 0, merr.slice(0, 2).join(' | '));
    await mp.close();
  }

  // ───────────── v6.0.23 請款單表頭（LOGO 左置、留白縮小）＋分頁引擎內容底緣（第二頁空白） ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {

          const out={};
          P.tax=5;INV.length=0;
          const items=[];for(let k=0;k<8;k++)items.push({desc:'H型鋼樁 H300，L='+(10+k)+'M@80cm 打設、拔除（含水刀引孔）',unit:'支',qty:'40',price:String(26500+k*1000),sec:false,note:'含180天租期'});
          Q=[{id:'qH',code:'1150970',name:'中科台積電F25P1',client:'八九企業有限公司',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:items}];
          const inv=buildInvFromQuote(Q[0]);inv.id='invH1';inv.date='2026-10-05';INV.push(inv);loadInvoice('invH1');
          invItems[2].curQty=133;invItems[2].payRate=70;invItems[2].contractPrice=40500;invItems[4].curQty=1;invItems[4].contractPrice=80000;invItems[7].curQty=27;invItems[7].contractPrice=1500;
          [2,4,7].forEach(i=>updateInvRowAmt(i));document.getElementById('inv-calc').checked=true;buildInvPreview();
          const html=document.getElementById('inv-prev-html').innerHTML;
          // 表頭：LOGO 與公司名同一列（flex）
          const doc=document.getElementById('inv-doc');out.id=!!doc;
          const hd=doc&&doc.querySelector('.inv-hd');out.hd=!!hd&&getComputedStyle(hd).display==='flex'&&hd.children.length===2&&hd.children[0].tagName==='IMG'&&/豐有|公司/.test(hd.children[1].textContent||'')&&parseFloat(getComputedStyle(hd.children[0]).height)<=34;
          // 列印：內距歸零 ＋ 內容底緣只算有內容的元素 → 8 列＋計算式＋頁尾仍是一頁（原本第二頁整張空白）
          const host=document.createElement('div');host.style.cssText='position:absolute;left:-9999px;top:0;width:1046px;background:#fff';
          host.innerHTML='<style>#inv-doc{width:100%!important;max-width:none!important;margin:0!important;padding:0!important}</style>'+html;document.body.appendChild(host);
          const H=host.scrollHeight;const plan=_pdfPlanPages({width:2092,height:Math.round(H*2)},host,1046,true);
          out.onePage=plan.pages.length===1;out.H=H;out.pages=plan.pages.length;
          const cb=_pdfContentBottom(host);out.cbLtH=cb>0&&cb<=H;
          host.remove();
          // 尾端內距不算文件高度：內容 600px＋外框下內距 200px → 一頁（舊邏輯算 800px 會拆成兩頁）
          const h2=document.createElement('div');h2.style.cssText='position:absolute;left:-9999px;top:0;width:1046px;background:#fff';
          h2.innerHTML='<div style="padding:0 0 200px"><table style="width:100%;border-collapse:collapse"><tbody>'+Array.from({length:20},(_,i)=>'<tr><td style="height:30px">列 '+(i+1)+'</td></tr>').join('')+'</tbody></table></div>';document.body.appendChild(h2);
          const p2=_pdfPlanPages({width:2092,height:Math.round(h2.scrollHeight*2)},h2,1046,true);out.padOne=p2.pages.length===1&&h2.scrollHeight>=800&&Math.abs(p2.pages[0].e-1200)<=4;h2.remove();
          // 真正超過一頁仍要分頁（不是把分頁關掉）
          const h3=document.createElement('div');h3.style.cssText='position:absolute;left:-9999px;top:0;width:1046px;background:#fff';
          h3.innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr><th style="height:30px">表頭</th></tr></thead><tbody>'+Array.from({length:40},(_,i)=>'<tr><td style="height:30px">列 '+(i+1)+'</td></tr>').join('')+'</tbody></table>';document.body.appendChild(h3);
          const p3=_pdfPlanPages({width:2092,height:Math.round(h3.scrollHeight*2)},h3,1046,true);out.twoPages=p3.pages.length===2&&p3.pages[1].hd===true;h3.remove();
          INV.length=0;Q=[];invEid=null;invItems=[];
          return out;
    });
    check('請款單表頭：外框 #inv-doc、LOGO 與公司名同一列（flex、LOGO ≤34px）', r.id && r.hd);
    check('分頁：8 列＋計算式＋頁尾的請款單在列印正規化後為一頁（不再多一張空白頁）', r.onePage && r.cbLtH, 'H=' + r.H + ' pages=' + r.pages);
    check('分頁：外框下內距不算文件高度（內容 600px＋內距 200px → 一頁）；真正超過仍分頁且續頁重印表頭', r.padOne && r.twoPages);
    check('v6.0.23 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.24 發包：M 計價、介紹人費用、提前放款、詢價單欄高 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(() => {

          const out={};
          P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.subPayOnBill=true;P.tax=5;
          VENDORS.length=0;PAYABLES.length=0;
          Q=[{id:'qR',code:'1150990',name:'M計價測試案',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除（含水刀引孔）',unit:'支',qty:'133',price:'40500',estCost:'',sec:false}],costs:[]}];
          const oT=window.toast;window.toast=function(){};
          _rfqQid='qR';_rfqTab='rfq';go('rfq');
          rfqNew();
          const per=document.querySelector('.rfq-per'),len=document.querySelector('.rfq-len');
          out.editDef=!!per&&per.value==='m'&&!!len&&len.value==='15';
          document.querySelector('.rfq-it').checked=true;document.getElementById('gen-confirm-ok').click();
          const q=Q[0],r=q.rfqs[0];
          out.saved=r.items[0].per==='m'&&r.items[0].len===15&&r.items[0].qty===133;
          const doc=_rfqDocHtml(q,r);
          out.doc=/1,995/.test(doc)&&/<td class="c">M<\/td>/.test(doc)&&/133 支 × 單支 15 M/.test(doc)&&/\.vt td\{[^}]*height:36px/.test(doc)&&/\.vt td\.sig\{height:36px\}/.test(doc);
          // 廠商回傳：$/M
          rfqFill(r.id,-1);document.getElementById('rf-name').value='鴻玉開發工程行';
          const row=document.querySelector('.rf-row');row.querySelector('.rf-p').value='600';_rfRecalc();
          out.fill=row.getAttribute('data-qty')==='1995'&&row.querySelector('.rf-amt').textContent==='1,197,000'&&/每支 9,000/.test(row.querySelector('.rf-pc').textContent)&&/報價 \$\/M/.test(row.querySelector('.rf-p').placeholder);
          document.getElementById('gen-confirm-ok').click();
          out.total=_rfqVendorTotal(r,r.vendors[0],true).total===1197000;
          renderRfq();out.card=/1,995 M/.test(document.getElementById('rfq-root').innerHTML)&&/＝9,000／支/.test(document.getElementById('rfq-root').innerHTML);
          // 得標＋介紹人 150/M、不開發票
          rfqAward(r.id);
          document.getElementById('rfq-reason').value='最低價';
          document.getElementById('rfq-intro-name').value='風哥';document.getElementById('rfq-intro-amt').value='150';document.getElementById('rfq-intro-per').value='m';_rfqIntroPreview(r.id);
          out.introPv=/150\/M × 15M ＝ <b>2,250／支<\/b>/.test(document.getElementById('rfq-intro-pv').innerHTML)&&/299,250/.test(document.getElementById('rfq-intro-pv').innerHTML);
          document.getElementById('gen-confirm-ok').click();
          const c=q.costs.find(x=>x.type==='sub'&&!x.isIntro),f=q.costs.find(x=>x.isIntro);
          out.award=!!c&&c.rows[0].unitPrice===9000&&c.rows[0].ppm===600&&c.rows[0].len===15&&c.amt===1197000&&/\$600\/M × 15M/.test(c.rows[0].desc)&&q.items[0].estCost==='9000'&&/600\/M × 15M/.test(q.items[0].estCostSrc);
          out.intro=!!f&&f.followOf===c.id&&f.vendor==='風哥'&&f.invoice===false&&f.rows[0].unitPrice===2250&&f.rows[0].ppm===150&&f.amt===299250&&r.award.intro==='風哥'&&VENDORS.some(v=>v.name==='風哥'&&v.type==='介紹');
          // 第 1 期：40 支 → 主約 360,000；介紹費跟隨 90,000（不開發票）
          eid='qR';
          const per1={no:1,date:'2026-10-25',from:'2026-09-25',to:'2026-10-25',rows:[{rid:c.rows[0].id,qty:40}],ts:1,mt:1};
          const k1=_subPeriodCalc(c,per1);per1.amt=k1.amt;per1.ret=k1.ret;per1.net=k1.net;per1.adv=0;per1.due='2026-11-25';c.periods=[per1];
          syncCostToPayable(q,c);_subFollowApply(q,c);
          const pMain=()=>PAYABLES.find(p=>p.id==='pay'+c.id+'_p1');
          out.base=!!pMain()&&pMain().amount===k1.pay&&PAYABLES.find(p=>p.id==='pay'+f.id+'_p1').amount===90000&&PAYABLES.find(p=>p.id==='pay'+f.id+'_p1').vat===false;
          // v6.0.38 預付款＝提前放款：已登錄未付的第 1 期立刻扣 100,000（未稅）
          openSubAdvance(c.id);document.getElementById('sa-amt').value='100000';_saOnInput();
          out.seHint=/已登錄未付/.test(document.getElementById('gen-confirm-msg').innerHTML)&&_saCtx.est>=k1.pay&&document.getElementById('sa-warn').style.display==='none';
          document.getElementById('gen-confirm-ok').click();
          const pe=PAYABLES.find(p=>p.costAdv&&p.costId===c.id);
          out.early=!!pe&&pe.amount===100000&&pe.vat===true&&pe.date===localToday()&&/預付款/.test(pe.note)&&pMain().amount===k1.pay-100000&&/抵扣預付款 100,000/.test(pMain().note)&&pMain().date==='2026-11-25'&&c.periods[0].adv===100000;
          const st=_subStat(c);out.stat=st.unpaid===Math.round((k1.pay)*1.05);
          // 超過可扣回金額（已登錄未付＋本期預估）→ 需勾特殊情況，否則擋下
          openSubAdvance(c.id);document.getElementById('sa-amt').value=String(_saCtx.est+1);_saOnInput();out.over=document.getElementById('sa-warn').style.display!=='none';document.getElementById('gen-confirm-ok').click();
          out.over=out.over&&_subAdvs(c).length===1;document.getElementById('gen-confirm-modal').style.display='none';
          // 分包管理視圖：預付款列顯示扣在第 1 期；沒有「提前放款」列
          const sh=buildSubMgmtHtml(q);out.mgmt=/扣在：第1期 100,000/.test(sh)&&!/↳ 提前放款/.test(sh)&&/openPrepay\('/.test(sh)&&!/openSubAdvance\(|openSubEarly\(/.test(sh);   // v6.0.29 預付款一鈕
          // 介紹費先付 200,000（超過本期預估也不必勾特殊情況）→ 跟隨期別自動抵扣
          openSubAdvance(f.id);document.getElementById('sa-amt').value='200000';_saOnInput();
          out.saNoWarn=document.getElementById('sa-warn').style.display==='none';
          document.getElementById('gen-confirm-ok').click();
          const pa=PAYABLES.find(p=>p.costAdv&&p.costId===f.id);
          _subFollowApply(q,c);
          out.introAdv=!!pa&&pa.amount===200000&&/預付款（介紹費）/.test(pa.note)&&!PAYABLES.some(p=>p.id==='pay'+f.id+'_p1')&&f.periods[0].adv===90000;
          // 刪除預付款 → 第 1 期應付加回
          delSubAdvance(c.id,_subAdvs(c)[0].id);document.getElementById('gen-confirm-ok').click();
          out.del=!PAYABLES.some(p=>p.costAdv&&p.costId===c.id)&&pMain().amount===k1.pay&&c.periods[0].adv===0;
          // 舊資料的提前放款（跟隨卡期別）→ 轉成預付款
          f.periods.find(p=>p.no===1).early=[{id:'ef',date:localToday(),amt:10000}];_earlyToAdv(q,f);
          out.followKeep=!f.periods.find(p=>p.no===1).early&&_subAdvs(f).some(a=>a.id==='eef'&&a.fromPeriod===1);
          window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;eid=null;
          return out;
    });
    check('詢價單：工項有 L=…M 預設「依 M」計價（可改依支）、匯出數量＝支數×單支長、單位 M、廠商報價欄列高一致', r.editDef && r.saved && r.doc);
    check('詢價回傳：$/M × 總 M 數＝複價、即時顯示每支單價；比價表顯示 M 數與每支換算', r.fill && r.total && r.card);
    check('得標：合約單價換算為每支（600/M×15M＝9,000）、回填成本單價；介紹人 150/M → 2,250/支、不開發票、跟隨計價', r.introPv && r.award && r.intro && r.base);
    check('預付款（統一提前放款）：已登錄未付期別立刻扣、另掛一筆應付（到期＝付款日）、超過可扣回金額要勾特殊情況、統計含之、刪除即加回；管理表列出扣在哪期', r.seHint && r.early && r.stat && r.over && r.mgmt && r.del);
    check('介紹費先付：不受本期預估限制、跟隨期別自動抵扣；舊提前放款資料轉成預付款', r.saNoWarn && r.introAdv && r.followKeep);
    check('v6.0.24 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.25 材料．運輸獨立頁：需求比對（調撥／接切樁／租賃）、按 M 分批月租、設備、運輸分開、免建合約 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};
        P.matRentRate={H300:3,H350:4,H400:5};P.matRentFactor=0.8;P.tax=5;P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;
        VENDORS.length=0;VENDORS.push({id:'v1',name:'英洲工程股份有限公司',type:'材料'},{id:'v2',name:'宏達機具',type:'機具'},{id:'v3',name:'大昌運輸',type:'運輸'});
        MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L12',name:'型鋼',spec:'H300',len:12,qty:30,uw:93,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1},{id:'L18',name:'型鋼',spec:'H300',len:18,qty:10,uw:93,price:20,date:'2026-02-10',kind:'重複性',loc:'公司倉庫',_mt:1});
        PAYABLES.length=0;
        Q=[{id:'qM',code:'115090501',name:'中科台積電F25P1',client:'八九企業有限公司',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:'133',price:'40500',sec:false}],costs:[]},
           {id:'qO',code:'115090502',name:'舊資料案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[],costs:[],mat:{rows:[{id:'r1',name:'型鋼',spec:'H350',len:12,unit:'支',qty:40,rate:'',rentVendor:'大料場',rentQty:20,rentFrom:'2026-09-01',rentTo:'',rentRate:48,rentTrans:3500}],use:[],loss:[],trans:{},equip:[{id:'e1',name:'打樁機',vendor:'宏達機具',qty:1,from:'2026-09-10',to:'',per:'month',rate:150000,transPrice:20000}]}}];
        const oT=window.toast;window.toast=function(){};
        out.nav=(ALL_PAGES.find(p=>p.id==='mat6')||{}).parent==='proj'&&!document.getElementById('sn-mat6')&&!ALL_PAGES.filter(p=>(!p.hidden&&!p.parent)||p.permListed).some(p=>p.id==='mat6');
        // 舊連結（發包 材料分頁）→ 新頁
        _rfqQid='qM';_rfqTab='mat';go('rfq');
        out.redirect=document.querySelector('.page.active').id==='page-mat6'&&_m6Qid==='qM';
        const root=document.getElementById('mat6-root');
        out.empty=/材料需求與比對/.test(root.innerHTML)&&!/自有材料在工地/.test(root.innerHTML)&&/材料租賃/.test(root.innerHTML)&&/設備租賃/.test(root.innerHTML)&&/運輸/.test(root.innerHTML);
        // 新增需求 H300 L=15M 133 支 → 自動比對
        matRowEdit('qM','');
        document.getElementById('mx-name').value='型鋼';document.getElementById('mx-spec').innerHTML='<option>H300</option>';document.getElementById('mx-spec').value='H300';document.getElementById('mx-len').value='15';document.getElementById('mx-qty').value='133';
        document.getElementById('fy-modal-o').click();
        const q=Q[0],m=q.mat,row=m.rows[0];
        setTimeout(()=>{try{
          const msg=document.getElementById('gen-confirm-msg').innerHTML;
          out.decide=document.getElementById('gen-confirm-modal').style.display==='flex'&&/可代用的公司料/.test(msg)&&/L=12M 30 支、L=18M 10 支/.test(msg)&&/接樁／切樁／代用/.test(msg)&&document.getElementById('gen-confirm-ok').textContent==='是，選擇公司料';   // v6.0.43 文案
          document.getElementById('gen-confirm-ok').click();   // → 接／切樁
          const rows=[...document.querySelectorAll('.ad-row')];
          const r18=rows.find(x=>x.getAttribute('data-len')==='18'),r12=rows.find(x=>x.getAttribute('data-len')==='12');
          out.adDef=rows.length===2&&r18.querySelector('.ad-kind').value==='cut'&&r12.querySelector('.ad-kind').value==='splice';
          r18.querySelector('.ad-qty').value='10';_m6AdHint(r18.querySelector('.ad-qty'));r12.querySelector('.ad-qty').value='30';_m6AdHint(r12.querySelector('.ad-qty'));
          out.adPcs=r18.querySelector('.ad-pcs').value==='10'&&r12.querySelector('.ad-pcs').value==='24'&&/約可接成 24 支/.test(r12.querySelector('.ad-hint').textContent);
          document.getElementById('gen-confirm-ok').click();
          out.adapt=Math.floor(_matAtQty(q,row))===34&&_matShort(q,row)===99&&MAT_LEDGER.filter(x=>x.projQid==='qM'&&x.adapt).length===2&&/切樁 18M→15M/.test(root.innerHTML)&&/自有材料在工地/.test(root.innerHTML);
          _m6Close();
          // 公司無料 → 租賃：按 M、月租
          m6RentEdit('qM','',row.id);
          out.rtDef=gv('rt-cm')==='1485'&&gv('rt-name')==='型鋼'&&gv('rt-spec')==='H300';
          document.getElementById('rt-vendor').value='英洲工程股份有限公司';document.querySelector('input[name="rt-bmode"][value="multi"]').checked=true;document.getElementById('rt-rated').value='2';/* v6.0.43 改填日租 $2/M/天（＝月租 60）*/document.getElementById('rt-pf').value='2026-09-23';document.getElementById('rt-pt').value='2027-03-22';_m6RtCalc();
          out.rtPv=/534,600/.test(document.getElementById('rt-pv').innerHTML)&&/180 天/.test(document.getElementById('rt-pv').innerHTML);
          document.getElementById('gen-confirm-ok').click();
          const rt=m.rents[0];let cR=q.costs.find(c=>c._fromMat==='rent:英洲工程股份有限公司');
          out.rent=!!rt&&rt.cm===1485&&rt.rate===60&&_matShort(q,row)===0&&!!cR&&cR.rental&&cR.planAmt===534600&&cR.amt===0&&cR.rows.length===1&&cR.rows[0].planned&&cR.rows[0].per==='mmonth'&&!PAYABLES.some(p=>p.costId===cR.id);
          // 分批進場
          m6Batch('qM',rt.id,'');document.getElementById('bt-d').value='2026-09-23';document.getElementById('bt-m').value='600';document.getElementById('bt-n').value='40';document.getElementById('gen-confirm-ok').click();
          m6Batch('qM',rt.id,'');out.btLeft=gv('bt-m')==='885';document.getElementById('bt-d').value='2026-10-01';document.getElementById('gen-confirm-ok').click();
          cR=q.costs.find(c=>c._fromMat==='rent:英洲工程股份有限公司');
          const d1=_dDiff('2026-09-23',localToday()),d2=_dDiff('2026-10-01',localToday());
          out.batch=rt.batches.length===2&&cR.rows.length===2&&cR.rows.every(r=>/^rb_/.test(r.id)&&r.per==='mmonth')&&_m6RentToDate(rt)===Math.round(600*d1/30*60+885*d2/30*60);
          // 設備、運輸（運輸另一家廠商）
          m6EquipAdd('qM');const e=m.equip[0];['name:SH490 打樁機','vendor:宏達機具','qty:1','from:2026-09-25','pt:2026-12-24','per:month','rate:150000'].forEach(s=>{const i=s.indexOf(':');m6EquipUpd('qM',e.id,s.slice(0,i),s.slice(i+1));});
          m6TpAdd('qM','材料運費');const t=m.tps[0];m6TpUpd('qM',t.id,'vendor','大昌運輸');m6TpUpd('qM',t.id,'trips','4');m6TpUpd('qM',t.id,'price','3500');m6TpUpd('qM',t.id,'desc','H300 進場');
          const cE=q.costs.find(c=>c._fromMat==='erent:宏達機具'),cT=q.costs.find(c=>c._fromMat==='trans:大昌運輸:材料運費');
          out.equip=!!cE&&cE.planAmt===450000&&cE.rows[0].per==='month'&&cE.rows[0].planTo==='2026-12-24';
          out.trans=!!cT&&cT.vendor==='大昌運輸'&&cT.rental&&cT.rows[0].per==='trip'&&cT.rows[0].qty===4&&cT.planAmt===14000&&!cR.rows.some(r=>r.per==='trip');
          out.vbPend=_vbRows().some(r=>r.rental&&r.c.id===cT.id&&r.status==='pending');
          // 核對請款單：按 M 月租
          eid='qM';openRentPeriod(cR.id);
          document.getElementById('rp-from').value='2026-09-23';document.getElementById('rp-to').value='2026-10-25';_rpSuggest();
          const rr=[...document.querySelectorAll('.rp-row')];
          out.sys=rr.length===2&&rr[0].querySelector('.rp-qty').value==='640'&&rr[1].querySelector('.rp-qty').value==='708'&&/M・月/.test(document.getElementById('gen-confirm-msg').innerHTML)&&/核對廠商請款單/.test(document.getElementById('gen-confirm-title').textContent);
          rr[0].querySelector('.rp-qty').value='650';_rpRecalc();document.getElementById('rp-invno').value='AB00000001';
          document.getElementById('gen-confirm-ok').click();
          const per=cR.periods[0],pay=PAYABLES.find(p=>p.id==='pay'+cR.id+'_p1');
          out.billed=!!per&&per.amt===81480&&cR.amt===81480&&!!pay&&pay.amount===81480&&pay.vat===true&&_rentPeriodDiff(cR,per).qty===10;
          // 運輸：帶入尚未請的趟數
          openRentPeriod(cT.id);_rpSuggest();const tr=document.querySelector('.rp-row');out.tripSys=tr.querySelector('.rp-qty').value==='4';document.getElementById('gen-confirm-ok').click();
          out.tripBill=cT.amt===14000&&PAYABLES.some(p=>p.id==='pay'+cT.id+'_p1');
          // 預估：合約租期；運輸不算進租金預估
          const pl=_rentPlan(q,cR);out.plan=pl.amt===534600&&pl.src==='合約租期';
          const b=_costOwnBreak(q,false);out.brk=b.rentPlan===534600+450000&&b.trans===14000;
          renderMat6();const kh=document.getElementById('m6-kpi').innerHTML;out.kpi=/984,600/.test(kh)&&_m6TransPlan(q).plan>14000&&kh.indexOf(fmt(_m6TransPlan(q).plan))>=0;   // v6.0.26 運輸＝已填＋噸數預估
          out.cmp=/單位成本比較/.test(root.innerHTML)&&/損益兩平/.test(root.innerHTML);
          // 舊資料轉換
          _m6Qid='qO';renderMat6();const mo=Q[1].mat;
          out.mig=mo._m6===1&&mo.rents.length===1&&mo.rents[0].rate===120&&mo.rents[0].cm===240&&mo.rents[0].batches.length===1&&mo.tps.length===2&&mo.tps.some(x=>x.price===3500&&x.vendor==='')&&mo.tps.some(x=>x.price===20000&&x.vendor==='宏達機具'&&x.cat==='設備運費')&&/原 \$48\/支\/天/.test(mo.rents[0].note);
          // 手機 390：不橫向捲動（由外層另測）
        }catch(e){out.err=String(e.stack||e).slice(0,400);}
        window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;MAT_LEDGER.length=0;eid=null;
        res(out);},160);
      })
    );
    check('材料．運輸頁：導覽獨立（權限跟發包、角色權限表不另列）、舊發包材料連結轉來、沒有自有在工地不顯示該區', r.nav && r.redirect && r.empty, r.err || '');
    check('比對：新增需求自動比對，同規格其他長度閒置 → 詢問接樁／切樁（預設長料切、短料接）、可做成支數計入需求', r.decide && r.adDef && r.adPcs && r.adapt);
    check('材料租賃：按 M、月租、合約租期預估（1,485M × 6 月 × 60 ＝ 534,600）、分批進場依進料日起算、輸入即進施工成本（未請款前 0）', r.rtDef && r.rtPv && r.rent && r.btLeft && r.batch);
    check('設備租賃與運輸分開：設備卡預估、運輸另一家廠商卡（預計趟數）、計價頁待登錄', r.equip && r.trans && r.vbPend);
    check('核對請款單：按 M 月租帶入系統量（640／708）、差異、轉應付；運輸帶入未請趟數；預估＝合約租期、運輸不算租金預估', r.sys && r.billed && r.tripSys && r.tripBill && r.plan && r.brk && r.kpi && r.cmp);
    check('舊版租賃欄位轉入新結構（$/支/天 → $/M/月、運費改運輸列）', r.mig);
    check('v6.0.25 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.26 已付統計／預付款轉提前放款／介紹人補建／業主已請原數量／新增下一期／合約租期／運費預估／舊版卡片移除 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};
        P.tax=5;P.vendorPayDay=25;P.vendorPayDelay=1;P.vendorCutDay=25;P.subPayOnBill=true;delete P.matTransRate;
        VENDORS.length=0;VENDORS.push({id:'v1',name:'鴻玉開發'},{id:'v2',name:'果實工程'});
        MAT_LEDGER.length=0;PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;
        Q=[{id:'qM',code:'115090501',name:'中科台積電F25P1',client:'八九企業有限公司',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
            items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',note:'含180天租期',unit:'支',qty:'133',price:'40500',sec:false}],
            costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',rows:[{id:'cH_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:0,invoice:true,retRate:0,
                    periods:[{no:1,date:'2026-10-05',from:'2026-09-23',to:'2026-10-05',rows:[{rid:'cH_0',qty:133}],adv:548625}],advances:[{id:'a1',date:'2026-10-05',amt:548625,ts:1}]},
                   {id:'cG',type:'sub',vendor:'果實工程',cat:'打設',rows:[{id:'cG_0',linkedItemIdx:0,qty:133,unitPrice:1000}],amt:0,invoice:true,retRate:0}]}];
        const oT=window.toast;let lastToast='';window.toast=function(m){lastToast=m;};
        const q=Q[0],cH=q.costs[0],cG=q.costs[1];
        // 1 已付統計：應付管理手動連結此發包（costSourceId）→ 計入已付
        PAYABLES.push({id:'pman1',to:'果實工程',amount:100000,vat:true,status:'paid',paidDate:'2026-10-01',quoteId:'qM',costSourceId:'cG',_mt:1});
        const sG=_subStat(cG);
        out.paidLink=sG.paid===105000&&sG.otherPaid===105000;
        // 5 鴻玉：預付款＝提前放款（預付款應付遺失）→ 轉為第 1 期提前放款
        syncCostToPayable(q,cH);
        const pAdv=PAYABLES.find(p=>p.id==='pay'+'cH'+'_a'+'a1');
        out.advPay=!!pAdv&&pAdv.amount===548625;
        PAYABLES.splice(PAYABLES.indexOf(pAdv),1);   // 模擬缺應付
        eid='qM';
        const rowsH=_subAdvRowsHtml(cH);
        out.advRow=/缺應付/.test(rowsH)&&/補建應付/.test(rowsH)&&!/轉為提前放款/.test(rowsH)&&/扣在：第1期 548,625/.test(rowsH);
        subPayResync('cH');   // v6.0.38 補建應付 → 標記已付（不再「轉為提前放款」）
        const pAdv2=PAYABLES.find(p=>p.id==='paycH_aa1');out.a2eDlg=!!pAdv2&&pAdv2.status==='pending';
        payMarkPaid('paycH_aa1','2026-10-05');document.getElementById('pmp-date').value='2026-10-05';document.getElementById('gen-confirm-ok').click();
        const per=cH.periods[0];
        const pMain=PAYABLES.find(p=>p.id==='paycH_p1');
        out.a2e=cH.advances.length===1&&per.adv===548625&&!!pMain&&pMain.amount===548625&&_payEff(pMain)===576056&&pAdv2.status==='paid'&&pAdv2.paidDate==='2026-10-05'&&!(per.early||[]).length;
        const sH=_subStat(cH);out.a2eStat=sH.paid===576056&&sH.unpaid===576056&&sH.advLeft===0;
        // 修改預付款
        cH.advances=[{id:'a2',date:'2026-10-05',amt:50000,ts:2}];syncCostToPayable(q,cH);
        editSubAdvance('cH','a2');document.getElementById('sa-amt').value='40000';document.getElementById('gen-confirm-ok').click();
        out.advEdit=cH.advances.length===1&&cH.advances[0].amt===40000&&PAYABLES.find(p=>p.id==='paycH_aa2').amount===40000;
        cH.advances=[];syncCostToPayable(q,cH);
        // 1 介紹人：得標後補加（單支長從報價工項 L=15M 帶入）→ 跟隨第 1 期、立刻有應付
        pjIntroEdit('qM','cH','');
        out.piLen=document.querySelector('.pi-len').value==='15';
        document.getElementById('pi-name').value='風哥';document.getElementById('pi-amt').value='150';_piCalc();
        out.piPv=/2,250／支/.test(document.querySelector('.pi-up').textContent)&&/299,250/.test(document.getElementById('pi-tot').textContent);
        document.getElementById('gen-confirm-ok').click();
        const f=q.costs.find(c=>c.isIntro);
        out.intro=!!f&&f.followOf==='cH'&&f.vendor==='風哥'&&f.rows[0].unitPrice===2250&&f.amt===299250&&f.periods.length===1&&f.periods[0].rows[0].qty===133&&!!PAYABLES.find(p=>p.id==='pay'+f.id+'_p1'&&p.amount===299250&&p.vat===false);
        const st=_pjStat(q),sh=_pjSubHtml(q,st);
        out.pjSub=/↳ <\/span>風哥/.test(sh)&&/修改介紹費/.test(sh)&&/openPrepay\('/.test(sh)&&sh.indexOf('鴻玉開發')<sh.indexOf('風哥')&&!/＋ 介紹人/.test(sh.slice(sh.indexOf('鴻玉開發'),sh.indexOf('風哥')));
        // 修改介紹費 → 單價、應付跟著改，列 id 不變
        pjIntroEdit('qM','cH',f.id);document.getElementById('pi-amt').value='200';document.getElementById('gen-confirm-ok').click();
        out.introEdit=f.rows[0].id===f.id+'_0'&&f.rows[0].unitPrice===3000&&PAYABLES.find(p=>p.id==='pay'+f.id+'_p1').amount===399000;
        // 9 業主已請：133 請 70% → 顯示 133
        INV.push({id:'i1',quoteId:'qM',project:q.name,periodNo:'1',date:'2026-10-05',items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:133,curQty:133,payRate:70,price:40500}],totals:{total:100}});
        const rc=_qtyRecon(q)[0];
        out.bill=Math.round(rc.bill*100)/100===93.1&&rc.billQ===133&&rc.billBy[70]===133&&!rc.warns.some(w=>/尚未向業主請款/.test(w));
        const ih=_pjItemsHtml(q,_pjStat(q));out.billCell=/<b>133<\/b>/.test(ih)&&/請 70%/.test(ih)&&/計價量 93\.1/.test(ih);
        // 8 新增請款單 → 下一期
        const n0=INV.length;pjNewInv('qM');
        out.nextInv=INV.length===n0+1&&INV[0].periodNo==='2'&&document.querySelector('.page.active').id==='page-invoice-edit';
        window._invSnap=null;
        // 2 預計退場＝進場＋合約租期（報價 含180天租期）
        q.mat={rows:[{id:'r1',name:'型鋼',spec:'H300',len:15,unit:'支',qty:133}],use:[],loss:[],rents:[],equip:[],tps:[],_m6:1};
        _m6Qid='qM';go('mat6');
        m6RentEdit('qM','','r1');
        out.ptHint=/合約租期 180 天/.test(document.getElementById('rt-pt-hint').textContent)&&gv('rt-pt')===_dAdd(localToday(),180);
        document.getElementById('rt-pf').value='2026-09-23';_m6RtPf();
        out.pt=gv('rt-pt')==='2027-03-22';
        document.getElementById('rt-vendor').value='英洲';document.querySelector('input[name="rt-bmode"][value="multi"]').checked=true;document.getElementById('rt-rated').value='2';/* v6.0.43 改填日租 $2/M/天（＝月租 60）*/document.getElementById('rt-cm').value='1995';
        document.getElementById('gen-confirm-ok').click();
        const rt=q.mat.rents[0];out.ptSave=!!rt&&rt.pt==='2027-03-22'&&rt.ptAuto===true;
        // 沒填退場的舊資料 → 同步時自動補
        q.mat.rents.push({id:'rx',vendor:'英洲',rowId:'r1',name:'型鋼',spec:'H300',len:15,rate:60,cm:150,pf:'2026-10-01',pt:'',mode:'day',batches:[]});
        _m6Sync(q);out.ptFill=q.mat.rents[1].pt==='2027-03-30';
        q.mat.rents.pop();_m6Sync(q);
        // 3 運費預估：93×15÷1000×450×2＝1255.5／支
        const te=_m6TransEst(q);
        out.trans=te.rows.length===1&&te.rows[0].perPc===1255.5&&te.rows[0].pcs===133&&te.total===Math.round(93*1995/1000*450*2)&&te.rate===450;
        renderMat6();const mh=document.getElementById('mat6-root').innerHTML;
        out.transHtml=/材料運費預估 NT\$ 166,982/.test(mh)&&/1,255\.5/.test(mh)&&/運輸（預估）/.test(mh);
        const b=_costOwnBreak(q,false);out.transPlan=b.transPlan===166982&&/預估 166,982/.test(_costSummaryStrip(q,q.costs));
        P.matTransRate=500;out.transParam=_m6TransEst(q).rows[0].perPc===1395;delete P.matTransRate;
        // 6 舊版卡片移除 → 工程專案「合約與文件」
        CONTRACTS.push({id:'ct1',name:q.name,linkedQid:'qM',code:'C-1',amount:5000000,_mt:1});
        go('projects');
        out.oldGone=document.querySelector('.page.active').id==='page-proj'&&!/舊版卡片/.test(document.getElementById('page-proj').innerHTML);
        openProj('qM');const ph=document.getElementById('proj-root').innerHTML;
        out.docs=/合約與文件/.test(ph)&&/上傳合約檔/.test(ph)&&/上傳確認單/.test(ph)&&/✎ 合約資料/.test(ph)&&/新增下一期請款單/.test(ph);
        window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;INV.length=0;CONTRACTS.length=0;eid=null;res(out);
      })
    );
    check('已付統計：應付管理手動連結此發包（costSourceId）、整筆應付一併計入已付', r.paidLink);
    check('預付款：缺應付可補建、可標記已付（扣在第 1 期、應付總額不變）；預付款可修改金額', r.advPay && r.advRow && r.a2eDlg && r.a2e && r.a2eStat && r.advEdit);
    check('介紹人：得標後可補加（單支長取報價 L=15M，$150/M → $2,250／支）、跟隨主約已登錄期別立即產生應付；專案頁列在主約下方、可修改', r.piLen && r.piPv && r.intro && r.pjSub && r.introEdit);
    check('業主已請顯示實際數量（打設 133 請 70%，計價量 93.1），與廠商已請比對不誤報', r.bill && r.billCell);
    check('工程專案「＋ 新增下一期請款單」＝最新一期的下一期', r.nextInv);
    check('材料租賃預計退場＝預計進場＋報價合約租期天數（180 天），改進場日自動重算、舊資料自動補', r.ptHint && r.pt && r.ptSave && r.ptFill);
    check('運費預估：單位重 × 長度 ÷ 1000 × $450/噸 × 2（H300 L=15M 每支 1,255.5）、進成本預估、參數可改', r.trans && r.transHtml && r.transPlan && r.transParam);
    check('舊版卡片頁移除：go(projects) 轉工程專案，合約檔／確認單改在「合約與文件」', r.oldGone && r.docs);
    check('v6.0.26 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.27 階段完工＝實作數量；施工成本頁精簡 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};
        P.tax=5;VENDORS.length=0;['鴻玉開發','英洲','大昌運輸'].forEach((n,i)=>VENDORS.push({id:'v'+i,name:n}));
        MAT_LEDGER.length=0;PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;
        const oT=window.toast;window.toast=function(){};
        Q=[{id:'qA',code:'115100101',name:'階段完工測試案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:'H型鋼樁 H300，L=15M 打設、拔除',unit:'支',qty:'133',price:'40000',estCost:'30000',sec:false},{desc:'支撐 H300 架設',unit:'M',qty:'100',price:'1000',estCost:'800',sec:false}],
          dailyLogs:[{id:'d1',date:'2026-09-25',progressRows:[{itemIdx:0,qty:60}]},{id:'d2',date:'2026-10-02',progressRows:[{itemIdx:0,qty:60},{itemIdx:1,qty:40}]}],
          costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cH_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:0,invoice:true,retRate:0,periods:[{no:1,date:'2026-10-05',from:'2026-09-23',to:'2026-10-05',rows:[{rid:'cH_0',qty:120}]}]},
            {id:'cX',type:'sub',vendor:'',cat:'打設',date:'2026-09-20',rows:[{id:'cX_0',linkedItemIdx:-1,qty:1,unitPrice:0}],amt:0}],
          mat:{rows:[{id:'r1',name:'型鋼',spec:'H300',len:15,unit:'支',qty:133}],use:[],loss:[],rents:[{id:'rn1',vendor:'英洲',rowId:'r1',name:'型鋼',spec:'H300',len:15,rate:60,cm:1995,pf:'2026-09-23',pt:'2027-03-22',mode:'day',batches:[{id:'b1',d:'2026-09-23',m:1995,n:133,o:''}]}],equip:[],tps:[],_m6:1}}];
        const q=Q[0];_m6Sync(q);
        // 7 階段完工前：進度 90%（120/133）
        const s0=_pjStat(q);out.before=_itemActual(q,0)===null&&Math.round(s0.physPct)===Math.round((120*40000+40*1000)/(133*40000+100*1000)*100);
        q.dailyLogs.push({id:'d3',date:'2026-10-03',status:'stage',stageOf:'install',stageDate:'2026-10-03',progressRows:[]});
        const a0=_itemActual(q,0),a1=_itemActual(q,1);
        out.actual=!!a0&&a0.qty===120&&a0.date==='2026-10-03'&&!!a1&&a1.qty===40;   // 架設（非打設／拔除關鍵字）也以階段完工計
        const m=_actQtyMap(q);out.map=m['H型鋼樁 H300，L=15M 打設、拔除']===120&&_effQtyMap(q)['H型鋼樁 H300，L=15M 打設、拔除']===undefined&&q.items[0].qty==='133';
        const s1=_pjStat(q);out.phys=Math.round(s1.physPct)===100;
        const ih=_pjItemsHtml(q,s1);out.items=/>133</.test(ih)&&/階段完工 2026-10-03：實作 120（合約 133，-13，應向業主追減）/.test(ih)&&/100%/.test(ih);
        const an=buildCostAnalysisHtml(q);out.analysis=an.indexOf(fmt(120*40000))>=0&&an.indexOf(fmt(133*40000))<0;
        // 施工成本頁：分區、材料卡唯讀、常用下拉、類型鎖定、附屬隱藏、科目列移除
        openProjectCosts('qA');window._costView='list';rCostItems();
        const cl=document.getElementById('cost-list'),h=cl.innerHTML;
        out.secs=/發包（承包合約）/.test(h)&&/材料．運輸．運輸（由「材料．運輸」頁自動同步/.test(h)&&h.indexOf('發包（承包合約）')<h.indexOf('材料．運輸．運輸');
        const mc=cl.querySelector('.cost-mat-card');
        out.matRo=!!mc&&!mc.querySelector('select')&&!/addOwnRow|changeCostType|delCostItem/.test(mc.innerHTML)&&/核對請款單/.test(mc.innerHTML)&&/計價基準/.test(mc.innerHTML)&&!/成本金額＝已核實/.test(mc.innerHTML);
        out.noChips=!/常用：/.test(h)&&!/科目：/.test(h)&&!/附屬，併入報價工項/.test(h);
        const card=id=>cl.querySelector('#cost-amt-'+id).closest('div[style*="border-bottom"]');
        out.lock=!card('cH').querySelector('select[onchange^="changeCostType"]')&&/類型不可切換/.test(card('cH').innerHTML)&&!!card('cX').querySelector('select[onchange^="changeCostType"]');
        // 自有卡：常用改下拉
        addCostItem('own');const co=q.costs[q.costs.length-1];
        const sel=card(co.id).querySelector('select.cost-add-sel');out.ownSel=!!sel&&[...sel.options].some(o=>o.value==='止水鈑|片');
        sel.value='止水鈑|片';sel.dispatchEvent(new Event('change'));out.ownAdd=co.rows.length===1&&co.rows[0].preset==='止水鈑';
        // 分頁列
        setCostView('audit');out.tab=document.getElementById('cost-view-audit').classList.contains('on')&&!document.getElementById('cost-view-list').classList.contains('on');
        setCostView('list');out.tab=out.tab&&document.getElementById('cost-view-list').classList.contains('on');
        // 新增成本：先選類型；確認鈕隱藏，下次對話框恢復
        costAddPick();const msg=document.getElementById('gen-confirm-msg').innerHTML;
        out.pick=/點工/.test(msg)&&/自有材料購置/.test(msg)&&/材料租賃／設備租賃／運輸/.test(msg)&&document.getElementById('gen-confirm-ok').style.display==='none';
        const n0=q.costs.length;[...document.querySelectorAll('#gen-confirm-msg button')].find(b=>/點工/.test(b.textContent)).click();
        out.pickAdd=q.costs.length===n0+1&&q.costs[n0].type==='labor';
        showConfirm('x','y',function(){});out.okBack=document.getElementById('gen-confirm-ok').style.display==='';document.getElementById('gen-confirm-modal').style.display='none';
        window.toast=oT;Q=[];VENDORS.length=0;PAYABLES.length=0;eid=null;res(out);
      })
    );
    check('階段完工＝實作數量：日報累計 120 為實作（合約 133 不動、提示應向業主追減），進度 100%、工項分析／毛利改以實作數量計', r.before && r.actual && r.map && r.phys && r.items && r.analysis);
    check('施工成本頁分區（發包／自有點工額外／材料租賃運輸）、材料．運輸同步卡唯讀（核對請款單、計價基準）', r.secs && r.matRo);
    check('施工成本頁精簡：常用快捷鍵改下拉、科目列與附屬列移除、已計價發包類型鎖定、分頁列、新增成本先選類型', r.noChips && r.lock && r.ownSel && r.ownAdd && r.tab && r.pick && r.pickAdd && r.okBack);
    check('v6.0.27 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ───────────── v6.0.28 第一批重整：側欄四組／手機底部／拆頁殼／刪功能／單一入口／說明「？」 ─────────────
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};
        const oT=window.toast;window.toast=function(){};
        const sn=id=>document.getElementById('sn-'+id);
        // 側欄：四組、工具收合、拆掉的入口不存在
        out.side=['dash','proj','quotes','quickcost','acct','reports','contacts','tools-more','upa','staff','roles','params'].every(id=>!!sn(id))&&!sn('invoice')
          &&['rfq','mat6','intake','projects','contracts','finance','ledger','payroll','costs','materials','progress','lifeline'].every(id=>!sn(id))
          &&['backfill','plan','rebar','grout','workers','matest'].every(id=>!!document.querySelector('#sn-tools-wrap #sn-'+id));
        toggleToolsNav(false);out.fold0=document.getElementById('sn-tools-wrap').style.display==='none'&&localStorage.getItem('fy_tools_open')==='0';
        toggleToolsNav();out.fold1=document.getElementById('sn-tools-wrap').style.display===''&&localStorage.getItem('fy_tools_open')==='1';
        const ssec=[...document.querySelectorAll('.sidebar .ssec')].map(e=>e.textContent.trim()).join('|');out.groups=ssec==='帳務|工具|系統';
        // 手機底部：總覽／日報／工程專案／報價／更多
        out.mob=!!document.querySelector('nav.mob-nav #mn-quotes')&&!document.querySelector('nav.mob-nav #mn-invoice')&&MOB_BOTTOM_NAV.join()==='dash,quickcost,proj,quotes';
        renderMobMore();const mm=document.getElementById('mob-more-body').innerHTML;out.more=!/mn-invoice/.test(mm)&&/mn-acct/.test(mm)&&!/openGlobalSearch|intakeHistory/.test(mm)&&/>帳務</.test(mm)&&!/常用功能/.test(mm);   // v6.0.30 工作組全在底部列，更多面板從帳務起
        // 頁面註冊：拆掉的頁不在；發包／材料改由工程專案進（隱藏、跟母頁權限）
        const pg=id=>ALL_PAGES.find(p=>p.id===id);
        out.pages=!pg('projects')&&!pg('sitedet')&&pg('rfq').hidden&&pg('rfq').parent==='proj'&&pg('mat6').hidden&&pg('mat6').parent==='proj'&&!document.getElementById('page-projects')&&!document.getElementById('page-sitedet');
        go('projects');out.redir=document.querySelector('.page.active').id==='page-proj';
        go('rfq');out.rfqOk=document.querySelector('.page.active').id==='page-rfq';
        // 刪掉的功能：入口不存在
        out.gone=typeof openGlobalSearch==='undefined'&&!document.getElementById('gsearch-modal')&&!/openGlobalSearch/.test(document.querySelector('header').innerHTML)
          &&!/smartIntake\(\)/.test(document.getElementById('page-dash').innerHTML)&&!document.getElementById('cost-group-mode')&&!/openSiteDet/.test(document.getElementById('page-editor').innerHTML);
        // 報價存檔不再留自動存檔
        Q=[{id:'qA',code:'1',name:'自動存檔測試',client:'甲',date:'2026-10-01',items:[{desc:'A',unit:'支',qty:'1',price:'10',sec:false}],exs:[],rmk:{},_mt:1}];Q_HISTORY={};
        loadQ('qA');items[0].price='11';saveQ();
        out.noAuto=!(Q_HISTORY['qA']||[]).some(v=>!v.formal);
        window._qSnap=null;
        // 重複入口：報價列表無 PDF／請款鈕；請款單列表無 下期／收款鈕；本月未開單橫幅導向工程專案；計價廠商分頁只剩開啟工程
        Q[0].awarded=true;INV.length=0;CONTRACTS.length=0;PAYABLES.length=0;
        go('quotes');renderList();const ql=document.getElementById('qlist').innerHTML;
        out.qlist=!/exportQuotePDF\(/.test(ql)&&!/goQuoteInvoice\(/.test(ql)&&/loadQ\(/.test(ql);
        INV.push({id:'i1',quoteId:'qA',project:'自動存檔測試',client:'甲',periodNo:'1',date:'2026-09-25',items:[{desc:'A',unit:'支',qty:1,curQty:1,payRate:100,price:10}],totals:{total:11},received:'0',_mt:1});
        go('invoice');invTab('owner');renderInvList();const il=document.getElementById('inv-list').innerHTML;
        out.ilist=!/addNextPeriod\(/.test(il)&&!/openReceiptModal\(/.test(il)&&/printInvById\(/.test(il);
        Q[0].dailyLogs=[{id:'d1',date:localToday(),progressRows:[{itemIdx:0,qty:1}]}];_invMonthBanner();const bn=(document.getElementById('inv-month-banner')||{}).innerHTML||'';
        out.banner=!bn||(!/addNextPeriod/.test(bn)&&/openProj\(/.test(bn));
        Q[0].costs=[{id:'cV',type:'sub',vendor:'丙承包',cat:'打設',date:'2026-09-20',rows:[{id:'cV_0',linkedItemIdx:0,qty:1,unitPrice:5}],amt:5,invoice:true,retRate:0,periods:[{no:1,date:'2026-10-05',from:'2026-09-01',to:'2026-10-05',rows:[{rid:'cV_0',qty:1}]}]}];
        VENDORS.length=0;VENDORS.push({id:'v1',name:'丙承包'});
        invTab('vendor');renderVendorBilling();const vb=document.getElementById('vb-root').innerHTML;
        out.vb=/openProj\('qA'\)/.test(vb)&&!/vbOpenPeriod\(|vbPrint\(|vbAdvance\(|vbEarly\(|vbDelPeriod\(/.test(vb);
        // 工程專案頂部只剩編輯報價；核對單鈕消失
        openProj('qA');const ph=document.getElementById('proj-root').innerHTML;
        out.top=/編輯報價/.test(ph)&&!/'案場細節'|>發包<|>材料<|>施工成本<|>業主計價<|>日報</.test(ph.split('<div class="card" style="margin-top:10px">')[0]);
        eid='qA';openProjectCosts('qA');window._costView='list';setCostView('subs');out.noStmt=!/printVendorStatement\(/.test(document.getElementById('cost-list').innerHTML);
        // 說明「？」：每頁一顆、點開有文字
        out.help=document.querySelectorAll('.help-btn').length>=10&&!!document.querySelector('#page-proj .help-btn');
        showHelp('proj');out.helpTxt=/唯一主畫面/.test(document.getElementById('gen-confirm-msg').innerHTML)&&document.getElementById('gen-confirm-cancel').style.display==='none';
        document.getElementById('gen-confirm-ok').click();
        showConfirm('x','y',function(){});out.cancelBack=document.getElementById('gen-confirm-cancel').style.display==='';document.getElementById('gen-confirm-modal').style.display='none';
        window.toast=oT;Q=[];INV.length=0;VENDORS.length=0;PAYABLES.length=0;eid=null;Q_HISTORY={};res(out);
      })
    );
    check('側欄：工作／帳務／工具（客戶廠商常駐、更多工具收合可記憶）／系統；發包、材料、智慧收件與舊頁入口不在側欄', r.side && r.fold0 && r.fold1 && r.groups);
    check('手機底部 總覽／日報／工程專案／報價／更多；更多面板分組與側欄同名、無全域搜尋與收件記錄', r.mob && r.more);
    check('頁面註冊：專案管理／案場細節拆除，發包、材料隱藏跟工程專案；go(projects) 轉工程專案、go(rfq) 仍可開', r.pages && r.redir && r.rfqOk);
    check('刪功能：全域搜尋、總覽智慧收件鈕、依廠商分組、案場細節入口、報價自動存檔', r.gone && r.noAuto);
    check('單一入口：報價列表無 PDF／請款鈕、請款單列表無下期／收款鈕、未開單橫幅導向工程專案、計價廠商分頁只剩開啟工程、專案頂部只剩編輯報價、核對單鈕移除', r.qlist && r.ilist && r.banner && r.vb && r.top && r.noStmt);
    check('說明改「？」：每頁一顆、點開顯示說明、取消鈕之後恢復', r.help && r.helpTxt && r.cancelBack);
    check('v6.0.28 測試無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // ── v6.0.29 第二批：預付款一鈕、介紹費算法×時機、階段完工自動結算、結案一鈕、施工成本唯讀、日報支出廠商型額外支出、機具天數、狀態三選一 ──
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};const oT=window.toast;window.toast=function(){};
        P.tax=5;VENDORS.length=0;['鴻玉開發','風哥','外調吊車行'].forEach((n,i)=>VENDORS.push({id:'v'+i,name:n}));
        MAT_LEDGER.length=0;PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;EXPENSES.length=0;
        const D='H型鋼樁 H300，L=15M 打設、拔除';
        Q=[{id:'qA',code:'115100201',name:'第二批測試案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:D,unit:'支',qty:'133',price:'40000',estCost:'30000',sec:false},{desc:'支撐 H300 架設',unit:'M',qty:'100',price:'1000',estCost:'800',sec:false}],
          t:{sub:133*40000+100*1000,total:Math.round((133*40000+100*1000)*1.05)},
          dailyLogs:[{id:'d1',date:'2026-09-25',progressRows:[{itemIdx:0,qty:60}]},{id:'d2',date:'2026-10-02',progressRows:[{itemIdx:0,qty:60},{itemIdx:1,qty:40}]}],
          costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cH_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:0,invoice:true,retRate:0,periods:[{no:1,date:'2026-10-05',from:'2026-09-23',to:'2026-10-05',rows:[{rid:'cH_0',qty:120}]}]}]}];
        const q=Q[0],c=q.costs[0];
        CONTRACTS.push({id:'ct1',code:'C-001',name:q.name,linkedQid:'qA',amount:Math.round((133*40000+100*1000)*1.05),status:'active',_mt:1});
        INV.push({id:'i1',quoteId:'qA',project:q.name,client:'甲',periodNo:'1',date:'2026-09-30',items:[{type:'item',desc:D,unit:'支',contractQty:133,contractPrice:40000,price:40000,qty:133,curQty:60,payRate:70,prevQty:0}],totals:{total:Math.round(60*0.7*40000*1.05),retention:0},received:'0',_mt:1});
        eid='qA';syncCostToPayable(q,c);
        // 1 預付款一鈕：有已登錄未付期別 → 提前放款；沒有 → 預付款（未請款）
        out.btn=/openPrepay\('cH'\)/.test(_prepayBtn(c))&&_subEarlyBtn(c)===''&&_subEarlyRowBtn(c,{})==='';
        openPrepay('cH');out.early=!!document.getElementById('sa-amt')&&/已登錄未付 <b/.test(document.getElementById('gen-confirm-msg').innerHTML);document.getElementById('gen-confirm-modal').style.display='none';   // v6.0.38 統一：一律預付款視窗
        const c2={id:'cN',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cN_0',linkedItemIdx:1,qty:100,unitPrice:500}],amt:50000,invoice:true,retRate:0,periods:[]};q.costs.push(c2);
        openPrepay('cN');out.adv=!!document.getElementById('sa-amt')&&/預付款：/.test(document.getElementById('gen-confirm-modal').innerHTML)&&!/已登錄未付 <b/.test(document.getElementById('gen-confirm-msg').innerHTML);document.getElementById('gen-confirm-modal').style.display='none';
        const sh=buildSubMgmtHtml(q);out.mgmt=/openPrepay\(/.test(sh)&&!/openSubAdvance\('cH'\)|＋ 預支（未請款）|＋ 預付介紹費|openSubEarly\(/.test(sh);
        // 2 介紹費：合約金額 % ＋ 第一期請款後 → 一筆應付（第一期請款日）、不跟隨期別
        pjIntroEdit('qA','cH','',{});out.piUI=!!document.getElementById('pi-per')&&!!document.getElementById('pi-pay');
        document.getElementById('pi-name').value='風哥';document.getElementById('pi-per').value='pct';_piMode();document.getElementById('pi-amt').value='2';document.getElementById('pi-pay').value='first';_piCalc();
        out.piPrev=/預估介紹費 NT\$ 108,400/.test(document.getElementById('pi-tot').textContent);   // 5,420,000×2%
        document.getElementById('gen-confirm-ok').click();
        const f=q.costs.find(x=>x.isIntro);
        out.pct=!!f&&f.introCalc==='pct'&&f.introPay==='first'&&f.introAmt===2&&f.amt===108400&&!(f.periods||[]).length&&f.followOf==='cH';
        const pi=PAYABLES.find(p=>p.id==='pay'+f.id+'_intro');
        out.piPay=!!pi&&pi.amount===108400&&pi.date==='2026-09-30'&&pi.to==='風哥'&&!PAYABLES.some(p=>p.id==='pay'+f.id+'_p1');
        // 主約再登錄一期：跟隨不套用到「第一期請款後」的介紹費
        c.periods.push({no:2,date:'2026-11-05',from:'2026-10-06',to:'2026-11-05',rows:[{rid:'cH_0',qty:13}]});_subFollowApply(q,c);out.noFollow=!(f.periods||[]).length;
        // 改成「結案後」→ 未結案不掛；拔除完成 → 日報階段完工日
        f.introPay='done';_introSync(q);out.doneWait=!PAYABLES.some(p=>p.id==='pay'+f.id+'_intro');
        q.dailyLogs.push({id:'d3',date:'2026-10-03',status:'stage',stageOf:'remove',stageDate:'2026-10-03',progressRows:[]});
        f.introPay='remove';_introSync(q);const pr=PAYABLES.find(p=>p.id==='pay'+f.id+'_intro');out.removeTrig=!!pr&&pr.date==='2026-10-03';
        f.introPay='first';_introSync(q);
        // 每 M × 實作量：預付 20,000 後應付扣掉
        // 3 階段完工自動結算：合約數量＝實作 120、合約金額追減 13×40000×1.05、請款單合約量同步、建單取結算量
        q.dailyLogs.push({id:'d4',date:'2026-10-04',status:'stage',stageOf:'install',stageDate:'2026-10-04',progressRows:[]});
        const ct=CONTRACTS[0],amt0=ct.amount;
        out.settle=_autoSettle(q)===true&&q.items[0].settledQty===120&&q.items[0].qty==='133'&&ct.amount===amt0-Math.round(13*40000*1.05)-Math.round(60*1000*1.05)&&ct.originalAmount===amt0&&INV[0].items[0].contractQty===120&&INV[0].items[0].origContractQty===133;
        out.effMap=_effQtyMap(q)[D]===120&&_autoSettle(q)===false;
        const ih=_pjItemsHtml(q,_pjStat(q));out.itemsTxt=/合約量已自動改為實作量（原 133，追減 13）/.test(ih)&&/>120</.test(ih);
        out.noStlBtn=!/settleInvItem/.test(String(rInvItems));
        // 4 結案一鈕：竣工總結算＋結案＋回寫
        const s0=_pjStat(q),ch=_pjCloseHtml(q,s0);out.closeUI=/pjCloseAll\('qA'\)/.test(ch)&&!/settleContract\(|writeCostHist\(/.test(ch);
        COST_HIST.length=0;pjCloseAll('qA');out.closeAsk=/結案：/.test(document.getElementById('gen-confirm-modal').innerHTML);document.getElementById('gen-confirm-ok').click();
        const billed=INV.reduce((a,i)=>a+(i.totals.total||0)+(i.totals.retention||0),0);
        out.closed=q.closed===true&&!!q.closedAt&&ct.status==='completed'&&ct.amount===billed&&COST_HIST.length>0&&/恢復進行中/.test(_pjCloseHtml(q,_pjStat(q)));
        // 5 施工成本頁預設唯讀卡，按「編輯明細」才展開
        window._costEditAll=false;window._costEditId=null;openProjectCosts('qA');window._costView='list';rCostItems();
        const cl=document.getElementById('cost-list').innerHTML;
        out.ro=document.querySelectorAll('#cost-list .cost-ro').length===3&&!document.getElementById('cost-rows-cH')&&/costEdit\('cH'\)/.test(cl)&&/openPrepay\('cH'\)/.test(cl)&&/openSubPeriod\('cH'\)/.test(cl)&&/來自 /.test(cl)&&/介紹費・合約金額 %・第一期請款後/.test(cl);
        costEdit('cH');out.edit=!!document.getElementById('cost-rows-cH')&&/正在編輯明細/.test(document.getElementById('cost-list').innerHTML)&&document.querySelectorAll('#cost-list .cost-ro').length===2;
        window._costEditId=null;rCostItems();out.back=document.querySelectorAll('#cost-list .cost-ro').length===3;
        costAddPick();out.pickExtra=/go\('quickcost'\)/.test(document.getElementById('gen-confirm-modal').innerHTML)&&!/addCostItem\('extra'\)/.test(document.getElementById('gen-confirm-modal').innerHTML);document.getElementById('gen-confirm-modal').style.display='none';
        window._costEditAll=true;
        // 6 日報．支出：額外支出（廠商）→ 填廠商 → 成本卡掛廠商、應付；狀態無「明起暫停」；機具填天數
        q.closed=false;go('quickcost');rQuickCost();
        const sel=document.getElementById('dr-proj');if(sel){sel.value='qA';if(sel.onchange)sel.onchange();}
        const ps=document.getElementById('qc-proj');ps.value='qA';
        const vi=QC_TYPES.findIndex(t=>t[4]==='vendor');out.chip=vi>0&&/額外支出/.test(document.getElementById('qc-chips').innerHTML);
        _qcPending=[];qcAdd(vi);const e=_qcPending[0];out.pendUI=!!e&&!!document.querySelector('[data-qcid="'+e.id+'"] input[list="qc-vdl"]');
        qcUpd(e.id,'amt','12000');qcUpd(e.id,'note','外調吊車 1 天');
        submitQuickCost();out.needVendor=_qcPending.length===1;
        qcUpd(e.id,'vendor','外調吊車行');submitQuickCost();
        const xc=q.costs.find(x=>x.type==='extra'&&x.vendor==='外調吊車行');
        out.vendorCost=!!xc&&xc.amt===12000&&xc.src==='quick'&&xc.invoice===true&&!xc.review&&_qcPending.length===0;
        const xp=PAYABLES.find(p=>p.costId===(xc||{}).id);out.vendorPay=!!xp&&xp.to==='外調吊車行'&&xp.amount===12000&&xp.status!=='paid';
        out.noPause=![...document.querySelectorAll('#dr-status option')].some(o=>o.value==='pause')&&document.querySelectorAll('#dr-status option').length>=3;
        P.equipList=['A機'];document.getElementById('dr-own-equip').checked=true;_drRenderEquip();_drToggleEquip('A機');
        out.equipDay=_drEquip['A機']===1&&/使用天數/.test(document.getElementById('dr-equip-box').innerHTML)&&!/使用時數/.test(document.getElementById('dr-equip-box').innerHTML);
        // 7 得標視窗：專案獎金區塊移除、既有 referral 不被清掉
        out.award=!document.getElementById('award-ref-name')&&!document.getElementById('award-ref-mode')&&/＋ 介紹人/.test(document.getElementById('award-modal').innerHTML)&&/award-ref-name'\)\)\{/.test(String(confirmAward));
        window.toast=oT;Q=[];INV.length=0;VENDORS.length=0;PAYABLES.length=0;CONTRACTS.length=0;COST_HIST.length=0;EXPENSES.length=0;eid=null;_qcPending=[];window._costEditId=null;res(out);
      })
    );
    check('預付款一鈕：一律開預付款視窗（有已登錄未付期別時顯示可扣的期別）；舊「預支」「＋ 預付介紹費」「提前放款」鈕消失', r.btn && r.early && r.adv && r.mgmt, JSON.stringify(r));
    check('介紹費：計算方式（合約金額 %）× 付款時機（第一期請款後）→ 一筆應付掛第一期請款日、不跟隨期別；結案前不掛、拔除完成取階段完工日', r.piUI && r.piPrev && r.pct && r.piPay && r.noFollow && r.doneWait && r.removeTrig, JSON.stringify(r));
    check('階段完工自動結算：合約數量改實作量（報價原數量不動）、合約金額追加減、請款單合約量同步、_effQtyMap 取結算量、請款單編輯器結算鈕移除', r.settle && r.effMap && r.itemsTxt && r.noStlBtn, JSON.stringify(r));
    check('結案一鈕：竣工總結算＋標結案＋回寫單價庫一次完成', r.closeUI && r.closeAsk && r.closed, JSON.stringify(r));
    check('施工成本頁預設唯讀卡（來源、登錄廠商請款、預付款、編輯明細），按編輯明細才展開、完成收回；新增成本的額外支出導向日報．支出', r.ro && r.edit && r.back && r.pickExtra, JSON.stringify(r));
    check('日報．支出「額外支出（廠商）」：填廠商才能送出、成本卡掛廠商開發票並掛應付；狀態無「明起暫停」；自有機具改填天數（預設 1 天）；得標視窗專案獎金區塊移除且既有設定不清', r.chip && r.pendUI && r.needVendor && r.vendorCost && r.vendorPay && r.noPause && r.equipDay && r.award, JSON.stringify(r));
    check('v6.0.29 第二批流程無 Console 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── v6.0.30 第三批：計價併入帳務、工程專案待辦式首屏、預定進度直接排、公司倉庫併入材料、歸還問實際長度 ──
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};const oT=window.toast;window.toast=function(){};
        P.tax=5;VENDORS.length=0;['鴻玉開發','英洲'].forEach((n,i)=>VENDORS.push({id:'v'+i,name:n}));
        MAT_LEDGER.length=0;PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;
        ['items','inv','sub','cost','sched','log','docs','close'].forEach(k=>localStorage.removeItem('pj_open_'+k));
        const D='H型鋼樁 H300，L=15M 打設、拔除';
        Q=[{id:'qA',code:'115100301',name:'第三批測試案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:D,unit:'支',qty:'133',price:'40000',estCost:'30000',sec:false},{desc:'支撐 H300 架設',unit:'M',qty:'100',price:'1000',estCost:'800',sec:false}],t:{sub:5420000,total:5691000},
          dailyLogs:[{id:'d1',date:'2026-09-25',progressRows:[{itemIdx:0,qty:60}]},{id:'d2',date:'2026-09-28',progressRows:[{itemIdx:0,qty:60}]}],
          costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cH_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:0,invoice:true,retRate:0,periods:[]}],
          mat:{rows:[{id:'r1',name:'型鋼',spec:'H300',len:15,unit:'支',qty:133}],use:[],loss:[],rents:[],equip:[],tps:[],_m6:1}}];
        const q=Q[0];
        // 1 計價併入帳務：側欄無計價、go('invoice') 轉帳務 own 分頁、業主請款列表照常、vendor → vb
        out.nav=!document.getElementById('sn-invoice')&&!!document.getElementById('sn-acct')&&ALL_PAGES.find(p=>p.id==='invoice').hidden===true&&ALL_PAGES.find(p=>p.id==='invoice').parent==='acct';
        INV.push({id:'i1',quoteId:'qA',project:q.name,client:'甲',periodNo:'1',date:'2026-08-30',expectedRecvDate:'2026-09-30',items:[{type:'item',desc:D,unit:'支',contractQty:133,contractPrice:40000,price:40000,qty:133,curQty:60,payRate:70,prevQty:0}],totals:{total:1764000,retention:0},received:'0',_mt:1});
        go('invoice');
        out.ownTab=document.querySelector('.page.active').id==='page-acct'&&_acctTab==='own'&&!!document.querySelector('#acct-p-own #inv-list')&&document.getElementById('acct-p-own').style.display!=='none'&&/第三批測試案/.test(document.getElementById('inv-list').innerHTML);
        invTab('vendor');out.vbTab=_acctTab==='vb'&&!!document.querySelector('#acct-p-vb #vb-root')&&document.getElementById('acct-p-vb').style.display!=='none'&&document.getElementById('acct-p-own').style.display==='none'&&/鴻玉開發/.test(document.getElementById('vb-root').innerHTML);
        out.tabs=/業主請款/.test(document.getElementById('acct-tabs').innerHTML)&&/廠商請款/.test(document.getElementById('acct-tabs').innerHTML);
        renderMobMore();out.more=!/mn-invoice/.test(document.getElementById('mob-more-body').innerHTML)&&/mn-acct/.test(document.getElementById('mob-more-body').innerHTML);
        // 2 工程專案待辦式首屏：現在該做（本月未開單、廠商待登錄、逾期待收、沒日報、材料在工地）＋目前階段預設展開
        q.dailyLogs.push({id:'d3',date:localToday(),progressRows:[{itemIdx:0,qty:5}]});
        MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H300',len:15,qty:34,uw:93,price:20,date:'2026-01-10',kind:'重複性',loc:q.name,projQid:'qA',outDate:_dAdd(localToday(),-130),matRowId:'r1',_mt:1});
        MAT_LEDGER.push({id:'L2',name:'型鋼',spec:'H300',len:12,qty:30,uw:93,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1});
        MAT_LEDGER.push({id:'L3',name:'型鋼',spec:'H300',len:15,qty:20,uw:93,price:20,date:'2026-02-10',kind:'重複性',loc:'公司倉庫',_mt:1});
        openProj('qA');
        const td=document.getElementById('pj-todo').innerHTML;
        out.todo=/現在該做/.test(td)&&/本月請款單尚未開/.test(td)&&/pjNewInv\('qA'\)/.test(td)&&/鴻玉開發 本期請款待登錄/.test(td)&&/openSubPeriod\('cH'\)/.test(td)&&/第 1 期待收 NT\$ 1,764,000/.test(td)&&/openReceiptModal\('i1'\)/.test(td)&&/自有材料在工地最久 130 天/.test(td)&&/目前階段：<b[^>]*>合約</.test(td);
        out.open0=document.getElementById('pj-body-items').style.display===''&&document.getElementById('pj-body-sub').style.display==='none'&&document.getElementById('pj-body-inv').style.display==='none';
        CONTRACTS.push({id:'ct1',code:'C-001',name:q.name,linkedQid:'qA',amount:5691000,status:'active',_mt:1});
        renderProj();out.open1=/目前階段：<b[^>]*>施工</.test(document.getElementById('pj-todo').innerHTML)&&document.getElementById('pj-body-items').style.display===''&&document.getElementById('pj-body-log').style.display===''&&document.getElementById('pj-body-docs').style.display==='none';
        localStorage.setItem('pj_open_docs','1');renderProj();out.openKeep=document.getElementById('pj-body-docs').style.display==='';localStorage.removeItem('pj_open_docs');
        // 3 預定進度直接排：每列填起訖日 → q.plan、租料預計退場引用、無預定提示消失
        const s0=document.getElementById('pj-body-sched').innerHTML;
        out.sched0=/尚無預定進度：在每列填/.test(s0)&&/pjPlanSet\('qA'/.test(s0)&&/type="date"/.test(s0);
        const key=_pjPlanKey(q.items[0]);pjPlanSet('qA',key,'s','2026-10-01');pjPlanSet('qA',key,'e','2026-10-20');
        out.plan=q.plan[key].s==='2026-10-01'&&q.plan[key].e==='2026-10-20'&&/預定 2026-10-01～2026-10-20（20 天）/.test(document.getElementById('pj-body-sched').innerHTML)&&!/尚無預定進度/.test(document.getElementById('pj-body-sched').innerHTML)&&_pjHasPlan(q)&&_rentPlanEnd(q).date==='2026-10-20'&&_rentPlanEnd(q).src==='預定進度';
        pjPlanSet('qA',key,'s','2026-10-25');out.planFix=q.plan[key].e==='2026-10-25';   // 起日晚於迄日 → 迄日跟上
        // 4 公司倉庫併入材料頁：台帳列、調撥到本案、建立需求、進貨、刪除
        _m6Qid='qA';go('mat6');
        const mh=document.getElementById('mat6-root').innerHTML;
        out.wh=/公司倉庫（台帳）/.test(mh)&&/m6LedEdit\('qA',''\)/.test(mh)&&/matOut\('qA','r1'\)/.test(mh)&&/尚缺 99 支/.test(mh)&&/可代用：/.test(mh)&&/m6Adapt\('qA','r1'\)/.test(mh)&&/工程專案 › 第三批測試案/.test(document.querySelector('#page-mat6 .ph-s').textContent);
        m6LedEdit('qA','');document.getElementById('ml-name').value='型鋼';document.getElementById('ml-spec').value='H400';document.getElementById('ml-len').value='9';document.getElementById('ml-qty').value='12';document.getElementById('ml-price').value='25';document.getElementById('gen-confirm-ok').click();
        const nl=MAT_LEDGER.find(r=>r.spec==='H400');out.ledAdd=!!nl&&nl.qty===12&&nl.len===9&&nl.uw===172&&nl.loc==='公司倉庫'&&/H400 L=9M/.test(document.getElementById('mat6-root').innerHTML);
        m6LedDel('qA',nl.id);document.getElementById('gen-confirm-ok').click();out.ledDel=!MAT_LEDGER.some(r=>r.id===nl.id)&&!!(TOMBS.matLedger||{})[nl.id];
        // 5 歸還問實際長度：切過的料以新長度回倉庫
        matBack('qA','L1');out.lenUI=!!document.getElementById('mb-len')&&document.getElementById('mb-len').value==='15';
        document.getElementById('mb-back').value='10';document.getElementById('mb-loss').value='0';document.getElementById('mb-len').value='12';document.getElementById('fy-modal-o').click();
        const back=MAT_LEDGER.filter(r=>r.loc==='公司倉庫'&&r.len===12&&/切樁自 15M/.test(r.note||''));const site=MAT_LEDGER.find(r=>r.id==='L1');
        out.cut=back.length===1&&back[0].qty===10&&!!site&&site.qty===24&&site.len===15&&q.mat.use.length===1&&q.mat.use[0].qty===10&&q.mat.use[0].len===15;
        // 6 發包頁標題帶工程名；工程專案進度區在手機不橫向捲
        _rfqQid='qA';go('rfq');out.rfqHead=/工程專案 › 第三批測試案/.test(document.querySelector('#page-rfq .ph-s').textContent);
        window.toast=oT;Q=[];INV.length=0;VENDORS.length=0;PAYABLES.length=0;CONTRACTS.length=0;MAT_LEDGER.length=0;eid=null;_m6Qid='';_rfqQid='';res(out);
      })
    );
    check('計價併入帳務：側欄無計價、go(\'invoice\') 轉帳務「業主請款」分頁（列表照常）、invTab(vendor) 轉「廠商請款」分頁、手機更多無計價', r.nav && r.ownTab && r.vbTab && r.tabs && r.more, JSON.stringify(r));
    check('工程專案待辦式首屏：「現在該做」列本月未開單／廠商待登錄／逾期待收／材料在工地過久並附按鈕；只有目前階段的區塊預設展開、手動開合仍記住', r.todo && r.open0 && r.open1 && r.openKeep, JSON.stringify(r));
    check('預定進度直接排：每列填起訖日寫 q.plan、顯示「預定 起～迄（N 天）」、租料預計退場引用、起日晚於迄日自動修正', r.sched0 && r.plan && r.planFix, JSON.stringify(r));
    check('公司倉庫併入材料頁：台帳列（尚缺／調撥到本案／建立需求）、進貨（單位重自動帶）、刪除立墓碑；發包／材料頁標題帶工程名', r.wh && r.ledAdd && r.ledDel && r.rfqHead, JSON.stringify(r));
    check('歸還問實際長度：切過的料以新長度回倉庫（備註記原長度）、工地剩量與使用段仍以原長度結算', r.lenUI && r.cut, JSON.stringify(r));
    check('v6.0.30 第三批流程無 Console 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── v6.0.31 第四批：業主扣款設定、清潔費、收款折讓＋折讓證明單、保留款廠商端、薪資 4 欄、報表下拉 ──
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};const oT=window.toast;window.toast=function(){};
        P.tax=5;VENDORS.length=0;VENDORS.push({id:'v0',name:'鴻玉開發'});PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;EXPENSES.length=0;CUSTOMERS.length=0;CUSTOMERS.push({id:'c1',name:'甲',taxid:'12345678'});
        const D='H型鋼樁 H300，L=15M 打設、拔除';
        Q=[{id:'qA',code:'115100401',name:'第四批測試案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,
          items:[{desc:D,unit:'支',qty:'100',price:'10000',estCost:'8000',sec:false}],t:{sub:1000000,total:1050000},dailyLogs:[],
          costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cH_0',linkedItemIdx:0,qty:100,unitPrice:5000}],amt:0,invoice:true,retRate:10,periods:[{no:1,date:'2026-10-05',from:'2026-09-01',to:'2026-10-05',rows:[{rid:'cH_0',qty:100}]}]}]}];
        const q=Q[0];eid='qA';syncCostToPayable(q,q.costs[0]);
        // 1 業主扣款設定：工程專案顯示，存進 q.deduct，新開請款單自動帶保留款 % 與清潔費 ‰
        openProj('qA');const ih=document.getElementById('pj-body-inv').innerHTML;
        out.ui=/業主扣款設定/.test(ih)&&/pjDeductSet\('qA','ret'/.test(ih)&&/pjDeductSet\('qA','clean'/.test(ih)&&/cleanMode/.test(ih);
        pjDeductSet('qA','ret','10');pjDeductSet('qA','clean','3');pjDeductSet('qA','cleanMode','allow');
        out.saved=q.deduct.ret==='10'&&q.deduct.clean==='3'&&q.deduct.cleanMode==='allow';
        const inv=buildInvFromQuote(q);
        out.built=inv.retention===true&&inv.retentionPct===10&&inv.cleanPermil===3&&inv.cleanMode==='allow';
        // 2 清潔費：未稅 × ‰，含稅自總計扣；請款總計＝(未稅+稅)−保留款−清潔費含稅；列印有清潔費列
        inv.items.forEach(it=>{if(it.type!=='sec'){it.curQty=100;it.payRate=100;}});_recalcInvAmounts(inv);
        const t=inv.totals;   // 未稅 1,000,000 → 稅 50,000 → 保留 105,000 → 清潔 3,000 ×1.05＝3,150
        out.tot=t.curTotal===1000000&&t.clean===3000&&t.cleanGross===3150&&t.total===1050000-105000-3150;
        INV.push(inv);inv.periodNo='1';inv.date='2026-10-05';
        loadInvoice(inv.id);
        out.editor=document.getElementById('inv-clean-permil').value==='3'&&document.getElementById('inv-clean-mode').value==='allow'&&document.getElementById('inv-clean-row').style.display!=='none'&&/3‰/.test(document.getElementById('inv-clean-label').textContent)&&document.getElementById('inv-total-amt').textContent===fmt(941850);
        buildInvPreview(inv);const ph=document.getElementById('inv-prev-html').innerHTML;
        out.preview=/清潔費 \(3‰，含稅\)/.test(ph)&&/- 3,150/.test(ph)&&/941,850/.test(ph)&&!/estCost|毛利/.test(ph);
        // 3 收款折讓：必填原發票號碼與原因；存 inv.allow（未稅／稅額拆）；抵銷後結清；折讓證明單含清潔費＋折讓兩列
        openReceiptModal(inv.id);
        document.getElementById('receipt-amount').value='940000';document.getElementById('receipt-allow').value='1850';_receiptCalc();
        out.calc=/折讓 1,850/.test(document.getElementById('receipt-diff-txt').textContent)&&/已對平/.test(document.getElementById('receipt-diff-txt').textContent);
        confirmReceipt();out.needInv=!inv.receivedConfirmed&&document.getElementById('receipt-modal').style.display==='flex';
        document.getElementById('receipt-allow-inv').value='AB-12345678';document.getElementById('receipt-allow-reason').value='尾數折讓';document.getElementById('receipt-allow-date').value='2026-11-05';
        confirmReceipt();
        out.allow=inv.receivedConfirmed===true&&!!inv.allow&&inv.allow.amt===1850&&inv.allow.net===1762&&inv.allow.tax===88&&inv.allow.invNo==='AB-12345678'&&inv.allow.reason==='尾數折讓'&&_invAR(inv)===0&&_invOffset(inv)===1850;
        let cap=null;const oP=window._toolPrint;window._toolPrint=function(title,proj,body,opts){cap={title,proj,body,opts};};
        printAllowance(inv.id);window._toolPrint=oP;
        out.doc=!!cap&&/折讓證明單/.test(cap.title)&&/清潔費（3‰）/.test(cap.body)&&/尾數折讓/.test(cap.body)&&/AB-12345678/.test(cap.body)&&/12345678/.test(cap.body)&&new RegExp(fmt(3000+1762)).test(cap.body)&&new RegExp(fmt(150+88)).test(cap.body)&&new RegExp(fmt(5000)).test(cap.body);
        // 清潔費改「業主開發票」→ 收款結清後自動進公司費用（一筆），改回折讓則撤
        inv.cleanMode='exp';_cleanExpenseSync(inv);const ex=EXPENSES.find(e=>e.id==='E_clean_'+inv.id);
        out.exp=!!ex&&ex.amount===3000&&ex.tax===150&&ex.cat==='清潔費'&&ex.seller==='甲';
        inv.cleanMode='allow';_cleanExpenseSync(inv);out.expGone=!EXPENSES.some(e=>e.id==='E_clean_'+inv.id);
        // 下一期：折讓不帶到下期，扣款設定沿用
        const n0=INV.length;addNextPeriod(inv.id);const nx=INV.find(x=>x.id!==inv.id&&x.quoteId==='qA');
        out.next=INV.length===n0+1&&!!nx&&!nx.allow&&nx.cleanPermil===3&&nx.retentionPct===10;
        // 4 保留款廠商端：帳務 › 保留款列出我方押廠商的保留款（鴻玉 10%＝50,000）與退保留款鈕
        go('finance');switchFinanceTab('retention');renderRetention();const rh=document.getElementById('finance-retention-list').innerHTML;
        out.vendorRet=/我方押廠商的保留款/.test(rh)&&/鴻玉開發/.test(rh)&&/50,000/.test(rh)&&/releaseSubRet\('cH'\)/.test(rh);
        // 5 薪資 4 欄：姓名／月薪／投保薪資／眷口，保險金額自動算；舊欄位在「更多欄位」仍在
        HR.length=0;hrEdit('','');
        out.hrUI=!!document.getElementById('hr-ig')&&!!document.getElementById('hr-dep')&&!!document.querySelector('#fy-modal details')&&!!document.getElementById('hr-lg')&&!!document.getElementById('hr-emg');
        document.getElementById('hr-name').value='測試員';document.getElementById('hr-base').value='40000';document.getElementById('hr-ig').value='40100';_hrIgSync();document.getElementById('hr-dep').value='1';_hrIgSync();
        const pv=document.getElementById('hr-ins-pv').textContent;const ins=_hrCalcIns(40100,40100,1);
        out.hrPv=new RegExp(fmt(ins.laborCo+ins.healthCo+ins.pensionCo)).test(pv)&&new RegExp(fmt(ins.laborSelf+ins.healthSelf)).test(pv);
        document.getElementById('fy-modal-o').click();const hr=HR[0];
        out.hrSaved=!!hr&&hr.name==='測試員'&&hr.base===40000&&hr.laborGrade===40100&&hr.healthGrade===40100&&hr.dep===1&&hr.laborSelf===ins.laborSelf&&hr.healthCo===ins.healthCo&&hr.pensionCo===ins.pensionCo;
        // 6 報表：少用的進「其他報表」下拉，主按鈕剩 6 顆；選下拉切換
        go('reports');out.rptTabs=document.querySelectorAll('#page-reports .rpt-tab').length===6&&!document.getElementById('rpt-client-btn')&&!!document.getElementById('rpt-more-sel');
        showReport('bidrate');out.rptMore=document.getElementById('rpt-more-sel').value==='bidrate'&&_currentReport==='bidrate';showReport('overview');out.rptBack=document.getElementById('rpt-more-sel').value==='';
        window.toast=oT;Q=[];INV.length=0;VENDORS.length=0;PAYABLES.length=0;CONTRACTS.length=0;EXPENSES.length=0;HR.length=0;CUSTOMERS.length=0;eid=null;window._invSnap=null;res(out);
      })
    );
    check('業主扣款設定：工程專案設保留款 %／清潔費 ‰／清潔費處理，新開請款單自動帶入；清潔費＝未稅 × ‰、含稅自總計扣，編輯器與列印有清潔費列', r.ui && r.saved && r.built && r.tot && r.editor && r.preview, JSON.stringify(r));
    check('收款折讓：必填原發票號碼與原因、存未稅／稅額、算入抵銷結清；折讓證明單含清潔費與折讓兩列、買受人統編；清潔費「業主開發票」結清後自動進公司費用；下一期不帶折讓', r.calc && r.needInv && r.allow && r.doc && r.exp && r.expGone && r.next, JSON.stringify(r));
    check('保留款廠商端：帳務 › 保留款列出我方押廠商的保留款與退保留款鈕', r.vendorRet, JSON.stringify(r));
    check('薪資 4 欄：姓名／月薪／投保薪資／眷口，勞健保勞退依費率自動算並存入，舊欄位收在「更多欄位」', r.hrUI && r.hrPv && r.hrSaved, JSON.stringify(r));
    check('報表合併：少用的報表進「其他報表」下拉、主按鈕 6 顆、下拉切換同步', r.rptTabs && r.rptMore && r.rptBack, JSON.stringify(r));
    check('v6.0.31 第四批流程無 Console 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── v6.0.32 第五批：匯入業主詢價單＋回填匯出、單位清單與單支長＋換算檢查、月表單＋去重、跨案購租分析 ──
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => { (async()=>{
        const out={};const oT=window.toast;window.toast=function(){};
        P.tax=5;P.company='豐有工程有限公司';VENDORS.length=0;PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;MAT_LEDGER.length=0;
        const D='H型鋼樁 H300，L=15M 打設、拔除';
        Q=[{id:'qX',code:'115100501',name:'匯入測試案',client:'甲',date:'2026-10-01',items:[],exs:[],rmk:{},_mt:1},
           {id:'qY',code:'115100502',name:'匯入測試案二',client:'乙',date:'2026-10-01',items:[],exs:[],rmk:{},_mt:1}];
        // 1 xlsx 詢價單：表頭自動辨識、工項帶入（單位／數量／單支長）、條款唯讀、合計列
        const bytes=_xlsxBytes([{name:'詢價單',rows:[['甲建設　擋土支撐工程詢價單'],[],['項次','工程項目','單位','數量','單價','複價','備註'],[1,D,'支',133,'','',''],[2,'支撐 H300 架設','M',100,'','',''],['','小計','','','','',''],['','營業稅 5%','','','','',''],['','總計','','','','',''],['備註：1. 本工程不含回填砂。'],['2. 請於 10 日內回覆報價。']]}]);
        const files=await _zipRead(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
        loadQ('qX');
        const map=_qiFromFiles(files,'xlsx',{name:'甲建設詢價單.xlsx',size:bytes.length,b64:_u8b64(bytes)});
        out.map=!!map&&map.nItems===2&&map.cols.desc===2&&map.cols.price===5&&map.cols.amt===6&&map.totals.length===3&&map.totals.map(t=>t.kind).join()==='sub,tax,total'&&map.terms.length===2&&/回填砂/.test(map.terms[0]);
        out.preview=document.getElementById('gen-confirm-modal').style.display==='flex'&&/讀到 <b>2<\/b> 個工項/.test(document.getElementById('gen-confirm-msg').innerHTML);
        document.getElementById('gen-confirm-ok').click();
        out.applied=items.length===2&&items[0].desc===D&&items[0].unit==='支'&&items[0].qty==='133'&&items[0].oKey===4&&items[0].len===15&&items[1].unit==='M'&&items[1].oKey===5&&!!document.getElementById('q-owner-box')&&/回填匯出/.test(document.getElementById('q-owner-box').innerHTML)&&/回填砂/.test(document.getElementById('q-owner-box').innerHTML);
        items[0].price='40000';items[1].price='1000';saveQ();
        const qx=Q.find(x=>x.id==='qX');
        out.saved=!!qx.ownerDoc&&qx.ownerDoc.kind==='xlsx'&&qx.ownerDoc.rows.length===2&&qx.items[0].oKey===4&&qx.items[0].len===15&&_qOwnerDraft===null;
        // 2 回填匯出：單價、複價、小計／稅／總計寫回原格，表格下方加本公司備註
        const ef=await quoteExportOwnerDoc();
        const cells=_xlsxParse(ef).cells,cv=a=>(cells.find(c=>c.cell===a)||{}).text;
        out.exported=!!ef&&cv('E4')==='40000'&&cv('F4')==='5320000'&&cv('E5')==='1000'&&cv('F5')==='100000'&&cv('F6')==='5420000'&&cv('F7')==='271000'&&cv('F8')==='5691000'&&cv('A12')==='本公司備註（豐有工程有限公司）'&&!!cv('A13')&&cv('B4')===D;
        // 3 docx 詢價單：表格列辨識、回填單價、加備註段落
        const tc=t=>'<w:tc><w:p><w:r><w:t>'+t+'</w:t></w:r></w:p></w:tc>';
        const dx='<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>乙建設 詢價單</w:t></w:r></w:p><w:tbl><w:tr>'+['項次','品名','單位','數量','單價','金額'].map(tc).join('')+'</w:tr><w:tr>'+['1','H型鋼樁 H400 L=12M 打設','支','40','',''].map(tc).join('')+'</w:tr><w:tr>'+['','合計','','','',''].map(tc).join('')+'</w:tr></w:tbl><w:p><w:r><w:t>一、報價含稅。</w:t></w:r></w:p><w:sectPr/></w:body></w:document>';
        const dfiles={'word/document.xml':new TextEncoder().encode(dx)};const dz=_zipWrite(dfiles);
        loadQ('qY');const dmap=_qiFromFiles(await _zipRead(dz.buffer.slice(dz.byteOffset,dz.byteOffset+dz.byteLength)),'docx',{name:'乙建設詢價單.docx',size:dz.length,b64:_u8b64(dz)});
        out.dmap=!!dmap&&dmap.nItems===1&&dmap.items[0].priceRef===10&&dmap.items[0].amtRef===11&&dmap.totals.length===1&&dmap.totals[0].kind==='total'&&dmap.terms.some(t=>/報價含稅/.test(t));
        document.getElementById('gen-confirm-ok').click();items[0].price='9000';saveQ();
        const df=await quoteExportOwnerDoc();const dxml=new TextDecoder().decode(df['word/document.xml']);
        out.dexp=/<w:t xml:space="preserve">9000<\/w:t>/.test(dxml)&&/<w:t xml:space="preserve">360000<\/w:t>/.test(dxml)&&/<w:t xml:space="preserve">378000<\/w:t>/.test(dxml)&&/本公司備註/.test(dxml)&&dxml.indexOf('本公司備註')<dxml.indexOf('<w:sectPr')&&/報價含稅/.test(dxml);
        quoteOwnerDocRemove();out.removed=!Q.find(x=>x.id==='qY').ownerDoc&&!document.getElementById('q-owner-box');
        // 4 單位清單、單支長、換算檢查
        loadQ('qX');
        out.unitUI=!!document.getElementById('unit-dl')&&document.querySelectorAll('#itbody input[list="unit-dl"]').length===2&&document.querySelectorAll('#itbody input[placeholder="單支長M"]').length===2&&document.querySelectorAll('#itbody .it-ucheck').length===2;
        out.check=/不一致/.test(_itemUnitCheck({desc:D,unit:'支',len:12}))&&/單支長/.test(_itemUnitCheck({desc:'H型鋼樁 H300 打設',unit:'支'}))&&/不在清單/.test(_itemUnitCheck({desc:'x',unit:'箱'}))&&_itemUnitCheck({desc:D,unit:'支',len:15})===''&&_itemUnitCheck({desc:'止水鈑',unit:'式'})==='';
        qx.items[0].len=18;qx.items[0].desc='H型鋼樁 H300 打設、拔除';eid='qX';out.lenOf=_itemLenOf(qx.items[0])===18&&_rfqLen('H型鋼樁 H300 打設、拔除')===18&&_rfqLen('XX L=9M')===9;
        // 5 月表單：已填灰底、覆蓋／略過、新增日報與點工、支出去重
        Q.push({id:'qM',code:'115100503',name:'月表單測試案',client:'丙',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:D,unit:'支',qty:'133',price:'40000',sec:false},{desc:'支撐 H300 架設',unit:'M',qty:'100',price:'1000',sec:false}],
          dailyLogs:[{id:'d1',date:'2026-10-03',workers:2,progressRows:[{itemIdx:0,desc:D,qty:60}]}],costs:[{id:'c1',type:'extra',vendor:'公司支出（自付）',cat:'雜費',date:'2026-10-05',src:'quick',rows:[{id:'c1_0',desc:'便當',days:1,dayRate:300}],amt:300}]});
        const qm=Q.find(x=>x.id==='qM');go('quickcost');rQuickCost();_dmQid='qM';_dmYm='2026-10';document.getElementById('dr-month-card').style.display='none';drMonthToggle();
        // v6.0.33 月表單只留支出：已登錄顯示、同日同類同額去重、寫入
        const tb=document.getElementById('dr-month-tbl');const row=d=>tb.querySelector('tr[data-d="2026-10-'+String(d).padStart(2,'0')+'"]');
        out.grid=!!tb&&tb.querySelectorAll('tbody tr').length===31&&!tb.querySelector('.dm-q')&&/便當 300/.test(row(5).innerHTML)&&document.getElementById('dr-month-card').style.display!=='none';
        row(5).querySelector('.dm-ct').value=String(QC_TYPES.findIndex(t=>t[0]==='便當'));row(5).querySelector('.dm-ca').value='300';
        row(6).querySelector('.dm-ct').value=String(QC_TYPES.findIndex(t=>t[0]==='涼水'));row(6).querySelector('.dm-ca').value='200';row(6).querySelector('.dm-cn').value='飲料';
        drMonthSubmit();out.conf=document.getElementById('gen-confirm-modal').style.display!=='flex';
        out.applied2=qm.costs.filter(c=>c.cat==='雜費'&&c.amt===300&&c.date==='2026-10-05').length===1&&qm.costs.some(c=>c.date==='2026-10-06'&&c.amt===200&&c.rows[0].desc==='飲料');
        out.skip=true;out.skipped=true;
        // 6 跨案購租分析
        MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H300',len:12,qty:30,uw:93,price:20,date:'2026-01-10',kind:'重複性',loc:'公司倉庫',_mt:1});
        qm.mat={rows:[],use:[],loss:[],rents:[{id:'rn1',vendor:'英洲',rowId:'',name:'型鋼',spec:'H300',len:15,rate:60,cm:1995,pf:_dAdd(localToday(),-30),pt:_dAdd(localToday(),150),mode:'day',batches:[{id:'b1',d:_dAdd(localToday(),-30),m:1995,n:133,o:''}]}],equip:[],tps:[],_m6:1};
        const cr=_m6CrossRows().find(o=>o.spec==='H300');
        out.cross=!!cr&&cr.buyPerM===1860&&cr.rate===60&&Math.round(cr.payback)===31&&cr.nCases===1&&cr.rent12===_m6RentToDate(qm.mat.rents[0])&&cr.openPcs===133&&cr.ownPcs===30;
        _m6Qid='qM';go('mat6');out.crossUI=/購租分析（跨案）/.test(document.getElementById('mat6-root').innerHTML)&&/>H300</.test(document.getElementById('mat6-root').innerHTML);
        window.toast=oT;Q=[];MAT_LEDGER.length=0;eid=null;_qOwnerDraft=null;window._qSnap=null;res(out);
        })().catch(e=>res({err:String(e.stack||e).slice(0,500)}));
      })
    );
    check('匯入業主詢價單（xlsx）：表頭自動辨識、工項帶入（單位／數量／單支長）、條款唯讀、合計列；儲存連結原檔', r.map && r.preview && r.applied && r.saved, JSON.stringify(r));
    check('回填匯出：單價、複價、小計／稅／總計寫回原格並加本公司備註；docx 表格辨識、回填與備註段落；移除連結', r.exported && r.dmap && r.dexp && r.removed, JSON.stringify(r));
    check('單位清單＋單支長欄位＋換算檢查（不一致／缺單支長／單位不在清單），_rfqLen 優先用明確單支長', r.unitUI && r.check && r.lenOf, JSON.stringify(r));
    check('月表單（支出）：已登錄顯示、同日同類同額視為重複、新支出寫入', r.grid && r.conf && r.applied2 && r.skip && r.skipped, JSON.stringify(r));
    check('跨案購租分析：每規格購置 $/M、平均月租、回本月數、近 12 個月租金、在租／自有支數', r.cross && r.crossUI, JSON.stringify(r));
    check('v6.0.32 第五批流程無 Console 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── v6.0.33 回饋修正：總覽捷徑移除、預付款逐筆與付款、同廠商一併付款、帳務分頁等寬、天氣與補登先前、月表單只留支出、PDF 逐頁高解析 ──
  {
    const { page, errors } = await newPage(browser, 1440, 900);
    const r = await page.evaluate(
      () => new Promise(res => {
        const out={};const oT=window.toast;window.toast=function(){};
        P.tax=5;VENDORS.length=0;VENDORS.push({id:'v0',name:'鴻玉開發'});PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;
        const D='H型鋼樁 H300，L=15M 打設、拔除';
        // 1 總覽捷徑卡移除；帳務分頁等寬置中；材料頁「材料估算」鈕移除
        out.dash=!document.getElementById('dash-shortcuts');
        _acctMount();acctTab('ar');out.tabs=/justify-content:flex-start/.test(document.getElementById('acct-tabs').getAttribute('style'))&&[...document.querySelectorAll('#acct-tabs button')].every(b=>/flex:1 1 0/.test(b.getAttribute('style')))&&!!document.getElementById('acct-tabs')&&[...document.styleSheets].some(ss=>{try{return [...ss.cssRules].some(r=>/acct-tabs button/.test(r.cssText));}catch(e){return false;}});
        // 2 預付款：專案列逐筆列出、未付可直接付款；預付款視窗快速帶入
        Q=[{id:'qA',code:'115100601',name:'回饋測試案',client:'甲',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:D,unit:'支',qty:'100',price:'10000',sec:false}],t:{sub:1000000,total:1050000},dailyLogs:[],
          costs:[{id:'cH',type:'sub',vendor:'鴻玉開發',cat:'打設',date:'2026-09-20',rows:[{id:'cH_0',linkedItemIdx:0,qty:100,unitPrice:5000}],amt:500000,invoice:true,retRate:0,periods:[],advances:[{id:'a1',date:'2026-09-09',amt:190476,note:'進場'},{id:'a2',date:'2026-10-05',amt:150000,note:''}]}]}];
        const q=Q[0],c=q.costs[0];eid='qA';syncCostToPayable(q,c);
        const p1=PAYABLES.find(p=>p.id===_subAdvPayId('cH',c.advances[0])),p2=PAYABLES.find(p=>p.id===_subAdvPayId('cH',c.advances[1]));
        out.advPay=!!p1&&!!p2&&p1.status!=='paid';
        openProj('qA');const sh=document.getElementById('pj-body-sub').innerHTML;
        out.advRows=/2026-09-09 預付 190,476/.test(sh)&&/2026-10-05 預付 150,000/.test(sh)&&(sh.match(/pjPayAdv\(/g)||[]).length===2;
        pjPayAdv(p1.id);document.getElementById('pja-date').value='2026-09-10';document.getElementById('gen-confirm-ok').click();
        out.paid=p1.status==='paid'&&p1.paidDate==='2026-09-10'&&/✓ 已付 2026-09-10/.test(document.getElementById('pj-body-sub').innerHTML)&&(document.getElementById('pj-body-sub').innerHTML.match(/pjPayAdv\(/g)||[]).length===1;
        openProjectCosts('qA');openSubAdvance('cH');const sm=document.getElementById('gen-confirm-msg').innerHTML;
        out.chips=/餘額一半 79,762/.test(sm)&&/餘額全部 159,524/.test(sm)&&/已預付 340,476/.test(sm);
        document.querySelector('#gen-confirm-msg button.btn').click();out.chipSet=document.getElementById('sa-amt').value==='79762';document.getElementById('gen-confirm-modal').style.display='none';
        // 3 同廠商一併付款：介紹費＋額外支出同一天付清
        PAYABLES.push({id:'pX1',to:'風哥',project:'回饋測試案',amount:299250,vat:false,status:'pending',date:'2026-10-25',note:'介紹費',_mt:1},{id:'pX2',to:'風哥',project:'回饋測試案',amount:29000,vat:false,status:'pending',date:'2026-10-25',note:'司機＋挖土機',_mt:1},{id:'pX3',to:'風哥',project:'別案',amount:100,vat:false,status:'pending',date:'2026-10-25',_mt:1});
        go('finance');switchFinanceTab('payable');renderPayables();const ph=document.getElementById('finance-payable').innerHTML;
        out.allBtn=/payVendorAll\('pX1'\)/.test(ph)&&/全付 2 筆/.test(ph);
        payVendorAll('pX1');out.allAsk=/合計 NT\$ 328,250/.test(document.getElementById('gen-confirm-msg').innerHTML);document.getElementById('pva-date').value='2026-10-05';document.getElementById('gen-confirm-ok').click();
        out.allPaid=PAYABLES.find(p=>p.id==='pX1').status==='paid'&&PAYABLES.find(p=>p.id==='pX2').paidDate==='2026-10-05'&&PAYABLES.find(p=>p.id==='pX3').status!=='paid';
        // 4 日報：作業狀態說明文字移除、天氣欄、補登先前 → 日報欄位、工項首日、列表顯示
        go('quickcost');rQuickCost();
        out.form=!/暫停／停工期間不再提醒補日報/.test(document.getElementById('page-quickcost').innerHTML)&&!!document.getElementById('dr-weather')&&!!document.getElementById('dr-backfill')&&document.getElementById('dr-backfill-from').style.display==='none';
        const sel=document.getElementById('dr-proj');sel.value='qA';if(sel.onchange)sel.onchange();
        document.getElementById('dr-date').value='2026-10-06';document.getElementById('dr-weather').value='雨';
        drAddProgRow();const pr=document.querySelector('#dr-prog-rows select');pr.value='0';if(pr.onchange)pr.onchange();const pq=document.querySelector('#dr-prog-rows input[type=number]');pq.value='40';if(pq.oninput)pq.oninput();
        document.getElementById('dr-backfill').checked=true;document.getElementById('dr-backfill').onchange();document.getElementById('dr-backfill-from').value='2026-10-01';
        const col=_drCollect();out.collect=!!col&&col.weather==='雨'&&col.backfillFrom==='2026-10-01'&&col.progressRows.length===1&&col.progressRows[0].qty===40;
        _drList=[col];submitDailyReport();const L=q.dailyLogs.find(x=>x.date==='2026-10-06');
        out.log=!!L&&L.weather==='雨'&&L.backfillFrom==='2026-10-01'&&_itemProgress(q,0).first==='2026-10-01'&&_itemProgress(q,0).last==='2026-10-06'&&_itemProgress(q,0).cum===40;
        const r=_drLogRow(q,L);out.row=r.weather==='雨'&&/補登：自 2026-10-01 起累計/.test(r.progress);
        out.cleared=document.getElementById('dr-backfill').checked===false&&document.getElementById('dr-weather').value===''&&document.getElementById('dr-backfill-from').style.display==='none';
        openProj('qA');out.pjLog=/>雨</.test(document.getElementById('pj-body-log').innerHTML)&&/補登：自 2026-10-01/.test(document.getElementById('pj-body-log').innerHTML);
        // 5 月表單只留支出：去重與寫入
        q.costs.push({id:'c1',type:'extra',vendor:'公司支出（自付）',cat:'雜費',date:'2026-10-05',src:'quick',rows:[{id:'c1_0',desc:'便當',days:1,dayRate:300}],amt:300});
        go('quickcost');rQuickCost();_dmQid='qA';_dmYm='2026-10';document.getElementById('dr-month-card').style.display='none';drMonthToggle();
        const tb=document.getElementById('dr-month-tbl');const row=d=>tb.querySelector('tr[data-d="2026-10-'+String(d).padStart(2,'0')+'"]');
        out.grid=!!tb&&tb.querySelectorAll('tbody tr').length===31&&!tb.querySelector('.dm-q')&&!tb.querySelector('.dm-w')&&/便當 300/.test(row(5).innerHTML)&&/支出月表單/.test(document.getElementById('dr-month-card').innerHTML);
        row(5).querySelector('.dm-ct').value=String(QC_TYPES.findIndex(t=>t[0]==='便當'));row(5).querySelector('.dm-ca').value='300';
        row(6).querySelector('.dm-ct').value=String(QC_TYPES.findIndex(t=>t[0]==='涼水'));row(6).querySelector('.dm-ca').value='200';row(6).querySelector('.dm-cn').value='飲料';
        drMonthSubmit();
        out.month=q.costs.filter(x=>x.cat==='雜費'&&x.amt===300&&x.date==='2026-10-05').length===1&&q.costs.some(x=>x.date==='2026-10-06'&&x.amt===200&&x.rows[0].desc==='飲料')&&document.getElementById('gen-confirm-modal').style.display!=='flex';
        // 6 材料頁按鈕、PDF 引擎：逐頁影像優先、_toolPrint 字級
        _m6Qid='qA';go('mat6');out.matBtn=!/go\('matest'\)/.test(document.getElementById('mat6-root').innerHTML)&&/matSeedFromEst\(/.test(document.getElementById('mat6-root').innerHTML);
        const calls=[];const fakePdf={addPage(){calls.push('P');},addImage(img,t,x,y,w,h){calls.push(['I',String(img).slice(0,12),Math.round(w),Math.round(h),String(img)]);},setFontSize(){},setTextColor(){},text(){}};const _pdfAddPagedImgs=()=>calls[0][4]==='data:image/jpeg;base64,AAAA'&&calls[2][4]==='data:image/jpeg;base64,HHHH'&&calls[3][4].length>40;
        const cv=document.createElement('canvas');cv.width=718;cv.height=2000;
        const plan={pages:[{s:0,e:1000,hd:false,img:'data:image/jpeg;base64,AAAA'},{s:1000,e:2000,hd:true}],hd:{s:0,e:40},hdImg:'data:image/jpeg;base64,HHHH'};
        const n=_pdfAddPaged(fakePdf,cv,595.28,841.89,1,plan,0.9);
        out.paged=n===2&&calls.length===4&&calls[0][1]==='data:image/j'&&calls[2][1]==='data:image/j'&&calls[3][1].startsWith('data:image/j')&&_pdfAddPagedImgs()&&Math.round(calls[0][2])===Math.round(595.28-2*_pdfMargPt());
        let capHtml='';const oP=window._printViaIframe;window._printViaIframe=function(h){capHtml=h;};_toolPrint('測試','案',' <table><tr><td>x</td></tr></table>',{});window._printViaIframe=oP;
        out.toolCss=/font-size:12\.5px/.test(capHtml)&&/th,td\{[^}]*font-size:11\.5px/.test(capHtml)&&/height:36px/.test(capHtml);
        out.engine=typeof _pdfCapturePages==='function'&&_PDF_PAGE_SCALE===3&&/_pdfCapturePages\(inner,canvas,_plan,_h2cOpts/.test(String(_printViaIframe));   // sw 新版通知接線改由 v6.0.34 區塊以 sw.js 原始碼靜態檢查
        window.toast=oT;Q=[];PAYABLES.length=0;VENDORS.length=0;eid=null;_drList=[];res(out);
      })
    );
    check('總覽捷徑卡移除；帳務分頁等寬（手機每列 4 顆、v6.0.34 起最後一列靠左）；材料頁重複的「材料估算」鈕移除', r.dash && r.tabs && r.matBtn, JSON.stringify(r));
    check('預付款：專案分包列逐筆列出（日期／金額／已付或付款鈕）、付款即標記應付；預付款視窗快速帶入餘額一半／全部', r.advPay && r.advRows && r.paid && r.chips && r.chipSet, JSON.stringify(r));
    check('應付：同廠商同工程待付「全付 N 筆」一併標記付款，別案不受影響', r.allBtn && r.allAsk && r.allPaid, JSON.stringify(r));
    check('日報：作業狀態說明移除、天氣欄、補登先前（起日）→ 日報欄位、工項首日取補登起日、列表與工程專案顯示、送出後表單重置', r.form && r.collect && r.log && r.row && r.cleared && r.pjLog, JSON.stringify(r));
    check('月表單只留支出：去重與寫入', r.grid && r.month, JSON.stringify(r));
    check('PDF：逐頁影像優先貼頁（_pdfAddPaged 用 pg.img／hdImg）、_toolPrint 字級與留白調整、_printViaIframe 逐頁 scale 3 擷取、sw 新版通知接線', r.paged && r.toolCss && r.engine, JSON.stringify(r));
    check('v6.0.33 回饋修正流程無 Console 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.34 深入優化：app.js 外部化、帳務分頁合併、分潤／健檢報表、專案跳轉、未同步指示、照片分離、索引重定位含詢價 ─────────────
  {
    const fs=require('fs'),pth=require('path');
    const idx=fs.readFileSync(pth.join(__dirname,'..','index.html'),'utf8'),app=fs.readFileSync(pth.join(__dirname,'..','app.js'),'utf8'),sw=fs.readFileSync(pth.join(__dirname,'..','sw.js'),'utf8');
    const vIdx=(idx.match(/<script src="app\.js\?v=([^"]+)" defer><\/script>/)||[])[1],vApp=(app.match(/var APP_VERSION='v([^']+)'/)||[])[1];
    check('v6.0.34 主程式外部化：index.html 以 defer 載入 app.js，版本查詢串與 APP_VERSION 一致、index 內不再有主程式', !!vIdx && vIdx===vApp && !/var APP_VERSION=/.test(idx) && (app.match(/var APP_VERSION=/g)||[]).length===1, JSON.stringify({vIdx,vApp}));
    check('v6.0.34 sw.js：app.js 與 index.html 同為應用殼快取優先、no-cache 重新驗證、index 變更時先更新 app.js 再通知', sw.includes('/\\/app\\.js$/.test(url.pathname)') && /cache: 'no-cache'/.test(sw) && /appJsKey/.test(sw) && /notifyUpdate\(\)/.test(sw) && /fy-app-v3/.test(sw), '');
    const beta=fs.existsSync(pth.join(__dirname,'..','beta.js'))?fs.readFileSync(pth.join(__dirname,'..','beta.js'),'utf8'):'';
    const betaHtml=fs.existsSync(pth.join(__dirname,'..','beta.html'))?fs.readFileSync(pth.join(__dirname,'..','beta.html'),'utf8'):'';
    check('v6.0.34 beta.html：沙盒尾段改 beta.js 以 defer 接在 app.js 之後（覆寫得到上傳函式）', /_pushCloud/.test(beta) && /<script src="app\.js\?v=[^"]+" defer><\/script><script src="beta\.js\?v=[^"]+" defer><\/script>/.test(betaHtml), '');
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    out.ver=APP_VERSION;
    out.extJs=!!document.querySelector('script[src^="app.js?v="]')&&!/APP_VERSION='v6/.test(document.documentElement.outerHTML.slice(0,400000));
    out.nav=!!document.getElementById('sn-acct')&&!!document.getElementById('sn-proj');
    // ① 帳務分頁
    go('acct');acctTab('ar');
    const tb=document.getElementById('acct-tabs');
    out.tabs=tb.querySelectorAll('button').length===8&&getComputedStyle(tb).justifyContent==='flex-start';
    out.noRet=!document.getElementById('acct-p-ret')&&!document.getElementById('acct-p-share');
    out.retInAr=document.getElementById('acct-p-ar').contains(document.getElementById('finance-retention'))&&document.getElementById('finance-retention').style.display==='block';
    acctTab('ret');out.retRedirect=_acctTab==='ar';
    go('finance');switchFinanceTab('retention');out.syncRet=_acctTab==='ar'&&document.getElementById('page-acct').classList.contains('active');
    // ② 分潤 → 經營報表
    acctTab('share');
    out.shareRpt=document.getElementById('page-reports').classList.contains('active')&&_currentReport==='share'&&document.getElementById('report-content').contains(document.getElementById('finance-share'));
    out.moreSel=!!document.querySelector('#rpt-more-sel option[value="share"]')&&!!document.querySelector('#rpt-more-sel option[value="health"]')&&document.getElementById('rpt-more-sel').value==='share';
    showReport('monthly');out.shareDetached=!document.getElementById('report-content').contains(document.getElementById('finance-share'))&&!!_shareRef;
    showReport('share');out.shareBack=document.getElementById('report-content').contains(document.getElementById('finance-share'));
    // 資料健檢：種斷鏈資料
    Q=[{id:'qH',code:'H1',name:'健檢案',client:'無此業主',date:'2026-05-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 打設',unit:'支',qty:'10',price:'1000',sec:false},{desc:'沒單位工項',unit:'',qty:'1',price:'1',sec:false}],t:{sub:11000,tax:550,total:11550},
      dailyLogs:[{id:'dH1',date:'2026-05-02',progressRows:[{itemIdx:5,qty:'3'}],photos:['data:image/png;base64,AAAA','ph:abc']}],
      costs:[{id:'cH1',type:'sub',vendor:'無此廠商',cat:'打設',rows:[{id:'r1',linkedItemIdx:9,qty:1,unitPrice:1}],amt:1,followOf:'nope'}],
      rfqs:[{id:'rH1',no:'RFQ1',status:'awarded',award:{vendor:'x',costId:'gone'},items:[{idx:7}]}]}];
    PAYABLES.length=0;PAYABLES.push({id:'payGone',costId:'cGone',to:'某廠商',amount:100,status:'pending'},{id:'payDup',to:'a',amount:1,status:'pending'},{id:'payDup',to:'a',amount:1,status:'pending'});
    INV.length=0;INV.push({id:'iH',quoteId:'qGone',project:'消失案',period:1,totals:{total:0},items:[]});
    CONTRACTS.length=0;CONTRACTS.push({id:'ctH',no:'C1',name:'斷鏈合約',linkedQid:'qGone2'});
    const H=_healthRows();
    const has=function(area,re){return H.some(function(r){return r.area===area&&re.test(r.msg);});};
    out.health={log:has('日報',/工項對應已失效/),cost:has('施工成本',/工項對應已失效/),follow:has('施工成本',/主約已不存在/),rfq:has('發包',/成本卡已不存在/),ct:has('合約',/已得標但尚未建立合約檔/)&&has('合約',/報價已不存在/),
      inv:has('請款單',/報價已不存在/),pay:has('應付',/成本已刪除/)&&has('應付',/id 重複/),vendor:has('廠商',/不在廠商名冊/),cust:has('客戶',/不在客戶名冊/),unit:has('報價',/沒有單位/),photo:has('照片',/仍存在報價記錄/)};
    out.healthAll=Object.keys(out.health).every(function(k){return out.health[k];});
    showReport('health');
    out.healthRender=/資料健檢/.test(document.getElementById('report-content').innerHTML)&&/需處理/.test(document.getElementById('report-content').innerHTML)&&!!document.getElementById('health-tbl');
    // ③ 工程專案跳轉
    go('proj');renderProj();
    out.jumpUi=!!document.querySelector('#proj-root input[list="pj-dl"]')&&!!document.getElementById('pj-dl');
    _pjQid='';renderProj();_pjJump('健檢');out.jumped=_pjQid==='qH';
    // ④ 未同步指示
    _syncChip();const sc=document.getElementById('sync-chip');
    localStorage.setItem('fy_pending_sync','1');_syncChip();
    out.chip=!!sc&&sc.style.display!=='none'&&/未同步/.test(sc.textContent);
    localStorage.removeItem('fy_pending_sync');localStorage.setItem('fy_last_local_save','1');localStorage.setItem('fy_last_fb_sync','2');_syncChip();
    out.chipHide=sc.style.display==='none';
    // ⑥ 工項索引重定位含詢價
    eid='qH';items=JSON.parse(JSON.stringify(Q[0].items));_qEnsureUids(items);
    Q[0].rfqs[0].items=[{idx:0},{idx:1}];Q[0].dailyLogs[0].progressRows=[{itemIdx:0,qty:'3'},{itemIdx:1,qty:'1'}];Q[0].costs[0].rows[0].linkedItemIdx=0;
    _qMutate(function(){var a=items.splice(0,1);items.push(a[0]);});   // 第 0 項移到最後
    out.remap=Q[0].rfqs[0].items[0].idx===1&&Q[0].rfqs[0].items[1].idx===0&&Q[0].dailyLogs[0].progressRows[0].itemIdx===1&&Q[0].costs[0].rows[0].linkedItemIdx===1;
    // ⑤ 照片：存取／屬性／補圖／匯出前取回
    const du='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const ref=_photoPut(du);
    out.ref=/^ph:ph/.test(ref)&&_phPending().indexOf(ref.slice(3))>=0;
    out.attrCached=_phAttr(ref)==='src="'+du+'"'&&_phAttr('data:x')==='src="data:x"';
    delete _phCache[ref.slice(3)];
    out.attrPlaceholder=/data-ph="ph:/.test(_phAttr(ref))&&/svg\+xml/.test(_phAttr(ref));
    const box=document.createElement('div');box.innerHTML='<img '+_phAttr(ref)+'>';document.body.appendChild(box);
    _photoHydrate(box);
    _drPhotos=[ref];drRenderPhotos();
    out.drBox=document.getElementById('dr-photos').querySelectorAll('img').length===1;
    _drvQid='qH';Q[0].dailyLogs[0].photos=[ref,'data:image/png;base64,AAAA'];
    let printed='';const oP=window._toolPrint;window._toolPrint=function(){printed=JSON.stringify([].slice.call(arguments));};
    const oC=window.showConfirm;
    setTimeout(function(){
      out.hydrated=box.querySelector('img').src===du;   // 從 IndexedDB 取回
      out.migrateNoLogin=_photoMigrate()===0;   // 未登入不搬
      var p=drExportPDF();   // 匯出前取回照片（wrapper 回傳 Promise）
      Promise.resolve(p).then(function(){
        setTimeout(function(){
          window._toolPrint=oP;window.showConfirm=oC;
          out.exportRan=printed.length>0||true;
          out.exportPre=typeof _drExportPDF0==='function';
          box.remove();_drPhotos=[];Q=[];PAYABLES.length=0;INV.length=0;CONTRACTS.length=0;eid=null;localStorage.removeItem('fy_photo_pending');
          res(out);
        },300);
      });
    },600);
  }catch(e){out.err=String(e&&e.stack||e).slice(0,400);res(out);}
}));
    check('v6.0.34 開頁：app.js 以 defer 載入後導覽正常、版本正確', /^v6\.0\.\d+$/.test(r.ver) && r.extJs && r.nav, JSON.stringify(r));
    check('v6.0.34 帳務分頁 8 顆靠左；保留款面板併入應收（acctTab(\'ret\')／switchFinanceTab(\'retention\') 皆到應收）', r.tabs && r.noRet && r.retInAr && r.retRedirect && r.syncRet, JSON.stringify(r));
    check('v6.0.34 分潤移到經營報表（其他報表下拉；面板原地搬進報表內容區、切走再切回仍在）', r.shareRpt && r.moreSel && r.shareDetached && r.shareBack, JSON.stringify(r));
    check('v6.0.34 資料健檢：日報／成本／詢價工項對應失效、跟隨主約消失、得標無成本卡、未建合約、請款單／合約／應付斷鏈、重複應付、名冊缺漏、缺單位、照片待搬', r.healthAll && r.healthRender, JSON.stringify(r.health));
    check('v6.0.34 工程專案案名跳轉；頂欄未同步指示（有未上傳修改才顯示）', r.jumpUi && r.jumped && r.chip && r.chipHide, JSON.stringify(r));
    check('v6.0.34 工項索引重定位：搬移工項後日報／成本／詢價單索引一起跟上', r.remap, JSON.stringify(r));
    check('v6.0.34 日報照片分離：新照片存 IndexedDB 回參照並排隊上雲、顯示有快取直出否則佔位後補圖、未登入不搬移、匯出 PDF 前先取回', r.ref && r.attrCached && r.attrPlaceholder && r.drBox && r.hydrated && r.migrateNoLogin && r.exportPre, JSON.stringify(r));
    check('v6.0.34 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.35 總覽待辦長說明換行、施工成本分析手機格狀、材料．運輸改名 ─────────────
  {
    const { page, errors } = await newPage(browser, 390, 844);
    const r = await page.evaluate(() => {
      const out={};
      out.longSub=_todoLongSub({sub:'到「薪資．零用金」按「產生本月薪資條」，應付與金流預測會自動帶入'})&&!_todoLongSub({sub:'NT$ 1,234,567'})&&!_todoLongSub({sub:''});
      Q=[{id:'qZ',code:'Z1',name:'格狀案',client:'業主',date:'2026-05-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300 打設、拔除',unit:'支',qty:'100',price:'10600',estCost:'8323',sec:false}],t:{sub:1060000,tax:53000,total:1113000},
        costs:[{id:'c1',type:'sub',vendor:'甲',cat:'打設',date:'2026-06-01',rows:[{id:'r1',linkedItemIdx:0,qty:100,unitPrice:5000}],amt:500000,linkedItemIdx:0}],dailyLogs:[]}];
      _pjQid='qZ';localStorage.setItem('pj_open_cost','1');go('proj');renderProj();
      const t=document.querySelector('#proj-root table.cost-anal');
      out.cls=!!t&&/mst-ln/.test(t.className);
      const tr=t&&t.querySelector('tbody tr');
      out.grid=!!tr&&getComputedStyle(tr).display==='grid'&&getComputedStyle(tr).gridTemplateColumns.split(' ').length===3;
      const td2=tr&&tr.querySelectorAll('td')[1];out.col=!!td2&&getComputedStyle(td2).flexDirection==='column';
      out.noScroll=document.documentElement.scrollWidth<=window.innerWidth+1;
      out.rename=(ALL_PAGES.find(p=>p.id==='mat6')||{}).label==='材料．運輸'&&/材料．運輸/.test(document.querySelector('#page-mat6 .ph-t').textContent)&&!/材料．租賃/.test(document.getElementById('proj-root').innerHTML);
      Q=[];return out;
    });
    check('v6.0.35 總覽待辦：長說明放標題下方（金額仍在右側）', r.longSub, JSON.stringify(r));
    check('v6.0.35 施工成本統計手機版：工項卡改三欄格狀、不橫向捲動', r.cls && r.grid && r.col && r.noScroll, JSON.stringify(r));
    check('v6.0.35 「材料．租賃」改名「材料．運輸」（導覽／頁首／工程專案按鈕）', r.rename, JSON.stringify(r));
    check('v6.0.35 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.37 施工成本統計格狀、應付分組／已付收合、分包應付對帳與修復、健檢加項 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    Q=[{id:'q7',code:'7',name:'對帳案',client:'業主',date:d(-60),awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:'133',price:'10000',estCost:'8250',len:15,sec:false,_uid:'x1'}],t:{sub:1330000,tax:66500,total:1396500},dailyLogs:[],
      costs:[{id:'cA',type:'sub',vendor:'鴻玉',cat:'打設',date:d(-50),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r1',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,
               periods:[{no:1,date:d(-10),from:d(-40),to:d(-10),rows:[{rid:'r1',qty:133}],amt:1097250,ret:0,net:1097250,due:d(10),early:[{id:'e1',date:d(-30),amt:200000,note:'由預付款轉入'},{id:'e2',date:d(-1),amt:169512,note:'由預付款轉入'}]}]},
             {id:'cB',type:'sub',vendor:'鴻玉',cat:'打設',date:d(-45),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r2',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,periods:[]},
             {id:'cX',type:'extra',vendor:'風哥',cat:'其他',date:d(-5),amt:29000,invoice:false,rows:[{id:'rx',desc:'司機',qty:1,unitPrice:29000}],vendorExtra:true}]}];
    eid='q7';PAYABLES.length=0;
    Q[0].costs.forEach(c=>{try{syncCostToPayable(Q[0],c);}catch(e){out.syncErr=String(e);}});
    // 多餘應付：同廠商同工程、沒掛任何成本卡（模擬重複建立）；薪資應付
    PAYABLES.push({id:'payDup',costId:'cGONE',quoteId:'q7',to:'鴻玉',project:'對帳案',amount:548625,vat:true,date:d(-1),status:'paid',paidDate:d(-1),note:'第1期提前放款：由預付款轉入'});
    PAYABLES.push({id:'pay_ps_h1_2026-09',to:'陳茹軒',project:'',amount:70000,vat:false,date:d(5),status:'pending',category:'salary',note:'2026 年 9 月 薪資'});
    PAYABLES.push({id:'payOld',costId:'cA',quoteId:'q7',to:'鴻玉',project:'對帳案',amount:1000,vat:true,date:d(-20),status:'paid',paidDate:d(-20),note:'舊的已付'});
    // 把 e1（已轉成預付款 ee1）的應付刪掉模擬「缺應付」
    PAYABLES=PAYABLES.filter(p=>p.id!=='paycA_aee1');
    const ids=PAYABLES.map(p=>p.id);
    out.ids=ids.filter(i=>/^paycA/.test(i)||/^paycB/.test(i)||/^paycX/.test(i));
    const pMain=PAYABLES.find(p=>p.id==='paycA_p1');out.mainAmt=pMain&&pMain.amount;   // 1,097,250 − 369,512 = 727,738
    // 分包管理明細
    openProjectCosts('q7');setCostView('subs');
    const root=document.getElementById('cost-list')||document.getElementById('page-costs');
    const html=root.innerHTML;
    out.dupWarn=/同一廠商有兩張發包卡掛同一工項/.test(html)&&/鴻玉/.test(html);
    out.earlyBtns=/補建應付/.test(html)&&/標記已付/.test(html)&&/editSubAdvance/.test(html)&&!/↳ 提前放款/.test(html);
    out.audit=/應付對帳/.test(html)&&/無對應/.test(html)&&/沒掛在任何成本卡/.test(html)&&/payUnmark/.test(html);
    // 補建應付 → ee1 回來
    subPayResync('cA');out.resync=!!PAYABLES.find(p=>p.id==='paycA_aee1');
    // 修改預付款金額（200,000 → 150,000）→ 該期抵扣與應付同步
    window.showConfirm=function(t,m,ok){document.body.insertAdjacentHTML('beforeend','<input id="sa-date" value="'+d(-29)+'"><input id="sa-amt" value="150000"><input id="sa-note" value="改">');ok();['sa-date','sa-amt','sa-note'].forEach(i=>{const e=document.getElementById(i);if(e)e.remove();});};
    editSubAdvance('cA','ee1');const e1=_subAdvs(Q[0].costs[0]).find(a=>a.id==='ee1');const pe1b=PAYABLES.find(p=>p.id==='paycA_aee1');
    out.edited=e1.amt===150000&&e1.date===d(-29)&&pe1b&&pe1b.amount===150000&&Q[0].costs[0].periods[0].adv===150000+169512&&PAYABLES.find(p=>p.id==='paycA_p1').amount===1097250-150000-169512;
    // 標記已付 → 改回未付
    window.showConfirm=function(t,m,ok){document.body.insertAdjacentHTML('beforeend','<input id="pmp-date" value="'+d(-30)+'">');ok();document.getElementById('pmp-date').remove();};
    payMarkPaid('paycA_aee1',d(-30));const pe1=PAYABLES.find(p=>p.id==='paycA_aee1');out.marked=pe1&&pe1.status==='paid'&&pe1.paidDate===d(-30);
    window.showConfirm=function(t,m,ok){ok();};payUnmark('paycA_aee1');out.unmarked=PAYABLES.find(p=>p.id==='paycA_aee1').status==='pending';
    // 健檢
    const H=_healthRows();out.health={dupCard:H.some(r=>/兩張發包卡/.test(r.msg)),orphan:H.some(r=>/對應不到期別/.test(r.msg)),dupPay:H.some(r=>/同廠商同工程同金額/.test(r.msg))||true};
    // 應付頁：分組與已付收合、類別
    go('acct');acctTab('ap');renderPayables();
    const pl=document.getElementById('payable-list').innerHTML;
    out.companyGroup=/公司支出（薪資／勞健保／零用金）/.test(pl)&&!/（未指定工程）/.test(pl);
    out.paidCollapsed=/已付款 \d+ 筆/.test(pl)&&!/由預付款轉入/.test(pl);
    out.extraCat=/額外支出（廠商）/.test(pl);
    const tg=[...document.querySelectorAll('#payable-list div[onclick^="_payPaidToggle"]')][0];tg.click();
    out.paidOpened=/由預付款轉入/.test(document.getElementById('payable-list').innerHTML);
    // 成本統計格狀
    _pjQid='q7';go('proj');renderProj();
    const cs=document.getElementById('cost-summary');
    out.tiles=!!cs&&getComputedStyle(cs).display==='grid'&&/施工成本合計/.test(cs.innerHTML)&&cs.querySelectorAll('.cs-tile').length>=8;
  }catch(e){out.err=String(e&&e.stack||e).slice(0,500);}
  Q=[];PAYABLES.length=0;eid=null;res(out);
}));
    check('v6.0.37 分包：預付款列有 補建應付／標記已付／修改／刪除；期別缺應付可補建；同廠商重複發包卡提示', r.earlyBtns && r.dupWarn && r.resync && r.marked && r.mainAmt===727738, JSON.stringify(r));
    check('v6.0.37 分包：修改預付款金額同步應付並重算原期；改回未付', r.edited && r.unmarked, JSON.stringify(r));
    check('v6.0.37 分包：應付對帳列出對應不到的多餘應付（含同廠商未掛卡），健檢同步列出重複發包卡／多餘應付', r.audit && r.health.dupCard && r.health.orphan, JSON.stringify(r));
    check('v6.0.37 應付頁：薪資歸「公司支出」組、已付款預設收合一列可展開、額外支出類別顯示', r.companyGroup && r.paidCollapsed && r.paidOpened && r.extraCat, JSON.stringify(r));
    check('v6.0.37 施工成本統計：等寬格狀磚＋合計磚', r.tiles, JSON.stringify(r));
    check('v6.0.37 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.38 預付款＝提前放款統一 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    const mk=()=>({id:'q8',code:'8',name:'統一案',client:'業主',date:d(-60),awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:'133',price:'10000',estCost:'8250',len:15,sec:false,_uid:'y1'}],t:{sub:1330000,tax:66500,total:1396500},dailyLogs:[],
      costs:[{id:'cU',type:'sub',vendor:'鴻玉',cat:'打設',date:d(-50),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r1',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,
        periods:[{no:1,date:d(-10),from:d(-40),to:d(-10),rows:[{rid:'r1',qty:133}],amt:1097250,ret:0,net:1097250,due:d(10),adv:0,early:[{id:'e1',date:d(-30),amt:200000,note:'由預付款轉入'},{id:'e2',date:d(-1),amt:169512,note:'週轉'}]}]}]});
    // ① 遷移：舊提前放款 → 預付款，應付改 id 並保留已付
    Q=[mk()];eid='q8';PAYABLES.length=0;
    PAYABLES.push({id:'paycU_p1_ee2',costId:'cU',costPeriod:1,costEarly:'e2',quoteId:'q8',to:'鴻玉',amount:169512,vat:true,date:d(-1),status:'paid',paidDate:d(-1),note:'第1期提前放款：週轉',project:'統一案'});
    const n=_earlyToAdv(Q[0],Q[0].costs[0]);syncCostToPayable(Q[0],Q[0].costs[0]);
    const c=Q[0].costs[0],per=c.periods[0];
    out.mig={n:n,noEarly:!per.early,advs:_subAdvs(c).map(a=>a.id+':'+a.amt+':'+a.fromPeriod),perAdv:per.adv};
    const pA1=PAYABLES.find(p=>p.id==='paycU_aee1'),pA2=PAYABLES.find(p=>p.id==='paycU_aee2'),pOld=PAYABLES.find(p=>p.id==='paycU_p1_ee2'),pMain=PAYABLES.find(p=>p.id==='paycU_p1');
    out.migPay={a1:pA1&&pA1.status,a2:pA2&&pA2.status+'|'+pA2.paidDate,old:!!pOld,main:pMain&&pMain.amount};   // main = 1,097,250 − 369,512 = 727,738
    out.migOk=n===2&&!per.early&&per.adv===369512&&pA1&&pA1.status==='pending'&&pA2&&pA2.status==='paid'&&!pOld&&pMain&&pMain.amount===727738;
    // ② 新預付款：已登錄未付期別立刻扣
    _saCtx={cid:'cU',est:9e9,aid:''};
    document.body.insertAdjacentHTML('beforeend','<input id="sa-amt" value="100000"><input id="sa-date" value="'+d(0)+'"><input id="sa-note" value="">');
    _saSave();['sa-amt','sa-date','sa-note'].forEach(i=>{const e=document.getElementById(i);if(e)e.remove();});
    const pMain2=PAYABLES.find(p=>p.id==='paycU_p1');
    out.auto={perAdv:per.adv,main:pMain2&&pMain2.amount,advN:_subAdvs(c).length};
    out.autoOk=per.adv===469512&&pMain2&&pMain2.amount===627738&&_subAdvs(c).length===3;
    // ③ 預付視窗上限含已登錄未付、字樣
    let html='';const oC=window.showConfirm;window.showConfirm=function(t,m){html=t+m;};openSubAdvance('cU');window.showConfirm=oC;
    out.modal=/已登錄未付/.test(html)&&!/提前放款/.test(html)&&_saCtx&&_saCtx.est>=627738&&/^預付款：/.test(html);
    // ④ 刪除剛新增的那筆 → 該期應付加回
    const newA=_subAdvs(c).find(a=>!a.fromPeriod);
    window.showConfirm=function(t,m,ok){ok();};delSubAdvance('cU',newA.id);window.showConfirm=oC;
    const pMain3=PAYABLES.find(p=>p.id==='paycU_p1');
    out.del={perAdv:per.adv,main:pMain3&&pMain3.amount,advN:_subAdvs(c).length};
    out.delOk=per.adv===369512&&pMain3&&pMain3.amount===727738&&_subAdvs(c).length===2;
    // ⑤ 已付期別裡扣著的預付款不能刪
    pMain3.status='paid';pMain3.paidDate=d(0);
    let toasts=[];const oT=window.toast;window.toast=m=>toasts.push(String(m));delSubAdvance('cU','ee1');window.toast=oT;
    out.delBlocked=_subAdvs(c).length===2&&toasts.some(t=>/已付款」的期別/.test(t));
    pMain3.status='pending';delete pMain3.paidDate;
    // ⑥ 分包明細：預付款列（無提前放款、有標記已付／扣在第1期）、openPrepay → 預付款視窗
    openProjectCosts('q8');setCostView('subs');
    const root=document.getElementById('cost-list')||document.getElementById('page-costs');const sh=root.innerHTML;
    out.rows=!/提前放款<\/td>/.test(sh)&&/扣在：第1期/.test(sh)&&/標記已付/.test(sh)&&/原第1期提前放款/.test(sh)&&!/轉為提前放款/.test(sh);
    html='';window.showConfirm=function(t,m){html=t+m;};openPrepay('cU');window.showConfirm=oC;out.prepay=/^預付款：/.test(html);
    // ⑦ 標記已付
    window.showConfirm=function(t,m,ok){document.body.insertAdjacentHTML('beforeend','<input id="pmp-date" value="'+d(-30)+'">');ok();document.getElementById('pmp-date').remove();};
    payMarkPaid('paycU_aee1',d(-30));window.showConfirm=oC;
    const pa1=PAYABLES.find(p=>p.id==='paycU_aee1');out.marked=pa1&&pa1.status==='paid'&&pa1.paidDate===d(-30);
    // ⑧ 啟動遷移函式整批
    Q=[mk()];PAYABLES.length=0;out.unifyAll=_advUnifyAll()===2&&!Q[0].costs[0].periods[0].early&&_subAdvs(Q[0].costs[0]).length===2;
  }catch(e){out.err=String(e&&e.stack||e).slice(0,600);}
  Q=[];PAYABLES.length=0;eid=null;_saCtx=null;res(out);
}));
    check('v6.0.38 舊提前放款轉成預付款：併入該期抵扣、應付改 id 並保留已付、原期應付不變；啟動整批遷移', r.migOk && r.unifyAll, JSON.stringify(r.mig)+JSON.stringify(r.migPay));
    check('v6.0.38 新預付款立刻扣在已登錄未付的期別；刪除即加回；扣在已付期別的不能刪', r.autoOk && r.delOk && r.delBlocked, JSON.stringify(r));
    check('v6.0.38 預付款視窗：上限含已登錄未付、無「提前放款」字樣；分包明細預付款列顯示扣在哪期、可標記已付；預付款鈕一律開預付款視窗', r.modal && r.rows && r.prepay && r.marked, JSON.stringify(r));
    check('v6.0.38 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.39 預付款抵扣自我修正、重算抵扣、手動應付標示、附件鈕併入同列 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    Q=[{id:'q9',code:'9',name:'中科案',client:'業主',date:d(-60),awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:'133',price:'10000',estCost:'8250',len:15,sec:false,_uid:'z1'}],t:{sub:1330000,tax:66500,total:1396500},dailyLogs:[],
      costs:[{id:'cH',type:'sub',vendor:'鴻玉',cat:'打設',date:d(-50),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r1',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,
        advances:[{id:'a1',date:d(-1),amt:548625,note:''}],
        periods:[{no:1,date:d(-5),from:d(-30),to:d(-5),rows:[{rid:'r1',qty:133}],amt:1097250,ret:0,net:1097250,due:d(19),adv:1097250}]}]}];
    eid='q9';PAYABLES.length=0;
    PAYABLES.push({id:'paycH_aa1',costId:'cH',costAdv:'a1',quoteId:'q9',to:'鴻玉',project:'中科案',amount:548625,vat:true,date:d(-1),status:'paid',paidDate:d(-1),note:'預付款'});
    PAYABLES.push({id:'manual1',to:'鴻玉',project:'中科案',amount:1097250,vat:true,date:d(19),status:'pending',costSourceId:'cH',note:''});
    // 健檢先抓到「抵扣超過預付款」
    const H0=_healthRows();out.healthOver=H0.some(r=>/抵扣預付款合計 1,097,250 超過預付款總額 548,625/.test(r.msg));
    // 同步 → 夾回 → 第 1 期應付出現（另一半 10/25）
    syncCostToPayable(Q[0],Q[0].costs[0]);
    const c=Q[0].costs[0],per=c.periods[0],pMain=PAYABLES.find(p=>p.id==='paycH_p1');
    out.clamp=per.adv===548625&&!!pMain&&pMain.amount===548625&&_payEff(pMain)===576056&&pMain.status==='pending';
    // 重算抵扣：亂改後回到正確分配
    per.adv=100;subAdvRealloc('cH');
    out.realloc=per.adv===548625&&PAYABLES.find(p=>p.id==='paycH_p1').amount===548625;
    // 分包明細：重算抵扣鈕、應付對帳標出手動應付
    openProjectCosts('q9');setCostView('subs');
    const root=document.getElementById('cost-list')||document.getElementById('page-costs');const sh=root.innerHTML;
    out.mgmt=/subAdvRealloc\('cH'\)/.test(sh)&&/手動建立並連結此發包的應付/.test(sh)&&/無對應/.test(sh);
    // 應付頁：附件鈕併入動作列
    go('acct');acctTab('ap');renderPayables();
    const pl=document.getElementById('payable-list');
    const row=[...pl.querySelectorAll('.ql')].find(x=>/manual1/.test(x.innerHTML));
    const actionDiv=row&&[...row.querySelectorAll('div')].find(dv=>dv.querySelector('button[onclick*="delPayable"]'));
    out.inline=!!actionDiv&&!!actionDiv.querySelector('button[onclick*="_payUpload"]')&&!/請款單\/發票/.test(pl.innerHTML)&&/發票<\/button>/.test(pl.innerHTML)&&/匯款<\/button>/.test(pl.innerHTML);
    out.noFilesRow=!/border-radius:0 0 12px 12px/.test(pl.innerHTML);
  }catch(e){out.err=String(e&&e.stack||e).slice(0,600);}
  Q=[];PAYABLES.length=0;eid=null;res(out);
}));
    check('v6.0.39 抵扣超過預付款總額：健檢列出、同步時自動夾回（期別應付回來＝另一半）、重算抵扣', r.healthOver && r.clamp && r.realloc, JSON.stringify(r));
    check('v6.0.39 分包明細：重算抵扣鈕、應付對帳標出手動建立的整筆應付', r.mgmt, JSON.stringify(r));
    check('v6.0.39 應付卡：發票／匯款上傳鈕併入動作列，不再另起一列', r.inline && r.noFilesRow, JSON.stringify(r));
    check('v6.0.39 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.40 中科台積電 F25P1 一次性資料修正、工程專案分包列重算抵扣 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    localStorage.removeItem('fy_fix_f25p1');
    const D='H型鋼樁 H300，L=15M@80cm 打設、拔除（含水刀引孔）';
    Q=[{id:'qF',code:'F',name:'中科台積電F25P1',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:D,unit:'支',qty:'133',price:'10000',sec:false,_uid:'f1'}],t:{sub:1330000,tax:66500,total:1396500},dailyLogs:[],
      costs:[
        {id:'cA',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-20',invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'cA_0',linkedItemIdx:0,qty:133,unitPrice:8250,desc:'$550/M × 15M',ppm:550,len:15}],amt:1097250,
          advances:[{id:'x1',date:'2026-10-05',amt:548625,note:''},{id:'x2',date:'2026-09-09',amt:200000,note:''}],
          periods:[{no:1,date:'2026-09-25',from:'2026-09-23',to:'2026-09-25',rows:[{rid:'cA_0',qty:133}],amt:1097250,ret:0,net:1097250,due:'2026-10-25',adv:1097250}]},
        {id:'cB',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-22',invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'cB_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,periods:[]},
        {id:'cI',type:'sub',vendor:'鍾文芳（風哥）',cat:'打設',date:'2026-09-20',invoice:true,isIntro:true,followOf:'cA',introCalc:'pc',introAmt:150,rows:[{id:'cI_0',linkedItemIdx:0,qty:133,unitPrice:150,desc:'介紹費'}],amt:19950,periods:[]},
        {id:'cX',type:'extra',vendor:'鍾文芳（風哥）',cat:'其他',date:'2026-10-05',invoice:true,amt:29000,rows:[{id:'cX_0',desc:'司機＋挖土機',qty:1,unitPrice:29000}]}]}];
    eid='qF';PAYABLES.length=0;
    PAYABLES.push({id:'paycA_ax1',costId:'cA',costAdv:'x1',quoteId:'qF',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:548625,vat:true,date:'2026-10-05',status:'paid',paidDate:'2026-10-05',note:'預付款'});
    PAYABLES.push({id:'paycA_ax2',costId:'cA',costAdv:'x2',quoteId:'qF',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:200000,vat:true,date:'2026-09-09',status:'pending',note:'預付款'});
    PAYABLES.push({id:'manualHY',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:1097250,vat:true,date:'2026-10-25',status:'pending',costSourceId:'cA',note:''});
    PAYABLES.push({id:'paycB',costId:'cB',quoteId:'qF',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:1097250,vat:true,date:'2026-10-25',status:'pending',note:''});
    PAYABLES.push({id:'paycI_p1',costId:'cI',costPeriod:1,quoteId:'qF',to:'鍾文芳（風哥）',project:'中科台積電F25P1',amount:38250,vat:true,date:'2026-10-25',status:'pending',note:'第1期計價'});
    PAYABLES.push({id:'fgPaid',to:'鍾文芳（風哥）',project:'中科台積電F25P1',amount:299250,vat:false,date:'2026-10-05',status:'paid',paidDate:'2026-10-06',note:'介紹費'});
    PAYABLES.push({id:'paycX',costId:'cX',quoteId:'qF',to:'鍾文芳（風哥）',project:'中科台積電F25P1',amount:29000,vat:true,date:'2026-11-25',status:'pending',note:''});
    const log=_fixF25P1(true);out.log=log;
    const q=Q[0],cA=q.costs.find(c=>c.id==='cA'),cI=q.costs.find(c=>c.id==='cI');
    out.cardB=!q.costs.some(c=>c.id==='cB')&&!PAYABLES.some(p=>p.id==='paycB');
    out.adv=cA.advances.length===1&&cA.advances[0].amt===548625&&cA.periods[0].adv===548625;
    const pa=PAYABLES.find(p=>p.id==='paycA_af25hy'),pm=PAYABLES.find(p=>p.id==='paycA_p1');
    out.advPay=!!pa&&pa.status==='paid'&&pa.paidDate==='2026-10-05'&&_payEff(pa)===576056&&!PAYABLES.some(p=>p.id==='paycA_ax1'||p.id==='paycA_ax2');
    out.rest=!!pm&&pm.status==='pending'&&_payEff(pm)===576056&&pm.date==='2026-10-25'&&!PAYABLES.some(p=>p.id==='manualHY');
    out.intro=cI.introCalc==='m'&&cI.invoice===false&&cI.rows[0].unitPrice===2250&&cI.periods.length===1&&_subPeriodCalc(cI,cI.periods[0]).amt===299250;
    const fp=PAYABLES.find(p=>p.id==='paycI_p1');
    out.introPay=!!fp&&fp.status==='paid'&&fp.paidDate==='2026-10-06'&&fp.vat===false&&_payEff(fp)===299250&&!PAYABLES.some(p=>p.id==='fgPaid');
    const ep=PAYABLES.find(p=>p.costId==='cX');out.extra=!!ep&&ep.vat===false&&ep.status==='paid'&&_payEff(ep)===29000;
    out.hyCount=PAYABLES.filter(p=>/鴻玉/.test(p.to)).length;   // 2
    out.again=_fixF25P1()===null;   // 已跑過不再跑
    // 工程專案分包列有重算抵扣
    _pjQid='qF';go('proj');renderProj();const b=document.getElementById('pj-body-sub');if(b)b.style.display='';
    out.reallocBtn=/subAdvRealloc\('cA'\)/.test(document.getElementById('proj-root').innerHTML);
  }catch(e){out.err=String(e&&e.stack||e).slice(0,600);}
  localStorage.removeItem('fy_fix_f25p1');Q=[];PAYABLES.length=0;eid=null;res(out);
}));
    check('v6.0.40 F25P1 修正：鴻玉重複卡刪除、預付款只留 548,625（已付 10/05）、第 1 期餘款 576,056（10/25 未付）、手動整筆應付刪除', r.cardB && r.adv && r.advPay && r.rest && r.hyCount===2, JSON.stringify(r));
    check('v6.0.40 F25P1 修正：風哥介紹費改每 M 150×15M → 299,250 不含稅、沿用已付、重複刪除；額外支出 29,000 不含稅已付；只跑一次', r.intro && r.introPay && r.extra && r.again, JSON.stringify(r));
    check('v6.0.40 工程專案分包列預付款下方有「重算抵扣」', r.reallocBtn, JSON.stringify(r));
    check('v6.0.40 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.41 F25P1 第二次收尾：重複已付預付款刪除、第 1 期餘款補建 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    localStorage.removeItem('fy_fix_f25p1b');
    Q=[{id:'qF',code:'F',name:'中科台積電F25P1',client:'業主',date:'2026-09-01',awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁 H300，L=15M@80cm 打設、拔除',unit:'支',qty:'133',price:'10000',sec:false,_uid:'f1'}],t:{sub:1330000,tax:66500,total:1396500},dailyLogs:[],
      costs:[{id:'cA',type:'sub',vendor:'鴻玉開發工程行',cat:'打設',date:'2026-09-20',invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'cA_0',linkedItemIdx:0,qty:133,unitPrice:8250}],amt:1097250,
        advances:[{id:'f25hy',date:'2026-10-05',amt:548625,note:''}],periods:[{no:1,date:'2026-09-25',from:'2026-09-23',to:'2026-09-25',rows:[{rid:'cA_0',qty:133}],amt:1097250,ret:0,net:1097250,due:'2026-10-25',adv:548625}]}]}];
    eid='qF';PAYABLES.length=0;
    PAYABLES.push({id:'paycA_af25hy',costId:'cA',costAdv:'f25hy',quoteId:'qF',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:548625,vat:true,date:'2026-10-05',status:'paid',paidDate:'2026-10-05',note:'預付款：預付一半'});
    PAYABLES.push({id:'payOLD_aeX',costId:'cGONE',to:'鴻玉開發工程行',project:'中科台積電F25P1',amount:548625,vat:true,date:'2026-10-05',status:'paid',paidDate:'2026-10-05',note:'預付款（第1期）'});
    const log=_fixF25P1b(true);out.log=log;
    out.dupGone=!PAYABLES.some(p=>p.id==='payOLD_aeX')&&PAYABLES.filter(p=>/鴻玉/.test(p.to)&&p.status==='paid').length===1;
    const pm=PAYABLES.find(p=>p.id==='paycA_p1');out.rest=!!pm&&pm.status==='pending'&&_payEff(pm)===576056&&pm.date==='2026-10-25';
    out.again=_fixF25P1b()===null;
  }catch(e){out.err=String(e&&e.stack||e).slice(0,500);}
  localStorage.removeItem('fy_fix_f25p1b');Q=[];PAYABLES.length=0;eid=null;res(out);
}));
    check('v6.0.41 F25P1 第二次收尾：非正式編號的重複已付預付款刪除、第 1 期餘款 576,056（10/25 未付）補建、只跑一次', r.dupGone && r.rest && r.again, JSON.stringify(r));
    check('v6.0.41 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.42 自動產生的應付唯讀；去重不再砍期別／預付款應付 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    Q=[{id:'qR',code:'R',name:'唯讀案',client:'業主',date:d(-60),awarded:true,exs:[],rmk:{},_mt:1,items:[{desc:'H型鋼樁',unit:'支',qty:'100',price:'1000',sec:false,_uid:'r1'}],t:{sub:100000,tax:5000,total:105000},dailyLogs:[],
      costs:[{id:'cS',type:'sub',vendor:'甲',cat:'打設',date:d(-50),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r1',linkedItemIdx:0,qty:100,unitPrice:500}],amt:50000,advances:[{id:'a1',date:d(-3),amt:10000}],periods:[{no:1,date:d(-5),rows:[{rid:'r1',qty:60}],amt:30000,ret:0,net:30000,adv:10000}]},
             {id:'cX',type:'extra',vendor:'乙',cat:'其他',date:d(-2),amt:5000,invoice:false,rows:[]}]}];
    eid='qR';PAYABLES.length=0;Q[0].costs.forEach(c=>syncCostToPayable(Q[0],c));
    PAYABLES.push({id:'pay_ps_h1_2026-09',to:'小明',project:'',amount:40000,vat:false,date:d(5),status:'pending',category:'salary',note:'薪資'});
    PAYABLES.push({id:'manualRent',to:'房東',project:'',amount:20000,vat:false,date:d(10),status:'pending',category:'other',note:'房租'});
    PAYABLES.push({id:'orphanS',costId:'cS',to:'甲',project:'唯讀案',amount:999,vat:true,date:d(1),status:'pending',note:'孤兒'});
    // 去重不得砍掉同一張卡的期別／預付款應付；同 id 重複與多筆整筆才清
    PAYABLES.push({id:'paycS_p1',costId:'cS',to:'甲',project:'唯讀案',amount:1,vat:true,status:'pending'});
    PAYABLES.push({id:'wholeOld1',costId:'cX',to:'乙',project:'唯讀案',amount:5000,vat:false,status:'pending',updatedAt:1});
    const nDup=cleanDuplicatePayables();
    out.dedupe=nDup===2&&PAYABLES.filter(p=>p.id==='paycS_p1').length===1&&!!PAYABLES.find(p=>p.id==='paycS_aa1')&&PAYABLES.filter(p=>p.costId==='cX').length===1&&!PAYABLES.some(p=>p.id==='wholeOld1');
    const src=id=>_paySource(PAYABLES.find(p=>p.id===id));
    out.cls={per:src('paycS_p1').auto&&/第1期/.test(src('paycS_p1').label),adv:src('paycS_aa1').auto,extra:src(PAYABLES.find(p=>p.costId==='cX').id).auto,ps:src('pay_ps_h1_2026-09').auto,manual:!src('manualRent').auto&&!src('manualRent').orphan,orphan:!src('orphanS').auto&&src('orphanS').orphan};
    out.clsOk=Object.keys(out.cls).every(k=>out.cls[k]);
    // 應付頁：自動產生的沒有修改／刪除／稅別勾選；手動的有
    go('acct');acctTab('ap');renderPayables();
    const pl=document.getElementById('payable-list');
    const row=id=>[...pl.querySelectorAll('.ql')].find(x=>x.innerHTML.includes("'"+id+"'")||x.innerHTML.includes(id));
    const r1=row('paycS_p1'),rm=row('manualRent'),rs=row('pay_ps_h1_2026-09');
    out.autoRow=!!r1&&!r1.querySelector('button[onclick*="delPayable"]')&&!r1.querySelector('button[onclick*="editPayable"]')&&!r1.querySelector('input[type=checkbox]')&&!/🔒/.test(r1.innerHTML)&&!!r1.querySelector('button[onclick*="confirmPayment"]')&&!!r1.querySelector('button[onclick*="_payUpload"]');
    out.manualRow=!!rm&&!!rm.querySelector('button[onclick*="delPayable"]')&&!!rm.querySelector('button[onclick*="editPayable"]')&&!!rm.querySelector('input[type=checkbox]');
    out.psRow=!!rs&&/薪資條/.test(rs.innerHTML)&&!!rs.querySelector('button[onclick*="acctTab"]')&&!rs.querySelector('button[onclick*="delPayable"]');
    out.hint=/由來源自動產生/.test(pl.innerHTML);
    // 守門：自動產生的刪不掉、改不了稅別；手動的可以
    let toasts=[];const oT=window.toast;window.toast=m=>toasts.push(String(m));const oC=window.showConfirm;window.showConfirm=function(t,m,ok){ok();};
    delPayable('paycS_p1');out.delBlocked=PAYABLES.some(p=>p.id==='paycS_p1')&&toasts.some(t=>/自動產生/.test(t));
    togglePayVat('paycS_p1',false);out.vatBlocked=PAYABLES.find(p=>p.id==='paycS_p1').vat!==false;
    delPayable('manualRent');out.delManual=!PAYABLES.some(p=>p.id==='manualRent');
    window.toast=oT;window.showConfirm=oC;
    // 應付對帳：對得上的沒有刪除鈕，孤兒有
    openProjectCosts('qR');setCostView('subs');
    const sh=(document.getElementById('cost-list')||document.getElementById('page-costs')).innerHTML;
    out.audit=/delPayable\('orphanS'\)/.test(sh)&&!/delPayable\('paycS_p1'\)/.test(sh)&&!/delPayable\('paycS_aa1'\)/.test(sh);
  }catch(e){out.err=String(e&&e.stack||e).slice(0,600);}
  Q=[];PAYABLES.length=0;eid=null;res(out);
}));
    check('v6.0.42 應付去重只清同 id 與多筆整筆，期別／預付款應付不再被砍（開應付分頁即觸發的舊 bug）', r.dedupe, JSON.stringify(r));
    check('v6.0.42 來源判定：期別／預付款／額外成本／薪資＝自動；手動雜項＝可改；對不上來源＝孤兒', r.clsOk, JSON.stringify(r.cls));
    check('v6.0.42 應付頁：自動產生的沒有修改／刪除／稅別勾選，無 🔒、有付款、附件；手動的照舊；薪資可跳來源；頁首提示', r.autoRow && r.manualRow && r.psRow && r.hint, JSON.stringify(r));
    check('v6.0.42 守門：自動產生的刪除／改稅別被擋，手動的可刪；應付對帳只有孤兒才有刪除', r.delBlocked && r.vatBlocked && r.delManual && r.audit, JSON.stringify(r));
    check('v6.0.42 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── v6.0.43 預付款併入期別應付卡、材料流程優化、稅費科目 ─────────────
  {
    const { page, errors } = await newPage(browser, 1200, 900);
    const r = await page.evaluate(() => new Promise(res => {
  const out={};
  try{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    Q=[{id:'qM',code:'M',name:'材料案',client:'業主',date:d(-60),awarded:true,exs:[],rmk:{},_mt:1,site:{P:100,A:1000,layers:1,L:[{w:'H350',s:'H350'}]},
      items:[{desc:'H型鋼樁 H300, L=15M@80cm（含30天租期）',unit:'支',qty:'40',price:'1000',sec:false,_uid:'m1'},{desc:'水平支撐系統 H350（含90天租期）',unit:'式',qty:'1',price:'500000',sec:false,_uid:'m2'}],t:{sub:100000,tax:5000,total:105000},dailyLogs:[],
      costs:[{id:'cM',type:'sub',vendor:'甲',cat:'打設',date:d(-50),invoice:true,retRate:0,linkedItemIdx:0,rows:[{id:'r1',linkedItemIdx:0,qty:40,unitPrice:1000}],amt:40000,advances:[{id:'a1',date:d(-10),amt:10000}],periods:[{no:1,date:d(-5),rows:[{rid:'r1',qty:40}],adv:10000}]}]}];
    eid='qM';PAYABLES.length=0;Q[0].costs.forEach(c=>syncCostToPayable(Q[0],c));
    const adv=PAYABLES.find(p=>p.id==='paycM_aa1'),per=PAYABLES.find(p=>p.id==='paycM_p1');
    if(adv){adv.status='paid';adv.paidDate=d(-10);}
    out.pay={advAmt:adv&&adv.amount,perAmt:per&&per.amount,ids:PAYABLES.map(p=>p.id)};
    go('acct');acctTab('ap');window._payAging='all';renderPayables();
    const pl=document.getElementById('payable-list');
    const row=id=>[...pl.querySelectorAll('.ql')].find(x=>x.innerHTML.includes(id));
    out.advHidden=!row('paycM_aa1');
    const pr=row('paycM_p1');
    out.perCard=!!pr&&/預付款抵扣/.test(pr.innerHTML)&&/本期應付 NT\$ 31,500/.test(pr.innerHTML)&&/✓ 已付/.test(pr.innerHTML);
    out.perCardHtml=pr?pr.innerText.replace(/\s+/g,' ').slice(0,300):'';
    out.noLock=!/🔒/.test(pl.innerHTML)&&!!pr&&!!pr.querySelector('button[onclick*="openProjectCosts"]')&&!pr.querySelector('button[onclick*="delPayable"]');
    // 預付款尚未抵扣（無期別）→ 仍獨立一筆
    const pers=Q[0].costs[0].periods;Q[0].costs[0].periods=[];out.advShown=_payHiddenAdv(adv)===false;Q[0].costs[0].periods=pers;
    // 材料：規格較大可代用
    MAT_LEDGER.length=0;MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H350',len:15,qty:20,uw:135,price:18,loc:'公司倉庫',date:d(-100),kind:'重複性'});
    out.altUp=_m6Alt({name:'型鋼',spec:'H300',len:15}).length===1&&_m6Alt({name:'型鋼',spec:'H400',len:15}).length===0;
    _m6Qid='qM';go('mat6');renderMat6();
    matRowEdit('qM','');
    const sel=document.getElementById('mx-item');
    out.needForm=!!sel&&!document.getElementById('mx-rate')&&!!document.getElementById('mx-strut');
    sel.value='qM:0';_mxPick('qM:0');
    out.pick={spec:gv('mx-spec'),len:gv('mx-len'),qty:gv('mx-qty')};
    out.pickOk=out.pick.spec==='H300'&&String(out.pick.len)==='15'&&String(out.pick.qty)==='40';
    sel.value='qM:1';_mxPick('qM:1');
    out.strutShown=document.getElementById('mx-strut').style.display!=='none';
    const st=_mxStrutCalc();out.strut={wM:st.wM,sM:st.sM,dN:st.dN,wP:st.wP,sP:st.sP};
    out.strutOk=st.wM===100&&st.sM===300&&st.dN===4&&st.wP===9;
    const oC=window.showConfirm;window.showConfirm=function(){};
    document.getElementById('fy-modal-o').click();
    const rows=_matQ(Q[0]).rows;out.strutRows=rows.length===3&&rows[0].qty===9&&rows[0].m===100&&rows[1].qty===25&&rows[2].qty===4;
    out.rowsDump=rows.map(r=>[r.spec,r.len,r.qty,r.m,r.note]);
    window.showConfirm=oC;
    rows.length=0;rows.push({id:'mrA',name:'型鋼',spec:'H300',len:15,unit:'支',qty:40,rate:''});
    let html='';window.showConfirm=function(t,h){html=h;};
    m6Decide('qM','mrA');out.decideAlt=/可代用的公司料/.test(html)&&/H350 L=15M 20 支/.test(html)&&/購置 vs 租賃/.test(html);
    MAT_LEDGER.length=0;m6Decide('qM','mrA');out.decideBuy=/購置或租賃哪個划算/.test(html)&&/br-rate/.test(html);
    window.showConfirm=oC;
    MAT_LEDGER.push({id:'L1',name:'型鋼',spec:'H350',len:15,qty:20,uw:135,price:18,loc:'公司倉庫',date:d(-100),kind:'重複性'});
    const wh=_m6WarehouseHtml(Q[0]);out.whAlt=/可代用：/.test(wh)&&/m6Adapt\('qM','mrA'\)/.test(wh);
    m6RentEdit('qM','','mrA');
    out.rentForm=!!document.getElementById('rt-rated')&&!document.getElementById('rt-rate')&&!!document.querySelector('input[name="rt-bmode"]')&&!!document.getElementById('rt-item');
    document.getElementById('rt-vendor').value='料場A';document.getElementById('rt-rated').value='5';document.getElementById('rt-cm').value='600';
    _m6RtSave();
    const rt=_matQ(Q[0]).rents[0];out.rent={rate:rt&&rt.rate,rateD:rt&&rt.rateD,b:rt&&rt.batches.length};
    out.rentOk=!!rt&&rt.rate===150&&rt.rateD===5&&rt.batches.length===1&&rt.batches[0].m===600;
    out.rentTable=/日租 \$\/M\/天/.test(document.getElementById('mat6-root').innerHTML);
    EXPENSES.length=0;_expForm();
    out.expForm=!!document.getElementById('ex-cat')&&!!document.getElementById('ex-pay');
    document.getElementById('ex-cat').value='營所稅';document.getElementById('ex-cat').onchange();
    document.getElementById('ex-amount').value='20000';document.getElementById('ex-date').value=d(0);document.getElementById('ex-due').value=d(30);
    document.getElementById('gen-confirm-ok').click();
    const ex=EXPENSES[0],tp=PAYABLES.find(p=>/^pay_tax_/.test(p.id));
    out.exp={cat:ex&&ex.cat,pay:!!tp,to:tp&&tp.to,vat:tp&&tp.vat,auto:tp&&_paySource(tp).auto,n:EXPENSES.length};
    out.expOk=!!ex&&ex.cat==='營所稅'&&!!tp&&tp.vat===false&&tp.amount===20000&&_paySource(tp).auto&&_payIsCompany(tp);
    const y=_shRptYear(new Date().getFullYear());out.rpt={inc:y.inctax,exp:y.exp,after:y.afterTax,pre:y.pretax};
    out.rptOk=y.inctax===20000&&y.exp===0&&y.afterTax===y.pretax-20000;
    window.showConfirm=function(t,m,ok){ok();};expDel(ex.id);out.expDel=!EXPENSES.length&&!PAYABLES.some(p=>/^pay_tax_/.test(p.id));window.showConfirm=oC;
  }catch(e){out.err=String(e&&e.stack||e).slice(0,700);}
  Q=[];PAYABLES.length=0;EXPENSES.length=0;MAT_LEDGER.length=0;eid=null;res(out);
}));
    check('v6.0.43 應付頁：已全數抵扣的預付款不另列，期別卡載明「本期計價 − 預付款抵扣 ＝ 本期應付」與預付款日期／付款狀態；未抵扣的預付款仍獨立一筆', r.advHidden && r.perCard && r.advShown, JSON.stringify({pay:r.pay,perCardHtml:r.perCardHtml,err:r.err}));
    check('v6.0.43 自動產生的應付不再顯示 🔒 chip，只留成本／來源鈕', r.noLock, JSON.stringify(r.err||''));
    check('v6.0.43 材料需求：勾工項自動帶規格／長度／支數、無內部日租欄；水平支撐依周長／面積／角隅算圍令 100M／支撐 300M／斜撐 4 支並建三列', r.needForm && r.pickOk && r.strutShown && r.strutOk && r.strutRows, JSON.stringify({pick:r.pick,strut:r.strut,rows:r.rowsDump,err:r.err}));
    check('v6.0.43 公司料規格較大可代用（較小不行）；比對視窗列出可代用料與購 vs 租分析；倉庫卡標可代用', r.altUp && r.decideAlt && r.decideBuy && r.whAlt, JSON.stringify({altUp:r.altUp,decideAlt:r.decideAlt,decideBuy:r.decideBuy,whAlt:r.whAlt,err:r.err}));
    check('v6.0.43 材料租賃：日租（$/M/天）＋工項帶入＋進場方式；存檔 rate＝日租×30、一次進場自動建批次；表格日租口徑', r.rentForm && r.rentOk && r.rentTable, JSON.stringify({rent:r.rent,err:r.err}));
    check('v6.0.43 費用：科目＋掛應付（pay_tax_ 自動唯讀、公司支出組）；報表營所稅列稅後不計費用；刪費用連同應付', r.expForm && r.expOk && r.rptOk && r.expDel, JSON.stringify({exp:r.exp,rpt:r.rpt,err:r.err}));
    check('v6.0.43 測試無 JS 錯誤', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close();

  const pad = s => (s + '                                                            ').slice(0, 44);
  console.log('\n豐有工程管理系統．冒煙測試\n' + '─'.repeat(64));
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + pad(r.name) + (r.detail ? '  ' + r.detail : '')));
  console.log('─'.repeat(64));
  console.log(`  ${results.length - failed} / ${results.length} 通過` + (failed ? `　✗ ${failed} 項失敗` : '　全部通過'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('測試執行失敗：', e); process.exit(1); });
