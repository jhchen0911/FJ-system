# AI 草稿上傳：使用說明（給報價線、營運線，v6.0.190）

> 一句話：**AI 不再開 FJ 網頁跑腳本送草稿**，改用指令列工具 `tools/fy-draft.js`。它用 AI 唯讀帳號登入，把草稿 JSON 交給雲端 `fyDraft`；雲端用跟網頁一樣的算法試算，小計、稅額、含稅都對上才收。Lotion 端照舊在「AI 草稿」清單確認，畫面沒變。

```
AI（報價線／營運線）
  │ node tools/fy-draft.js submit 草稿.json
  ▼
雲端 fyDraft ── 檢查：是 AI 唯讀帳號？報價找得到？動作對得上？試算一致？
  │ 都過 → 寫 fydata/drafts（狀態：待確認）
  │         同一張報價、同一種、自己送過的舊草稿 → 自動標「已被取代」
  ▼
Lotion：總覽待辦「AI 草稿」→ 只看到最新一筆（舊的可展開）→ 確認套用／退回
```

## 一、第一次設定（每台電腦一次）

1. 電腦要有 Node 18 以上（`node -v` 看版本）。
2. 開終端機，到 FJ-system 資料夾：`cd C:\Users\jhche\Agent\my-agent\400_Project\FJ-system`，再 `git pull`。
3. 先在**測試專案**登入練習：`node tools/fy-draft.js login --env test`
   - 輸入 AI 帳號 email 與密碼（密碼不會顯示、不會存檔）。
   - 成功會顯示 `"ok": true` 和通行證存放位置（使用者資料夾 `.fj-draft\test.json`，不在 repo 裡）。
4. 測試專案練熟後，正式專案：`node tools/fy-draft.js login`（不加 `--env`＝正式）。

> 密碼、通行證不要貼進對話、不要放進 repo。換電腦或改密碼後重跑 login 就好。

## 二、送草稿

`node tools/fy-draft.js submit 草稿.json`（測試專案加 `--env test`）

草稿 JSON 一律附 `expect`：**你自己算的**未稅小計、稅額（四捨五入到元）、含稅。雲端算出來不一樣就不收，回覆會寫「你算多少、系統算多少」。

### 1. 改單（type `qchg`，報價線最常用）

```json
{
  "type": "qchg",
  "payload": {
    "qid": "（報價 id；或用 \"code\": \"報價編號\"，編號重複時會要你改用 qid）",
    "ops": [
      { "op": "set", "idx": 0, "match": "H型鋼樁打設（說明第一行）", "fields": { "qty": 120 } },
      { "op": "add", "item": { "desc": "假工項", "unit": "式", "qty": 1, "price": 5000 }, "after": { "match": "H型鋼樁打設（說明第一行）" } },
      { "op": "del", "match": "要刪的那一列說明第一行" },
      { "op": "rmk", "key": "load", "value": "20" },
      { "op": "rmkAdd", "text": "新增的自訂條款" }
    ]
  },
  "summary": "（選填）一句話說明這次改什麼",
  "expect": { "sub": 1234000, "tax": 61700, "total": 1295700 }
}
```

- **v6.0.197 起可以改成本單價與條款文字**（Lotion 11/07 開放；一樣要 Lotion 在首頁拍板卡確認才生效）：
  - 成本單價：`{ "op": "set", "idx": 0, "match": "…", "fields": { "estCost": 800 } }`（給 `""` 或 `null`＝清掉、改回倍率推估）；新增列也可以帶 `"estCost"`。卡片上會顯示成本改前→改後、這列與整張的改後毛利。
  - 範本固定條款改字（只改這張報價，不動參數設定的範本）：`{ "op": "rmkFix", "match": "本工程無保固及保留款", "text": "本工程保固一年、無保留款" }`。`match` 是範本上原本的條文（不含前面的編號），要唯一；`text` 給空白＝回復範本。有填數字的條款（載重、買斷單價、動員費、備用單價）照舊用 `rmk` 改數字；自訂條款照舊用 `rmkAdd／rmkSet／rmkDel`。卡片上條款會標紅顯示改了哪幾個字。
  - 範本那一條之後被改過（參數設定改了字），這張報價的改字就不套，照範本印，避免換錯條。
- 動作格式跟網頁 `fyQuoteChange` 完全一樣（說明見 `docs/AI改單草稿_使用說明.md`）。對位、白名單、上限也是同一份程式（`calc/qdraft.js`）。
- `expect` 是**改完以後**的整張報價金額，不是這次改的差額。
- （選填，v6.0.209）`payload.aim`＝底價與目標成交價，見下面第 4 點。

### 2. 整張報價單（type `quote`，新報價或整張改寫）

```json
{
  "type": "quote",
  "payload": {
    "base": "（改既有報價時填它的 id；新報價不填）",
    "fields": {
      "code": "報價編號", "client": "業主", "name": "工程名稱（必填）", "loc": "地點", "contact": "聯絡人", "phone": "電話", "date": "2026-11-07",
      "items": [ { "desc": "工項說明", "unit": "支", "qty": 10, "price": 1000 }, { "desc": "段落標題", "sec": true } ]
    }
  },
  "expect": { "sub": 10000, "tax": 500, "total": 10500 }
}
```

- 工項只收說明、單位、數量、單價、備註、段落、備用單價；**成本單價（estCost）不收**（成本由 Lotion 自己填）。
- 減項：單價負數、數量要大於 0。
- （選填，v6.0.209）`payload.aim`＝底價與目標成交價，見下面第 4 點。

### 3. 得標狀態（type `bid`，營運線）

```json
{ "type": "bid", "payload": { "qid": "（報價 id）", "to": "lost", "lostReason": "價格過高", "note": "業主 11/07 LINE 通知" } }
```

- `to`：`awarded`（得標）、`""`（待回覆）、`nego`（議價中）、`lost`（未得標）、`void`（流標）。已得標的案件不收。
- `lostReason` 只能是：價格過高／規格不符／工期不符／業主關係／未回應／其他。
- 得標狀態沒有金額，不用 `expect`。

### 2b. 報價單草稿多帶成本與圖說疑義（v6.0.232，選填）

```json
{ "type": "quote", "payload": { "fields": { … }, "est": [ { "i": 1, "cost": 700 } ], "issues": [ "S2 開挖深度與 A1 不一致" ], "aim": { "floor": …, "target": … } }, "expect": { … } }
```

- `est`：AI 估的成本單價（未稅），`i`＝`fields.items` 第幾列（從 0 起）。只有管理員看得到，確認時存成報價的成本單價。
- `issues`：圖說疑義，一條一句。
- 今天頁報價卡會列三個價（底價、目標價、報價）、毛利、異常單元（跟成交單價庫平均差超過 ±15%、或低於成本）、圖說疑義；**Lotion 按確認就直接存成正式報價**，按修改才開編輯頁。

### 3b. 合約條件卡（type `ownerCard`，v6.0.232）

contract-check 產出的合約條件卡（格式 `fj-contract-card/1`）整份放進 `card`：

```json
{ "type": "ownerCard", "payload": { "qid": "（報價 id）", "fname": "○○案_合約條件卡.json", "card": { "schema": "fj-contract-card/1", "project": "…", "owner": "…", "retention": { … }, "billing": { … }, "rent": { … } } } }
```

- 每欄照原本格式 `{value, source, evidence:{clause, quote}, note}`；**租期起算 `rent.startRule`、含租期天數 `rent.includedDays` 一定要讀出來**，卡片沒寫的話 FJ 會標紅請 Lotion 對合約。
- 新欄位 `rent.lateRate`（逾期租金單價）：寫合約裡的單價與單位，FJ 拿來跟報價工項的逾期租金單價比，只存在卡片上。
- 雲端只收純資料（欄位名稱只能英數 `_` `-`，上限約 60KB），不用 `expect`。同一案再送一張，舊的會被標成已取代。
- Lotion 在 FJ 今天頁的「合約條件卡」拍板卡看逐欄值與條次原文（跟專案不同的標紅、舊值 → 新值），按確認才寫進專案；合約未載明（豐有預設）的欄位不寫。

### 3c. 廠商回價（type `rfqReply`，v6.0.232）

廠商回傳的報價（照片／PDF）讀成草稿：

```json
{ "type": "rfqReply", "payload": { "qid": "（報價 id）", "rno": "RFQ-…-01", "vendor": { "name": "○○工程行", "contact": "…", "tel": "…" }, "recv": "2026-11-12",
  "prices": [ { "match": "H型鋼樁打設", "price": 2500 }, { "idx": 1, "price": 800 } ],
  "lump": { "total": 380000, "match": ["水平支撐"] },
  "extras": [ { "name": "水泥", "amt": 3000 } ], "diffs": [ "不含引孔" ], "note": "兩台打樁機", "src": "LINE 收件 11/12" } }
```

- 只收已得標的案子；每一項用 `idx`（報價工項第幾列，從 0 起）或 `match`（工項說明第一行的一段，要剛好對到一項）。單價都是**未稅**。
- `lump` 一式總價要列涵蓋哪些工項；`extras` 是要豐有自己提供的材料或其他成本（比價會加進去）；`diffs` 寫跟詢價範圍不一樣的地方（FJ 會標紅）。
- `rno` 是詢價單號（詢價單 PDF 上有）；沒給的話，FJ 找涵蓋這些工項的那一張，剛好一張才對得上。
- Lotion 在今天頁「廠商回價」卡確認才記進詢價單；同一張詢價單回價 2 家以上（或過了回覆期限有 1 家）會出「比價」卡，選定廠商後開原本的評估得標畫面建分包成本卡。

### 3d. 詢價收件（type `inquiry`，v6.0.232，HQ inquiry-intake）

```json
{ "type": "inquiry", "payload": { "name": "○○新建工程擋土支撐", "client": "○○營造", "loc": "…", "contact": "…", "phone": "…", "email": "…", "recv": "2026-11-11", "due": "2026-11-20",
  "mail": "來信摘要…", "drawings": [ { "name": "A1 平面圖", "url": "https://…" }, "S2 斷面圖" ], "files": [ { "name": "估價單", "url": "https://…" } ],
  "missing": [ "地質鑽探報告" ], "ask": "索取資料的訊息草稿", "munger": { "verdict": "有條件接", "line": "一句話結論", "risks": [ "風險一", "風險二", "風險三" ] }, "src": "Gmail 11/11" } }
```

- 一定要有 `name`，`mail`（來信摘要）和 `drawings` 至少一個。附件只存連結（只收 https），不上傳檔案。
- `munger.verdict` 只能是「接／有條件接／不接」，風險最多 3 個。
- Lotion 在今天頁「詢價收件」卡選「接」或「有條件接」（要寫條件）並確認，FJ 建報價單殼（取報價編號、帶入工程資訊與來信摘要）並複製索取資料訊息；不接＝退回。

### 4. 底價、目標成交價（v6.0.209，改單、報價單都可以帶）

```json
{ "type": "qchg", "payload": { "qid": "…", "ops": [ … ], "aim": { "floor": 1050000, "target": 1150000 } }, "expect": { … } }
```

- `floor`＝底價（再低就不接）、`target`＝目標成交價（希望議價後落在這裡），**都是含稅**、都選填，底價不能高於目標成交價。
- 只存在報價的內部欄位（跟成本一樣只有管理員看得到），**不會印在報價單或任何給業主的文件上**。Lotion 按確認、報價存檔成功才寫進去。
- 要參考過去的得標率：`node tools/fy-draft.js bid-stats`（下面第五節）。

### 回覆長這樣

成功：
```json
{ "ok": true, "id": "dxxxxxx", "summary": "…（未稅 11,000 → 13,000）", "superseded": ["較早那張的 id"] }
```
失敗（結束碼 2，什麼都沒寫進去）：
```json
{ "ok": false, "status": 400, "error": "試算對不上：稅額 你算 600、系統算 650", "detail": [ …每個動作的對位結果… ] }
```

## 三、列出、撤回

- `node tools/fy-draft.js mine`：列出**自己送的、還在待確認**的草稿（id、種類、時間、摘要）。
- `node tools/fy-draft.js withdraw <草稿id>`：撤回一張。只能撤回自己送的、還在待確認的；已套用、已退回、別人的都會被擋。
- 同一張報價再送新的同種草稿，舊的會**自動**標「已被取代」，不用先撤回。補登版次（V2、V3）是不同的事，不會互相取代。

## 三之一、LINE 收件匣：建議歸檔（v6.0.191）

AI 處理過的 LINE 收件（下載了、交給報價線了、建了草稿），寫一筆「建議歸到哪個案件」，Lotion 在總覽的「LINE 收件歸檔」拍板卡**一次確認全部**，不用一件一件按。

- `node tools/fy-draft.js inbox`：列出未歸檔的收件（id、時間、檔名、備註、已有的建議）。
- `node tools/fy-draft.js inbox-suggest <收件id> --qid <報價id> --why "已交給報價線"`：建議歸到某張報價。
- 還沒建報價的：`--case "範例營造 內湖案 詢價"` 代替 `--qid`。
- `--why` 寫你做了什麼（例：已下載、已交給報價線、已建草稿 dxxxx），Lotion 在卡片上看得到。
- 已歸檔的不能再建議；建議被 Lotion 退回後可以重新建議。超過 7 天沒處理（沒有建議）的件，只會列在卡片裡，不再逐件提醒。

## 三之一、報價得標率統計（v6.0.209）

`node tools/fy-draft.js bid-stats`：回傳每個工項類別的筆數、得標率、平均讓價比例、平均比對手高幾 %、建議目標價 ±%（同類滿 5 筆才給建議）。只有數字，沒有案名、業主、金額。

```json
{ "ok": true, "n": 12, "minN": 5, "kinds": [ { "kind": "hpile", "label": "H 型鋼樁", "n": 6, "won": 2, "lost": 4, "rate": 33.3, "concPct": 4.5, "gapPct": 8.2, "ready": true, "adjPct": -4 } ] }
```

- `concPct`＝得標案的平均讓價比例（第一版報價 → 成交價）；`gapPct`＝沒得標案平均比對手高幾 %（有填對手價的才算）。
- `adjPct`＝建議目標價調整：得標率低於 40% 往下（有對手價＝平均差距的一半，沒有＝每少 10% 降 1%，最多 10%）、高於 60% 往上（每多 10% 加 1%，最多 5%）、中間不動。**只是建議，系統不會自動改任何報價。**
- 從 v6.0.209 上線那天起才開始記，舊案不補。

## 四、哪些不走這個工具

- 只開 `qchg`、`quote`、`bid`、`ownerCard`、`rfqReply`、`inquiry` 六種。發票照片、客戶·廠商、補登版次等照舊從網頁或原本的方式送。
- 這個工具只能寫草稿，**不能改正式資料**；正式資料一律要 Lotion 在 FJ 按確認。

## 五、出問題

| 看到 | 原因 | 怎麼辦 |
|---|---|---|
| 還沒登入 | 這台電腦沒跑過 login | 照第一節第 3、4 步 |
| 通行證失效 | 改過密碼、或在 Google 帳戶撤銷 | 重跑 login |
| 只有 AI 唯讀帳號能用這個工具 | 用的不是唯讀名冊裡的帳號 | 換 AI 帳號登入 |
| 試算對不上 | 你算的金額跟系統不同（常見：稅額沒四捨五入、把差額當總額） | 照錯誤訊息改 `expect`，或檢查動作有沒有改到想改的那一列 |
| 有動作對不上 | 報價被改過、列號或說明第一行不一樣 | 先讀最新報價再組動作 |
| 呼叫失敗、HTTP 404 | 雲端程式還沒部署 | 推 main 後「Firebase 自動部署」會部署 fyDraft；看 GitHub Actions 綠燈 |
