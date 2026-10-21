# Storage 權限：擋住陌生帳號（任務 7，v6.0.105 起）

現況（v6.0.97 的 `storage.rules`）：任何能登入 Firebase 的帳號都能讀寫工程／應付／發票／合約附件，只有雲端快照限擁有者。

## 短期：規則內寫明人員清單（不用部署程式，今天就能做）

1. 以擁有者帳號登入系統 → **人員管理** → 頁面下方「唯讀帳號（AI 助理）」卡 → **產生 Storage 規則**。
2. 視窗內是依目前「人員名冊（啟用中）」與「唯讀名冊」產生的規則全文 → **複製全文**。
3. Firebase 主控台（專案 jhchen-aed9a）→ **Storage → 規則** → 全部取代貼上 → **發布**。
4. 之後**人員或唯讀帳號有增減**，重做 1～3（Storage 規則讀不到資料庫，清單要手動更新）。

發布後：只有清單內人員能讀寫附件；唯讀帳號只能讀；其他帳號全部拒絕；雲端快照仍只有擁有者。

> 注意：沒在人員名冊的人（例如剛加入、還沒建檔）會被擋下上傳附件——先到人員管理新增再重新產生規則。

## 長期：自動依名冊設定附件權限（Cloud Function，已決定採用）

**這是什麼**：在 Firebase 上放一支小程式（Cloud Function）。之後在系統「人員管理」新增、停用人員，或增減唯讀帳號時，它會自動更新每個帳號能不能看／上傳附件，不用再手動貼規則。
程式已寫好放在 repo 的 `functions/index.js`，下面只是「把它放上 Firebase」的步驟，**整個過程只要做一次**，約 20～30 分鐘。

**時機**：等工程師通知「新版已上線（含 functions 資料夾）」之後再做——還沒上線時下載到的程式沒有這支小程式，步驟二會失敗。做好之前，先用上面「短期」的清單規則頂著（兩者可以並存，不衝突）。

### 事前確認（1 分鐘）

- Firebase 專案 **jhchen-aed9a** 是 **Blaze（隨用隨付）方案**：Firebase 主控台左下角「方案」顯示 Blaze 即可。不是的話要先升級（需綁信用卡；這支程式用量極小，在免費額度內，實際不會產生費用）。
- 用 **擁有者帳號 jhchen0911@gmail.com** 操作。

### 步驟一：在電腦安裝工具（第一次才需要，約 10 分鐘）

1. 到 https://nodejs.org 下載 **LTS 版**（網站首頁推薦的那個即可）安裝，一路「下一步」。（雲端執行用的版本已寫在程式設定裡，跟電腦上裝哪一版無關。）
2. 打開「終端機」（Mac：應用程式 → 工具程式 → 終端機；Windows：開始 → 輸入 `cmd` → 命令提示字元）。
3. 貼上下面這行、按 Enter（安裝 Firebase 工具，跑完會回到可輸入狀態）：
   ```
   npm install -g firebase-tools
   ```
   Mac 若出現 permission denied，改貼 `sudo npm install -g firebase-tools`，再輸入電腦開機密碼（輸入時畫面不會顯示字，正常）。
4. 貼上下面這行、按 Enter：
   ```
   firebase login
   ```
   若先問「是否允許收集使用資料（Allow Firebase to collect …?）」，輸入 `n` 按 Enter 即可。
   接著會自動開瀏覽器 → 選 **jhchen0911@gmail.com** → 允許。看到「Success! Logged in」就完成。

### 步驟二：下載程式並放上 Firebase（約 10 分鐘）

在同一個終端機視窗，**一行一行**貼上、每行按 Enter，等它跑完再貼下一行：

```
git clone https://github.com/jhchen0911/FJ-system.git
cd FJ-system
cd functions
npm install
cd ..
firebase use jhchen-aed9a
firebase deploy --only functions
```

- 沒有 `git` 的話（出現「找不到指令／command not found」）：到 https://github.com/jhchen0911/FJ-system 按綠色「Code」→「Download ZIP」，解壓縮後會得到資料夾 **FJ-system-main**。在終端機輸入 `cd `（cd 後面有一個空格），把這個資料夾拖進終端機視窗帶出路徑，按 Enter；Windows 若資料夾在別的磁碟（例如 D:），改用 `cd /d `。接著從 `cd functions` 那行開始，把後面每一行都做完（含 `cd ..`、`firebase use`、`firebase deploy`）。
- `git clone` 若要求登入 GitHub：輸入 GitHub 帳號，密碼欄要貼 GitHub 的「Personal access token」；不熟的話直接用上一點的 Download ZIP（先在瀏覽器登入 GitHub）。
- 最後一行會跑 2～5 分鐘。成功時最後會出現 **「Deploy complete!」**。
- 第一次部署可能會問「是否啟用某些 API（enable … API?）」，輸入 `y` 按 Enter。
- 問「要不要設定舊映像檔自動清除（cleanup policy）」之類的問題，直接按 Enter 用預設即可。
- 出現紅字 **Error**：先等 3 分鐘，再貼一次最後那行 `firebase deploy --only functions`（第一次部署時 Google 端權限常要幾分鐘才生效）。還是失敗，就把整段紅字複製給工程師。
- 若錯誤提到 **Blaze** 或 billing：專案還不是 Blaze 方案，回到「事前確認」先升級。
- 這個指令**只會放上這支小程式**，不會動到資料庫規則、Storage 規則或任何資料。

### 步驟三：在系統裡按一次「重新同步附件權限」（1 分鐘）

1. 用擁有者帳號登入系統 → **人員管理** → 下方「唯讀帳號（AI 助理）」卡。
2. 按 **「重新同步附件權限」**（只有擁有者帳號看得到這顆按鈕）。
3. 畫面下方出現「附件權限已同步，更新 N 個帳號」就完成。
   - 「更新 0 個帳號」也是正常的（代表大家的權限本來就對）。
   - 「同步失敗：連不到 Cloud Function」→ 步驟二沒有成功，回去看最後一行的訊息；或不是從正式網址 https://jhchen0911.github.io/FJ-system/ 開的系統（其他網址會被擋）。
   - 「同步失敗（403）」→ 不是用擁有者帳號登入；「（401）」→ 重新登入再按；「（500）」→ 把訊息複製給工程師。
4. 請其他同事**重新整理系統一次**（之後就自動，不用再做）。

### 步驟四：貼一次新版 Storage 規則（1 分鐘）

人員管理 → **產生 Storage 規則** → **複製全文** → Firebase 主控台 → Storage → 規則 → 全部取代貼上 → **發布**。
（規則會先看自動設定的權限，再看清單；之後人員增減不必再貼。若按「產生 Storage 規則」沒有反應，重新整理頁面再試一次。）

### 之後

- 人員或唯讀帳號增減：照常在系統人員管理操作即可，**自動生效**（對方重新整理後；最遲 1 小時）。
- 費用：只在名冊變動時執行，次數極少，在 Blaze 免費額度內。
- 要撤銷或停用這個方案：請找工程師處理（只刪除 Functions 不會收回已設定的權限，需要一併清除帳號上的設定）。

<details><summary>技術說明（給工程師）</summary>

`functions/index.js` 監看 `fydata/access`、`fydata/adminEmails`、`fydata/readers`，任一變動就全量重算所有帳號的 custom claim `fy`（`admin`／`staff`／`reader`，不在名冊＝移除）；`fyClaimsOnCreate` 在新帳號建立時設定；`fyClaimsSyncNow`（HTTPS，只接受擁有者 ID token，CORS 限 GitHub Pages 網域）供人員管理頁「重新同步附件權限」（`storageClaimsSync`）呼叫。`firebase.json` 只列 functions，`firebase deploy --only functions` 不會覆蓋任何規則。前端登入時 `getIdToken(true)` 主動更新 token。

</details>

## 建議：關閉自行註冊

Firebase 主控台 → Authentication → 設定（Settings）→ 使用者動作（User actions）→ 取消勾選「啟用建立帳戶（Enable create）」，帳號一律由擁有者在 Authentication → Users 新增（Google 登入不受此設定影響時，仍以人員名冊與規則把關）。這樣陌生人無法自己用 Email／密碼註冊帳號。

## 優缺點

| | 短期（清單） | 長期（claims） |
|---|---|---|
| 生效 | 今天貼規則即可 | 需部署一次 functions |
| 名冊變動 | 每次要重新產生、發布 | 自動（最多 1 小時或重新整理後生效） |
| 維運 | 無程式 | 一支 Function（Node 22） |


## 帳號驗證（2026-10-20 審查決定）

- **不要求 `email_verified`**：帳號由管理員在 Firebase 主控台建立，可能沒有完成信箱驗證；規則若加 `request.auth.token.email_verified == true` 會把這些人鎖在外面。
- 對應的風險（有人自行註冊別人的信箱）已由 Lotion 在 Firebase 主控台 Authentication → 設定 **關閉「允許使用者自行註冊」與「允許使用者刪除帳號」** 處理；之後若重新開放自行註冊，要回頭評估加上 `email_verified`。
