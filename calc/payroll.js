/* 豐有工程管理系統．計算模組：薪資單（改版第 3a-4 步，v6.0.133）
 * 純計算：掛在 window.FJC.hr；Node：require('./calc/payroll.js').hr。對外函式只能新增，不能改既有參數或意義。
 */
(function (root) {
  'use strict';
  function n(v, d) { var x = parseFloat(v); return isFinite(x) ? x : (d || 0); }   // 數字（空白／非數字＝預設）
  // 薪資單：底薪（日薪×天數或月薪）＋津貼＋加班＝應發；勞健保自付＋其他扣＝應扣；實發＝應發−應扣；公司負擔＝勞健退公司部分（s 會被改寫並回傳）
  function slip(s) {
    s.days = n(s.days);
    s.baseAmt = s.payType === 'day' ? Math.round(n(s.base) * s.days) : Math.round(n(s.base));
    ['tel', 'other', 'extra', 'laborSelf', 'healthSelf', 'pensionSelf', 'otherDed', 'laborCo', 'healthCo', 'pensionCo'].forEach(function (k) { s[k] = Math.round(n(s[k])); });
    s.gross = s.baseAmt + s.tel + s.other + s.extra;
    s.ded = s.laborSelf + s.healthSelf + s.pensionSelf + s.otherDed;
    s.net = s.gross - s.ded;
    s.coCost = s.laborCo + s.healthCo + s.pensionCo;
    return s;
  }
  var hr = { num: n, slip: slip };
  var FJC = root.FJC || (root.FJC = {});
  FJC.hr = hr;
  if (typeof module !== 'undefined' && module.exports) module.exports = FJC;
})(typeof window !== 'undefined' ? window : globalThis);
