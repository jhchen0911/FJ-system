# 排程倒推提醒＋材料送審擋進場：測試專案驗證（電腦端）

Lotion 11/11 定案：**程式先上，開關預設關閉**；電腦端在測試專案 `fj-system-test` 測過，Lotion 同意後才打開正式開關。

```
每天 07:10 雲端 schedRemind
   │
   ├─ 開關 fydata/private/schedCfg/on 沒開 → 什麼都不做（預設）
   │
   └─ 開了 → 讀 fydata/shared/projects 每個專案的 p.sched（整案排程）
              ├─ 開始日 − 提前天數 到了、還沒完成 → 首頁 ☁ 待辦「該辦證／該備料／該催技師」
              └─ 材料進場那一列，送審文件還沒核可 → 「不能排進場」
              結果整個寫 fydata/todo/sched（事情解決了，隔天就消失）
```

## 先知道：目前沒有任何專案有整案排程

主線 11/10 查過：`app.js` 裡**沒有任何程式會寫 `p.sched`**（整案排程畫面是第 7 步 7c 才做），所以正式資料裡有整案排程的專案＝**0 個**。
現在就算打開開關，也只會算出 0 筆（「還沒建整案排程」的卡預設不出，免得每個專案都跳一張）。
試算結果裡的 `count` 會寫「進行中幾個、有排程幾個」，可以直接看到這件事。

## 一、要部署什麼（只部署到測試專案）

1. 開新的 PowerShell
2. 依序貼下面每一行：

```
cd C:\Users\jhche\Agent\my-agent\400_Project\FJ-system
```
```
git fetch origin
```
```
git checkout claude/sched-wire
```
```
git pull
```
```
node tools/copy-calc.js
```
```
firebase deploy --only "functions:schedRemind,functions:schedRemindNow" --project fj-system-test
```

3. 看到 `Deploy complete!` 就完成；有紅字就截圖給陳軒。
4. 測完切回主線：

```
git checkout main
```

## 二、在測試專案放假資料

用 test.html（https://jhchen0911.github.io/FJ-system/test.html）以管理員登入，按 F12 開主控台（Console），貼上：

```js
(function(){var d=new Date(),f=function(n){var x=new Date(d.getTime()+n*864e5);return x.toISOString().slice(0,10);};
var id='p_schedtest';return _fbDb.ref('fydata/shared/projects/'+id).set({id:id,qid:'schedtest',no:'2026-999',_mt:Date.now(),
 sched:[{id:'s1',name:'路證申請',kind:'permit',start:f(10)},
        {id:'s2',name:'H型鋼進場',kind:'material',item:'H型鋼',start:f(5)},
        {id:'s3',name:'技師簽證',kind:'engineer',start:f(60)}],
 }).then(function(){console.log('假資料放好了')});})()
```

## 三、試算一次，看哪些結果才算過

在同一個主控台貼：

```js
fySchedRun().then(r => console.log(r))
```

**要全部對上才算過：**

| 看什麼 | 應該是 |
| :-- | :-- |
| `ok` | `true` |
| `count` | `{live: ≥1, withSched: ≥1}`（假資料那個專案有算到） |
| `sample` 有「該辦證：路證申請（10 天後開始）」 | 有（提前 30 天，已到） |
| `sample` 有「該備料：H型鋼進場」和「不能排進場」那一張 | 有（提前 14 天已到、沒有核可的送審文件） |
| `sample` 有「技師簽證」 | **沒有**（60 天後，還沒到提前 21 天） |
| 首頁待辦 | **不會**多出 ☁ 排程項目（手動試算不寫待辦） |

再補一張核可的送審文件，確認「不能排進場」那張會消失：

```js
_fbDb.ref('fydata/shared/projects/p_schedtest/docs').set({d1:{id:'d1',cat:'材料送審',st:'ok',name:'H型鋼送審.pdf',path:'projects/p_schedtest/docs/d1.pdf'}}).then(()=>fySchedRun()).then(r=>console.log(r))
```

`sample` 裡應該**只剩**「該辦證」和「該備料」，沒有「不能排進場」。

開關測試（測試專案）：

```js
fySchedSet({on:true}).then(r => console.log(r))
```

隔天 07:10 後首頁待辦應出現 ☁「該辦證／該備料」。測完關掉並刪假資料：

```js
fySchedSet({on:false}).then(()=>_fbDb.ref('fydata/shared/projects/p_schedtest').remove()).then(()=>_fbDb.ref('fydata/todo/sched').remove()).then(()=>console.log('清乾淨了'))
```

把上面每一步的主控台輸出截圖回報陳軒。

## 四、開正式開關（Lotion 同意後才做）

1. 程式隨主線上線（推 main 後「Firebase 自動部署」會部署 schedRemind、schedRemindNow），不用手動部署。
2. 用 Lotion 或 Lotion-HQ 的管理員帳號登入正式 FJ（https://jhchen0911.github.io/FJ-system/），F12 主控台貼：

```js
fySchedRun().then(r => console.log(r))
```

先看 `count.withSched`。**是 0 就先不要開**（沒有專案有整案排程，開了也不會有任何提醒），等第 7 步 7c 整案排程畫面上線、有專案填了排程再開。

3. 要開時貼：

```js
fySchedSet({on:true}).then(r => console.log(r))
```

4. 看到 `{ok: true}` 就完成，隔天 07:10 開始出提醒。要關掉就把 `true` 改成 `false` 再貼一次。
5. 想看「還沒建整案排程」的卡（每個進行中專案一張）：`fySchedSet({noSched:true})`；預設不出。

## 欄位格式（給 AI 看）

- `p.sched[]`：`{id, name, kind:'permit'|'material'|'engineer'|'work', start:'YYYY-MM-DD', lead?:提前天數, doneAt?, item?}`；沒填 lead 用預設 permit 30／material 14／engineer 21 天。
- `p.docs`：工程專案頁「送審文件」存的 `{cat:'材料送審', st:'ok', name, path}`（檔名含材料名稱就算核可那項材料）；或 `{kind:'matSubmit', item, approvedAt}`。
- 開關：`fydata/private/schedCfg`（`on`、`noSched`、`setAt`、`setBy`；`last`＝最近一次試算結果）。
