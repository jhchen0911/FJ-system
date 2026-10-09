# FJ-system 豐有工程管理系統

台灣營建公司（擋土支撐工程）的報價／合約／請款／成本／金流管理系統。

## 架構

- **單一應用、兩個檔**（v6.0.34 起）：`index.html`（HTML／CSS／頭尾兩段小 script，~350KB）＋ `app.js`（主程式 ~2.6MB，`<script src="app.js?v=6.0.NN" defer>` 載入；外部化後瀏覽器可串流編譯＋程式碼快取，開頁快約三成）。無建置流程、無框架、無相依套件。**所有 JS 修改都在 `app.js`**（模組區塊插在 `function _modal(title,bodyHtml,onOk){` 之前，與以前相同）；HTML／CSS 改 `index.html`
- 資料存 localStorage ＋ Firebase RTDB 雲端同步（記錄級合併、`_mt` 修改時間新者勝）
- **雲端分兩個節點**（v5.324）：`fydata/shared` 一般營運資料（登入即可讀）、`fydata/private`
  敏感資料（成本／毛利／分潤／應付／費用／材料台帳／單價庫，僅 `fydata/adminUids` 內的管理員可讀）。
  新增同步欄位時要想清楚該進哪一邊：`_SYNC_COLLS`（shared）或 `_PRIV_COLLS`（private）。
  報價單裡的 `costs`／`items[].estCost`／`t.cost|gross|net` 由 `_stripQuoteSens` 抽走後另存 private。
- `sw.js`：Service Worker。v6.0.33 起 **index.html／導覽請求改快取優先**（開頁不等網路）、背景以 no-cache 重新驗證，ETag／Last-Modified／長度不同就 `postMessage({type:'fy-update'})` → 頁面顯示「系統有新版本」提醒重新整理（**部署後使用者要重新整理兩次才看到新版：第一次開舊版並下載新版，提示後再整理**）；v6.0.34 起 `app.js` 同為應用殼（快取鍵去查詢字串 `shellKey`／`appJsKey`），**index.html 變更時先把 app.js 也換新再通知**，不會新 index 配舊 app.js；CACHE `fy-app-v3`。其他同源資源仍網路優先、PDF 套件快取優先。除此之外**不需改動**
- 部署：push 到 `main` → GitHub Pages 自動上線（約 1 分鐘）→ https://jhchen0911.github.io/FJ-system/

## 修改規則（重要）

1. **每次修改必須升版號（兩處一起改）**：`app.js` 的 `APP_VERSION='v6.0.NN'`（只有一處）與 `index.html` 的 `<script src="app.js?v=6.0.NN" defer>`，流水號 +1（smoke 會比對兩者一致；v6 正式版自 v6.0.21 起；不再加 `-beta`）
2. **改完直接 commit + push 部署，不用徵詢**（使用者已授權：改好→列出改動明細→部署，使用者自行上線測試）
3. Commit 訊息格式：`vX.XXX：一句話摘要`＋條列改動內容（繁體中文）
4. **修改任何記錄物件（合約/請款單/報價）的欄位時，必須同時 `obj._mt=Date.now()`**，否則跨裝置同步時舊資料會蓋掉新值
5. 內部欄位（成本單價 estCost、毛利）**絕不能出現在給業主的報價單/請款單列印**（列印用 `_buildQuoteDocHTML`／`buildInvPreview`）
6. 金額慣例：工項單價為未稅；合約金額與請款總計為含稅（稅率 `P.tax`，預設 5%）
8. **匯出 PDF 的大原則（所有頁面一體適用，v5.392 起全站統一走同一引擎）**：
   ① 一律維持原比例、**不縮放**（內容寬固定＝A4 寬扣左右留白，同種文件字級必然一致）；
   ② 整份放得進一張紙才不分頁，超出就換頁——切在列與列之間、續頁重印表頭、
   **上下左右各 10mm**、多頁加頁尾頁碼；
   ③ **換頁是「填滿才換」**——放得下一列就不准換頁，不為避開孤兒頁而留大片空白。
   引擎：`_pdfContentPx`(渲染寬)／`_pdfMargPt`(10mm)／`_pdfPlanPages`(切點)／`_pdfAddPaged`(貼頁)；html2canvas `scale` 以 3（約 288dpi）為目標、受裝置 canvas 像素上限（行動裝置 14.5M）自動降、最低 2（v6.0.22，`_pdfLastScale` 可查）；
   `_printViaIframe` 會正規化各文件自帶的版心與左右內距，留白一律由 PDF 提供。（`.page-wrap` 與請款單外框 `#inv-doc` 的 width／margin／padding 一律歸零，v6.0.23）文件高度由 `_pdfContentBottom` 只算到「有內容」的元素底緣（自帶文字／圖／表格），外框下內距與空白區塊不算，否則多幾公釐內距就會多一張空白頁（v6.0.23）。
   新增列印文件時**不要**自己加左右留白、不要自訂 @page margin（一律 10mm）
7. **手機版（≤767px）任何輸入／結果表格不得左右滑動**（使用者多次強調）。寬表格一律堆疊成
   逐列卡片：`_mstack()` 會自動處理工具頁根節點下有 thead 的表（加 `.mst`＋`data-th`），
   新工具頁把根節點 id 加進 `_mstack` 的觀察清單即可；例外只有甘特圖等時間軸類圖表
9. **程式碼原則（v6.0.49～v6.0.53 健檢後）**：①修改一律改原函式本體，**不新增同名覆寫、不寫 `var x0=f;f=function(){…}` 包裝**（全檔同名頂層函式＝0，冒煙測試檢查）；②`catch` 不得留空——要嘛 `_err('所在函式',e)`，要嘛註明 `/* 可忽略 */`（冒煙測試靜態檢查）；③刪功能時連同只給它用的輔助函式一起刪，判斷「沒人用」要同時查 `app.js`、`index.html`（onclick）與 `tests/smoke.js`；④大改前先列影響清單，資料結構變更要寫一次性遷移、舊資料不能壞
10. **新增模組**：程式插在 `function _modal(title,bodyHtml,onOk){` 之前，並在下方「模組地圖」補一列；技術細節寫進 `docs/版本紀錄.md`（CLAUDE.md 只留規則與地圖）

## v6 正式版（2026-10-04 上線）與開發流程

- **`main` 的 `index.html` 自 v6.0.21 起即為 v6 正式版**（2026-10-04 由 redesign-v6 v6.0.20-beta 轉正）。之後所有修改直接在 `main` 進行，照上面的修改規則：升版號 → `tests/smoke.js` 全過 → commit＋push。分支 `redesign-v6` 已完成任務，不再更新。
- **回滾**：v5 正式版備份在分支 `stable-v5.449`（上線前最後一版）與 `stable-v5.448`。要退回 v5：`git checkout stable-v5.449 -- index.html` 後升版號推 `main`。v5 與 v6 資料互通（實測：v6 讀 v5 資料不改既有欄位，只新增 `q.mat`／材料攤提參數／分頁記憶鍵；v6 存回後 v5 仍可原樣讀回），退回不需要轉資料。
- **v5 → v6 資料面唯一的一次性變更**：`_v6PermMigrate()`——系統管理員第一次登入 v6 時，把各角色舊頁權限對映到新頁（projects|costs|contracts|progress→`proj`、materials|costs|projects→`rfq`、finance|ledger→`acct`、profit|reports→`reports`），旗標 `pagePerms.__v6perm=2`。上線後請到「角色權限」確認各角色勾選。
- **測試版 `beta.html`** 仍保留為沙盒：`python3 tools/build-beta.py index.html beta.html` 由同一份 index.html 產生 `beta.html`＋`beta.js`（localStorage 鍵走 `beta:` 前綴、第一次開啟從正式版複製一份、所有上傳雲端函式改空操作（v6.0.34 起寫在 `beta.js`，以 defer 接在 `app.js` 之後才蓋得到）、左下角橙色「β 測試版」chip 可重新複製；主程式共用 `app.js`）。要讓使用者先試再上線的大改動，先只推 beta.html 到 `main`，驗過再改 index.html。**beta 裡輸入的資料不會進正式版**。
- **混用期注意**：部署後所有裝置都要重新整理到 v6。仍停在 v5 的裝置存檔時會把報價裡 v6 新增的 `rfqs`／`mat`（走 private 的報價敏感欄位）整筆覆蓋掉。
- **各版技術細節**（v6.0.9～）已移到 `docs/版本紀錄.md`；模組口徑細節在 `docs/模組細節.md`。

## 雲端工作階段（claude.ai/code、手機 App）額外規則

部署＝push 到 `main` 後 GitHub Pages 自動上線（約 1 分鐘）。

- **使用者已授權「以後直接推 main」（2026-09-11）**：改完升版號、跑過
  `tests/smoke.js` 全過之後，**直接 commit＋push 到 `main`**，不用開 PR、不用等合併
- push 前一定要先 `git fetch origin main` 並確認本機是最新的，避免推不上去
- 回覆一律列出：版本號、改動明細、以及「已上線，約 1 分鐘後重新整理即可（標題列應顯示 vX.XXX）」
- 例外：改動很大或使用者明說要先看過時，才改走分支＋PR

## 施工計畫書圖面：先出圖檢核，再上線（重要）

只要改動到**施工步驟示意圖、施工流程圖、細部詳圖**（圖組 `FY_SHEETS`（`window.FY_SHEETS` 所在的圖庫 IIFE）／
`_plStorySteps`（目前只剩水平支撐）／`_plDetailSteps`／`_plFlowPages`／`_plFlowPNG`／機具向量資產 `_PL_VEC`）：

1. **先把全部的圖渲染成 PNG 送給使用者檢核**——不是抽樣，是**全部逐一出圖**
   （圖組 22 組各頁：擋土壁 H 型鋼樁／鋼軌樁／鋼板樁各工法、中間樁 6 組、預壘樁、RC 基樁 2 組、地錨、CCP、構台；
   水平支撐步驟圖與詳圖；各圖組的施工流程圖）
2. 使用者確認或列出要改的項目後，才 commit／上線（可先推到工作分支存放，確認後再併 `main`）
3. 不可「先上線再請使用者檢核」——來回修圖浪費使用者時間

出圖方式：`CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/render-plan-drawings.js <index.html 目錄> <輸出目錄>`
→ `png/`（檔名＝圖類＋工項＋工法）＋`hash.json`（md5）。**改動前後各跑一次比對 hash.json**，只動到程式結構時應逐位元相同；
再用 SendUserFile 分批送出（大圖可先轉 JPEG）。

## 模組地圖（v6.0.53）

全部程式在 `app.js`（約 37,000 行），HTML／CSS 在 `index.html`。找功能時先查這張表，再用 `grep -n "^function 函式名"` 定位。
細部口徑與歷次調整見 `docs/模組細節.md`（v5～v6.0.48 累積的敘述）、`docs/版本紀錄.md`（v6 各版技術紀錄）、`docs/健檢報告_2026-10-08.md`。

| 模組 | 頁面 id（入口） | 主要函式 | 資料（同步節點） |
|---|---|---|---|
| 總覽 | `dash` | `updateDashTodo` `_v6TodoItems` `_todoLongSub` | 讀各集合 |
| 報價 | `quotes`（列表 `renderList`）→ 編輯頁 | `rItems` `calcT` `saveQ` `loadQ` `applyNegotiate`（議價）`bumpQVersion`（版次）`quoteViewPdf` `exportQuotePDF` `quoteImportOwner`／`_qiStart`（匯入業主詢價單 xlsx／docx／pdf）`quoteExportOwnerDoc`（回填） | `Q`（quotes，逐筆同步；`costs`／`items[].estCost`／`t.cost|gross|net`／`rfqs`／`mat` 由 `_stripQuoteSens` 抽到 private） |
| 案場細節 | 彈窗 `openSiteDet(qid)`（報價編輯、工程專案、材料估算、施工計畫書） | `_sdRender` `_sdCalc` `_sdToMatEst` `_sdEnsure` `siteBump` | `q.site`／`q.siteHist`（shared）；**圖面數量唯一來源** |
| 工程專案 | `proj`（`openProj(qid)`；`go('projects')` 轉來） | `renderProj` `_pjStat` `_pjTodoItems` `_pjSection` `_pj*Html` 各區塊 `pjCloseAll`（結案）`_autoSettle`（階段完工自動結算）`_introSync` | 以報價 `q` 為主體 |
| 發包 | `rfq`（hidden，parent `proj`） | `renderRfq` `rfqNew` `rfqFill` `rfqAward` `_rfqBackfillEst` `pjIntroEdit`（介紹費） | `q.rfqs`（private） |
| 材料．運輸 | `mat6`（hidden，parent `proj`） | `renderMat6` `matRowEdit` `m6Decide` `m6RentEdit` `matOut` `matBack` `_m6Sync` `_matAmortRows` | `q.mat`（private）、`MAT_LEDGER`（matLedger，private） |
| 施工成本／分包 | `costs`（hidden，parent `proj`；`openProjectCosts`） | `rCostItems` `openSubPeriod`／`_spSave`（廠商請款期別）`openSubAdvance`／`_saSave`（預付款）`openRentPeriod`（租賃）`_subFollowApply`（跟隨計價）`_subStat` `buildSubMgmtHtml` | `q.costs`（private） |
| 成本→應付 | — | `syncCostToPayable` `_syncSubPeriodPayables`（開頭依序 `_advPayHeal`→`_subAdvClamp`→`_earlyToAdv`）`_paySource`（自動應付唯讀）`cleanDuplicatePayables` `_tombExempt` | `PAYABLES`（payables，private）；id 規則見下 |
| 日報．支出 | `quickcost` | `submitDailyReport` `_drMergeLog` `submitQuickCost`（`QC_TYPES`）`drMonthRender`（月表單）`viewDailyReports` `_photoPut`（照片另存）`_itemProgress` `_qtyRecon` | `q.dailyLogs`（隨報價）、照片 `fydata/relay/photos`、公司費用 `EXPENSES` |
| 業主請款 | `acct` › 業主請款（`go('invoice')` 轉來） | `renderInvList` `loadInvoice` `rInvItems` `buildInvPreview` `buildInvFromQuote` `addNextPeriod` `openReceiptModal` `printAllowance` `openEnvelope` | `INV`（invoices，逐筆同步） |
| 廠商請款 | `acct` › 廠商請款 | `renderVendorBilling` `_vbRows` `vbOpenPeriod` | 讀 `q.costs` |
| 帳務 | `acct`（分頁 ar／ap／cash／inv／petty／pay／own／vb；`go('finance'|'ledger'|'payroll')` 轉來） | `acctTab` `_acctMount`（搬入舊頁元素）`renderPayables` `renderCashForecast` `renderRetention` `_expForm`（費用．發票） | `PAYABLES`、`EXPENSES`（private） |
| 薪資．零用金 | `acct` › pay／petty（權限看 `payroll`） | `hrEdit` `psGenerate` `_hrSyncPayables` `pcGenerate` `_pcCalc` | `HR`／`PAYSLIPS`／`PETTY`（private） |
| 經營報表 | `reports`（`go('profit')` 轉來） | `showReport` `renderOverviewReport` `_shRptYear`（**權責口徑單一來源**）`_rptBasisStrip` `renderShareholderReport` `renderHealthReport`／`_healthRows`（資料健檢） | 讀各集合 |
| 客戶．廠商 | `contacts` | `renderContactsAll` `renderCustomersContact` `renderVendors2` | customers、vendors（shared） |
| 施工計畫書 | `plan` | `_plBuild` `_plRender`；圖：`FY_SHEETS`（施工步驟示意圖組，`_fySheetId` 工項＋工法→圖組）、`_plStorySteps`（只剩水平支撐）、`_plDetailSteps`（水平支撐詳圖）、`_plFlowPages`（施工流程圖） | planState（shared） |
| 工具 | `matest` `rebar` `grout` `backfill` `workers`；`lifeline`、`progress` 隱藏 | `renderMatEst` `matEstCalc`（綁定工程時幾何讀案場細節）`renderWorkers` | toolStates、workers（逐筆） |
| 單價分析／單價庫 | `upa`（sysOnly） | `upaCalc` `applyUPA` `writeCostHist`（結案回寫） | upaHistory（shared）、upaCostDB／costHist（private） |
| 人員／角色／參數 | `staff` `roles` `params` | `renderStaffPage` `renderRolesPage` `rolePerm` `canAccess` `_v6PermMigrate` `doSaveP` `syncParamsUI` `prmTab` | pagePerms、params（shared） |
| 同步／備份／錯誤 | 頂欄 `#sync-chip` | `_sharedPayload` `_privatePayload` `_mergeColl` `_perRecordDelta` `_touch` `exportData`／`importData` `_err`／`renderErrLog` `_syncChip` | 見「架構」 |
| 列印／PDF | — | `_printViaIframe` `_pdfPlanPages` `_pdfAddPaged` `_toolPrint`；手機表格 `_mstack` | — |

**應付 id 規則**：分包期別 `pay<cid>_p<no>`／保留款退還 `_r<no>`、預付款 `pay<cid>_a<id>`、介紹費 `pay<cid>_intro`、整筆 `pay<cid>`、薪資 `pay_ps_`、勞健保 `pay_ins_`、零用金 `pay_pc_`、稅費 `pay_tax_<eid>`、佣金 `comm_<qid>`。前述皆為自動產生（`_paySource` 判定、唯讀），只能從來源修改。

**頁面導向**：隱藏頁由 `go()` 開頭改寫——`projects`→`proj`、`invoice`／`finance`／`ledger`／`payroll`→`acct`（對應分頁）、`profit`→`reports`；`rfq` 且 `_rfqTab==='mat'`→`mat6`。

## 測試

`tests/smoke.js`（560 項冒煙檢查）——每次 PR 由 `.github/workflows/smoke.yml` 自動執行。
本機跑：`npm install && npx playwright install chromium && npm test`。測試以 file:// 開 `index.html`，同目錄要有 `app.js`（自製的 dry-run 複本兩個檔都要複製）。

涵蓋：23 頁切換無 Console 錯誤、手機版無橫向捲動（甘特圖為允許的例外）、備用單價與議價口徑、
請款單壓縮可逆（列印輸出逐字元比對）、破壞性操作必須經過確認、工項類別／期別、
兩張分析報表、全量備份涵蓋所有集合、全站 KPI 卡點擊總結（總覽/金流/利潤/客戶/佣金）、得標率口徑、寄送方式勾選列印、數量小數、累積估驗明細、工程實績表、材料估算容錯、重複合約點入刪除、既有請款單累計回填、匯出 PDF 先預覽再下載、PDF 大原則（不縮放／四邊10mm／填滿才換頁／續頁表頭／頁碼；工具表單同引擎）、報價單 PDF 排版（分頁連續不重疊、切在列邊界、天地留白、續頁重印表頭、空欄不輸出）、安全母索（單／多區塊口徑與既有 Excel 逐格一致、路數勾稽、扣除構台下、特多龍繩／鋼索混用分開彙總、舊存檔遷移、活公式匯出）。

**新增功能時請一併補進 tests/smoke.js。** 其餘仍以人工驗證：用瀏覽器開 `index.html`
確認被改動的頁面渲染正常。雲端環境無法登入 Firebase 屬正常（本機資料模式仍可驗證 UI 與邏輯）。

## Firebase 安全規則

`database.rules.json` 是原始碼，**改完必須到 Firebase 主控台手動發布才會生效**。
目前規則：`fydata/shared`（名冊內可讀寫）／`fydata/private`（僅管理員），兩者都不得整包清空，
並要求 `version`／`uploadedAt` 的基本形態。

## 語言

介面與溝通全部使用繁體中文（台灣營建業用語）。
