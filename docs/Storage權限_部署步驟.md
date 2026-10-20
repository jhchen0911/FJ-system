# Storage 權限：擋住陌生帳號（任務 7，v6.0.105 起）

現況（v6.0.97 的 `storage.rules`）：任何能登入 Firebase 的帳號都能讀寫工程／應付／發票／合約附件，只有雲端快照限擁有者。

## 短期：規則內寫明人員清單（不用部署程式，今天就能做）

1. 以擁有者帳號登入系統 → **人員管理** → 頁面下方「唯讀帳號（AI 助理）」卡 → **產生 Storage 規則**。
2. 視窗內是依目前「人員名冊（啟用中）」與「唯讀名冊」產生的規則全文 → **複製全文**。
3. Firebase 主控台（專案 jhchen-aed9a）→ **Storage → 規則** → 全部取代貼上 → **發布**。
4. 之後**人員或唯讀帳號有增減**，重做 1～3（Storage 規則讀不到資料庫，清單要手動更新）。

發布後：只有清單內人員能讀寫附件；唯讀帳號只能讀；其他帳號全部拒絕；雲端快照仍只有擁有者。

> 注意：沒在人員名冊的人（例如剛加入、還沒建檔）會被擋下上傳附件——先到人員管理新增再重新產生規則。

## 長期：Cloud Function 自動依名冊設定權限（custom claims，方案 B）

`functions/index.js`：監看 `fydata/access`、`fydata/adminEmails`、`fydata/readers`，任一變動就把所有帳號的 claim `fy` 設為 `admin`／`staff`／`reader`（不在名冊＝移除）；新帳號建立時也會設定。產生的規則先看 claim，再看清單，所以部署後名冊變動會自動生效，不必每次重新貼規則。

部署（需在電腦上做一次；專案為 Blaze 方案才可用 Functions）：

1. 安裝 Node.js 20 與 Firebase CLI：`npm install -g firebase-tools`，`firebase login`（用擁有者帳號）。
2. 取得 repo：`git clone https://github.com/jhchen0911/FJ-system.git && cd FJ-system`。
3. `cd functions && npm install && cd ..`
4. `firebase use jhchen-aed9a`
5. **只部署 functions**：`firebase deploy --only functions`（`firebase.json` 只列 functions，規則一律在主控台貼上發布，不會被部署覆蓋）。
6. 部署完成後執行一次全量重算：用擁有者帳號登入系統，瀏覽器開發者工具 Console 執行
   `firebase.auth().currentUser.getIdToken().then(t=>fetch('https://asia-southeast1-jhchen-aed9a.cloudfunctions.net/fyClaimsSyncNow',{headers:{Authorization:'Bearer '+t}}).then(r=>r.text()).then(console.log))`
   → 顯示 `{"changed":N}`。
7. 各使用者重新整理系統一次（系統登入時會重新取得權限）。

費用：觸發次數＝名冊變動次數，量極小，Blaze 免費額度內。

## 建議：關閉自行註冊

Firebase 主控台 → Authentication → 設定（Settings）→ 使用者動作（User actions）→ 取消勾選「啟用建立帳戶（Enable create）」，帳號一律由擁有者在 Authentication → Users 新增（Google 登入不受此設定影響時，仍以人員名冊與規則把關）。這樣陌生人無法自己用 Email／密碼註冊帳號。

## 優缺點

| | 短期（清單） | 長期（claims） |
|---|---|---|
| 生效 | 今天貼規則即可 | 需部署一次 functions |
| 名冊變動 | 每次要重新產生、發布 | 自動（最多 1 小時或重新整理後生效） |
| 維運 | 無程式 | 一支 Function（Node 20） |


## 帳號驗證（2026-10-20 審查決定）

- **不要求 `email_verified`**：帳號由管理員在 Firebase 主控台建立，可能沒有完成信箱驗證；規則若加 `request.auth.token.email_verified == true` 會把這些人鎖在外面。
- 對應的風險（有人自行註冊別人的信箱）已由 Lotion 在 Firebase 主控台 Authentication → 設定 **關閉「允許使用者自行註冊」與「允許使用者刪除帳號」** 處理；之後若重新開放自行註冊，要回頭評估加上 `email_verified`。
