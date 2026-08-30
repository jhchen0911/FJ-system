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

  // ───────────── 5. 備份完整性 ─────────────
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

  await browser.close();

  const pad = s => (s + '                                                            ').slice(0, 44);
  console.log('\n豐有工程管理系統．冒煙測試\n' + '─'.repeat(64));
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + pad(r.name) + (r.detail ? '  ' + r.detail : '')));
  console.log('─'.repeat(64));
  console.log(`  ${results.length - failed} / ${results.length} 通過` + (failed ? `　✗ ${failed} 項失敗` : '　全部通過'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('測試執行失敗：', e); process.exit(1); });
