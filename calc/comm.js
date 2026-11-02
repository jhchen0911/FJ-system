/* 豐有工程管理系統．計算模組：業務抽成與業主端佣金（改版第 3a-4 步，v6.0.133）
 * 純計算：合約、成本、數量、收款這些「基礎數字」由呼叫端用函式提供（只在用得到時才算，與原本一樣），不讀全域資料。
 * 掛在 window.FJC.comm；Node：require('./calc/comm.js').comm。對外函式只能新增，不能改既有參數或意義。
 *   cfg：{mode:'rev'|'profit'|'amt'|'unit', val, unit}
 *   get：{ base()＝合約未稅、profit()＝毛利基礎、unit()＝{contract,billed}、rate(ofBilled)＝收款進度 }
 */
(function (root) {
  'use strict';
  // 抽成基礎：合約含稅（主約＋已得標追加）÷ 稅率
  function salesBase(wonAmt, taxM) { return Math.round((wonAmt || 0) / taxM); }
  // 毛利基礎：未稅合約 − 成本（實際；沒有實際成本用報價預估）
  function profitBase(base, costActual, costEst) { var cost = costActual; if (!(cost > 0)) cost = costEst; return Math.max(0, base - cost); }
  // 收款進度：已收 ÷ 合約含稅；ofBilled＝已收 ÷ 已請（每單位模式用），上限 1
  function rcvRate(o, ofBilled) {
    if (ofBilled) return o.billed > 0 ? Math.min(1, o.rcv / o.billed) : 0;
    return o.contractTotal > 0 ? Math.min(1, o.rcv / o.contractTotal) : 0;
  }
  // 總額（預估）
  function amount(cfg, get) {
    if (!cfg) return 0;
    if (cfg.mode === 'amt') return Math.round(cfg.val);
    if (cfg.mode === 'profit') return Math.round(get.profit() * cfg.val / 100);
    if (cfg.mode === 'unit') return Math.round(get.unit().contract * cfg.val);
    return Math.round(get.base() * cfg.val / 100);
  }
  // 已計提：unit＝已請量×單價×（已收÷已請）；其他＝總額×收款進度
  function accr(cfg, get) {
    if (!cfg) return 0;
    if (cfg.mode === 'unit') { var k = get.unit(); return Math.round(k.billed * cfg.val * get.rate(true)); }
    return Math.round(amount(cfg, get) * get.rate());
  }
  // 應付金額：unit＝已請量×單價（隨請款增加），其他＝總額
  function due(cfg, get) {
    if (!cfg) return 0;
    if (cfg.mode === 'unit') return Math.round(get.unit().billed * cfg.val);
    return amount(cfg, get);
  }
  var comm = { salesBase: salesBase, profitBase: profitBase, rcvRate: rcvRate, amount: amount, accr: accr, due: due };
  var FJC = root.FJC || (root.FJC = {});
  FJC.comm = comm;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
