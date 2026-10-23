// 合成樣本 A：報價↔請款、追加案、已付應付、G／G2 已修的條目（全部假資料）
// run 在瀏覽器頁面裡執行（不能引用外面的變數）；回傳的數字就是要比對的值
module.exports = [
  {
    id: 'A01', items: [1], status: '正確',
    title: '已收款的第 1 期鎖住：改報價單價只改未收款的第 2 期，差額在第 3 期加調整列',
    hand: '單價 1000→1200、第 1 期請 10 支：差額未稅 10×200＝2,000；第 1 期含稅總計維持 10×1000×1.05＝10,500',
    run: async () => {
      Q = [{ id: 'qA01', code: 'A01', name: '範例工程A01', client: '甲營造', date: '2026-10-01', awarded: true, exs: [], rmk: {}, _mt: 1, costs: [], items: [{ desc: '鋼軌樁', unit: '支', qty: 100, price: 1000 }] }];
      const mk = (id, no, rc) => ({ id, sourceQid: 'qA01', quoteId: 'qA01', project: '範例工程A01', client: '甲營造', periodNo: no, date: '2026-10-0' + no, receivedConfirmed: rc, received: rc ? 10500 : '',
        items: [{ type: 'item', desc: '鋼軌樁', unit: '支', contractPrice: 1000, contractQty: 100, prevQty: 0, curQty: 10, payRate: 100 }] });
      INV.push(mk('iA01a', 1, true), mk('iA01b', 2, false)); INV.forEach(v => _recalcInvAmounts(v));
      loadQ('qA01'); items[0].price = 1200; saveQ();
      const i1 = INV.find(x => x.id === 'iA01a'), i2 = INV.find(x => x.id === 'iA01b');
      const diffAmt = _invRepriceDiff(i1, Q[0]);
      const n3 = { id: 'iA01c', sourceQid: 'qA01', quoteId: 'qA01', project: '範例工程A01', client: '甲營造', periodNo: 3, date: '2026-10-09', items: [{ type: 'item', desc: '鋼軌樁', unit: '支', contractPrice: 1200, contractQty: 100, prevQty: 20, curQty: 0, payRate: 100 }] };
      INV.push(n3); loadInvoice('iA01c'); invAddAdjust(); document.getElementById('adj-reason').value = '單價更正'; __synOk();
      const adj = invItems.find(it => it.adjOf === 'iA01a');
      return { p1Price: i1.items[0].contractPrice, p1Total: Math.round(i1.totals.total), p1Locked: _invLocked(i1), p2Price: i2.items[0].contractPrice, p2Total: Math.round(i2.totals.total), diffExcl: diffAmt, adjRow: adj ? adj.curAmt : null };
    }
  },
  {
    id: 'A02', items: [2], status: '正確',
    title: '同名工項分兩區（A 區 1000×100、B 區 1200×50），重存報價後各自保留',
    hand: '合約未稅 100×1000＋50×1300（B 區改價）＝165,000',
    run: async () => {
      Q = [{ id: 'qA02', code: 'A02', name: '範例工程A02', client: '甲營造', date: '2026-10-01', awarded: true, exs: [], rmk: {}, _mt: 1, costs: [],
        items: [{ desc: 'H型鋼打設', unit: 'M', qty: 100, price: 1000 }, { desc: 'H型鋼打設', unit: 'M', qty: 50, price: 1200 }] }];
      INV.push({ id: 'iA02', sourceQid: 'qA02', quoteId: 'qA02', project: '範例工程A02', client: '甲營造', periodNo: 1, date: '2026-10-01',
        items: [{ type: 'item', desc: 'H型鋼打設', contractPrice: 1000, contractQty: 100, curQty: 0 }, { type: 'item', desc: 'H型鋼打設', contractPrice: 1200, contractQty: 50, curQty: 0 }] });
      loadQ('qA02'); items[1].price = 1300; saveQ();
      const iv = INV.find(x => x.id === 'iA02');
      return { rows: iv.items.map(x => x.contractPrice + '×' + x.contractQty), contractExcl: iv.items.reduce((a, x) => a + x.contractPrice * x.contractQty, 0) };
    }
  },
  {
    id: 'A03', items: [3], status: '正確',
    title: '議價尾差：1000M×1000 議到未稅 999,600、含稅 1,050,000；尾差變整數折讓列，請款單照扣',
    hand: '未稅：1,000,000→999,600，單價四捨五入仍 1000，折讓列 −400；含稅：1000×1000＋33,333 議到 1,050,000（未稅 1,000,000）→ 單價 968、32,258 合計 1,000,258，折讓 −258',
    run: async () => {
      P.tax = 5;
      items = [{ desc: '鋼板樁', unit: 'M', qty: '1000', price: '1000', note: '', sec: false }]; exs = [];
      document.querySelector('input[name="ngt-way"][value="whole"]').checked = true;
      document.querySelector('input[name="ngt-mode"][value="excl"]').checked = true; document.getElementById('ngt-target').value = '999600'; applyNegotiate();
      const aE = items.find(it => it.desc === NGT_ADJ_DESC); const subE = calcT().sub, priceE = +items[0].price;
      const qN = { id: 'qA03', items: JSON.parse(JSON.stringify(items)) };
      const ivRows = _invItemsFromQuote(qN); const ivAdj = ivRows.find(it => it.desc === NGT_ADJ_DESC);
      const inv = { id: 'iA03', items: ivRows.map(it => Object.assign({}, it, { curQty: it.contractQty, payRate: 100 })) };
      _recalcInvAmounts(inv);
      items = [{ desc: '鋼板樁', unit: 'M', qty: '1000', price: '1000', note: '', sec: false }, { desc: '動員', unit: '式', qty: '1', price: '33333', note: '', sec: false }]; exs = [];
      document.querySelector('input[name="ngt-mode"][value="incl"]').checked = true; document.getElementById('ngt-target').value = '1050000'; applyNegotiate();
      const aI = items.find(it => it.desc === NGT_ADJ_DESC);
      const r = { exclSub: subE, exclUnitPrice: priceE, exclAdj: aE ? +aE.price : 0, invAdjPrice: ivAdj ? ivAdj.contractPrice : null, invAdjNote: ivAdj ? ivAdj.note : '', invSubExcl: Math.round(inv.items.reduce((a, it) => a + (it.curAmt || 0), 0)),
        inclTotal: Math.round(calcT().total), inclAdj: aI ? +aI.price : 0 };
      items = []; exs = [];
      return r;
    }
  },
  {
    id: 'A04', items: [4], status: '正確',
    title: '列印明細＝總計：一般工項 30 天×100M×10；逾期租金全額折讓（10−10 天）',
    hand: '30×100×10＝30,000；全額折讓＝0',
    run: async () => {
      const itD = { type: 'item', desc: '覆工板', unit: 'M', contractPrice: 10, contractQty: 100, curQty: 100, curDays: 30, payRate: 100 };
      const itR = { type: 'rental', desc: '逾期租金', unit: 'M', contractPrice: 5, contractQty: 100, curQty: 100, curDays: 10, discDays: 10, payRate: 100 };
      const inv = { id: 'iA04', project: '範例工程A04', client: '甲營造', periodNo: 1, date: '2026-10-01', items: [itD, itR] };
      INV.push(inv); invItems = JSON.parse(JSON.stringify(inv.items)); invEid = 'iA04'; buildInvPreview(inv);
      const ph = document.getElementById('inv-prev-html').innerHTML;
      const tr = Array.from(document.querySelectorAll('#inv-prev-html tr')).map(r => r.textContent).filter(t => /逾期租金/.test(t))[0] || '';
      return { rowDays: _invRowAmt(itD), rowDisc: _invRowAmt(itR), prevHas30000: /30,000/.test(ph), prevHas1000: />1,000</.test(ph), prevRentRowHas500: /\b500\b/.test(tr.replace(/[\d,]+·?天|10−10/g, '')) };
    }
  },
  {
    id: 'A05', items: [5], status: '正確',
    title: '打設＋拔除合一工項：打設期 70% 後按工項結算被擋，拔除完成後才可結算',
    hand: '合約 100M 不變（原本會被砍成 70M、合約 105,000→73,500）',
    run: async () => {
      Q = [{ id: 'qA05', name: '範例工程A05', client: '甲營造', awarded: true, items: [{ desc: 'H型鋼 打設、拔除', unit: 'M', qty: 100, price: 1000 }], t: {} }];
      INV.push({ id: 'iA05', quoteId: 'qA05', project: '範例工程A05', client: '甲營造', periodNo: 1, date: '2026-10-01',
        items: [{ type: 'item', desc: 'H型鋼 打設、拔除', cat: 'both', unit: 'M', contractPrice: 1000, contractQty: 100, prevQty: 0, curQty: 100, payRate: 70, installCum: 0, removeCum: 0 }] });
      loadInvoice('iA05'); __syn.toasts = []; settleInvItem(0);
      const blocked = __syn.toasts.some(t => /拔除尚未完成/.test(t)), qtyAfter = invItems[0].contractQty;
      invItems[0].installCum = 100; invItems[0].prevQty = 70; invItems[0].curQty = 100; invItems[0].payRate = 30; invItems[0].phase = 'remove';
      __syn.toasts = []; settleInvItem(0);
      return { blocked, qtyAfterBlock: qtyAfter, allowedAfterRemove: !__syn.toasts.some(t => /拔除尚未完成/.test(t)) };
    }
  },
  {
    id: 'A06', items: [6], status: '正確',
    title: '合約金額＝主約 105,000＋已得標追加 21,000（未得標追加 9,999 不算），有沒有合約都一樣',
    hand: '105,000＋21,000＝126,000',
    run: async () => {
      Q = [{ id: 'qA06', name: '範例工程A06', client: '甲營造', awarded: true, items: [{ desc: 'A', unit: 'M', qty: 100, price: 1000 }], t: { total: 105000 } },
        { id: 'qA06a', name: '範例工程A06 (追加)', parentId: 'qA06', awarded: true, items: [], t: { total: 21000 } },
        { id: 'qA06b', name: '範例工程A06 (追加2)', parentId: 'qA06', awarded: false, items: [], t: { total: 9999 } }];
      const noCt = _wonAmt(Q[0]);
      CONTRACTS.push({ id: 'cA06', linkedQid: 'qA06', name: '範例工程A06', amount: 105000 });
      return { wonNoContract: noCt, wonWithContract: _wonAmt(Q[0]), pjBase: _pjStat(Q[0]).base };
    }
  },
  {
    id: 'A07', items: [7], status: '正確',
    title: '建立追加合約只帶表頭（工項、總計、日報、詢價、佣金、費用、業務不帶）',
    hand: '追加案總計 0、得標金額仍 105,000',
    run: async () => {
      Q = [{ id: 'qA07', name: '範例工程A07', client: '甲營造', awarded: true, items: [{ desc: 'A', unit: 'M', qty: 100, price: 1000 }], t: { total: 105000 }, dailyLogs: [{ id: 'd1', date: '2026-10-01' }], rfqs: [{ id: 'r1' }], comms: [{ id: 'c1' }], exs: [{ d: 'x' }], salesId: 's1', deduct: { ret: 5 } }];
      addAddendum('qA07'); const ad = Q.find(q => q.parentId === 'qA07');
      return { adTotal: (ad.t && ad.t.total) || 0, adItems: (ad.items || []).length, adCarried: ['dailyLogs', 'rfqs', 'comms', 'salesId'].filter(k => ad[k] != null && !(Array.isArray(ad[k]) && !ad[k].length)), adExs: (ad.exs || []).length, adRet: ad.deduct ? ad.deduct.ret : null, won: _wonAmt(Q.find(q => q.id === 'qA07')) };
    }
  },
  {
    id: 'A13', items: [13], status: '正確',
    title: '已付 19,950 的分包期別改量成 29,925：已付那筆不改，差額 9,975 另立待付',
    hand: '29,925−19,950＝9,975',
    run: async () => {
      PAYABLES.push({ id: 'paycA13_p1', costId: 'cA13', costPeriod: 1, to: '乙工程行', amount: 19950, status: 'paid', paidDate: '2026-10-05', project: '範例工程A13' });
      _payPaidDelta({ id: 'paycA13_p1', costId: 'cA13', to: '乙工程行', amount: 29925, status: 'pending', note: '第1期計價', project: '範例工程A13' }, PAYABLES[0]);
      const m = PAYABLES.find(x => x.id === 'paycA13_p1'), d = PAYABLES.find(x => x.deltaOf === 'paycA13_p1');
      return { paidAmt: m.amount, paidStatus: m.status, deltaAmt: d ? d.amount : null, deltaStatus: d ? d.status : null };
    }
  },
  {
    id: 'A14', items: [14], status: '正確',
    title: '同廠商同案同金額兩筆已付手動應付：同步不刪；成本改 1,575 只多一筆 75 待付',
    hand: '1,575−1,500＝75',
    run: async () => {
      const q = { id: 'qA14', name: '範例工程A14', items: [] }, c = { id: 'cA14', type: 'labor', vendor: '丁工班', amt: 1500 };
      PAYABLES.push({ id: 'm1', to: '丁工班', project: '範例工程A14', amount: 1500, status: 'paid' }, { id: 'm2', to: '丁工班', project: '範例工程A14', amount: 1500, status: 'paid' });
      syncCostToPayable(q, c); const n1 = PAYABLES.filter(x => x.status === 'paid').length;
      c.amt = 1575; syncCostToPayable(q, c);
      return { paidCount: n1, paidAmts: PAYABLES.filter(x => x.status === 'paid').map(x => x.amount).sort(), pending: PAYABLES.filter(x => x.status !== 'paid').map(x => x.amount) };
    }
  },
  {
    id: 'A15', items: [15], status: '正確',
    title: '分段工項（裝設 40 支×500）登錄廠商請款：預覽單價帶得到 500',
    hand: '單價 500（原本多一個引號，預覽全是 0、預付款永遠不扣回）',
    run: async () => {
      const r = { id: 'r1', qty: 40, unitPrice: 500, stage: 1, inst: 70 };
      const h = _spStageRowHtml({ id: 'q' }, { id: 'c', rows: [r] }, r, { byRow: {}, byRowR: {} }, null, '', '鋼軌樁', '支');
      const m = h.match(/data-price="([^"]*)"/);
      return { dataPrice: m ? m[1] : null, dataTotal: (h.match(/data-total="([^"]*)"/) || [])[1] || null };
    }
  },
  {
    id: 'A19', items: [19], status: '正確',
    title: '自動結算：100M→120M 合約 105,000→126,000；竣工結算到 84,000 後再補日報（125M）合約不動、提示差額',
    hand: '(120−100)×1000×1.05＝21,000；(125−120)×1000×1.05＝5,250',
    run: async () => {
      let act = 120; window._itemActual = () => ({ qty: act, date: '2026-10-10' });
      Q = [{ id: 'qA19', name: '範例工程A19', awarded: true, items: [{ desc: '鋼板樁', unit: 'M', qty: 100, price: 1000 }] }];
      CONTRACTS.push({ id: 'cA19', name: '範例工程A19', linkedQid: 'qA19', amount: 105000, status: 'active' });
      _autoSettle(Q[0]); const a1 = CONTRACTS[0].amount;
      _settleContractDo('cA19', 126000, 84000, 0);
      act = 125; _autoSettle(Q[0]); const h = _autoSettleHint(Q[0]);
      return { afterAuto: a1, afterFinal: CONTRACTS[0].amount, hintKind: h ? h.kind : null, hintDiff: h ? h.diff : null };
    }
  },
  {
    id: 'A20', items: [20], status: '正確',
    title: '取消得標：未付業務抽成 2,000、業主佣金 3,000 作廢歸零；只刪連結的合約，同名別案合約保留',
    hand: '作廢後待付合計 0；保留合約 2 筆',
    run: async () => {
      Q = [{ id: 'qA20', name: '範例工程A20', awarded: true, items: [] }];
      CONTRACTS.push({ id: 'cA20', name: '範例工程A20', linkedQid: 'qA20', amount: 100 }, { id: 'cA20b', name: '範例工程A20', linkedQid: 'qOther', amount: 200 }, { id: 'cA20c', name: '範例工程A20', amount: 300 });
      PAYABLES.push({ id: 'pay_sales_qA20', quoteId: 'qA20', status: 'pending', amount: 2000, to: '業務甲' }, { id: 'comm_qA20_c1', quoteId: 'qA20', status: 'pending', amount: 3000, to: '主任乙' });
      revokeAward('qA20'); document.getElementById('revoke-reason').value = '業主改發別家'; __synOk();
      return { awarded: Q[0].awarded, voidAmts: PAYABLES.map(p => p.voidAmt || 0), amounts: PAYABLES.map(p => p.amount), apTotal: _apTotal(), apCount: _apList().length, contractsLeft: CONTRACTS.map(c => c.id) };
    }
  },
  {
    id: 'A30', items: [30], status: '正確',
    title: '刪報價：有已付應付或已收款請款單就擋下；都沒有才刪',
    hand: '—（只看擋不擋）',
    run: async () => {
      Q = [{ id: 'qA30a', name: '範例工程A30甲', items: [], costs: [{ id: 'cA30', type: 'sub' }] }, { id: 'qA30b', name: '範例工程A30乙', items: [] }, { id: 'qA30c', name: '範例工程A30丙', items: [] }];
      PAYABLES.push({ id: 'paycA30_p1', status: 'paid', amount: 1000, to: '甲', paidDate: '2026-10-01' }, { id: 'payX', quoteId: 'qA30c', status: 'pending', amount: 10 });
      INV.push({ id: 'iA30', quoteId: 'qA30b', periodNo: 1, received: 500, items: [] });
      _delQDo('qA30a'); _delQDo('qA30b'); _delQDo('qA30c');
      return { left: Q.map(q => q.id), payLeft: PAYABLES.map(p => p.id), invLeft: INV.map(v => v.id) };
    }
  }
];
