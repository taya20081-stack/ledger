# 存摺記帳

個人記帳 PWA（繁體中文），支援多帳戶、多幣別、預算、分期、週期帳與統計。純前端、無後端伺服器，資料存在裝置的 IndexedDB，選擇性同步到 Firebase（Firestore + Auth）。

**網址：** https://taya20081-stack.github.io/ledger/

## 功能

- 多帳戶（現金、銀行、電子支付、信用卡、外幣、投資、其他）、多幣別，自動換算台幣淨資產
- 分類／子類別管理，支援拖曳排序
- 預算、週期帳（日／週／月／年）、分期付款
- 專案（可把記錄分組到一個專案，如「出國旅遊」「裝潢」），支援拖曳排序
- 股票／黃金／外匯市值（GitHub Actions 每日自動更新收盤價、金價、匯率）
- 應收應付款項、存錢目標
- 掃發票 QR Code 自動記帳、Apple Pay 捷徑自動記帳
- 推播提醒（繳款日、扣款前一天）
- 雲端同步（Firebase），離線也能用，恢復連線後自動同步
- **Claude 對話記帳**：跟 Claude 說「午餐 120 元 現金」就能自動記帳（見下方「Claude 收件匣」）

## 開發

沒有建置流程，`index.html` 就是整個 App（inline `<script>`，約 3,400 行）。

```bash
# 語法檢查（抽出 inline <script>，用 node 檢查）
python3 -c "import re;s=open('index.html',encoding='utf-8').read();open('/tmp/app.js','w').write('\n;\n'.join(re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>',s,re.S)))" && node --check /tmp/app.js
```

每次改版請見 `CLAUDE.md` 的「Release convention」。架構細節（state、cloud sync、GitHub Actions）也都寫在 `CLAUDE.md`。

## Claude 收件匣（`users/{uid}/inbox/{id}`）

Claude 自己讀不到使用者的任何記錄或餘額，只能把「指令」寫成一份 Firestore 文件到收件匣；App 開啟時會讀取、執行、然後刪除該文件。欄位用 `stringValue`／`doubleValue`。

### 共同欄位
`kind` 決定指令種類；其餘欄位視 `kind` 而定，詳見下表。

### 指令一覽

| kind | 必填欄位 | 選填欄位 | 說明 |
|---|---|---|---|
| `exp` / `inc` | `amt`、`a` | `n` `c` `s` `sh` `p` `fee` `cu` `dt` `tm` `rep` `iv` `md` `cnt` `sno` `wk` `sp` | 新增一筆支出／收入；`rep` 存在時改成建立週期規則（`dt` 為起始日）；`sp` 是 JSON 陣列 `[{c,s,amt,n}]`（≥2 項）做同一張收據的分項 |
| `edit` / `del` | `dt`、`n` | `tm` `a` `oamt`、（edit 專屬）`nn` `amt` `c` `s` `sh` `p` `fee` `na` `ndt` `ntm` | 用 `dt`+`n`（可加 `tm`/`a`/`oamt` 縮小範圍）找「恰好一筆」記錄來改名／修改／刪除；找到 0 筆或多筆都不會變動 |
| `inst` | `n` `amt` `cnt` `a` `dt` | `sno` `c` `s` `sh` `p` `tot` `rate` `tm` | 分期付款（單筆合併金額，不拆本金／利息），`sno` 可從某一期開始建（接續舊分期） |
| `bal` | `a`、`amt`（目標餘額，帳戶幣別） | `dt` `tm`（預設現在）`n`（預設「餘額調整」） | **調整餘額**：App 計算該帳戶在 `dt`/`tm` 當下的實際餘額，與 `amt` 的差額記一筆「餘額調整」，差額為 0 就不記。機器人讀不到餘額，`amt` 必須是「目標餘額」本身，不能是差額 |
| `updrule` | `n` | `wk`（'prev'/'next'/''）、`nn` `p`（連同 `oamt` 縮小範圍） | 修改週期規則（遇假日調整，或改名稱／備註） |
| `delrule` | `n`（可逗號分隔多個） | — | 刪除週期規則（只刪由 Claude 建立、且未到期的記錄） |
| `rensub` | `k`（exp/inc）、`c`、`s`、`ns` | — | 子類別改名，連同所有記錄與週期規則一起更新 |
| `clrshop` | `n`（商家，可逗號分隔、可用 `*` 萬用字元） | — | 清空符合的商家名稱（記錄保留，可在搜尋頁復原） |
| `osshop` | `n`（商家，可逗號分隔） | `rm`（'1' = 移除） | 加入／移除「海外店家」清單 |
| `mvproj` | `o`（舊專案名）、`nv`（新專案名） | `d1` `d2`（日期區間） | 把某個日期區間的記錄搬到另一個專案 |
| `renproj` | `o`（舊名）、`nv`（新名） | — | 整個專案改名 |
| `hold` | `n`（代號）、`sh`（股數） | `pf`（組合，預設「我的」）`cu` `rm`（'1' = 刪除） | 新增／更新／刪除持股 |
| `gold` | `q`（數量） | `u`（'錢'/'兩'/'克'，預設「錢」） | 設定黃金持有量 |
| `px` | — | — | 美股收盤價（只由 GitHub Actions 寫入，使用者看不到也不應手動送） |
| `src:'ap'` | — | — | Apple Pay 捷徑自動記帳用 |

新增指令種類時要同步更新三個地方：`index.html` 裡 `processInbox()` 上方的協定註解、本節，以及「記帳」skill 的 inbox 欄位說明。

### 給 Claude 的注意事項
- inbox 對機器人是只寫不讀，無法回讀；是否成功以 HTTP 200 與使用者 App 畫面為準。
- 文件 id 會變成記錄 id（`ib_<docId>`），同一份文件重複送達會被擋掉（去重鍵含使用者 uid），刪除收件匣文件失敗時也會自動重試，所以同一份指令最終只會生效一次。
- 分類、帳戶只能從 `kv/botinfo` 讀到的清單裡選，不可自創。
- 不要把使用者的持股、金額寫進公開位置（這個 repo 的任何檔案）。
