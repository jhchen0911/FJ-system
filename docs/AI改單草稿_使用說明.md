# AI 改單草稿（給陳軒／HQ 的唯讀帳號用）

**一句話：唯讀帳號不能直接改報價，把「要改的動作」送成草稿；Lotion 在 FJ 總覽「AI 草稿」看前後對照，按「套用」才改。**

```
唯讀帳號 fyQuoteChange(...) ──► fydata/drafts（type qchg，只能新增自己的 pending）
        ▲ 先在本機試算，對不上就不送          │
                                              ▼
Lotion：總覽 › AI 草稿 › 確認套用 → 前後對照表 → 「套用」→ 開報價、改好、儲存（跟手動改一樣）
```

## 怎麼送
在 FJ 網頁（唯讀帳號登入）的主控台或自動化呼叫：

```js
fyQuoteChange({
  code: 'Q-範例-001',            // 或 qid: '報價 id'
  summary: '範例案 V3：加減項一列',
  ops: [
    { op: 'add', item: { desc: '角撐 H300＋大型撐 H350（第一層）', unit: '式', qty: 1, price: -30000 }, after: { idx: 4, match: '動員費' } },
    { op: 'set', idx: 0, match: 'H型鋼樁', fields: { price: 950, note: '議價後' } },
    { op: 'del', idx: 6, match: '舊項目' },
    { op: 'rmk', key: 'load', value: '20T' },
    { op: 'rmkAdd', text: '本報價有效期限 30 天' }
  ]
}).then(r => console.log(r));   // {ok:true} 或 {ok:false, why:'…對不上…'}
```

## 動作一覽
| 動作 | 寫法 | 說明 |
|---|---|---|
| 新增列 | `{op:'add', item:{desc,unit,qty,price,note}, after:{idx,match}}` | `after` 省略＝加在最後；單價可負數＝減項（數量要 > 0） |
| 改列 | `{op:'set', idx, match, fields:{desc,unit,qty,price,note}}` | 只改有寫的欄位 |
| 刪列 | `{op:'del', idx, match}` | |
| 改備註數字欄 | `{op:'rmk', key, value}` | key：load 載重、walk 走道、tech 技術工、bh／br／bs／bb 買斷、c2／c3 覆工板、ir 鋪路鐵板、mob 動員費、minQty 最低數量 |
| 自訂條款 | `{op:'rmkAdd', text}`、`{op:'rmkSet', n, match, text}`、`{op:'rmkDel', n, match}` | n＝第幾條自訂條款（從 0 起），match＝那一條開頭的字 |

- `idx`＝報價工項的第幾列（從 0 起，分段標題也算一列）；`match`＝那一列說明的第一行，**兩個都對上才改**。只給 `match` 時要剛好一列相符。
- 對不上（報價被改過、說明不一樣、找不到、同一列兩個動作、數量 0）→ 不送；Lotion 那邊打開時又對不上 → 整份不能套用，只能退回重做。
- 套用改在目前的工作版次；之後 Lotion 匯出「送出並封存」時才照原規則封存版次。
- 一份最多 60 個動作。
