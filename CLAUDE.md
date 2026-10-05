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

1. **每次修改必須升版號**：搜尋 `APP_VERSION='v6.0.NN'`（只有一處），流水號 +1（v6 正式版自 v6.0.21 起；不再加 `-beta`）
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

## v6 正式版（2026-10-04 上線）與開發流程

- **`main` 的 `index.html` 自 v6.0.21 起即為 v6 正式版**（2026-10-04 由 redesign-v6 v6.0.20-beta 轉正）。之後所有修改直接在 `main` 進行，照上面的修改規則：升版號 → `tests/smoke.js` 全過 → commit＋push。分支 `redesign-v6` 已完成任務，不再更新。
- **回滾**：v5 正式版備份在分支 `stable-v5.449`（上線前最後一版）與 `stable-v5.448`。要退回 v5：`git checkout stable-v5.449 -- index.html` 後升版號推 `main`。v5 與 v6 資料互通（實測：v6 讀 v5 資料不改既有欄位，只新增 `q.mat`／材料攤提參數／分頁記憶鍵；v6 存回後 v5 仍可原樣讀回），退回不需要轉資料。
- **v5 → v6 資料面唯一的一次性變更**：`_v6PermMigrate()`——系統管理員第一次登入 v6 時，把各角色舊頁權限對映到新頁（projects|costs|contracts|progress→`proj`、materials|costs|projects→`rfq`、finance|ledger→`acct`、profit|reports→`reports`），旗標 `pagePerms.__v6perm=2`。上線後請到「角色權限」確認各角色勾選。
- **測試版 `beta.html`** 仍保留為沙盒：`python3 tools/build-beta.py index.html beta.html` 由同一份 index.html 產生（localStorage 鍵走 `beta:` 前綴、第一次開啟從正式版複製一份、所有上傳雲端函式改空操作、左下角橙色「β 測試版」chip 可重新複製）。要讓使用者先試再上線的大改動，先只推 beta.html 到 `main`，驗過再改 index.html。**beta 裡輸入的資料不會進正式版**。
- **混用期注意**：部署後所有裝置都要重新整理到 v6。仍停在 v5 的裝置存檔時會把報價裡 v6 新增的 `rfqs`／`mat`（走 private 的報價敏感欄位）整筆覆蓋掉。
- v6 新架構（盤點已確認）：報價（含議價、案場細節、詢價單回填）／工程專案一頁式／發包（分項詢價→比價→得標或點工，`rfq.js` 區塊：`renderRfq` `rfqNew` `rfqFill` `rfqAward` `rfqLabor`，資料 `q.rfqs` 走 private）／日報．支出／計價（業主＋廠商）／帳務（應收應付、零用金、薪資）／報表（內部＋股東版）。施工成本改為工程專案內的統計分頁；材料管理併入發包的材料採購；施工進度併入工程專案（預定＋實際雙層）。**工程專案一頁式**（頁 `proj`，`proj.js` 區塊：`renderProj` `_pjStat`（含追加案彙總：合約 base／議價 origPrice／請款／收款／分包 `_subStat`／應付／日報／實體進度）、`_pjTimelineHtml` 8 步、區塊 `_pjItemsHtml`（`_qtyRecon`＋`_itemProgress`）／`_pjInvHtml`／`_pjSubHtml`／`_pjCostHtml`（`_costSummaryStrip`＋`buildCostAnalysisHtml`）／`_pjSchedHtml`（預定取 `_pgState`（專案名稱相同）、實際取日報）／`_pjLogHtml`／`_pjCloseHtml`；`openProj(qid)`；區塊收合記在 `pj_open_<id>`）；舊「專案管理」卡片頁隱藏（parent proj，表頭「舊版卡片」可進，合約檔／工作確認單上傳仍在那裡），手機底部「專案」改開工程專案。**日報．支出精簡（v6.0.9）**：支出改「點類型晶片 → 填金額 → 多筆一起送出」（`qc6.js` 區塊：`QC_TYPES[[名,科目,預設掛專案,需說明]]`、`qcAdd`／`rQcPending`／`qcToggleProj`／`_qcCommit`／`submitQuickCost`）；工務車加油／維修／停車／過路／電話／禮品交際預設公司費用（紫底）可切專案；「其他」必填說明並寫 `review:true`（零用金明細標「待審」）；日報選專案時同步支出專案；對應工項下拉已移除（`linkedItemIdx:-1`）。**攤提參數已定**：`P.matRentRate={H300:3,H350:4,H400:5}`（$/m/天）、`P.matRentFactor=0.8`、`P.matLossAccrue=true`、單位重 H300 93／H350 135／H400 172 kg/m（`MAT_UNIT_W`）；內部租金法＝支數×單長×使用天數×日租×折數，損耗支以購置單價認列，待「材料併入發包」步實作。**計價頁（v6.0.10）**：頁 `invoice` 改名「計價」，分頁 `invTab('owner'|'vendor')`（記 `fy_invTab`）：業主請款＝原請款單列表＋「本月尚未開單」橫幅 `_invMonthBanner`／`_invMonthGaps`（本月有日報回報數量、無本月請款單 → 「開下一期」`addNextPeriod`）；廠商請款＝全公司分包合約工作台（`bill6.js` 區塊：`_vbRows` 狀態 pending／billed／follow／done／idle、`renderVendorBilling`（KPI、待登錄 `_subCurEstimate`、本期已登錄（`_vendorCutDate` 起）、全部分包總表＋篩選 `vbFilter`）、徽章 `_vbBadge`）。登錄／修改／核對單／預付款／刪除／退保留款沿用施工成本家族函式（皆以 `eid` 為脈絡）→ `_vbCtx(qid)` 先 `loadQ` 再 `go('invoice')` 回廠商分頁（`vbOpenPeriod`／`vbAdvance`／`vbPrint`／`vbDelPeriod`／`vbRelease`）；`rCostItems()` 開頭呼叫 `_vbRefresh()`，停在廠商分頁時存檔即重繪（彈窗開著不重繪）。支出晶片：不顯示「公司費用」小字，括號字樣縮小成第二行、按鈕等高 50px。`_pjKpi` 帶 onclick 時 style 屬性多一個引號（KPI 失去框線／寬度）已修。**手機堆疊「一行一行」模式（v6.0.11）**：`_MST_LINE={proj-root,vb-root,rfq-root,cost-list}` 的表加 `mst-ln`——首格當卡片標題、其餘每格一列「欄名｜值」、按鈕格靠右、合計列（tfoot 也標 `data-th`）逐行；工具頁仍為原兩欄卡片。v6 新報表類頁面把根節點 id 加進 `_MST_LINE` 即可。**材料併入發包（v6.0.13）**：發包頁分頁 `rfqTab('rfq'|'mat')`，`mat6.js` 區塊：資料 `q.mat={rows[{id,name,spec,len,unit,qty,rate,rentVendor,rentPrice,rentMonths,note}],use[已結算使用段],loss[損耗],trans{vendor,trips,price}}`（private，`_stripQuoteSens`／`_extractQuoteSens`／`_applyQuoteSens` 一併處理）。台帳 `MAT_LEDGER` 列的 `loc` 是材料位置：`matOut`（彈窗挑公司倉庫列）→ `_matLedSplit` 拆列到工地（`loc=專案名、projQid、outDate、matRowId`）；`matBack` 歸還拆回倉庫＋結算 `use`、損耗寫 `loss` 並扣台帳（歸零立墓碑）。**內部租金法** `_matAmortRows`＝支數×單長×`_matRateOf`（列 `rate` 覆寫，否則 `P.matRentRate[spec]`）×`_matFactor()`×`_matDays`（調撥日→歸還日／今天，至少 1 天）→ `_matSyncCost(q,'amort','材料租金',rows,'')` 寫成 `type:'own'`、`vendor:''`（公司自備不入應付）、`_fromMat:'amort'`，簽章 `_matSig` 沒變不戳 `_mt`；`renderProj`／`openProjectCosts`／材料分頁開頁都先 `_matAmortSync`＋`_matLossSync`。損耗科目 `COST_CATS` 新增「材料損耗」。租賃：列填 `rentVendor/rentPrice/rentMonths`（尚缺＝需求−工地自有 `_matShort`）→ `matRentApply` 依廠商建 `_fromMat:'rent:<廠商>'` 成本（有廠商 → `syncCostToPayable` 掛應付）、運費 `_fromMat:'trans'`。`matSeedFromEst` 由 `q.matEst.items` 以 `_matNameOf`／`_matSpecOf`／`_matLenOf` 解析只帶鋼材。材料管理頁 `materials` 改 `hidden, parent:'rfq'`（台帳／庫存／舊分配仍在）。**帳務一頁多分頁（v6.0.14）**：頁 `acct`（`acct6.js` 區塊）。`_acctMount()` 在啟動時把 `page-finance` 的 `finance-kpis`／搜尋列／`finance-ar|payable|cashflow|retention|share`、`page-ledger` 的工具列與 `.pad`、`page-payroll` 的工具列與四張卡（零用金卡→ `acct-p-petty`，其餘→ `acct-p-pay`）**原地搬進** `page-acct` 的 `acct-p-<tab>` 容器（元素 id 不變，既有 render 函式照常）；分頁 `acctTab(t)`（ar／ap／cash／ret／inv／petty／pay／share，記 `fy_acctTab`）各自呼叫原 render；`go('finance'|'ledger'|'payroll')` 在 `go()` 開頭改寫成 `acct`＋對應分頁；`switchFinanceTab` 末尾 `_acctSyncFinance` 同步外觀。`finance`／`ledger` 改 `hidden, parent:'acct'`；`payroll` 只 `hidden`（**不設 parent**，權限仍看 payroll），零用金／薪資分頁以 `_acctCanPay()`（未登入或 `canAccess('payroll')`）顯示。搬入的薪資／零用金容器各掛 MutationObserver 呼叫 `_mstack`（手機堆疊）。**股東報表**：報表中心分頁 `shareholder`（`renderShareholderReport(el,year)`／`_shRptYear(year)`／`_shRptBody(d,forPrint)`／`exportShareholderPDF`（`_toolPrint` A4 直式）／`exportShareholderCSV`）：營收＝當年請款（含保留款）÷稅率、成本＝當年 `q.costs`、費用＝`EXPENSES`（排 costRef）、人事＝當年 `PAYSLIPS` gross＋coCost（無則 `_shareAutoCalc.salary` 推估）、各案用 `_pjStat`、分潤口徑同分潤頁（`_shareCfg`＋`_shareAutoCalc`）、業務 `_bidStat`；`exportCurrentReport`／`exportCurrentReportExcel` 開頭攔 shareholder。**參數設定分組（v6.0.15）**：`prm6.js` 區塊 `_prmMount()` 啟動時把 `page-params` 的卡片搬進六個分頁容器 `prm-g-<co|bill|cost|cash|upa|sys>`（`prmTab(g)` 記 `fy_prmTab`）；原「稅務設定」卡依欄位 id 拆成 計價與報價（ptax／pohd／prmrate＋固定成本明細 `fixed-cost-rows` 區塊）、成本與廠商（plabor／pequip／pvcutday／pvpayday／pvpaydelay／pvsubbill／pdrgap＋新欄位 `pmat-h300|h350|h400`／`pmat-factor`／`pmat-loss`）、資金（popen／popendate／popres／popresamt）；單價分析成本參數卡的小節（綠字標題＋後續節點）由 `_prmFoldUpa` 包成 `details.prm-sec`；`prmSearch(q)` 跨分頁篩 `.f`（label／id／hint）並展開命中小節。`doSaveP` 讀 `pmat-*` 寫 `P.matRentRate`／`matRentFactor`／`matLossAccrue`，`syncParamsUI` 回填。**新增參數欄位時放進對應分頁卡的 `.fg`，id 照舊給 doSaveP／syncParamsUI 讀寫即可。****上線前收尾（v6.0.16）**：`_v6PermMigrate()`（`applyRoleUI` 開頭呼叫，僅系統管理員且 `pagePerms.__v6perm` 未設時執行一次）把角色 `pages` 的 projects|costs|contracts|progress→`proj`、materials|costs|projects→`rfq`、finance|ledger→`acct`；`rolePerm` 列出 `!hidden||permListed`（payroll 加 `permListed:true`）。`costs`／`progress` 改 `hidden, parent:'proj'`；手機底部列 `MOB_BOTTOM_NAV=[dash,quickcost,projects,proj,invoice]`（`mn-quickcost`，報價在更多）。總覽 `updateDashTodo` 排序前呼叫 `_v6TodoItems(items)`：`vb_pending`（`_vbRows` pending）、`inv_month`（`_invMonthGaps`）、`mat_site`（`_matLedAt` 重複性，≥120 天 urgent）。**經營報表（v6.0.17）**：`reports` 成為可見頁（label 經營報表），`profit` 改 `hidden, parent:'reports'`，`go('profit')` 在 `go()` 開頭改寫為 `reports`＋`_currentReport='overview'`；`rpt6.js` 區塊 `renderOverviewReport(el,year)` 把 `#profbody`（參照存 `_profBodyRef`，避免被 innerHTML 換掉後找不到）搬進 `report-content` 再呼叫 `rProfit()`，前面加 `_rptBasisStrip(year)`（`_shRptYear` 權責＋`_rptCashYear` 現金）。年度損益 `renderYearlyReport` 每列加 `pretax=_shRptYear(y).pretax`。**口徑原則：全站主口徑＝權責（請款未稅 − 施工成本 − 公司費用 − 人事），由 `_shRptYear` 單一來源；現金口徑另列。** `_v6PermMigrate` 版本 2 加 `set('reports',pg.profit||pg.reports)`，旗標 `__v6perm=2`。**詢價回填（v6.0.18）**：`rfqAward` 視窗勾選 `rfq-backfill`（預設勾）→ `_rfqBackfillEst(q,r,v)` 把 `_rfqVendorPrice`（議價優先）寫進 `q.items[it.idx].estCost`（字串）＋`estCostSrc`，編輯器已載入同報價時同步 `items[]` 並 `rItems()`；`r.award.backfilled` 記筆數，詢價卡顯示。**租賃合約與逐期請款（v6.0.19）**：自有成本卡 `rental:true`（`rent6.js` 區塊）：`rows[{id,preset,desc,qty,unit,unitPrice,per:'day'|'month'|'trip'|'once',from,to}]`＝計價基準，`periods[]` 與分包同形；`syncCostToPayable` 開頭：rental 有期別走 `_syncSubPeriodPayables`（label 租金請款、category material），無期別撤未付整筆；`recalcCostAmt` rental 卡 `amt`＝各期 `_subPeriodCalc` 合計。登錄 `openRentPeriod(cid,editNo)`（eid 脈絡）→ `_rpSuggest`（日租列 在場×天數、月租列 ÷30）→ `_rpSave`（加項以 `per:'once'` 新列掛進 c.rows）；`_rentEstimate(q,c)`／`_rentStat(c)`；`_ownRentHint` 覆寫為 `_rentCardHtml`＋原 `_ownRentHint0`；`printVendorStatement` 對 rental 卡可印單期（own 列 desc／preset）。材料分頁 `_matRentSectionHtml`：`q.mat.rows[].rentVendor|rentQty|rentFrom|rentTo|rentRate|rentTrans`（舊 rentPrice 月租÷30 遷移）＋`q.mat.equip[{id,name,vendor,qty,from,to,per,rate,transPrice}]` → `matRentApply` 以 `_matSyncCost(q,'rent:<v>'|'erent:<v>',cat,rows,v,{rental:true})` 建卡（列合併保留已請款引用的 id）。計價頁 `_vbRows` 納入 rental 卡（`r.rental`，status billed／pending／idle／done），`vbOpenPeriod` 依卡型開 `openRentPeriod`。`COST_CATS` 加 設備租金／設備運費；`OWN_PRESETS` 加 設備租金／設備運費／損耗賠償。**租賃成本管控層（v6.0.20，`v620.js` 區塊）**：登錄視窗 `_rpSysCalc`（系統數量＝在場×天數，列 `data-sys`）→ `_rpRecalc` 即時「廠商／系統／差」提示、`_rpSave` 存 `pr.sys`，`_rentPeriodDiff(c,per)` 供卡片 chip 與核對單（`printVendorStatement` 租賃列印「在場」＋「系統 N（差 ±）」）。預估合約 `_rentPlan(q,c)`＝在場量×預計天數×單價＋運費 2 趟，預計退場 `_rentPlanEnd`：列 `to` → 卡 `c.planEnd`（`rentPlanEnd` 於卡上編輯）→ 施工進度預定最晚完工 → 日報拔除完成 → 至今（`open:true` 標示）；`rate`＝(已請款＋本期預估)÷預估。材料分頁 `_matUnitCmpHtml`（同規格 自有攤提 vs 料場日租、至今各花多少、`_matBuyPerPc` 租幾天＝買 1 支）；`_matAmortRows` 列帶 `spec/len`。`_costOwnBreak(q,onlyUn)` 拆 攤提／購置／租金／運費／損耗＋`rentEst/rentPlan/rentOpen` → `_costSummaryStrip` 覆寫（租金 chip、運費／損耗 chip）與 `buildCostAnalysisHtml` 的 `_costUnRowsHtml`（租金列預估欄＝預估合約、執行率），其餘才列未歸戶。小數單價顯示用 `_rfmt`。

## 雲端工作階段（claude.ai/code、手機 App）額外規則

部署＝push 到 `main` 後 GitHub Pages 自動上線（約 1 分鐘）。

- **使用者已授權「以後直接推 main」（2026-09-11）**：改完升版號、跑過
  `tests/smoke.js` 全過之後，**直接 commit＋push 到 `main`**，不用開 PR、不用等合併
- push 前一定要先 `git fetch origin main` 並確認本機是最新的，避免推不上去
- 回覆一律列出：版本號、改動明細、以及「已上線，約 1 分鐘後重新整理即可（標題列應顯示 vX.XXX）」
- 例外：改動很大或使用者明說要先看過時，才改走分支＋PR

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
| 報價編輯 | `rItems` `calcT` `saveQ` `applyNegotiate`(議價) `backfillEstCosts`；列表預估淨利率 `_quoteEstNetR`（成本單價＞報價 `_COST_ODD_X` 倍視為未填），啟動一次性 `_fixOddCostsAll` 清掉誤套的「式」成本 |
| 版次 | `bumpQVersion`(進版→封存 V1、V2…永久保留) `showQVersions` `viewQVersion` `restoreQVersion` `compareQVersion`；自動存檔＝每次儲存留一份、只留 10 份，**不是版次** |
| PDF 匯出 | `exportQuotePDF`(html2canvas 影像版) `exportQuotePDFNative`(瀏覽器原生列印)；**v5.445 套件保險**：`_pdfLibsReady`／`_ensurePdfLibs`（cdnjs→jsdelivr→unpkg 各 8 秒按需補載，開頁 4 秒後背景先補一次），`_printViaIframe` 缺套件時先補載、三來源都失敗才退回 `_printNativeHTML`；`sw.js` 對 html2canvas／jsPDF 快取優先（唯一允許改 sw.js 的理由）；`_printViaIframe` 一律先開預覽、按「下載PDF」才存檔（v5.388，所有列印鈕不再一點就下載）；分頁引擎 `_pdfPlanPages`(DOM 量測切點：只切列與列之間、天地各 10mm、續頁重印表頭；v5.446 文件高度只算到內容底緣，預覽容器不再 min-height:100%，短的橫式文件不會被手機直式視窗撐成兩頁) `_pdfAddPaged`(貼頁＋頁碼，**一律原比例、不縮放**；整份放得進一張紙才不分頁)；報價表空的逾期租金／備註欄自動不輸出 |
| 案場細節紀錄表 | 頁 `sitedet`（導覽隱藏，parent quotes；報價編輯工具列「案場細節」／專案卡進入 `openSiteDet(qid)`）。資料 `q.site`（`_sdNorm` 正規化：基地 P/A/H/slabT、`wall{form,spec,method,len,sp,n,nAuto,cap,capType}`（形式／規格／工法／壓樑／支撐規格／構台載重一律取自單價分析 `UPA_ITEMS`：`_sdWallForms`／`_sdSpecOpts`／`_sdMethodOpts`／`_sdPileSpecs`／`_sdStrutSpecs`，皆可自訂）、`mid/co/gt{spec,method,len,n}`、`layers`＋`L[{w,s,d,vc,vl,hc,hl}]`、`plat{load,A,P}`、`stairs`、`drawing`、`memo`），隨報價同步（非敏感）。派生 `_sdCalc`：支數＝ceil(周長÷間距) 可覆寫、各項總長、各層長度。進版 `siteBump` → `q.siteHist[{ver,ts,by,note,data}]`（留 30 版）、`siteShowVers`／`siteViewVer`／`siteRestoreVer`；PDF `siteExportPDF`（`_sdDocBody`＋`_toolPrint`）；`matEstFromSite(qid)` 帶入材料估算（支撐路數取第一層）；`_sdCompare`／`_sdCompareHtml`（v5.408 與報價工項對照：關鍵字＋單位配對，M 比長度、支 比支數、m² 比面積、座 比座數，0.5% 內一致；畫面卡＋PDF） |
| 單價分析 UPA | `upaCalc` `applyUPA`（套用時自動帶成本：實績優先、理論為輔）；鋼軌樁／鋼板樁工法含「引孔」時加 `db.drill`×樁長（參數 `cp-r-drill`／`cp-sp-drill`） |
| 歷史單價庫 | `COST_HIST` `writeCostHist`(結案回寫) `_histCostFor(name,unit)`(報價提示；**限同單位**，「式」實績不套到逐 M 工項) `_costOdd`(成本單價＞報價 3 倍標紅) `_costOddFix`(開單自動改同單位實績／清空) |
| 請款單 | `rInvItems` `buildInvPreview` `addNextPeriod` `settleInvItem`(工項結算，連動合約金額)；表頭 v6.0.23 起 LOGO 置於公司名左側（`.inv-hd` flex 列，LOGO 32px）、上緣留白縮小；**v6.0.22 計算式說明**：編輯頁「請款文件」列勾 `inv-calc`（存 `inv.calc`）→ 列印在估驗表下方加「本期估驗計算式」表（`_invCalcText(it,curAmt)`：數量 × 請款% ＝ 計價量；計價量（× 天數）× 單價 ＝ 金額，後接該列備註 `it.note`）；列備註桌機原有、手機卡片 v6.0.22 補 `.inv-m-note`；**本期估驗數量與累計一律加權** `_wQty`／`_curW`（打設70%＋拔除30%＝合約量），`_prevCumQty` 於 `loadInvoice` 由各期實績重算 |
| 合約 | `renderContracts` `settleContract`(竣工總結算) |
| 施工成本 | **口徑總覽（v5.444）**：承包＝分包合約，廠商每月自送請款單 → 「登錄廠商請款」`openSubPeriod` 核實數量（對照日報，差異 `sp-diff`）、單價（預設合約價，改了存 `pr.up`，`_subRowPrice`）、發票號 `per.invNo`（進應付 `invNo`），次月放款；**實作實算**：累計超過發包量屬正常（藍字提示、`_subOverStat` 算超量金額），勾 `per.absorb`＝超量自行吸收不向業主請，否則「應向業主追加」；`printVendorStatement` 改名核對單（內部核對用）。自有成本＝前置購置／租賃的材料、機具：卡片有廠商／開發票 `c.invoice`／發票號 `c.invNo`，選廠商即掛應付（`syncCostToPayable` own 分支，沒廠商＝公司自備不入應付；金流預測 3b 只算沒廠商的自有）；租賃列顯示 `_ownRentHint`（`_projRentSpan`：日報首日～拔除完成）。頁頂 `_costSummaryStrip` 類型摘要；成本分析頂 `_costRentLine` 列逾期租金（業主端收入，不進成本）；數量對照 `_qtyRecon` 分 `warns`（紅：多付風險、廠商已請未向業主請）與 `notes`（藍：實作實算超量）；業主請款單本期數量多「廠商請款 N ↵」`_invVendorSuggest`／`invFillVendor`（跟隨計價者不重複計量）。額外支出分兩種（v5.443）：**零星支出由日報．支出登錄**（`submitQuickCost` 寫入 `q.costs` type `extra`＋`src:'quick'`，施工成本頁 `_extraCostCardHtml` 唯讀呈現、可刪不可改型，判定 `_isQuickExtra`）；**廠商型額外支出（業主不給錢的追加成本，如外調機具）在施工成本頁自建**：類型下拉含「額外支出」、選廠商即掛應付（`syncCostToPayable` 類別 other、到期 `_vendorDueDate`），快速列 外調機具／加班費／追加材料／運費／油資／雜費。`rCostItems` `setCostView`(analysis/audit/qty 視圖，再按同鈕或 `_costViewBack` 回清單) `COST_CATS`(科目：動員費／打設／拔除／裝設／拆除／材料租金／材料運費／一次性材料購置／其他；舊值 `_COST_CATS_LEGACY` 只顯示不新建，下拉用 `_costCatOpts`) 承包列選工項自動帶合約生效量、備註列 `crow-memo` `_costByItem`(工項歸戶) `buildCostAnalysisHtml` `buildCostAuditHtml`(勾稽；日報出工列可點「日報」檢視／「補記點工成本」)；承包成本應付到期日 `_vendorDueDate`＝成本日期次 `P.vendorPayDelay` 月第 `P.vendorPayDay` 日（預設本月計價、下月 25 日放款） |
| 分包管理 | 承包成本（`type:'sub'`）＝分包合約：`signDate`／`entryDate`／`invoice`(開發票，預設 true → 應付 +5%)／`retRate`(保留款％，列可用 `row.ret` 覆寫)／`periods[]`(逐期計價 `{no,date,from,to,rows:[{rid,qty}],amt,ret,net,due}`，`isRet:true`＝保留款退還)。`openSubPeriod`(本期計價，依日報帶量 `_dailyQtyBetween`)／`_spSave`／`delSubPeriod`／`releaseSubRet`／`_subStat`(累計)／`buildSubMgmtHtml`(視圖 `setCostView('subs')`，專案卡 `openSubMgmt`)。**有分期後應付改逐期** `_syncSubPeriodPayables`（id `pay<cid>_p<no>`／`_r<no>`，金額＝本期未稅已扣保留款再扣抵扣預付款 `k.pay`，`vat` 依開發票；全額抵扣完的期不掛），整筆 `pay<cid>` 自動撤掉；`c.amt` 仍是發包總額（成本分析口徑）。勾稽逐期比對、數量對照多「廠商計價累計」、`printVendorStatement(cid,pno)` 可印單期（含抵扣預付款）。**v5.443 計價週期**：`P.subPayOnBill`（預設 true）＝承包成本未計價前**不掛整筆應付**（`syncCostToPayable` 直接撤、啟動一次性 `_subWholePayPrune`、卡片顯示「計價後掛應付」、金流預測 2c 改以日報已完成未計價量推估）；`P.vendorCutDay`（預設 25）＝計價截止日，`openSubPeriod` 新期預設計價日／期間迄＝`_vendorCutDate(今天)`、到期仍走 `_vendorDueDate`（次月 25）。**預付款** `c.advances[{id,date,amt,note,special,reason,est}]`：`openSubAdvance`／`_saSave`（金額＞本期預估 `_subCurEstimate`＝日報已完成未計價量×單價扣保留款 → 必須勾「特殊情況」＋原因）→ 應付 `_subAdvPayId`＝`pay<cid>_a<id>`（到期＝預付日）；各期 `per.adv` 抵扣（預設全額、`_subPeriodCalc` 封頂本期 net），`_subAdvStat`／`_subStat.advPaid|advUsed|advLeft`，`delSubAdvance` 已抵扣者不可刪。**介紹費／抽成（計價跟隨）** `c.followOf`＝主約成本 id（分包合約列「計價跟隨」下拉）：主約 `_spSave`／`delSubPeriod` 後 `_subFollowApply` 讓跟隨者自動產生同期別、同期間、同數量的計價（列以 `linkedItemIdx` 對應，金額＝數量×跟隨者單價）並掛應付；跟隨者不可自開計價（`subFollowSync` 可手動重算），主約卡顯示 `_subFollowSummary`「風哥（＋150／M）合計 700／M」 |
| 金流 | `updateFinanceKPIs` `renderCashForecast`(90天水位預測) |
| 支出．日報 | `rQuickCost` `submitQuickCost` `submitDailyReport`(頁 id: quickcost)；日報出工 v5.406 起為**廠商列** `log.crews[{type:'sub'|'labor',vendor,n}]`（表單 `_drCrews`／`drRenderCrews`／`drAddCrew`，預設點工＋承包兩列），送出時 `_crewsApply` 彙總成相容欄位 `workers`(點工，進成本勾稽與出工月結)／`subWorkers`／`subVendor`；舊日報用 `_crewsOf` 還原、`_crewsText` 顯示；選工項 `_drAutoVendor` 把 `_itemSubVendor` 填進承包列，進度提示列顯示「發包 廠商」；廠商績效 `_vendorStats` 逐家累計出工並加 `billed`(分包已計價)；金流預測 2c) 分包合約日報已完成未計價量 → 推估下期付款；進度列即時提示 `_drRowHint`；工項數量四方對照 `_qtyRecon`/`buildQtyReconHtml`(施工成本頁「數量對照」：合約量／日報回報／發包量／業主請款累計)；請款單本期數量可點「日報 N ↵」帶入 `_invDailySuggest`/`_dailyQtyBetween`；施工進度工具 `_pgFillFromDaily` 由日報回填實際進度；自有機具逐台 `P.equipList`→`_drRenderEquip`／`log.equip[{name,hrs}]`，出工月結 `_equipUsage`；金流預測 `_projPhysProgress` 推估尚未開單的下一期請款；廠商績效 `_vendorStats` 含日報承包出工 `subDays`／工期；待辦 `dr_gap`（`P.drGapDays` 天沒日報；v5.431 改由 `_drGapState` 判定：日報 `status` 為 pause／stop 時不催、填了 `resumeDate` 過期才問、`_projStageDone` 打設完成待拔除不催；待辦附「補登停工 `drBackfillStop`（一筆帶 `stopFrom` 的狀態日報）／補日報 `drGoReport`」）；日報表單「作業狀態」`dr-status`（施工中／**階段完工 `stage`**（v5.442：`stageOf` install＝打設完成待拔除、remove＝全部完工；`stageDate` 完成日）／明起暫停／停工＋原因＋預計復工／下階段進場日）可單獨送出；`_itemProgress` 把階段完工日納入：`installLast`＝max(數量日報最後一天, 打設完成日)、`doneDate` 補齊（`_rentStatus.estimated` 轉 false）、`removeFirst` 無拔除數量時取拔除完成日；`_projStageDone` 以 `_drLatestStage` 為準；專案卡 `_drProjChip` 顯示暫停／停工／待拔除小標；**同日再送出＝合併** `_drMergeLog`（同工項同期別覆蓋、其餘新增、出工有填才取代、照片累加、狀態有填才更新），表單 `_drExistingBanner`／`drLoadExisting` 提示並可載入既有內容修改；支出表單「支出人」`qc-payer`（預設登入者，空＝公司付款）寫入 `cost.payer`／`payBy`，供零用金結算彙總；**v5.437 專案下拉多「公司費用（不掛專案）」`__co__`**（禮品交際、油資、文具…）→ 寫入 `EXPENSES`（`{note,cat,payer,payBy,src:'quick'}`，帳務日常費用＋利潤頁年度費用），非管理員經 `fydata/relay/expenses` 接力 `_pushRelayExpenses`／`_pullRelayExpenses`；`QC_TYPES` 含加油／ETC／禮品交際／文具郵電，**油資等實報實銷一律在此登錄、不列薪資**；專案頁「日報」檢視 `viewDailyReports`（v5.432 篩選期間／狀態／工項／關鍵字 `_drFilterLogs`，統計施工／停工／暫停天數 `_drvSummary`；匯出 PDF `drExportPDF`（A4 橫式、可含照片、走 `_toolPrint`）／Excel `drExportXlsx`；列資料 `_drLogRow` 共用）內 `editDailyLog`／`delDailyLog` 可修改刪除（重算 progressRows）；選工項後 `_drAutoVendor` 自動帶該工項的發包廠商 |
| 智慧收件 | `smartIntake` `aiClassifyDoc` `_intakeRoute`（Claude API 影像辨識） |
| 人員薪資 | 頁 `payroll`（adminOnly）。`HR[]`（基本資料：生日／性別／地址／電話／緊急聯絡人／身分證／銀行；薪資設定：`payType` month/day、`base`、`telAllow`(電信津貼列薪資)、勞健保「級距＋公司／個人金額」`laborGrade/laborCo/laborSelf`、`healthGrade/healthCo/healthSelf`、`dep` 眷口、`pensionCo/pensionSelf`、`pettyQuota` 零用金定額；`sid` 連回名冊，無帳號員工可直接建）、`PAYSLIPS[]`（`ps_<hrId>_<YYYY-MM>`：`baseAmt/tel/other/extra/gross`、`laborSelf/healthSelf/pensionSelf/otherDed/ded/net`、公司負擔 `coCost`、`status` draft/paid）。**兩者皆 private**（`_PRIV_COLLS` hr／payslips、本機 `fy_hr`／`fy_payslips`、`_mergeColl` 合併）。`_hrCalcIns`(級距→金額，費率 `P.hrRates`／`_HR_RATE_DEF`) `hrEdit` `psGenerate` `psUpd` `_psCalc` `psExportSlipPDF/psExportSlipsPDF/psExportSummaryPDF/psExportXlsx`；油資／ETC 實報實銷不列薪資（走日報．支出→零用金） |
| 零用金 | 同頁 `payroll` 第三卡。支出來源除 `q.costs` 外，v5.437 起含 `EXPENSES` 中 `src:'quick'` 且 `payer`＝員工者（專案欄顯示「公司費用」）。`PETTY[]`（private，本機 `fy_petty`；`pc_<hrId>_<YYYY-MM>`）。支出來源＝`q.costs` 中 `type:'extra'` 且 `payer`＝員工姓名（`_pcItems(name,ym)` 跨專案、帶專案名）。口徑 `_pcCalc`：可用＝上月剩餘 `carry`＋上月領取 `draw`（首月 draw＝定額）；`spent`＝當月支出＋`adj`；`remain`＝max(0,可用−支出)；`advance` 代墊＝max(0,支出−可用)；`topup` 補足＝定額−剩餘；`payout` 應付＝補足＋代墊；次月 carry＝上月 remain、draw＝上月 topup（`_pcBuild`，已發放者鎖定不重抓）。`pcGenerate` `pcUpd` `pcPaid` `pcDetail` `pcExportPDF/pcExportAllPDF/pcExportXlsx` |
| 薪資／零用金連動 | `_hrSyncPayables(ym)`（renderPayroll／psUpd／pcUpd 觸發）：薪資實發 → 應付 `pay_ps_…`（到期＝次月 `P.salaryPayDay` 日，預設 5；`vat:false`，類別 `salary`）、勞健保＋勞退（公司負擔＋員工代扣）每月一筆 `pay_ins_<ym>`（次月底）、零用金補足＋代墊 → `pay_pc_…`（類別 `petty`）；狀態雙向（薪資條／結算標發放 ↔ 應付頁 `confirmPayment`），刪除即撤應付並立墓碑。`_hrMonthlyCost()` 依設定推估（日薪取最近薪資條天數或 `P.hrDayEst`）；`hrWriteFixedCost` 寫進 `P.fixedCosts` 的薪資列；金流預測 4) 固定成本排除薪資列、4b) 未產生薪資條的月份以推估排在發放日；報表中心 `renderHrReport`（分頁 `hr`）；待辦 `hr_pay` 上月薪資條未產生 |
| 人員進場資料 | 頁 `workers`（資料與工具，`wk-root`）。`WORKERS[]`（**shared、逐筆同步** `_REC_COLLS`，本機 `fy_workers`）：`name/sex/idNo/birth/blood/phone/regAddr/mailAddr(+mailSame)/emg/emgRel/emgPhone/company/title/status/memo`、`docs{photo,idF,idB,nhiF,nhiB,oshF(exp),oshB,health(exp),drug(exp),sign}`（`{du,name,ts,exp}`，影像 1000px JPEG、PDF 3MB 內）、`certs[{id,name,no,exp,du}]`。`_WK_DOCS` 槽定義（`exp:true,yrs`）、`_wkExpiries` 效期清單→待辦 `wk_exp`（60 天內／已過期）；編輯用草稿 `_wkDraft`（`_wkSnapFields` 先收欄位再重繪文件區）；`wkAiFromId` 拍身分證／健保卡 AI 帶入；`_wkSheetHtml`／`wkPrintSheet`／`wkPrintAll`（`_toolPrint`）、`wkExportXlsx`。**業主表格自動填入**（v5.439）`wkFillOwnerForm`：`_zipRead`（DecompressionStream deflate-raw）→ `_xlsxParse`（sharedStrings／inlineStr 列出有字儲存格）或 `_docxParse`（tc／段落）→ `_wkAiMap`（AI 回 `{mode:single|roster,targets|roster}`；範本記憶 `P.wkTpl[檔名|大小]`，預覽 `_wkOFPreview` 可改對應）→ `_xlsxSetCell`（保留 s、缺格依欄序插入、缺列新增）／`_docxFill`（第一段補 run 沿用 rPr、底線佔位取代）→ `_zipWrite` 下載；欄位代碼 `_WK_FILL_FIELDS`／`_wkFieldValue`（含民國日期）；圖片範本走 `_wkAiReadImage` 給對照清單；**.xls／.doc／PDF 不解析**（v5.440 `_wkOFStart` 先攔下並說明另存 xlsx／docx） |
| 權限 | 部門→角色→人員三層：`listDepts`/`listRoles`/`listStaff` `_rolesOf`(取聯集) `canAccess` `renderStaffPage` `renderRolesPage` `rolePerm`；`ALL_PAGES.sysOnly`＝系統管理員限定（單價分析／參數設定／人員／角色），`parent`＝隱藏頁跟隨母頁 |
| 備份 | `exportData`/`importData`（全量，與 `_syncPayload` 同 payload；含六大工具存檔、計畫書草稿與附件庫、報價版本歷史、材料庫存） |
| 錯誤日誌 | `_err(位置,e)` 收集器（本機最近 100 筆，不上雲）`renderErrLog` `exportErrLog`；空 catch 已全部接上 |
| 請款單壓縮 | `_invPack`/`_invUnpack`（欄位縮寫＋預設值省略，僅在儲存層；`_INV_OMIT` 之外的欄位不省略） |
| 工項類別 | `_itemCat`(打設／拔除／both／other，空＝沿用名稱關鍵字) `_isRemovePeriod`(期別，`P.removeRate` 可調) |
| 專案獎金（佣金） | 得標設定 `confirmAward` 存 `q.referral`（％基底＝合約金額未稅 `q.t.sub`，或一筆金額；`_calcCommission`），連動應付 `comm_<qid>` 依實收進度分期支付；利潤頁依 `_recvRate` 計提 |
| 工程實績表 | `renderTrackReport` `_trackRows` `exportTrackPDF`/`exportTrackXlsx`（報表中心分頁：年度區間＋逐案勾選；PDF 為 A4 橫式、表頭含 LOGO、先預覽） |
| 得標率／廠商績效 | `renderBidRateReport` `renderVendorReport`（報表中心分頁）；得標率口徑＝得標÷全部報價（`_bidStat`，除得標外皆列未得標）；業主往來／得標率／廠商績效整列可點入明細 `openRptClientDetail`／`openRptBidDetail`／`openRptVendorDetail` |
| 合約請款報表 | `renderContractReport`：同編號同名（即使掛不同報價）的重複建檔合併為一列，⚠×N 可點入 `openCtDupFix` 直接刪除未請款的重複筆 |
| 統計卡總結 | 全站 KPI 卡皆可點：報價/請款 `openQuoteKpi`/`openInvKpi`、總覽與金流 `openFinKpi`(ar/ap/cash/month)、利潤 `openProfitKpi`(net/est/recv/cost)、佣金 `openCommKpi`、客戶 `openCustKpi`、累積估驗 `openInvCumDetail`（編輯器前期累計欄點入各期組成）；請款每期預計收款日 `_invExpectedDate` 顯示於列表小字與期別 chip（逾期轉紅） |
| 信封列印 | `openEnvelope(invId|null,{custId|to})`（請款單列表 ✉／請款單編輯「✉ 信封」／客戶卡 ✉）：針對市售預印中式信封（12K 120×235、15K 105×220，`_ENV_SIZES`）只印文字——收件郵遞區號逐格（3／5／6 碼 `_envDigits`）、中欄直書 `_envVert`（每字一格、由右往左換欄，**不用 writing-mode**，字型無直排度量也正確）：地址／單位＋啟／收件人＋稱謂 收、寄件人直書、寄送方式 ✓（`_ENV_METHODS` 印刷品／限時／平信／掛號／雙掛號）；地址前綴郵遞區號 `_envSplitZip`；請款單 `sendMethod` 郵寄工地 → 用 `inv.loc`；列印走 `_printNativeHTML` 自訂 `@page size`、框線預設不印（`cfg.frames` 可印於空白信封／校正）；座標與偏移存 `P.env`（`_envCfg`／`_ENV_DEF`），公司郵遞區號 `P.coZip`，業主郵遞區號／收件人回寫 `CUSTOMERS[].zip|envAttn` |
| 收款 | `openReceiptModal(invId)`：彈窗內可切換同專案各期；專案管理每期 chip 各自帶收款鈕 |
| 票據登記 | `inv.receipts[]`（現金/票據、到期日、狀態）`_invTickets` `_cashOf` 登記模式優先；收款彈窗登記 |
| 保留款總覽 | `_retentionRows` `renderRetention`（金流管理分頁）；已完工未退標紅 |
| 催款／缺口模擬 | `_dunningText` `openDunning`；`cfSetDelay`（90天預測延收滑桿） |
| 全域搜尋 | `openGlobalSearch` `runGlobalSearch`（頂欄放大鏡／Ctrl+K／手機更多） |
| 出工月結 | `renderLaborReport`（報表中心分頁，日報出工×`P.laborDayRate` 對點工成本） |
| 修改人 | `_touch(obj)` 統一戳 `_mt`+`_by`；雲端套用只戳 `_mt`。改記錄一律走 `_touch` |
| 附件效期 | 檔案物件 `exp` 欄位 `_plAttExp`；過期進待辦並在產出文件加註 |
| 雲端同步 | `_sharedPayload`/`_privatePayload` `_pushPrivate`/`_pullPrivate` `_applySensColls` `_seedAdminUid`；報價／請款走逐筆路徑 `_perRecordDelta`，筆數暴跌由 `_syncDropGuard` 攔下，墓碑 180 天由 `_tombPrune` 清理。**v5.441 連動再生（成本→應付 `syncCostToPayable`／`_syncSubPeriodPayables`、薪資／零用金→應付 `_hrUpsertPay`、`_pcBuild`）內容沒變一律不戳 `_mt`**（`_recSig`／`_recSame`／`_keepStamp`），否則舊裝置一開頁面就會把別台剛標的已付蓋回待付；雲端與本機都有更新時不再問「覆蓋／保留」，直接逐筆合併後上傳；切到背景（`document.hidden`）有未同步變更即刻上傳 |
| 逾期租金 | `_rentDaysOf`(解析備註租期) `_itemProgress`(日報打設／拔除分開累計：`installLast`／`removeFirst`；進度列 `ph` 期別由 `_prPhase` 判定，打設兼拔除工項才看 `ph`) `_rentStatus`(v5.428 起算＝打設最後一天次日、結束＝拔除第一天，未拔除取請款日；v5.442 階段完工日報的完成日優先) `_rentScan` `invScanRent`；開單自動 `_invAfterLoad`：報價進版同步（未動草稿直接跟上 `_invSyncUntouched`，已填數量者顯示橫幅 `invSyncQuoteNow`；`inv.quoteVer` 記版次）、日報數量帶入 `_invAutoDaily`、逾期租金自動列入 `_invAutoRent`；**單價一律以報價單 `it.ot` 為準**（`_otFromQuote`），請款單裡的 `otPrice` 只是建單快照，`loadInvoice` 開單即校正 |
| 安全母索 | `_llCalc` `_llRender`（資料與工具新頁 id `lifeline`，存檔鍵 `fy_lifeline`）：形式分**特多龍繩／鋼索**（`_LL_FORM`：規格、單位重、端部作法配件各自一組，`st.form` 預設、`z.form` 逐區塊覆寫，`res.T[form]` 分開彙總、`_llMigrate` 遷移舊存檔）；分區塊×縱／橫向逐列「條數×單長」，方向總長＝Σ(條數×單長)；**總長＝層數×(基地周長＋各區塊縱橫總長) − 構台下總長×扣除層數**（與豐有既有 Excel 同口徑）；宣告路數僅與明細條數勾稽不進計算；另計每路端部錨錠預留、損耗、鋼索捲數與配件；**v5.397 起併入材料估算**（導覽隱藏、資料保留）：材料估算每層母索＝圍令周圍＋縱橫支撐路，第一層扣構台下，`ropeForm/ropeReel/ropeSpare` 決定形式、折捲與端部預留，`matEstRopePDF` 單獨出表；**存檔一律經 `_matEstNorm` 正規化**（陣列／元素／欄位補齊），`renderMatEst` 外層 try/catch 失敗顯示重設鈕，不得空白 |
| 單位 | `_uFix()`：平方公尺一律顯示 `m²`（M2／m2／㎡ 全部正規化）。只作用在單位類短字串，不碰工項說明與備註 |

## 測試

`tests/smoke.js`（430 項冒煙檢查）——每次 PR 由 `.github/workflows/smoke.yml` 自動執行。
本機跑：`npm install && npx playwright install chromium && npm test`。

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
