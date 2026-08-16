# 資安設定說明

本系統是純前端單一檔案應用（GitHub Pages 靜態託管），所有授權都必須由 Firebase 後端執行。
前端的權限控制（`canAccess`、頁面隱藏）只是操作便利性，**不具備安全效力**。

## 一、Firebase Realtime Database 安全規則（尚未部署，需要您操作）

repo 內的 `database.rules.json` 是建議規則，**目前尚未套用到專案**。
沒有部署規則的話，資料庫可能處於「任何人都能讀寫」或「測試模式即將到期」的狀態。

### 部署方式（擇一）

**A. Firebase Console（最簡單，手機也能做）**

1. 開啟 https://console.firebase.google.com/
2. 選擇本系統的專案 → 左側「建構 > Realtime Database」→ 上方「規則」分頁
3. 把 `database.rules.json` 的內容整段貼上、按「發布」

**B. Firebase CLI（電腦）**

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only database
```

### 這份規則做了什麼

| 路徑 | 規則 |
|---|---|
| 根目錄 | 一律禁止讀寫（沒列出的路徑都拒絕） |
| `fydata/shared` | 僅**已登入**帳號可讀寫 |
| `fydata/shared/admins` | 管理員清單建立後，僅清單內的信箱可修改（防止一般帳號自行提權） |
| `fydata/backups` | 僅已登入帳號可讀寫（每日快照） |
| `fydata/logs/$uid` | 每個人只能寫自己的活動紀錄 |

### 已知限制

目前所有資料都在同一個 `fydata/shared` 節點下，因此**任何通過登入的帳號都能讀到全部資料**
（含成本、毛利、股東分潤）。頁面權限（例如工務看不到利潤頁）只在畫面上生效，
懂技術的人可以繞過。

若要做到「工務真的讀不到毛利」，需要把敏感欄位拆到獨立節點（例如 `fydata/private/profit`）
並以規則限制讀取——這是資料結構的調整，需要另外規劃一版。

## 二、Anthropic API 金鑰（智慧收件）

目前金鑰以明文存在瀏覽器 `localStorage`（鍵名 `fy_aikey`），由前端直接呼叫 Anthropic API。

- ✅ 金鑰**不會**上傳到 Firebase（已確認不在同步 payload 內）
- ⚠️ 共用電腦上開啟開發者工具即可取得金鑰
- ⚠️ 金鑰被盜用會直接產生 API 帳單

### 建議做法

**短期（建議立刻做）**：到 https://console.anthropic.com/ 對這把金鑰設定
**每月用量上限**，萬一外流也有損失上限。離開共用電腦前於「參數設定」清除金鑰。

**中長期**：把 AI 呼叫移到後端代理（Cloud Functions／Cloudflare Workers），
前端不再持有金鑰。這需要另建一個後端服務，不在單一檔案應用的範圍內。

## 三、附件儲存

工作確認單、合約檔、應付單據的照片：登入且 Firebase Storage 可用時走雲端連結；
失敗才退回內嵌 base64（單檔上限 1.5MB）。內嵌的檔案會佔用瀏覽器本機空間（上限約 5MB），
並隨同步整包上傳，建議盡量在已登入狀態下上傳附件。
