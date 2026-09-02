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
    check('版本號存在且為 v5.x', /^v5\.\d+$/.test(info.version), info.version);
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
      // 全域搜尋：找得到且不誤報
      Q = [{ id: 'q1', name: '中和廠房擋土支撐', code: '115001', client: '大山營造', items: [], exs: [], t: { total: 1 }, _mt: 1 },
      { id: 'q2', name: '新莊基礎工程', code: '115002', client: '久大建設', items: [], exs: [], t: { total: 1 }, _mt: 1 }];
      INV = []; CONTRACTS = []; CUSTOMERS = []; VENDORS = [];
      openGlobalSearch();
      document.getElementById('gsearch-inp').value = '中和'; runGlobalSearch();
      const st = document.getElementById('gsearch-body').textContent;
      out.gsearch = st.indexOf('中和廠房') >= 0 && st.indexOf('新莊') < 0;
      closeGlobalSearch();
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
    check('全域搜尋找得到且不誤報', r.gsearch);
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
    await page.evaluate(() => go('projects'));
    await page.waitForTimeout(700);
    const r2 = await page.evaluate(() => {
      const h = document.getElementById('page-projects').innerHTML;
      return { recvBtns: (h.match(/openReceiptModal\(/g) || []).length, paidChip: /已收</.test(h) };
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
    check('專案管理每一未收期都有收款鈕', r2.recvBtns === 3, '得到 ' + r2.recvBtns);
    check('已收款期別顯示已收、不出現收款鈕', r2.paidChip);
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
    await page.evaluate(() => go('projects'));
    await page.waitForTimeout(700);
    const r3 = await page.evaluate(() => ({
      viewQuote: document.body.innerHTML.includes('查看報價PDF'),
      chipView: /查看第1期請款單/.test(document.body.innerHTML),
      chipDue: /預計收款 \d{4}-\d{2}-\d{2}/.test(document.body.innerHTML),
    }));
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
    check('報價鈕改為查看、期別鈕帶預計收款日', r3.viewQuote && r3.chipView && r3.chipDue,
          JSON.stringify(r3));
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
        && /不含稅/.test(document.getElementById('award-ref-mode').innerHTML);
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
      out.contiguous = plan.pages[0].s === 0 && plan.pages[plan.pages.length - 1].e === H
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
      const Z = (name, deck, v, h) => ({
        name, deck,
        v: { runs: v[0], rows: v[1].map(x => ({ n: x[0], len: x[1] })) },
        h: { runs: h[0], rows: h[1].map(x => ({ n: x[0], len: x[1] })) },
      });
      // ① 原 Excel「工作表1」：縱向 279.1＋橫向 289.4＋周長 207 ＝ 775.5 m
      Object.assign(_llState, {
        perim: 207, perimRuns: 1, layers: 1, deductLayers: 1, unit: 'cm',
        useSpare: false, spare: 0, waste: 0, reelLen: 200, clips: 8, turn: 1, shackle: 2,
        zones: [Z('第一區', false, [7, [[2, 5650], [2, 4830], [2, 2590], [1, 1770]]],
                                   [9, [[3, 4575], [1, 3925], [4, 2425], [1, 1590]]]),
                Z('構台下', true, [0, [[0, 0]]], [0, [[0, 0]]])],
      });
      let c = _llCalc();
      out.sheet1 = c.zones[0].v.len === 279.1 && c.zones[0].h.len === 289.4
        && c.zoneLen === 568.5 && c.net === 775.5;
      // ② 原 Excel「多區塊(轉換檔)」：縱橫 2973.75、構台下 849、3 層扣一層 ＝ 9275.25 m
      _llState.perim = 401; _llState.layers = 3; _llState.deductLayers = 1;
      _llState.zones = [
        Z('第一區', false, [9, [[2, 4693], [7, 5112]]], [8, [[8, 5943]]]),
        Z('第二區', false, [9, [[9, 5112]]], [8, [[6, 5512], [2, 4579]]]),
        Z('第三區', false, [7, [[7, 3217]]], [5, [[5, 4573]]]),
        Z('第四區', false, [9, [[5, 3217], [3, 2746], [1, 2591]]], [5, [[1, 3397], [1, 5292], [3, 5512]]]),
        Z('轉換檔', false, [1, [[1, 8600]]], [1, [[1, 10300]]]),
        Z('構台下', true, [11, [[6, 6400], [5, 1300]]], [19, [[16, 1300], [3, 6400]]])];
      c = _llCalc();
      out.multi = c.zoneLen === 2973.75 && c.deckLen === 849
        && c.perLayer === 3374.75 && c.gross === 10124.25 && c.net === 9275.25;
      out.noBad = c.bad.length === 0;                       // 各方向宣告路數與明細相符
      // ③ 路數勾稽：宣告與明細不符要抓出來
      _llState.zones[0].v.runs = 99;
      out.catches = _llCalc().bad.join('') === '第一區 縱向';
      _llState.zones[0].v.runs = 9;
      // ④ 端部預留與損耗：(9275.25＋159路×1.5)×1.05
      _llState.useSpare = true; _llState.spare = 1.5; _llState.waste = 5;
      c = _llCalc();
      out.runs = c.runs === 159;                            // (63路×3層)−(30路×1層)
      out.need = Math.abs(c.need - (9275.25 + 238.5) * 1.05) < 1e-6;
      out.reels = c.reels === Math.ceil(c.need / 200);
      // ⑤ 匯出：Excel 必須是活公式、列印走統一引擎
      let sheets = null, printed = null;
      const oX = window.xlsxDownload, oP = window._printViaIframe;
      window.xlsxDownload = (f, s) => { sheets = s; };
      window._printViaIframe = h => { printed = h; };
      try { _llXlsx(); _llPrint(); } finally { window.xlsxDownload = oX; window._printViaIframe = oP; }
      const flat = JSON.stringify(sheets || []);
      out.xlsxLive = /"f":"C\d+\*D\d+\*\$B\$6"/.test(flat) && /CEILING\(/.test(flat) && /IF\(F\d+=0/.test(flat);
      out.printOk = !!printed && printed.indexOf('安全母索用量表') > 0 && /母索總長/.test(printed);
      // ⑥ 畫面
      go('lifeline');
      out.rendered = document.getElementById('lifeline-root').innerText.indexOf('母索總長') >= 0;
      return out;
    });
    check('安全母索：單區塊口徑與 Excel 一致', r.sheet1);
    check('安全母索：多區塊＋扣除構台下與 Excel 一致', r.multi && r.noBad);
    check('安全母索：宣告路數與明細不符會被抓出', r.catches);
    check('安全母索：總路數、端部預留與損耗計入需求長度', r.runs && r.need && r.reels);
    check('安全母索：Excel 匯出為活公式、列印走統一引擎', r.xlsxLive && r.printOk);
    check('安全母索：頁面渲染無 JS 錯誤', r.rendered && errors.length === 0, errors.slice(0, 3).join(' | '));
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
