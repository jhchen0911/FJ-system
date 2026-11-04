# 待辦同步 Google 工作表：授權操作卡（改版第 5 步 5d #21，v6.0.167）

> 給 Lotion 在自己電腦做一次。做完後，FJ 總覽的雲端待辦（☁）會自動出現在 Google 工作表（Google Tasks）的「豐有」清單；處理好了自動打勾。
> 金鑰只放 Firebase 的密鑰（Secret Manager），**不貼進對話、不寫進任何檔案、不進 Git**。

```
FJ 雲端待辦（fydata/todo）
   │ 有變動／每小時對帳
   ▼
雲端程式 gtasksSync ──用 Lotion 授權過的通行證──▶ Google 工作表「豐有」清單
   │                                              新卡片＝新工作；卡片消失＝打勾
   └─ 狀態寫 fydata/gtasksStatus（FJ「LINE 機器人」卡下方看得到）
```

## 前置條件

- 雲端程式已部署過（LINE 機器人那批就部署過；Firebase 專案要 Blaze 方案）。
- 電腦已裝 Firebase CLI、已 `firebase login`（同 `docs/回國後部署清單_20261031.md`）。
- **先在測試專案 `fj-system-test` 做一次、確認會動，再做正式專案 `jhchen-aed9a`**。下面以正式專案為例；測試專案把專案 ID 換掉就好。

## 第一部分：Google Cloud 主控台建 OAuth 用戶端（約 10 分鐘）

1. 打開 https://console.cloud.google.com/ ，右上角確認是 jhchen0911@gmail.com。
2. 上方「選取專案」→ 選 **jhchen-aed9a**（Firebase 專案在 Google Cloud 裡是同一個）。
3. 左側選單 →「API 和服務」→「程式庫」→ 搜尋 **Google Tasks API** → 點進去 →「啟用」。
4. 左側「API 和服務」→「OAuth 同意畫面」（新版叫「Google Auth Platform」）：
   1. 「開始使用」／「建立」→ 應用程式名稱填 `豐有 FJ 待辦同步`，使用者支援電子郵件選 jhchen0911@gmail.com。
   2. 目標對象選 **外部（External）**。
   3. 聯絡資訊填 jhchen0911@gmail.com → 完成。
   4. 到「目標對象（Audience）」→「測試使用者」→ 新增 **jhchen0911@gmail.com**（還在「測試中」狀態時，只有測試使用者能授權）。
   5. 「資料存取（Data Access）」→「新增或移除範圍」→ 勾 `https://www.googleapis.com/auth/tasks`（Google Tasks API）→ 更新 → 儲存。
   6. **發布狀態**：維持「測試中」的話，Google 每 7 天會讓授權失效（FJ 會顯示「授權失效，請重新授權」）。要長期不用重授權，到「目標對象」按「發布應用程式」改成「正式版」；只有你自己用、不需要送 Google 審查（畫面會說未驗證，授權時按「進階」→「前往」即可）。**建議：先用測試中跑一週確認沒問題，再發布。**
5. 左側「API 和服務」→「憑證」→「建立憑證」→「OAuth 用戶端 ID」：
   1. 應用程式類型：**網頁應用程式**。
   2. 名稱：`FJ gtasks`。
   3. 「已授權的重新導向 URI」→ 新增一筆（一字不差）：
      ```
      https://asia-southeast1-jhchen-aed9a.cloudfunctions.net/gtasksAuthCallback
      ```
      （測試專案是 `https://asia-southeast1-fj-system-test.cloudfunctions.net/gtasksAuthCallback`）
   4. 建立 → 畫面跳出「用戶端 ID」與「用戶端密鑰」。**先不要關這個視窗**，下一部分要用（之後也可以在憑證頁再看）。

## 第二部分：把用戶端 ID／密鑰放進 Firebase 密鑰（約 3 分鐘）

在 FJ-system 資料夾開終端機，依序執行（每一行執行後，它會要你貼上值；貼上後按 Enter，畫面不會顯示你貼的內容）：

```
firebase use jhchen-aed9a
firebase functions:secrets:set GTASKS_CLIENT_ID
firebase functions:secrets:set GTASKS_CLIENT_SECRET
```

- 第一個貼「用戶端 ID」（很長、結尾是 `.apps.googleusercontent.com`）。
- 第二個貼「用戶端密鑰」（`GOCSPX-` 開頭）。

## 第三部分：部署這批雲端程式（約 5 分鐘）

（部署時會自動印出「[copy-calc] 已複製 N 個計算檔」，正常。）

```
firebase deploy --only functions:dailyReport,functions:dailyReportCatchup,functions:dailyReportNow,functions:gtasksSync,functions:gtasksSyncHourly,functions:gtasksAuthStart,functions:gtasksAuthCallback
```

再到 Firebase 主控台 → Realtime Database → 規則，貼上 repo 的 `database.rules.json` → 發布（這版新增 `progress`、`dailyOut`、`gtasks`、`gtasksStatus` 四個節點與草稿類型 `dailyOut`）。

## 第四部分：在 FJ 授權（1 分鐘）

1. 用 jhchen0911@gmail.com 登入 FJ → 人員管理 → 「LINE 機器人」卡 → 最下面「待辦同步 Google 工作表」→ 按 **授權 Google 工作表**。
2. 新分頁開 Google 畫面 → 選 jhchen0911@gmail.com → 如果出現「Google 尚未驗證這個應用程式」，按「進階」→「前往 豐有 FJ 待辦同步（不安全）」→ **允許**。
3. 看到「✅ 授權完成」就可以關掉分頁。回 FJ 按「重新整理」，卡片應顯示「✅ 已授權　上次同步…新建 N」。
4. 打開手機的 Google 工作表（Google Tasks）App，會多一個「豐有」清單。

## 怎麼確認有在動

- FJ 卡片顯示「上次同步」時間會跟著待辦變動更新；沒有待辦變動時每小時也會跑一次。
- Google 工作表裡的工作被打勾＝FJ 那張待辦已經消失（處理好了）。**在 Google 那邊自己打勾不會改 FJ**（FJ 的待辦要處理掉才會消失），下次同步時若 FJ 的卡片還在，那筆會被取消打勾。
- 每天最多新建 50 筆；超過的隔天才建（卡片顯示「N 筆超過今天上限明天建」）。

## 出問題

| 看到 | 原因 | 怎麼辦 |
|---|---|---|
| 「授權失效，請重新授權」 | OAuth 還在「測試中」滿 7 天、或你在 Google 帳戶撤銷了授權 | FJ 按「重新授權」；要長期免重授權，照第一部分第 4-6 步發布應用程式 |
| 按授權後跳「redirect_uri_mismatch」 | 第一部分 5-3 的網址打錯 | 回憑證頁把重新導向 URI 改成一字不差 |
| 「授權失敗：…雲端程式可能還沒部署」 | 第三部分還沒做，或密鑰沒設 | 照第二、三部分做 |
| 總覽出現「待辦同步 Google 工作表失敗 N 筆」 | Google 暫時錯誤或額度 | 一小時後會自動重試；持續出現請把卡片上的紅字截圖給陳軒 |

## 要停用

FJ 不需要改：到 https://myaccount.google.com/permissions 移除「豐有 FJ 待辦同步」的存取權即可（雲端會顯示授權失效、不再同步）。要連程式一起停：`firebase functions:delete gtasksSync gtasksSyncHourly --region asia-southeast1`。
