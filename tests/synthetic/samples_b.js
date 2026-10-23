// 合成樣本 B：損益口徑、金流預測、抽成佣金、報表口徑、發票與結算（全部假資料；目前都是健檢 1 指出、還沒修的現況）
// run 在瀏覽器頁面裡執行（不能引用外面的變數）；回傳的數字就是要比對的值
module.exports = [
  {
    id: 'B08', items: [8], status: '現況',
    title: '保留款退還後年度營收倒扣：未稅 100,000、保留 10%',
    hand: '應為退還前後營收都是 100,000；現況退還後變 90,000（分潤上限同步變低）',
    run: async () => {
      const inv = { id: 'iB08', project: '範例工程B08', client: '甲營造', periodNo: 1, date: '2026-05-10', retention: true, retentionPct: 10,
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); INV.push(inv);
      const before = _shRptYear(2026).revNet, shBefore = _shareAutoCalc('2026').rev;
      inv.retentionReturned = true;
      const after = _shRptYear(2026).revNet, shAfter = _shareAutoCalc('2026').rev;
      return { invTotal: Math.round(inv.totals.total), revNetBefore: before, revNetAfter: after, shareRevBefore: shBefore, shareRevAfter: shAfter };
    }
  },
  {
    id: 'B09', items: [9], status: '現況',
    title: '分包成本認列：2026-12 簽約發包 800,000，2027-01 才計價 400,000',
    hand: '應為 2026 年 0、2027 年 400,000（依計價期別）；現況 2026 年 800,000、2027 年 0',
    run: async () => {
      Q = [{ id: 'qB09', name: '範例工程B09', client: '甲營造', date: '2026-11-01', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 1000, price: 1000 }],
        costs: [{ id: 'cB09', type: 'sub', vendor: '乙工程行', date: '2026-12-05', amt: 800000, rows: [{ id: 'r1', linkedItemIdx: 0, qty: 1000, unitPrice: 800 }],
          periods: [{ no: 1, date: '2027-01-10', rows: [{ rid: 'r1', qty: 500 }] }] }] }];
      return { cost2026: _shRptYear(2026).cost, cost2027: _shRptYear(2027).cost, share2026: _shareAutoCalc('2026').cost, share2027: _shareAutoCalc('2027').cost };
    }
  },
  {
    id: 'B10', items: [10], status: '現況',
    title: '年度損益與分潤沒扣業務抽成 2,000、業主端佣金 3,000（已全額收款）',
    hand: '應為稅前淨利 100,000−5,000＝95,000（再扣已計提的抽成＋佣金）；現況有沒有抽成佣金都是 100,000，分潤 80,000',
    run: async () => {
      SHARE_SALARY_MONTH = 0;   // 不推估薪資，讓稅前淨利只看營收與成本
      P.sales = [{ id: 'sB10', name: '業務甲', kind: 'staff', commMode: 'amt', commVal: 2000, active: true }];
      Q = [{ id: 'qB10', name: '範例工程B10', client: '甲營造', date: '2026-04-01', awarded: true, salesId: 'sB10', items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }], t: { sub: 100000, tax: 5000, total: 105000 },
        comms: [{ id: 'c1', name: '主任乙', role: '工地主任', mode: 'amt', val: 3000 }] }];
      const inv = { id: 'iB10', quoteId: 'qB10', sourceQid: 'qB10', project: '範例工程B10', client: '甲營造', periodNo: 1, date: '2026-05-10',
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); inv.received = Math.round(inv.totals.total); inv.receivedDate = '2026-06-10'; inv.receivedConfirmed = true; INV.push(inv);
      const withComm = _shRptYear(2026), shWith = _shareAutoCalc('2026');
      const salesAccr = _salesCommAccr(Q[0]), commAccr = _commList(Q[0]).reduce((a, c) => a + _commAccrFor(Q[0], _salesCommNorm(c)), 0);
      Q[0].salesId = ''; Q[0].comms = [];
      const noComm = _shRptYear(2026), shNo = _shareAutoCalc('2026');
      return { salesAccr, commAccr, pretaxWith: Math.round(withComm.pretax), pretaxWithout: Math.round(noComm.pretax), shareNetWith: shWith.netProfit, shareNetWithout: shNo.netProfit };
    }
  },
  {
    id: 'B11', items: [11], status: '現況',
    title: '清潔費「業主開立」模式：請款未稅 100,000、清潔費 10‰，已收款',
    hand: '應為營收 100,000－清潔費 1,000＝99,000；現況營收先扣一次（99,000）、費用再記一次 1,000 → 98,000',
    run: async () => {
      const inv = { id: 'iB11', project: '範例工程B11', client: '甲營造', periodNo: 1, date: '2026-05-10', cleanPermil: 10, cleanMode: 'exp',
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); inv.received = Math.round(inv.totals.total); inv.receivedDate = '2026-06-10'; inv.receivedConfirmed = true; INV.push(inv);
      _cleanExpenseSync(inv);
      const d = _shRptYear(2026);
      const ce = (EXPENSES || []).find(e => e && e.src === 'clean');
      return { invTotal: Math.round(inv.totals.total), revNet: d.revNet, exp: d.exp, cleanExpense: ce ? ce.amount : null, revMinusExp: d.revNet - d.exp };
    }
  },
  {
    id: 'B12', items: [12], status: '現況',
    title: '90 天金流預測：合約 105,000（打設＋拔除 100M×1000），第 1 期打設 70%、保留款 10%，日報進度 100%',
    hand: '應為未來流入合計 105,000（含保留款回收）；現況 112,350（已請用扣保留款後金額、保留款又算一次，打設 70% 當完工）',
    run: async () => {
      Q = [{ id: 'qB12', name: '範例工程B12', client: '甲營造', date: '2026-09-01', awarded: true, items: [{ desc: 'H型鋼 打設、拔除', unit: 'M', qty: 100, price: 1000 }], t: { sub: 100000, tax: 5000, total: 105000 },
        dailyLogs: [{ id: 'dB12', date: '2026-10-05', progressRows: [{ itemIdx: 0, qty: 100 }] }] }];
      CONTRACTS.push({ id: 'cB12', name: '範例工程B12', linkedQid: 'qB12', amount: 105000, status: 'active' });
      const inv = { id: 'iB12', quoteId: 'qB12', sourceQid: 'qB12', project: '範例工程B12', client: '甲營造', periodNo: 1, date: '2026-10-10', retention: true, retentionPct: 10,
        items: [{ type: 'item', desc: 'H型鋼 打設、拔除', cat: 'both', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 70 }] };
      _recalcInvAmounts(inv); INV.push(inv);
      window._availableCash = () => 0; window._hrMonthlyCost = () => 0; P.fixedCosts = [];
      let el = document.getElementById('cashflow-forecast'); if (!el) { el = document.createElement('div'); el.id = 'cashflow-forecast'; document.body.appendChild(el); }
      renderCashForecast();
      const m = el.textContent.match(/90天後\s*NT\$\s*([\d,\-]+)/);
      return { invTotal: Math.round(inv.totals.total), retention: _invRetention(inv), forecastInflow90: m ? parseInt(m[1].replace(/,/g, '')) : null };
    }
  },
  {
    id: 'B21', items: [21], status: '現況',
    title: '得標當天抽成 2,000、佣金 3,000 應付就是全額，付款日照得標日推算（尚未收款）',
    hand: '應為依實收款進度產生（尚未收款＝0）；現況得標即全額 2,000／3,000，付款日落在得標日次月',
    run: async () => {
      P.sales = [{ id: 'sB21', name: '業務甲', kind: 'staff', commMode: 'amt', commVal: 2000, active: true }];
      Q = [{ id: 'qB21', name: '範例工程B21', client: '甲營造', date: '2026-08-01', awarded: true, salesId: 'sB21', items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }], t: { sub: 100000, tax: 5000, total: 105000 },
        comms: [{ id: 'c1', name: '主任乙', role: '工地主任', mode: 'amt', val: 3000 }] }];
      _salesCommSync(Q[0]); _commSync(Q[0]);
      const ps = PAYABLES.find(p => p.id === 'pay_sales_qB21'), pc = PAYABLES.find(p => p.id === 'comm_qB21_c1');
      return { salesPay: ps ? ps.amount : null, salesDate: ps ? ps.date : null, commPay: pc ? pc.amount : null, commDate: pc ? pc.date : null, salesAccrued: _salesCommAccr(Q[0]) };
    }
  },
  {
    id: 'B22', items: [22], status: '現況',
    title: '股東報表口徑：未稅 100,000、保留款 10%、成本 60,000；摘要毛利（未稅）與各案毛利（含稅）、請款金額（扣保留款後）',
    hand: '應為同一口徑（未稅毛利 40,000）；現況摘要毛利 40,000（未稅）但各案毛利 105,000−60,000×1.05＝42,000（含稅），請款金額 94,500（已扣保留款）',
    run: async () => {
      Q = [{ id: 'qB22', name: '範例工程B22', client: '甲營造', date: '2026-04-01', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }], t: { sub: 100000, tax: 5000, total: 105000 },
        costs: [{ id: 'cB22', type: 'own', vendor: '', cat: '工項材料', date: '2026-05-01', amt: 60000, rows: [{ id: 'r1', desc: '材料', qty: 1, unit: '式', unitPrice: 60000 }] }] }];
      CONTRACTS.push({ id: 'cB22', name: '範例工程B22', linkedQid: 'qB22', amount: 105000, status: 'active' });
      const inv = { id: 'iB22', quoteId: 'qB22', sourceQid: 'qB22', project: '範例工程B22', client: '甲營造', periodNo: 1, date: '2026-05-10', retention: true, retentionPct: 10,
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); INV.push(inv);
      const d = _shRptYear(2026), p = d.projs[0];
      return { revTax: d.revTax, revNet: d.revNet, grossSummary: d.gross, projBase: p ? Math.round(p.st.base) : null, projProfit: p ? Math.round(p.st.profit) : null, bidWonAmt: d.bid ? Math.round(d.bid.wonAmt) : null };
    }
  },
  {
    id: 'B23', items: [23], status: '現況',
    title: '公司費用：會計師費 21,000（含進項稅 1,000）、營業稅 5,000',
    hand: '應為費用 20,000（未稅）；現況年度損益記 21,000；分潤把營業稅 5,000 也當費用（26,000），股東報表排除 → 兩邊不同',
    run: async () => {
      EXPENSES.push({ id: 'eB23a', date: '2026-03-10', seller: '甲會計師事務所', cat: '會計師費', amount: 21000, tax: 1000 }, { id: 'eB23b', date: '2026-03-15', seller: '國稅局', cat: '營業稅', amount: 5000, tax: 0 });
      return { shRptExp: _shRptYear(2026).exp, shareExp: _shareAutoCalc('2026').exp };
    }
  },
  {
    id: 'B24', items: [24], status: '現況',
    title: '報價淨利率：未稅 100,000、成本 80,000',
    hand: '應為 20.0%（未稅收入）；現況 23.8%（含稅收入 105,000 − 未稅成本）',
    run: async () => {
      items = [{ desc: '鋼板樁', unit: 'M', qty: '100', price: '1000', estCost: '800', note: '', sec: false }]; exs = [];
      const t = calcT();
      const q = { id: 'qB24', items: JSON.parse(JSON.stringify(items)), exs: [], t: { sub: 100000, tax: 5000, total: 105000 } };
      const r = _quoteEstNetR(q);
      items = []; exs = [];
      return { calcTNetR: Math.round(t.netR * 1000) / 10, estNetR: r == null ? null : Math.round((r > 1 ? r : r * 100) * 10) / 10 };
    }
  },
  {
    id: 'B25', items: [25], status: '現況',
    title: '開立發票帶入金額：未稅 100,000、清潔費 10‰「折讓」模式',
    hand: '應為本期發票應開金額 105,000（稅 5,000）；現況帶入 103,950（清潔費被扣掉）、稅額寫死 ÷1.05',
    run: async () => {
      const inv = { id: 'iB25', project: '範例工程B25', client: '甲營造', periodNo: 1, date: '2026-05-10', cleanPermil: 10, cleanMode: 'allow',
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); INV.push(inv);
      issueInvoiceForInv('iB25');
      const a = parseFloat(document.getElementById('ir-amount').value) || 0, t = parseFloat(document.getElementById('ir-tax').value) || 0;
      const m = document.getElementById('invoice-rec-modal'); if (m) m.style.display = 'none';
      return { invTotal: Math.round(inv.totals.total), irAmount: Math.round(a), irTax: Math.round(t) };
    }
  },
  {
    id: 'B26', items: [26], status: '現況',
    title: '竣工結算：合約 105,000、請款未稅 100,000（全量）、清潔費 10‰',
    hand: '應為結算 105,000（清潔費不是追減）；現況結算成 103,950',
    run: async () => {
      Q = [{ id: 'qB26', name: '範例工程B26', client: '甲營造', date: '2026-04-01', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }], t: { sub: 100000, tax: 5000, total: 105000 } }];
      CONTRACTS.push({ id: 'cB26', name: '範例工程B26', linkedQid: 'qB26', amount: 105000, status: 'active' });
      const inv = { id: 'iB26', quoteId: 'qB26', sourceQid: 'qB26', project: '範例工程B26', client: '甲營造', periodNo: 1, date: '2026-05-10', cleanPermil: 10, cleanMode: 'net',
        items: [{ type: 'item', desc: '鋼板樁', unit: 'M', contractPrice: 1000, contractQty: 100, curQty: 100, payRate: 100 }] };
      _recalcInvAmounts(inv); INV.push(inv);
      settleContract('cB26'); __synOk(); __synOk();
      return { invTotal: Math.round(inv.totals.total), contractAfter: Math.round(CONTRACTS[0].amount), status: CONTRACTS[0].status };
    }
  }
];
