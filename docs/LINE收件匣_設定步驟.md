# LINE 收件匣：Lotion 設定步驟（v6.0.144）

業主詢價從 LINE 傳給「陳軒｜AI 助理」（@817supkw，就是 FJ「📣 通知 Lotion」用的官方帳號）→ 雲端自動存檔 → FJ「LINE 收件匣」下載、歸檔。
不走 Gmail 轉寄（之前轉寄 5 個附件有 3 個變空檔）。

> **之前已經照 `docs/回國後部署清單_20261031.md` 做完第 3～6 步（金鑰、部署、Webhook、設擁有者）的話，只要做下面的「第 4 步：部署」與「第 6 步：試傳」。**

用擁有者帳號 jhchen0911@gmail.com 操作；金鑰（Channel secret／Channel access token）只輸入在自己電腦的終端機，不要貼進任何對話、不要存進檔案。

## 第 1 步：在 LINE Developers 拿兩把金鑰（3 分鐘）

1. 用電腦開 https://developers.line.biz/console/ → 登入 → 點「陳軒｜AI 助理」所在的 Provider → 點這個 Channel。
2. **Basic settings** 分頁最下面 **Channel secret** → 按 **複製**（先不要關頁面，第 2 步要貼）。
3. **Messaging API** 分頁最下面 **Channel access token (long-lived)** → 沒有的話按 **Issue** → 按 **複製**。

## 第 2 步：把金鑰存進 Firebase（2 分鐘，在自己電腦的終端機）

1. 打開終端機，切到 FJ-system 資料夾（`cd` 到 repo 所在位置）。
2. 輸入：
   ```
   firebase functions:secrets:set LINE_CHANNEL_SECRET --project jhchen-aed9a
   ```
   出現 `Enter a value` 時，貼上第 1 步第 2 小步複製的 Channel secret → Enter。（畫面不會顯示貼上的字，正常。）
3. 輸入：
   ```
   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN --project jhchen-aed9a
   ```
   貼上第 1 步第 3 小步的 Channel access token → Enter。
4. 之前已經設過、金鑰沒換的話，這一步可以跳過。

## 第 3 步：發布資料庫規則（1 分鐘）

1. Firebase 主控台 → **Realtime Database** → **規則** 分頁。
2. 把 repo 裡最新的 `database.rules.json` 全文貼上 → **發布**。這版只在 `lineInbox` 加了 `.indexOn: ["at"]`（收件匣依時間排序要用；沒發布也能用，只是會整包下載、主控台出警告）。
3. `storage.rules` 這版沒改：Storage `line/` 是員工與唯讀帳號可讀、網頁不能寫。

## 第 4 步：部署雲端程式（3～5 分鐘）

1. 在同一個終端機輸入：
   ```
   firebase deploy --only functions --project jhchen-aed9a
   ```
2. 跑完會列出各支函式的網址。這版新增 `lineInboxMark`、改了 `lineWebhook`（逾時 300 秒、串流存大檔、上限 100MB）。
3. 第一次部署才需要：把 `lineWebhook` 的網址（像 `https://asia-southeast1-jhchen-aed9a.cloudfunctions.net/lineWebhook`）複製起來，第 5 步用。

## 第 5 步：LINE 後台開 Webhook、關自動回應（第一次才需要，2 分鐘）

1. LINE Developers →「陳軒｜AI 助理」→ **Messaging API** 分頁 → **Webhook settings**。
2. **Webhook URL** 按 **Edit** → 貼上第 4 步的 `lineWebhook` 網址 → **Update**。
3. 按 **Verify**，出現 **Success** 才對。失敗多半是 Channel secret 貼錯：重做第 2 步第 2 小步，再重做第 4 步。
4. 打開 **Use webhook** 開關。
5. 同一頁 **Auto-reply messages** 按 **Edit** → 跳到 LINE Official Account Manager → **回應設定** → 「自動回應訊息」**關閉**、「Webhook」**開啟**；**Greeting messages**（加入好友的歡迎訊息）也建議關閉。不關的話，每傳一個檔案都會多一句官方罐頭訊息。
6. 第一次才需要：用 Lotion 自己的 LINE 傳一句「你好」給「陳軒｜AI 助理」→ FJ **人員管理** → 「LINE 機器人」卡 → **重新整理** → 「待確認的一對一帳號」那筆按 **設為擁有者**。只有擁有者名單內的人傳的東西會收；之後要加別人（白名單）也是同一個地方。

## 第 6 步：試傳（1 分鐘）

1. 在 LINE 裡把一份 PDF（或幾張照片）轉傳給「陳軒｜AI 助理」。
2. 幾秒內機器人回一句「收到，N 個檔案，歸到哪一案？」（一次轉傳多個只回一句；回覆用 reply，不吃每月推播額度）。
   - 超過 100MB 的檔案不存，回覆會說「另有 N 個檔案超過 100MB 沒存，請改傳雲端連結」。
3. 開 FJ → **報價** 列表上方 **LINE 收件匣（N）**（只有管理員看得到；總覽待辦也會出現「LINE 收件 N 件未歸檔」）→ 看得到剛才的檔案 → **下載** → **歸檔**（選報價或填案名）。
4. 存檔失敗的會標紅色「存檔失敗，請重傳」：重傳一次即可。

## 電腦端（陳軒／HQ）取檔

在已登入 AI 帳號（hsuanchen911）的 FJ 分頁執行：

- `await fyInboxList()` → 未歸檔清單（`{id, at, type, fileName, size, text, status, hasFile}`）；`fyInboxList({all:true})` 含已歸檔。
- `await fyInboxGet(id)` → `{id, fileName, type, size, url}`，`url` 是該檔的下載網址（只給 `line/inbox/` 底下的檔）。
- `await fyInboxMark(id, {qid, caseName, note})` → 「已歸檔」或沒改的原因；`{status:'new'}` 改回未歸檔。

標已歸檔走雲端 `lineInboxMark`（帶登入憑證；只有擁有者、名冊管理員與 AI 帳號名單能改；網頁不能直接寫 `lineInbox`）。

## 先知道的取捨

- 機器人是**先回「收到」再存檔**（大檔下載要幾十秒，等存完再回，回覆權杖會過期、就回不了）。所以「收到」代表雲端收到通知，不保證每個都存成功：存檔失敗、超時、或影片實際超過 100MB 的，FJ 收件匣會標紅色「存檔失敗，請重傳」或「超過上限沒存」，總覽待辦也看得到。
- 一次轉傳很多大檔，雲端最多花 240 秒存；時間不夠的那幾個記「請重傳」，不會無聲不見。
- 電腦端 HQ 用 AI 帳號（唯讀名冊）讀收件匣。如果之後為了權限把 AI 帳號移出唯讀名冊，HQ 會暫時讀不到收件匣，要等權限方案定案後再接回。

## 出問題時

| 狀況 | 原因／處理 |
|---|---|
| 傳了沒回「收到」 | Webhook 沒開或網址錯（第 5 步）；或傳的人不在擁有者名單（FJ「LINE 機器人」卡的待確認帳號會出現他） |
| 回了官方罐頭訊息 | 第 5 步第 5 小步的自動回應沒關 |
| FJ 收件匣看不到 | 不是管理員帳號；或第 4 步沒部署完 |
| 按「歸檔」說「收件匣服務尚未部署」 | 第 4 步沒部署到 `lineInboxMark` |
