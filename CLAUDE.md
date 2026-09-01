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
8. **匯出 PDF 的大原則（所有頁面一體適用）**：一律維持原比例、**不縮放**；整份放得進
   一張紙才不分頁，超出就換頁——切在列與列之間、續頁重印表頭、天地各 10mm、多頁加頁尾頁碼；
   **換頁是「填滿才換」，不是為了避開孤兒頁而留一大片空白**（引擎：`_pdfPlanPages`／`_pdfAddPaged`）
7. **手機版（≤767px）任何輸入／結果表格不得左右滑動**（使用者多次強調）。寬表格一律堆疊成
   逐列卡片：`_mstack()` 會自動處理工具頁根節點下有 thead 的表（加 `.mst`＋`data-th`），
   新工具頁把根節點 id 加進 `_mstack` 的觀察清單即可；例外只有甘特圖等時間軸類圖表

## 雲端工作階段（claude.ai/code、手機 App）額外規則

部署＝push 到 `main` 後 GitHub Pages 自動上線。雲端工作階段預設在新分支上工作，所以：

- 改完照常升版號、commit、push 分支，然後**建立 PR**，並在回覆中明確告訴使用者
  「合併這個 PR 後約 1 分鐘會自動上線」——合併動作在手機上按一下即可
- 若使用者明確說「直接推 main」，才 push 到 main
- 回覆一律列出：版本號、改動明細、需要使用者做的下一步

## 施工計畫書圖面：先出圖檢核，再上線（重要）

只要改動到**施工步驟示意圖、施工流程圖、細部詳圖**（`_plStorySteps`／`_plDetailSteps`／
`_plFlowPNG`／機具向量資產 `_PL_VEC`）：

1. **先把所有工法的圖渲染成 PNG 送給使用者檢核**——不是抽樣，是**全部工法逐一出圖**
   （擋土壁 6 形式 × 各自工法共 12 組、中間樁 2 組、支撐／構台／地錨／CCP／抗浮基樁、
   以及各工項細部詳圖）
2. 使用者確認或列出要改的項目後，才 commit／PR／上線
3. 不可「先上線再請使用者檢核」——來回修圖浪費使用者時間

出圖方式：以 Playwright 載入 `index.html`，逐一呼叫 `_plStoryPNG(id,m,meth)`／
`_plDetailPNG(id,m)` 取 b64 存檔（腳本範例見 scratchpad/renderall.js），再用
SendUserFile 分批送出，檔名用工項＋工法中文命名。

## 主要模組速查（皆在 index.html 內）

| 模組 | 關鍵函式 |
|---|---|
| 報價編輯 | `rItems` `calcT` `saveQ` `applyNegotiate`(議價) `backfillEstCosts` |
| 版次 | `bumpQVersion`(進版→封存 V1、V2…永久保留) `showQVersions` `viewQVersion` `restoreQVersion` `compareQVersion`；自動存檔＝每次儲存留一份、只留 10 份，**不是版次** |
| PDF 匯出 | `exportQuotePDF`(html2canvas 影像版) `exportQuotePDFNative`(瀏覽器原生列印)；`_printViaIframe` 一律先開預覽、按「下載PDF」才存檔（v5.388，所有列印鈕不再一點就下載）；分頁引擎 `_pdfPlanPages`(DOM 量測切點：只切列與列之間、天地各 10mm、續頁重印表頭、末頁過短自動均分) `_pdfAddPaged`(貼頁＋頁碼，**一律原比例、不縮放**；整份放得進一張紙才不分頁)；報價表空的逾期租金／備註欄自動不輸出 |
| 單價分析 UPA | `upaCalc` `applyUPA`（套用時自動帶成本：實績優先、理論為輔） |
| 歷史單價庫 | `COST_HIST` `writeCostHist`(結案回寫) `_histCostFor`(報價提示) |
| 請款單 | `rInvItems` `buildInvPreview` `addNextPeriod` `settleInvItem`(工項結算，連動合約金額)；**本期估驗數量與累計一律加權** `_wQty`／`_curW`（打設70%＋拔除30%＝合約量），`_prevCumQty` 於 `loadInvoice` 由各期實績重算 |
| 合約 | `renderContracts` `settleContract`(竣工總結算) |
| 施工成本 | `rCostItems` `COST_CATS`(科目) `_costByItem`(工項歸戶) `buildCostAnalysisHtml` `buildCostAuditHtml`(勾稽) |
| 金流 | `updateFinanceKPIs` `renderCashForecast`(90天水位預測) |
| 支出．日報 | `rQuickCost` `submitQuickCost` `submitDailyReport`(頁 id: quickcost) |
| 智慧收件 | `smartIntake` `aiClassifyDoc` `_intakeRoute`（Claude API 影像辨識） |
| 權限 | 部門→角色→人員三層：`listDepts`/`listRoles`/`listStaff` `_rolesOf`(取聯集) `canAccess` `renderStaffPage` `renderRolesPage` `rolePerm`；`ALL_PAGES.sysOnly`＝系統管理員限定（單價分析／參數設定／人員／角色），`parent`＝隱藏頁跟隨母頁 |
| 備份 | `exportData`/`importData`（全量，與 `_syncPayload` 同 payload；含六大工具存檔、計畫書草稿與附件庫、報價版本歷史、材料庫存） |
| 錯誤日誌 | `_err(位置,e)` 收集器（本機最近 100 筆，不上雲）`renderErrLog` `exportErrLog`；空 catch 已全部接上 |
| 請款單壓縮 | `_invPack`/`_invUnpack`（欄位縮寫＋預設值省略，僅在儲存層；`_INV_OMIT` 之外的欄位不省略） |
| 工項類別 | `_itemCat`(打設／拔除／both／other，空＝沿用名稱關鍵字) `_isRemovePeriod`(期別，`P.removeRate` 可調) |
| 專案獎金（佣金） | 得標設定 `confirmAward` 存 `q.referral`（％基底＝合約金額未稅 `q.t.sub`，或一筆金額；`_calcCommission`），連動應付 `comm_<qid>` 依實收進度分期支付；利潤頁依 `_recvRate` 計提 |
| 工程實績表 | `renderTrackReport` `_trackRows` `exportTrackPDF`/`exportTrackXlsx`（報表中心分頁：年度區間＋逐案勾選，PDF 先預覽） |
| 得標率／廠商績效 | `renderBidRateReport` `renderVendorReport`（報表中心分頁）；得標率口徑＝得標÷全部報價（`_bidStat`，除得標外皆列未得標）；業主往來／得標率／廠商績效整列可點入明細 `openRptClientDetail`／`openRptBidDetail`／`openRptVendorDetail` |
| 合約請款報表 | `renderContractReport`：同編號同名（即使掛不同報價）的重複建檔合併為一列，⚠×N 可點入 `openCtDupFix` 直接刪除未請款的重複筆 |
| 統計卡總結 | 全站 KPI 卡皆可點：報價/請款 `openQuoteKpi`/`openInvKpi`、總覽與金流 `openFinKpi`(ar/ap/cash/month)、利潤 `openProfitKpi`(net/est/recv/cost)、佣金 `openCommKpi`、客戶 `openCustKpi`、累積估驗 `openInvCumDetail`（編輯器前期累計欄點入各期組成）；請款每期預計收款日 `_invExpectedDate` 顯示於列表小字與期別 chip（逾期轉紅） |
| 收款 | `openReceiptModal(invId)`：彈窗內可切換同專案各期；專案管理每期 chip 各自帶收款鈕 |
| 票據登記 | `inv.receipts[]`（現金/票據、到期日、狀態）`_invTickets` `_cashOf` 登記模式優先；收款彈窗登記 |
| 保留款總覽 | `_retentionRows` `renderRetention`（金流管理分頁）；已完工未退標紅 |
| 催款／缺口模擬 | `_dunningText` `openDunning`；`cfSetDelay`（90天預測延收滑桿） |
| 全域搜尋 | `openGlobalSearch` `runGlobalSearch`（頂欄放大鏡／Ctrl+K／手機更多） |
| 出工月結 | `renderLaborReport`（報表中心分頁，日報出工×`P.laborDayRate` 對點工成本） |
| 修改人 | `_touch(obj)` 統一戳 `_mt`+`_by`；雲端套用只戳 `_mt`。改記錄一律走 `_touch` |
| 附件效期 | 檔案物件 `exp` 欄位 `_plAttExp`；過期進待辦並在產出文件加註 |
| 雲端同步 | `_sharedPayload`/`_privatePayload` `_pushPrivate`/`_pullPrivate` `_applySensColls` `_seedAdminUid`；報價／請款走逐筆路徑 `_perRecordDelta`，筆數暴跌由 `_syncDropGuard` 攔下，墓碑 180 天由 `_tombPrune` 清理 |
| 逾期租金 | `_rentDaysOf`(解析備註租期) `_itemProgress`(日報推完工日) `_rentStatus` `_rentScan` `invScanRent`；**單價一律以報價單 `it.ot` 為準**（`_otFromQuote`），請款單裡的 `otPrice` 只是建單快照，`loadInvoice` 開單即校正 |
| 單位 | `_uFix()`：平方公尺一律顯示 `m²`（M2／m2／㎡ 全部正規化）。只作用在單位類短字串，不碰工項說明與備註 |

## 測試

`tests/smoke.js`（101 項冒煙檢查）——每次 PR 由 `.github/workflows/smoke.yml` 自動執行。
本機跑：`npm install && npx playwright install chromium && npm test`。

涵蓋：23 頁切換無 Console 錯誤、手機版無橫向捲動（甘特圖為允許的例外）、備用單價與議價口徑、
請款單壓縮可逆（列印輸出逐字元比對）、破壞性操作必須經過確認、工項類別／期別、
兩張分析報表、全量備份涵蓋所有集合、全站 KPI 卡點擊總結（總覽/金流/利潤/客戶/佣金）、得標率口徑、寄送方式勾選列印、數量小數、累積估驗明細、工程實績表、材料估算容錯、重複合約點入刪除、既有請款單累計回填、匯出 PDF 先預覽再下載、報價單 PDF 排版（分頁連續不重疊、切在列邊界、天地留白、續頁重印表頭、空欄不輸出）。

**新增功能時請一併補進 tests/smoke.js。** 其餘仍以人工驗證：用瀏覽器開 `index.html`
確認被改動的頁面渲染正常。雲端環境無法登入 Firebase 屬正常（本機資料模式仍可驗證 UI 與邏輯）。

## Firebase 安全規則

`database.rules.json` 是原始碼，**改完必須到 Firebase 主控台手動發布才會生效**。
目前規則：`fydata/shared`（名冊內可讀寫）／`fydata/private`（僅管理員），兩者都不得整包清空，
並要求 `version`／`uploadedAt` 的基本形態。

## 語言

介面與溝通全部使用繁體中文（台灣營建業用語）。
