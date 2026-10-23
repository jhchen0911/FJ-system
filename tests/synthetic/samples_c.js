// 合成樣本 C：請款％、逾期租金、日報帶量、分包分段／保留款／期別、介紹費、單價庫、快速支出、列印小數、得標率（全部假資料）
// run 在瀏覽器頁面裡執行（不能引用外面的變數）；回傳的數字就是要比對的值
module.exports = [
  {
    id: 'C16', items: [16], status: '現況',
    title: '拆除％參數設 20：payRate=20 的列，請款％下拉沒有 20% 選項（顯示成 100%），金額卻按 20% 算',
    hand: '正確：下拉應有 20% 且選中；金額 100M×1000×20%＝20,000',
    run: async () => {
      P.removeRate = 20;
      INV.push({ id: 'iC16', project: '範例工程C16', client: '甲營造', periodNo: 2, date: '2026-10-01',
        items: [{ type: 'item', desc: '鋼板樁 打設、拔除', unit: 'M', contractPrice: 1000, contractQty: 100, prevQty: 100, curQty: 100, payRate: 20 }] });
      loadInvoice('iC16');
      const sel = Array.from(document.querySelectorAll('select')).find(s => s.title === '本工項請款比例');
      return { options: sel ? Array.from(sel.options).map(o => o.value) : null, shown: sel ? sel.value : null, rowAmt: _invRowAmt(invItems[0]) };
    }
  },
  {
    id: 'C17', items: [17], status: '現況',
    title: '逾期租金（拔除第一天模式）：合約 100 支只打設 80 支，逾期 45 天×20 元，照合約量 100 支收',
    hand: '正確：min(合約 100, 打設 80)＝80 支 × 45 天 × 20＝72,000；現況 100 支＝90,000',
    run: async () => {
      window._itemProgress = () => ({ installLast: '2026-08-01', doneDate: '2026-08-01', last: '2026-08-01', cum: 80, target: 100 });
      const q = { id: 'qC17', name: '範例工程C17', items: [{ desc: '鋼軌樁', unit: '支', qty: 100, price: 500, note: '租期30天', ot: '20', otu: '$/支/天' }] };
      const r = _rentStatus(q, 0, '2026-10-15');
      return r ? { overDays: r.overDays, qty: r.qty, amount: r.amount, expiry: r.expiry } : { r: null };
    }
  },
  {
    id: 'C18', items: [18], status: '現況',
    title: '日報帶入數量：同名工項 A 區 10、B 區 5，兩列都帶 15',
    hand: '正確：A 區 10、B 區 5',
    run: async () => {
      const q = { id: 'qC18', name: '範例工程C18', items: [{ desc: 'H型鋼打設', unit: 'M', qty: 100, price: 1000 }, { desc: 'H型鋼打設', unit: 'M', qty: 50, price: 1200 }],
        dailyLogs: [{ id: 'd1', date: '2026-10-05', progressRows: [{ itemIdx: 0, qty: 10 }, { itemIdx: 1, qty: 5 }] }] };
      return { areaA: _dailyQtyBetween(q, q.items[0].desc, '2026-10-01', '2026-10-31'), areaB: _dailyQtyBetween(q, q.items[1].desc, '2026-10-01', '2026-10-31') };
    }
  },
  {
    id: 'C27', items: [27], status: '現況',
    title: '分段工項（裝設 70%）：裝 40 支×500 後第 2 期請拆 100 支，拆除量超過裝設量照算',
    hand: '第 1 期 40×500×70%＝14,000；正確：拆除最多 40 支 → 40×500×30%＝6,000；現況 100 支＝15,000',
    run: async () => {
      const c = { id: 'cC27', type: 'sub', vendor: '乙工程行', retRate: 0, rows: [{ id: 'r1', qty: 40, unitPrice: 500, stage: 1, inst: 70 }] };
      const p1 = _subPeriodCalc(c, { no: 1, rows: [{ rid: 'r1', qi: 40 }] });
      const p2 = _subPeriodCalc(c, { no: 2, rows: [{ rid: 'r1', qr: 100 }] });
      return { p1Amt: p1.amt, p2Amt: p2.amt };
    }
  },
  {
    id: 'C28', items: [28], status: '現況',
    title: '介紹費「背對背」：主約第 1 期 10/31 計價 50M，業主尚未付款，介紹費應付到期日仍用廠商放款日',
    hand: '介紹費 50×20＝1,000；正確：等業主收款後才到期；現況到期日＝廠商放款日（次月 25 日）',
    run: async () => {
      const main = { id: 'cC28m', type: 'sub', vendor: '乙工程行', retRate: 0, rows: [{ id: 'r1', linkedItemIdx: 0, qty: 100, unitPrice: 500 }], periods: [{ no: 1, date: '2026-10-31', rows: [{ rid: 'r1', qty: 50 }] }] };
      const f = { id: 'cC28f', type: 'sub', vendor: '介紹人丙', isIntro: true, followOf: 'cC28m', introPay: 'b2b', retRate: 0, rows: [{ id: 'fr1', linkedItemIdx: 0, qty: 100, unitPrice: 20 }] };
      const q = { id: 'qC28', name: '範例工程C28', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }], costs: [main, f] };
      Q = [q];
      _subFollowApply(q, main);
      const per = (f.periods || [])[0] || {};
      return { introAmt: per.amt == null ? null : per.amt, introDue: per.due || null, ownerReceived: INV.length };
    }
  },
  {
    id: 'C29', items: [29], status: '現況',
    title: '成交單價庫：備用單價列也寫入、平均不分單位（M 1000、式 50,000 混算）、名稱模糊比對',
    hand: '正確：只取同單位一般工項 → 鋼板樁打設 1,000／M（1 筆）；現況把式 50,000 也平均進去',
    run: async () => {
      DEAL_HIST = [];
      writeDealHist({ id: 'qC29', date: '2026-10-01', client: '甲營造', items: [{ desc: '鋼板樁打設', unit: 'M', qty: 100, price: 1000 }, { desc: '鋼板樁打設', unit: '式', qty: 1, price: 50000, spare: true }, { desc: '鋼板樁打設工程', unit: '式', qty: 1, price: 3000 }] });
      const d = _dealPriceFor('鋼板樁打設');
      return { written: DEAL_HIST.length, avg: d ? d.avg : null, n: d ? d.n : null, unit: d ? d.unit : null };
    }
  },
  {
    id: 'C31', items: [31], status: '現況',
    title: '快速支出：便當單據 1,050 元（含稅）直接記成本 1,050，沒拆稅',
    hand: '推測：單據多為含稅，未稅應為 1,050÷1.05＝1,000；現況成本 1,050',
    run: async () => {
      Q = [{ id: 'qC31', name: '範例工程C31', items: [], costs: [] }];
      _qcPending = [{ id: 'x1', ti: 1, amt: '1050', proj: 'qC31', note: '' }];
      submitQuickCost();
      const c = (Q[0].costs || [])[0];
      return { costAmt: c ? c.amt : null, costType: c ? c.type : null };
    }
  },
  {
    id: 'C32', items: [32], status: '現況',
    title: '報價列印：兩列 1.5×333（各 499.5）各自四捨五入印 500，列加總 1,000 和小計 999 差 1 元',
    hand: '小計 1.5×333×2＝999；列印每列 500，加總 1,000',
    run: async () => {
      items = [{ desc: '支撐架設', unit: 'M', qty: '1.5', price: '333', note: '', sec: false }, { desc: '支撐拆除', unit: 'M', qty: '1.5', price: '333', note: '', sec: false }]; exs = [];
      const t = calcT();
      const q = { id: 'qC32', name: '範例工程C32', items: JSON.parse(JSON.stringify(items)), t: t };
      const box = document.createElement('div'); box.innerHTML = '<table>' + _buildQuoteDocHTML(q).replace(/^[\s\S]*?(<tr)/, '$1') + '</table>';
      const rowAmts = Array.from(box.querySelectorAll('tr')).map(tr => tr.querySelectorAll('td.num-col')[2]).filter(Boolean).map(td => parseFloat(td.textContent.replace(/,/g, ''))).filter(v => !isNaN(v)).slice(0, 2);
      items = []; exs = [];
      return { sub: Math.round(t.sub * 100) / 100, printedRows: rowAmts, printedSum: rowAmts.reduce((a, b) => a + b, 0) };
    }
  },
  {
    id: 'C33', items: [33], status: '現況',
    title: '總計存小數：報價 1 式 29,999.7 → 含稅 31,499.685；請款未稅 29,999 → 總計 31,498.95',
    hand: '正確：存整數 31,500／31,499（或至少開發票帶入時四捨五入）',
    run: async () => {
      items = [{ desc: '雜項', unit: '式', qty: '1', price: '29999.7', note: '', sec: false }]; exs = [];
      const qt = calcT().total;
      items = []; exs = [];
      const inv = { id: 'iC33', items: [{ type: 'item', desc: '雜項', unit: '式', contractPrice: 29999, contractQty: 1, curQty: 1, payRate: 100 }] };
      _recalcInvAmounts(inv);
      return { quoteTotal: Math.round(qt * 1000) / 1000, invTotal: Math.round(inv.totals.total * 1000) / 1000, invTotalIsInt: Number.isInteger(inv.totals.total) };
    }
  },
  {
    id: 'C34', items: [34], status: '現況',
    title: '包商保留款一般／根固分組退還：各 244×10%＝24.4，合計押 49，分組各退 24，永遠掛 1 元',
    hand: '合計 488×10%＝48.8→49；分組各 24.4→24，合計 48；差 1 元',
    run: async () => {
      const c = { id: 'cC34', type: 'sub', vendor: '乙工程行', retRate: 10,
        rows: [{ id: 'g1', qty: 1, unitPrice: 244 }, { id: 'r1', qty: 1, unitPrice: 244, tpl: 'grout' }],
        periods: [{ no: 1, date: '2026-09-30', rows: [{ rid: 'g1', qty: 1 }, { rid: 'r1', qty: 1 }] }] };
      const g0 = _subRetGroups(c);
      c.periods.push({ no: 2, isRet: true, retGrp: 'gen', date: '2026-10-10', amt: g0.gen.held }, { no: 3, isRet: true, retGrp: 'grout', date: '2026-10-10', amt: g0.grout.held });
      const st = _subStat(c);
      return { genHeld0: g0.gen.held, groutHeld0: g0.grout.held, totalRet: st.ret, released: st.released, stillHeld: st.retHeld };
    }
  },
  {
    id: 'C35', items: [35], status: '現況',
    title: '廠商期別日期 9/30 改成 10/31：應付到期日停在 10/25，不跟著改成 11/25',
    hand: '正確：到期日依新期別日期 → 2026-11-25；現況 2026-10-25',
    run: async () => {
      const c = { id: 'cC35', type: 'sub', vendor: '乙工程行', retRate: 0, rows: [{ id: 'r1', qty: 100, unitPrice: 500 }], periods: [{ no: 1, date: '2026-09-30', due: _vendorDueDate('2026-09-30'), rows: [{ rid: 'r1', qty: 10 }] }] };
      const q = { id: 'qC35', name: '範例工程C35', items: [], costs: [c] };
      Q = [q];
      _syncSubPeriodPayables(q, c);
      const p0 = PAYABLES.find(p => p.costId === 'cC35');
      const d0 = p0 ? p0.date : null;
      c.periods[0].date = '2026-10-31'; c.periods[0].due = _vendorDueDate('2026-10-31');
      _syncSubPeriodPayables(q, c);
      const p1 = PAYABLES.find(p => p.costId === 'cC35');
      return { dueBefore: d0, periodDueAfter: c.periods[0].due, payDateAfter: p1 ? p1.date : null };
    }
  },
  {
    id: 'C36', items: [36], status: '現況',
    title: '詢價單付款樣板文字寫裝設 70%，分包列實際裝設％ 60，請款按 60% 算',
    hand: '推測：文字應寫 60%；裝設 10 支×100：文字 70% → 700，實際 60% → 600',
    run: async () => {
      const txt = _payTplTxt('gen', {}, null);
      const row = { id: 'r1', qty: 10, unitPrice: 100, stage: 1, inst: 60 };
      const k = _subPeriodCalc({ id: 'cC36', retRate: 0, rows: [row] }, { no: 1, rows: [{ rid: 'r1', qi: 10 }] });
      return { tplInstPct: parseFloat((txt.match(/請款 (\d+)%/) || [])[1]) || null, rowInstPct: _subInst(row), billed: k.amt };
    }
  },
  {
    id: 'C37', items: [37], status: '現況',
    title: '得標率：得標 1、未得標 1、作廢 1、待回覆 1 → 25%（分母含作廢）；2025 年的得標案進版後日期改成今天，搬到 2026 年',
    hand: '正確：作廢不進分母 → 1/3＝33.3%；進版不應改變統計年度（仍算 2025）',
    run: async () => {
      const list = [{ id: 'a', awarded: true, t: { total: 105000 } }, { id: 'b', bidStatus: 'lost', t: { total: 50000 } }, { id: 'c', bidStatus: 'void', t: { total: 30000 } }, { id: 'd', t: { total: 20000 } }];
      const s = _bidStat(list);
      Q = [{ id: 'qC37', name: '範例工程C37', date: '2025-12-20', awarded: true, ver: 1, items: [{ desc: 'A', unit: 'M', qty: 1, price: 100 }], t: { total: 105 } }];
      bumpQVersion('qC37'); __synOk();
      return { rate: Math.round(s.rate * 10) / 10, n: s.n, wonAmt: s.wonAmt, dateAfterBump: Q.find(q => q.id === 'qC37').date };
    }
  },
  {
    id: 'C39', items: [39], status: '現況',
    title: '請款單改請款％下拉：沒按儲存的本期數量（10→30）也一起寫回存檔',
    hand: '正確：只改請款％，存檔數量仍 10；現況存檔數量變 30',
    run: async () => {
      INV.push({ id: 'iC39', project: '範例工程C39', client: '甲營造', periodNo: 1, date: '2026-10-01',
        items: [{ type: 'item', desc: '鋼軌樁', unit: '支', contractPrice: 1000, contractQty: 100, prevQty: 0, curQty: 10, payRate: 100 }] });
      _recalcInvAmounts(INV[0]);
      loadInvoice('iC39');
      invItems[0].curQty = 30;
      const sel = Array.from(document.querySelectorAll('select')).find(s => s.title === '本工項請款比例');
      if (sel) { sel.value = '70'; sel.dispatchEvent(new Event('change')); }
      const v = INV.find(x => x.id === 'iC39');
      return { savedQty: v.items[0].curQty, savedRate: v.items[0].payRate, savedTotal: Math.round(v.totals.total) };
    }
  }
];
