# FJ-system 豐有工程管理系統

台灣營建公司（擋土支撐工程）的報價／合約／請款／成本／金流管理系統。

## 架構

- **單一檔案應用**：整個系統就是 `index.html`（~1MB，含全部 HTML/CSS/JS），無建置流程、無框架、無相依套件
- 資料存 localStorage ＋ Firebase RTDB 雲端同步（記錄級合併、`_mt` 修改時間新者勝）
- **雲端分兩個節點**（v5.324）：`fydata/shared` 一般營運資料（登入即可讀）、`fydata/private`
  敏感資料（成本／毛利／分潤／應付／費用／材料台帳／單價庫，僅 `fydata/adminUids` 內的管理員可讀）。
  新增同步欄位時要想清楚該進哪一邊：`_SYNC_COLLS`（shared）或 `_PRIV_COLLS`（private）。
  報價單裡的 `costs`／`items[].estCost`／`t.cost|gross|net` 由 `_stripQuoteSens` 抽走後另存 private。
- `sw.js`：Service Worker，網路優先策略——部署新版使用者重新整理即生效，**不需改動**
- 部署：push 到 `main` → GitHub Pages 自動上線（約 1 分鐘）→ https://jhchen0911.github.io/FJ-system/

## 修改規則（重要）

1. **每次修改必須升版號**：搜尋 `APP_VERSION='v5.XXX'`（只有一處），流水號 +1
2. **改完直接 commit + push 部署，不用徵詢**（使用者已授權：改好→列出改動明細→部署，使用者自行上線測試）
3. Commit 訊息格式：`vX.XXX：一句話摘要`＋條列改動內容（繁體中文）
4. **修改任何記錄物件（合約/請款單/報價）的欄位時，必須同時 `obj._mt=Date.now()`**，否則跨裝置同步時舊資料會蓋掉新值
5. 內部欄位（成本單價 estCost、毛利）**絕不能出現在給業主的報價單/請款單列印**（列印用 `_buildQuoteDocHTML`／`buildInvPreview`）
6. 金額慣例：工項單價為未稅；合約金額與請款總計為含稅（稅率 `P.tax`，預設 5%）

## 雲端工作階段（claude.ai/code、手機 App）額外規則

部署＝push 到 `main` 後 GitHub Pages 自動上線。雲端工作階段預設在新分支上工作，所以：

- 改完照常升版號、commit、push 分支，然後**建立 PR**，並在回覆中明確告訴使用者
  「合併這個 PR 後約 1 分鐘會自動上線」——合併動作在手機上按一下即可
- 若使用者明確說「直接推 main」，才 push 到 main
- 回覆一律列出：版本號、改動明細、需要使用者做的下一步

## 主要模組速查（皆在 index.html 內）

| 模組 | 關鍵函式 |
|---|---|
| 報價編輯 | `rItems` `calcT` `saveQ` `applyNegotiate`(議價) `backfillEstCosts` |
| 單價分析 UPA | `upaCalc` `applyUPA`（套用時自動帶成本：實績優先、理論為輔） |
| 歷史單價庫 | `COST_HIST` `writeCostHist`(結案回寫) `_histCostFor`(報價提示) |
| 請款單 | `rInvItems` `buildInvPreview` `addNextPeriod` `settleInvItem`(工項結算，連動合約金額) |
| 合約 | `renderContracts` `settleContract`(竣工總結算) |
| 施工成本 | `rCostItems` `COST_CATS`(科目) `_costByItem`(工項歸戶) `buildCostAnalysisHtml` `buildCostAuditHtml`(勾稽) |
| 金流 | `updateFinanceKPIs` `renderCashForecast`(90天水位預測) |
| 支出．日報 | `rQuickCost` `submitQuickCost` `submitDailyReport`(頁 id: quickcost) |
| 智慧收件 | `smartIntake` `aiClassifyDoc` `_intakeRoute`（Claude API 影像辨識） |
| 權限 | 部門→角色→人員三層：`listDepts`/`listRoles`/`listStaff` `_rolesOf`(取聯集) `canAccess` `renderStaffPage` `renderRolesPage` `rolePerm`；`ALL_PAGES.sysOnly`＝系統管理員限定（單價分析／參數設定／人員／角色），`parent`＝隱藏頁跟隨母頁 |
| 備份 | `exportData`/`importData`（全量，與 `_syncPayload` 同 payload） |
| 雲端同步 | `_sharedPayload`/`_privatePayload` `_pushPrivate`/`_pullPrivate` `_applySensColls` `_seedAdminUid` |
| 逾期租金 | `_rentDaysOf`(解析備註租期) `_itemProgress`(日報推完工日) `_rentStatus` `_rentScan` `invScanRent` |

## 測試

無自動化測試。修改後至少：用瀏覽器開 `index.html` 確認 Console 無錯誤、被改動的頁面渲染正常。雲端環境無法登入 Firebase 屬正常（本機資料模式仍可驗證 UI 與邏輯）。

## 語言

介面與溝通全部使用繁體中文（台灣營建業用語）。
