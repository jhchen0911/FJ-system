// 每筆樣本開始前：清空所有集合、參數回預設（稅 5%）、提示框改成記錄不顯示、確認框一律同意
(() => {
  window.__syn = { toasts: [] };
  window.toast = m => { window.__syn.toasts.push(String(m)); };
  window.confirm = () => true;
  try { Q = []; INV = []; invItems = []; invEid = null; } catch (e) { /* 可忽略 */ }
  try { CONTRACTS.splice(0); PAYABLES.length = 0; EXPENSES.length = 0; CUSTOMERS.length = 0; VENDORS.length = 0; } catch (e) { /* 可忽略 */ }
  try { P.tax = 5; } catch (e) { /* 可忽略 */ }
  window.__synOk = () => { const m = document.getElementById('gen-confirm-ok'); if (m) m.click(); };
  window.__synShut = () => { const m = document.getElementById('gen-confirm-modal'); if (m) m.style.display = 'none'; };
})();
