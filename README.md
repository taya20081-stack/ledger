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

本機寫入與收件匣測試使用記憶體模擬資料，可執行 `node --test tests/local-writes.test.cjs`。牌價、匯率與 Git 推送測試可執行 `python3 -m unittest discover -s tests -p "test_*.py"`。

若已安裝 Playwright 與 Chromium，可執行 `python3 tests/browser_upgrade.py`，在僅使用測試資料的本機網站驗證快取升級與 IndexedDB 交易中止。

每次改版請見 `CLAUDE.md` 的「Release convention」。架構細節（state、cloud sync、GitHub Actions）也都寫在 `CLAUDE.md`。

## Claude 收件匣（`users/{uid}/inbox/{id}`）

Claude 自己讀不到使用者的任何記錄或餘額，只能把「指令」寫成一份 Firestore 文件到收件匣；App 會在本機寫入完成且雲端同步確認後，嘗試刪除已處理的文件。欄位用 `stringValue`／`doubleValue`。

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
- 新增記錄由文件 ID 衍生，分期各期使用 `ib_<docId>_i<期數>`。每筆新指令使用新文件 ID。
- 執行前先用 Firestore 交易將指令標為 `processing`。確認雲端同步後標為 `completed`，再嘗試刪除。已知無效的指令標為 `invalid`，寫入結果不明的指令標為 `review` 或保留 `processing`。
- 若 App 在結果確認前中斷，其他裝置會保留原指令供核對。核對時先確認雲端與原裝置有哪些資料已寫入，再處理缺漏部分。原指令的保護標記應保留到核對完成。
- 分類、帳戶只能從 `kv/botinfo` 讀到的清單裡選，不可自創。
- 不要把使用者的持股、金額寫進公開位置（這個 repo 的任何檔案）。


### ChatGPT 多分類收據

一張收據應只使用一次 ChatGPT 分項工具。工具先合併同品項，再套用商品折扣及按原價比例分攤整筆折抵，送出一份 `exp` 或 `inc` 指令。它沿用 `sp` JSON 陣列，並附上 `spv: 1` 與可選的 `inv` 發票號碼。分項加總須等於 `amt`，折扣後為零的商品可保留。無效指令留待核對。

App 沿用原有群組存放與同步，日常帳目顯示一筆，分析與餘額以各分項金額合計。 多分項交易的總覽名稱留空，品名填在各分項的 `n`，商家仍填 `sh`。若現有海外交易設定自動產生手續費，手續費以「海外交易手續費」分項併入該筆交易。新版會保留 ChatGPT 分項的完成指令，作為識別碼的去重憑證。請更新會處理收件匣的裝置，舊版可能清掉該憑證。 `split_probe` 只驗證資料，不產生帳目。

### 通知中的記帳來源

Claude 與 ChatGPT 沿用同一個 Firestore 收件匣。通知保留兩個來源名稱，顯示 App 與共用收件匣的連線狀態。

ChatGPT 的文件 ID 採用 `chatgpt_` 加 36 位小寫十六進位字元。新入帳記錄的來源標記為 `chatgpt`。舊版已入帳的 ChatGPT 指令仍可透過記錄 ID 識別，現有記錄無須修改。Apple Pay 和股價更新不列入兩者的狀態。

### 收件匣規則與升級順序

以 [收件匣規則測試範例](tests/firebase/inbox.test.rules) 的 `validInboxTransition()` 為草案，將擁有者的狀態更新規則合併到現行 Firestore 規則。保留目前已核准的指令建立者，並在每個建立路徑禁止自帶 `_ledgerInbox`。檢查是否有其他重疊的 `allow update` 規則會放寬這項限制。測試範例包含假帳號，僅用於 Emulator。

上線前暫停送入收件匣指令，在測試專案驗證合併後的規則，再安排正式規則與 App 的升級。正式恢復收件匣前，確認會收件的裝置都已升級，並關閉舊版分頁。舊版 App 會直接執行指令，因此混用版本時無法靠新標記阻止重跑。

可在已啟動的 Firestore Emulator 執行 `node tests/firebase/inbox-rules.cjs`。測試需要 `@firebase/rules-unit-testing` 與 Firebase JS SDK，並透過 `FIRESTORE_EMULATOR_HOST` 指向本機。測試專案 ID 為 `demo-ledger-inbox`。
