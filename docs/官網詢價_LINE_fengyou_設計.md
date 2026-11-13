# 官網詢價 LINE @fengyou 接進 FJ：設計（定案版，Lotion 11/13）

> 擴充線，陳軒 11/13 交辦，Lotion 已選方向：官網照樣連 @fengyou；客戶傳訊息 → 通知 Lotion → 陳軒（AI）擬回覆 → Lotion 在今天頁按確認才送。
> **Lotion 11/13 已回答 6 題（見第九節）**；程式等擴充線 ext-material-geo 推完才開工，照完整流程走（測試→審查→【待上線】→Lotion 說「上線」）。全部範例都是假資料。

---

## 一、整體流程

```
 客戶（官網「加 LINE 詢價」→ @fengyou）
        │ 傳文字／照片／PDF
        ▼
 ┌─────────────── LINE 平台 ───────────────┐
 │ ① 11 組既有自動回覆照舊回（LINE 自己回） │
 │ ② 同一則訊息另外送 webhook 給 FJ         │
 │ ③ Lotion 手機「LINE 官方帳號」App 聊天   │
 │    照樣看得到、可以直接回               │
 └──────────────────┬──────────────────────┘
                    │ webhook（簽章用 @fengyou 自己的 secret 驗）
                    ▼
 雲端新函式 fengyouWebhook（跟 @817supkw 的 lineWebhook 完全分開）
   ├ 驗簽章 → 不對就 401，什麼都不存
   ├ 文字 → 存「客戶詢價」紀錄 fydata/custInq/<id>
   ├ 圖／PDF → 立刻下載（LINE 只保留一段時間）
   │           存 Storage custInq/<id>/<檔名>
   ├ 同一位客戶 10 分鐘內的訊息併成同一筆（Q3 定案）
   ├ AI 擬回覆草稿（Claude，規則見第四節）→ 檢查禁用字
   └ 📣 通知 Lotion（經既有 aiNotify，100 字內、不含個資金額）
                    │
                    ▼
 FJ 今天頁 拍板卡「官網 LINE 詢價」
   ├ 確認 ＝ 用 @fengyou 推播把回覆送出（本月超過 150 則改成複製文字，到 App 貼；Q1 定案）
   ├ 修改 ＝ 改文字再送
   └ 退回 ＝ 不回（紀錄留著，標「不回」）
                    │ 資料夠報價（有圖說或鑽探報告）
                    ▼
 拍板卡「轉成詢價收件」（Q5 定案）── 確認 ──▶ 既有「詢價收件」草稿（type inquiry）
                                              │ Lotion 在詢價收件卡確認＝建報價單殼
                                              ▼
                              觸發點：fydata/quoteReq/<詢價id>（needQuoteReport）
                              → 報價線直接做報價報告（圖、文、選題、回覆草稿）
                    │ 附件裡有鑽探報告
                    ▼
 標 needGeo → 電腦端（HQ）讀報告、轉座標 → 送 AI 草稿 type geo
 → 拍板卡「地層資料」確認 → 進鑽探地圖舊案地層（永久，來源「官網詢價」；Q2 定案）
```

**不做的事（寫死在程式與測試裡）**
- 不自動回覆客戶：webhook 收到訊息**不呼叫任何回覆／推播 API**，只存檔、擬稿、通知。唯一會送出的路徑是拍板卡「確認」。
- 不動 11 組自動回覆：FJ 不呼叫任何改官方帳號設定的 API；回應設定裡「自動回應訊息」維持開啟（第五節步驟 6 要實測）。
- 客戶訊息不進 @817supkw 的收件匣：不同函式、不同 secret、不同資料節點（`fydata/custInq` ≠ `fydata/lineInbox`），Storage 也不同資料夾（`custInq/` ≠ `line/`）。冒煙測試檢查兩邊程式互不讀寫對方節點。

---

## 二、查證結果（第 4 點）

| 問題 | 結果 | 對設計的影響 |
|---|---|---|
| 開 Messaging API＋webhook 後，手機 App「聊天」還能用嗎？ | **可以同時開**。官方帳號管理後台「回應設定」裡「聊天」「Webhook」「自動回應訊息」各自有開關，2022 年底起聊天與 Webhook 可以並存，在官方 App 照樣看得到、能直接回。注意：Lotion 在 App 裡直接回的訊息，FJ 收不到（webhook 只送客戶傳來的） | Lotion 手機照舊；FJ 卡片會顯示「這位客戶在 App 已經回過了嗎？」看不到，所以卡片多寫一句「若已在 App 回過，按退回」 |
| 自動回應會不會被 webhook 蓋掉？ | 不會被「蓋掉」：兩個開關各自獨立，自動回應照回、webhook 照收。但**聊天開著時，自動回應有些帳號只在「非營業時間」生效**（回應時間設定），要在步驟 6 實測一次 | 上線前在測試前先截圖目前回應設定，開完再比一次 |
| 免費方案每月額度 | 台灣「輕用量」月費 0 元、每月 200 則（中用量 800 元／3,000 則、高用量 1,200 元／6,000 則；以 LINE for Business 官網當月公告為準）。**一對一聊天（App 手動回）、自動回應、用 reply token 回覆都不算額度**；用 push（主動推播）會算 | 見下一列 |
| reply token 時效 | 只能用一次，官方說要「收到後盡快用」，實務上約 **1 分鐘** 內有效，過了就失效 | Lotion 拍板一定超過 1 分鐘 → **確認後只能用 push 送（每則算 1 則額度）**，或改成「複製文字、到 App 手動貼上」（不算額度）。這是 Q1 |
| 客戶傳的圖、PDF | 用 `api-data.line.me/v2/bot/message/{id}/content` 下載；LINE 只保留一段時間，**收到就要下載**。webhook 會告訴我們檔名與大小（PDF 等檔案） | 存 Storage `custInq/<詢價id>/<順序>_<原檔名>`，單檔上限 50 MB（同送審文件）；**收到滿 1 年自動移到回收筒**（雲端排程；回收筒照 `P.trashDays` 再清）；鑽探報告的地層摘要另外永久留在鑽探地圖（Q2 定案） |
| 客戶名稱 | 用 `GET /v2/bot/profile/{userId}` 取 LINE 顯示名稱（客戶有加好友才拿得到）；沒拿到就寫「LINE 客戶（末 4 碼）」 | 卡片標題用顯示名稱；通知 Lotion 不寫名字 |

---

## 三、資料

- `fydata/custInq/<id>`（**只有管理員可讀寫**，唯讀帳號也不可讀，因為有客戶個資）：
  `{ id, uid（LINE userId）, name（顯示名稱）, msgs:[{at, type:text|image|file, text, file:{path,name,size,trashAt}}], draft（AI 擬稿）, draftWarn（禁用字檢查結果）, st:'new'|'sent'|'skip', sentText, sentAt, sentBy, via:'push'|'copy', ready（AI 判斷資料夠報價：有圖說或鑽探報告）, inqDraft（轉成的詢價收件草稿 id）, qid（詢價收件確認後建的報價 id）, needQuoteReport（true＝報價線該接手）, needGeo（附件有鑽探報告、還沒整理進地圖）, geoDraft（送出的地層草稿 id）, _mt }`
- `fydata/custInqUser/<uid>`：同一位客戶的歷史（第一次來詢價日期、詢價次數、上一次回覆時間），卡片顯示「第 N 次來問」
- `fydata/custInqCount/<YYYY-MM>`：本月用 push 送了幾則（算額度用；> 150 卡片改「複製文字」）
- `fydata/quoteReq/<詢價id>`：**給報價線接手的觸發點**（Q5 定案）。詢價收件卡確認、報價單殼建好的那一刻寫入 `{ custInqId, qid, at, st:'open', files:[Storage 路徑] }`；AI 唯讀帳號可讀；報價線用 `node tools/fy-draft.js quote-req`（新指令，雲端 fyDraft 的 quoteReqList／quoteReqDone）列出、做完標 `st:'done'`。報價報告本身照報價線既有流程送 AI 報價草稿，不在這裡做
- 地層摘要：鑽探報告整理成 `GEO_OLD` 一筆（擴充線 B-6 同一套），`src:'官網詢價'`、`folder:'官網詢價 <客戶顯示名稱縮寫>'`、`res:'open'`；之後成案就照 B-6「同一個資料夾再傳＝更新」改掛報價。原始檔一年後進回收筒，地圖上的摘要永久留著
- Storage `custInq/<id>/…`：規則只准管理員讀、雲端函式寫
- 雲端金鑰：`FENGYOU_CHANNEL_SECRET`、`FENGYOU_CHANNEL_ACCESS_TOKEN`（Firebase secret，不進 Git、不進對話）

## 四、AI 擬回覆的規則

- 擬稿用雲端既有的 Claude 金鑰（`ANTHROPIC_API_KEY`），**只擬、不送**。
- 對外文字規則（擬完再用程式檢查一次，違反就在卡片標紅、不准直接確認，要按修改改掉）：
  - 不用「您」（用「你好」或不用稱謂）
  - 不提包商、協力廠商、下包
  - 不問業主預算、不問或報任何單價、總價
  - 不承諾工期、不承諾能接
- 內容：謝謝來詢問 → 說明需要的資料（工地地點、工程概要、圖說或照片、預計進場時間）→ 會由專人聯絡。範例（假資料）：
  > 你好，謝謝詢問豐有工程。為了評估擋土支撐的做法，麻煩提供工地地點、開挖深度與範圍，有圖說或現場照片也請一起傳來，我們看過後會再跟你聯絡。

## 五、Lotion 要做的設定（**全部在電腦上做**，手機做不了第 3、4 步）

1. **先截圖**：電腦開 LINE Official Account Manager（manager.line.biz）→ @fengyou →「設定」→「回應設定」，截圖目前所有開關；再到「自動回應訊息」截圖 11 組的清單（之後比對有沒有被動到）。
2. **啟用 Messaging API**：同一頁「設定」→「Messaging API」→「啟用 Messaging API」→ 選服務提供者（**建議新建一個「豐有工程-對外」**，不要跟 @817supkw 放同一個，兩邊的客戶 ID 才不會混）。⚠️ 啟用後不能取消、也不能換服務提供者。
3. **拿兩把鑰匙**：電腦開 LINE Developers（developers.line.biz）→ 剛才的服務提供者 → @fengyou 的 channel：
   - 「Basic settings」→ Channel secret
   - 「Messaging API」→ Channel access token（long-lived）→ Issue
4. **設成 Firebase secret**（電腦 PowerShell，一次一把，貼上時不會顯示）：
   ```
   ① 開新的 PowerShell
   ② cd C:\Users\jhche\Agent\my-agent\400_Project\FJ-system
   ③ firebase functions:secrets:set FENGYOU_CHANNEL_SECRET --project jhchen-aed9a
   ④ firebase functions:secrets:set FENGYOU_CHANNEL_ACCESS_TOKEN --project jhchen-aed9a
   ```
   鑰匙不要貼到 LINE、對話或任何文件。
5. **等程式上線**（推 main 後 Firebase 自動部署綠燈），再到 LINE Developers →「Messaging API」→ Webhook URL 填上線結果裡給的網址 → Verify → 打開「Use webhook」。
6. **回應設定**：回到 Manager「回應設定」：聊天 **開**、Webhook **開**、自動回應訊息 **開**（照舊）、加入好友的歡迎訊息 **照舊**。用自己另一支手機加 @fengyou、傳一句跟 11 組關鍵字有關的話：
   - 自動回應有回 ✔
   - 官方 App 聊天看得到 ✔
   - FJ 今天頁出卡、Lotion 收到 📣 ✔
   三項都對才算上線完成；自動回應沒回就截圖給陳軒（多半是「回應時間」設定，要調成全天）。

## 六、拍板卡（手機 390 寬）

```
┌ 今天要做的事 ─────────────┐
│ 官網 LINE 詢價 2 則        │
├───────────────────────────┤
│ 王小明（第 1 次來問）     │
│ 11/13 14:05～14:08 3 則   │
│ 「台中北屯 地下室開挖     │
│  深 9 米 想問擋土」       │
│ 📎 平面圖.pdf  📷 ×2      │
│ ── 擬回覆 ──               │
│ 你好，謝謝詢問豐有工程。…  │
│ ✔ 沒有禁用字              │
│ 送法：推播（本月第 12/200）│
│ 若已在 App 回過，請按退回  │
│ [退回]  [修改]  [確認]     │
└───────────────────────────┘
```
- 確認前要展開明細看完（照片、PDF 載入完才解鎖，同既有拍板卡）。
- 禁用字被標紅時「確認」不能按，只能修改或退回。
- 第二張卡「轉成詢價收件」（資料夠報價才出）：明細＝客戶訊息、附件、AI 讀出的工地地點／工程概要；確認＝建既有詢價收件草稿（type inquiry，之後在「詢價收件」卡選接／有條件接才建報價單殼）；退回＝先不轉；修改＝改工地地點、工程名稱再轉。

## 七、通知 Lotion

- 經既有 `aiNotify`（推到 lineCfg/owners，也就是 Lotion 的 @817supkw 好友），文字固定格式、100 字內、不含客戶名稱與電話、不含金額：
  > 📣 官網 LINE 有新詢價 1 則（附件 2 個），回覆草稿已擬好，到 FJ 今天頁「官網 LINE 詢價」看。
- 同一位客戶 10 分鐘內的多則訊息只通知一次。
- **晚上 10 點到早上 8 點也馬上通知**（Q6 定案：Lotion 選 A）。
- 官網詢價的通知另外計數（每天 20 則），不佔其他 AI 通知每天 6 則的額度；LINE 推播本月用量照既有規則看。

## 八、驗收（之後寫程式時）

- 雲端函式單元測試（假資料）：簽章錯誤 401、文字／圖片／檔案事件、10 分鐘合併、**webhook 內完全沒有呼叫回覆或推播 API**（攔截 fetch 檢查）、禁用字檢查（您、包商、預算、單價）、推播超過 150 則改複製、附件滿一年進回收筒、詢價收件確認後寫 quoteReq、鑽探報告標 needGeo。
- 冒煙測試：拍板卡三顆按鈕；禁用字擋確認；@817supkw 收件匣與 custInq 互不出現。
- 上線前在測試專案（fj-system-test）接一個測試用官方帳號走一遍，再換正式。

---

## 九、Lotion 定案（11/13）

| 題目 | 定案 |
|---|---|
| Q1 按確認後怎麼送 | (a) 推播送出；本月超過 150 則改成複製文字、Lotion 到 App 貼 |
| Q2 照片、PDF 留多久 | 原始檔收到滿 1 年自動移到回收筒；**鑽探報告整理成地層摘要進鑽探地圖永久保留**（跟 B-6 舊案地層同一套：地址、座標、地層、水位，來源標「官網詢價」） |
| Q3 連續訊息 | 10 分鐘內合成一張卡 |
| Q4 誰看得到 | 只有管理員 |
| Q5 轉成詢價收件 | 要：資料夠報價（有圖說或鑽探報告）先出「轉成詢價收件」卡，確認才轉；轉成收件、建好報價單殼後寫觸發點 `fydata/quoteReq`（needQuoteReport），報價線直接做報價報告，不用等 Lotion 再交代 |
| Q6 晚上 10 點～早上 8 點 | 照樣馬上通知（Lotion 改選 A） |
